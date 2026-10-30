/**
 * The state of the /cadre init stage machine (D-204, D-230), a layer 10 module: InitStage and STAGE_ORDER, the stages
 * of a run in today's order; InitState, what one run holds between two answers (the stage and its cursor, the draft as
 * it fills, what to show, the one effect to perform, the open question with its spec, the go-back target and the
 * review rounds); Output, Effect and Answer, what the runner shows, performs and feeds back; StageDef, what each stage
 * of the table gives; and the small constructors the stages build their states with. Types and constructors only: it
 * imports type shapes and no port, so nothing built on it can reach a port. The stages and init/machine import it,
 * and init/run reads its types.
 */
import type { AskSpec, InitLocations, LaunchStart, PaneKey, RoleSpec } from '../../types'
import type { ApplyOutcome } from '../apply/run'
import type { GuardResult } from '../guards/repo'
import type { Gathered } from '../scan/gather'
import type { HistoryScan } from '../scan/history'
import type { StepResult } from '../ui/ask'
import type { Draft, DraftBase, PlanResult, Reviewed, Team } from './draft'

/**
 * The stages of an init run in today's order (D-43, D-230, A1): the guard, the ~/.claude.json consent, the scans, the
 * history question, the role steps (`team`), the git policy, the launcher start, and the review with Confirm's apply;
 * then `done`, a run that ended with its reply, or `cancelled`, a run that ended with nothing written.
 */
export type InitStage =
  | 'guard'
  | 'consent'
  | 'scan'
  | 'history'
  | 'team'
  | 'policy'
  | 'launch'
  | 'review'
  | 'cancelled'
  | 'done'

/** The stages a run goes through, in order; `cancelled` and `done` end a run and follow no stage. */
export const STAGE_ORDER: readonly InitStage[] = Object.freeze([
  'guard',
  'consent',
  'scan',
  'history',
  'team',
  'policy',
  'launch',
  'review',
])

/**
 * What a stage gives the runner to show before its effect, in order (D-133): a side-pane block (shown as showBlock
 * shows it), a note (logged and shown as noteLine does), or one line logged as it is.
 */
export type Output =
  | { readonly kind: 'show'; readonly block: { readonly key: PaneKey; readonly lines: readonly string[] } }
  | { readonly kind: 'note'; readonly line: string }
  | { readonly kind: 'log'; readonly text: string }

/**
 * One host operation a stage needs (D-230), named after the helper init/run runs for it, with plain data only: the
 * guard (initGuard) and the scans with the consent answer (gatherScans).
 */
export type IoCall =
  | { readonly id: 'guard' }
  | { readonly id: 'scan'; readonly locations: InitLocations; readonly readUserMcp: boolean }

/** What an IoCall gave, under the same id. */
export type IoResult =
  | { readonly id: 'guard'; readonly result: GuardResult }
  | { readonly id: 'scan'; readonly result: Gathered }

/**
 * An init step that still runs as today's async step (D-230, until 02.1-26): the step, named after what it runs, with
 * the draft fields it needs. init/run performs it and gives back its LegacyResult.
 */
export type LegacyStep =
  | { readonly id: 'consent' }
  | { readonly id: 'history'; readonly locations: InitLocations; readonly context: string }
  | { readonly id: 'team'; readonly base: DraftBase }
  | { readonly id: 'launch'; readonly root: string; readonly roles: readonly RoleSpec[] }
  | { readonly id: 'review'; readonly draft: Draft }
  | { readonly id: 'apply'; readonly reviewed: Reviewed }

/** What Confirm's apply gives: the plan made again and written, and what the apply did (D-105). */
export type Applied = {
  readonly planned: PlanResult
  readonly outcome: ApplyOutcome
}

/**
 * What a LegacyStep gave, under the same id: the result of the step it names. The apply gives none when the run holds
 * no host, which never happens, since a --dry-run never sets the apply step.
 */
export type LegacyResult =
  | { readonly id: 'consent'; readonly result: StepResult<boolean> }
  | { readonly id: 'history'; readonly result: StepResult<HistoryScan | 'skipped'> }
  | { readonly id: 'team'; readonly result: StepResult<Team> }
  | { readonly id: 'launch'; readonly result: StepResult<LaunchStart> }
  | { readonly id: 'review'; readonly result: StepResult<Reviewed> }
  | { readonly id: 'apply'; readonly result: StepResult<Applied> | null }

/**
 * The one thing a state asks the runner to do next (D-230): ask the person `question` with its dialog spec, perform a
 * host operation, run a legacy step, or end the run with `reply`.
 */
export type Effect =
  | { readonly kind: 'ask'; readonly question: string; readonly spec: AskSpec }
  | { readonly kind: 'io'; readonly call: IoCall }
  | { readonly kind: 'legacy'; readonly step: LegacyStep }
  | { readonly kind: 'end'; readonly reply: string }

/**
 * What the runner feeds back for an effect: the answer to an ask, null when it was dismissed, what a host operation
 * gave, or a legacy step's result.
 */
export type Answer =
  | { readonly kind: 'answer'; readonly text: string | null }
  | { readonly kind: 'io'; readonly result: IoResult }
  | { readonly kind: 'legacy'; readonly result: LegacyResult }

/**
 * Where a stage is inside itself (D-230):
 * - `start`: just entered; a stage with one effect waits here for its answer.
 * - `ask`: one question is out, asked `tries` times so far (choiceAnswer).
 * - `applying`: the review was confirmed, and Confirm's apply is out.
 * - `done`: the stage finished; nextStage enters the stage after it.
 * - `cancelled`: the stage ends init with nothing written, and `reason` says why (A1).
 * - `end`: the run ends with `reply`.
 * - `failed`: the stage got an answer it cannot take; nextStage cancels init (fail closed).
 */
export type StageSub =
  | { readonly kind: 'start' }
  | { readonly kind: 'ask'; readonly tries: number }
  | { readonly kind: 'applying' }
  | { readonly kind: 'done' }
  | { readonly kind: 'cancelled'; readonly reason: string }
  | { readonly kind: 'end'; readonly reply: string }
  | { readonly kind: 'failed' }

/**
 * What one init run holds between two answers (D-43, D-204, D-230). It is never written or kept after the run, and a
 * transition gives a new state.
 */
export type InitState = {
  readonly stage: InitStage
  /** The stage's own cursor. */
  readonly sub: StageSub
  /** Today's Draft fields as they fill: a field is set once the stage that decides it has its answer (A1). */
  readonly draft: Partial<Draft>
  /** What to show before the effect, in order; the runner shows them and hands the next transition none. */
  readonly outputs: readonly Output[]
  readonly effect: Effect
  /** The question open now with its spec: the ask effect's, else null (withEffect sets both, D-204). */
  readonly openQuestion: { readonly question: string; readonly spec: AskSpec } | null
  /** Where a go-back from the review goes once its stage is done; null outside a go-back (D-204). */
  readonly returnTo: 'review' | null
  /** How many review rounds ended in a go-back so far. */
  readonly rounds: number
  /** --dry-run: Confirm replies with the plan and nothing is written or installed (D-82, D-105). */
  readonly dryRun: boolean
}

/**
 * One stage of the table (D-230): `enter` sets the stage's first effect from the state, and `answer` takes the
 * answer to the effect that is out. Neither performs anything: a stage only gives a new state.
 */
export type StageDef = {
  readonly enter: (state: InitState) => InitState
  readonly answer: (state: InitState, answer: Answer) => InitState
}

/** The state with `effect` out and its open question set from it: the ask's question and spec, else null (D-204). */
export function withEffect(state: InitState, effect: Effect): InitState {
  const openQuestion = effect.kind === 'ask' ? { question: effect.question, spec: effect.spec } : null

  return { ...state, effect, openQuestion }
}

/** The state asking `question` with `spec`, the question asked `tries` times so far (StageSub `ask`). */
export function asking(state: InitState, question: string, spec: AskSpec, tries: number): InitState {
  return withEffect({ ...state, sub: { kind: 'ask', tries } }, { kind: 'ask', question, spec })
}

/** The state with `outputs` shown after the ones it already has. */
export function withOutputs(state: InitState, outputs: readonly Output[]): InitState {
  return { ...state, outputs: [...state.outputs, ...outputs] }
}

/** The stage is done: nextStage enters the stage after it. */
export function stageDone(state: InitState): InitState {
  return { ...state, sub: { kind: 'done' } }
}

/** The stage ends init with nothing written; nextStage logs `reason` and replies with it (A1). */
export function stageCancelled(state: InitState, reason: string): InitState {
  return { ...state, sub: { kind: 'cancelled', reason } }
}

/** The run ends with `reply`. */
export function stageEnded(state: InitState, reply: string): InitState {
  return { ...state, sub: { kind: 'end', reply } }
}

/** The stage got an answer it cannot take, or lacks a draft field it needs: nextStage cancels init (fail closed). */
export function stageFailed(state: InitState): InitState {
  return { ...state, sub: { kind: 'failed' } }
}

/** The DraftBase of a draft, or null while a field of it is not set. */
export function draftBase(draft: Partial<Draft>): DraftBase | null {
  const { locations, gathered, readUserMcp, installed, choice, proposal, hints } = draft
  if (locations === undefined || gathered === undefined || readUserMcp === undefined) return null
  if (installed === undefined || choice === undefined || proposal === undefined || hints === undefined) return null

  return { locations, gathered, readUserMcp, installed, choice, proposal, hints }
}

/** The whole Draft, or null while a field of it is not set: the review plans only a whole draft. */
export function fullDraft(draft: Partial<Draft>): Draft | null {
  const base = draftBase(draft)
  const { duration, roles, changes, repoDefault, hunks, pluginInstalls, instructions, policy, launchStart } = draft
  if (base === null || duration === undefined || roles === undefined || changes === undefined) return null
  if (repoDefault === undefined || hunks === undefined || pluginInstalls === undefined) return null
  if (instructions === undefined || policy === undefined || launchStart === undefined) return null

  return { ...base, duration, roles, changes, repoDefault, hunks, pluginInstalls, instructions, policy, launchStart }
}
