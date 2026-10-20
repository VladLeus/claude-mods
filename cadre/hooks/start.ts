/**
 * The gather and render halves of /cadre start (D-102), and runStart, the command itself, which checks the repo and
 * the team, gathers, runs the render steps through the HostIo port and hands over the launcher command (LNCH-04).
 *
 * The gather half reads, through the InitIo and HostIo ports only, and never writes: the facts about the launching
 * user that a role launch needs (gatherLaunchUser, D-98), and the user's `~/.claude.json` under the stored consent
 * (readClaudeJson, D-58), from which runtimeMcpText renders a role's MCP config (D-93).
 *
 * The render half gives the ordered steps that write a role's per-launch files into `.cadre/<id>/.runtime/`, from its
 * LaunchPlan (D-98) and the texts of its MCP config and probe expectations. It reads and writes nothing: /cadre start
 * stats and lists the paths renderPaths names, then runs the steps renderSteps gives, in order, through the host. The
 * stamp is always the last step, and the launcher trusts it: it refuses to start when the stamp is missing or older
 * than the role files or a rendered file, so a render that stops part way never starts a session (LNCH-03).
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
  TerminalChoice,
} from '../types'
import {
  isDirInsideRoot,
  isObject,
  MAX_READ_BYTES,
  parseJsonValue,
  sortedUnique,
  SOURCE_ORDER,
  trimSlash,
} from './facts'
import { shQuote } from './generate'
import { sha256Hex } from './hash'
import { compileTeam, readTeam, regenBadRole, repoGuard } from './init'
import { claudeMdImports, launchPlan, roleMemoryDir } from './launch'
import type { LaunchPlan, LaunchUser, OverlayLink } from './launch'
import { INBOX_FILE, PROBE_EXPECTATIONS_FILE, RUNTIME_STAMP_FILE, stableJson } from './plan'
import { expectationsFor, probeExpectationsText } from './probe'
import { reportText } from './render'
import {
  CLAUDE_JSON_MAX_BYTES,
  claudeJsonPathOf,
  claudeMdPathsOf,
  hookScriptOf,
  mangledProjectDir,
  userDirOf,
} from './setup'

/** The name of the rendered runtime settings in `.runtime` (D-84). */
const SETTINGS_FILE = 'settings.json'

/** The name of the rendered MCP config in `.runtime` (D-93). */
const MCP_FILE = 'mcp.json'

/** The folder in `.runtime` a launcher adds with `--add-dir`; every render makes it, with or without links (D-102). */
const OVERLAY_FOLDER = 'overlay'

/**
 * The files a render writes into `.runtime`, in the order it writes them: the settings, the MCP config, the probe
 * expectations, the inbox when there is none, and the stamp last (D-102, D-114).
 */
const WRITTEN_FILES: readonly string[] = Object.freeze([
  SETTINGS_FILE,
  MCP_FILE,
  PROBE_EXPECTATIONS_FILE,
  INBOX_FILE,
  RUNTIME_STAMP_FILE,
])

/**
 * The folders under `.runtime` a render links into: the overlay skills and agents, and the global and memory
 * instructions. /cadre start stats each of them, with every folder from `.runtime` down to them, and lists each of
 * them, so a link an earlier render made there, which the plan no longer names, is removed, and a link planted at one
 * of them or above it refuses the render (T-03-20).
 */
export const STALE_LINK_FOLDERS: readonly string[] = Object.freeze([
  'overlay/.claude/skills',
  'overlay/.claude/agents',
  'instructions/global',
  'instructions/memory',
])

/**
 * One step of a render, in the order /cadre start runs it; every path is absolute:
 * - `remove`: remove a link, or the stamp of an earlier render (`/bin/rm -f`);
 * - `mkdir`: make a folder and the folders above it (`/bin/mkdir -p`);
 * - `link`: make `path` a symbolic link to `target` (`/bin/ln -sfn`);
 * - `write`: write the text to the path; the host writes it, so it has no argv.
 */
export type RenderStep =
  | { readonly kind: 'remove'; readonly path: string }
  | { readonly kind: 'mkdir'; readonly path: string }
  | { readonly kind: 'link'; readonly path: string; readonly target: string }
  | { readonly kind: 'write'; readonly path: string; readonly text: string }

/**
 * What renderSteps plans from: the repo root as a realpath and the role id; the role's LaunchPlan, whose links all lie
 * under the role's `.runtime`, as launchPlan makes them; the texts of `mcp.json`, `probe-expectations.json` and the
 * stamp; and the disk. `stats` holds the stat of each path renderPaths names, asked with resolve, and `listings` the
 * listing of each folder it names. A path with no stat counts as not there, and a folder with no listing as empty.
 */
export type RenderInput = {
  readonly root: string
  readonly id: string
  readonly plan: LaunchPlan
  readonly mcpText: string
  readonly expectationsText: string
  readonly stampText: string
  readonly stats: ReadonlyMap<string, PortStat | null>
  readonly listings: ReadonlyMap<string, readonly PortEntry[]>
}

/** The steps of a render in order, the warnings to show, and why it was refused: a refused render has no step. */
export type RenderResult = {
  readonly steps: readonly RenderStep[]
  readonly warnings: readonly string[]
  readonly refusal: string | null
}

/** The folder of a role's files: `<root>/.cadre/<id>`. */
function roleFolder(root: string, id: string): string {
  return `${root}/.cadre/${id}`
}

/** The folder of a role's per-launch files: `<root>/.cadre/<id>/.runtime`, the folder its launcher reads. */
export function runtimeFolder(root: string, id: string): string {
  return `${roleFolder(root, id)}/.runtime`
}

/** The folder that holds a path: everything before its last slash. */
function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

/**
 * The folders from `.runtime` down to the folder that holds a path in it, from the top: `.runtime`,
 * `.runtime/overlay`, `.runtime/overlay/.claude` and `.runtime/overlay/.claude/skills` for a skill link.
 */
function foldersTo(runtime: string, path: string): string[] {
  const below = parentOf(path).slice(runtime.length).split('/').filter(part => part !== '')

  return [runtime, ...below.map((_, index) => [runtime, ...below.slice(0, index + 1)].join('/'))]
}

/**
 * The folders from `.runtime` down to each STALE_LINK_FOLDERS folder, that folder included, below `.runtime`:
 * `overlay`, `overlay/.claude`, `overlay/.claude/skills`, and so on (T-03-20).
 */
function staleLinkChain(runtime: string): string[] {
  return STALE_LINK_FOLDERS.flatMap(folder => {
    const parts = folder.split('/')

    return parts.map((_, index) => [runtime, ...parts.slice(0, index + 1)].join('/'))
  })
}

/**
 * Every folder a render makes, links into or removes stale links from, sorted and once each: `.runtime`, its overlay,
 * each folder from `.runtime` down to a STALE_LINK_FOLDERS folder, and each folder from `.runtime` down to a link.
 */
function renderFolders(runtime: string, links: readonly OverlayLink[]): string[] {
  const linkFolders = links.flatMap(link => foldersTo(runtime, link.path))

  return sortedUnique([runtime, `${runtime}/${OVERLAY_FOLDER}`, ...staleLinkChain(runtime), ...linkFolders])
}

/**
 * The paths /cadre start stats and lists before a render, so renderSteps can judge each one. `stats` holds, sorted
 * and once each, the role folder, `.runtime`, its overlay, every folder from `.runtime` down to a STALE_LINK_FOLDERS
 * folder or to a link, every link path and the five files a render writes; `listings` holds the STALE_LINK_FOLDERS
 * under `.runtime`.
 */
export function renderPaths(
  root: string,
  id: string,
  plan: LaunchPlan,
): { readonly stats: readonly string[]; readonly listings: readonly string[] } {
  const runtime = runtimeFolder(root, id)
  const stats = sortedUnique([
    roleFolder(root, id),
    ...renderFolders(runtime, plan.links),
    ...plan.links.map(link => link.path),
    ...WRITTEN_FILES.map(name => `${runtime}/${name}`),
  ])

  return { stats, listings: STALE_LINK_FOLDERS.map(folder => `${runtime}/${folder}`) }
}

/** The stat of a path; null when it is not there or was not asked, as a path with no stat counts as not there. */
function statAt(input: RenderInput, path: string): PortStat | null {
  return input.stats.get(path) ?? null
}

/** Whether a stat shows a link, a dangling one included. */
function isLinkStat(stat: PortStat | null): boolean {
  return stat !== null && stat.isLink
}

/** Whether a stat shows a real entry, a file, a folder or any other kind that is not a link. */
function isRealEntry(stat: PortStat | null): boolean {
  return stat !== null && !stat.isLink
}

/** The refusal when the role folder is missing, a link, or not a real folder inside the repo. */
function roleFolderRefusal(id: string): string {
  const role = reportText(id)

  return `.cadre/${role} is not a folder inside this repo: run /cadre regen ${role}`
}

/** The refusal when `.runtime`, a folder in it, or a file a render writes is a link or not what the render needs. */
function runtimeRefusal(id: string): string {
  const role = reportText(id)
  const what = `.cadre/${role}/.runtime/ or a folder in it is a link or not a folder`

  return `${what}: remove it and run /cadre start ${role} again`
}

/** Whether a folder a render makes or links into is unsafe: it is there, and a link or not a folder. */
function isUnsafeFolder(stat: PortStat | null): boolean {
  return stat !== null && (stat.isLink || stat.kind !== 'dir')
}

/** Whether a file a render writes is unsafe: it is there, not a link (a link is removed first) and not a file. */
function isUnsafeFile(stat: PortStat | null): boolean {
  return stat !== null && !stat.isLink && stat.kind !== 'file'
}

/**
 * Why a render must not run, or null (T-03-20). The role folder must be a real folder inside the repo; `.runtime`,
 * its overlay, every folder down to a STALE_LINK_FOLDERS folder and every folder down to a link must be missing or a
 * real folder; and each file a render writes must be missing, a regular file, or a link, which is removed first.
 * Anything else would let a step write, link or remove through a link, or write onto a folder.
 */
function refusalOf(input: RenderInput, runtime: string): string | null {
  const role = statAt(input, roleFolder(input.root, input.id))
  if (role === null || role.isLink || !isDirInsideRoot(role, input.root)) return roleFolderRefusal(input.id)
  const folders = renderFolders(runtime, input.plan.links).map(path => statAt(input, path))
  const files = WRITTEN_FILES.map(name => statAt(input, `${runtime}/${name}`))
  if (folders.some(isUnsafeFolder) || files.some(isUnsafeFile)) return runtimeRefusal(input.id)

  return null
}

/** Whether a listed name is one plain entry of its folder: not empty, not `.` or `..`, and with no slash. */
function isPlainName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !name.includes('/')
}

/**
 * The links an earlier render left in the STALE_LINK_FOLDERS that the plan no longer names, sorted: each listed entry
 * there that is a link with a plain name. A real file or folder there is never removed, and a link path the plan
 * names is left to the planned-link removal.
 */
function staleLinks(input: RenderInput, runtime: string): string[] {
  const planned = new Set(input.plan.links.map(link => link.path))
  const stale: string[] = []
  for (const folder of STALE_LINK_FOLDERS) {
    const folderPath = `${runtime}/${folder}`
    for (const entry of input.listings.get(folderPath) ?? []) {
      const path = `${folderPath}/${entry.name}`
      if (entry.isLink && isPlainName(entry.name) && !planned.has(path)) stale.push(path)
    }
  }

  return sortedUnique(stale)
}

/**
 * The links a render removes before it makes anything (Pitfall 2), in order: those an earlier render left that the
 * plan no longer names (staleLinks), then each planned link path that is a link, then each file the render writes,
 * but the stamp, that is a link. Only links: a real file or folder is never removed here.
 */
function linkRemovals(input: RenderInput, runtime: string): string[] {
  const linkPaths = input.plan.links.map(link => link.path)
  const files = WRITTEN_FILES.filter(name => name !== RUNTIME_STAMP_FILE).map(name => `${runtime}/${name}`)
  const links = [...linkPaths, ...files].filter(path => isLinkStat(statAt(input, path)))

  return [...staleLinks(input, runtime), ...links]
}

/** The path below the repo root, as a warning shows it; a path outside the root is shown whole. */
function repoRelative(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

/** The warning for a planned link path that holds a real file or folder, which a render keeps (Pitfall 2). */
function notReplacedWarning(root: string, path: string): string {
  return `${reportText(repoRelative(root, path))} is a real file or folder, not a link: not replaced`
}

/** A step that removes a path. */
function removeStep(path: string): RenderStep {
  return { kind: 'remove', path }
}

/** A step that makes a folder. */
function mkdirStep(path: string): RenderStep {
  return { kind: 'mkdir', path }
}

/** A step that makes a link. */
function linkStep(link: OverlayLink): RenderStep {
  return { kind: 'link', path: link.path, target: link.target }
}

/** A step that writes a text to a path. */
function writeStep(path: string, text: string): RenderStep {
  return { kind: 'write', path, text }
}

/** The folders a render makes, sorted and once each: `.runtime`, its overlay (always, D-102) and each link's folder. */
function mkdirFolders(runtime: string, links: readonly OverlayLink[]): string[] {
  return sortedUnique([runtime, `${runtime}/${OVERLAY_FOLDER}`, ...links.map(link => parentOf(link.path))])
}

/**
 * The writes before the stamp, in order: the settings as stable JSON, the MCP config, the probe expectations, and an
 * empty inbox only when there is none, so a note another role left there is never lost (D-114, Pitfall 3). An inbox
 * that is a link is removed first (linkRemovals), so it counts as none.
 */
function fileWrites(input: RenderInput, runtime: string): RenderStep[] {
  const inbox = `${runtime}/${INBOX_FILE}`
  const writes = [
    writeStep(`${runtime}/${SETTINGS_FILE}`, stableJson(input.plan.settings)),
    writeStep(`${runtime}/${MCP_FILE}`, input.mcpText),
    writeStep(`${runtime}/${PROBE_EXPECTATIONS_FILE}`, input.expectationsText),
  ]
  if (isRealEntry(statAt(input, inbox))) return writes

  return [...writes, writeStep(inbox, '')]
}

/**
 * The steps that render a role's `.runtime` (D-102), in order. An existing stamp is removed first, so a render that
 * stops part way never leaves the old stamp beside new files. Then the links of linkRemovals are removed; then
 * `.runtime`, its overlay and each link's folder are made, sorted and once each; then each link is made, except at a
 * path that holds a real file or folder, which is kept and named in a warning (Pitfall 2: `ln -sfn` would link inside
 * a folder or replace a file); then the files of fileWrites are written, and the stamp last. A render that stops at any
 * step before the last leaves no stamp, so the launcher refuses to start (LNCH-03). A render that refusalOf refuses
 * has no step at all.
 */
export function renderSteps(input: RenderInput): RenderResult {
  const runtime = runtimeFolder(input.root, input.id)
  const refusal = refusalOf(input, runtime)
  if (refusal !== null) return { steps: [], warnings: [], refusal }
  const stamp = `${runtime}/${RUNTIME_STAMP_FILE}`
  const kept = input.plan.links.filter(link => isRealEntry(statAt(input, link.path)))
  const links = input.plan.links.filter(link => !isRealEntry(statAt(input, link.path)))
  const steps: RenderStep[] = [
    ...(statAt(input, stamp) === null ? [] : [removeStep(stamp)]),
    ...linkRemovals(input, runtime).map(removeStep),
    ...mkdirFolders(runtime, input.plan.links).map(mkdirStep),
    ...links.map(linkStep),
    ...fileWrites(input, runtime),
    writeStep(stamp, input.stampText),
  ]

  return { steps, warnings: kept.map(link => notReplacedWarning(input.root, link.path)), refusal: null }
}

/**
 * The argv that runs a step, absolute and with no shell (RESEARCH 3.2): `/bin/rm -f --` for a removal, never `-r`;
 * `/bin/mkdir -p --` for a folder; `/bin/ln -sfn <target> <path>` for a link. A write has none: the host writes it.
 */
export function renderArgv(step: RenderStep): readonly string[] | null {
  if (step.kind === 'remove') return ['/bin/rm', '-f', '--', step.path]
  if (step.kind === 'mkdir') return ['/bin/mkdir', '-p', '--', step.path]
  if (step.kind === 'link') return ['/bin/ln', '-sfn', step.target, step.path]

  return null
}

/** The text of the stamp a render writes last: the cadre version that rendered, on one line. */
export function stampText(cadreVersion: string): string {
  return `rendered by cadre ${cadreVersion}\n`
}

/** The argv that asks git for the repo's common dir as an absolute path; it runs at the repo root (D-98, D-91). */
export const GIT_COMMON_DIR_ARGV: readonly string[] = Object.freeze([
  'git',
  'rev-parse',
  '--path-format=absolute',
  '--git-common-dir',
])

/** How long the git run may take before it is given up. */
const GIT_TIMEOUT_MS = 10_000

/** The refusal when there is no HOME: the role files are rendered from the user's own folder (D-98). */
export const START_NO_HOME = 'cadre start needs HOME to render the role files, so it stopped.'

/** The refusal when git gives no common dir, which names the role memory folders (D-91). */
export const START_NO_GIT_DIR =
  'cadre start could not read the git common dir (git rev-parse failed), so it stopped.'

/** What gatherLaunchUser gives: the launching user's facts with the warnings to show, or the exact refusal. */
export type LaunchUserRead =
  | { readonly kind: 'ok'; readonly user: LaunchUser; readonly warnings: readonly string[] }
  | { readonly kind: 'refuse'; readonly text: string }

/** The file names the host is asked for in each folder from the file system root down to the repo (D-57). */
const CLAUDE_MD_FILES: readonly string[] = Object.freeze(['CLAUDE.md', '.claude/CLAUDE.md'])

/** How many import hops from the global CLAUDE.md are followed (D-63). */
const MAX_IMPORT_DEPTH = 5

/** The most files the global CLAUDE.md and its imports give a role. */
const MAX_GLOBAL_FILES = 20

/** The extension of a memory file and of an agent file. */
const MARKDOWN_EXTENSION = '.md'

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
  const files = entries.filter(entry => entry.kind === 'file' && !entry.isLink)

  return sortedUnique(files.map(entry => entry.name).filter(name => name.endsWith(MARKDOWN_EXTENSION)))
}

/** The `.md` file names of the auto-memory folder the engine keeps for a project root in the user folder (D-100). */
async function memoryFilesOf(io: InitIo, userDir: string, root: string): Promise<string[]> {
  return markdownFiles(io, `${userDir}/projects/${mangledProjectDir(root)}/memory`)
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

/**
 * The git common dir as git gives it at the repo root: its output without the final line break, which must start
 * with `/`. Null when the host rejects the run, it exits non-zero or its output is not an absolute path.
 */
async function gitCommonDirOf(host: HostIo, root: string): Promise<string | null> {
  const run = await host.run(GIT_COMMON_DIR_ARGV, { cwd: root, timeoutMs: GIT_TIMEOUT_MS })
  if (run === null || run.exitCode !== 0) return null
  if (!run.stdout.startsWith('/')) return null

  return run.stdout.endsWith('\n') ? run.stdout.slice(0, -1) : run.stdout
}

/**
 * The launching user's facts (D-98), gathered in the root session through the ports:
 * - the repo root as resolved and as given, the home folder, and the user folder (CLAUDE_CONFIG_DIR, else
 *   `<home>/.claude`);
 * - the git common dir from GIT_COMMON_DIR_ARGV run at the root, as the realpath of its stat when the host resolves
 *   it, else as git gave it, with its SHA-256: they name the role memory folders (roleMemoryDir, D-20, D-91);
 * - the carried values of the user settings (launchSettingsOf) and the hooks of each source hookSourcesFor names for
 *   the launch start (launchHooksOf, D-103);
 * - the CLAUDE.md chain the host's ancestors list gives (claudeMdPathsOf), the global CLAUDE.md with its imports, the
 *   `.md` files of the memory folders of the root as resolved and as given, the user's skills and agents, and the code
 *   dirs given.
 * A listing or read that fails counts as empty. It refuses with START_NO_HOME when there is no home folder, before
 * any run, and with START_NO_GIT_DIR when git gives no absolute path. No setting value, hook command or file text is
 * ever part of a refusal or a warning.
 */
export async function gatherLaunchUser(
  io: InitIo,
  host: HostIo,
  input: {
    readonly locations: InitLocations
    readonly launchStart: LaunchStart
    readonly codeDirs: readonly string[]
  },
): Promise<LaunchUserRead> {
  const { locations } = input
  const { home } = locations
  const userDir = userDirOf(locations)
  if (home === null || userDir === null) return { kind: 'refuse', text: START_NO_HOME }
  const commonDir = await gitCommonDirOf(host, locations.root)
  if (commonDir === null) return { kind: 'refuse', text: START_NO_GIT_DIR }
  const gitCommonDir = (await io.stat(commonDir))?.realPath ?? commonDir
  const hooks: LaunchHook[] = []
  for (const source of hookSourcesFor(input.launchStart)) hooks.push(...launchHooksOf(await io.settings(source)))

  return {
    kind: 'ok',
    user: {
      root: locations.root,
      givenRoot: locations.givenRoot,
      home,
      userDir,
      gitCommonDir,
      commonDirHash: await sha256Hex(gitCommonDir),
      ...launchSettingsOf(await io.settings('user')),
      hooks,
      claudeMd: claudeMdPathsOf(await io.ancestors(CLAUDE_MD_FILES)),
      globalClaudeMd: await globalClaudeMdOf(io, userDir, home),
      memoryFiles: await memoryFilesOf(io, userDir, locations.root),
      givenMemoryFiles: await memoryFilesOf(io, userDir, locations.givenRoot),
      userSkills: await userSkillsOf(io, userDir),
      userAgents: await userAgentsOf(io, userDir),
      codeDirs: input.codeDirs,
    },
    warnings: [],
  }
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

/** How long one removal, folder or link step of a render may run before it is given up. */
const RENDER_STEP_TIMEOUT_MS = 10_000

/** The command that starts a role: the absolute path of its launcher `<root>/.cadre/bin/<id>`, as one shell word. */
export function launcherCommand(root: string, id: string): string {
  return shQuote(`${root}/.cadre/bin/${id}`)
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
 * Runs one step of a render through the host: a write through host.write; a removal, a folder or a link through
 * host.run with its renderArgv, absolute and with no shell, done only when it exits 0.
 */
async function isStepDone(host: HostIo, step: RenderStep): Promise<boolean> {
  if (step.kind === 'write') return host.write(step.path, step.text)
  const argv = renderArgv(step)
  if (argv === null) return false
  const run = await host.run(argv, { timeoutMs: RENDER_STEP_TIMEOUT_MS })

  return run !== null && run.exitCode === 0
}

/** The reply when a step of the render fails: the render stops there, so it writes no stamp (LNCH-03). */
function renderStoppedReply(id: string, path: string): string {
  return `cadre start could not render .cadre/${reportText(id)}/.runtime/ (${reportText(path)} failed).`
}

/**
 * The reply of a render that ran every step (D-102): what was asked for, the folder rendered with the number of links
 * it made, one `warning: ` line per warning, then the line that hands over the launcher and the launcher command, two
 * spaces in.
 */
function startReplyText(id: string, root: string, links: number, warnings: readonly string[]): string {
  return [
    `cadre start ${id}`,
    `Rendered .cadre/${id}/.runtime/ (${links} links).`,
    ...warnings.map(warning => `warning: ${warning}`),
    `Run this in a terminal to start role ${id}:`,
    `  ${launcherCommand(root, id)}`,
  ].join('\n')
}

/**
 * `/cadre start <id>` in the repo's root session (D-102, LNCH-04). It refuses with the first refusal of repoGuard (in
 * the start wording) and readTeam. Otherwise it compiles the team (compileTeam), gathers the launching user
 * (gatherLaunchUser) and builds the role's LaunchPlan, and renders the role's `.runtime/`: the settings, the MCP config
 * (runtimeMcpText), the probe expectations, the links, the inbox when there is none, and the stamp last. renderPaths
 * names what to stat and list, renderSteps plans the steps from the root the LaunchPlan was built for, and a render
 * refusal is the reply, before anything is written. Each step then runs through the host in order, and the first one
 * that fails stops the render with no stamp written, so the launcher refuses to start (LNCH-03). The reply names the
 * folder, every warning of the launch user, the LaunchPlan, the MCP config and the render, and the launcher command
 * (startReplyText). It never runs the launcher, and never starts a background session (D-108).
 */
export async function runStart(
  io: InitIo,
  host: HostIo,
  options: { readonly id: string; readonly terminal: TerminalChoice },
): Promise<string> {
  const { id } = options
  const guard = await repoGuard(io, 'start')
  if (guard.kind === 'refuse') return guard.text
  const { locations } = guard
  const team = await readTeam(io, locations.root, 'start', id)
  if (team.kind === 'refuse') return team.text
  const { state, roles } = team.value

  const { gathered, scopes } = await compileTeam(io, locations, state, roles)
  const role = roles.find(candidate => candidate.id === id)
  const scope = scopes.get(id)
  // Fail closed: readTeam read every listed role and compileTeam compiled each one, so both are always there.
  if (role === undefined || scope === undefined) return regenBadRole(id)
  const launch = await gatherLaunchUser(io, host, {
    locations,
    launchStart: state.launchStart,
    codeDirs: gathered.repo.codeDirs,
  })
  if (launch.kind === 'refuse') return launch.text
  const { user } = launch
  const plan = launchPlan(role, scope, user)
  const claudeJson = await readClaudeJson(io, locations, state.readUserMcp)
  const mcp = runtimeMcpText(role, claudeJson, [locations.root, locations.givenRoot], state.readUserMcp)
  const expectationsText = probeExpectationsText(expectationsFor(scope, roleMemoryDir(user, id)))
  const stamp = stampText((await io.cadreVersion()) ?? 'unknown')
  const disk = await renderDiskOf(io, renderPaths(user.root, id, plan))
  const texts = { mcpText: mcp.text, expectationsText, stampText: stamp }
  const render = renderSteps({ root: user.root, id, plan, ...texts, ...disk })
  if (render.refusal !== null) return render.refusal

  for (const step of render.steps) {
    if (!(await isStepDone(host, step))) return renderStoppedReply(id, repoRelative(user.root, step.path))
  }
  const links = render.steps.filter(step => step.kind === 'link').length
  const warnings = [...launch.warnings, ...plan.warnings, ...mcp.warnings, ...render.warnings]

  return startReplyText(id, user.root, links, warnings)
}
