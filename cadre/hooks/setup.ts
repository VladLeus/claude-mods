import type {
  CarryFacts,
  HookScript,
  InitIo,
  McpRef,
  McpSource,
  PortEntry,
  SettingsSource,
  SetupScan,
  SkillRef,
} from '../types'
import {
  compareText,
  displayPath,
  fieldKeysOf,
  foldEnabledPlugins,
  hiddenNameWarnings,
  hookScriptsMatching,
  isChangedByClean,
  isDirInsideRoot,
  isFileInsideRoot,
  isObject,
  keysOf,
  MAX_KEY_CHARS,
  MAX_READ_BYTES,
  parseEnabledPlugins,
  parseInstalledPlugins,
  parseJsonValue,
  SOURCE_ORDER,
  sortedUnique,
  trimSlash,
} from './facts'
import { ENV_NAME_PATTERN, MAX_HOOK_NAME_CHARS, NAME_PATTERN } from './roles'
import { listingState, missingState } from './scan'

/**
 * Where a scan looks: the repo root as the host resolved it and as given, the home folder and CLAUDE_CONFIG_DIR. Every
 * path is absolute and has no trailing slash, or is null. A scan reads from these paths and shows them only in display
 * form (`<repo>/...`, `~/...`), never as they are.
 */
export type SetupContext = {
  readonly root: string
  readonly givenRoot: string
  readonly home: string | null
  readonly configDir: string | null
}

/** One settings source and the value the host read from it, unvalidated. */
type SettingsEntry = {
  readonly source: SettingsSource
  readonly value: unknown
}

/** What the settings sources keep: key names, hook basenames, the carry facts and the enabled plugin keys. */
type ProjectedSettings = {
  readonly settingsKeys: SetupScan['settingsKeys']
  readonly hooks: readonly HookScript[]
  readonly carry: CarryFacts
  readonly enabled: readonly string[]
}

/** At most this many key names are kept per settings source. */
const MAX_SETTINGS_KEYS = 100
/**
 * The most bytes of `~/.claude.json` a scan reads: the host's own 4 MiB read cap, not the 256 KiB cap of the detect
 * files, because this file holds the account data and every project of the user and is far larger (P15).
 */
export const CLAUDE_JSON_MAX_BYTES = 4 * 1024 * 1024
/** Code points a command, MCP server or agent name keeps; a longer name is dropped, with a warning. */
const MAX_REF_NAME_CHARS = 100
/** Code points a memory file name keeps; the longest name a file system allows. */
const MAX_FILE_NAME_CHARS = 255
/** The extension of an agent file and of a memory file. */
const MARKDOWN_EXTENSION = '.md'
/** The file names the host is asked for in each folder from the file system root down to the repo (D-57). */
const CLAUDE_MD_NAMES: readonly string[] = ['CLAUDE.md', '.claude/CLAUDE.md']
/** Command sources a scan does not name: the host ships its built-in commands, and an MCP server adds its prompts. */
const UNNAMED_SOURCES: readonly string[] = ['builtin', 'mcp']
/**
 * A tool the engine names `mcp__<server>__<tool>`: the server is what lies between the first two `__`. The match is
 * lazy, so a server whose own name holds `__` is cut at its first `__`.
 */
const MCP_TOOL_PATTERN = /^mcp__(.+?)__.+$/
/** The warning when the host cannot list the commands and skills. */
const COMMANDS_WARNING = 'could not list commands and skills (treated as unknown)'
/** The warning when the host cannot list the session tools. */
const TOOLS_WARNING = 'could not list session tools (treated as unknown)'
/** The warning when the host cannot list the CLAUDE.md files above the repo. */
const CHAIN_WARNING = 'could not read the CLAUDE.md chain (treated as unknown)'
/** The warning when there is neither a CLAUDE_CONFIG_DIR nor a home folder to find the user-level sources in. */
const NO_USER_DIR_WARNING = 'HOME is unset: user-level setup was not scanned'
/**
 * A hook script basename: 1 to 80 letters, digits, dots, hyphens and underscores, then `.js`, `.cjs`, `.mjs`, `.sh`,
 * `.py` or `.ts`. The lookarounds require a whole basename, so `x.js.bak`, `a.jsx` and a longer name do not match.
 */
const HOOK_SCRIPT_PATTERN = /(?<![\w.-])[A-Za-z0-9_.-]{1,80}\.(?:js|cjs|mjs|sh|py|ts)(?![\w.-])/g
/** The GSD status line script as a whole basename: `gsd-statusline.js`, `.cjs` or `.sh`. */
const GSD_STATUSLINE_PATTERN = /(?<![\w.-])gsd-statusline\.(?:js|cjs|sh)(?![\w.-])/

/** The names that clean leaves unchanged at `maxChars`, in the order given and without repeats. A name is exact. */
function stableNames(names: readonly string[], maxChars: number): string[] {
  return Array.from(new Set(names.filter(name => name !== '' && !isChangedByClean(name, maxChars))))
}

/**
 * The warning for names a scan dropped because a role.json could not hold them, naming the source and the count and
 * never a name; none when nothing was dropped.
 */
function unfitNameWarnings(count: number, noun: string, source: string): string[] {
  if (count === 0) return []

  return [`ignored ${count} ${noun} ${count === 1 ? 'name' : 'names'} from ${source} that a role.json cannot hold`]
}

/** Whether a hook script basename fits the role.json cap, so a role can carry it (D-62). */
function fitsHookCap(script: string): boolean {
  return script.length <= MAX_HOOK_NAME_CHARS
}

/** The value when it is a positive safe integer, else null. */
function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * The hook script basenames under `hooks` of one settings value, each with its event and source. Every basename ending
 * `.js`, `.cjs`, `.mjs`, `.sh`, `.py` or `.ts` is kept and the rest of its command is discarded: the interpreter, the
 * path and the arguments, which may hold a secret. A script named twice for the same event appears once, and a name
 * over the role.json cap of MAX_HOOK_NAME_CHARS is dropped, so every script a scan keeps is one a role can carry. The
 * walk is the one parseHookScripts makes over the settings shape, with every script extension, not the `gsd-` names
 * alone.
 */
export function projectHooks(value: unknown, source: SettingsSource): HookScript[] {
  return hookScriptsMatching(value, source, HOOK_SCRIPT_PATTERN).filter(hook => fitsHookCap(hook.script))
}

/** One warning per settings source that names hook scripts over the role.json cap, counting them, never naming one. */
function hookNameWarnings(sources: readonly SettingsEntry[]): string[] {
  return sources.flatMap(entry => {
    const scripts = hookScriptsMatching(entry.value, entry.source, HOOK_SCRIPT_PATTERN).map(hook => hook.script)
    const tooLong = new Set(scripts.filter(script => !fitsHookCap(script)))

    return unfitNameWarnings(tooLong.size, 'hook script', `the ${entry.source} settings`)
  })
}

/**
 * The carry facts of the user settings (D-60), each allow-listed on its own: `autoCompactWindow` when it is a positive
 * integer, whether a `statusLine` object is set and whether its command names a gsd-statusline script, and the `env`
 * variable names that look like names. No value is kept. Anything but a plain object carries nothing.
 */
function carryOf(user: unknown): CarryFacts {
  if (!isObject(user)) return { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] }
  const statusLine = isObject(user.statusLine) ? user.statusLine : null
  const command = statusLine === null ? null : statusLine.command

  return {
    autoCompactWindow: positiveInteger(user.autoCompactWindow),
    hasStatusLine: statusLine !== null,
    isGsdStatusline: typeof command === 'string' && GSD_STATUSLINE_PATTERN.test(command),
    envNames: sortedUnique(keysOf(user.env).filter(name => ENV_NAME_PATTERN.test(name))),
  }
}

/** The sources that were read as plain objects, one entry per source, in override order. */
function readSources(sources: readonly SettingsEntry[]): SettingsEntry[] {
  return SOURCE_ORDER.flatMap(source => {
    const found = sources.find(entry => entry.source === source && isObject(entry.value))

    return found === undefined ? [] : [found]
  })
}

/**
 * The settings of the sources that were read, projected to what a scan may keep (SCAN-02, D-57): the top-level key
 * names of each source (sorted, at most 100, a name clean would change is dropped), the hook script basenames, the
 * carry facts of the user source alone, and `enabled`, the enabledPlugins keys that are true after the sources are
 * folded in override order, sorted. A source that is missing or not a plain object is skipped, and no settings value is
 * kept.
 */
export function projectSettings(sources: readonly SettingsEntry[]): ProjectedSettings {
  const read = readSources(sources)
  const user = read.find(entry => entry.source === 'user')
  const flags = foldEnabledPlugins(read.flatMap(entry => parseEnabledPlugins(entry.value, entry.source)))

  return {
    settingsKeys: read.map(entry => ({
      source: entry.source,
      keys: sortedUnique(stableNames(keysOf(entry.value), MAX_KEY_CHARS)).slice(0, MAX_SETTINGS_KEYS),
    })),
    hooks: read.flatMap(entry => projectHooks(entry.value, entry.source)),
    carry: carryOf(user === undefined ? null : user.value),
    enabled: sortedUnique(flags.filter(flag => flag.value).map(flag => flag.key)),
  }
}

/** One warning per settings key and enabledPlugins key that clean would change, as the Facts report them. */
function settingsNameWarnings(sources: readonly SettingsEntry[]): string[] {
  return [
    ...hiddenNameWarnings(sources.flatMap(entry => keysOf(entry.value)), 'settings key', MAX_KEY_CHARS),
    ...hiddenNameWarnings(
      sources.flatMap(entry => fieldKeysOf(entry.value, 'enabledPlugins')),
      'enabledPlugins key',
      MAX_KEY_CHARS,
    ),
  ]
}

/** Whether a command name, or the plugin that adds a command, is a plain ASCII name of at most 100 characters. */
function isCommandName(value: unknown): value is string {
  return typeof value === 'string' && NAME_PATTERN.test(value)
}

/** The objects of a command list whose source a scan names: user, plugin and any source that is not built in or MCP. */
function skillItems(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isObject)
    .filter(item => typeof item.source === 'string' && !UNNAMED_SOURCES.includes(item.source))
}

/** One command as a name and the plugin that adds it; null when the name, or a plugin that is given, is not a name. */
function skillRefOf(item: Record<string, unknown>): SkillRef | null {
  const { name, plugin } = item
  if (!isCommandName(name)) return null
  if (item.source !== 'plugin' || plugin === undefined) return { name, plugin: null }
  if (!isCommandName(plugin)) return null

  return { name, plugin }
}

/** Skills in the order of their names, then of their plugins, a command with no plugin first. */
function bySkill(first: SkillRef, second: SkillRef): number {
  return compareText(first.name, second.name) || compareText(first.plugin ?? '', second.plugin ?? '')
}

/**
 * The skills and plugin commands of a `$.command.list()` answer, by name and the plugin that adds each (SCAN-02, D-57).
 * Built-in commands and MCP prompts are dropped, and so is a command whose name, or whose plugin, is not a plain name
 * of at most 100 characters. A description, a hint and every other field is never read, so none can be kept. A name is
 * listed once for each plugin, sorted by name. Anything but a list gives [].
 */
export function projectCommands(value: unknown): SkillRef[] {
  const found = new Map<string, SkillRef>()
  for (const item of skillItems(value)) {
    const ref = skillRefOf(item)
    if (ref !== null) found.set(JSON.stringify([ref.name, ref.plugin]), ref)
  }

  return Array.from(found.values()).sort(bySkill)
}

/** The command and plugin names of a command list as the host gave them, for the hidden-name warnings. */
function skillNames(value: unknown): string[] {
  return skillItems(value)
    .flatMap(item => [item.name, item.plugin])
    .filter((name): name is string => typeof name === 'string')
}

/**
 * MCP servers of one source: the names that clean leaves unchanged and that fit the role.json name rule (NAME_PATTERN),
 * once each, sorted by name. A name a role.json could not hold is never kept, so every server a scan names is one a
 * role can be given.
 */
function mcpRefsOf(names: readonly string[], source: McpSource): McpRef[] {
  const fit = stableNames(names, MAX_REF_NAME_CHARS).filter(name => NAME_PATTERN.test(name))

  return sortedUnique(fit).map(name => ({ name, source }))
}

/** The warning for the MCP server names of one source that clean leaves alone but NAME_PATTERN refuses. */
function unfitMcpWarnings(names: readonly string[], source: string): string[] {
  const unfit = stableNames(names, MAX_REF_NAME_CHARS).filter(name => !NAME_PATTERN.test(name))

  return unfitNameWarnings(unfit.length, 'MCP server', source)
}

/** The MCP servers a scan kept from one source, and whether it could not see every server there (A4). */
type McpScan = {
  readonly refs: readonly McpRef[]
  readonly isPartial: boolean
}

/** A source the scan did not read: no server, and the scan cannot have seen them all. */
const UNREAD_MCP: McpScan = Object.freeze({ refs: Object.freeze([]), isPartial: true })

/** A source with no server to see: nothing kept and nothing missed. */
const NO_MCP: McpScan = Object.freeze({ refs: Object.freeze([]), isPartial: false })

/**
 * The servers a projection kept from the raw names of one source, partial when it dropped a name: one clean would
 * change, one over the cap, or one outside the role.json name rule (A4). A name given twice counts once.
 */
function mcpScanOf(refs: readonly McpRef[], names: readonly string[]): McpScan {
  return { refs, isPartial: new Set(names).size > refs.length }
}

/** The server of each `mcp__<server>__<tool>` name in a `$.tool.list()` answer, as the host spells it. */
function toolServerNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(item => {
    const server = isObject(item) && typeof item.name === 'string' ? MCP_TOOL_PATTERN.exec(item.name)?.[1] : undefined

    return server === undefined ? [] : [server]
  })
}

/**
 * The MCP servers the session has, from the tool names of the form `mcp__<server>__<tool>` (SCAN-02, D-57): each server
 * once, sorted, with source `session`. Only the name of a tool is read, never its description. A server name a
 * role.json cannot hold (NAME_PATTERN) is dropped. Anything but a list gives [].
 */
export function projectToolServers(value: unknown): McpRef[] {
  return mcpRefsOf(toolServerNames(value), 'session')
}

/** The server names of a `.mcp.json` value, which are the keys of its `mcpServers`. */
function mcpServerNames(value: unknown): string[] {
  return fieldKeysOf(value, 'mcpServers')
}

/**
 * The MCP servers a repo's `.mcp.json` declares (SCAN-02, D-57): the keys of `mcpServers` only, sorted, with source
 * `project`. The entries, which hold commands, URLs, headers and tokens, are never read. A server name a role.json
 * cannot hold (NAME_PATTERN) is dropped. Anything but a plain object with an `mcpServers` object gives [].
 */
export function projectMcpJson(value: unknown): McpRef[] {
  return mcpRefsOf(mcpServerNames(value), 'project')
}

/** The server names of a `~/.claude.json` value: its top-level `mcpServers`, and those of the projects at `roots`. */
function claudeJsonNames(value: unknown, roots: readonly string[]): string[] {
  if (!isObject(value)) return []
  const wanted = roots.map(trimSlash).filter(root => root !== '')
  const projects = isObject(value.projects) ? Object.entries(value.projects) : []
  const ofThisRepo = projects.filter(([path]) => wanted.includes(trimSlash(path)))

  return [...mcpServerNames(value), ...ofThisRepo.flatMap(([, project]) => fieldKeysOf(project, 'mcpServers'))]
}

/**
 * The MCP servers named in `~/.claude.json` (SCAN-02, D-58), which a scan reads only after the person consented: the
 * keys of the top-level `mcpServers` and of the `mcpServers` of the project at any of `roots` (the repo root as given
 * and as resolved, trailing slashes ignored), sorted, with source `user-config`. Nothing else in the file is kept: not
 * the server entries, which hold tokens, not the account block and not another project. An empty root form matches no
 * project, and a server name a role.json cannot hold (NAME_PATTERN) is dropped. Anything but a plain object gives [].
 */
export function projectClaudeJson(value: unknown, roots: readonly string[]): McpRef[] {
  return mcpRefsOf(claudeJsonNames(value, roots), 'user-config')
}

/**
 * The CLAUDE.md files of a `$.fs.ancestors` answer, in the order the host gave them (the file system root first), each
 * as its display form: `<repo>/CLAUDE.md`, `~/work/CLAUDE.md`, or the cleaned path outside both. Only the folder and
 * the name an entry carries are read, so the text of the files cannot be kept; a name that was not asked for, such as
 * AGENTS.md, is dropped, and a file is listed once. Anything but a list gives [].
 */
export function projectAncestors(value: unknown, ctx: SetupContext): string[] {
  if (!Array.isArray(value)) return []
  const shown = value.flatMap(item => {
    if (!isObject(item) || typeof item.dir !== 'string' || typeof item.name !== 'string') return []
    if (!CLAUDE_MD_NAMES.includes(item.name)) return []
    const path = `${trimSlash(item.dir)}/${item.name}`

    return [displayPath(path, ctx.home, ctx.root, ctx.configDir)]
  })

  return Array.from(new Set(shown))
}

/**
 * The folder name Claude Code gives a project's data under `projects/`: every character of the path that is not an
 * ASCII letter or digit becomes `-`, one for each UTF-16 unit.
 */
export function mangledProjectDir(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

/**
 * The folder the user-level sources live in: CLAUDE_CONFIG_DIR when it is set, else `<home>/.claude`; null when there
 * is neither.
 */
function userDirOf(ctx: SetupContext): string | null {
  if (ctx.configDir !== null) return ctx.configDir

  return ctx.home === null ? null : `${ctx.home}/.claude`
}

/** A path as a warning shows it: its display form (`<repo>/...`, `~/...`), never the path itself (D-57). */
function shownPath(ctx: SetupContext, path: string): string {
  return displayPath(path, ctx.home, ctx.root, ctx.configDir)
}

/** The warning for a path the scan could not read: its display form, never the path itself (D-57). */
function unreadableWarning(ctx: SetupContext, path: string): string {
  return `could not read ${shownPath(ctx, path)} (treated as unknown)`
}

/** A JSON file as the port read it: not there, unknown (unreadable, over the cap or not JSON), or its parsed value. */
type JsonRead =
  | { readonly state: 'absent' }
  | { readonly state: 'unknown' }
  | { readonly state: 'parsed'; readonly value: unknown }

/**
 * A JSON file read through the port, up to `maxBytes`. A file that is not there is absent and quiet; one that cannot be
 * read, is over the cap or does not parse is unknown with a warning, because unknown is never the same as absent.
 */
async function readJsonFile(
  io: InitIo,
  ctx: SetupContext,
  path: string,
  maxBytes: number,
  warnings: string[],
): Promise<JsonRead> {
  const read = await io.read(path, maxBytes)
  if (read.state === 'absent') return { state: 'absent' }
  const json = read.state === 'text' ? parseJsonValue(read.text) : null
  if (json === null) {
    warnings.push(unreadableWarning(ctx, path))

    return { state: 'unknown' }
  }

  return { state: 'parsed', value: json.value }
}

/** The value of a JSON file read by readJsonFile, with its warning; null when the file is absent or unknown. */
async function readJson(
  io: InitIo,
  ctx: SetupContext,
  path: string,
  maxBytes: number,
  warnings: string[],
): Promise<unknown> {
  const read = await readJsonFile(io, ctx, path, maxBytes, warnings)

  return read.state === 'parsed' ? read.value : null
}

/**
 * A folder's listing, by listingState: a folder that is not there gives [] quietly, and one that cannot be listed gives
 * [] with a warning, because unknown is not absent.
 */
async function listFolder(
  io: InitIo,
  ctx: SetupContext,
  path: string,
  warnings: string[],
): Promise<readonly PortEntry[]> {
  const listing = await listingState(io, path)
  if (listing.state === 'present') return listing.entries
  if (listing.state === 'unknown') warnings.push(unreadableWarning(ctx, path))

  return []
}

/**
 * Whether a repo path may be read or listed: its stat must pass `isInside`, the containment rule for its kind (WR-02).
 * A path that fails it adds a warning; a path with no stat is told apart by missingState, so a missing path is quiet
 * and one the port could not stat adds a warning, because unknown is not absent.
 */
async function isInsideRepo(
  io: InitIo,
  ctx: SetupContext,
  path: string,
  isInside: (stat: unknown, root: string) => boolean,
  warnings: string[],
): Promise<boolean> {
  const stat = await io.stat(path)
  const isAllowed = stat !== null && isInside(stat, ctx.root)
  if (isAllowed) return true
  if (stat !== null || (await missingState(io, path)) === 'unknown') warnings.push(unreadableWarning(ctx, path))

  return false
}

/** The names of the regular files in a listing that end with `extension`; a folder, a link or another kind does not. */
function fileNames(entries: readonly PortEntry[], extension: string): string[] {
  return entries
    .filter(entry => entry.kind === 'file' && !entry.isLink && entry.name.endsWith(extension))
    .map(entry => entry.name)
}

/** Each settings source the port can read as a plain object, in override order; any other source adds a warning. */
async function readSettings(io: InitIo, warnings: string[]): Promise<SettingsEntry[]> {
  const read: SettingsEntry[] = []
  for (const source of SOURCE_ORDER) {
    const value = await io.settings(source)
    if (!isObject(value)) {
      warnings.push(`could not read ${source} settings (treated as unknown)`)
      continue
    }
    read.push({ source, value })
  }

  return read
}

/**
 * The keys of the plugins installed for the user or for this repo, from `installed_plugins.json` in the user folder.
 * The install paths, scopes and versions in the file are read only to decide that, and are not kept.
 */
async function installedPluginKeys(
  io: InitIo,
  ctx: SetupContext,
  userDir: string | null,
  warnings: string[],
): Promise<string[]> {
  if (userDir === null) return []
  const value = await readJson(io, ctx, `${userDir}/plugins/installed_plugins.json`, MAX_READ_BYTES, warnings)
  warnings.push(...hiddenNameWarnings(fieldKeysOf(value, 'plugins'), 'installed plugin key', MAX_KEY_CHARS))

  return parseInstalledPlugins(value, ctx.root, ctx.givenRoot).map(plugin => plugin.key)
}

/** The skills and plugin commands of the host's command list; a list the host cannot give adds a warning. */
async function commandRefs(io: InitIo, warnings: string[]): Promise<SkillRef[]> {
  const value = await io.commands()
  if (!Array.isArray(value)) {
    warnings.push(COMMANDS_WARNING)

    return []
  }
  warnings.push(...hiddenNameWarnings(skillNames(value), 'command or plugin name', MAX_REF_NAME_CHARS))

  return projectCommands(value)
}

/**
 * The MCP servers of the session, from the host's tool list; a list the host cannot give adds a warning. The scan is
 * partial when a server name was dropped.
 */
async function sessionMcpScan(io: InitIo, warnings: string[]): Promise<McpScan> {
  const value = await io.tools()
  if (!Array.isArray(value)) {
    warnings.push(TOOLS_WARNING)

    return NO_MCP
  }
  const names = toolServerNames(value)
  warnings.push(...hiddenNameWarnings(names, 'MCP server name', MAX_REF_NAME_CHARS))
  warnings.push(...unfitMcpWarnings(names, 'the session tools'))

  return mcpScanOf(projectToolServers(value), names)
}

/**
 * The MCP servers of the repo's `.mcp.json`. The file is read only when its stat shows a regular file whose real path
 * is inside the repo (WR-02); a link out of the repo, a folder, any other kind or a failed stat is not read and adds a
 * warning. A file that is not there is quiet. The scan is partial when a server name was dropped.
 */
async function projectMcpScan(io: InitIo, ctx: SetupContext, warnings: string[]): Promise<McpScan> {
  const path = `${ctx.root}/.mcp.json`
  if (!(await isInsideRepo(io, ctx, path, isFileInsideRoot, warnings))) return NO_MCP
  const value = await readJson(io, ctx, path, MAX_READ_BYTES, warnings)
  const names = mcpServerNames(value)
  warnings.push(...hiddenNameWarnings(names, 'MCP server name', MAX_REF_NAME_CHARS))
  warnings.push(...unfitMcpWarnings(names, shownPath(ctx, path)))

  return mcpScanOf(projectMcpJson(value), names)
}

/**
 * The `.md` files of the repo's `.claude/agents`, listed only when its stat shows a folder whose real path is inside
 * the repo (isDirInsideRoot, the rule `.mcp.json` follows), so a link out of the repo is never listed and adds a
 * warning, and so does a failed stat; a folder that is not there is quiet.
 */
async function repoAgentEntries(io: InitIo, ctx: SetupContext, warnings: string[]): Promise<readonly PortEntry[]> {
  const path = `${ctx.root}/.claude/agents`
  if (!(await isInsideRepo(io, ctx, path, isDirInsideRoot, warnings))) return []

  return listFolder(io, ctx, path, warnings)
}

/** The agents in the user folder and in the repo's `.claude/agents`: the `.md` files, by name without the extension. */
async function agentNames(
  io: InitIo,
  ctx: SetupContext,
  userDir: string | null,
  warnings: string[],
): Promise<string[]> {
  const userEntries = userDir === null ? [] : await listFolder(io, ctx, `${userDir}/agents`, warnings)
  const entries = [...userEntries, ...(await repoAgentEntries(io, ctx, warnings))]
  const names = fileNames(entries, MARKDOWN_EXTENSION).map(name => name.slice(0, -MARKDOWN_EXTENSION.length))
  warnings.push(...hiddenNameWarnings(names, 'agent name', MAX_REF_NAME_CHARS))

  return sortedUnique(stableNames(names, MAX_REF_NAME_CHARS))
}

/** The file that holds `~/.claude.json`: in CLAUDE_CONFIG_DIR when that is set [ASSUMED], else in the home folder. */
function claudeJsonPathOf(ctx: SetupContext): string | null {
  if (ctx.configDir !== null) return `${ctx.configDir}/.claude.json`

  return ctx.home === null ? null : `${ctx.home}/.claude.json`
}

/**
 * The MCP servers named in `~/.claude.json`. The file is looked for only when the person consented (D-58): without
 * consent nothing is read, stat'ed or warned about. A file that is not there is quiet, one that cannot be read, is over
 * the 4 MiB cap or does not parse adds a warning. The scan is partial when the file was not read (no consent, no user
 * folder, or a file it could not read or parse) or a server name was dropped (A4); a file that is not there is not.
 */
async function userConfigMcpScan(
  io: InitIo,
  ctx: SetupContext,
  isAllowed: boolean,
  warnings: string[],
): Promise<McpScan> {
  if (!isAllowed) return UNREAD_MCP
  const path = claudeJsonPathOf(ctx)
  if (path === null) return UNREAD_MCP
  const read = await readJsonFile(io, ctx, path, CLAUDE_JSON_MAX_BYTES, warnings)
  if (read.state === 'unknown') return UNREAD_MCP
  const value = read.state === 'parsed' ? read.value : null
  const roots = [ctx.root, ctx.givenRoot]
  const names = claudeJsonNames(value, roots)
  warnings.push(...hiddenNameWarnings(names, 'MCP server name', MAX_REF_NAME_CHARS))
  warnings.push(...unfitMcpWarnings(names, shownPath(ctx, path)))

  return mcpScanOf(projectClaudeJson(value, roots), names)
}

/** The CLAUDE.md files above and in the repo, as display forms; a chain the host cannot give adds a warning. */
async function claudeMdChain(io: InitIo, ctx: SetupContext, warnings: string[]): Promise<string[]> {
  const value = await io.ancestors(CLAUDE_MD_NAMES)
  if (!Array.isArray(value)) {
    warnings.push(CHAIN_WARNING)

    return []
  }

  return projectAncestors(value, ctx)
}

/**
 * Whether the user folder holds a CLAUDE.md file. Its stat answers; its text is never read. A stat that fails on a
 * path that is there (missingState) adds a warning and counts as no file, because unknown is not absent.
 */
async function isGlobalClaudeMdThere(
  io: InitIo,
  ctx: SetupContext,
  userDir: string | null,
  warnings: string[],
): Promise<boolean> {
  if (userDir === null) return false
  const path = `${userDir}/CLAUDE.md`
  const stat = await io.stat(path)
  if (stat !== null) return stat.kind === 'file'
  if ((await missingState(io, path)) === 'unknown') warnings.push(unreadableWarning(ctx, path))

  return false
}

/**
 * The `.md` file names in the auto-memory folders of this repo, with their extension; their text is never read. The
 * folder of the root as resolved and the one of the root as given are both listed, once each when they are the same,
 * as `~/.claude.json` is matched by both root forms.
 */
async function memoryFileNames(
  io: InitIo,
  ctx: SetupContext,
  userDir: string | null,
  warnings: string[],
): Promise<string[]> {
  if (userDir === null) return []
  const projects = new Set([ctx.root, ctx.givenRoot].map(mangledProjectDir))
  const names: string[] = []
  for (const project of projects) {
    const folder = `${userDir}/projects/${project}/memory`
    names.push(...fileNames(await listFolder(io, ctx, folder, warnings), MARKDOWN_EXTENSION))
  }
  warnings.push(...hiddenNameWarnings(names, 'memory file name', MAX_FILE_NAME_CHARS))

  return sortedUnique(stableNames(names, MAX_FILE_NAME_CHARS))
}

/** The servers once each by name, keeping the first source in the order the lists are given, sorted by name. */
function mergeMcp(lists: readonly (readonly McpRef[])[]): McpRef[] {
  const first = new Map<string, McpRef>()
  for (const ref of lists.flat()) {
    if (!first.has(ref.name)) first.set(ref.name, ref)
  }

  return Array.from(first.values()).sort((a, b) => compareText(a.name, b.name))
}

/**
 * The user-setup scan (SCAN-02, D-57): every source is read through the port and projected at once to names, counts and
 * booleans, so no value, command, token or file content can reach a later module. The sources are the three settings
 * files, the installed and enabled plugins, the commands and skills, the MCP servers of the repo's `.mcp.json`, of the
 * session and, only when `isClaudeJsonAllowed` is true, of `~/.claude.json` (D-58), the agent files, the CLAUDE.md
 * chain, the global CLAUDE.md and the auto-memory file names. A source the port cannot read adds a warning and is
 * treated as unknown, never as empty; one that is not there is quiet. With neither CLAUDE_CONFIG_DIR nor a home folder,
 * the user-level sources are skipped. `isMcpPartial` is true when an MCP server name was dropped from any source, or
 * `~/.claude.json` was not read (A4).
 */
export async function scanSetup(io: InitIo, ctx: SetupContext, isClaudeJsonAllowed: boolean): Promise<SetupScan> {
  const warnings: string[] = []
  const userDir = userDirOf(ctx)
  if (userDir === null) warnings.push(NO_USER_DIR_WARNING)
  const sources = await readSettings(io, warnings)
  const settings = projectSettings(sources)
  warnings.push(...settingsNameWarnings(sources), ...hookNameWarnings(sources))
  const installed = await installedPluginKeys(io, ctx, userDir, warnings)
  const skills = await commandRefs(io, warnings)
  const projectServers = await projectMcpScan(io, ctx, warnings)
  const sessionServers = await sessionMcpScan(io, warnings)
  const userServers = await userConfigMcpScan(io, ctx, isClaudeJsonAllowed, warnings)
  const servers = [projectServers, sessionServers, userServers]
  const agents = await agentNames(io, ctx, userDir, warnings)
  const claudeMd = await claudeMdChain(io, ctx, warnings)
  const hasGlobalClaudeMd = await isGlobalClaudeMdThere(io, ctx, userDir, warnings)
  const memoryFiles = await memoryFileNames(io, ctx, userDir, warnings)

  return {
    plugins: sortedUnique([...settings.enabled, ...installed]),
    skills,
    mcp: mergeMcp(servers.map(found => found.refs)),
    isMcpPartial: servers.some(found => found.isPartial),
    agents,
    claudeMd,
    hasGlobalClaudeMd,
    memoryFiles,
    settingsKeys: settings.settingsKeys,
    hooks: settings.hooks,
    carry: settings.carry,
    warnings,
  }
}
