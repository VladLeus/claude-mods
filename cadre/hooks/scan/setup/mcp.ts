/**
 * The MCP part of the setup scan, a layer 3 module: the servers of the repo's `.mcp.json`, of the session's tool names
 * and, only after consent, of `~/.claude.json` with its claude.ai connectors, each kept by name only and merged once by
 * name, and whether a source may have hidden a server (SCAN-02, D-57, D-58, R2, A4); desktop app connectors are left
 * out, and so are the servers disabled for the project (D-332). It imports core, paths, the facts read cap and name
 * warnings, the setup readers and settings, and the types, so the setup scan, the skill and agent scans (the name cap)
 * and /cadre start (the `~/.claude.json` cap) read here.
 */
import type { InitIo, McpRef, McpSource } from '../../../types'
import { fieldKeysOf, isObject } from '../../core/json'
import { NAME_PATTERN } from '../../core/names'
import { compareText, sortedUnique } from '../../core/text'
import { t, tn } from '../../locales/t'
import { claudeJsonPathOf, isFileInsideRoot, trimSlash } from '../../paths'
import { hiddenNameWarnings, MAX_READ_BYTES } from '../facts/normalize'
import { isInsideRepo, readJson, readJsonFile, shownPath } from './read'
import type { SetupContext } from './read'
import { stableNames, unfitNameWarnings } from './settings'
import type { ProjectedSettings } from './settings'

/**
 * The most bytes of `~/.claude.json` a scan reads: the host's own 4 MiB read cap, not the 256 KiB cap of the detect
 * files, because this file holds the account data and every project of the user and is far larger (P15).
 */
export const CLAUDE_JSON_MAX_BYTES = 4 * 1024 * 1024
/** Code points a command, MCP server or agent name keeps; a longer name is dropped, with a warning. */
export const MAX_REF_NAME_CHARS = 100

/**
 * A tool the engine names `mcp__<server>__<tool>`: the server is what lies between the first two `__`. The match is
 * lazy, so a server whose own name holds `__` is cut at its first `__`.
 */
const MCP_TOOL_PATTERN = /^mcp__(.+?)__.+$/
/** The server name of a desktop app connector (R2): a UUID, 8-4-4-4-12 hex digits in either case. */
const DESKTOP_CONNECTOR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The text before a connector's name in an entry of the `claudeAiMcpEverConnected` list of `~/.claude.json` (R2). */
const CLAUDE_AI_PREFIX = 'claude.ai '
/** The text a terminal session puts before a claude.ai connector's name in the name of its MCP server (R2). */
const CONNECTOR_PREFIX = 'claude_ai_'
/**
 * At most this many entries of `claudeAiMcpEverConnected` are read (R2): the cap of the other name lists,
 * MAX_SETTINGS_KEYS.
 */
const MAX_CONNECTOR_NAMES = 100

/** The warning when the host cannot list the session tools. */
const TOOLS_WARNING = t('scan.unknown', { what: t('scan.sessionToolsUnlisted') })

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

  return unfitNameWarnings(unfit.length, 'scan.settings.unfitMcpNames', source)
}

/**
 * Whether an MCP server name is a desktop app connector's (R2): a claude.ai connector of a desktop-app session arrives
 * as an SDK MCP server named by a UUID (DESKTOP_CONNECTOR_PATTERN), and a role session runs in the terminal, where that
 * server does not exist.
 */
export function isDesktopConnectorName(name: string): boolean {
  return DESKTOP_CONNECTOR_PATTERN.test(name)
}

/**
 * The line that counts the desktop app connectors a scan left out of the session's servers, and says why (R2); none
 * when it left out none.
 */
function desktopConnectorWarnings(count: number): string[] {
  if (count === 0) return []
  return [tn('scan.mcp.desktopLeftOut', count, { count })]
}

/** The MCP servers a scan kept from one source, and whether it could not see every server there (A4). */
export type McpScan = {
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
 * once, sorted, with source `session`. Only the name of a tool is read, never its description. A desktop app
 * connector's server, named by a UUID (isDesktopConnectorName, R2), is left out, and a server name a role.json cannot
 * hold (NAME_PATTERN) is dropped. Anything but a list gives [].
 */
export function projectToolServers(value: unknown): McpRef[] {
  return mcpRefsOf(toolServerNames(value).filter(name => !isDesktopConnectorName(name)), 'session')
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

/**
 * The MCP server names of the claude.ai connectors a `~/.claude.json` value lists (R2): of the first
 * MAX_CONNECTOR_NAMES entries of its own top-level `claudeAiMcpEverConnected` list, each string that starts with
 * CLAUDE_AI_PREFIX and has a name after it becomes CONNECTOR_PREFIX plus that name, every character outside letters,
 * digits, `_` and `-` replaced by `_`, as a terminal session names the connector's server; every other entry is
 * skipped. The list holds every connector the account ever connected, so a disconnected one may be named; only the
 * names are kept. Anything but a plain object whose own `claudeAiMcpEverConnected` is a list gives [].
 */
export function connectorServerNames(value: unknown): string[] {
  if (!isObject(value) || !Object.hasOwn(value, 'claudeAiMcpEverConnected')) return []
  const ever = value.claudeAiMcpEverConnected
  if (!Array.isArray(ever)) return []

  return ever.slice(0, MAX_CONNECTOR_NAMES).flatMap(entry => {
    const name = typeof entry === 'string' ? connectorNameOf(entry) : null

    return name === null ? [] : [name]
  })
}

/**
 * The server name a terminal session gives the claude.ai connector a `~/.claude.json` entry names (R2): for an entry
 * that starts with CLAUDE_AI_PREFIX and has a name after it, CONNECTOR_PREFIX plus that name, every character outside
 * letters, digits, `_` and `-` replaced by `_`; null for any other entry.
 */
function connectorNameOf(entry: string): string | null {
  if (!entry.startsWith(CLAUDE_AI_PREFIX)) return null
  const rest = entry.slice(CLAUDE_AI_PREFIX.length)

  return rest === '' ? null : CONNECTOR_PREFIX + rest.replace(/[^A-Za-z0-9_-]/g, '_')
}

/**
 * The entries of the projects of a `~/.claude.json` value at any of `roots` (the repo root as given and as resolved,
 * trailing slashes ignored); an empty root form matches no project, and anything but a plain object with a `projects`
 * object gives none.
 */
function projectsAt(value: unknown, roots: readonly string[]): unknown[] {
  if (!isObject(value) || !isObject(value.projects)) return []
  const wanted = roots.map(trimSlash).filter(root => root !== '')

  const projects = Object.entries(value.projects)

  return projects.flatMap(([path, project]) => (wanted.includes(trimSlash(path)) ? [project] : []))
}

/**
 * The server names of a `~/.claude.json` value: its top-level `mcpServers`, those of the projects at `roots`, and its
 * claude.ai connectors (connectorServerNames, R2).
 */
function claudeJsonNames(value: unknown, roots: readonly string[]): string[] {
  if (!isObject(value)) return []

  return [
    ...mcpServerNames(value),
    ...projectsAt(value, roots).flatMap(project => fieldKeysOf(project, 'mcpServers')),
    ...connectorServerNames(value),
  ]
}

/**
 * The MCP servers the repo project disabled in a `~/.claude.json` value (D-332): the `disabledMcpServers` list of the
 * project at any of `roots` (projectsAt), read as an array of strings, the shape research assumption A4 takes, of its
 * first MAX_CONNECTOR_NAMES entries; a claude.ai connector, which the list names by its display name (`claude.ai
 * Slack`), as a terminal session names its server (connectorNameOf, as connectorServerNames reads it), every other
 * name as it is, each name clean leaves unchanged at MAX_REF_NAME_CHARS, once each. Another project's list, a list
 * that is not an array and an entry that is not a string disable nothing; only the names are kept. userConfigMcpScan
 * reads it only after the consent (D-58).
 */
export function disabledProjectServers(value: unknown, roots: readonly string[]): string[] {
  const names = projectsAt(value, roots).flatMap(project => {
    const listed = isObject(project) ? project.disabledMcpServers : null
    if (!Array.isArray(listed)) return []

    return listed.slice(0, MAX_CONNECTOR_NAMES).flatMap(entry => {
      if (typeof entry !== 'string') return []
      if (!entry.startsWith(CLAUDE_AI_PREFIX)) return [entry]
      const name = connectorNameOf(entry)

      return name === null ? [] : [name]
    })
  })

  return stableNames(names, MAX_REF_NAME_CHARS)
}

/**
 * Whether the scan offers an MCP server (D-332, OC-05-A): never one the repo project disabled in `~/.claude.json`
 * (`disabled`, disabledProjectServers), by name; a `.mcp.json` server (source `project`) never when a settings file
 * rejects it (`disabledMcpjsonServers`), else only when the session connected it (`sessionNames`) or a settings file
 * approves it (`enableAllProjectMcpServers`, `enabledMcpjsonServers`), as one still pending approval cannot be used;
 * every other server is offered.
 */
export function isOfferedServer(
  ref: McpRef,
  disabled: readonly string[],
  settings: Pick<ProjectedSettings, 'mcpDisabled' | 'mcpEnabled' | 'isAllProjectMcpEnabled'>,
  sessionNames: readonly string[],
): boolean {
  if (disabled.includes(ref.name)) return false
  if (ref.source !== 'project') return true
  if (settings.mcpDisabled.includes(ref.name)) return false

  return sessionNames.includes(ref.name) || settings.isAllProjectMcpEnabled || settings.mcpEnabled.includes(ref.name)
}

/**
 * The MCP servers named in `~/.claude.json` (SCAN-02, D-58), which a scan reads only after the person consented: the
 * keys of the top-level `mcpServers` and of the `mcpServers` of the project at any of `roots` (the repo root as given
 * and as resolved, trailing slashes ignored), and the claude.ai connectors of its `claudeAiMcpEverConnected` list as a
 * terminal session names their servers (connectorServerNames, R2), sorted, with source `user-config`. Nothing else in
 * the file is kept: not the server entries, which hold tokens, not the account block and not another project. An empty
 * root form matches no project, and a server name a role.json cannot hold (NAME_PATTERN) is dropped. Anything but a
 * plain object gives [].
 */
export function projectClaudeJson(value: unknown, roots: readonly string[]): McpRef[] {
  return mcpRefsOf(claudeJsonNames(value, roots), 'user-config')
}

/**
 * The MCP servers of the session, from the host's tool list; a list the host cannot give adds a warning. The servers
 * of desktop app connectors (isDesktopConnectorName) are left out with one line that counts each of them once (R2),
 * and never make the scan partial; the scan is partial when another server name was dropped.
 */
export async function sessionMcpScan(io: InitIo, warnings: string[]): Promise<McpScan> {
  const value = await io.tools()
  if (!Array.isArray(value)) {
    warnings.push(TOOLS_WARNING)

    return NO_MCP
  }
  const names = toolServerNames(value)
  const connectors = new Set(names.filter(isDesktopConnectorName))
  const kept = names.filter(name => !isDesktopConnectorName(name))
  warnings.push(...hiddenNameWarnings(kept, 'mcpServerName', MAX_REF_NAME_CHARS))
  warnings.push(...unfitMcpWarnings(kept, t('scan.setup.mcp.sessionMcpScan2')))
  warnings.push(...desktopConnectorWarnings(connectors.size))

  return mcpScanOf(projectToolServers(value), kept)
}

/**
 * The MCP servers of the repo's `.mcp.json`. The file is read only when its stat shows a regular file whose real path
 * is inside the repo (WR-02); a link out of the repo, a folder, any other kind or a failed stat is not read and adds a
 * warning. A file that is not there is quiet. The scan is partial when a server name was dropped.
 */
export async function projectMcpScan(io: InitIo, ctx: SetupContext, warnings: string[]): Promise<McpScan> {
  const path = `${ctx.root}/.mcp.json`
  if (!(await isInsideRepo(io, ctx, path, isFileInsideRoot, warnings))) return NO_MCP
  const value = await readJson(io, ctx, path, MAX_READ_BYTES, warnings)
  const names = mcpServerNames(value)
  warnings.push(...hiddenNameWarnings(names, 'mcpServerName', MAX_REF_NAME_CHARS))
  warnings.push(...unfitMcpWarnings(names, shownPath(ctx, path)))

  return mcpScanOf(projectMcpJson(value), names)
}

/**
 * The MCP servers named in `~/.claude.json`, and beside them the servers the repo project disabled there
 * (disabledProjectServers, D-332). The file is looked for only when the person consented (D-58): without consent
 * nothing is read, stat'ed or warned about, and no server is known to be disabled. A file that is not there is quiet,
 * one that cannot be read, is over the 4 MiB cap or does not parse adds a warning. The scan is partial when the file
 * was not read (no consent, no user folder, or a file it could not read or parse) or a server name was dropped (A4); a
 * file that is not there is not. The file is the one claudeJsonPathOf names for the repo root, the root list of the
 * scan's user folder (scanSetup), whose userDirOf call already shows the warning for a CLAUDE_CONFIG_DIR the D-238 rule
 * ignores (SR-1, WF-S3).
 */
export async function userConfigMcpScan(
  io: InitIo,
  ctx: SetupContext,
  isAllowed: boolean,
  warnings: string[],
): Promise<McpScan & { readonly disabled: readonly string[] }> {
  const unread = { ...UNREAD_MCP, disabled: [] }
  if (!isAllowed) return unread
  const path = claudeJsonPathOf(ctx, [ctx.root], [])
  if (path === null) return unread
  const read = await readJsonFile(io, ctx, path, CLAUDE_JSON_MAX_BYTES, warnings)
  if (read.state === 'unknown') return unread
  const value = read.state === 'parsed' ? read.value : null
  const roots = [ctx.root, ctx.givenRoot]
  const names = claudeJsonNames(value, roots)
  warnings.push(...hiddenNameWarnings(names, 'mcpServerName', MAX_REF_NAME_CHARS))
  warnings.push(...unfitMcpWarnings(names, shownPath(ctx, path)))

  return { ...mcpScanOf(projectClaudeJson(value, roots), names), disabled: disabledProjectServers(value, roots) }
}

/** The servers once each by name, keeping the first source in the order the lists are given, sorted by name. */
export function mergeMcp(lists: readonly (readonly McpRef[])[]): McpRef[] {
  const first = new Map<string, McpRef>()
  for (const ref of lists.flat()) {
    if (!first.has(ref.name)) first.set(ref.name, ref)
  }

  return Array.from(first.values()).sort((a, b) => compareText(a.name, b.name))
}
