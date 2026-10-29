import type { CompiledScope, GitPolicy, HostIo, InitIo, LaunchStart, Plan, RoleSpec } from '../types'
import { CONFLICT_OPTIONS, conflictPaths, conflictQuestion, parseConflictAnswer } from './apply/conflict'
import type { ConflictChoice } from './apply/conflict'
import { hunkRuns, hunksAfterRuns } from './apply/hunks'
import type { HunkRun } from './apply/hunks'
import { builtRoleFiles } from './apply/improver'
import { noHomeInstallText, setupAfterInstalls } from './apply/installs'
import type { ApplyInput } from './apply/private'
import { appliedLines, installPlugins, privatePlanOf, writeWithImprover } from './apply/run'
import type { ApplyOutcome } from './apply/run'
import { applySteps } from './apply/steps'
import { labelled } from './core/labelled'
import type { Labelled } from './core/labelled'
import { countedNoun, reportText } from './core/text'
import { chooseFramework } from './framework/contract'
import { provenUserDir } from './framework/gsd/identity'
import { detectAll } from './framework/registry'
import { trackedParts } from './generate/gittrack'
import { builtClaudeMdPath } from './generate/launcher'
import { initGuard } from './guards/repo'
import { hasRunFailed } from './host/steps'
import type { Draft, DraftBase, PlanResult, Reviewed } from './init/draft'
import { goBack, historyHints, teamStep } from './init/flow'
import type { ReviewItem } from './init/flow'
import { planStep, privatesOf, repoPartsOf, withRepoRecords } from './init/initplan'
import { cancelledReply, IGNORE_ALL_NOTE } from './init/replies'
import { consentStep } from './init/stages/consent'
import { historyStep } from './init/stages/history'
import { launchLine, launchStartStep } from './init/stages/launch'
import { gitPolicyStep, policyLine } from './init/stages/policy'
import { installedFrameworks } from './init/stages/roles'
import { DRY_RUN_NOTE, planSummary, renderPlan } from './plan/text'
import { CLAUDE_MD_PLUGIN } from './roles/infra'
import { proposeRoles } from './roles/propose'
import { gatherScans, scanWarnings } from './scan/gather'
import { scopeCardLines } from './scope/card'
import { MEMORY_PATTERN } from './scope/lint'
import { attendedByConfig, compileAll, resolvedFramework, scopesFor } from './team'
import {
  accepted,
  ASK_HEADERS,
  askChoice,
  cancelled,
  choiceResult,
  contextText,
  quotedLabels,
  showBlock,
  withContext,
} from './ui/ask'
import type { StepResult } from './ui/ask'
import { instructionReviewLines } from './ui/blocks/instructions'
import { scanContextLine, scanSummaryLines, scanWarningLines } from './ui/blocks/scan'

/** The scope card lines of every role in role order (scopeCardLines); a role with no scope has none (ROLE-06). */
export function cardLines(roles: readonly RoleSpec[], scopes: ReadonlyMap<string, CompiledScope>): string[] {
  return roles.flatMap(role => {
    const scope = scopes.get(role.id)

    return scope === undefined ? [] : scopeCardLines(scope.card)
  })
}

/**
 * The reply of a finished init (PLAN-01, PLAN-02, D-105): what was asked for, the file plan as renderPlan prints it
 * (with its warnings, so none is printed twice), the git policy, where the launchers start (A2), the worktree line of
 * the ignore policy, `confirmLines` (what Confirm writes outside the repo and the improver line, which a --dry-run
 * reply names, 02-GAPS-B3 S4; none by default), and last the dry-run note when `applied` is null (--dry-run, nothing
 * was written), else the lines of what the apply did (appliedLines). Plain init and --dry-run differ only in the first
 * line, the confirm lines and that ending.
 */
export function initReplyText(
  plan: Plan,
  policy: GitPolicy,
  start: LaunchStart,
  applied: ApplyOutcome | null,
  confirmLines: readonly string[] = [],
): string {
  return [
    applied === null ? 'cadre init --dry-run' : 'cadre init',
    ...renderPlan(plan),
    policyLine(policy),
    launchLine(start),
    ...(policy === 'ignore' ? [IGNORE_ALL_NOTE] : []),
    ...confirmLines,
    ...(applied === null ? [DRY_RUN_NOTE] : appliedLines(applied)),
  ].join('\n')
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
function improverRunCount(draft: Draft, plan: Plan): number {
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
 * The final review (D-43, A1). Each round compiles the scopes from the draft (scopesFor), with the plugins answered
 * Install counted as installed (setupAfterInstalls), so the cards and the plan show what Confirm writes when every
 * install works (decision #69 A4; a failed install is then a warning, and apply plans again without it), plans the
 * files (planStep) with each role's repo parts (repoPartsOf, G-02-1f), which each parts-flow role's role.json records
 * (withRepoRecords, G-02-1f Regen), shows the summary in the side pane (reviewLines, D-133) and asks reviewQuestion
 * with the context line of that plan, cleaned as a report cell (reviewContextLine, D-136), and REVIEW_OPTIONS; an item
 * word may be typed under "Other" (parseReviewItem), and any other answer is asked again with why on top. Confirm
 * accepts the plan just shown, with the state it was planned with and the draft it was built from (Reviewed). A go-back
 * re-asks that one item (goBack), and the next round shows the summary again. A dismissal (REVIEW_DISMISSED_REASON),
 * MAX_ASKS answers it cannot read (NO_USABLE_ANSWER_REASON), or a cancelled go-back step is cancelled with its reason,
 * and so is a run that has asked MAX_REVIEW_ROUNDS times without Confirm (REVIEW_ROUNDS_REASON), so no plan the person
 * did not confirm is used (A1, D-45). A go-back picked at the last round cancels at once and asks none of that item's
 * questions (A3). The review itself writes nothing: Confirm is the consent apply writes the plan on (D-105).
 */
export async function reviewStep(io: InitIo, draft: Draft): Promise<StepResult<Reviewed>> {
  let current = draft
  for (let round = 0; round < MAX_REVIEW_ROUNDS; round += 1) {
    const setup = setupAfterInstalls(current.gathered.setup, current.pluginInstalls)
    const gathered = { ...current.gathered, setup }
    const scopes = scopesFor(current.roles, current.repoDefault, gathered, current.hunks, current.launchStart)
    const repoParts = repoPartsOf(current.instructions)
    const planned = await planStep(io, {
      roles: withRepoRecords(current.roles, current.instructions, repoParts),
      repoDefault: current.repoDefault,
      policy: current.policy,
      launchStart: current.launchStart,
      scopes,
      hunks: current.hunks,
      repo: current.gathered.repo,
      locations: current.locations,
      readUserMcp: current.readUserMcp,
      repoParts,
    })
    await showBlock(io, 'review', reviewLines(current, scopes, planned.plan))
    const ask = {
      question: reviewQuestion(contextText(reviewContextLine(planned.plan, current.policy, current.launchStart))),
      spec: { options: REVIEW_OPTIONS, header: ASK_HEADERS.review },
      parse: parseReviewItem,
      accepts: REVIEW_ACCEPTS,
    }
    const picked = choiceResult(await askChoice(io, ask), REVIEW_DISMISSED_REASON)
    if (picked.kind === 'cancelled') return picked
    const item = picked.value
    if (item === 'confirm') return accepted({ draft: current, planned })
    if (round === MAX_REVIEW_ROUNDS - 1) break
    const changed = await goBack(io, current, item)
    if (changed.kind === 'cancelled') return changed
    current = changed.value
  }

  return cancelled(REVIEW_ROUNDS_REASON)
}

/**
 * The reply of a cancelled step: its reason logged as its own line, the one place a cancel reason is printed (A1), and
 * cancelledReply of that reason, so the reply names it too (batch-1 review S1).
 */
function cancelReply(io: InitIo, reason: string): string {
  io.log(reportText(reason))

  return cancelledReply(reason)
}

/** How long one accepted framework command may run at apply before it is given up (D-106, T-03-19). */
export const HUNK_TIMEOUT_MS = 30_000

/** Why init cancels when a Keep mine or Take new question is dismissed or not answered (D-67, A1). */
export const CONFLICT_DISMISSED_REASON = 'A Keep mine or Take new question was dismissed or not answered.'

/** The context line of each Keep mine or Take new question (D-136): what each answer does with the edited file. */
export const CONFLICT_CONTEXT = 'Keep mine leaves your edited file as it is; Take new writes the new version over it.'

/**
 * Writes the plan the person confirmed (D-105, LNCH-01), in this order:
 * 1. The Keep mine or Take new questions, the only questions after Confirm (D-105, D-67): one for each conflicted file
 *    of the confirmed plan (conflictPaths), in plan order, before any host call (conflictQuestion with
 *    CONFLICT_OPTIONS, parseConflictAnswer); an answer that is neither is asked again with why on top (D-136). A
 *    dismissal cancels with CONFLICT_DISMISSED_REASON and MAX_ASKS answers that are neither with
 *    NO_USABLE_ANSWER_REASON, so nothing is written or run (A1, D-45).
 * 2. Each accepted hunk cadre can run, in hunk order (hunkRuns): the argv is re-resolved from its adapter proposal
 *    through a proven user-level GSD only, so a declined hunk or a repo-local GSD never runs and its command stays in
 *    the plan (D-28, D-72). It runs with cwd at the repo root and HUNK_TIMEOUT_MS; a run the host rejects or that
 *    exits non-zero is a failure, and apply goes on (D-106).
 * 3. The hunks after their runs (hunksAfterRuns): a failed hunk is no longer runnable.
 * 4. The plugins the person answered Install for (draft.pluginInstalls: the security plugins, decision #39, and
 *    claude-md-management, D-141), installed in order from the home folder, never the repo (installPlugins,
 *    T-03-46): claude-security only after its Python check, and a failed install tried once more after the
 *    marketplace add. An install that fails or is skipped is a problem the
 *    reply prints with the command to run, never fatal. With no home folder known nothing is run, and each key is such
 *    a problem (noHomeInstallText).
 * 5. Attended judged again from the config on disk (attendedByConfig), the scopes compiled again and the plan made
 *    again from the disk (planStep, with the repo parts 5a keeps, which each parts-flow role's role.json records with
 *    the other parts of their files as not given: withRepoRecords, G-02-1f Regen), all from the setup with the
 *    plugins just installed (setupAfterInstalls), so ROLE.md is rendered and hashed after the hunks ran (D-120) and a
 *    Security role's settings enable claude-security once it is installed. The hunk runs above keep the setup of the
 *    scan.
 * 5a. Right before planStep, the repo parts of the draft (repoPartsOf) are checked against git (trackedParts,
 *    02-GAPS-B2 M3): `git ls-files` runs once at the repo root through the host, under every git policy, and only the
 *    parts of files git tracks are kept; a run that fails keeps none. Each left-out source file is a warning
 *    (untrackedParts). The dry run holds no host, so its plan may still list a built file whose untracked parts apply
 *    then leaves out.
 * 5b. Then the role memory folder of every role is named from the git common dir as /cadre start names it
 *    (privatePlanOf: `git rev-parse` runs once at the repo root, on every plain init), with the private files of every
 *    role of the team as the only paths outside the repo apply may write (T-02-72); each role gets both private files
 *    (privatesOf, 02-GAPS-B3 C1) unless its instructions.json already holds the record it would get (02-GAPS-B3 S1);
 *    with no folder known, nothing private is written and the reply names the roles (privateProblems).
 * 6. The steps of that fresh plan with the answers and the private files (applySteps), run through the host port by
 *    writeSteps: each write checked for links first, a launcher made executable only after its own write landed, then
 *    each role's private text file and hand-out record in its role memory folder, once the folder is made and made
 *    private (G-02-1f, D-140 q2-a, N13), and the manifest last. Take new overwrites the person's file and the manifest
 *    records its new hash; Keep mine keeps the file and writes its `.cadre-new` copy, as it does for a file that
 *    became a conflict after the questions.
 * 6a. When claude-md-management is installed, before init or by step 4 with no install problem (the setup made
 *    again from the installs), and a built role file holds a part (builtRoleFiles: the `.cadre/<id>/CLAUDE.md` of a
 *    role with a repo part 5a kept, watching the role's private files and guarded from its `.runtime` folder, and
 *    each private text file with a global part, never one of the header alone; 02-GAPS-B3 M1, C1), the improver pass
 *    runs between the file writes and the manifest (writeImproved, G-02-1f, D-141): one `claude -p` run per written
 *    built file, in its own folder, then its diff and the Accept or Keep original question; a kept file is written
 *    back as built, and the manifest records each built file as it ends up. Otherwise no improver runs.
 * 7. The outcome with every failed run (hunkFailures), the keys of the failed hunks that are required (attended), the
 *    plugins installed and the install problems (installed, installProblems), the untracked-parts warnings of 5a
 *    (untrackedParts), the private problems of 5b and 6 (privateProblems) and the improver warnings and tally of 6a
 *    (improverWarnings, improved), which the reply prints, each failure with the command to run (D-106, decision
 *    #39).
 * Like every init step it gives a StepResult (A1): accepted with the fresh plan as written and what the apply did.
 */
export async function applyConfirmed(
  io: InitIo,
  host: HostIo,
  reviewed: Reviewed,
): Promise<StepResult<{ readonly planned: PlanResult; readonly outcome: ApplyOutcome }>> {
  const { draft } = reviewed
  const { locations, gathered, roles, repoDefault, launchStart } = draft
  const choices = new Map<string, ConflictChoice>()
  for (const path of conflictPaths(reviewed.planned.plan)) {
    const ask = {
      question: withContext(conflictQuestion(path), CONFLICT_CONTEXT),
      spec: { options: CONFLICT_OPTIONS, header: ASK_HEADERS.conflict },
      parse: parseConflictAnswer,
      accepts: quotedLabels(CONFLICT_OPTIONS),
    }
    const choice = choiceResult(await askChoice(io, ask), CONFLICT_DISMISSED_REASON)
    if (choice.kind === 'cancelled') return choice
    choices.set(path, choice.value)
  }
  const gsd = {
    userDir: provenUserDir(gathered.facts),
    home: locations.home,
    root: locations.root,
    configDir: locations.configDir,
  }
  const failures: HunkRun[] = []
  for (const run of hunkRuns(draft.hunks, gathered.setup, gsd)) {
    const result = await host.run(run.argv, { cwd: locations.root, timeoutMs: HUNK_TIMEOUT_MS })
    if (hasRunFailed(result)) failures.push(run)
  }
  const hunks = hunksAfterRuns(draft.hunks, new Set(failures.map(run => run.key)))
  const installs =
    locations.home === null
      ? { installed: [], installProblems: draft.pluginInstalls.map(noHomeInstallText) }
      : await installPlugins(host, locations.home, draft.pluginInstalls)
  const setup = setupAfterInstalls(gathered.setup, installs.installed)
  const frameworks = roles.map(role => resolvedFramework(role, repoDefault))
  const attended = await attendedByConfig(io, locations.root, frameworks, setup)
  const scopes = compileAll(roles, repoDefault, { ...gathered, setup }, attended, launchStart)
  const tracked = await trackedParts(host, locations.root, repoPartsOf(draft.instructions))
  const owed = privatesOf(draft.instructions, roles)
  const privatePlan = await privatePlanOf(io, host, locations, { roles, owed })
  const planned = await planStep(io, {
    roles: withRepoRecords(roles, draft.instructions, tracked.repoParts),
    repoDefault,
    policy: draft.policy,
    launchStart,
    scopes,
    hunks,
    repo: gathered.repo,
    locations,
    readUserMcp: draft.readUserMcp,
    repoParts: tracked.repoParts,
  })
  const input: ApplyInput = { ...planned, choices, privates: privatePlan.privates }
  const steps = await applySteps(input)
  const withParts = new Set(Array.from(tracked.repoParts).flatMap(([id, parts]) => (parts.length > 0 ? [id] : [])))
  const isImproverReady = setup.installedPlugins.includes(CLAUDE_MD_PLUGIN)
  const privateFolders = new Set(privatePlan.privates.flatMap(role => (role.parts.length > 0 ? [role.folder] : [])))
  const filter = { repoIds: withParts, privateFolders, roleFolders: privatePlan.folders }
  const offered = isImproverReady ? builtRoleFiles(steps, locations.root, filter) : []
  const allowed = privatePlan.allowed
  const written = await writeWithImprover(io, host, { locations, input, steps, offered, allowed })
  const required = new Set(hunks.filter(hunk => hunk.isRequired).map(hunk => hunk.key))
  const outcome: ApplyOutcome = {
    ...written,
    hunkFailures: failures,
    attended: failures.filter(run => required.has(run.key)).map(run => run.key),
    installed: installs.installed,
    installProblems: installs.installProblems,
    untrackedParts: tracked.warnings,
    privateProblems: [...privatePlan.problems, ...written.privateProblems],
  }

  return accepted({ planned, outcome })
}

/**
 * How `/cadre init` runs (D-105, T-03-16): --dry-run prints the plan and holds no host, so it can neither write nor
 * run; plain init writes the plan through `host` after Confirm.
 */
export type InitOptions = { readonly dryRun: true } | { readonly dryRun: false; readonly host: HostIo }

/**
 * `/cadre init`. It runs the guard before it reads or asks anything (initGuard), asks the ~/.claude.json consent
 * (consentStep), runs the scans and shows them with their warnings, then runs the history step (historyStep), which
 * asks before it reads any session transcript and keeps names and counts only (SCAN-03, D-59), then the role steps
 * (teamStep): the roles and their frameworks, the recommendations (ROLE-03), the security plugins a team with a
 * Security role misses (decision #39), the autopilot duration once for every role, each role's model and effort, the
 * MCP servers and skills, the instructions and memories (instructionsStep: the content consent, then the instruction
 * parts or the whole-file questions; G-02-1f), the carried env names, the autonomy hunks of the frameworks in use, and
 * the claude-md-management install when a role got a built file and it is missing (D-141). It then asks the git policy
 * (gitPolicyStep) and, once for the repo, where the launchers start (launchStartStep), shows the one final review with
 * every role's scope card for that start (the one place the cards are shown; reviewLines, ROLE-06, A5) and the exact
 * file plan, each role's built CLAUDE.md included, where the person confirms or goes back to change one item
 * (reviewStep, D-43). --dry-run then replies with the confirmed plan and the note that nothing was written, and
 * installs nothing (D-82); plain init writes it (applyConfirmed, D-105), asking only Keep mine or Take new for each
 * conflicted file (D-67), running the accepted hunks first, then installing the plugins answered Install from the home
 * folder, and writing the plan made again from the disk (D-120), with the improver pass on each built role file before
 * the manifest (D-141), and replies with the plan as written and what the apply did (initReplyText). Every step gives a
 * StepResult (A1): runInit checks its kind before it uses the value, and for a cancelled step prints the reason as its
 * own line and answers cancelledReply with the step's reason (D-45), so only values the person accepted reach the steps
 * after it, and nothing is written or installed before Confirm. Every answer lives in memory for this one run, and
 * nothing is kept for the next (D-45, D-82).
 */
export async function runInit(io: InitIo, options: InitOptions): Promise<string> {
  const guard = await initGuard(io, 'init')
  if (guard.kind === 'refuse') return guard.text

  const consent = await consentStep(io)
  if (consent.kind === 'cancelled') return cancelReply(io, consent.reason)

  const gathered = await gatherScans(io, guard.locations, consent.value)
  const warnings = scanWarningLines(scanWarnings(guard.locations, gathered))
  await showBlock(io, 'scan', [...scanSummaryLines(gathered.repo, gathered.setup), ...warnings])

  const history = await historyStep(io, guard.locations, scanContextLine(gathered.repo))
  if (history.kind === 'cancelled') return cancelReply(io, history.reason)

  const detections = detectAll(gathered.facts.facts)
  const proposal = proposeRoles(gathered.repo)
  const base: DraftBase = {
    locations: guard.locations,
    gathered,
    readUserMcp: consent.value,
    installed: installedFrameworks(detections),
    choice: chooseFramework(detections, null),
    proposal,
    hints: historyHints(history.value),
  }
  const team = await teamStep(io, base, proposal, null)
  if (team.kind === 'cancelled') return cancelReply(io, team.reason)

  const policy = await gitPolicyStep(io)
  if (policy.kind === 'cancelled') return cancelReply(io, policy.reason)

  const launch = await launchStartStep(io, guard.locations.root, team.value.roles)
  if (launch.kind === 'cancelled') return cancelReply(io, launch.reason)

  const draft = { ...base, ...team.value, policy: policy.value, launchStart: launch.value }
  const reviewed = await reviewStep(io, draft)
  if (reviewed.kind === 'cancelled') return cancelReply(io, reviewed.reason)
  const { plan, state } = reviewed.value.planned
  if (options.dryRun) {
    const confirmed = reviewed.value.draft
    const count = improverRunCount(confirmed, plan)
    const installed = setupAfterInstalls(confirmed.gathered.setup, confirmed.pluginInstalls).installedPlugins
    const improver = installed.includes(CLAUDE_MD_PLUGIN) && count > 0 ? [improverRunLine(count)] : []
    const rows = confirmed.roles.map(role => privateFilesRow(role.id))

    return initReplyText(plan, state.gitPolicy, state.launchStart, null, [PRIVATE_FILES_HEADING, ...rows, ...improver])
  }

  const applied = await applyConfirmed(io, options.host, reviewed.value)
  if (applied.kind === 'cancelled') return cancelReply(io, applied.reason)
  const asWritten = applied.value.planned

  return initReplyText(asWritten.plan, asWritten.state.gitPolicy, asWritten.state.launchStart, applied.value.outcome)
}
