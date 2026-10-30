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
import { setupAfterInstalls } from '../apply/installs'
import { reportText } from '../core/text'
import { chooseFramework } from '../framework/contract'
import { detectAll } from '../framework/registry'
import { CLAUDE_MD_PLUGIN } from '../roles/infra'
import { proposeRoles } from '../roles/propose'
import { scanWarnings } from '../scan/gather'
import type { StepResult } from '../ui/ask'
import { scanContextLine, scanSummaryLines, scanWarningLines } from '../ui/blocks/scan'
import type { Reviewed } from './draft'
import { historyHints } from './flow'
import { initReplyText } from './initapply'
import { cancelledReply, INIT_CANCELLED } from './replies'
import {
  draftBase,
  fullDraft,
  STAGE_ORDER,
  stageCancelled,
  stageDone,
  stageEnded,
  stageFailed,
  withEffect,
  withOutputs,
} from './state'
import type { Answer, Applied, Effect, InitStage, InitState, StageDef } from './state'
import { policyStage } from './stages/policy'
import { improverRunCount, improverRunLine, PRIVATE_FILES_HEADING, privateFilesRow } from './stages/review'
import { installedFrameworks } from './stages/roles'

/** The guard (D-42, legacy): it refuses with its text, which is the whole reply, or gives the session's locations. */
const guardStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => withEffect(state, { kind: 'legacy', step: { id: 'guard' } }),
  answer: (state: InitState, answer: Answer): InitState => {
    if (answer.kind !== 'legacy' || answer.result.id !== 'guard') return stageFailed(state)
    const guard = answer.result.result
    if (guard.kind === 'refuse') return stageEnded(state, guard.text)

    return stageDone({ ...state, draft: { ...state.draft, locations: guard.locations } })
  },
})

/** The ~/.claude.json consent (D-58, legacy): the answer the scans are gathered with. */
const consentStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => withEffect(state, { kind: 'legacy', step: { id: 'consent' } }),
  answer: (state: InitState, answer: Answer): InitState => {
    if (answer.kind !== 'legacy' || answer.result.id !== 'consent') return stageFailed(state)
    const consent = answer.result.result
    if (consent.kind === 'cancelled') return stageCancelled(state, consent.reason)

    return stageDone({ ...state, draft: { ...state.draft, readUserMcp: consent.value } })
  },
})

/** The scans (SCAN-01, SCAN-02, legacy), then the scan block with their warnings in the side pane (D-133). */
const scanStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { locations, readUserMcp } = state.draft
    if (locations === undefined || readUserMcp === undefined) return stageFailed(state)

    return withEffect(state, { kind: 'legacy', step: { id: 'scan', locations, readUserMcp } })
  },
  answer: (state: InitState, answer: Answer): InitState => {
    const { locations } = state.draft
    if (answer.kind !== 'legacy' || answer.result.id !== 'scan' || locations === undefined) return stageFailed(state)
    const gathered = answer.result.result
    const warnings = scanWarningLines(scanWarnings(locations, gathered))
    const lines = [...scanSummaryLines(gathered.repo, gathered.setup), ...warnings]
    const scanned = { ...state, draft: { ...state.draft, gathered } }

    return stageDone(withOutputs(scanned, [{ kind: 'show', block: { key: 'scan', lines } }]))
  },
})

/**
 * The history question (SCAN-03, D-59, legacy), with the scan's context line; then what the scans fix for the whole
 * run: the frameworks installed, the framework choice, the template proposal and the history hints.
 */
const historyStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { locations, gathered } = state.draft
    if (locations === undefined || gathered === undefined) return stageFailed(state)
    const context = scanContextLine(gathered.repo)

    return withEffect(state, { kind: 'legacy', step: { id: 'history', locations, context } })
  },
  answer: (state: InitState, answer: Answer): InitState => {
    const { gathered } = state.draft
    if (answer.kind !== 'legacy' || answer.result.id !== 'history' || gathered === undefined) return stageFailed(state)
    const history = answer.result.result
    if (history.kind === 'cancelled') return stageCancelled(state, history.reason)
    const detections = detectAll(gathered.facts.facts)
    const draft = {
      ...state.draft,
      installed: installedFrameworks(detections),
      choice: chooseFramework(detections, null),
      proposal: proposeRoles(gathered.repo),
      hints: historyHints(history.value),
    }

    return stageDone({ ...state, draft })
  },
})

/** The role steps from the roles question to the improver install question (teamStep, legacy), from the proposal. */
const teamStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const base = draftBase(state.draft)
    if (base === null) return stageFailed(state)

    return withEffect(state, { kind: 'legacy', step: { id: 'team', base } })
  },
  answer: (state: InitState, answer: Answer): InitState => {
    if (answer.kind !== 'legacy' || answer.result.id !== 'team') return stageFailed(state)
    const team = answer.result.result
    if (team.kind === 'cancelled') return stageCancelled(state, team.reason)

    return stageDone({ ...state, draft: { ...state.draft, ...team.value } })
  },
})

/** Where the launchers start (A2, legacy), asked once for the repo with the role ids. */
const launchStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { locations, roles } = state.draft
    if (locations === undefined || roles === undefined) return stageFailed(state)

    return withEffect(state, { kind: 'legacy', step: { id: 'launch', root: locations.root, roles } })
  },
  answer: (state: InitState, answer: Answer): InitState => {
    if (answer.kind !== 'legacy' || answer.result.id !== 'launch') return stageFailed(state)
    const launch = answer.result.result
    if (launch.kind === 'cancelled') return stageCancelled(state, launch.reason)

    return stageDone({ ...state, draft: { ...state.draft, launchStart: launch.value } })
  },
})

/**
 * The reply of a confirmed --dry-run (D-82, 02-GAPS-B3 S4): the plan as the review confirmed it, with the private
 * files of every role and, when claude-md-management is installed and a built file holds a part, the improver line;
 * nothing was written.
 */
function dryRunReply(reviewed: Reviewed): string {
  const { plan, state } = reviewed.planned
  const confirmed = reviewed.draft
  const count = improverRunCount(confirmed, plan)
  const installed = setupAfterInstalls(confirmed.gathered.setup, confirmed.pluginInstalls).installedPlugins
  const improver = installed.includes(CLAUDE_MD_PLUGIN) && count > 0 ? [improverRunLine(count)] : []
  const rows = confirmed.roles.map(role => privateFilesRow(role.id))

  return initReplyText(plan, state.gitPolicy, state.launchStart, null, [PRIVATE_FILES_HEADING, ...rows, ...improver])
}

/** The review's result (D-43): a --dry-run replies with the confirmed plan; plain init applies it after Confirm. */
function afterReview(state: InitState, result: StepResult<Reviewed>): InitState {
  if (result.kind === 'cancelled') return stageCancelled(state, result.reason)
  const reviewed = result.value
  const confirmed = { ...state, draft: reviewed.draft }
  if (state.dryRun) return stageEnded(confirmed, dryRunReply(reviewed))
  const applying: InitState = { ...confirmed, sub: { kind: 'applying' } }

  return withEffect(applying, { kind: 'legacy', step: { id: 'apply', reviewed } })
}

/** Confirm's apply (D-105): the reply with the plan as written and what the apply did. */
function afterApply(state: InitState, result: StepResult<Applied> | null): InitState {
  if (result === null) return stageFailed(state)
  if (result.kind === 'cancelled') return stageCancelled(state, result.reason)
  const { planned, outcome } = result.value

  return stageEnded(state, initReplyText(planned.plan, planned.state.gitPolicy, planned.state.launchStart, outcome))
}

/** The final review with its go-backs (reviewStep, legacy), then Confirm's apply on plain init (legacy). */
const reviewStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const draft = fullDraft(state.draft)
    if (draft === null) return stageFailed(state)

    return withEffect(state, { kind: 'legacy', step: { id: 'review', draft } })
  },
  answer: (state: InitState, answer: Answer): InitState => {
    if (answer.kind !== 'legacy') return stageFailed(state)
    const { result } = answer
    if (result.id === 'review') return afterReview(state, result.result)
    if (result.id === 'apply') return afterApply(state, result.result)

    return stageFailed(state)
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
  team: teamStage,
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
 * The state once its stage's cursor is acted on: a done stage enters the stage after it, again until a stage sets an
 * effect; a cancel, an end or a failure ends the run. No more hops than there are stages, so it always ends.
 */
function settled(state: InitState): InitState {
  let current = state
  for (let hops = 0; hops <= STAGE_ORDER.length; hops += 1) {
    const { sub } = current
    if (sub.kind === 'cancelled') return cancelledWith(current, sub.reason)
    if (sub.kind === 'end') return endedWith(current, sub.reply)
    if (sub.kind === 'failed') return failed(current)
    if (sub.kind !== 'done') return current
    const next = stageAfter(current.stage)
    if (next === null) return failed(current)
    current = entered(current, next)
  }

  return failed(current)
}

/** Whether `answer` answers `effect`: an answer to an ask, the result of the same legacy step; nothing ends a run. */
function isAnswerTo(effect: Effect, answer: Answer): boolean {
  switch (effect.kind) {
    case 'ask':
      return answer.kind === 'answer'
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
