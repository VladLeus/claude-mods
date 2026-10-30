/**
 * The state of the /cadre init stage machine (D-204, D-230), a layer 10 module: InitStage and STAGE_ORDER, the stages
 * of a run in today's order; InitState, what one run holds between two answers (the stage and its cursor, the draft as
 * it fills, what to show, the one effect to perform, the open question with its spec, the go-back target and the
 * review rounds); Output, Effect and Answer, what the runner shows, performs and feeds back; StageDef, what each stage
 * of the table gives; ReviewItem, what an answer to the review question picks; and the small constructors the stages
 * build their states with. Types and constructors only: it
 * imports type shapes and no port, so nothing built on it can reach a port. The stages and init/machine import it,
 * and init/run reads its types.
 */
import type {
  AskSpec,
  HunkOp,
  InitLocations,
  InstructionGroup,
  InstructionHandout,
  InstructionScan,
  InstructionTopic,
  MemoryItem,
  PaneKey,
  PortEntry,
  PortRead,
  RoleChange,
  RoleSpec,
  SkillRef,
} from '../../types'
import type { ApplyOutcome } from '../apply/run'
import type { GuardResult } from '../guards/repo'
import type { Gathered } from '../scan/gather'
import type { HistoryScan } from '../scan/history'
import type { InstructionSources } from '../scan/instructions/read'
import type { Proposed } from '../suggest/propose'
import type { StepResult } from '../ui/ask'
import type { NameAssignment } from './assign-rules'
import type { Draft, DraftBase, PlanResult, Reviewed } from './draft'
import type { HandoutCursor } from './handout'
import type { PlanStepInput } from './initplan'

/**
 * The stages of an init run in today's order (D-43, D-230, A1): the guard, the ~/.claude.json consent, the scans, the
 * history question, the role steps (the roles, their frameworks, the security plugins, the duration, each role's model
 * and effort, the MCP and skill assignments, the instructions and memories, the carried settings, the hunks and the
 * improver install), the git policy, the launcher start, and the review with Confirm's apply; then `done`, a run that
 * ended with its reply, or `cancelled`, a run that ended with nothing written.
 */
export type InitStage =
  | 'guard'
  | 'consent'
  | 'scan'
  | 'history'
  | 'roles'
  | 'frameworks'
  | 'security'
  | 'duration'
  | 'model'
  | 'assign'
  | 'instructions'
  | 'carry'
  | 'hunks'
  | 'improver-install'
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
  'roles',
  'frameworks',
  'security',
  'duration',
  'model',
  'assign',
  'instructions',
  'carry',
  'hunks',
  'improver-install',
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

/** This repo's session transcripts as listSessions gives them: the newest ones, and how many there are in all. */
export type SessionListing = {
  readonly sessions: readonly PortEntry[]
  readonly total: number
}

/**
 * One host operation a stage needs (D-230), named after the helper init/run runs for it, with plain data only: the
 * guard (initGuard), the scans with the consent answer (gatherScans), the listing of the session folder
 * (listSessions), the history scan of the listed sessions (scanHistory), the read of a config file the hunks change
 * (readRepoFile), the names of the repo's rule files and AGENTS.md (repoInstructionNames), the read of the instruction
 * files after the content consent (readInstructionFiles), the check that a typed launcher folder is a folder inside
 * the repo (isRepoFolder), the review's plan (planStep) and Confirm's apply (applyConfirmed).
 */
export type IoCall =
  | { readonly id: 'guard' }
  | { readonly id: 'scan'; readonly locations: InitLocations; readonly readUserMcp: boolean }
  | { readonly id: 'list-sessions'; readonly dir: string }
  | { readonly id: 'scan-history'; readonly dir: string; readonly sessions: readonly PortEntry[] }
  | { readonly id: 'read-repo-file'; readonly root: string; readonly path: string; readonly maxBytes: number }
  | { readonly id: 'repo-instruction-names'; readonly root: string }
  | { readonly id: 'read-instruction-files'; readonly sources: InstructionSources }
  | { readonly id: 'launch-dir-check'; readonly root: string; readonly path: string }
  | { readonly id: 'plan'; readonly input: PlanStepInput }
  | { readonly id: 'apply'; readonly reviewed: Reviewed }

/**
 * What an IoCall gave, under the same id; a session folder that cannot be listed gives null, and so does an apply in a
 * run that holds no host, which never happens, since a --dry-run never sets the apply.
 */
export type IoResult =
  | { readonly id: 'guard'; readonly result: GuardResult }
  | { readonly id: 'scan'; readonly result: Gathered }
  | { readonly id: 'list-sessions'; readonly result: SessionListing | null }
  | { readonly id: 'scan-history'; readonly result: HistoryScan }
  | { readonly id: 'read-repo-file'; readonly result: PortRead }
  | { readonly id: 'repo-instruction-names'; readonly result: RepoNames }
  | { readonly id: 'read-instruction-files'; readonly result: InstructionScan }
  | { readonly id: 'launch-dir-check'; readonly result: boolean }
  | { readonly id: 'plan'; readonly result: PlanResult }
  | { readonly id: 'apply'; readonly result: StepResult<Applied> | null }

/**
 * What an answer to the review question picks (D-43, A2): confirm the plan, or go back to one item: the roles (and with
 * them every per-role step), the git policy, the launcher start, the duration, the model and effort, the MCP and skill
 * assignments, the instructions and memories, the carried env names, or the hunks.
 */
export type ReviewItem =
  | 'confirm'
  | 'roles'
  | 'policy'
  | 'launch'
  | 'duration'
  | 'model'
  | 'assignments'
  | 'memory'
  | 'env'
  | 'hunks'

/** What Confirm's apply gives: the plan made again and written, and what the apply did (D-105). */
export type Applied = {
  readonly planned: PlanResult
  readonly outcome: ApplyOutcome
}

/**
 * One model call a stage needs (D-230), named after what it asks the model, with plain data only; init/run runs it
 * through checkedCompletion as today's step did: the roles of a structure the person described (proposeFromText), the
 * roles recommended for each of the user's own skills with their use counts, the topics the parts of an instruction
 * read group into, and the roles recommended for each topic and memory.
 */
export type ModelCall =
  | { readonly id: 'describe-roles'; readonly text: string }
  | {
      readonly id: 'skills'
      readonly roles: readonly RoleSpec[]
      readonly skills: readonly SkillRef[]
      readonly counts: ReadonlyMap<string, number>
    }
  | { readonly id: 'topics'; readonly scan: InstructionScan }
  | {
      readonly id: 'parts'
      readonly roles: readonly RoleSpec[]
      readonly topics: readonly InstructionTopic[]
      readonly memories: readonly MemoryItem[]
    }

/**
 * What a ModelCall gave, under the same id, unchanged: the recommendations are keyed S1, S2, ... by place for the
 * skills, and by topic and memory id for the parts.
 */
export type ModelResult =
  | { readonly id: 'describe-roles'; readonly result: Proposed }
  | { readonly id: 'skills'; readonly result: ReadonlyMap<string, readonly string[]> }
  | { readonly id: 'topics'; readonly result: readonly InstructionTopic[] }
  | { readonly id: 'parts'; readonly result: ReadonlyMap<string, readonly string[]> }

/**
 * The one thing a state asks the runner to do next (D-230): ask the person `question` with its dialog spec, perform a
 * host operation, call the model, or end the run with `reply`.
 */
export type Effect =
  | { readonly kind: 'ask'; readonly question: string; readonly spec: AskSpec }
  | { readonly kind: 'io'; readonly call: IoCall }
  | { readonly kind: 'model'; readonly call: ModelCall }
  | { readonly kind: 'end'; readonly reply: string }

/**
 * What the runner feeds back for an effect: the answer to an ask, null when it was dismissed, or what a host operation
 * or a model call gave.
 */
export type Answer =
  | { readonly kind: 'answer'; readonly text: string | null }
  | { readonly kind: 'io'; readonly result: IoResult }
  | { readonly kind: 'model'; readonly result: ModelResult }

/**
 * The model results a review go-back reuses instead of calling the model again (D-235, ASKED #14): the roles
 * recommended for the own skills, the topics of the instruction read and the roles recommended for the topics and
 * memories, each null until its model call answered, and the ids of the roles they were made for. The roles stage drops
 * them when a go-back changes the role ids.
 */
export type Kept = {
  readonly roleIds: readonly string[]
  readonly ownSkills: ReadonlyMap<string, readonly string[]> | null
  readonly topics: readonly InstructionTopic[] | null
  readonly parts: ReadonlyMap<string, readonly string[]> | null
}

/** What init finds of the repo's own instruction files before the content consent, by name only (G-02-1f Sources). */
export type RepoNames = Pick<InstructionSources, 'rules' | 'hasAgentsMd'>

/**
 * Where the instruction group questions are (D-63, D-230): the group at `at` of their order, asked `tries` times so
 * far, with the roles each group before it was given.
 */
export type MemoryCursor = {
  readonly tries: number
  readonly at: number
  readonly given: ReadonlyMap<InstructionGroup, readonly string[]>
}

/**
 * Where a stage is inside itself (D-230):
 * - `start`: just entered; a stage with one effect waits here for its answer.
 * - `ask`: one question is out, asked `tries` times so far (choiceAnswer).
 * - `history`: the history question is out, asked `tries` times so far, with the sessions listed for the scan.
 * - `review`: the review question about `planned` is out, asked `tries` times so far.
 * - `launch-dir`: the launcher folder question is out, asked `tries` times so far.
 * - `launch-check`: the check of the folder `path`, typed as `answer` at try `tries`, is out.
 * - `back`: the review goes back to the stage `to` (D-204); nextStage enters it.
 * - `mode`, `all`, `each`: a question asked once for every role or per role, asked `tries` times so far: the mode
 *   question, the question for all roles, or the question of the role at `index`, with the roles answered before it.
 * - `roles`: the roles question about `roles` with their scan `changes` is out, asked `tries` times so far, in the
 *   `rounds`-th proposal of the roles stage.
 * - `adjust`: the Adjust question is out for the `round`-th time, with the roles as adjusted so far, in proposal
 *   `rounds`.
 * - `describe`: the describe question is out, asked `tries` times so far, after proposal `rounds`.
 * - `describe-model`: the model call for the described structure is out, after proposal `rounds`.
 * - `assign`: the question on which roles get the server or skill group at `index` is out, asked `tries` times so
 *   far, with the names the questions before it gave (`done`).
 * - `skills-model`, `skills-handout`, `skills-whole`: the own skills after those questions: the model call that
 *   recommends roles for them, their hand-out at `cursor`, or the question for the whole group, asked `tries` times.
 * - `content`: the content consent is out, asked `tries` times so far, with what init found of the repo by name.
 * - `instruction-read`: the read of the instruction files is out.
 * - `topics`, `parts`: the model calls on `scan` are out: the grouping into topics, then the recommendation.
 * - `parts-handout`: the hand-out of the topics and memories at `cursor`, with what the read and the model gave.
 * - `memory`: the instruction group questions at `cursor`; the hand-out ends as `keep` (whole, or the one it had).
 * - `hunk-read`: the read of the next config file the hunks change is out, with what the configs read before it gave.
 * - `hunk`: the question of the next hunk is out, asked `tries` times so far, with the configs read and the hunks
 *   answered before it.
 * - `applying`: the review was confirmed, and Confirm's apply is out.
 * - `done`: the stage finished; nextStage enters the stage after it.
 * - `cancelled`: the stage ends init with nothing written, and `reason` says why (A1).
 * - `end`: the run ends with `reply`.
 * - `failed`: the stage got an answer it cannot take; nextStage cancels init (fail closed).
 */
export type StageSub =
  | { readonly kind: 'start' }
  | { readonly kind: 'ask'; readonly tries: number }
  | { readonly kind: 'history'; readonly tries: number; readonly listing: SessionListing }
  | { readonly kind: 'review'; readonly tries: number; readonly planned: PlanResult }
  | { readonly kind: 'launch-dir'; readonly tries: number }
  | { readonly kind: 'launch-check'; readonly tries: number; readonly answer: string; readonly path: string }
  | { readonly kind: 'back'; readonly to: InitStage }
  | { readonly kind: 'mode'; readonly tries: number }
  | { readonly kind: 'all'; readonly tries: number }
  | { readonly kind: 'each'; readonly tries: number; readonly index: number; readonly done: readonly RoleSpec[] }
  | {
      readonly kind: 'roles'
      readonly tries: number
      readonly rounds: number
      readonly roles: readonly RoleSpec[]
      readonly changes: readonly RoleChange[]
    }
  | {
      readonly kind: 'adjust'
      readonly rounds: number
      readonly round: number
      readonly roles: readonly RoleSpec[]
      readonly changes: readonly RoleChange[]
    }
  | { readonly kind: 'describe'; readonly rounds: number; readonly tries: number }
  | { readonly kind: 'describe-model'; readonly rounds: number }
  | {
      readonly kind: 'assign'
      readonly tries: number
      readonly index: number
      readonly done: readonly NameAssignment[]
    }
  | { readonly kind: 'skills-model'; readonly done: readonly NameAssignment[] }
  | { readonly kind: 'skills-handout'; readonly cursor: HandoutCursor; readonly done: readonly NameAssignment[] }
  | { readonly kind: 'skills-whole'; readonly tries: number; readonly done: readonly NameAssignment[] }
  | { readonly kind: 'content'; readonly tries: number; readonly repo: RepoNames }
  | { readonly kind: 'instruction-read' }
  | { readonly kind: 'topics'; readonly scan: InstructionScan }
  | { readonly kind: 'parts'; readonly scan: InstructionScan; readonly topics: readonly InstructionTopic[] }
  | {
      readonly kind: 'parts-handout'
      readonly cursor: HandoutCursor
      readonly scan: InstructionScan
      readonly topics: readonly InstructionTopic[]
      readonly recommended: ReadonlyMap<string, readonly string[]>
    }
  | { readonly kind: 'memory'; readonly cursor: MemoryCursor; readonly keep: InstructionHandout }
  | { readonly kind: 'hunk-read'; readonly reads: readonly PortRead[] }
  | {
      readonly kind: 'hunk'
      readonly tries: number
      readonly reads: readonly PortRead[]
      readonly done: readonly HunkOp[]
    }
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
  /** Where a go-back from the review goes once it is done; null outside a go-back (D-204). */
  readonly returnTo: 'review' | null
  /** The stage whose finish ends a go-back and jumps back to returnTo: the item's own stage, or the last role step. */
  readonly returnAfter: InitStage | null
  /** How many review rounds ended in a go-back so far. */
  readonly rounds: number
  /** The own-skills, topics and parts model results a review go-back reuses (D-235); null until the first one. */
  readonly kept: Kept | null
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

/**
 * The review goes back to `stage` (D-204): nextStage enters it, and once `after` is done it enters the review again,
 * counting a round.
 */
export function stageBack(state: InitState, stage: InitStage, after: InitStage): InitState {
  return { ...state, sub: { kind: 'back', to: stage }, returnTo: 'review', returnAfter: after }
}

/** The run ends with `reply`. */
export function stageEnded(state: InitState, reply: string): InitState {
  return { ...state, sub: { kind: 'end', reply } }
}

/** The stage got an answer it cannot take, or lacks a draft field it needs: nextStage cancels init (fail closed). */
export function stageFailed(state: InitState): InitState {
  return { ...state, sub: { kind: 'failed' } }
}

/** The kept model results a stage may reuse (D-235): only on a re-entry from a review go-back, else none. */
export function reusable(state: InitState): Kept | null {
  return state.returnTo === 'review' ? state.kept : null
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
