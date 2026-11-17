/**
 * The runner of /cadre init (D-43, D-45, D-58, D-105, D-230, A1), a layer 11 module: runInit, the one place init
 * performs its effects. It starts from initialState, shows each state's outputs in order, performs the state's one
 * effect (an ask through askOnce, a host operation, or a model call through checkedCompletion) and feeds what it gave
 * to nextStage, until an end effect gives the reply. On Confirm of a plain init the apply writes through the
 * HostIo its InitOptions hold; a --dry-run holds no host, so it writes and runs nothing. register.tsx and the tests
 * import it, and no init module does.
 */
import type {
  CompiledScope,
  DesiredFile,
  FrameworkId,
  HostIo,
  HunkOp,
  InitFacts,
  InitIo,
  InitLocations,
  InstructionScan,
  InstructionTopic,
  LaunchStart,
  Manifest,
  ManifestEntry,
  PortRead,
  ProjectInstall,
  RoleSpec,
  SetupScan,
  Sizing,
} from '../../types'
import {
  CONFLICT_OPTIONS,
  conflictContext,
  conflictPaths,
  conflictQuestion,
  parseConflictAnswer,
} from '../apply/conflict'
import type { ConflictChoice } from '../apply/conflict'
import { hunkNotRunLines, hunkRuns, hunksAfterRuns, hunksNotRun, hunksShown } from '../apply/hunks'
import type { HunkRun } from '../apply/hunks'
import { builtRoleFiles, IMPROVER_PROGRESS } from '../apply/improver'
import {
  frameworkFallbackText,
  noHomeInstallText,
  projectInstallFailureText,
  projectInstallOf,
  projectPluginInstall,
  setupAfterInstalls,
} from '../apply/installs'
import type { ApplyInput } from '../apply/private'
import {
  installPlugins,
  installProject,
  NOTHING_APPLIED,
  privatePlanOf,
  writeSteps,
  writeWithImprover,
} from '../apply/run'
import type { ApplyOutcome } from '../apply/run'
import { applySteps, planMismatchProblem } from '../apply/steps'
import { repoFrameworks } from '../core/framework-id'
import { sha256Hex } from '../core/hash'
import { needsGsdCheck, provenUserDir, withGsdIdentity } from '../framework/gsd/identity'
import { adapterOf } from '../framework/registry'
import { roleJsonText } from '../generate/docs'
import { desiredFiles } from '../generate/files'
import { trackedParts } from '../generate/gittrack'
import { epicWorktreeMain } from '../git/checkout'
import { initGuard } from '../guards/repo'
import { hasRunFailed } from '../host/steps'
import { t, tn } from '../locales/t'
import { GITIGNORE_FILE, isRepoFolder, roleJsonPath, SIZING_RUBRIC_PATH } from '../paths'
import { gitignoreLines, mergeIgnoreBlock } from '../plan/gitignore'
import { planReadPaths, planWithManifest, recordedCadreVersion, withRecordedHash } from '../plan/plan'
import { CLAUDE_MD_PLUGIN, GRILL_SKILLS, MATTPOCOCK_PLUGIN } from '../roles/infra'
import { parseRoleJson } from '../roles/rolejson'
import { standsFor } from '../roles/template'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { gatherScans, withStartSettings } from '../scan/gather'
import type { Gathered } from '../scan/gather'
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
import { attendedByConfig, compileAll, readTeam, teamFrameworks } from '../team'
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
import type { PaneSeat, SurfaceModule } from '../ui/surfaces/contract'
import { PANE_DESKTOP } from '../ui/surfaces/pane-desktop'
import type { Draft, PlanResult, Reframed, Reviewed } from './draft'
import { CONFLICT_CONTEXT, CONFLICT_DISMISSED_REASON, HUNK_TIMEOUT_MS } from './initapply'
import { consentedPluginKeys, initFrameworks, planState, privatesOf, repoPartsOf, withRepoRecords } from './initplan'
import type { PlanStepInput } from './initplan'
import { frameworksState, initialState, nextStage } from './machine'
import { cancelledText, frameworksInEpicReply } from './replies'
import { FRAMEWORK_LABELS, gsdCheckAsk } from './stages/frameworks'
import type {
  Answer,
  Applied,
  Effect,
  InitStage,
  InitState,
  IoCall,
  IoResult,
  ModelCall,
  ModelResult,
  Output,
} from './state'

/**
 * How `/cadre init` runs (D-105, T-03-16): --dry-run prints the plan and holds no host, so it can neither write nor
 * run; plain init writes the plan through `host` after Confirm. `surface` is the module of the surface the run shows
 * its context on, the desktop pane when absent (D-208, D-353); the init state carries it to the stages.
 */
export type InitOptions = ({ readonly dryRun: true } | { readonly dryRun: false; readonly host: HostIo }) & {
  readonly surface?: SurfaceModule
  /**
   * The columns a pane page or a Review page is drawn at (D-292): read before each step into the state the step gets,
   * so the stages see the width the pane has now; absent in tests and `-p`, where the width is unknown.
   */
  readonly pageColumns?: () => number | null
  /**
   * Where the pane is seated now (N-02, OC-04-I, D-353): the surface module's paged port reads it at each ask, as a
   * pane seated inline previews the whole context in the dialog, which pages cannot change; absent in tests and `-p`,
   * where no seat is known.
   */
  readonly paneSeat?: () => PaneSeat
  /**
   * The rows the pane body shows at its last render (RF-05): the surface module's paged port reads it at each ask;
   * absent in tests and `-p`, where no render is known.
   */
  readonly pageRows?: () => number | null
}

/** The status line the TUI default shows while the repo scans run (D-232). */
export const SCAN_PROGRESS = t('init.status.scan')

/** The status line the TUI default shows while the history scan reads the session transcripts (D-232). */
export const HISTORY_PROGRESS = t('init.status.history')

/** The status line or pane loader while apply runs the accepted hunks, once for all of them (D-284, edge #13). */
export const APPLY_HUNKS_PROGRESS = t('init.status.applyHunks')

/** The status line or pane loader while apply installs the plugins answered Install, once for all (D-284). */
export const INSTALL_PROGRESS = t('init.status.installPlugins')

/** The status line or pane loader while apply installs the frameworks consented to, once for all of them. */
export const FRAMEWORK_INSTALL_PROGRESS = t('init.status.installFrameworks')

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
  | 'frameworks'
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
 * The truthful file plan of init: the files desiredFiles gives from the repo state, every role's built CLAUDE.md
 * included when init passes repoParts, classified by planWithManifest against the disk, the last manifest and the
 * `.gitignore` block, and a sizing rubric already on disk never planned over (its entry carried). It reads only the
 * paths planReadPaths names and the root `.gitignore`, through readRepoFile, and writes nothing.
 */
export async function planStep(io: InitIo, input: PlanStepInput): Promise<PlanResult> {
  const { roles, policy, scopes, hunks, repo, locations, repoParts } = input
  const cadreVersion = recordedCadreVersion(await io.cadreVersion())
  const state = planState(input, cadreVersion)
  const parts = repoParts === undefined ? {} : { repoParts }
  const generated = desiredFiles({ roles, scopes, state, only: null, ...parts })
  const disk = await readPaths(io, locations.root, planReadPaths(generated))
  const isRubricThere = disk.get(SIZING_RUBRIC_PATH)?.state !== 'absent'
  const rubricEntry = repo.cadre.manifest?.files.find(file => file.path === SIZING_RUBRIC_PATH)
  const carried = isRubricThere && rubricEntry !== undefined ? [rubricEntry] : []
  const desired = isRubricThere ? generated.filter(file => file.path !== SIZING_RUBRIC_PATH) : generated
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
 * Each role's role.json against the disk, role.json being the input: `same` holds, at its disk hash, the entry of each
 * one whose disk text reads back as the role it renders, and `changed` the disk hash of each other one read as text.
 */
async function roleJsonSides(
  roles: readonly RoleSpec[],
  generated: readonly DesiredFile[],
  disk: ReadonlyMap<string, PortRead>,
): Promise<{ readonly same: readonly ManifestEntry[]; readonly changed: readonly ManifestEntry[] }> {
  const same: ManifestEntry[] = []
  const changed: ManifestEntry[] = []
  for (const role of roles) {
    const path = roleJsonPath(role.id)
    const file = generated.find(desired => desired.path === path)
    const read = disk.get(path)
    if (file === undefined || read?.state !== 'text') continue
    const entry: ManifestEntry = { path, sha256: await sha256Hex(read.text), mode: file.mode }
    const onDisk = parseRoleJson(read.text)
    if (onDisk !== null && roleJsonText(onDisk) === file.content) {
      same.push(entry)
      continue
    }
    changed.push(entry)
  }

  return { same, changed }
}

/**
 * The file plan of /cadre frameworks: every role's files, cadre.json and the index, rendered from the roles as their
 * role.json files give them and from the current scans, with no built CLAUDE.md, private file or `.gitignore` block. A
 * role.json whose disk text reads back as the role it renders is not planned and keeps its disk hash; a changed one is
 * planned against its disk hash as the last version, so it is a change, never a conflict. The sizing rubric is not
 * planned over while it is on disk, and every last manifest entry the plan does not desire is carried, so none is
 * left stale.
 */
export async function reframePlan(io: InitIo, input: PlanStepInput): Promise<PlanResult> {
  const { roles, scopes, hunks, repo, locations } = input
  const cadreVersion = recordedCadreVersion(await io.cadreVersion())
  const state = planState(input, cadreVersion)
  const generated = desiredFiles({ roles, scopes, state, only: null })
  const disk = await readPaths(io, locations.root, planReadPaths(generated))
  const { same, changed } = await roleJsonSides(roles, generated, disk)
  const samePaths = new Set(same.map(entry => entry.path))
  const isRubricThere = disk.get(SIZING_RUBRIC_PATH)?.state !== 'absent'
  const unplanned = new Set([...samePaths, ...(isRubricThere ? [SIZING_RUBRIC_PATH] : [])])
  const desired = generated.filter(file => !unplanned.has(file.path))
  const desiredPaths = new Set(desired.map(file => file.path))
  const last = repo.cadre.manifest
  const lastKept = (last?.files ?? []).filter(entry => !desiredPaths.has(entry.path) && !samePaths.has(entry.path))
  const recordAt = (manifest: Manifest, entry: ManifestEntry): Manifest =>
    withRecordedHash(manifest, entry.path, entry.sha256)
  const { plan, manifest } = await planWithManifest({
    desired,
    disk,
    manifest: last === null ? null : changed.reduce(recordAt, last),
    manifestState: repo.cadre.manifestState,
    carried: [...same, ...lastKept],
    gitignore: null,
    hunks,
    cadreVersion,
  })

  return { plan, state, desired, manifest, gitignore: null }
}

/**
 * What a role or repo default on a framework whose install `failed` falls back to: the first framework of the set
 * chosen, else of the installed ones, that did not fail, else none.
 */
function fallbackOf(draft: Pick<Draft, 'frameworkSet' | 'installed'>, failed: readonly FrameworkId[]): FrameworkId {
  return (draft.frameworkSet ?? draft.installed).find(id => !failed.includes(id)) ?? 'none'
}

/** The roles and repo default once the consented framework installs ran, those on a failed one moved to fallbackOf. */
function withoutFailedInstalls(
  draft: Pick<Draft, 'roles' | 'repoDefault' | 'frameworkSet' | 'installed'>,
  failed: readonly FrameworkId[],
): Pick<Draft, 'roles' | 'repoDefault'> {
  if (failed.length === 0) return { roles: draft.roles, repoDefault: draft.repoDefault }
  const fallback = fallbackOf(draft, failed)
  const kept = (framework: FrameworkId): FrameworkId => (failed.includes(framework) ? fallback : framework)
  const roles = draft.roles.map(role =>
    role.framework === undefined ? role : { ...role, framework: kept(role.framework) },
  )

  return { roles, repoDefault: draft.repoDefault === null ? null : kept(draft.repoDefault) }
}

/** The roles with the grill skills taken from every role standing for PM when mattpocock-skills did not install. */
function withoutFailedGrill(roles: readonly RoleSpec[], failed: readonly ProjectInstall[]): readonly RoleSpec[] {
  if (!failed.some(install => install.id === MATTPOCOCK_PLUGIN)) return roles

  return roles.map(role =>
    standsFor(role, 'pm') ? { ...role, skills: role.skills.filter(skill => !GRILL_SKILLS.includes(skill)) } : role,
  )
}

/**
 * One problem line per consented framework install that did not land, in `failed` order: the roles and the repo
 * default on it, what they fell back to (fallbackOf), and the command to run.
 */
function fallbackProblems(
  draft: Pick<Draft, 'roles' | 'repoDefault' | 'frameworkSet' | 'installed'>,
  failed: readonly FrameworkId[],
): string[] {
  const fallback = FRAMEWORK_LABELS[fallbackOf(draft, failed)]

  return failed.flatMap(id => {
    const install = projectInstallOf(id)
    if (install === null) return []
    const fallen = {
      name: FRAMEWORK_LABELS[id],
      command: install.argv.join(' '),
      roles: draft.roles.filter(role => role.framework === id).map(role => role.id),
      isRepoDefault: draft.repoDefault === id,
      fallback,
    }

    return [frameworkFallbackText(fallen)]
  })
}

/**
 * The Keep mine or Take new answer of each conflicted file of the confirmed plan, in plan order, each asked with the
 * file's diff from the disk as its context; a dismissal or no usable answer cancels.
 */
async function askedConflicts(
  io: InitIo,
  root: string,
  planned: Pick<PlanResult, 'plan' | 'desired'>,
): Promise<StepResult<ReadonlyMap<string, ConflictChoice>>> {
  const choices = new Map<string, ConflictChoice>()
  for (const path of conflictPaths(planned.plan)) {
    const disk = await readRepoFile(io, root, path, MAX_READ_BYTES)
    const desired = planned.desired.find(file => file.path === path)
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

  return accepted(choices)
}

/**
 * Runs the consented framework installs, then the consented project plugin installs, in one project-scope call, and
 * reads the facts again when a framework install ran, since only they tell whether it worked: `failed` holds the
 * installs whose framework is still not installed once the facts are read again, and `landed` the others.
 */
async function projectInstalled(
  io: InitIo,
  host: HostIo,
  draft: Pick<
    Draft,
    | 'locations'
    | 'gathered'
    | 'roles'
    | 'repoDefault'
    | 'frameworkSet'
    | 'installed'
    | 'frameworkInstalls'
    | 'projectPluginInstalls'
  >,
): Promise<{
  readonly scanned: Gathered
  readonly failed: readonly FrameworkId[]
  readonly landed: readonly FrameworkId[]
  readonly roles: readonly RoleSpec[]
  readonly repoDefault: FrameworkId | null
  readonly landedPlugins: readonly ProjectInstall[]
  readonly failedPlugins: readonly ProjectInstall[]
}> {
  const { locations, gathered } = draft
  const frameworkInstalls = (draft.frameworkInstalls ?? []).flatMap(id => projectInstallOf(id) ?? [])
  const pluginInstalls = (draft.projectPluginInstalls ?? []).map(projectPluginInstall)
  if (frameworkInstalls.length > 0) {
    await io.progress(FRAMEWORK_INSTALL_PROGRESS, countsText([['frameworks', frameworkInstalls.length]]))
  }
  if (frameworkInstalls.length === 0 && pluginInstalls.length > 0) {
    await io.progress(INSTALL_PROGRESS, countsText([['plugins', pluginInstalls.length]]))
  }
  const projectInstalls = [...frameworkInstalls, ...pluginInstalls]
  const projected = await installProject(host, locations.root, locations.home, projectInstalls)
  const scanned = frameworkInstalls.length > 0 ? { ...gathered, facts: await io.facts(locations) } : gathered
  const failed = (draft.frameworkInstalls ?? []).filter(id => !adapterOf(id).isInstalled(scanned.facts.facts))
  const landed = (draft.frameworkInstalls ?? []).filter(id => !failed.includes(id))
  const landedPlugins = pluginInstalls.filter(install => projected.installed.includes(install.id))
  const failedPlugins = pluginInstalls.filter(install => !projected.installed.includes(install.id))
  const fallen = withoutFailedInstalls(draft, failed)
  const roles = withoutFailedGrill(fallen.roles, failedPlugins)

  return { scanned, failed, landed, roles, repoDefault: fallen.repoDefault, landedPlugins, failedPlugins }
}

/**
 * Runs each accepted hunk cadre can run, in hunk order from the repo root, through a proven user-level GSD only, and
 * gives the failed runs, the hunks after them, a failed one no longer runnable, and the accepted hunks not run.
 */
async function hunksRan(
  io: InitIo,
  host: HostIo,
  draft: Pick<Draft, 'locations' | 'gathered' | 'hunks'>,
): Promise<{
  readonly failures: readonly HunkRun[]
  readonly hunks: readonly HunkOp[]
  readonly notRun: readonly HunkOp[]
}> {
  const { locations, gathered } = draft
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

  return { failures, hunks, notRun: hunksNotRun(draft.hunks, runs) }
}

/** The scopes compiled again from the setup after the installs, with attended judged again from the config on disk. */
async function compiledAfter(
  io: InitIo,
  after: {
    readonly locations: InitLocations
    readonly scanned: Gathered
    readonly setup: SetupScan
    readonly roles: readonly RoleSpec[]
    readonly repoDefault: FrameworkId | null
    readonly launchStart: LaunchStart
    readonly recorded: { readonly frameworks?: readonly FrameworkId[]; readonly sizing: Sizing }
  },
): Promise<ReadonlyMap<string, CompiledScope>> {
  const { locations, scanned, setup, roles, repoDefault, launchStart, recorded } = after
  const frameworksRun = repoFrameworks({ framework: repoDefault, ...recorded })
  const attended = await attendedByConfig(io, locations.root, teamFrameworks(roles, repoDefault, frameworksRun), setup)

  return compileAll(
    roles,
    repoDefault,
    { ...scanned, setup },
    attended,
    launchStart,
    frameworksRun,
    locations.root,
  )
}

/**
 * Writes the plan the person confirmed: the conflict questions first, then the framework and plugin installs and the
 * hunk runs, the plan made again from the disk with the repo parts git tracks and each role's private files, and its
 * steps through writeWithImprover, the improver on each private text file with a global part when claude-md-management
 * is installed and the manifest last. Failed installs, hunk runs, untracked parts and private-file problems become
 * reply lines; a dismissed conflict question cancels with nothing written or run.
 */
async function applyConfirmed(
  io: InitIo,
  host: HostIo,
  reviewed: Reviewed,
): Promise<StepResult<{ readonly planned: PlanResult; readonly outcome: ApplyOutcome }>> {
  const { draft } = reviewed
  const { locations, gathered, launchStart } = draft
  const asked = await askedConflicts(io, locations.root, reviewed.planned)
  if (asked.kind === 'cancelled') return asked
  const choices = asked.value
  const ran = await projectInstalled(io, host, draft)
  const { scanned, failed, landed, roles, repoDefault, landedPlugins, failedPlugins } = ran
  const { failures, hunks, notRun } = await hunksRan(io, host, draft)
  const shownHunks = hunksShown(hunks, notRun, gathered.setup, scanned.facts, locations, failed)
  const installCount = countsText([['plugins', draft.pluginInstalls.length]])
  if (locations.home !== null && draft.pluginInstalls.length > 0) await io.progress(INSTALL_PROGRESS, installCount)
  const installs =
    locations.home === null
      ? { installed: [], installProblems: draft.pluginInstalls.map(noHomeInstallText) }
      : await installPlugins(host, locations.home, draft.pluginInstalls)
  const landedKeys = landedPlugins.map(install => install.id)
  const setup = setupAfterInstalls(gathered.setup, [
    ...installs.installed,
    ...consentedPluginKeys(draft, failed),
    ...landedKeys,
  ])
  const recorded = initFrameworks(draft, failed)
  const scopes = await compiledAfter(io, { locations, scanned, setup, roles, repoDefault, launchStart, recorded })
  const tracked = await trackedParts(host, locations.root, repoPartsOf(draft.instructions))
  const owed = privatesOf(draft.instructions, roles)
  const privatePlan = await privatePlanOf(io, host, locations, { roles, owed })
  const planned = await planStep(io, {
    roles: withRepoRecords(roles, draft.instructions, tracked.repoParts),
    repoDefault,
    policy: draft.policy,
    launchStart,
    scopes,
    hunks: shownHunks,
    repo: gathered.repo,
    locations,
    readUserMcp: draft.readUserMcp,
    repoParts: tracked.repoParts,
    ...recorded,
    ...(draft.structure === undefined ? {} : { structure: draft.structure }),
  })
  const input: ApplyInput = { ...planned, choices, privates: privatePlan.privates }
  // A plan and desired files that disagree are refused before the first apply step: nothing is written (D-272 #33).
  const problem = planMismatchProblem(input.plan, input.desired)
  const steps = problem === null ? await applySteps(input) : []
  const isImproverReady = setup.installedPlugins.includes(CLAUDE_MD_PLUGIN)
  const privateFolders = new Set(privatePlan.privates.flatMap(role => (role.parts.length > 0 ? [role.folder] : [])))
  const offered = problem === null && isImproverReady ? builtRoleFiles(steps, { privateFolders }) : []
  const allowed = privatePlan.allowed
  if (offered.length > 0) await io.progress(IMPROVER_PROGRESS, countsText([['files', offered.length]]))
  const written =
    problem === null
      ? await writeWithImprover(io, host, { locations, input, steps, offered, allowed })
      : { ...NOTHING_APPLIED, refused: [problem], manifestSkipped: true }
  const required = new Set(hunks.filter(hunk => hunk.isRequired).map(hunk => hunk.key))
  const outcome: ApplyOutcome = {
    ...written,
    hunkFailures: failures,
    notRunLines: hunkNotRunLines(notRun, gathered.setup, scanned.facts, locations, failed),
    attended: failures.filter(run => required.has(run.key)).map(run => run.key),
    installed: [...landed.flatMap(id => projectInstallOf(id)?.id ?? []), ...landedKeys, ...installs.installed],
    installProblems: [
      ...fallbackProblems(draft, failed),
      ...failedPlugins.map(projectInstallFailureText),
      ...installs.installProblems,
    ],
    untrackedParts: tracked.warnings,
    privateProblems: [...privatePlan.problems, ...written.privateProblems],
  }

  return accepted({ planned, outcome })
}

/**
 * Writes the plan of /cadre frameworks the person confirmed, in this order: the Keep mine or Take new question of
 * each conflicted file, the consented framework installs with the facts read again (a role or the repo default on one
 * that failed falls back), the accepted hunks, the scopes compiled again from the setup after the installs, and the
 * plan made again from the disk (reframePlan), written through the host with the manifest last; a plan whose ops and
 * files disagree writes nothing. No private file is written, no improver and no git command runs.
 */
export async function reframeApplied(io: InitIo, host: HostIo, reframed: Reframed): Promise<StepResult<Applied>> {
  const { draft } = reframed
  const { locations, gathered, launchStart } = draft
  const asked = await askedConflicts(io, locations.root, reframed.planned)
  if (asked.kind === 'cancelled') return asked
  const { scanned, failed, landed, roles, repoDefault } = await projectInstalled(io, host, draft)
  const { failures, hunks, notRun } = await hunksRan(io, host, draft)
  const shownHunks = hunksShown(hunks, notRun, gathered.setup, scanned.facts, locations, failed)
  const setup = setupAfterInstalls(gathered.setup, consentedPluginKeys(draft, failed))
  const recorded = initFrameworks(draft, failed)
  const scopes = await compiledAfter(io, { locations, scanned, setup, roles, repoDefault, launchStart, recorded })
  const planned = await reframePlan(io, {
    roles,
    repoDefault,
    policy: draft.policy,
    launchStart,
    scopes,
    hunks: shownHunks,
    repo: gathered.repo,
    locations,
    readUserMcp: draft.readUserMcp,
    ...recorded,
    ...(draft.structure === undefined ? {} : { structure: draft.structure }),
  })
  const problem = planMismatchProblem(planned.plan, planned.desired)
  const steps = problem === null ? await applySteps({ ...planned, choices: asked.value }) : []
  const written =
    problem === null
      ? await writeSteps(io, host, locations, steps, new Set())
      : { ...NOTHING_APPLIED, refused: [problem], manifestSkipped: true }
  const required = new Set(hunks.filter(hunk => hunk.isRequired).map(hunk => hunk.key))
  const outcome: ApplyOutcome = {
    ...written,
    hunkFailures: failures,
    notRunLines: hunkNotRunLines(notRun, gathered.setup, scanned.facts, locations, failed),
    attended: failures.filter(run => required.has(run.key)).map(run => run.key),
    installed: landed.flatMap(id => projectInstallOf(id)?.id ?? []),
    installProblems: fallbackProblems(draft, failed),
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
 * hold, so it gives none there. The scans and the history scan first set their status line (D-232). The frameworks
 * flow's plan (reframePlan) and its apply (reframeApplied) run the same way.
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
    case 'reframe-plan':
      return { id: 'reframe-plan', result: await reframePlan(io, call.input) }
    case 'reframe-apply': {
      const result = options.dryRun ? null : await reframeApplied(io, options.host, call.reframed)

      return { id: 'reframe-apply', result }
    }
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
 * Performs a state's effect, the runner's one way to do so: an ask asks `state.openQuestion`, its question and spec,
 * never the effect's copy; an ask with no open question, or the end, gives null, so the run ends with the flow's
 * cancel text (fail closed); a host operation or a model call goes through perform.
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
  return runStates(pagedOf(io, options), options, initialState(options.dryRun, options.surface))
}

/**
 * `/cadre frameworks`: the framework step of init again for a team init wrote. Before any question it refuses as
 * initGuard does for this command (`claude -p`, the repo checks, an active autopilot run), in an epic worktree, found
 * from its files so a --dry-run checks too, and as readTeam does (no cadre.json, a bad role.json; a team with no
 * default framework runs). It then scans with the ~/.claude.json consent cadre.json stores, with the start folder's
 * settings of a dir start (withStartSettings), and runs the frameworks flow from the stored team (frameworksState): the
 * set question, each install offer, the mode questions and GSD's hunks, then the review of the files that change,
 * which a --dry-run ends with the plan and a plain run writes after Confirm.
 */
export async function runFrameworks(io: InitIo, options: InitOptions): Promise<string> {
  const paged = pagedOf(io, options)
  const guard = await initGuard(paged, 'frameworks')
  if (guard.kind === 'refuse') return guard.text
  const { locations } = guard
  const { root } = locations
  const main = await epicWorktreeMain(paged, root)
  if (main !== null) return frameworksInEpicReply(main)
  const team = await readTeam(paged, root, 'frameworks', null)
  if (team.kind === 'refuse') return team.text
  await paged.progress(SCAN_PROGRESS, SCAN_SUMMARY)
  const scanned = await gatherScans(paged, locations, team.value.state.readUserMcp)
  const gathered = await withStartSettings(paged, scanned, locations.root, team.value.state.launchStart)
  const first = frameworksState(options.dryRun, options.surface, { locations, gathered, team: team.value })

  return runStates(paged, options, first)
}

/**
 * The port every question of a run goes through, the surface module's paged port: on a pane surface a context over
 * the frame cap is asked a page at a time at the width read before each ask, and whole while the pane is seated inline.
 */
function pagedOf(io: InitIo, options: InitOptions): InitIo {
  return (options.surface ?? PANE_DESKTOP).pagedPort(io, {
    columns: () => options.pageColumns?.() ?? null,
    seat: () => options.paneSeat?.() ?? null,
    rows: () => options.pageRows?.() ?? null,
  })
}

/** Runs the stage machine from `first` until an end effect gives the reply. */
async function runStates(paged: InitIo, options: InitOptions, first: InitState): Promise<string> {
  let state = first
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
    const folds = state.surface.foldsOf(bound)
    const open = openQuestion === null ? null : { ...openQuestion, spec: foldedSpec(openQuestion.spec, folds) }
    const answer = await performState(paged, options, { ...state, openQuestion: open })
    if (answer === null) return cancelledText(state.flow)
    state = nextStage({ ...state, outputs: [], pageColumns: options.pageColumns?.() ?? null }, answer)
  }
}
