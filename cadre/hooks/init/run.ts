/**
 * The runner of /cadre init (D-43, D-45, D-58, D-105, D-230, A1), a layer 11 module: runInit, the one place init
 * performs its effects. It starts from initialState, shows each state's outputs in order, performs the state's one
 * effect (an ask through askOnce, a host operation, or a model call through checkedCompletion) and feeds what it gave
 * to nextStage, until an end effect gives the reply. On Confirm of a plain init the apply writes through the
 * HostIo its InitOptions hold; a --dry-run holds no host, so it writes and runs nothing. register.tsx and the tests
 * import it, and no init module does.
 */
import type {
  CadreState,
  DesiredFile,
  HostIo,
  InitFacts,
  InitIo,
  InitLocations,
  InstructionPartRecord,
  InstructionScan,
  InstructionTopic,
  Manifest,
  ManifestEntry,
  PortRead,
  RoleSpec,
} from '../../types'
import {
  CONFLICT_OPTIONS,
  conflictContext,
  conflictPaths,
  conflictQuestion,
  parseConflictAnswer,
} from '../apply/conflict'
import type { ConflictChoice } from '../apply/conflict'
import { hunkRuns, hunksAfterRuns } from '../apply/hunks'
import type { HunkRun } from '../apply/hunks'
import { builtRoleFiles, IMPROVER_PROGRESS } from '../apply/improver'
import { noHomeInstallText, setupAfterInstalls } from '../apply/installs'
import type { ApplyInput } from '../apply/private'
import { installPlugins, privatePlanOf, writeWithImprover } from '../apply/run'
import type { ApplyOutcome } from '../apply/run'
import { applySteps } from '../apply/steps'
import { sha256Hex } from '../core/hash'
import { needsGsdCheck, provenUserDir, withGsdIdentity } from '../framework/gsd/identity'
import { desiredFiles } from '../generate/files'
import { trackedParts } from '../generate/gittrack'
import { builtClaudeMdPath } from '../generate/launcher'
import { initGuard } from '../guards/repo'
import { hasRunFailed } from '../host/steps'
import { t, tn } from '../locales/t'
import { GITIGNORE_FILE, isRepoFolder, roleJsonPath } from '../paths'
import { gitignoreLines, mergeIgnoreBlock } from '../plan/gitignore'
import { planReadPaths, planWithManifest, recordedCadreVersion } from '../plan/plan'
import { CLAUDE_MD_PLUGIN } from '../roles/infra'
import { parseRoleJson } from '../roles/rolejson'
import { standsFor } from '../roles/template'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { gatherScans } from '../scan/gather'
import { listSessions, scanHistory } from '../scan/history'
import { readInstructionFiles, repoInstructionNames } from '../scan/instructions/read'
import { readPaths, readRepoFile } from '../scan/port-read'
import { checkedCompletion } from '../suggest/checked'
import type { Checked, StepProgress } from '../suggest/checked'
import { parseRecommendation, RECOMMEND_SYSTEM, recommendPrompt } from '../suggest/instructions'
import { MCP_SYSTEM, mcpPrompt, parseMcpRecommendation } from '../suggest/mcp'
import { proposeFromText } from '../suggest/propose'
import { parseSkillRecommendation, SKILLS_SYSTEM, skillsPrompt } from '../suggest/skills'
import type { SkillsRecommendation } from '../suggest/skills'
import { fallbackTopics, parseTopics, TOPICS_SYSTEM, topicsPrompt } from '../suggest/topics'
import { attendedByConfig, compileAll, resolvedFramework } from '../team'
import {
  accepted,
  ASK_HEADERS,
  askChoice,
  askOnce,
  choiceResult,
  foldedSpec,
  noteLine,
  paneQuestionOf,
  quotedLabels,
} from '../ui/ask'
import type { StepResult } from '../ui/ask'
import { lineDiff } from '../ui/diff'
import { withPagedAsks } from '../ui/paging'
import type { Surface } from '../ui/surface'
import type { PlanResult, Reviewed } from './draft'
import { CONFLICT_CONTEXT, CONFLICT_DISMISSED_REASON, HUNK_TIMEOUT_MS } from './initapply'
import { privatesOf, repoPartsOf, withRepoRecords } from './initplan'
import type { PlanStepInput } from './initplan'
import { initialState, nextStage } from './machine'
import { INIT_CANCELLED } from './replies'
import { gsdCheckAsk } from './stages/frameworks'
import type { Answer, Effect, InitStage, InitState, IoCall, IoResult, ModelCall, ModelResult, Output } from './state'

/**
 * How `/cadre init` runs (D-105, T-03-16): --dry-run prints the plan and holds no host, so it can neither write nor
 * run; plain init writes the plan through `host` after Confirm. `surface` is where the run shows its context, a pane
 * surface when absent (D-208); the init state carries it to the stages.
 */
export type InitOptions = ({ readonly dryRun: true } | { readonly dryRun: false; readonly host: HostIo }) & {
  readonly surface?: Surface
  /**
   * The columns a pane page or a Review page is drawn at (D-292): read before each step into the state the step gets,
   * so the stages see the width the pane has now; absent in tests and `-p`, where the width is unknown.
   */
  readonly pageColumns?: () => number | null
  /**
   * Whether the pane is seated inline now (N-02, OC-04-I): an inline pane previews the whole context in the dialog,
   * which pages cannot change, so no question is paged there (withPagedAsks); absent in tests and `-p`, never inline.
   */
  readonly isPaneInline?: () => boolean
}

/** The status line the TUI default shows while the repo scans run (D-232). */
export const SCAN_PROGRESS = t('init.status.scan')

/** The status line the TUI default shows while the history scan reads the session transcripts (D-232). */
export const HISTORY_PROGRESS = t('init.status.history')

/** The status line or pane loader while apply runs the accepted hunks, once for all of them (D-284, edge #13). */
export const APPLY_HUNKS_PROGRESS = t('init.status.applyHunks')

/** The status line or pane loader while apply installs the plugins answered Install, once for all (D-284). */
export const INSTALL_PROGRESS = t('init.status.installPlugins')

/** The status line the TUI default shows while each model call of init runs, by its ModelCall id (D-232). */
export const MODEL_PROGRESS: Readonly<Record<ModelCall['id'], string>> = Object.freeze({
  'describe-roles': t('init.status.describeRoles'),
  mcp: t('init.status.mcp'),
  skills: t('init.status.skills'),
  topics: t('init.status.topics'),
  parts: t('init.status.parts'),
})

/**
 * What the scans read, the one line under SCAN_PROGRESS in a pane surface's loader (D-301): a fixed text, as nothing
 * is counted before the scans ran (the wording is Claude's discretion under D-301).
 */
export const SCAN_SUMMARY = t('init.status.summary.scan')

/** The words a step summary counts (D-301), each the last part of an `init.status.count.*` locale base. */
type CountWord =
  | 'servers'
  | 'roles'
  | 'skills'
  | 'groups'
  | 'parts'
  | 'topics'
  | 'memories'
  | 'sessions'
  | 'hunks'
  | 'plugins'
  | 'files'

/** A step summary of counts (D-301): each `<count> <word>`, in its one or other form (tn), joined with ', '. */
function countsText(counts: readonly (readonly [CountWord, number])[]): string {
  return counts.map(([word, count]) => tn(`init.status.count.${word}`, count, { count })).join(', ')
}

/**
 * The one-line summary of what a model call of init works on, drawn under its label (MODEL_PROGRESS) in a pane
 * surface's loader (D-301; the wording is Claude's discretion under D-301): the counts of what the call reads, servers
 * and roles for the MCP call, own skills, plugin groups and roles for the skills call, the parts for the topics call,
 * topics, memories and roles for the parts call (countsText), and a fixed text for a described structure. The TUI
 * default shows the label only.
 */
export function modelSummary(call: ModelCall): string {
  switch (call.id) {
    case 'describe-roles':
      return t('init.status.summary.describe')
    case 'mcp':
      return countsText([['servers', call.servers.length], ['roles', call.roles.length]])
    case 'skills':
      return countsText([['skills', call.own.length], ['groups', call.groups.length], ['roles', call.roles.length]])
    case 'topics':
      return countsText([['parts', call.scan.parts.length]])
    case 'parts': {
      const { topics, memories, roles } = call

      return countsText([['topics', topics.length], ['memories', memories.length], ['roles', roles.length]])
    }
    default: {
      const unreachable: never = call
      return unreachable
    }
  }
}

/**
 * The manifest entries of the built files a re-init keeps as they are (02-GAPS-B3 S1): for each role whose built
 * `.cadre/<id>/CLAUDE.md` is desired, when its role.json as the disk holds it is text parseRoleJson takes, with the
 * same repo part records as the role, given and not given (compared by file, heading and hash), and the built file as
 * the disk holds it hashes to its entry in the last manifest, that entry; so an accepted improver text is neither
 * written over nor offered again while the role's parts are unchanged.
 */
async function keptBuiltEntries(
  roles: readonly RoleSpec[],
  desired: readonly DesiredFile[],
  disk: ReadonlyMap<string, PortRead>,
  manifest: Manifest | null,
): Promise<ManifestEntry[]> {
  const desiredPaths = new Set(desired.map(file => file.path))
  const recordsText = (records: readonly InstructionPartRecord[] | undefined): string =>
    JSON.stringify((records ?? []).map(({ file, heading, hash }) => ({ file, heading, hash })))
  const kept: ManifestEntry[] = []
  for (const role of roles) {
    const path = builtClaudeMdPath(role.id)
    const entry = manifest?.files.find(file => file.path === path)
    if (!desiredPaths.has(path) || entry === undefined) continue
    const roleRead = disk.get(roleJsonPath(role.id))
    const onDisk = roleRead?.state === 'text' ? parseRoleJson(roleRead.text) : null
    if (onDisk === null) continue
    if (recordsText(onDisk.instructionParts) !== recordsText(role.instructionParts)) continue
    if (recordsText(onDisk.instructionPartsNotGiven) !== recordsText(role.instructionPartsNotGiven)) continue
    const built = disk.get(path)
    if (built?.state !== 'text' || (await sha256Hex(built.text)) !== entry.sha256) continue
    kept.push(entry)
  }

  return kept
}

/**
 * The truthful file plan of init (PLAN-01, PLAN-03, PLAN-04, D-67). The repo state holds cadre's own version, else
 * `unknown`, the repo default framework, the git policy, the role ids and where the launchers start (A2), and
 * desiredFiles gives every file from it, with the built `.cadre/<id>/CLAUDE.md` of each role from the repo parts
 * `repoParts` gives it (G-02-1f): whenever init passes repoParts every role gets its built file, the header alone with
 * no repo part, so a later hand-out always replaces stale content (02-GAPS-B2 S1). A role whose repo records and built
 * file are as the last apply left them keeps its built file and manifest entry, as regenPlan does, so an accepted
 * improver text is not overwritten or asked again (keptBuiltEntries, 02-GAPS-B3 S1): its path is dropped from the
 * desired files and its entry carried. The repo state also records the consent answer, so regen knows whether it may
 * read ~/.claude.json (A1). Exactly the paths planReadPaths names (each file, the copy beside it and the manifest) and
 * the root `.gitignore` are read, through readRepoFile, so a link out of the repo is unknown and never read.
 * planWithManifest classifies each file against the disk and the last manifest the scan read, then adds the ignore
 * block of the policy (gitignoreLines, which leaves out a `thoughts/` line the file already has and, when a role
 * stands for Security, ends with the line for claude-security's report folders, decision #39) and the hunks.
 * The result also holds what apply writes the plan from: the desired files less the kept ones, the manifest the plan
 * records and the merged `.gitignore` text, which is null when the `.gitignore` cannot be read or its block cannot be
 * merged, since the plan then has no op for it. It writes nothing itself: apply writes the plan after Confirm
 * (applyConfirmed).
 */
export async function planStep(io: InitIo, input: PlanStepInput): Promise<PlanResult> {
  const { roles, repoDefault, policy, launchStart, scopes, hunks, repo, locations, readUserMcp, repoParts } = input
  const cadreVersion = recordedCadreVersion(await io.cadreVersion())
  const state: CadreState = {
    schema: 1,
    cadreVersion,
    framework: repoDefault,
    gitPolicy: policy,
    roles: roles.map(role => role.id),
    launchStart,
    readUserMcp,
  }
  const parts = repoParts === undefined ? {} : { repoParts }
  const generated = desiredFiles({ roles, scopes, state, only: null, ...parts })
  const disk = await readPaths(io, locations.root, planReadPaths(generated))
  const carried = await keptBuiltEntries(roles, generated, disk, repo.cadre.manifest)
  const keptPaths = new Set(carried.map(entry => entry.path))
  const desired = generated.filter(file => !keptPaths.has(file.path))
  const ignoreRead = await readRepoFile(io, locations.root, GITIGNORE_FILE, MAX_READ_BYTES)
  const existing = ignoreRead.state === 'text' ? ignoreRead.text : null
  const lines = gitignoreLines(policy, existing, roles.some(role => standsFor(role, 'security')))
  const { plan, manifest } = await planWithManifest({
    desired,
    disk,
    manifest: repo.cadre.manifest,
    manifestState: repo.cadre.manifestState,
    carried,
    gitignore: { disk: ignoreRead, lines },
    hunks,
    cadreVersion,
  })
  const isIgnoreReadable = ignoreRead.state === 'text' || ignoreRead.state === 'absent'
  const gitignore = isIgnoreReadable ? mergeIgnoreBlock(existing, lines) : null

  return { plan, state, desired, manifest, gitignore }
}

/**
 * Writes the plan the person confirmed (D-105, LNCH-01), in this order:
 * 1. The Keep mine or Take new questions, the only questions after Confirm (D-105, D-67): one for each conflicted file
 *    of the confirmed plan (conflictPaths), in plan order, before any host call (conflictQuestion with
 *    CONFLICT_OPTIONS, parseConflictAnswer), each with the file's diff from the version on disk, read again through
 *    readRepoFile, to the new one as its own context (conflictContext, D-236), whose first line, how many lines Take
 *    new adds and removes, a pane surface asks in place of the context line (D-255); an answer that is neither is
 *    asked again with why on top (D-136). A dismissal cancels with CONFLICT_DISMISSED_REASON and MAX_ASKS answers that
 *    are neither with NO_USABLE_ANSWER_REASON, so nothing is written or run (A1, D-45).
 * 2. Each accepted hunk cadre can run, in hunk order (hunkRuns): the argv is re-resolved from its adapter proposal
 *    through a proven user-level GSD only, so a declined hunk or a repo-local GSD never runs and its command stays in
 *    the plan (D-28, D-72). It runs with cwd at the repo root and HUNK_TIMEOUT_MS; a run the host rejects or that
 *    exits non-zero is a failure, and apply goes on (D-106). Before the first run their one label is set
 *    (APPLY_HUNKS_PROGRESS, D-284).
 * 3. The hunks after their runs (hunksAfterRuns): a failed hunk is no longer runnable.
 * 4. The plugins the person answered Install for (draft.pluginInstalls: the security plugins, decision #39, and
 *    claude-md-management, D-141), installed in order from the home folder, never the repo (installPlugins,
 *    T-03-46): claude-security only after its Python check, and a failed install tried once more after the
 *    marketplace add. An install that fails or is skipped is a problem the
 *    reply prints with the command to run, never fatal. With no home folder known nothing is run, and each key is such
 *    a problem (noHomeInstallText). Before the installs their one label is set (INSTALL_PROGRESS, D-284).
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
 *    back as built, and the manifest records each built file as it ends up. Otherwise no improver runs. With a file
 *    offered, its label is set before the writes and again before each improver run (IMPROVER_PROGRESS, D-284, S-02).
 * 7. The outcome with every failed run (hunkFailures), the keys of the failed hunks that are required (attended), the
 *    plugins installed and the install problems (installed, installProblems), the untracked-parts warnings of 5a
 *    (untrackedParts), the private problems of 5b and 6 (privateProblems) and the improver warnings and tally of 6a
 *    (improverWarnings, improved), which the reply prints, each failure with the command to run (D-106, decision
 *    #39).
 * Like every init step it gives a StepResult (A1): accepted with the fresh plan as written and what the apply did.
 */
async function applyConfirmed(
  io: InitIo,
  host: HostIo,
  reviewed: Reviewed,
): Promise<StepResult<{ readonly planned: PlanResult; readonly outcome: ApplyOutcome }>> {
  const { draft } = reviewed
  const { locations, gathered, roles, repoDefault, launchStart } = draft
  const choices = new Map<string, ConflictChoice>()
  for (const path of conflictPaths(reviewed.planned.plan)) {
    const disk = await readRepoFile(io, locations.root, path, MAX_READ_BYTES)
    const desired = reviewed.planned.desired.find(file => file.path === path)
    const diff = disk.state === 'text' && desired !== undefined ? lineDiff(disk.text, desired.content) : null
    const context = conflictContext(path, diff)
    const pane = paneQuestionOf(conflictQuestion(path), CONFLICT_CONTEXT, context.summary)
    const ask = {
      question: pane.asked,
      spec: { options: CONFLICT_OPTIONS, header: ASK_HEADERS.conflict, context: { ...context, pane } },
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
  const runs = hunkRuns(draft.hunks, gathered.setup, gsd)
  if (runs.length > 0) await io.progress(APPLY_HUNKS_PROGRESS, countsText([['hunks', runs.length]]))
  for (const run of runs) {
    const result = await host.run(run.argv, { cwd: locations.root, timeoutMs: HUNK_TIMEOUT_MS })
    if (hasRunFailed(result)) failures.push(run)
  }
  const hunks = hunksAfterRuns(draft.hunks, new Set(failures.map(run => run.key)))
  const installCount = countsText([['plugins', draft.pluginInstalls.length]])
  if (locations.home !== null && draft.pluginInstalls.length > 0) await io.progress(INSTALL_PROGRESS, installCount)
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
  if (offered.length > 0) await io.progress(IMPROVER_PROGRESS, countsText([['files', offered.length]]))
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
 * Shows one output of a state (D-133): a note (noteLine), or one line logged as is. A fold makes no io call: runInit
 * holds it for the next asking stage's questions (D-302); a side-pane block draws nothing, as the pane draws only the
 * open question or the loader (D-299), and no stage gives one (D-326). The testkit's stageRun shows a stage's outputs
 * through it too.
 */
export async function showOutput(io: InitIo, output: Output): Promise<void> {
  switch (output.kind) {
    case 'show':
    case 'fold':
      return
    case 'note':
      return noteLine(io, output.line)
    case 'log':
      return io.log(output.text)
    default: {
      const unreachable: never = output
      return unreachable
    }
  }
}

/**
 * The same port whose `tools` reads the host's list once and answers every later call with that first read (#163), so
 * one scan reads the session tool list once.
 */
function withToolsOnce(io: InitIo): InitIo {
  let read: Promise<unknown> | null = null
  const tools = (): Promise<unknown> => {
    if (read === null) read = io.tools()

    return read
  }

  return { ...io, tools }
}

/**
 * Performs one host operation of a stage (D-230): the guard (initGuard), the scans (gatherScans) with the session's
 * tool list read once, shared with the scans, for the MCP server questions' contexts (D-211, #163), the listing of the
 * session folder (listSessions), the history scan (scanHistory), the check of a typed launcher folder (isRepoFolder),
 * GSD's own check after the user said Yes (io.gsdIdentity, D-243, the only init caller of it), the review's plan
 * (planStep), or Confirm's apply through the run's host (applyConfirmed), which a --dry-run does not
 * hold, so it gives none there. The scans and the history scan first set their status line (D-232).
 */
async function performIo(io: InitIo, options: InitOptions, call: IoCall): Promise<IoResult> {
  switch (call.id) {
    case 'guard':
      return { id: 'guard', result: await initGuard(io, 'init') }
    case 'scan': {
      await io.progress(SCAN_PROGRESS, SCAN_SUMMARY)
      const scanIo = withToolsOnce(io)
      const result = await gatherScans(scanIo, call.locations, call.readUserMcp)

      return { id: 'scan', result, tools: await scanIo.tools() }
    }
    case 'list-sessions':
      return { id: 'list-sessions', result: await listSessions(io, call.dir) }
    case 'scan-history':
      await io.progress(HISTORY_PROGRESS, countsText([['sessions', call.sessions.length]]))

      return { id: 'scan-history', result: await scanHistory(io, call.dir, call.sessions) }
    case 'read-repo-file':
      return { id: 'read-repo-file', result: await readRepoFile(io, call.root, call.path, call.maxBytes) }
    case 'repo-instruction-names':
      return { id: 'repo-instruction-names', result: await repoInstructionNames(io, call.root) }
    case 'read-instruction-files':
      return { id: 'read-instruction-files', result: await readInstructionFiles(io, call.sources) }
    case 'launch-dir-check':
      return { id: 'launch-dir-check', result: await isRepoFolder(io, call.root, call.path) }
    case 'gsd-identity':
      return { id: 'gsd-identity', result: await io.gsdIdentity(call.locations) }
    case 'plan':
      return { id: 'plan', result: await planStep(io, call.input) }
    case 'apply':
      return { id: 'apply', result: options.dryRun ? null : await applyConfirmed(io, options.host, call.reviewed) }
    default: {
      const unreachable: never = call
      return unreachable
    }
  }
}

/**
 * The GSD check of `/cadre detect`, the one I/O runner beside performIo (D-230, D-243, WF-S6): asked through the same
 * spec as init's (gsdCheckAsk) only when the facts hold a user-level GSD found but not proven and someone can be asked;
 * on Yes GSD's own check runs through io.gsdIdentity (collectGsdIdentity) and is merged (withGsdIdentity). Any other
 * answer, a dismissal or `claude -p` leaves the facts as they are, so the identity call never runs without a Yes.
 */
export async function consentedGsdCheck(
  io: InitIo,
  initFacts: InitFacts,
  locations: InitLocations,
): Promise<InitFacts> {
  if (!needsGsdCheck(initFacts.facts) || (await io.isInteractive()) !== true) return initFacts
  const ask = gsdCheckAsk(initFacts.facts)
  const answer = await io.ask(ask.question, ask.spec).catch(() => null)
  if (answer === null || ask.parse(answer) !== true) return initFacts

  return withGsdIdentity(initFacts, await io.gsdIdentity(locations), locations)
}

/**
 * The roles recommended for each MCP server (D-248): one model call reads each role's work and each server's name,
 * source, tool names and table seed (mcpPrompt, MCP_SYSTEM). A reply parseMcpRecommendation cannot take is sent back
 * with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all (checkedCompletion), and then each server gets the roles
 * the name table seeds for it, a server with no seed none (D-254). The model has no tools (D-83), and only its checked
 * server and role ids are kept, keyed by server name.
 */
async function recommendedServerRoles(
  io: InitIo,
  call: Extract<ModelCall, { readonly id: 'mcp' }>,
  step: StepProgress,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const { roles, servers } = call
  const serverNames = servers.map(server => server.name)
  const roleIds = roles.map(role => role.id)
  const parse = (reply: string): Checked<ReadonlyMap<string, readonly string[]>> => {
    const parsed = parseMcpRecommendation(reply, serverNames, roleIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.recommended }
  }
  const prompt = (errors: readonly string[]): string => mcpPrompt(roles, servers, errors)
  const seeds = (): ReadonlyMap<string, readonly string[]> =>
    new Map(servers.filter(server => server.seed.length > 0).map(server => [server.name, server.seed]))

  return checkedCompletion(io, step, MCP_SYSTEM, prompt, parse, seeds)
}

/**
 * The roles recommended for each of the user's own skills, each plugin group and each skill in a group (G-02-1b,
 * D-248, D-251): one model call reads each role's work and its confirmed MCP servers, and each skill's name, purpose
 * and own use count (skillsPrompt, SKILLS_SYSTEM). A reply parseSkillRecommendation cannot take is sent back with its
 * exact errors, MAX_PROPOSE_ATTEMPTS calls in all (checkedCompletion), and then each skill in a group gets the roles
 * the skill table seeds for it (D-280) and no own skill or group is recommended. The model has no tools (D-83), and
 * only its checked ids and role ids are kept.
 */
async function recommendedSkillRoles(
  io: InitIo,
  call: Extract<ModelCall, { readonly id: 'skills' }>,
  step: StepProgress,
): Promise<SkillsRecommendation> {
  const { roles, mcpByRole, own, groups, counts, seeds } = call
  const roleIds = roles.map(role => role.id)
  const parse = (reply: string): Checked<SkillsRecommendation> => {
    const parsed = parseSkillRecommendation(reply, own, groups, roleIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.recommended }
  }
  const prompt = (errors: readonly string[]): string => skillsPrompt(roles, mcpByRole, own, groups, counts, errors)
  const seeded = (): SkillsRecommendation => ({
    own: new Map(),
    groups: new Map(),
    groupSkills: new Map(
      groups.map((group): [string, ReadonlyMap<string, readonly string[]>] => [
        group.plugin,
        new Map(group.skills.flatMap(skill => {
          const seed = seeds.get(skill.name)

          return seed === undefined ? [] : [[skill.name, seed]]
        })),
      ]),
    ),
  })

  return checkedCompletion(io, step, SKILLS_SYSTEM, prompt, parse, seeded)
}

/**
 * The topics of a read (G-02-1f Part unit): one model call groups the parts across files (topicsPrompt, TOPICS_SYSTEM).
 * A reply parseTopics cannot take is sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all
 * (checkedCompletion), and then each file is one topic (fallbackTopics). The model has no tools (D-83), and only its
 * checked topics are kept.
 */
async function groupedTopics(
  io: InitIo,
  scan: InstructionScan,
  step: StepProgress,
): Promise<readonly InstructionTopic[]> {
  const partIds = scan.parts.map(part => part.id)
  const parse = (reply: string): Checked<readonly InstructionTopic[]> => {
    const parsed = parseTopics(reply, partIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.topics }
  }
  const prompt = (errors: readonly string[]): string => topicsPrompt(scan.parts, errors)

  return checkedCompletion(io, step, TOPICS_SYSTEM, prompt, parse, () => fallbackTopics(scan))
}

/**
 * The roles recommended for each topic and each memory (G-02-1f Recommendation, Memories): a second model call reads
 * each role's work, the topics and the memories by file and summary (recommendPrompt, RECOMMEND_SYSTEM). A reply
 * parseRecommendation cannot take is sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all
 * (checkedCompletion), and then no topic or memory is recommended to any role: the map is empty.
 */
async function recommendedRoles(
  io: InitIo,
  call: Extract<ModelCall, { readonly id: 'parts' }>,
  step: StepProgress,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const { roles, topics, memories } = call
  const topicIds = topics.map(topic => topic.id)
  const memoryIds = memories.map(memory => memory.id)
  const roleIds = roles.map(role => role.id)
  const parse = (reply: string): Checked<ReadonlyMap<string, readonly string[]>> => {
    const parsed = parseRecommendation(reply, topicIds, memoryIds, roleIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.recommended }
  }
  const prompt = (errors: readonly string[]): string => recommendPrompt(roles, topics, memories, errors)

  return checkedCompletion(io, step, RECOMMEND_SYSTEM, prompt, parse, () => new Map())
}

/**
 * Runs one model call of a stage (D-230) as today's step did, retrying through checkedCompletion and falling back as
 * it always did: the roles of a described structure (proposeFromText), the roles recommended for each MCP server
 * (recommendedServerRoles), the roles recommended for each own skill (recommendedSkillRoles), the topics of an
 * instruction read (groupedTopics), or the roles recommended for each topic and memory (recommendedRoles), each with
 * the status line of its ModelCall id (MODEL_PROGRESS, D-232) and the summary of what it reads (modelSummary, D-301).
 */
async function performModel(io: InitIo, call: ModelCall): Promise<ModelResult> {
  const step: StepProgress = { label: MODEL_PROGRESS[call.id], summary: modelSummary(call) }
  switch (call.id) {
    case 'describe-roles':
      return { id: 'describe-roles', result: await proposeFromText(io, call.text, step.label, step.summary) }
    case 'mcp':
      return { id: 'mcp', result: await recommendedServerRoles(io, call, step) }
    case 'skills':
      return { id: 'skills', result: await recommendedSkillRoles(io, call, step) }
    case 'topics':
      return { id: 'topics', result: await groupedTopics(io, call.scan, step) }
    case 'parts':
      return { id: 'parts', result: await recommendedRoles(io, call, step) }
    default: {
      const unreachable: never = call
      return unreachable
    }
  }
}

/**
 * Performs an effect (D-230): an ask through askOnce (null when dismissed), a host operation (performIo) or a model
 * call (performModel). runInit performs its states through performState, which asks the state's open question; the
 * testkit's stageRun performs a stage's effects through perform.
 */
export async function perform(
  io: InitIo,
  options: InitOptions,
  effect: Exclude<Effect, { readonly kind: 'end' }>,
): Promise<Answer> {
  switch (effect.kind) {
    case 'ask':
      return { kind: 'answer', text: await askOnce(io, effect.question, effect.spec) }
    case 'io':
      return { kind: 'io', result: await performIo(io, options, effect.call) }
    case 'model':
      return { kind: 'model', result: await performModel(io, effect.call) }
    default: {
      const unreachable: never = effect
      return unreachable
    }
  }
}

/**
 * Performs a state's effect, the runner's one way to do so (D-204, D-230, WD-S1): an ask asks `state.openQuestion`,
 * its question and spec, never the effect's copy; an ask with no open question, or the end, gives null, so the run
 * ends with INIT_CANCELLED (fail closed); a host operation or a model call goes through perform.
 */
export async function performState(io: InitIo, options: InitOptions, state: InitState): Promise<Answer | null> {
  const { effect, openQuestion } = state
  if (effect.kind === 'end') return null
  if (effect.kind !== 'ask') return perform(io, options, effect)
  if (openQuestion === null) return null

  return perform(io, options, { kind: 'ask', question: openQuestion.question, spec: openQuestion.spec })
}

/**
 * `/cadre init`. It runs the guard before it reads or asks anything (initGuard), asks the ~/.claude.json consent
 * (consentStage), runs the scans and shows them with their warnings, then runs the history stage (historyStage), which
 * asks before it reads any session transcript and keeps names and counts only (SCAN-03, D-59), then the role stages
 * (init/machine): the roles and their frameworks, the recommendations (ROLE-03), the security plugins a team with a
 * Security role misses (decision #39), the autopilot duration once for every role, each role's model and effort, the
 * MCP servers and skills, the instructions and memories (instructionsStep: the content consent, then the instruction
 * parts or the whole-file questions; G-02-1f), the carried env names, the autonomy hunks of the frameworks in use, and
 * the claude-md-management install when a role got a built file and it is missing (D-141). It then asks the git policy
 * (policyStage) and, once for the repo, where the launchers start (launchStage), shows the one final review with
 * every role's scope card for that start (the one place the cards are shown; reviewLines, ROLE-06, A5) and the exact
 * file plan, each role's built CLAUDE.md included, where the person confirms or goes back to change one item
 * (reviewStage, D-43). --dry-run then replies with the confirmed plan and the note that nothing was written, and
 * installs nothing (D-82); plain init writes it (applyConfirmed, D-105), asking only Keep mine or Take new for each
 * conflicted file (D-67), running the accepted hunks first, then installing the plugins answered Install from the home
 * folder, and writing the plan made again from the disk (D-120), with the improver pass on each built role file before
 * the manifest (D-141), and replies with the plan as written and what the apply did (initReplyText). Every step gives a
 * StepResult (A1): runInit checks its kind before it uses the value, and for a cancelled step answers cancelledReply
 * with the step's reason, the one place it is printed (D-45, D-265), so only values the person accepted reach the steps
 * after it, and nothing is written or installed before Confirm. Every answer lives in memory for this one run, and
 * nothing is kept for the next (D-45, D-82). The order, the merges and the cancels are the stage machine's
 * (init/machine, D-230): runInit only shows each state's outputs, holds their folds for the questions of the next stage
 * that asks, which it asks with the folds in their contexts on a pane surface (foldedSpec, D-302), performs each
 * effect and feeds the answer back.
 */
export async function runInit(io: InitIo, options: InitOptions): Promise<string> {
  // Every question goes through the paged port: on a pane surface a context over the frame cap is asked a page at a
  // time, at the width the run reads before each ask, and whole while the pane is seated inline (withPagedAsks, D-306,
  // N-02).
  const paged = withPagedAsks(
    io,
    options.surface ?? 'pane',
    () => options.pageColumns?.() ?? null,
    () => options.isPaneInline?.() ?? false,
  )
  let state = initialState(options.dryRun, options.surface)
  // The folds the stages gave since the last ask, and those bound to the stage that asked first after them (D-302).
  let held: readonly Extract<Output, { readonly kind: 'fold' }>[] = []
  let boundStage: InitStage | null = null
  let bound: typeof held = []
  for (;;) {
    for (const output of state.outputs) await showOutput(paged, output)
    held = [...held, ...state.outputs.flatMap(output => (output.kind === 'fold' ? [output] : []))]
    const { effect, openQuestion, stage } = state
    if (effect.kind === 'end') return effect.reply
    if (effect.kind === 'ask' && held.length > 0) {
      bound = boundStage === stage ? [...bound, ...held] : held
      boundStage = stage
      held = []
    }
    if (effect.kind === 'ask' && boundStage !== stage) {
      boundStage = null
      bound = []
    }
    const folds = state.surface === 'tui-default' ? [] : bound
    const open = openQuestion === null ? null : { ...openQuestion, spec: foldedSpec(openQuestion.spec, folds) }
    const answer = await performState(paged, options, { ...state, openQuestion: open })
    if (answer === null) return INIT_CANCELLED
    state = nextStage({ ...state, outputs: [], pageColumns: options.pageColumns?.() ?? null }, answer)
  }
}
