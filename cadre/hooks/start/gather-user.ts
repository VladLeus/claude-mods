/**
 * The gather half of /cadre start (D-98), a layer 10 module: gatherLaunchUser reads, through the InitIo and HostIo
 * ports only, and never writes, the facts about the launching user that a role launch needs: the roots, the home and
 * user folders and the git common dir, the carried user settings and hooks (launchSettingsOf, launchHooksOf, D-103),
 * the CLAUDE.md chain, rule, role, memory, skill and agent files, and a parts-flow role's linked memories, with its
 * refusals (START_NO_HOME, START_NO_GIT_DIR, privateFolderRefusal). It imports apply, core, git, launch/links, paths,
 * scan, start/memory-links and start/render-plan; the role render reads it.
 */
import type {
  HostIo,
  InitIo,
  InitLocations,
  LaunchStart,
  PortEntry,
  PortStat,
  RoleSpec,
  SettingsSource,
} from '../../types'
import { privateLevelsProblem, roleFolderLevels } from '../apply/safety'
import { isObject } from '../core/json'
import { sortedUnique } from '../core/text'
import { gitCommonDirOf, mainCheckoutOf } from '../git/common-dir'
import { isPartsFlowRole } from '../launch/links'
import type { LaunchUser } from '../launch/links'
import { t } from '../locales/t'
import {
  displayPath,
  MARKDOWN_EXTENSION,
  markdownFileNames,
  memoryFolderOf,
  parentOf,
  roleMemoryDir,
  userDirOf,
} from '../paths'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { SOURCE_ORDER } from '../scan/facts/settings'
import { claudeMdImports } from '../scan/instructions/imports'
import { ruleFiles, RULES_FOLDER } from '../scan/rules'
import { claudeMdPathsOf } from '../scan/setup/claude-md'
import { hookScriptOf, positiveInteger } from '../scan/setup/settings'
import { linkedMemoriesOf } from './memory-links'
import { isPlainName, NO_MEMORY_LINKS } from './render-plan'
import type { MemoryLinks } from './render-plan'

/** The refusal when there is no HOME: the role files are rendered from the user's own folder (D-98). */
export const START_NO_HOME = t('start.gatherUser.startNoHome')

/**
 * The refusal when git gives no common dir, which names the role memory folders (D-91): the run failed, or it gave no
 * absolute path, as a git older than 2.31 does with `--path-format=absolute` (#72 A4).
 */
export const START_NO_GIT_DIR = t('start.gatherUser.startNoGitDir')

/** The /cadre start refusal for a role memory folder level it would write through (02-GAPS-B3 C5). */
export function privateFolderRefusal(path: string, reason: 'link' | 'not-folder' | 'unchecked'): string {
  const stopped = t('start.gatherUser.privateFolderRefusal', { path })
  const end = t('start.gatherUser.privateFolderRefusal2')
  if (reason === 'link') return t('start.gatherUser.privateFolderRefusal3', { stopped, end })
  if (reason === 'not-folder') return t('start.gatherUser.privateFolderRefusal4', { stopped, end })

  return t('start.gatherUser.privateFolderRefusal5', { stopped, end })
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
    autoCompactWindow: positiveInteger(user.autoCompactWindow),
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
 *   `<home>/.claude`); an ignored CLAUDE_CONFIG_DIR is warned about by the setup scan of the same run, so it is not
 *   repeated here (D-238, WF-S3);
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
 * any run, and with START_NO_GIT_DIR when git gives no absolute path; only then is the user folder taken, with
 * CLAUDE_CONFIG_DIR checked against the root, the root as given and the main checkout (D-238, WF-S4). Then each level
 * of the role memory folder (roleFolderLevels: `<userDir>/cadre`, `<repo>-<hash8>`, the role memory folder and its
 * instructions/ subfolder) is stat'ed, and `<userDir>` and each level but the last listed, and it refuses with
 * privateFolderRefusal when privateLevelsProblem finds a level that is a link, is not a folder, or whose parent could
 * not be listed (02-GAPS-B3 C5), before any step runs; `<userDir>` itself is never checked, as a linked config folder
 * is common. No setting value, hook command or file text is ever part of a refusal or a warning.
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
  if (home === null) return { kind: 'refuse', text: START_NO_HOME }
  const commonDir = await gitCommonDirOf(io, host, locations.root)
  if (commonDir === null) return { kind: 'refuse', text: START_NO_GIT_DIR }
  const main = mainCheckoutOf(commonDir.gitCommonDir, locations.root)
  const userDir = userDirOf(locations, [locations.root, locations.givenRoot, ...(main === null ? [] : [main])], [])
  // Fail closed: with a home, userDirOf always gives a folder.
  if (userDir === null) return { kind: 'refuse', text: START_NO_HOME }
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
  const linked = await linkedMemoriesOf(io, user, input.role.id)
  const { memories } = linked
  const linkedMemories = memories.links.map(link => link.path)

  return { kind: 'ok', user: { ...user, linkedMemories }, warnings: linked.warnings, memories }
}
