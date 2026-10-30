/**
 * The /cadre init stage machine (D-204, D-230), a layer 10 module: STAGES, the StageDef of every InitStage;
 * initialState, a run with its first effect out; and nextStage, the one transition: the open stage takes the answer,
 * and once that stage is done the stages after it in STAGE_ORDER are entered until one sets an effect. A cancelled
 * stage has its reason logged as its own line and ends the run with cancelledReply (A1, D-45); an answer that does not
 * fit the effect that is out, or any answer once the run ended, ends it with INIT_CANCELLED (fail closed). Every stage
 * is a pure StageDef of init/stages, but for the guard and the scans, which are io effects here. Pure: it gives states
 * and never performs an effect; only init/run and the tests import it.
 */
import { isObject } from '../core/json'
import { reportText } from '../core/text'
import { chooseFramework } from '../framework/contract'
import { detectAll } from '../framework/registry'
import { proposeRoles } from '../roles/propose'
import { scanWarnings } from '../scan/gather'
import { scanSummaryLines, scanWarningLines } from '../ui/blocks/scan'
import { cancelledReply, INIT_CANCELLED } from './replies'
import { STAGE_ORDER, stageDone, stageEnded, stageFailed, withEffect, withOutputs } from './state'
import type { Answer, Effect, InitStage, InitState, Kept, StageDef } from './state'
import { assignStage } from './stages/assign'
import { carryStage } from './stages/carry'
import { consentStage } from './stages/consent'
import { durationStage } from './stages/duration'
import { frameworksStage } from './stages/frameworks'
import { historyStage } from './stages/history'
import { hunksStage } from './stages/hunks'
import { improverInstallStage } from './stages/improver-install'
import { instructionsStage } from './stages/instructions'
import { launchStage } from './stages/launch'
import { modelStage } from './stages/model'
import { policyStage } from './stages/policy'
import { reviewStage } from './stages/review'
import { installedFrameworks, rolesStage } from './stages/roles'
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
 * The tool names of a `$.tool.list()` answer (D-211): the string name of each entry, in the order given; anything but
 * a list gives none. A description or any other field is never read.
 */
function toolNamesOf(tools: unknown): string[] {
  if (!Array.isArray(tools)) return []

  return tools.flatMap(tool => (isObject(tool) && typeof tool.name === 'string' ? [tool.name] : []))
}

/**
 * The scans (SCAN-01, SCAN-02), an io effect with the consent answer, then the scan block with their warnings in the
 * side pane (D-133), shown before the history question, and what the scans fix for the whole run: the frameworks
 * installed, the framework choice, the template proposal, and the session's tool names for the MCP server questions'
 * contexts (D-211).
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
    const scanned = { ...state, draft, toolNames: toolNamesOf(answer.result.tools) }

    return stageDone(withOutputs(scanned, [{ kind: 'show', block: { key: 'scan', lines } }]))
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
 * Whether `answer` answers `effect`: an answer to an ask, or the result of the same host operation or model call;
 * nothing answers the end of a run.
 */
function isAnswerTo(effect: Effect, answer: Answer): boolean {
  switch (effect.kind) {
    case 'ask':
      return answer.kind === 'answer'
    case 'io':
      return answer.kind === 'io' && answer.result.id === effect.call.id
    case 'model':
      return answer.kind === 'model' && answer.result.id === effect.call.id
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
    kept: null,
    toolNames: [],
    dryRun,
  }

  return settled(entered(blank, 'guard'))
}

/**
 * The kept model results after `answer` (D-235): an own-skills answer is kept, and a parts answer together with the
 * topics its call named, so the kept topics and recommendation always come from one read (ASKED #137); each with the
 * ids of the roles it was made for, so a review go-back can reuse it. Any other answer leaves them as they are.
 */
function keptAfter(state: InitState, answer: Answer): Kept | null {
  if (answer.kind !== 'model') return state.kept
  const roleIds = (state.draft.roles ?? []).map(role => role.id)
  const kept: Kept = state.kept ?? { roleIds, ownSkills: null, topics: null, parts: null }
  const { result } = answer
  const { effect } = state
  switch (result.id) {
    case 'skills':
      return { ...kept, roleIds, ownSkills: result.result }
    case 'parts': {
      const topics = effect.kind === 'model' && effect.call.id === 'parts' ? effect.call.topics : null

      return { ...kept, roleIds, topics, parts: result.result }
    }
    default:
      return state.kept
  }
}

/**
 * The one transition of init (D-230): the open stage takes `answer`, and the state is settled (a done stage enters the
 * next, a cancel or an end ends the run). A model answer the review go-backs reuse is kept first (keptAfter, D-235).
 * An answer that does not fit the effect that is out, or any answer once the run ended, ends it with INIT_CANCELLED
 * (fail closed, T-02.1-103). The state given is never changed.
 */
export function nextStage(state: InitState, answer: Answer): InitState {
  const isOver = state.stage === 'cancelled' || state.stage === 'done'
  if (isOver || !isAnswerTo(state.effect, answer)) return failed(state)

  return settled(STAGES[state.stage].answer({ ...state, kept: keptAfter(state, answer) }, answer))
}
