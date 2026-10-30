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
  InitIo,
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
import { builtRoleFiles } from '../apply/improver'
import { noHomeInstallText, setupAfterInstalls } from '../apply/installs'
import type { ApplyInput } from '../apply/private'
import { installPlugins, privatePlanOf, writeWithImprover } from '../apply/run'
import type { ApplyOutcome } from '../apply/run'
import { applySteps } from '../apply/steps'
import { sha256Hex } from '../core/hash'
import { provenUserDir } from '../framework/gsd/identity'
import { desiredFiles } from '../generate/files'
import { trackedParts } from '../generate/gittrack'
import { builtClaudeMdPath } from '../generate/launcher'
import { initGuard } from '../guards/repo'
import { hasRunFailed } from '../host/steps'
import { GITIGNORE_FILE, isRepoFolder, roleJsonPath } from '../paths'
import { gitignoreLines, mergeIgnoreBlock } from '../plan/gitignore'
import { planReadPaths, planWithManifest } from '../plan/plan'
import { CLAUDE_MD_PLUGIN } from '../roles/infra'
import { parseRoleJson } from '../roles/rolejson'
import { standsFor } from '../roles/template'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { gatherScans } from '../scan/gather'
import { listSessions, scanHistory } from '../scan/history'
import { readInstructionFiles, repoInstructionNames } from '../scan/instructions/read'
import { readPaths, readRepoFile } from '../scan/port-read'
import { checkedCompletion } from '../suggest/checked'
import type { Checked } from '../suggest/checked'
import { parseRecommendation, RECOMMEND_SYSTEM, recommendPrompt } from '../suggest/instructions'
import { proposeFromText } from '../suggest/propose'
import { parseSkillRecommendation, SKILLS_SYSTEM, skillsPrompt } from '../suggest/skills'
import { fallbackTopics, parseTopics, TOPICS_SYSTEM, topicsPrompt } from '../suggest/topics'
import { attendedByConfig, compileAll, resolvedFramework } from '../team'
import {
  accepted,
  ASK_HEADERS,
  askChoice,
  askOnce,
  choiceResult,
  noteLine,
  quotedLabels,
  showBlock,
  withContext,
} from '../ui/ask'
import type { StepResult } from '../ui/ask'
import { lineDiff } from '../ui/diff'
import type { Surface } from '../ui/surface'
import { ownSkillIds } from './answers'
import type { PlanResult, Reviewed } from './draft'
import { CONFLICT_CONTEXT, CONFLICT_DISMISSED_REASON, HUNK_TIMEOUT_MS } from './initapply'
import { privatesOf, repoPartsOf, withRepoRecords } from './initplan'
import type { PlanStepInput } from './initplan'
import { initialState, nextStage } from './machine'
import type { Answer, Effect, IoCall, IoResult, ModelCall, ModelResult, Output } from './state'

/**
 * How `/cadre init` runs (D-105, T-03-16): --dry-run prints the plan and holds no host, so it can neither write nor
 * run; plain init writes the plan through `host` after Confirm. `surface` is where the run shows its context, a pane
 * surface when absent (D-208); the init state carries it to the stages.
 */
export type InitOptions = ({ readonly dryRun: true } | { readonly dryRun: false; readonly host: HostIo }) & {
  readonly surface?: Surface
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
  const cadreVersion = (await io.cadreVersion()) ?? 'unknown'
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
 *    readRepoFile, to the new one as its own context (conflictContext, D-236); an answer that is neither is asked again
 *    with why on top (D-136). A dismissal cancels with CONFLICT_DISMISSED_REASON and MAX_ASKS answers that are neither
 *    with NO_USABLE_ANSWER_REASON, so nothing is written or run (A1, D-45).
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
    const ask = {
      question: withContext(conflictQuestion(path), CONFLICT_CONTEXT),
      spec: { options: CONFLICT_OPTIONS, header: ASK_HEADERS.conflict, context: conflictContext(path, diff) },
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
 * Shows one output of a state (D-133): a side-pane block (showBlock), a note (noteLine), or one line logged as is. The
 * testkit's stageRun shows a stage's outputs through it too.
 */
export async function showOutput(io: InitIo, output: Output): Promise<void> {
  switch (output.kind) {
    case 'show':
      return showBlock(io, output.block.key, output.block.lines)
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
 * Performs one host operation of a stage (D-230): the guard (initGuard), the scans (gatherScans) with the session's
 * tool list read once more after them for the MCP server questions' contexts (D-211), the listing of the
 * session folder (listSessions), the history scan (scanHistory), the check of a typed launcher folder (isRepoFolder),
 * the review's plan (planStep), or Confirm's apply through the run's host (applyConfirmed), which a --dry-run does not
 * hold, so it gives none there.
 */
async function performIo(io: InitIo, options: InitOptions, call: IoCall): Promise<IoResult> {
  switch (call.id) {
    case 'guard':
      return { id: 'guard', result: await initGuard(io, 'init') }
    case 'scan': {
      const result = await gatherScans(io, call.locations, call.readUserMcp)

      return { id: 'scan', result, tools: await io.tools() }
    }
    case 'list-sessions':
      return { id: 'list-sessions', result: await listSessions(io, call.dir) }
    case 'scan-history':
      return { id: 'scan-history', result: await scanHistory(io, call.dir, call.sessions) }
    case 'read-repo-file':
      return { id: 'read-repo-file', result: await readRepoFile(io, call.root, call.path, call.maxBytes) }
    case 'repo-instruction-names':
      return { id: 'repo-instruction-names', result: await repoInstructionNames(io, call.root) }
    case 'read-instruction-files':
      return { id: 'read-instruction-files', result: await readInstructionFiles(io, call.sources) }
    case 'launch-dir-check':
      return { id: 'launch-dir-check', result: await isRepoFolder(io, call.root, call.path) }
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
 * The roles recommended for each of the user's own skills (G-02-1b): one model call reads each role's work and each
 * skill's name, purpose and own use count (skillsPrompt, SKILLS_SYSTEM). A reply parseSkillRecommendation cannot take
 * is sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all (checkedCompletion), and then no skill is
 * recommended to any role: the map is empty. The model has no tools (D-83), and only its checked skill and role ids
 * are kept.
 */
async function recommendedSkillRoles(
  io: InitIo,
  call: Extract<ModelCall, { readonly id: 'skills' }>,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const { roles, skills, counts } = call
  const skillIds = ownSkillIds(skills)
  const roleIds = roles.map(role => role.id)
  const parse = (reply: string): Checked<ReadonlyMap<string, readonly string[]>> => {
    const parsed = parseSkillRecommendation(reply, skillIds, roleIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.recommended }
  }
  const prompt = (errors: readonly string[]): string => skillsPrompt(roles, skills, counts, errors)

  return checkedCompletion(io, SKILLS_SYSTEM, prompt, parse, () => new Map())
}

/**
 * The topics of a read (G-02-1f Part unit): one model call groups the parts across files (topicsPrompt, TOPICS_SYSTEM).
 * A reply parseTopics cannot take is sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all
 * (checkedCompletion), and then each file is one topic (fallbackTopics). The model has no tools (D-83), and only its
 * checked topics are kept.
 */
async function groupedTopics(io: InitIo, scan: InstructionScan): Promise<readonly InstructionTopic[]> {
  const partIds = scan.parts.map(part => part.id)
  const parse = (reply: string): Checked<readonly InstructionTopic[]> => {
    const parsed = parseTopics(reply, partIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.topics }
  }
  const prompt = (errors: readonly string[]): string => topicsPrompt(scan.parts, errors)

  return checkedCompletion(io, TOPICS_SYSTEM, prompt, parse, () => fallbackTopics(scan))
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

  return checkedCompletion(io, RECOMMEND_SYSTEM, prompt, parse, () => new Map())
}

/**
 * Runs one model call of a stage (D-230) as today's step did, retrying through checkedCompletion and falling back as
 * it always did: the roles of a described structure (proposeFromText), the roles recommended for each own skill
 * (recommendedSkillRoles), the topics of an instruction read (groupedTopics), or the roles recommended for each topic
 * and memory (recommendedRoles).
 */
async function performModel(io: InitIo, call: ModelCall): Promise<ModelResult> {
  switch (call.id) {
    case 'describe-roles':
      return { id: 'describe-roles', result: await proposeFromText(io, call.text) }
    case 'skills':
      return { id: 'skills', result: await recommendedSkillRoles(io, call) }
    case 'topics':
      return { id: 'topics', result: await groupedTopics(io, call.scan) }
    case 'parts':
      return { id: 'parts', result: await recommendedRoles(io, call) }
    default: {
      const unreachable: never = call
      return unreachable
    }
  }
}

/**
 * Performs a state's effect (D-230): an ask through askOnce (null when dismissed), a host operation (performIo) or a
 * model call (performModel). The testkit's stageRun performs a stage's effects through it too.
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
 * StepResult (A1): runInit checks its kind before it uses the value, and for a cancelled step prints the reason as its
 * own line and answers cancelledReply with the step's reason (D-45), so only values the person accepted reach the steps
 * after it, and nothing is written or installed before Confirm. Every answer lives in memory for this one run, and
 * nothing is kept for the next (D-45, D-82). The order, the merges and the cancels are the stage machine's
 * (init/machine, D-230): runInit only shows each state's outputs, performs its effect and feeds the answer back.
 */
export async function runInit(io: InitIo, options: InitOptions): Promise<string> {
  let state = initialState(options.dryRun, options.surface)
  for (;;) {
    for (const output of state.outputs) await showOutput(io, output)
    const { effect } = state
    if (effect.kind === 'end') return effect.reply
    state = nextStage({ ...state, outputs: [] }, await perform(io, options, effect))
  }
}
