/**
 * The launch settings, a layer 9 module: a role's runtime settings as the launch renders them, with only the allowed
 * keys in their order, the memory folder, the carried window, status line, env and hooks the user has, the excludes
 * and the deny list, and never the context monitor hook (D-62, D-84, D-91, A7). It imports core, paths, the scope card
 * and lint, the launch links and denies, and the types, so the launch plan renders the settings here.
 */
import type { CompiledScope, RoleSpec } from '../../types'
import { sortedUnique } from '../core/text'
import { roleMemoryDir } from '../paths'
import { mcpToolName } from '../scope/card'
import { isContextMonitorScript } from '../scope/lint'
import { settingsDeny } from './deny'
import type { LaunchUser } from './links'

/**
 * The only settings keys a rendered runtime file may hold (D-84). The render adds a key from this list and nothing
 * else, so a value the user's own settings hold under any other key never reaches a role session.
 */
export const RUNTIME_SETTINGS_KEYS: readonly string[] = Object.freeze([
  'autoCompactWindow',
  'autoMemoryDirectory',
  'claudeMdExcludes',
  'deniedMcpServers',
  'enabledPlugins',
  'env',
  'hooks',
  'permissions',
  'sandbox',
  'statusLine',
])

/** The window value when the role carries it and the user has one; null otherwise. */
function carriedWindow(role: RoleSpec, user: LaunchUser): number | null {
  return role.carry.autoCompactWindow ? user.autoCompactWindow : null
}

/** The user's status line when the role carries it and the user has one; null otherwise. */
function carriedStatusLine(role: RoleSpec, user: LaunchUser): unknown {
  return role.carry.statusLine ? user.statusLine : null
}

/**
 * The env of the role: the user's value for each env name the role carries, sorted by name. A name the user has no
 * value for is left out, and a name that is a property of every object (`constructor`) is never read as a value. Null
 * when nothing is left, so an empty env is not rendered.
 */
function carriedEnv(role: RoleSpec, user: LaunchUser): Record<string, string> | null {
  const entries: [string, string][] = []
  for (const name of sortedUnique(role.carry.env)) {
    const value = Object.hasOwn(user.env, name) ? user.env[name] : undefined
    if (typeof value === 'string') entries.push([name, value])
  }

  return entries.length === 0 ? null : Object.fromEntries(entries)
}

/** One carried hook command as the settings hold it; `timeout` only when the user set one. */
type HookEntry = { readonly type: 'command'; readonly command: string; readonly timeout?: number }

/**
 * The hooks of the role: the user's hooks whose script the role carries, never the context monitor (D-62), with the
 * matcher and the timeout the user's settings give them, so a hook still runs only on the tools its owner set. Each
 * event holds one group per matcher, as `{ [event]: [{ matcher, hooks: [{ type: 'command', command, timeout }] }] }`;
 * a group with a null or empty matcher has no `matcher` key; the engine treats both as every tool. A hook with a null
 * timeout has no `timeout` key. The events, and the groups of an event, come in the order they are first seen, and the
 * commands of a group in the order given. Null when no hook is left.
 */
function carriedHooks(role: RoleSpec, user: LaunchUser): Record<string, unknown> | null {
  const wanted = new Set(role.carry.hooks)
  const events = new Map<string, Map<string | null, HookEntry[]>>()
  for (const hook of user.hooks) {
    if (!wanted.has(hook.script) || isContextMonitorScript(hook.script)) continue
    const groups = events.get(hook.event) ?? new Map<string | null, HookEntry[]>()
    const matcher = hook.matcher === '' ? null : hook.matcher
    const list = groups.get(matcher) ?? []
    const entry: HookEntry = { type: 'command', command: hook.command }
    list.push(hook.timeout === null ? entry : { ...entry, timeout: hook.timeout })
    groups.set(matcher, list)
    events.set(hook.event, groups)
  }
  if (events.size === 0) return null

  return Object.fromEntries(
    Array.from(events, ([event, groups]): [string, unknown] => [
      event,
      Array.from(groups, ([matcher, hooks]) => (matcher === null ? { hooks } : { matcher, hooks })),
    ]),
  )
}

/** The key and value as one settings entry, or nothing when the value is null or undefined. */
function entryIf(key: string, value: unknown): [string, unknown][] {
  return value === null || value === undefined ? [] : [[key, value]]
}

/**
 * The deniedMcpServers entries of a role (D-124, #39): every scanned server the card lists as not given whose tool name
 * the deny list holds, by the name the scan gave it, so the engine removes the whole server and not only its tools.
 */
function deniedServers(scope: CompiledScope, deny: readonly string[]): { readonly serverName: string }[] {
  return scope.card.notGiven.mcp.filter(name => deny.includes(mcpToolName(name))).map(serverName => ({ serverName }))
}

/** The settings of renderRuntimeSettings with the deny list given, so a caller that has it computes it only once. */
export function settingsFor(
  role: RoleSpec,
  scope: CompiledScope,
  user: LaunchUser,
  claudeMdExcludes: readonly string[],
  deny: readonly string[],
): Readonly<Record<string, unknown>> {
  const entries: [string, unknown][] = [
    ...entryIf('autoCompactWindow', carriedWindow(role, user)),
    ['autoMemoryDirectory', roleMemoryDir(user, role.id)],
    ['claudeMdExcludes', [...claudeMdExcludes]],
    ['deniedMcpServers', deniedServers(scope, deny)],
    ['enabledPlugins', { ...scope.settings.enabledPlugins }],
    ...entryIf('env', carriedEnv(role, user)),
    ...entryIf('hooks', carriedHooks(role, user)),
    ['permissions', { defaultMode: scope.settings.permissions.defaultMode, deny: [...deny] }],
    ['sandbox', { enabled: scope.settings.sandbox.enabled }],
    ...entryIf('statusLine', carriedStatusLine(role, user)),
  ]

  return Object.fromEntries(entries)
}

/**
 * The runtime settings of a role: the launch half of D-66. Phase 3 writes the result to
 * `.cadre/<id>/.runtime/settings.json`; Phase 2 never writes it. It holds the template's plugins and sandbox, the
 * permissions with the deny list of `settingsDeny` (runtimeDeny's, the private instructions folder's and, for a
 * parts-flow role, the linked memories', G-02-1f), the absolute memory folder of the role (D-91), the given CLAUDE.md
 * excludes, the scanned servers its tool denies cover as deniedMcpServers (D-124), and the values the role carries from
 * the user's settings: the compact window, the status line, the env values for its env names, and its hooks (D-60,
 * D-62, D-84). Every key is one of RUNTIME_SETTINGS_KEYS, in that order, so a value of any other name or key never
 * appears.
 */
export function renderRuntimeSettings(
  role: RoleSpec,
  scope: CompiledScope,
  user: LaunchUser,
  claudeMdExcludes: readonly string[],
): Readonly<Record<string, unknown>> {
  return settingsFor(role, scope, user, claudeMdExcludes, settingsDeny(role, scope, user).deny)
}
