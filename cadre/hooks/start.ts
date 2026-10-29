/**
 * The gather and render halves of /cadre start (D-102); renderRole, which gathers and renders one role for the root it
 * is given, the session's for /cadre start and an epic worktree for /cadre epic (D-157); and runStart, the command
 * itself, which checks the repo and the team, runs renderRole through the HostIo port and hands over the launcher
 * command: printed, copied to the clipboard and, with `--terminal`, opened in a new terminal on macOS (LNCH-04, D-110,
 * D-109).
 *
 * The gather half reads, through the InitIo and HostIo ports only, and never writes: the facts about the launching
 * user that a role launch needs (gatherLaunchUser, D-98), and the user's `~/.claude.json` under the stored consent
 * (readClaudeJson, D-58), from which runtimeMcpText renders a role's MCP config (D-93).
 *
 * The render half gives the ordered steps that write a role's per-launch files into `.cadre/<id>/.runtime/`, and the
 * role's private instructions folder under the config folder (privateFolderSteps), from its LaunchPlan (D-98) and the
 * texts of its MCP config and probe expectations. It reads and writes nothing: /cadre start stats and lists the paths
 * renderPaths names, then runs the steps renderSteps gives, in order, through the host. The stamp is always the last
 * step, and the launcher trusts it: it refuses to start when the stamp is missing or older than the role files or a
 * rendered file, so a render that stops part way never starts a session (LNCH-03).
 */
import type {
  CadreState,
  CompiledScope,
  DesiredFile,
  HostIo,
  InitIo,
  InitLocations,
  LaunchStart,
  PortEntry,
  PortStat,
  RoleSpec,
  SettingsSource,
  TerminalChoice,
} from '../types'
import { privateLevelsProblem, roleFolderLevels } from './apply/safety'
import { sha256Hex } from './core/hash'
import { isObject, parseJsonValue, stableJson } from './core/json'
import { clean, compareText, reportText, shown, sortedUnique } from './core/text'
import { desiredFiles } from './generate/files'
import { gitCommonDirOf, mainCheckoutOf } from './git/common-dir'
import { repoGuard } from './guards/repo'
import { isStepDone } from './host/steps'
import { isPartsFlowRole } from './launch/links'
import type { LaunchUser, OverlayLink } from './launch/links'
import { launchPlan } from './launch/plan'
import type { LaunchPlan } from './launch/plan'
import {
  claudeJsonPathOf,
  displayPath,
  launcherPath,
  MARKDOWN_EXTENSION,
  markdownFileNames,
  memoryFolderOf,
  PRIVATE_INSTRUCTIONS_LINK,
  privateInstructionsDir,
  roleMemoryDir,
  trimSlash,
  userDirOf,
} from './paths'
import { MANIFEST_PATH } from './plan/classify'
import { expectationsFor, probeExpectationsText } from './probe'
import { MAX_READ_BYTES } from './scan/facts/normalize'
import { SOURCE_ORDER } from './scan/facts/settings'
import { scanWarnings } from './scan/gather'
import { claudeMdImports } from './scan/instructions/imports'
import { readRepoFile } from './scan/port-read'
import { ruleFiles, RULES_FOLDER } from './scan/rules'
import { claudeMdPathsOf } from './scan/setup/claude-md'
import { CLAUDE_JSON_MAX_BYTES } from './scan/setup/mcp'
import { hookScriptOf } from './scan/setup/settings'
import { linkedMemoriesOf } from './start/memory-links'
import {
  isPlainName,
  NO_MEMORY_LINKS,
  parentOf,
  renderPaths,
  renderSteps,
  repoRelative,
  runtimeFolder,
  stampText,
} from './start/render-plan'
import type { MemoryLinks, RenderInput } from './start/render-plan'
import { parseManifest } from './state/cadre-files'
import { compileTeam, readTeam, regenBadRole } from './team'
import type { RegenRead } from './team'
import { terminalHostOf } from './ui/open'
import {
  clipboardRun,
  COPIED_LINE,
  launcherCommand,
  NOT_COPIED_LINE,
  TERMINAL_OPEN_TIMEOUT_MS,
  terminalPlan,
} from './ui/terminal'

/** The refusal when there is no HOME: the role files are rendered from the user's own folder (D-98). */
export const START_NO_HOME = 'cadre start needs HOME to render the role files, so it stopped.'

/**
 * The refusal when git gives no common dir, which names the role memory folders (D-91): the run failed, or it gave no
 * absolute path, as a git older than 2.31 does with `--path-format=absolute` (#72 A4).
 */
export const START_NO_GIT_DIR =
  'cadre start could not read the git common dir (git rev-parse failed or gave no absolute path; ' +
  'git 2.31 or newer is needed), so it stopped.'

/** The /cadre start refusal for a role memory folder level it would write through (02-GAPS-B3 C5). */
export function privateFolderRefusal(path: string, reason: 'link' | 'not-folder' | 'unchecked'): string {
  const stopped = `cadre start stopped: ${path}`
  const end = 'cadre does not write through it'
  if (reason === 'link') return `${stopped} is a link; ${end}`
  if (reason === 'not-folder') return `${stopped} is not a folder; ${end}`

  return `${stopped} could not be checked for links; ${end}`
}

/**
 * What gatherLaunchUser gives: the launching user's facts with the warnings to show and what to do in the role memory
 * folder (MemoryLinks, G-02-1f), or the exact refusal.
 */
export type LaunchUserRead =
  | {
      readonly kind: 'ok'
      readonly user: LaunchUser
      readonly warnings: readonly string[]
      readonly memories: MemoryLinks
    }
  | { readonly kind: 'refuse'; readonly text: string }

/** The file names the host is asked for in each folder from the file system root down to the repo (D-57). */
const CLAUDE_MD_FILES: readonly string[] = Object.freeze(['CLAUDE.md', '.claude/CLAUDE.md'])

/** How many import hops from the global CLAUDE.md are followed (D-63). */
const MAX_IMPORT_DEPTH = 5

/** The most files the global CLAUDE.md and its imports give a role. */
const MAX_GLOBAL_FILES = 20

/** The settings sources whose hooks a git-root start renders: it loads the project settings by itself (D-103). */
const ROOT_HOOK_SOURCES: readonly SettingsSource[] = Object.freeze(['user', 'local'])

/** One hook of the user's settings as a launch carries it. */
type LaunchHook = LaunchUser['hooks'][number]

/** The compact window when it is a positive safe integer, else null, as the setup scan keeps it (D-60). */
function compactWindowOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * The values a role may carry from the user settings (D-60, D-84): `autoCompactWindow` when it is a positive safe
 * integer, the `statusLine` object as read, and each `env` entry whose value is a string; null, null and {} for a value
 * that is missing or not of that kind, and for anything but a plain object. Only what a role carries is rendered
 * (launchPlan), into runtime files, never into a reply.
 */
export function launchSettingsOf(user: unknown): Pick<LaunchUser, 'autoCompactWindow' | 'statusLine' | 'env'> {
  if (!isObject(user)) return { autoCompactWindow: null, statusLine: null, env: {} }
  const env = isObject(user.env) ? Object.entries(user.env) : []

  return {
    autoCompactWindow: compactWindowOf(user.autoCompactWindow),
    statusLine: isObject(user.statusLine) ? user.statusLine : null,
    env: Object.fromEntries(env.filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  }
}

/** A hook timeout in seconds when it is a positive finite number, else null. */
function timeoutOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** One hook of a settings group as a launch carries it; null when it is not a command hook with a script basename. */
function launchHookOf(event: string, matcher: string | null, hook: unknown): LaunchHook | null {
  if (!isObject(hook) || hook.type !== 'command' || typeof hook.command !== 'string') return null
  const script = hookScriptOf(hook.command)
  if (script === null) return null

  return { event, script, command: hook.command, matcher, timeout: timeoutOf(hook.timeout) }
}

/** The command hooks of one settings group, with the group's matcher; none when the group is not of that shape. */
function groupHooks(event: string, group: unknown): LaunchHook[] {
  if (!isObject(group) || !Array.isArray(group.hooks)) return []
  const matcher = typeof group.matcher === 'string' ? group.matcher : null

  return group.hooks.flatMap(hook => launchHookOf(event, matcher, hook) ?? [])
}

/**
 * The command hooks under `hooks` of one settings value, as a launch carries them (D-62, D-103): for each event, each
 * group and each hook of type `command`, in the order the settings give them, the event, the script basename
 * (hookScriptOf), the whole command, the group's matcher (null when it has none) and the timeout when it is a positive
 * finite number (else null). A hook with no script basename a role can carry is dropped, and so is anything not of that
 * shape. The whole command is only ever written to runtime files, never to a reply or a warning.
 */
export function launchHooksOf(value: unknown): LaunchUser['hooks'] {
  if (!isObject(value) || !isObject(value.hooks)) return []

  return Object.entries(value.hooks).flatMap(([event, groups]) =>
    Array.isArray(groups) ? groups.flatMap(group => groupHooks(event, group)) : [],
  )
}

/**
 * The settings sources whose hooks a launch renders into the runtime settings (D-103): the user and local settings
 * always, as `--setting-sources project` loads neither, and the project settings only for a `here` or `dir` start,
 * which loads the project settings of its own folder and not those of the git root (D-122). A git-root start loads
 * them by itself, so rendering them too would register each project hook twice (RESEARCH Pitfall 9).
 */
export function hookSourcesFor(start: LaunchStart): readonly SettingsSource[] {
  return start.kind === 'git-root' ? ROOT_HOOK_SOURCES : SOURCE_ORDER
}

/** Whether a path's stat, asked with resolve, shows a regular file. */
async function isFile(io: InitIo, path: string): Promise<boolean> {
  return (await io.stat(path))?.kind === 'file'
}

/** The files a CLAUDE.md imports (claudeMdImports); none when it cannot be read or is over MAX_READ_BYTES. */
async function importsOf(io: InitIo, path: string, home: string): Promise<string[]> {
  const read = await io.read(path, MAX_READ_BYTES)
  if (read.state !== 'text') return []

  return claudeMdImports(read.text, parentOf(path), home)
}

/**
 * The global CLAUDE.md and the files it imports (D-63, D-100): `<userDir>/CLAUDE.md` first, then its imports breadth
 * first through claudeMdImports, each file once, at most MAX_IMPORT_DEPTH hops from the global file and
 * MAX_GLOBAL_FILES files in all. Only a path whose stat is a regular file is kept, and a file that cannot be read is
 * kept with no imports. Empty when there is no global file.
 */
async function globalClaudeMdOf(io: InitIo, userDir: string, home: string): Promise<string[]> {
  const found: string[] = []
  const seen = new Set<string>()
  let level = [`${userDir}/CLAUDE.md`]
  for (let depth = 0; depth <= MAX_IMPORT_DEPTH && level.length > 0; depth += 1) {
    const next: string[] = []
    for (const path of level) {
      if (seen.has(path) || found.length === MAX_GLOBAL_FILES) continue
      seen.add(path)
      if (!(await isFile(io, path))) continue
      found.push(path)
      if (depth < MAX_IMPORT_DEPTH) next.push(...(await importsOf(io, path, home)))
    }
    level = next
  }

  return found
}

/** The names of the regular `.md` files in a folder, sorted; a link, a folder or a listing that fails gives none. */
async function markdownFiles(io: InitIo, folder: string): Promise<string[]> {
  const entries = (await io.list(folder)) ?? []

  return sortedUnique(markdownFileNames(entries))
}

/** The `.md` file names of the auto-memory folder the engine keeps for a project root in the user folder (D-100). */
async function memoryFilesOf(io: InitIo, userDir: string, root: string): Promise<string[]> {
  return markdownFiles(io, memoryFolderOf(userDir, root))
}

/** The user's skills: the folders and links in `<userDir>/skills`, sorted; a listing that fails gives none. */
async function userSkillsOf(io: InitIo, userDir: string): Promise<string[]> {
  const entries = (await io.list(`${userDir}/skills`)) ?? []

  return sortedUnique(entries.filter(entry => entry.kind === 'dir' || entry.isLink).map(entry => entry.name))
}

/** The user's agents: the regular `.md` files in `<userDir>/agents`, by name without `.md`, sorted. */
async function userAgentsOf(io: InitIo, userDir: string): Promise<string[]> {
  const names = await markdownFiles(io, `${userDir}/agents`)

  return sortedUnique(names.map(name => name.slice(0, -MARKDOWN_EXTENSION.length)))
}

/** Whether a listed entry is a file or a link: a linked file loads like one, so it is counted too (fails closed). */
function isFileOrLink(entry: PortEntry): boolean {
  return entry.kind === 'file' || entry.isLink
}

/**
 * The rule files the engine loads for the root (G-02-1f, T-02-70): `<root>/.claude/rules/<path>` for each `*.md` file
 * or link of that folder, its sub-folders walked too (ruleFiles, 02-GAPS-B2 M4: at most 5 levels and 500 entries; links
 * taken, as files or folders, and any folder with a stat listed), absolute and sorted. A walk that fails counts as
 * empty, and a sub-folder that cannot be listed as empty, as before.
 */
async function rulesOf(io: InitIo, root: string): Promise<string[]> {
  const rules = await ruleFiles(io, root, { isTakenLink: true, isFolderUsable: stat => stat !== null })

  return (rules ?? []).map(name => `${root}/${RULES_FOLDER}/${name}`)
}

/** The file name of a role's built instructions in its folder (G-02-1f). */
const ROLE_CLAUDE_MD = 'CLAUDE.md'

/**
 * The built role files of the repo (G-02-1f, T-02-70): `<root>/.cadre/<name>/CLAUDE.md` for each folder or link that
 * `<root>/.cadre` lists with a plain name whose own listing holds a `CLAUDE.md` file or link, the folders of roles no
 * longer on the team included, so excluding them fails closed; absolute and sorted. A listing that fails counts as
 * empty.
 */
async function roleClaudeMdsOf(io: InitIo, root: string): Promise<string[]> {
  const cadre = `${root}/.cadre`
  const listed = (await io.list(cadre)) ?? []
  const folders = listed.filter(item => (item.kind === 'dir' || item.isLink) && isPlainName(item.name))
  const found: string[] = []
  for (const folder of folders) {
    const entries = (await io.list(`${cadre}/${folder.name}`)) ?? []
    if (!entries.some(item => item.name === ROLE_CLAUDE_MD && isFileOrLink(item))) continue
    found.push(`${cadre}/${folder.name}/${ROLE_CLAUDE_MD}`)
  }

  return sortedUnique(found)
}

/**
 * The launching user's facts (D-98), gathered in the root session through the ports:
 * - the repo root as resolved and as given, the home folder, and the user folder (CLAUDE_CONFIG_DIR, else
 *   `<home>/.claude`);
 * - the git common dir from GIT_COMMON_DIR_ARGV run at the root, as the realpath of its stat when the host resolves
 *   it, else as git gave it, with its SHA-256 (gitCommonDirOf): they name the role memory folders (roleMemoryDir,
 *   D-20, D-91); and, for a root that lies below the main checkout of its git common dir (mainCheckoutOf), that
 *   checkout as `mainRoot`, set before the memories are linked, so a linked worktree links and denies main's memory
 *   folder and gets main's code-dir denies (03.1-W3 M1, S1);
 * - the carried values of the user settings (launchSettingsOf) and the hooks of each source hookSourcesFor names for
 *   the launch start (launchHooksOf, D-103);
 * - the CLAUDE.md chain the host's ancestors list gives (claudeMdPathsOf), the rule files of `.claude/rules` (rulesOf)
 *   and the built role files of `.cadre` (roleClaudeMdsOf), which a parts-flow role excludes (G-02-1f), the global
 *   CLAUDE.md with its imports, the `.md` files of the memory folders of the root as resolved and as given, the user's
 *   skills and agents, and the code dirs given;
 * - for a parts-flow role (isPartsFlowRole), the memories its hand-out record names, linked into its role memory
 *   folder with cadre's MEMORY.md block (linkedMemoriesOf, G-02-1f, D-140 q3-a): their link paths are the user's
 *   linkedMemories, and the links, removals and MEMORY.md write go to the render (`memories`) with their warnings. A
 *   whole-files role gets none, as its memories are linked under `.runtime/instructions/` (instructionPlan).
 * A listing or read that fails counts as empty. It refuses with START_NO_HOME when there is no home folder, before
 * any run, and with START_NO_GIT_DIR when git gives no absolute path. Then each level of the role memory folder
 * (roleFolderLevels: `<userDir>/cadre`, `<repo>-<hash8>`, the role memory folder and its instructions/ subfolder) is
 * stat'ed, and `<userDir>` and each level but the last listed, and it refuses with privateFolderRefusal when
 * privateLevelsProblem finds a level that is a link, is not a folder, or whose parent could not be listed (02-GAPS-B3
 * C5), before any step runs; `<userDir>` itself is never checked, as a linked config folder is common. No setting
 * value, hook command or file text is ever part of a refusal or a warning.
 */
export async function gatherLaunchUser(
  io: InitIo,
  host: HostIo,
  input: {
    readonly locations: InitLocations
    readonly launchStart: LaunchStart
    readonly codeDirs: readonly string[]
    /** The role to launch; a parts-flow role gets the memories its hand-out record names linked (G-02-1f). */
    readonly role: Pick<RoleSpec, 'id' | 'instructions'>
  },
): Promise<LaunchUserRead> {
  const { locations } = input
  const { home } = locations
  const userDir = userDirOf(locations)
  if (home === null || userDir === null) return { kind: 'refuse', text: START_NO_HOME }
  const commonDir = await gitCommonDirOf(io, host, locations.root)
  if (commonDir === null) return { kind: 'refuse', text: START_NO_GIT_DIR }
  const levels = roleFolderLevels(roleMemoryDir({ userDir, ...commonDir }, input.role.id))
  const stats = new Map<string, PortStat | null>()
  for (const level of levels) stats.set(level, await io.stat(level))
  const listings = new Map<string, readonly PortEntry[] | null>()
  for (const folder of [userDir, ...levels.slice(0, -1)]) listings.set(folder, await io.list(folder))
  const problem = privateLevelsProblem(levels, stats, listings)
  if (problem !== null) {
    const shownPath = displayPath(problem.path, home, locations.root)

    return { kind: 'refuse', text: privateFolderRefusal(shownPath, problem.reason) }
  }
  const hooks: LaunchHook[] = []
  for (const source of hookSourcesFor(input.launchStart)) hooks.push(...launchHooksOf(await io.settings(source)))
  const main = mainCheckoutOf(commonDir.gitCommonDir, locations.root)
  const user: LaunchUser = {
    root: locations.root,
    givenRoot: locations.givenRoot,
    home,
    userDir,
    ...commonDir,
    ...(main === null ? {} : { mainRoot: main }),
    ...launchSettingsOf(await io.settings('user')),
    hooks,
    claudeMd: claudeMdPathsOf(await io.ancestors(CLAUDE_MD_FILES)),
    rules: await rulesOf(io, locations.root),
    roleClaudeMds: await roleClaudeMdsOf(io, locations.root),
    globalClaudeMd: await globalClaudeMdOf(io, userDir, home),
    memoryFiles: await memoryFilesOf(io, userDir, locations.root),
    givenMemoryFiles: await memoryFilesOf(io, userDir, locations.givenRoot),
    userSkills: await userSkillsOf(io, userDir),
    userAgents: await userAgentsOf(io, userDir),
    codeDirs: input.codeDirs,
    linkedMemories: [],
  }
  if (!isPartsFlowRole(input.role)) return { kind: 'ok', user, warnings: [], memories: NO_MEMORY_LINKS }
  const { memories, warnings } = await linkedMemoriesOf(io, user, input.role.id)
  const linkedMemories = memories.links.map(link => link.path)

  return { kind: 'ok', user: { ...user, linkedMemories }, warnings, memories }
}

/** The warning for a role given MCP servers when cadre.json records no consent to read ~/.claude.json (D-58). */
const MCP_NOT_READ_WARNING =
  '~/.claude.json was not read (no consent at init), so the user-scope MCP servers of this role are not rendered'

/** The warning for a server a role is given that ~/.claude.json does not hold; the name is shown cleaned. */
function mcpNotInFileWarning(name: string): string {
  return (
    `MCP server ${reportText(name)} is not in ~/.claude.json: ` +
    'the role gets it only from the repo .mcp.json or a claude.ai connector'
  )
}

/**
 * The user's `~/.claude.json` as a parsed value (D-93), read only when cadre.json records the consent (readUserMcp,
 * D-58): without it nothing is read. The file is the one claudeJsonPathOf names, read up to CLAUDE_JSON_MAX_BYTES.
 * Null when the read is not allowed, there is no user folder, or the file is absent, unreadable, too large or not
 * JSON. Its values reach only the runtime MCP config (runtimeMcpText), never a reply or a warning.
 */
export async function readClaudeJson(io: InitIo, locations: InitLocations, readUserMcp: boolean): Promise<unknown> {
  if (!readUserMcp) return null
  const path = claudeJsonPathOf(locations)
  if (path === null) return null
  const read = await io.read(path, CLAUDE_JSON_MAX_BYTES)
  if (read.state !== 'text') return null

  return parseJsonValue(read.text)?.value ?? null
}

/** The config of a server in the `mcpServers` of a holder, when it is a plain object there; else null. */
function serverIn(holder: unknown, name: string): Record<string, unknown> | null {
  if (!isObject(holder) || !isObject(holder.mcpServers)) return null
  const config = Object.hasOwn(holder.mcpServers, name) ? holder.mcpServers[name] : undefined

  return isObject(config) ? config : null
}

/** The project entries of `~/.claude.json` for each root form, in the order of `roots`, trailing slashes ignored. */
function projectEntries(claudeJson: Record<string, unknown>, roots: readonly string[]): unknown[] {
  const projects = isObject(claudeJson.projects) ? Object.entries(claudeJson.projects) : []
  const wanted = roots.map(trimSlash).filter(root => root !== '')

  return wanted.flatMap(root => projects.filter(([path]) => trimSlash(path) === root).map(([, project]) => project))
}

/**
 * The config of one server in `~/.claude.json`: the project entry of the root as resolved or as given first, then the
 * top level; null when none of them holds a plain object for it.
 */
function serverConfig(claudeJson: unknown, roots: readonly string[], name: string): Record<string, unknown> | null {
  if (!isObject(claudeJson)) return null
  for (const project of projectEntries(claudeJson, roots)) {
    const config = serverIn(project, name)
    if (config !== null) return config
  }

  return serverIn(claudeJson, name)
}

/**
 * The text of a role's `.runtime/mcp.json` (D-93, LNCH-02): stableJson of `{ mcpServers }` with, for each server the
 * role is given, in name order, its config from `~/.claude.json` (serverConfig; `roots` holds the repo root as
 * resolved, then as given). A server it does not find there is left out with one warning that names it. With
 * `isRead` false, when cadre.json records no consent (D-58), no server is rendered and a role given any gets one
 * warning that the file was not read. A role given no server gets `{ mcpServers: {} }` and no warning. A warning names
 * servers only; a config value reaches the text alone, which is written to a runtime file.
 */
export function runtimeMcpText(
  role: RoleSpec,
  claudeJson: unknown,
  roots: readonly string[],
  isRead: boolean,
): { readonly text: string; readonly warnings: readonly string[] } {
  const names = sortedUnique(role.mcp)
  if (names.length === 0) return { text: stableJson({ mcpServers: {} }), warnings: [] }
  if (!isRead) return { text: stableJson({ mcpServers: {} }), warnings: [MCP_NOT_READ_WARNING] }
  const found = names.map(name => ({ name, config: serverConfig(claudeJson, roots, name) }))
  const servers = found.flatMap(({ name, config }): [string, Record<string, unknown>][] =>
    config === null ? [] : [[name, config]],
  )
  const missing = found.filter(({ config }) => config === null).map(({ name }) => mcpNotInFileWarning(name))

  return { text: stableJson({ mcpServers: Object.fromEntries(servers) }), warnings: missing }
}

/** The oldest claude cadre starts a role with (D-107): the engine floor the launcher's flags need. */
export const MIN_CLAUDE_VERSION: readonly [number, number, number] = [2, 1, 295]

/**
 * A line of `claude --version` that gives a version: it starts with three runs of digits joined by dots, whatever
 * follows, as the launcher's sed program reads it (cadre_claude_ok).
 */
const CLAUDE_VERSION_LINE = /^(\d+)\.(\d+)\.(\d+)/

/**
 * The version a `claude --version` text gives (D-107), by the launcher's rule (cadre_claude_ok): the three numbers at
 * the start of the one line that starts with a version; null when no line or more than one line does.
 */
export function parseClaudeVersion(text: string): readonly [number, number, number] | null {
  const found = text.split('\n').flatMap(line => {
    const match = CLAUDE_VERSION_LINE.exec(line)

    return match === null ? [] : [match]
  })
  if (found.length !== 1) return null
  const [, major, minor, patch] = found[0] ?? []
  if (major === undefined || minor === undefined || patch === undefined) return null

  return [Number(major), Number(minor), Number(patch)]
}

/** Whether a claude version is MIN_CLAUDE_VERSION or newer, compared part by part from the first (D-107). */
export function isSupportedClaude(version: readonly [number, number, number]): boolean {
  const [major, minor, patch] = version
  const [minMajor, minMinor, minPatch] = MIN_CLAUDE_VERSION
  if (major !== minMajor) return major > minMajor
  if (minor !== minMinor) return minor > minMinor

  return patch >= minPatch
}

/** How long `claude --version` may run before it is given up. */
const CLAUDE_VERSION_TIMEOUT_MS = 10_000

/** The refusal when `claude --version` cannot run or exits non-zero (D-107). */
export const START_NO_CLAUDE =
  'cadre start could not run claude --version, so it stopped: install Claude Code 2.1.295 or newer.'

/** The most characters of what `claude --version` gave that a refusal shows. */
const VERSION_SHOWN_CHARS = 40

/**
 * The refusal when the claude on PATH is older than 2.1.295, or gives no version cadre can read (D-107). The text
 * `claude --version` gave is shown cleaned, as reportText cleans a foreign value, and capped at 40 characters.
 */
export function claudeTooOldReply(versionText: string): string {
  const shown = clean(versionText, VERSION_SHOWN_CHARS)

  return `cadre start needs claude 2.1.295 or newer on PATH; claude --version gave: ${shown}`
}

/**
 * The refusal when `.cadre/manifest.json` is missing, cannot be read or is not a valid manifest: without it the
 * launcher cannot be checked (LNCH-04).
 */
export const START_NO_MANIFEST =
  '.cadre/manifest.json is missing or not valid, so cadre cannot check the launcher: run /cadre init again.'

/** The refusal when a role's launcher is missing, or the manifest holds no entry for it (LNCH-04). */
export function launcherMissingReply(id: string): string {
  const role = reportText(id)

  return `.cadre/bin/${role} is missing or not in .cadre/manifest.json: run /cadre regen ${role}.`
}

/**
 * The refusal when a role's launcher is not the file cadre wrote (LNCH-04, T-03-28): its sha256 differs from its
 * manifest entry, or it cannot be read as a regular file inside the repo. It names the three ways that work (#72 A3):
 * restore the file; `/cadre init`, whose Take new answer writes the new launcher and its manifest entry; or plain
 * regen, which keeps the changed file and its old manifest entry and writes the new version beside it as
 * `.cadre-new`, so that copy is moved over the launcher, made executable again, and a second regen records it.
 */
export function launcherChangedReply(id: string): string {
  const role = reportText(id)
  const launcher = launcherPath(role)

  return (
    `${launcher} was changed outside cadre: restore it, or run /cadre init and answer Take new for it, ` +
    `or run /cadre regen ${role}, move ${launcher}.cadre-new over it, chmod 755 it ` +
    `and run /cadre regen ${role} again.`
  )
}

/**
 * The reply when a step of the render fails (LNCH-03): the render stops at that step, so no stamp is written and the
 * launcher refuses to start. `path` is the step's path below the repo root, shown cleaned.
 */
export function renderFailedReply(id: string, path: string): string {
  const role = reportText(id)

  return (
    `cadre start could not render .cadre/${role}/.runtime/ (${reportText(path)} failed), ` +
    `so the launcher will refuse to start: fix it and run /cadre start ${role} again.`
  )
}

/**
 * The text of the role's launcher on disk once it can be trusted (LNCH-04, T-03-28), or the refusal. It refuses, in
 * this order: a `.cadre/manifest.json` that is missing, cannot be read or is not a valid manifest (START_NO_MANIFEST);
 * a launcher `.cadre/bin/<id>` the manifest holds no entry for, or that is not there (launcherMissingReply); one that
 * cannot be read as a regular file inside the repo, or whose sha256 differs from its entry (launcherChangedReply). Both
 * are read through readRepoFile, so a link out of the repo is never read. /cadre epic reuses it for each role (D-165).
 */
export async function launcherRead(io: InitIo, root: string, id: string): Promise<RegenRead<string>> {
  const manifestRead = await readRepoFile(io, root, MANIFEST_PATH, MAX_READ_BYTES)
  const manifest = manifestRead.state === 'text' ? parseManifest(manifestRead.text) : null
  if (manifest === null) return { kind: 'refuse', text: START_NO_MANIFEST }
  const path = launcherPath(id)
  const entry = manifest.files.find(file => file.path === path)
  if (entry === undefined) return { kind: 'refuse', text: launcherMissingReply(id) }
  const launcher = await readRepoFile(io, root, path, MAX_READ_BYTES)
  if (launcher.state === 'absent') return { kind: 'refuse', text: launcherMissingReply(id) }
  if (launcher.state !== 'text') return { kind: 'refuse', text: launcherChangedReply(id) }
  if ((await sha256Hex(launcher.text)) !== entry.sha256) return { kind: 'refuse', text: launcherChangedReply(id) }

  return { kind: 'ok', value: launcher.text }
}

/**
 * The warning when the role's launcher on disk, which matches its manifest entry, is not the text this cadre writes
 * for it today (LNCH-04, #54 A3): an older cadre wrote it, or the setup changed since. It warns and never refuses,
 * since the launcher is still the one cadre wrote. The name is shown cleaned.
 */
function launcherOutdatedWarning(id: string): string {
  const role = reportText(id)

  return (
    `.cadre/bin/${role} is not the launcher this cadre writes today (written by an older cadre or for another ` +
    `setup): run /cadre regen ${role} to update it`
  )
}

/**
 * The launcher warnings of /cadre start (#54 A3): launcherOutdatedWarning when `desired`, the files desiredFiles gives
 * for the role today, holds a launcher `.cadre/bin/<id>` whose text differs from `onDisk`; none otherwise.
 */
function launcherDrift(id: string, onDisk: string, desired: readonly DesiredFile[]): string[] {
  const today = desired.find(file => file.path === launcherPath(id))
  if (today === undefined || today.content === onDisk) return []

  return [launcherOutdatedWarning(id)]
}

/**
 * Why the claude on PATH, the one the launcher execs (RESEARCH 1.2), must not start the role (D-107), or null:
 * `claude --version` that cannot run or exits non-zero (START_NO_CLAUDE); an output in which parseClaudeVersion reads
 * no version (no line, or more than one, starts with one), or one older than MIN_CLAUDE_VERSION (claudeTooOldReply,
 * with the first line of the output). It runs in the home folder when there is one, as every install run does
 * (T-03-46), so no repo-level settings take part in the one `claude` run of /cadre start (#72 B1). /cadre epic reuses
 * it before it creates anything (D-165).
 */
export async function claudeRefusal(host: HostIo, home: string | null): Promise<string | null> {
  const options = home === null ? {} : { cwd: home }
  const run = await host.run(['claude', '--version'], { ...options, timeoutMs: CLAUDE_VERSION_TIMEOUT_MS })
  if (run === null || run.exitCode !== 0) return START_NO_CLAUDE
  const version = parseClaudeVersion(run.stdout)
  if (version !== null && isSupportedClaude(version)) return null

  return claudeTooOldReply(run.stdout.split('\n')[0] ?? '')
}

/**
 * The `--terminal` line below the copy line (D-109, D-126, D-132). The host is macOS when `/usr/bin/uname -s` exits 0
 * with `Darwin`; with that, and TMUX and TERM_PROGRAM as the host reads them, terminalPlan gives the argv to run, or
 * the refusal, which is the line. An open that exits 0 gives `Opened it in a new <name>.`, and one that cannot run or
 * exits non-zero gives `Could not open a new <name>: run the command above yourself.`
 */
async function terminalLine(
  host: HostIo,
  input: {
    readonly choice: Exclude<TerminalChoice, 'none'>
    readonly id: string
    readonly root: string
    readonly command: string
  },
): Promise<string> {
  const { isMacOs, tmux, termProgram } = await terminalHostOf(host)
  const plan = terminalPlan({ ...input, tmux, termProgram, isMacOs })
  if (plan.kind === 'refuse') return plan.text
  const open = await host.run(plan.argv, { timeoutMs: TERMINAL_OPEN_TIMEOUT_MS })
  if (open !== null && open.exitCode === 0) return `Opened it in a new ${plan.name}.`

  return `Could not open a new ${plan.name}: run the command above yourself.`
}

/**
 * The disk a render is planned from: the stat of each path renderPaths names, asked with resolve, and the listing of
 * each folder it names. A folder the host cannot list gets no listing, so renderSteps counts it as empty.
 */
async function renderDiskOf(
  io: InitIo,
  paths: { readonly stats: readonly string[]; readonly listings: readonly string[] },
): Promise<Pick<RenderInput, 'stats' | 'listings'>> {
  const stats = new Map<string, PortStat | null>()
  for (const path of paths.stats) stats.set(path, await io.stat(path))
  const listings = new Map<string, readonly PortEntry[]>()
  for (const path of paths.listings) {
    const entries = await io.list(path)
    if (entries !== null) listings.set(path, entries)
  }

  return { stats, listings }
}

/**
 * The reply of a render that ran every step (D-102): what was asked for, the folder rendered with the number of links
 * it made, one `warning: ` line per warning, then the line that hands over the launcher and the launcher command, two
 * spaces in, and below the command the lines of `after`: the copy line, then the `--terminal` line when the switch
 * was given (D-110, D-109).
 */
function startReplyText(
  id: string,
  links: number,
  warnings: readonly string[],
  command: string,
  after: readonly string[],
): string {
  return [
    `cadre start ${id}`,
    `Rendered .cadre/${id}/.runtime/ (${links} ${links === 1 ? 'link' : 'links'}).`,
    ...warnings.map(warning => `warning: ${warning}`),
    `Run this in a terminal to start role ${id}:`,
    `  ${command}`,
    ...after,
  ].join('\n')
}

/**
 * The role's LaunchPlan with the link `.cadre/<id>/.runtime/private-instructions` to its private instructions folder,
 * `<role memory folder>/instructions` (D-140 q1-b, q2-a), added in path order: the launcher adds that link with
 * `--add-dir`, so every render makes it, and the folder behind it (privateFolderSteps), for a role with no private part
 * too. The folder lies in the user's config folder, apart from the memory files, and never in the repo.
 */
function withPrivateInstructions(plan: LaunchPlan, user: LaunchUser, id: string): LaunchPlan {
  const link: OverlayLink = {
    path: `${runtimeFolder(user.root, id)}/${PRIVATE_INSTRUCTIONS_LINK}`,
    target: privateInstructionsDir(user, id),
  }

  return { ...plan, links: [...plan.links, link].sort((a, b) => compareText(a.path, b.path)) }
}

/**
 * What makes a render an epic render (D-157): /cadre epic renders a role for its epic worktree, from the team of the
 * main checkout.
 */
export type EpicRender = {
  /** The main checkout's root, where the team, the manifest and the launchers were read. */
  readonly mainRoot: string
  /** The text of the role's epic kickoff, written to `.runtime/kickoff.txt` right before the stamp (D-158). */
  readonly kickoff: string
}

/**
 * The CLAUDE.md files an epic role must not load (RESEARCH Pitfall 1): `paths`, which the host lists for the ancestors
 * of the session's folder, the main checkout, so it does not name the worktree's own, and `<worktree>/CLAUDE.md` and
 * `<worktree>/.claude/CLAUDE.md`, sorted and once each. Excluding a path that does not exist is harmless (A2).
 */
export function worktreeClaudeMd(paths: readonly string[], worktree: string): string[] {
  return sortedUnique([...paths, `${worktree}/CLAUDE.md`, `${worktree}/.claude/CLAUDE.md`])
}

/**
 * The render half of /cadre start for one role (D-102), which /cadre epic runs too, once per role, for its epic
 * worktree (D-157): `locations` give the root it renders for, and the caller reads and compiles the team (`state`, the
 * role, its compiled scope and the repo's code dirs) in the session's own root. It gathers the launching user for the
 * root (gatherLaunchUser), builds the role's LaunchPlan with its private instructions link (withPrivateInstructions,
 * D-140 q1-b), renders the MCP config from `~/.claude.json` under the stored consent with the project entries of
 * `mcpRoots`, then of the user's `mainRoot` when set (03.1-W3 S1), in that order (runtimeMcpText), and the probe
 * expectations, and renders `<root>/.cadre/<id>/.runtime/`: renderPaths names what to stat and list, renderSteps plans
 * the steps from the root the LaunchPlan was built for, and every refusal comes before anything is written. Each step
 * then runs through the host in order, and the first one that fails stops the render with renderFailedReply and no
 * stamp written, so the launcher refuses to start (LNCH-03).
 * It refuses with the refusals of gatherLaunchUser, a role memory folder level it would write through included
 * (privateFolderRefusal, 02-GAPS-B3 C5), a render refusal, or that failure. Else it gives the number of links the
 * render made and every warning of the launch user, the LaunchPlan, the MCP config and the render, in that order.
 * `epic` is null for /cadre start, which changes nothing. For /cadre epic it names the main checkout and the role's
 * epic kickoff, which the render writes to `.runtime/kickoff.txt` as the step before the stamp (D-158), and the user
 * the LaunchPlan is built for also excludes the worktree's own CLAUDE.md files (worktreeClaudeMd, RESEARCH Pitfall 1)
 * and carries the main checkout as `mainRoot`, whose code dirs get the exact denies the worktree's get (Pitfall 2).
 */
export async function renderRole(
  io: InitIo,
  host: HostIo,
  input: {
    readonly locations: InitLocations
    readonly state: CadreState
    readonly role: RoleSpec
    readonly scope: CompiledScope
    readonly codeDirs: readonly string[]
    readonly mcpRoots: readonly string[]
    readonly epic: EpicRender | null
  },
): Promise<
  | { readonly kind: 'refuse'; readonly text: string }
  | { readonly kind: 'ok'; readonly links: number; readonly warnings: readonly string[] }
> {
  const { locations, state, role, scope } = input
  const { id } = role
  const launch = await gatherLaunchUser(io, host, {
    locations,
    launchStart: state.launchStart,
    codeDirs: input.codeDirs,
    role,
  })
  if (launch.kind === 'refuse') return { kind: 'refuse', text: launch.text }
  const gathered = launch.user
  const user: LaunchUser =
    input.epic === null
      ? gathered
      : {
          ...gathered,
          claudeMd: worktreeClaudeMd(gathered.claudeMd, locations.root),
          mainRoot: input.epic.mainRoot,
        }
  const plan = withPrivateInstructions(launchPlan(role, scope, user), user, id)
  const claudeJson = await readClaudeJson(io, locations, state.readUserMcp)
  const mcpRoots = [...input.mcpRoots, ...(user.mainRoot === undefined ? [] : [user.mainRoot])]
  const mcp = runtimeMcpText(role, claudeJson, mcpRoots, state.readUserMcp)
  const expectationsText = probeExpectationsText(expectationsFor(scope, roleMemoryDir(user, id)))
  const stamp = stampText((await io.cadreVersion()) ?? 'unknown')
  const disk = await renderDiskOf(io, renderPaths(user.root, id, plan, { kickoff: input.epic !== null }))
  const texts = { mcpText: mcp.text, expectationsText, stampText: stamp }
  // Only an epic render names a kickoff, so a /cadre start render never writes or removes one (D-168).
  const kickoff = input.epic === null ? {} : { kickoff: input.epic.kickoff }
  const render = renderSteps({ root: user.root, id, plan, ...texts, ...disk, memories: launch.memories, ...kickoff })
  if (render.refusal !== null) return { kind: 'refuse', text: render.refusal }

  for (const step of render.steps) {
    if (!(await isStepDone(host, step))) {
      return { kind: 'refuse', text: renderFailedReply(id, repoRelative(user.root, step.path)) }
    }
  }
  const links = render.steps.filter(step => step.kind === 'link').length

  return { kind: 'ok', links, warnings: [...launch.warnings, ...plan.warnings, ...mcp.warnings, ...render.warnings] }
}

/**
 * `/cadre start <id>` in the repo's root session (D-102, LNCH-04). It refuses with one exact line, in this order: the
 * repo refusals of repoGuard (in the start wording); the team refusals of readTeam; the launcher refusals of
 * launcherRead (manifest, launcher missing, launcher changed); the claude refusals of claudeRefusal (D-107), run
 * before anything else is run; and the refusals of renderRole. It reads the team, checks the launcher and compiles
 * the team (compileTeam) itself, in the session's root; renderRole then renders the role's `.runtime/` for that same
 * root, with the MCP project entries of the root as resolved, then as given, and no epic (D-157): the settings, the MCP
 * config, the probe expectations, the links and the private instructions folder, the inbox when there is none, and the
 * stamp last. The reply names the folder; the scan warnings of the run, as regen prints them (scanWarnings, #54 A1);
 * the launcher warning of launcherDrift (#54 A3); every warning renderRole gives; and the launcher command
 * (startReplyText). Once the render has run every step, it copies the command through the host with clipboardRun, and
 * the line below the command is COPIED_LINE when pbcopy exits 0, else NOT_COPIED_LINE, which is not an error (D-110,
 * D-132); a refused or failed render copies nothing. With `--terminal` (`options.terminal` other than `none`), after
 * the copy it asks `/usr/bin/uname -s`, TMUX and TERM_PROGRAM, and opens the command where terminalPlan says, or prints
 * its refusal: the line of terminalLine follows the copy line, and the command is printed and copied in every case
 * (D-109, D-126, D-132). It never runs the launcher, and never starts a background session (D-108).
 */
export async function runStart(
  io: InitIo,
  host: HostIo,
  options: { readonly id: string; readonly terminal: TerminalChoice },
): Promise<string> {
  const { id, terminal } = options
  const guard = await repoGuard(io, 'start')
  if (guard.kind === 'refuse') return guard.text
  const { locations } = guard
  const team = await readTeam(io, locations.root, 'start', id)
  if (team.kind === 'refuse') return team.text
  const { state, roles } = team.value
  const launcher = await launcherRead(io, locations.root, id)
  if (launcher.kind === 'refuse') return launcher.text
  const claude = await claudeRefusal(host, locations.home)
  if (claude !== null) return claude

  const { gathered, scopes } = await compileTeam(io, locations, state, roles)
  const role = roles.find(candidate => candidate.id === id)
  const scope = scopes.get(id)
  // Fail closed: readTeam read every listed role and compileTeam compiled each one, so both are always there.
  if (role === undefined || scope === undefined) return regenBadRole(id)
  const codeDirs = gathered.repo.codeDirs
  const mcpRoots = [locations.root, locations.givenRoot]
  const render = await renderRole(io, host, { locations, state, role, scope, codeDirs, mcpRoots, epic: null })
  if (render.kind === 'refuse') return render.text
  const drift = launcherDrift(id, launcher.value, desiredFiles({ roles, scopes, state, only: id }))
  const scan = scanWarnings(locations, gathered)
  const warnings = [...scan, ...drift, ...render.warnings]
  const command = launcherCommand(locations.root, id)
  const copy = clipboardRun(command)
  const copied = await host.run(copy.argv, copy.options)
  const copyLine = copied !== null && copied.exitCode === 0 ? COPIED_LINE : NOT_COPIED_LINE
  if (terminal === 'none') return startReplyText(id, render.links, warnings, command, [copyLine])
  const opened = await terminalLine(host, { choice: terminal, id, root: locations.root, command })

  return startReplyText(id, render.links, warnings, command, [copyLine, opened])
}
