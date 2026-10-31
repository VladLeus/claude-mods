/**
 * The runtime MCP config of a role (D-93, LNCH-02), a layer 10 module: the user's `~/.claude.json`, read only when
 * cadre.json records the consent (readClaudeJson, D-58), and the text of `.runtime/mcp.json` that runtimeMcpText
 * renders from it for the servers a role is given, with one warning per server it cannot render. A config value
 * reaches only that text, never a reply or a warning. It reads through the InitIo port only; it imports core, paths
 * and scan/setup, and the role render reads it.
 */
import type { InitIo, InitLocations, RoleSpec } from '../../types'
import { isObject, parseJsonValue, stableJson } from '../core/json'
import { reportText, sortedUnique } from '../core/text'
import { t } from '../locales/t'
import { claudeJsonPathOf, trimSlash } from '../paths'
import { CLAUDE_JSON_MAX_BYTES } from '../scan/setup/mcp'

/** The warning for a role given MCP servers when cadre.json records no consent to read ~/.claude.json (D-58). */
const MCP_NOT_READ_WARNING = t('start.mcpConfig.mcpNotReadWarning')

/** The warning for a server a role is given that ~/.claude.json does not hold; the name is shown cleaned. */
function mcpNotInFileWarning(name: string): string {
  return (
    t('start.mcpConfig.mcpNotInFileWarning', {
      name: reportText(name),
    })
  )
}

/**
 * The user's `~/.claude.json` as a parsed value (D-93), read only when cadre.json records the consent (readUserMcp,
 * D-58): without it nothing is read. The file is the one claudeJsonPathOf names for `roots`, the roots the launch keeps
 * the user folder outside of (WF-S4), so a CLAUDE_CONFIG_DIR the D-238 rule ignores never names it (SR-1); the run's
 * setup scan already shows that warning, so none is added here (WF-S3). It is read up to CLAUDE_JSON_MAX_BYTES.
 * Null when the read is not allowed, there is no user folder, or the file is absent, unreadable, too large or not
 * JSON. Its values reach only the runtime MCP config (runtimeMcpText), never a reply or a warning.
 */
export async function readClaudeJson(
  io: InitIo,
  locations: InitLocations,
  readUserMcp: boolean,
  roots: readonly string[],
): Promise<unknown> {
  if (!readUserMcp) return null
  const path = claudeJsonPathOf(locations, roots, [])
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
