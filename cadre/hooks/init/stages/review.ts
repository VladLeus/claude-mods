/**
 * The review stage of init (D-43, D-105, D-133, D-136, D-230, A1, A2, A3), a layer 10 module: the review question with
 * its context line of the plan, the git policy and the launcher start, and its typed-item hint; its buttons and words
 * (parseReviewItem); the review block the side pane shows before it (reviewLines: the roles, each scope card, the
 * plan, the policy and start, the instructions per role, the private files and the improver line); and reviewStage,
 * the pure stage that has the draft planned, shows it, asks, goes back to one item through the legacy go-back until
 * Confirm, and then replies with the plan on a --dry-run or has it applied. Pure: it gives states and never performs an
 * effect, imports apply, core, generate, plan, roles, scan, scope, team, ui, init/draft, init/flow, init/initapply,
 * init/initplan, init/replies, init/state and the launch and policy stages, and never imports init/machine or
 * init/run.
 */
import type { CompiledScope, GitPolicy, LaunchStart, Plan, RoleSpec } from '../../../types'
import { setupAfterInstalls } from '../../apply/installs'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { countedNoun, reportText } from '../../core/text'
import { builtClaudeMdPath } from '../../generate/launcher'
import { planSummary, renderPlan } from '../../plan/text'
import { CLAUDE_MD_PLUGIN } from '../../roles/infra'
import { scanWarnings } from '../../scan/gather'
import { scopeCardLines } from '../../scope/card'
import { MEMORY_PATTERN } from '../../scope/lint'
import { scopesFor } from '../../team'
import { ASK_HEADERS, choiceAnswer, contextText, quotedLabels } from '../../ui/ask'
import type { ChoiceAsk, StepResult } from '../../ui/ask'
import { instructionReviewLines } from '../../ui/blocks/instructions'
import { scanWarningLines } from '../../ui/blocks/scan'
import type { Draft, PlanResult, Reviewed } from '../draft'
import { initReplyText } from '../initapply'
import { privatesOf, repoPartsOf, withRepoRecords } from '../initplan'
import type { PlanStepInput } from '../initplan'
import { IGNORE_ALL_NOTE } from '../replies'
import { fullDraft, stageBack, stageCancelled, stageEnded, stageFailed, withEffect, withOutputs } from '../state'
import type { Answer, Applied, InitState, ReviewItem, StageDef } from '../state'
import { launchLine } from './launch'
import { policyLine } from './policy'

/** The scope card lines of every role in role order (scopeCardLines); a role with no scope has none (ROLE-06). */
export function cardLines(roles: readonly RoleSpec[], scopes: ReadonlyMap<string, CompiledScope>): string[] {
  return roles.flatMap(role => {
    const scope = scopes.get(role.id)

    return scope === undefined ? [] : scopeCardLines(scope.card)
  })
}

/**
 * The first line of the final review question (D-43, D-134): the person confirms the plan the side pane shows, or goes
 * back to change one item. reviewQuestion gives the whole question text.
 */
export const REVIEW_QUESTION =
  'Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.'

/**
 * The last line of the review question (D-134): how to change an item that has no button of its own, by typing its
 * word under "Other". It is part of the question itself, which every surface draws, so the dialog never depends on the
 * pane for it. This reverses 02-13 user decision 2, which kept the question text unchanged and put the hint under the
 * review summary instead.
 */
export const REVIEW_TYPE_HINT = 'Use a button, or type duration, model, assignments, memory, env or hunks under Other.'

/**
 * The review question as the dialog shows it (D-134): REVIEW_QUESTION, then the context line on its own line when there
 * is one, and REVIEW_TYPE_HINT on the last line, so the text always ends with the typed-item hint.
 */
export function reviewQuestion(context: string | null): string {
  if (context === null) return `${REVIEW_QUESTION}\n${REVIEW_TYPE_HINT}`

  return `${REVIEW_QUESTION}\n${context}\n${REVIEW_TYPE_HINT}`
}

/**
 * The context line of the review question (G-02-1, D-136): the summary line of the plan the side pane shows
 * (planSummary), the git policy line and where the launchers start, so the question reads on its own.
 */
export function reviewContextLine(plan: Plan, policy: GitPolicy, start: LaunchStart): string {
  return `${planSummary(plan)}; ${policyLine(policy)}; ${launchLine(start)}`
}

/** Each review button with what it picks, in the order the dialog shows them (D-43, A2). */
const REVIEW_CHOICES: readonly Labelled<ReviewItem>[] = Object.freeze([
  { label: 'Confirm', value: 'confirm' },
  { label: 'Change roles', value: 'roles' },
  { label: 'Change git policy', value: 'policy' },
  { label: 'Change launcher start', value: 'launch' },
])

/** The review buttons: Confirm first, then the three items that have a button of their own (D-43, A2). */
export const REVIEW_OPTIONS: readonly string[] = Object.freeze(REVIEW_CHOICES.map(entry => entry.label))

/** Each item word a person may type under "Other", with the item it goes back to; mcp and skills mean assignments. */
const REVIEW_WORDS: readonly Labelled<ReviewItem>[] = Object.freeze([
  { label: 'roles', value: 'roles' },
  { label: 'git policy', value: 'policy' },
  { label: 'launcher start', value: 'launch' },
  { label: 'duration', value: 'duration' },
  { label: 'model', value: 'model' },
  { label: 'assignments', value: 'assignments' },
  { label: 'mcp', value: 'assignments' },
  { label: 'skills', value: 'assignments' },
  { label: 'memory', value: 'memory' },
  { label: 'env', value: 'env' },
  { label: 'hunks', value: 'hunks' },
])

/**
 * The item an answer to the review question picks, else null, so it is asked again: a button label or an item word,
 * trimmed and in any case (D-43). Any other answer, a sentence around a word included, is no choice.
 */
export function parseReviewItem(answer: string): ReviewItem | null {
  return labelled(REVIEW_CHOICES, answer) ?? labelled(REVIEW_WORDS, answer)
}

/**
 * The most times the review question is asked, so no plan is taken unconfirmed (A1). A go-back picked at the last one
 * cancels at once, asking nothing more, so no answer is asked for and then thrown away (A3).
 */
export const MAX_REVIEW_ROUNDS = 10

/** Why init cancels when the review question is dismissed (A1, D-45); unread answers give NO_USABLE_ANSWER_REASON. */
export const REVIEW_DISMISSED_REASON = 'The review question was dismissed or not answered.'

/** What the review question takes, as its refusal lists it: a button or an item word (D-43, D-136). */
const REVIEW_ACCEPTS = `${quotedLabels(REVIEW_OPTIONS)}, or duration, model, assignments, memory, env, hunks`

/** Why init cancels once the review question was asked MAX_REVIEW_ROUNDS times without Confirm (A1). */
export const REVIEW_ROUNDS_REASON =
  `The review question was asked ${MAX_REVIEW_ROUNDS} times without "Confirm": nothing was chosen.`

/**
 * The review row under a role given at least one memory (G-02-1f, T-02-73): its memories are linked read-only, as far
 * as the deny of its settings reaches (linkedMemoryDeny).
 */
export const LINKED_MEMORIES_ROW =
  '    memories are linked read-only (best effort: Edit and Write are denied; a Bash write is not blocked)'

/**
 * The review row of a role's private files (02-GAPS-B3 S4), in the scope card's memory folder form, so a dry run needs
 * no git.
 */
export function privateFilesRow(id: string): string {
  return (
    `    private files: ${MEMORY_PATTERN}${id}/instructions/CLAUDE.md and instructions.json ` +
    '(outside the repo, never committed)'
  )
}

/** The heading of the private-files rows outside the parts flow and in the --dry-run reply (02-GAPS-B3 S4). */
export const PRIVATE_FILES_HEADING = 'Private files per role (written after Confirm):'

/**
 * The line that announces the improver pass (02-GAPS-B3 S4): at most this many built files, since the git check and
 * the record compare run after Confirm.
 */
export function improverRunLine(count: number): string {
  const files = countedNoun(count, 'built file', 'built files')

  return (
    `After Confirm, claude-md-improver runs on up to ${files} (claude -p, acceptEdits, up to 5 minutes each); ` +
    'you accept or keep each change.'
  )
}

/**
 * How many built files the improver may run on after Confirm (02-GAPS-B3 S4): each `.cadre/<id>/CLAUDE.md` the plan
 * creates or changes for a role given a repo part (repoPartsOf), and each role given a global part (privatesOf), whose
 * private text file holds it.
 */
export function improverRunCount(draft: Draft, plan: Plan): number {
  const withParts = Array.from(repoPartsOf(draft.instructions)).filter(([, parts]) => parts.length > 0)
  const built = new Set(withParts.map(([id]) => builtClaudeMdPath(id)))
  const repoFiles = plan.ops.filter(op => (op.kind === 'create' || op.kind === 'change') && built.has(op.path))
  const privateFiles = privatesOf(draft.instructions, draft.roles).filter(role => role.parts.length > 0)

  return repoFiles.length + privateFiles.length
}

/**
 * The review rows of the instruction parts (G-02-1f): per role the topics and memories it was given, and the topics
 * and memories kept with the root session only (instructionReviewLines, which gives its heading, then one row per
 * role in role order, then the kept row), with LINKED_MEMORIES_ROW right under the row of each role given at least
 * one memory and the role's privateFilesRow under that (its rowsAfter, 02-GAPS-B3 N3, S4); for the parts flow only,
 * none for the whole-file questions or none.
 */
function handoutLines(draft: Draft): string[] {
  const handout = draft.instructions
  if (handout.kind !== 'parts') return []
  const { given } = handout
  const { memories } = handout.scan
  const hasMemory = (id: string): boolean => memories.some(memory => given.get(memory.id)?.includes(id) === true)
  const rowsAfter = (id: string): string[] => [...(hasMemory(id) ? [LINKED_MEMORIES_ROW] : []), privateFilesRow(id)]

  return instructionReviewLines(draft.roles, handout.topics, memories, given, rowsAfter)
}

/**
 * The summary the review shows before its question (D-43 as amended by D-134), in this order: the role titles and
 * ids, every scope card, for the instruction parts flow the topics per role with each role's private files
 * (handoutLines, G-02-1f), for the other flows PRIVATE_FILES_HEADING and the private-files row of each role
 * (privateFilesRow, 02-GAPS-B3 S4), the file plan with its hunks, its warnings and the `.gitignore` block rows as
 * renderPlan prints them (so none is printed twice), the git policy line, the launcher-start line, IGNORE_ALL_NOTE when
 * the policy is `ignore`, so both items with a review button of their own can be checked before Confirm, then the scan
 * warnings of the run, kept for this review, the plugins Confirm installs when the person answered Install for any (the
 * security plugins, decision #39, and claude-md-management, D-141), each key cleaned and capped as a report cell is
 * (decision #69 B7), and last, when claude-md-management is installed or answered Install and the improver has a
 * built file to run on, improverRunLine (improverRunCount, 02-GAPS-B3 S4).
 */
function reviewLines(draft: Draft, scopes: ReadonlyMap<string, CompiledScope>, plan: Plan): string[] {
  const keys = draft.pluginInstalls.map(reportText).join(', ')
  const installLine = `Plugins to install after Confirm (a --dry-run installs nothing): ${keys}`
  const rows = draft.roles.map(role => privateFilesRow(role.id))
  const privateRows = draft.instructions.kind === 'parts' ? [] : [PRIVATE_FILES_HEADING, ...rows]
  const count = improverRunCount(draft, plan)
  const installed = setupAfterInstalls(draft.gathered.setup, draft.pluginInstalls).installedPlugins
  const improver = installed.includes(CLAUDE_MD_PLUGIN) && count > 0 ? [improverRunLine(count)] : []

  return [
    'Roles:',
    ...draft.roles.map(role => `  ${role.title} (${role.id})`),
    ...cardLines(draft.roles, scopes),
    ...handoutLines(draft),
    ...privateRows,
    ...renderPlan(plan),
    policyLine(draft.policy),
    launchLine(draft.launchStart),
    ...(draft.policy === 'ignore' ? [IGNORE_ALL_NOTE] : []),
    ...scanWarningLines(scanWarnings(draft.locations, draft.gathered)),
    ...(draft.pluginInstalls.length === 0 ? [] : [installLine]),
    ...improver,
  ]
}

/**
 * What the review plans a draft with (decision #69 A4, G-02-1f): the scopes compiled with the plugins answered Install
 * counted as installed (setupAfterInstalls), so the cards and the plan show what Confirm writes when every install
 * works, and planStep's input, with each role's repo parts (repoPartsOf) recorded in each parts-flow role's role.json
 * (withRepoRecords, G-02-1f Regen).
 */
function reviewPlanOf(draft: Draft): {
  readonly scopes: ReadonlyMap<string, CompiledScope>
  readonly input: PlanStepInput
} {
  const setup = setupAfterInstalls(draft.gathered.setup, draft.pluginInstalls)
  const gathered = { ...draft.gathered, setup }
  const scopes = scopesFor(draft.roles, draft.repoDefault, gathered, draft.hunks, draft.launchStart)
  const repoParts = repoPartsOf(draft.instructions)
  const input = {
    roles: withRepoRecords(draft.roles, draft.instructions, repoParts),
    repoDefault: draft.repoDefault,
    policy: draft.policy,
    launchStart: draft.launchStart,
    scopes,
    hunks: draft.hunks,
    repo: draft.gathered.repo,
    locations: draft.locations,
    readUserMcp: draft.readUserMcp,
    repoParts,
  }

  return { scopes, input }
}

/**
 * The review question as the stage asks it (D-43, D-136): reviewQuestion with the context line of the plan just shown,
 * cleaned as a report cell (reviewContextLine), the four buttons with the Review chip, parseReviewItem, what its
 * refusal lists, and the reason a dismissal cancels with.
 */
function reviewAsk(draft: Draft, plan: Plan): ChoiceAsk<ReviewItem> & { readonly dismissedReason: string } {
  return {
    question: reviewQuestion(contextText(reviewContextLine(plan, draft.policy, draft.launchStart))),
    spec: { options: REVIEW_OPTIONS, header: ASK_HEADERS.review },
    parse: parseReviewItem,
    accepts: REVIEW_ACCEPTS,
    dismissedReason: REVIEW_DISMISSED_REASON,
  }
}

/** The round's plan of the whole draft out, an io effect (planStep, run by init/run). */
function planning(state: InitState): InitState {
  const draft = fullDraft(state.draft)
  if (draft === null) return stageFailed(state)
  const planned: InitState = { ...state, sub: { kind: 'start' } }

  return withEffect(planned, { kind: 'io', call: { id: 'plan', input: reviewPlanOf(draft).input } })
}

/** The review question about `planned` asked, `tries` times so far; `question` is its text after a refusal. */
function reviewAsked(state: InitState, planned: PlanResult, question: string | null, tries: number): InitState {
  const draft = fullDraft(state.draft)
  if (draft === null) return stageFailed(state)
  const ask = reviewAsk(draft, planned.plan)
  const asking: InitState = { ...state, sub: { kind: 'review', tries, planned } }

  return withEffect(asking, { kind: 'ask', question: question ?? ask.question, spec: ask.spec })
}

/** After the plan: the review block in the side pane (reviewLines, D-133), then the review question about it. */
function afterPlan(state: InitState, planned: PlanResult): InitState {
  const draft = fullDraft(state.draft)
  if (draft === null) return stageFailed(state)
  const lines = reviewLines(draft, reviewPlanOf(draft).scopes, planned.plan)

  return reviewAsked(withOutputs(state, [{ kind: 'show', block: { key: 'review', lines } }]), planned, null, 1)
}

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

/**
 * Confirm (D-105): a --dry-run replies with the plan just shown (dryRunReply) and never sets the apply; plain init has
 * it applied, an io effect (applyConfirmed, run by init/run through the run's host).
 */
function confirmed(state: InitState, reviewed: Reviewed): InitState {
  if (state.dryRun) return stageEnded(state, dryRunReply(reviewed))
  const applying: InitState = { ...state, sub: { kind: 'applying' } }

  return withEffect(applying, { kind: 'io', call: { id: 'apply', reviewed } })
}

/**
 * The answer to the review question (choiceAnswer): Confirm replies with the plan just shown on a --dry-run and has it
 * applied on plain init (D-105); another item goes back to that item, except at the last round, where it cancels at
 * once with REVIEW_ROUNDS_REASON and asks none of that item's questions (A3). Change roles, the git policy and the
 * launcher start go back as stage transitions (stageBack, D-204): Change roles to the roles stage, from where every
 * role step runs again up to the improver install, and the other two to their own stage. The other items go through
 * the legacy go-back until their stages are pure. Any other answer is asked again with why on top. A dismissal cancels
 * with REVIEW_DISMISSED_REASON and MAX_ASKS answers it cannot read with NO_USABLE_ANSWER_REASON (A1, D-45).
 */
function afterReviewAnswer(state: InitState, answer: string | null): InitState {
  const draft = fullDraft(state.draft)
  if (state.sub.kind !== 'review' || draft === null) return stageFailed(state)
  const { planned } = state.sub
  const next = choiceAnswer(reviewAsk(draft, planned.plan), state.sub, answer)
  if (next.kind === 'again') return reviewAsked(state, planned, next.question, next.sub.tries)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  const item = next.value
  if (item === 'confirm') return confirmed(state, { draft, planned })
  if (state.rounds >= MAX_REVIEW_ROUNDS - 1) return stageCancelled(state, REVIEW_ROUNDS_REASON)
  if (item === 'roles') return stageBack(state, 'roles', 'improver-install')
  if (item === 'policy' || item === 'launch') return stageBack(state, item, item)
  const going: InitState = { ...state, sub: { kind: 'start' } }

  return withEffect(going, { kind: 'legacy', step: { id: 'go-back', draft, item } })
}

/** After a go-back: its new draft planned again as the next round, or the review cancelled with its reason (A1). */
function afterGoBack(state: InitState, result: StepResult<Draft>): InitState {
  if (result.kind === 'cancelled') return stageCancelled(state, result.reason)

  return planning({ ...state, draft: result.value, rounds: state.rounds + 1 })
}

/** Confirm's apply (D-105): the reply with the plan as written and what the apply did. */
function afterApply(state: InitState, result: StepResult<Applied> | null): InitState {
  if (result === null) return stageFailed(state)
  if (result.kind === 'cancelled') return stageCancelled(state, result.reason)
  const { planned, outcome } = result.value

  return stageEnded(state, initReplyText(planned.plan, planned.state.gitPolicy, planned.state.launchStart, outcome))
}

/** The answer to the effect the review has out: the plan, the review question, a go-back, or Confirm's apply. */
function reviewAnswer(state: InitState, answer: Answer): InitState {
  if (answer.kind === 'answer') return afterReviewAnswer(state, answer.text)
  if (answer.kind === 'legacy' && answer.result.id === 'go-back') return afterGoBack(state, answer.result.result)
  if (answer.kind !== 'io') return stageFailed(state)
  const { result } = answer
  if (result.id === 'plan') return afterPlan(state, result.result)
  if (result.id === 'apply') return afterApply(state, result.result)

  return stageFailed(state)
}

/**
 * The final review (D-43, D-230, A1). Each round has the whole draft planned (reviewPlanOf, planStep), shows the
 * summary in the side pane (reviewLines, D-133) and asks the review question about that plan (afterReviewAnswer).
 * Confirm takes the plan just shown, with the state it was planned with and the draft it was built from (Reviewed): a
 * --dry-run replies with it and writes nothing (D-82), plain init has it applied (D-105). A go-back re-asks that one
 * item, and the next round shows the summary again; a cancelled go-back cancels with its reason, and so does a run that
 * has asked MAX_REVIEW_ROUNDS times without Confirm (REVIEW_ROUNDS_REASON), so no plan the person did not confirm is
 * used (A1, D-45). The review itself writes nothing: Confirm is the consent apply writes the plan on (D-105).
 */
export const reviewStage: StageDef = Object.freeze({
  enter: planning,
  answer: reviewAnswer,
})
