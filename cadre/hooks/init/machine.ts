/**
 * The /cadre init stage machine (D-204, D-230), a layer 10 module: STAGES, the StageDef of every InitStage;
 * initialState, a run with its first effect out; and nextStage, the one transition: the open stage takes the answer,
 * and once that stage is done the stages after it in STAGE_ORDER are entered until one sets an effect. A cancelled
 * stage has its reason logged as its own line and ends the run with cancelledReply (A1, D-45); an answer that does not
 * fit the effect that is out, or any answer once the run ended, ends it with INIT_CANCELLED (fail closed). Until
 * 02.1-26 the stages that are not pure yet are legacy stages here: each sets one legacy effect, made from the draft,
 * that init/run performs with today's step, and merges its result into the draft as runInit did. Pure: it gives
 * states and never performs an effect; only init/run and the tests import it.
 */
import { reportText } from '../core/text'
import { chooseFramework } from '../framework/contract'
import { detectAll } from '../framework/registry'
import { proposeRoles } from '../roles/propose'
import { scanWarnings } from '../scan/gather'
import { scanSummaryLines, scanWarningLines } from '../ui/blocks/scan'
import { cancelledReply, INIT_CANCELLED } from './replies'
import {
  STAGE_ORDER,
  stageCancelled,
  stageDone,
  stageEnded,
  stageFailed,
  withEffect,
  withOutputs,
} from './state'
import type { Answer, Effect, InitStage, InitState, LegacyStep, StageDef } from './state'
import { consentStage } from './stages/consent'
import { durationStage } from './stages/duration'
import { frameworksStage } from './stages/frameworks'
import { historyStage } from './stages/history'
import { launchStage } from './stages/launch'
import { policyStage } from './stages/policy'
import { reviewStage } from './stages/review'
import { installedFrameworks } from './stages/roles'
import { securityStage } from './stages/security'

/**
 * The guard (D-42, SCAN-04), an io effect before anything is read or asked: it refuses with its text, which is the
 * whole reply, or gives the session's locations.
 */
const guardStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => withEffect(state, { kind: 'io', call: { id: 'guard' } }),
  answer: (state: InitState, answer: Answer): InitState => {
    if (answer.kind !== 'io' || answer.result.id !== 'guard') return stageFailed(state)
    const guard = answer.result.result
    if (guard.kind === 'refuse') return stageEnded(state, guard.text)

    return stageDone({ ...state, draft: { ...state.draft, locations: guard.locations } })
  },
})

/**
 * The scans (SCAN-01, SCAN-02), an io effect with the consent answer, then the scan block with their warnings in the
 * side pane (D-133), shown before the history question, and what the scans fix for the whole run: the frameworks
 * installed, the framework choice and the template proposal.
 */
const scanStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { locations, readUserMcp } = state.draft
    if (locations === undefined || readUserMcp === undefined) return stageFailed(state)

    return withEffect(state, { kind: 'io', call: { id: 'scan', locations, readUserMcp } })
  },
  answer: (state: InitState, answer: Answer): InitState => {
    const { locations } = state.draft
    if (answer.kind !== 'io' || answer.result.id !== 'scan' || locations === undefined) return stageFailed(state)
    const gathered = answer.result.result
    const warnings = scanWarningLines(scanWarnings(locations, gathered))
    const lines = [...scanSummaryLines(gathered.repo, gathered.setup), ...warnings]
    const detections = detectAll(gathered.facts.facts)
    const draft = {
      ...state.draft,
      gathered,
      installed: installedFrameworks(detections),
      choice: chooseFramework(detections, null),
      proposal: proposeRoles(gathered.repo),
    }
    const scanned = { ...state, draft }

    return stageDone(withOutputs(scanned, [{ kind: 'show', block: { key: 'scan', lines } }]))
  },
})

/**
 * The roles (rolesStep, legacy): from the template proposal, or from the current team with the scan changes it was
 * accepted with when the roles are asked again (A6).
 */
const rolesStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { proposal, installed, roles, changes } = state.draft
    if (proposal === undefined || installed === undefined) return stageFailed(state)
    const start = roles === undefined ? proposal : { roles, changes: changes ?? [] }

    return withEffect(state, { kind: 'legacy', step: { id: 'roles', proposal, installed, start } })
  },
  answer: (state: InitState, answer: Answer): InitState => {
    if (answer.kind !== 'legacy' || answer.result.id !== 'roles') return stageFailed(state)
    const chosen = answer.result.result
    if (chosen.kind === 'cancelled') return stageCancelled(state, chosen.reason)
    const { roles, changes } = chosen.value

    return stageDone({ ...state, draft: { ...state.draft, roles, changes } })
  },
})

/** A role step that only changes the roles (legacy): the model, the assignments or the carried settings. */
function rolesAnswer(state: InitState, answer: Answer, id: 'model' | 'assign' | 'carry'): InitState {
  if (answer.kind !== 'legacy') return stageFailed(state)
  const { result } = answer
  const isOwn = result.id === id && (result.id === 'model' || result.id === 'assign' || result.id === 'carry')
  if (!isOwn) return stageFailed(state)
  const changed = result.result
  if (changed.kind === 'cancelled') return stageCancelled(state, changed.reason)

  return stageDone({ ...state, draft: { ...state.draft, roles: changed.value } })
}

/** Each role's model and effort (modelStep, legacy). */
const modelStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { roles } = state.draft
    if (roles === undefined) return stageFailed(state)

    return withEffect(state, { kind: 'legacy', step: { id: 'model', roles } })
  },
  answer: (state: InitState, answer: Answer): InitState => rolesAnswer(state, answer, 'model'),
})

/** The MCP servers and skills, with the history hints (assignmentStep, legacy). */
const assignStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { roles, gathered, hints } = state.draft
    if (roles === undefined || gathered === undefined || hints === undefined) return stageFailed(state)

    return withEffect(state, { kind: 'legacy', step: { id: 'assign', roles, setup: gathered.setup, hints } })
  },
  answer: (state: InitState, answer: Answer): InitState => rolesAnswer(state, answer, 'assign'),
})

/** The instructions and memories (instructionsStep, legacy), with how they were handed out (G-02-1f). */
const instructionsStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { roles, gathered, locations } = state.draft
    if (roles === undefined || gathered === undefined || locations === undefined) return stageFailed(state)
    const step = { id: 'instructions', roles, setup: gathered.setup, locations } satisfies LegacyStep

    return withEffect(state, { kind: 'legacy', step })
  },
  answer: (state: InitState, answer: Answer): InitState => {
    if (answer.kind !== 'legacy' || answer.result.id !== 'instructions') return stageFailed(state)
    const instructed = answer.result.result
    if (instructed.kind === 'cancelled') return stageCancelled(state, instructed.reason)
    const { roles, instructions } = instructed.value

    return stageDone({ ...state, draft: { ...state.draft, roles, instructions } })
  },
})

/** The carried settings (carryStep, legacy). */
const carryStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { roles, gathered } = state.draft
    if (roles === undefined || gathered === undefined) return stageFailed(state)

    return withEffect(state, { kind: 'legacy', step: { id: 'carry', roles, setup: gathered.setup } })
  },
  answer: (state: InitState, answer: Answer): InitState => rolesAnswer(state, answer, 'carry'),
})

/** The autonomy hunks of the frameworks the roles run on (hunkStep, legacy). */
const hunksStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { roles, repoDefault, gathered, locations } = state.draft
    const isReady = roles !== undefined && repoDefault !== undefined && gathered !== undefined
    if (!isReady || locations === undefined) return stageFailed(state)
    const step = { id: 'hunks', roles, repoDefault, gathered, locations } satisfies LegacyStep

    return withEffect(state, { kind: 'legacy', step })
  },
  answer: (state: InitState, answer: Answer): InitState => {
    if (answer.kind !== 'legacy' || answer.result.id !== 'hunks') return stageFailed(state)
    const hunks = answer.result.result
    if (hunks.kind === 'cancelled') return stageCancelled(state, hunks.reason)

    return stageDone({ ...state, draft: { ...state.draft, hunks: hunks.value } })
  },
})

/**
 * The claude-md-management install question when the hand-out gave a role a built file and it is missing
 * (improverInstallStep, legacy, D-141): its plugin goes after the security plugins to install after Confirm.
 */
const improverInstallStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { instructions, gathered } = state.draft
    if (instructions === undefined || gathered === undefined) return stageFailed(state)

    return withEffect(state, { kind: 'legacy', step: { id: 'improver', instructions, setup: gathered.setup } })
  },
  answer: (state: InitState, answer: Answer): InitState => {
    const { pluginInstalls } = state.draft
    const isAnswer = answer.kind === 'legacy' && answer.result.id === 'improver'
    if (!isAnswer || pluginInstalls === undefined) return stageFailed(state)
    const improver = answer.result.result
    if (improver.kind === 'cancelled') return stageCancelled(state, improver.reason)
    const installs = [...pluginInstalls, ...improver.value]

    return stageDone({ ...state, draft: { ...state.draft, pluginInstalls: installs } })
  },
})

/** An ended run: it sets no effect, and takes no answer. */
const endStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => state,
  answer: (state: InitState): InitState => stageFailed(state),
})

/** The StageDef of every stage (D-230). */
export const STAGES: Readonly<Record<InitStage, StageDef>> = Object.freeze({
  guard: guardStage,
  consent: consentStage,
  scan: scanStage,
  history: historyStage,
  roles: rolesStage,
  frameworks: frameworksStage,
  security: securityStage,
  duration: durationStage,
  model: modelStage,
  assign: assignStage,
  instructions: instructionsStage,
  carry: carryStage,
  hunks: hunksStage,
  'improver-install': improverInstallStage,
  policy: policyStage,
  launch: launchStage,
  review: reviewStage,
  cancelled: endStage,
  done: endStage,
})

/** A run that cannot go on (fail closed): it ends with INIT_CANCELLED, and nothing more is logged. */
function failed(state: InitState): InitState {
  return withEffect({ ...state, stage: 'cancelled', sub: { kind: 'start' } }, { kind: 'end', reply: INIT_CANCELLED })
}

/**
 * A run a stage cancelled (A1, D-45): its reason logged as its own line, cleaned as a report cell, the one place a
 * cancel reason is printed, then the reply that names it too (cancelledReply, batch-1 review S1).
 */
function cancelledWith(state: InitState, reason: string): InitState {
  const logged = withOutputs(state, [{ kind: 'log', text: reportText(reason) }])
  const ended: InitState = { ...logged, stage: 'cancelled', sub: { kind: 'start' } }

  return withEffect(ended, { kind: 'end', reply: cancelledReply(reason) })
}

/** A run that ended with `reply`. */
function endedWith(state: InitState, reply: string): InitState {
  return withEffect({ ...state, stage: 'done', sub: { kind: 'start' } }, { kind: 'end', reply })
}

/** The stage after `stage` in STAGE_ORDER; null after the last one and for a stage that ends a run. */
function stageAfter(stage: InitStage): InitStage | null {
  const at = STAGE_ORDER.indexOf(stage)

  return at === -1 ? null : (STAGE_ORDER[at + 1] ?? null)
}

/** The state with `stage` entered: its cursor at start, then the stage's own enter. */
function entered(state: InitState, stage: InitStage): InitState {
  return STAGES[stage].enter({ ...state, stage, sub: { kind: 'start' } })
}

/**
 * Whether the done stage of `state` ends a go-back from the review (D-204): it is the go-back's returnAfter stage, so
 * the review comes next instead of the stage after it.
 */
function isGoBackDone(state: InitState): boolean {
  return state.returnTo === 'review' && state.stage === state.returnAfter
}

/**
 * The review entered again once a go-back is done (D-204, A3): the go-back cleared and one more review round counted,
 * as the review counts a round after each go-back (MAX_REVIEW_ROUNDS).
 */
function backToReview(state: InitState): InitState {
  return entered({ ...state, returnTo: null, returnAfter: null, rounds: state.rounds + 1 }, 'review')
}

/**
 * The state once its stage's cursor is acted on: a done stage enters the stage after it, or the review again when it
 * ends a go-back, and a go-back from the review enters its stage, again until a stage sets an effect; a cancel, an end
 * or a failure ends the run. No more hops than there are stages, so it always ends.
 */
function settled(state: InitState): InitState {
  let current = state
  for (let hops = 0; hops <= STAGE_ORDER.length; hops += 1) {
    const { sub } = current
    if (sub.kind === 'cancelled') return cancelledWith(current, sub.reason)
    if (sub.kind === 'end') return endedWith(current, sub.reply)
    if (sub.kind === 'failed') return failed(current)
    if (sub.kind === 'back') {
      current = entered(current, sub.to)
      continue
    }
    if (sub.kind !== 'done') return current
    if (isGoBackDone(current)) {
      current = backToReview(current)
      continue
    }
    const next = stageAfter(current.stage)
    if (next === null) return failed(current)
    current = entered(current, next)
  }

  return failed(current)
}

/**
 * Whether `answer` answers `effect`: an answer to an ask, the result of the same host operation or legacy step; nothing
 * answers the end of a run.
 */
function isAnswerTo(effect: Effect, answer: Answer): boolean {
  switch (effect.kind) {
    case 'ask':
      return answer.kind === 'answer'
    case 'io':
      return answer.kind === 'io' && answer.result.id === effect.call.id
    case 'legacy':
      return answer.kind === 'legacy' && answer.result.id === effect.step.id
    case 'end':
      return false
    default: {
      const unreachable: never = effect
      return unreachable
    }
  }
}

/** A run before its first answer (D-230): the guard entered, its effect out, nothing to show yet. */
export function initialState(dryRun: boolean): InitState {
  const blank: InitState = {
    stage: 'guard',
    sub: { kind: 'start' },
    draft: {},
    outputs: [],
    effect: { kind: 'end', reply: INIT_CANCELLED },
    openQuestion: null,
    returnTo: null,
    returnAfter: null,
    rounds: 0,
    dryRun,
  }

  return settled(entered(blank, 'guard'))
}

/**
 * The one transition of init (D-230): the open stage takes `answer`, and the state is settled (a done stage enters the
 * next, a cancel or an end ends the run). An answer that does not fit the effect that is out, or any answer once the
 * run ended, ends it with INIT_CANCELLED (fail closed, T-02.1-103). The state given is never changed.
 */
export function nextStage(state: InitState, answer: Answer): InitState {
  const isOver = state.stage === 'cancelled' || state.stage === 'done'
  if (isOver || !isAnswerTo(state.effect, answer)) return failed(state)

  return settled(STAGES[state.stage].answer(state, answer))
}
