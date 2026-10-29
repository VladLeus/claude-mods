import type { GitPolicy, HostIo, InitIo, LaunchStart, Plan } from '../types'
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
import { reportText } from './core/text'
import { chooseFramework } from './framework/contract'
import { provenUserDir } from './framework/gsd/identity'
import { detectAll } from './framework/registry'
import { trackedParts } from './generate/gittrack'
import { initGuard } from './guards/repo'
import { hasRunFailed } from './host/steps'
import type { DraftBase, PlanResult, Reviewed } from './init/draft'
import { historyHints, teamStep } from './init/flow'
import { planStep, privatesOf, repoPartsOf, withRepoRecords } from './init/initplan'
import { cancelledReply, IGNORE_ALL_NOTE } from './init/replies'
import { consentStep } from './init/stages/consent'
import { historyStep } from './init/stages/history'
import { launchLine, launchStartStep } from './init/stages/launch'
import { gitPolicyStep, policyLine } from './init/stages/policy'
import {
  improverRunCount,
  improverRunLine,
  PRIVATE_FILES_HEADING,
  privateFilesRow,
  reviewStep,
} from './init/stages/review'
import { installedFrameworks } from './init/stages/roles'
import { DRY_RUN_NOTE, renderPlan } from './plan/text'
import { CLAUDE_MD_PLUGIN } from './roles/infra'
import { proposeRoles } from './roles/propose'
import { gatherScans, scanWarnings } from './scan/gather'
import { attendedByConfig, compileAll, resolvedFramework } from './team'
import { accepted, ASK_HEADERS, askChoice, choiceResult, quotedLabels, showBlock, withContext } from './ui/ask'
import type { StepResult } from './ui/ask'
import { scanContextLine, scanSummaryLines, scanWarningLines } from './ui/blocks/scan'

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
