/**
 * The review stage of init (D-43, D-105, D-133, D-136, D-230, D-233, A1, A2, A3), a layer 10 module: the review
 * question with its context line of the plan, the git policy and the launcher start, and its typed-item hint, asked
 * page by page on every surface; its options and words (parseReviewItem); the review block the side pane shows before
 * it (reviewLines: the roles, each scope card, the plan, the policy and start, the instructions per role, the private
 * files and the improver line); and reviewStage, the pure stage that has the draft planned, shows it, asks, goes back
 * to one item's stage until Confirm, and then replies with the plan on a --dry-run or has it applied. Pure: it gives
 * states and never performs an effect, imports apply, core, generate, plan, roles, scan, scope, team, ui, init/draft,
 * init/initapply, init/initplan, init/replies, init/state and the launch and policy stages, and never imports
 * init/machine or init/run.
 */
import type { CompiledScope, GitPolicy, LaunchStart, Plan, RoleSpec } from '../../../types'
import { setupAfterInstalls } from '../../apply/installs'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { redactedText } from '../../core/redact'
import { clean, reportText } from '../../core/text'
import type { ListWords } from '../../core/text'
import { builtClaudeMdPath } from '../../generate/launcher'
import { t, tn } from '../../locales/t'
import { planSummary, renderPlan } from '../../plan/text'
import { CLAUDE_MD_PLUGIN } from '../../roles/infra'
import { recommend } from '../../roles/recommend'
import { scanWarnings } from '../../scan/gather'
import { scopeCardLines } from '../../scope/card'
import { MEMORY_PATTERN } from '../../scope/lint'
import { resolvedFramework, scopesFor } from '../../team'
import { ASK_HEADERS, choiceAnswer, contextText, orList, quotedLabels, refusalLine, withContext } from '../../ui/ask'
import type { ChoiceAsk, StepResult } from '../../ui/ask'
import { reviewContext } from '../../ui/blocks/context'
import { instructionReviewLines } from '../../ui/blocks/instructions'
import { recommendationLines } from '../../ui/blocks/recommendations'
import { scanWarningLines } from '../../ui/blocks/scan'
import { UNCUT, wrapLine } from '../../ui/pane'
import { NEXT_PAGE_LABEL, PREVIOUS_PAGE_LABEL } from '../../ui/paging'
import type { Draft, PlanResult, Reviewed } from '../draft'
import { initReplyText } from '../initapply'
import { privatesOf, repoPartsOf, withRepoRecords } from '../initplan'
import type { PlanStepInput } from '../initplan'
import { IGNORE_ALL_NOTE } from '../replies'
import { fullDraft, stageBack, stageCancelled, stageEnded, stageFailed, withEffect } from '../state'
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
export const REVIEW_QUESTION = t('init.review.reviewQuestion')

/** The item words of the review items that had buttons of their own (D-233): roles, git policy, launcher start. */
const BUTTON_ITEM_WORDS: readonly Labelled<ReviewItem>[] = Object.freeze([
  { label: 'roles', value: 'roles' },
  { label: 'git policy', value: 'policy' },
  { label: 'launcher start', value: 'launch' },
])

/** The item words of the review items with no button, typed under "Other" or in a note (D-134, D-233). */
const TYPED_ITEM_WORDS: readonly Labelled<ReviewItem>[] = Object.freeze([
  { label: 'duration', value: 'duration' },
  { label: 'model', value: 'model' },
  { label: 'assignments', value: 'assignments' },
  { label: 'memory', value: 'memory' },
  { label: 'env', value: 'env' },
  { label: 'hunks', value: 'hunks' },
])

/** The words that mean assignments too: mcp and skills (D-233). */
const ALIAS_ITEM_WORDS: readonly Labelled<ReviewItem>[] = Object.freeze([
  { label: 'mcp', value: 'assignments' },
  { label: 'skills', value: 'assignments' },
])

/** The labels of the former Change buttons, which still read as their items (D-233). */
const FORMER_LABEL_WORDS: readonly Labelled<ReviewItem>[] = Object.freeze([
  { label: 'Change roles', value: 'roles' },
  { label: 'Change git policy', value: 'policy' },
  { label: 'Change launcher start', value: 'launch' },
])

/**
 * The last line of the review question (D-134): how to change an item that has no button of its own, by typing its
 * word under "Other". It is part of the question itself, which every surface draws, so the dialog never depends on the
 * pane for it. This reverses 02-13 user decision 2, which kept the question text unchanged and put the hint under the
 * review summary instead. Its words are TYPED_ITEM_WORDS, the tokens parseReviewItem reads (D-225).
 */
export const REVIEW_TYPE_HINT = t('init.review.reviewTypeHint', {
  words: orList(TYPED_ITEM_WORDS.map(entry => entry.label)),
})

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
  return t('init.review.reviewContextLine', {
    planSummary: planSummary(plan),
    policy: policyLine(policy),
    launch: launchLine(start),
  })
}

/** What an option of a page of the paged review stands for (D-233): an item, a page move, or Change something…. */
type PageOption = ReviewItem | 'next' | 'previous' | 'change'

/** What an answer to a page of the paged review picks (D-233): an item, or a move to the next or previous page. */
type ReviewChoice = Exclude<PageOption, 'change'>

/** The one answer that confirms the paged review: its Confirm option, as the dialog gives it (T-02.1-78). */
const CONFIRM_LABEL = t('init.review.confirm')

/** The label of the review's typed choice (D-233, ASKED #4): the item to change is named in a note. */
export const CHANGE_SOMETHING_LABEL = t('init.review.changeSomething')

/**
 * The review's own options on every surface (D-233, ASKED #4, #19, #23), in the order a page shows them, one label
 * table for labelled(): Next page while a later page exists, Previous page past the first, Confirm, and one typed
 * choice whose item word goes in a note.
 */
const REVIEW_PAGE_CHOICES: readonly Labelled<PageOption>[] = Object.freeze([
  { label: NEXT_PAGE_LABEL, value: 'next' },
  { label: PREVIOUS_PAGE_LABEL, value: 'previous' },
  { label: CONFIRM_LABEL, value: 'confirm' },
  { label: CHANGE_SOMETHING_LABEL, value: 'change' },
])

/** The item words of the paged review as its refusals list them, after the page's options (D-233). */
const REVIEW_ITEM_WORDS = t('init.review.itemWords', {
  buttonWords: BUTTON_ITEM_WORDS.map(entry => entry.label).join(', '),
  typedWords: TYPED_ITEM_WORDS.map(entry => entry.label).join(', '),
})

/**
 * The first line of the paged review asked again after Change something… with no item named (ASKED #4, DECIDED #22):
 * where the item goes and the item words.
 */
const CHANGE_REFUSAL = t('init.review.changeRefusal', {
  words: orList([...BUTTON_ITEM_WORDS, ...TYPED_ITEM_WORDS].map(entry => entry.label)),
})

/**
 * Every option a page of the review may show, in their order (D-233, ASKED #23): Next page, Previous page, Confirm and
 * Change something…, on every surface; the former Confirm / Change roles / Change git policy / Change launcher start
 * buttons are shown on none.
 */
export const REVIEW_OPTIONS: readonly string[] = Object.freeze(REVIEW_PAGE_CHOICES.map(entry => entry.label))

/**
 * The review option that ends it, Confirm, offered on every page (pageChoices), whose pick stands over any typed note
 * (D-350).
 */
const REVIEW_ENDING: readonly string[] = Object.freeze([CONFIRM_LABEL])

/**
 * Each item word a person may type, under "Other" or in a note, with the item it goes back to; mcp and skills mean
 * assignments, and the labels of the former buttons still read as their items (D-233).
 */
const REVIEW_WORDS: readonly Labelled<ReviewItem>[] = Object.freeze([
  ...BUTTON_ITEM_WORDS,
  ...TYPED_ITEM_WORDS,
  ...ALIAS_ITEM_WORDS,
  ...FORMER_LABEL_WORDS,
])

/**
 * The item an answer to the review question picks, else null, so it is asked again: Confirm only as its option gives
 * it, exactly (T-02.1-78), so a typed confirm in any case is no choice, or an item word, trimmed and in any case (D-43,
 * D-233). Any other answer, a sentence around a word included, is no choice.
 */
export function parseReviewItem(answer: string): ReviewItem | null {
  if (answer === CONFIRM_LABEL) return 'confirm'

  return labelled(REVIEW_WORDS, answer)
}

/**
 * The most times the review question is asked, so no plan is taken unconfirmed (A1). A go-back picked at the last one
 * cancels at once, asking nothing more, so no answer is asked for and then thrown away (A3).
 */
export const MAX_REVIEW_ROUNDS = 10

/**
 * The review lines in pages of at most `rows - 1` rows each (D-233, D-261), the page title on the row left: whole
 * lines in order, each counting the rows it wraps to at `columns` (wrapLine of the cleaned line, as the TUI preview
 * and the pane draw it), one row each with no columns; a line that does not fit the rows a page has left starts the
 * next page, and a line taller than a whole page gets a page of its own, uncut. On a pane surface the caller gives
 * `maxChars` (N-04): a line longer than it is first cut into consecutive lines of at most `maxChars` code points, and a
 * line starts the next page when the page's code points, its cleaned lines summed, and its own would pass `maxChars`;
 * with none given no line is cut and pages hold any number of code points, as before. One page at least.
 */
export function reviewPages(
  lines: readonly string[],
  rows: number,
  columns: number | null,
  maxChars = Number.POSITIVE_INFINITY,
): (readonly string[])[] {
  const size = Math.max(1, rows - 1)
  const width = Math.max(1, maxChars)
  const cut = lines.flatMap(line => {
    const points = Array.from(clean(line, UNCUT))
    if (points.length <= width) return [line]

    return Array.from({ length: Math.ceil(points.length / width) }, (_, at) =>
      points.slice(at * width, (at + 1) * width).join(''),
    )
  })
  const pages: (readonly string[])[] = []
  let page: string[] = []
  let used = 0
  let chars = 0
  for (const line of cut) {
    const cleaned = clean(line, UNCUT)
    const cost = columns === null ? 1 : wrapLine(cleaned, columns).length
    const length = Array.from(cleaned).length
    if (page.length > 0 && (used + cost > size || chars + length > width)) {
      pages.push(page)
      page = []
      used = 0
      chars = 0
    }
    page.push(line)
    used += cost
    chars += length
  }
  pages.push(page)

  return pages
}

/**
 * The options of page `page` of `count` (D-233, ASKED #4, #23): Next page while a later page exists, Previous page past
 * the first, Confirm and Change something…; a review of one page offers Confirm and Change something… only.
 */
function pageChoices(page: number, count: number): Labelled<PageOption>[] {
  return REVIEW_PAGE_CHOICES.filter(({ value }) => {
    if (value === 'next') return page < count - 1
    if (value === 'previous') return page > 0

    return true
  })
}

/**
 * What an answer to a page of the review picks (D-233, T-02.1-78), else null, so it is asked again: a move to the next
 * or previous page the page offers, or an item as parseReviewItem reads it, Confirm only as its own option gives it.
 * Change something… with no item is no choice.
 */
function pageChoice(choices: readonly Labelled<PageOption>[], answer: string): ReviewChoice | null {
  const choice = labelled(choices, answer)
  if (choice === 'next' || choice === 'previous') return choice
  if (choice === 'change') return null

  return parseReviewItem(answer)
}

/** Why init cancels when the review question is dismissed (A1, D-45); unread answers give NO_USABLE_ANSWER_REASON. */
export const REVIEW_DISMISSED_REASON = t('init.review.reviewDismissedReason')

/** Why init cancels once the review question was asked MAX_REVIEW_ROUNDS times without Confirm (A1). */
export const REVIEW_ROUNDS_REASON =
  t('init.review.reviewRoundsReason', { maxReviewRounds: MAX_REVIEW_ROUNDS })

/**
 * The review row under a role given at least one memory (G-02-1f, T-02-73): its memories are linked read-only, as far
 * as the deny of its settings reaches (linkedMemoryDeny).
 */
export const LINKED_MEMORIES_ROW = t('init.review.linkedMemoriesRow')

/**
 * The review row of a role's private files (02-GAPS-B3 S4), in the scope card's memory folder form, so a dry run needs
 * no git.
 */
export function privateFilesRow(id: string): string {
  return (
    t('init.review.privateFilesRow', {
      memoryPattern: MEMORY_PATTERN,
      id,
    })
  )
}

/** The heading of the private-files rows outside the parts flow and in the --dry-run reply (02-GAPS-B3 S4). */
export const PRIVATE_FILES_HEADING = t('init.review.privateFilesHeading')

/**
 * The line that announces the improver pass (02-GAPS-B3 S4): at most this many built files, since the git check and
 * the record compare run after Confirm.
 */
export function improverRunLine(count: number): string {
  return tn('init.review.improverRun', count, { count })
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
 * one memory and the role's privateFilesRow under that (its rowsAfter, 02-GAPS-B3 N3, S4), the topic titles as
 * `words` allows them (D-256, D-283); for the parts flow only, none for the whole-file questions or none.
 */
function handoutLines(draft: Draft, words: ListWords): string[] {
  const handout = draft.instructions
  if (handout.kind !== 'parts') return []
  const { given } = handout
  const { memories } = handout.scan
  const hasMemory = (id: string): boolean => memories.some(memory => given.get(memory.id)?.includes(id) === true)
  const rowsAfter = (id: string): string[] => [...(hasMemory(id) ? [LINKED_MEMORIES_ROW] : []), privateFilesRow(id)]

  return instructionReviewLines(draft.roles, handout.topics, memories, given, words, rowsAfter)
}

/**
 * The summary the review shows before its question (D-43 as amended by D-134), in this order: the role titles and
 * ids, every scope card, for the instruction parts flow the topics per role with each role's private files
 * (handoutLines, G-02-1f), for the other flows PRIVATE_FILES_HEADING and the private-files row of each role
 * (privateFilesRow, 02-GAPS-B3 S4), the file plan with its hunks, its warnings and the `.gitignore` block rows as
 * renderPlan prints them (so none is printed twice), the git policy line, the launcher-start line, IGNORE_ALL_NOTE when
 * the policy is `ignore`, so both items with a review button of their own can be checked before Confirm, then the scan
 * warnings of the run, kept for this review, then the recommendations for the team as the security stage shows them
 * (recommend over the roles, their resolved frameworks and the scans before any install; recommendationLines,
 * ROLE-03), so every surface shows them, paged, before Confirm (WD-M2), then the plugins Confirm installs when the
 * person answered Install for any (the security plugins, decision #39, and claude-md-management, D-141), each key
 * cleaned and capped as a report cell is (decision #69 B7), and last, when claude-md-management is installed or
 * answered Install and the improver has a built file to run on, improverRunLine (improverRunCount, 02-GAPS-B3 S4).
 * Every line has its secret-like spans hidden (redactedText, E1, #163), so the review block and each page of its
 * context show none; its lists are capped by `words` (D-256).
 */
function reviewLines(
  draft: Draft,
  scopes: ReadonlyMap<string, CompiledScope>,
  plan: Plan,
  words: ListWords,
): string[] {
  const keys = draft.pluginInstalls.map(reportText).join(', ')
  const installLine = t('init.review.reviewLines', { keys })
  const rows = draft.roles.map(role => privateFilesRow(role.id))
  const privateRows = draft.instructions.kind === 'parts' ? [] : [PRIVATE_FILES_HEADING, ...rows]
  const count = improverRunCount(draft, plan)
  const installed = setupAfterInstalls(draft.gathered.setup, draft.pluginInstalls).installedPlugins
  const improver = installed.includes(CLAUDE_MD_PLUGIN) && count > 0 ? [improverRunLine(count)] : []
  const frameworks = draft.roles.map(role => resolvedFramework(role, draft.repoDefault))
  const { repo, setup } = draft.gathered
  const recommendations = recommend({ roles: draft.roles, frameworks, scan: repo, setup })

  return [
    t('init.review.rolesHeading'),
    ...draft.roles.map(role => t('init.review.roleRow', { title: redactedText(role.title), id: role.id })),
    ...cardLines(draft.roles, scopes),
    ...handoutLines(draft, words),
    ...privateRows,
    ...renderPlan(plan),
    policyLine(draft.policy),
    launchLine(draft.launchStart),
    ...(draft.policy === 'ignore' ? [IGNORE_ALL_NOTE] : []),
    ...scanWarningLines(scanWarnings(draft.locations, draft.gathered)),
    ...recommendationLines(recommendations, draft.roles),
    ...(draft.pluginInstalls.length === 0 ? [] : [installLine]),
    ...improver,
  ].map(line => redactedText(line))
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
 * Page `page` of the review as the stage asks it on every surface (D-233, ASKED #4, #19, #23, D-234), its lines paged
 * to `rows` wrapped rows at `columns` (reviewPages, D-261): the review question with the context line of the plan just
 * shown, the page's options (pageChoices) with the Review chip, and the page as its own context, titled with its place
 * when there is more than one page (`Review (page i of n)`, DECIDED #22), its summary counting the files of the plan
 * and the roles; no typed answer is offered, since Change something… takes the item in a note (#164, takesNote, D-270);
 * a picked Confirm stands over any note (endingLabels, D-350).
 * A pane surface
 * asks REVIEW_QUESTION with that summary under it, and when there is more than one page the page's place, which the
 * Review chip does not carry, last (D-310). Its lists are capped by `words` (D-256). An answer pageChoice cannot read
 * is asked again on the same page with refusalLine on top, or CHANGE_REFUSAL after Change something….
 */
function pagedAsk(
  draft: Draft,
  plan: Plan,
  page: number,
  rows: number,
  columns: number | null,
  words: ListWords,
  maxChars: number,
): ChoiceAsk<ReviewChoice> & { readonly dismissedReason: string } {
  const pages = reviewPages(reviewLines(draft, reviewPlanOf(draft).scopes, plan, words), rows, columns, maxChars)
  const at = Math.min(Math.max(0, page), pages.length - 1)
  const choices = pageChoices(at, pages.length)
  const labels = choices.map(choice => choice.label)
  const title =
    pages.length === 1 ? t('init.review.title') : t('init.review.pagedTitle', { number: at + 1, count: pages.length })
  const accepts = `${quotedLabels(labels)}, ${REVIEW_ITEM_WORDS}`
  const question = reviewQuestion(contextText(reviewContextLine(plan, draft.policy, draft.launchStart)))
  const files = plan.ops.filter(op => op.kind !== 'hunk').length
  const context = { ...reviewContext(pages[at] ?? [], files, draft.roles.length), title }
  const summarised = withContext(REVIEW_QUESTION, context.summary)
  const text = pages.length === 1 ? summarised : `${summarised}\n${title}`

  return {
    question,
    spec: {
      options: labels,
      header: ASK_HEADERS.review,
      takesNote: true,
      endingLabels: REVIEW_ENDING,
      context: { ...context, pane: { asked: question, text } },
    },
    parse: answer => pageChoice(choices, answer),
    accepts,
    refuse: answer => (labelled(choices, answer) === 'change' ? CHANGE_REFUSAL : refusalLine(answer, accepts)),
    dismissedReason: REVIEW_DISMISSED_REASON,
  }
}

/**
 * The review ask of page `page`, paged to the rows and the code points of the state's surface module (reviewPaging,
 * D-233, ASKED #19, N-04, D-353) at the width its pages are drawn at, `state.pageColumns` (D-261, D-292): the
 * preview's on the TUI default and in a pane seated inline, the pane body's when docked or on the desktop (the
 * module's pageColumns), none when no width is known.
 */
function reviewAskOf(
  state: InitState,
  draft: Draft,
  plan: Plan,
  page: number,
): ChoiceAsk<ReviewChoice> & { readonly dismissedReason: string } {
  const { rows, maxChars } = state.surface.reviewPaging

  return pagedAsk(draft, plan, page, rows, state.pageColumns, state.surface.listWords, maxChars)
}

/** The round's plan of the whole draft out, an io effect (planStep, run by init/run). */
function planning(state: InitState): InitState {
  const draft = fullDraft(state.draft)
  if (draft === null) return stageFailed(state)
  const planned: InitState = { ...state, sub: { kind: 'start' } }

  return withEffect(planned, { kind: 'io', call: { id: 'plan', input: reviewPlanOf(draft).input } })
}

/**
 * The review question about `planned` asked on page `page`, `tries` times so far; `question` is its text after a
 * refusal (D-233).
 */
function reviewAsked(
  state: InitState,
  planned: PlanResult,
  question: string | null,
  tries: number,
  page: number,
): InitState {
  const draft = fullDraft(state.draft)
  if (draft === null) return stageFailed(state)
  const ask = reviewAskOf(state, draft, planned.plan, page)
  const asking: InitState = { ...state, sub: { kind: 'review', tries, planned, page } }

  return withEffect(asking, { kind: 'ask', question: question ?? ask.question, spec: ask.spec })
}

/**
 * After the plan: the review question about it on its first page, the pages of the review block (reviewLines, D-133)
 * its own context; no block of its own (D-302).
 */
function afterPlan(state: InitState, planned: PlanResult): InitState {
  return reviewAsked(state, planned, null, 1, 0)
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
 * The answer to the review question (choiceAnswer): a move to the next or previous page asks that page, a first try
 * again, and counts no round (D-233); Confirm replies with the plan just shown on a --dry-run and has it applied on
 * plain init (D-105); another item goes back to that item, except at the last round, where it cancels at once with
 * REVIEW_ROUNDS_REASON and asks none of that item's questions (A3). Change roles, the git policy, the launcher start,
 * the duration, the model, the env, the hunks, the assignments and the memory go back as stage transitions (stageBack,
 * D-204): Change roles to the roles stage, from where every role step runs again up to the improver install, the env
 * to the carry stage, the assignments to the assign stage, the memory to the instruction stage, which asks again what
 * it handed out, and the others to their own stage. Any other answer is asked again on the same page with why on top.
 * A dismissal cancels with REVIEW_DISMISSED_REASON and MAX_ASKS answers it cannot read with NO_USABLE_ANSWER_REASON
 * (A1, D-45).
 */
function afterReviewAnswer(state: InitState, answer: string | null): InitState {
  const draft = fullDraft(state.draft)
  if (state.sub.kind !== 'review' || draft === null) return stageFailed(state)
  const { planned, page } = state.sub
  const next = choiceAnswer(reviewAskOf(state, draft, planned.plan, page), state.sub, answer)
  if (next.kind === 'again') return reviewAsked(state, planned, next.question, next.sub.tries, page)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  const item = next.value
  if (item === 'next') return reviewAsked(state, planned, null, 1, page + 1)
  if (item === 'previous') return reviewAsked(state, planned, null, 1, page - 1)
  if (item === 'confirm') return confirmed(state, { draft, planned })
  if (state.rounds >= MAX_REVIEW_ROUNDS - 1) return stageCancelled(state, REVIEW_ROUNDS_REASON)
  if (item === 'roles') return stageBack(state, 'roles', 'improver-install')
  if (item === 'env') return stageBack(state, 'carry', 'carry')
  if (item === 'assignments') return stageBack(state, 'assign', 'assign')
  if (item === 'memory') return stageBack(state, 'instructions', 'instructions')

  return stageBack(state, item, item)
}

/** Confirm's apply (D-105): the reply with the plan as written and what the apply did. */
function afterApply(state: InitState, result: StepResult<Applied> | null): InitState {
  if (result === null) return stageFailed(state)
  if (result.kind === 'cancelled') return stageCancelled(state, result.reason)
  const { planned, outcome } = result.value

  return stageEnded(state, initReplyText(planned.plan, planned.state.gitPolicy, planned.state.launchStart, outcome))
}

/** The answer to the effect the review has out: the plan, the review question, or Confirm's apply. */
function reviewAnswer(state: InitState, answer: Answer): InitState {
  if (answer.kind === 'answer') return afterReviewAnswer(state, answer.text)
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
 * item in its stage (D-204), and the next round shows the summary again; a cancelled go-back cancels with its reason,
 * and so does a run that has asked MAX_REVIEW_ROUNDS times without Confirm (REVIEW_ROUNDS_REASON), so no plan the
 * person did not confirm is used (A1, D-45). The review itself writes nothing: Confirm is the consent apply writes the
 * plan on (D-105).
 */
export const reviewStage: StageDef = Object.freeze({
  enter: planning,
  answer: reviewAnswer,
})
