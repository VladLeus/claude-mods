import type { CompiledScope, RoleSpec } from '../types'
import { clean, sortedUnique } from './facts'
import { isSafeDir, lintDenyPattern, roleOwnPaths } from './scope'

/**
 * The only settings keys a rendered runtime file may hold (D-84). The render adds a key from this list and nothing
 * else, so a value the user's own settings hold under any other key never reaches a role session.
 */
export const RUNTIME_SETTINGS_KEYS: readonly string[] = Object.freeze([
  'autoCompactWindow',
  'autoMemoryDirectory',
  'claudeMdExcludes',
  'enabledPlugins',
  'env',
  'hooks',
  'permissions',
  'sandbox',
  'statusLine',
])

/**
 * The facts about the launching user that the launch half needs (D-98). Phase 3 gathers them at launch and passes them
 * in; this module reads nothing from disk and nothing here is ever committed (PLAN-05). Every path is absolute.
 */
export type LaunchUser = {
  /** The git top level, as a realpath. */
  readonly root: string
  readonly home: string
  /** CLAUDE_CONFIG_DIR when it is set, else `<home>/.claude`. */
  readonly userDir: string
  /** The git common dir, as a realpath. */
  readonly gitCommonDir: string
  /** Lowercase hex SHA-256 of `gitCommonDir`; the caller computes it with `sha256Hex`. */
  readonly commonDirHash: string
  readonly autoCompactWindow: number | null
  /** The `statusLine` of the user's settings as read; null when it is unset. */
  readonly statusLine: unknown
  /** The `env` block of the user's settings. Only the names a role carries are ever rendered from it. */
  readonly env: Readonly<Record<string, string>>
  /** The user's hooks: the event, the script basename and the whole command, which may hold absolute paths. */
  readonly hooks: readonly { readonly event: string; readonly script: string; readonly command: string }[]
  /** The CLAUDE.md files the engine loads for the root: the root's, `.claude/CLAUDE.md` and every ancestor's. */
  readonly claudeMd: readonly string[]
  /** `<userDir>/CLAUDE.md` first, then the files it imports as the caller resolved them; empty with no global file. */
  readonly globalClaudeMd: readonly string[]
  /** File names in this repo's auto-memory folder. */
  readonly memoryFiles: readonly string[]
  /** Folder names in `<userDir>/skills`. */
  readonly userSkills: readonly string[]
  /** File names without `.md` in `<userDir>/agents`. */
  readonly userAgents: readonly string[]
  /** The top-level code dirs to deny with exact patterns; Phase 3 passes the repo scan's at launch. */
  readonly codeDirs: readonly string[]
}

/** One symlink the launch plans: `path` is where Phase 3 creates it, `target` is what it points at. Both absolute. */
export type OverlayLink = {
  readonly path: string
  readonly target: string
}

/** The CLAUDE.md files a role must not load, and the links that deliver the instruction and memory files it gets. */
export type InstructionPlan = {
  readonly claudeMdExcludes: readonly string[]
  readonly links: readonly OverlayLink[]
}

/**
 * The launch half of D-66, for one role: the rendered runtime settings, every symlink to create under
 * `.cadre/<id>/.runtime/`, and the warnings to show. Phase 3 writes it out; Phase 2 never does.
 */
export type LaunchPlan = {
  readonly settings: Readonly<Record<string, unknown>>
  readonly links: readonly OverlayLink[]
  readonly warnings: readonly string[]
}

/** The deny list of a role at launch, and what to tell the person about it. */
type DenyResult = {
  readonly deny: readonly string[]
  readonly warnings: readonly string[]
}

/** The most code points of a scanned name that a warning shows. */
const MAX_SHOWN_CHARS = 110

/** The repo name used in the memory slug when the common dir has no parent folder to name it after. */
const FALLBACK_REPO_NAME = 'repo'

/** A character a memory slug may not hold: anything but letters, digits, dot, underscore and dash, per code point. */
const UNSAFE_SLUG_CHARS = /[^A-Za-z0-9._-]/gu

/** A repo root a permission rule can hold: a canonical absolute path of safe characters (`/a/b`), nothing else. */
const SAFE_ROOT = /^(?:\/[A-Za-z0-9._-]+)+$/

/** The template's code-dir denies are exactly `Read(./<dir>/**)` and `Edit(./<dir>/**)`; the secret denies differ. */
const CODE_DIR_DENY = /^(?:Read|Edit)\(\.\/[^/]+\/\*\*\)$/

/** A rule on a tool that takes a path, with an absolute `//` argument. */
const ABSOLUTE_RULE = /^(?:Edit|NotebookEdit|Read|Write)\((\/\/[\s\S]*)\)$/

/** The lint answer for an absolute pattern with a `..` segment. */
const DOTDOT_MESSAGE = 'a .. segment is not allowed in an absolute pattern'

/** The warning when the repo path cannot be written into a rule, so the any-depth denies of the template stay. */
const UNSAFE_ROOT_WARNING =
  'the repo path holds characters a permission rule cannot hold: code-dir denies stay any-depth'

/** The script name prefix of the hook that fights autopilot's handoff, which no role ever gets (D-62). */
const CONTEXT_MONITOR_PREFIX = 'gsd-context-monitor'

/**
 * The folder name of a repo's role memory (D-91): the name of the folder that holds the git common dir, then `-` and
 * the first 8 hex characters of the hash of the common dir, so two repos with the same name do not share memory. Every
 * character outside letters, digits, `.`, `_` and `-` becomes `-`, so the slug is always one safe path segment. A
 * common dir with no parent folder is named `repo`. A linked worktree has the same common dir as its main checkout, so
 * all roles of all worktrees of a repo share one memory folder (D-20).
 */
export function memorySlug(gitCommonDir: string, hashHex: string): string {
  const parents = gitCommonDir
    .split('/')
    .filter(part => part !== '')
    .slice(0, -1)
  const name = parents.at(-1) ?? ''
  const base = name === '' ? FALLBACK_REPO_NAME : name

  return `${base}-${hashHex.slice(0, 8)}`.replace(UNSAFE_SLUG_CHARS, '-')
}

/**
 * The absolute memory folder of a role (D-20, D-91): `<home>/.claude/cadre/<slug>/<id>`, the folder the scope card
 * promises. It is absolute because the engine ignores a repo-relative `autoMemoryDirectory` (spike S2). The role id is
 * a validated slug, so it is safe in a path.
 */
export function roleMemoryDir(user: LaunchUser, id: string): string {
  return `${user.home}/.claude/cadre/${memorySlug(user.gitCommonDir, user.commonDirHash)}/${id}`
}

/**
 * The reason a deny pattern must not be emitted into the runtime settings, or null when it is fine. An exact absolute
 * `//` path rule is fine unless it holds a `..` segment; every other pattern is judged by the committed lint
 * (`lintDenyPattern`), so a single leading `/` (it matches nothing, P13) and anything that would block an infra tool
 * (ISO-04) are refused here too.
 */
export function lintRuntimeDenyPattern(pattern: string): string | null {
  const argument = ABSOLUTE_RULE.exec(pattern)?.[1]
  if (argument === undefined) return lintDenyPattern(pattern)
  if (argument.split('/').includes('..')) return DOTDOT_MESSAGE

  return null
}

/** Whether a repo root can be written into an exact `//` pattern: a canonical path with no `.` or `..` segment. */
function isSafeRoot(root: string): boolean {
  return SAFE_ROOT.test(root) && !root.split('/').some(part => part === '.' || part === '..')
}

/** The entries sorted and once each, those the runtime lint refuses dropped and named after the given warnings. */
function lintedDeny(entries: readonly string[], warnings: readonly string[]): DenyResult {
  const deny: string[] = []
  const refused: string[] = []
  for (const entry of sortedUnique(entries)) {
    const message = lintRuntimeDenyPattern(entry)
    if (message === null) deny.push(entry)
    else refused.push(`${clean(entry, MAX_SHOWN_CHARS)} was not emitted: ${message}`)
  }

  return { deny, warnings: [...warnings, ...refused] }
}

/**
 * The deny list of a role at launch (ROLE-05, D-84, P13). A role with Bash keeps the denies of its template, which hold
 * no code dir. For a role without Bash, the template's any-depth code-dir denies (`Read(./x/**)` matches every folder
 * named x) are replaced by exact absolute ones, `Read(//<root>/<dir>/**)` and `Edit(//<root>/<dir>/**)`, for every code
 * dir the user has, which hit that one folder and no other. A dir is skipped when `<root>/<dir>/` is a prefix of one of
 * the role's own paths (`.cadre/<id>/`, `.planning/`, `thoughts/shared/handoffs/<id>/`; compared without letter case,
 * as a file system may ignore it), so those stay readable (D-80); a dir with an unusual name (`isSafeDir`) is skipped
 * with a warning. A root a rule cannot hold keeps the template's denies and warns. The result is sorted and once each,
 * and an entry that fails `lintRuntimeDenyPattern` is dropped with a warning, so no deny can block an infra tool.
 */
export function runtimeDeny(role: RoleSpec, scope: CompiledScope, user: LaunchUser): DenyResult {
  const template = scope.settings.permissions.deny
  if (role.hasBash) return lintedDeny(template, [])
  if (!isSafeRoot(user.root)) return lintedDeny(template, [UNSAFE_ROOT_WARNING])

  const dirs = sortedUnique(user.codeDirs)
  const own = roleOwnPaths(role.id).map(path => path.toLowerCase())
  const exact = dirs
    .filter(isSafeDir)
    .filter(dir => !own.some(path => path.startsWith(`${dir.toLowerCase()}/`)))
    .flatMap(dir => [`Read(//${user.root.slice(1)}/${dir}/**)`, `Edit(//${user.root.slice(1)}/${dir}/**)`])
  const unusual = dirs
    .filter(dir => !isSafeDir(dir))
    .map(dir => `Code dir ${clean(dir, MAX_SHOWN_CHARS)} has an unusual name and is not denied`)

  return lintedDeny([...template.filter(entry => !CODE_DIR_DENY.test(entry)), ...exact], unusual)
}

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

/** Whether a hook script is the context monitor, which fights autopilot's handoff (D-62), whatever its letter case. */
function isContextMonitor(script: string): boolean {
  return script.toLowerCase().startsWith(CONTEXT_MONITOR_PREFIX)
}

/**
 * The hooks of the role: the user's hooks whose script the role carries, never the context monitor (D-62), as
 * `{ [event]: [{ hooks: [{ type: 'command', command }] }] }`. The events come in the order they are first seen, and the
 * commands of an event in the order given. Null when no hook is left.
 */
function carriedHooks(role: RoleSpec, user: LaunchUser): Record<string, unknown> | null {
  const wanted = new Set(role.carry.hooks)
  const commands = new Map<string, { readonly type: string; readonly command: string }[]>()
  for (const hook of user.hooks) {
    if (!wanted.has(hook.script) || isContextMonitor(hook.script)) continue
    const list = commands.get(hook.event) ?? []
    list.push({ type: 'command', command: hook.command })
    commands.set(hook.event, list)
  }
  if (commands.size === 0) return null

  return Object.fromEntries(Array.from(commands, ([event, list]): [string, unknown] => [event, [{ hooks: list }]]))
}

/** The key and value as one settings entry, or nothing when the value is null or undefined. */
function entryIf(key: string, value: unknown): [string, unknown][] {
  return value === null || value === undefined ? [] : [[key, value]]
}

/**
 * The runtime settings of a role: the launch half of D-66. Phase 3 writes the result to
 * `.cadre/<id>/.runtime/settings.json`; Phase 2 never writes it. It holds the template's plugins and sandbox, the
 * permissions with the deny list of `runtimeDeny`, the absolute memory folder of the role (D-91), the given CLAUDE.md
 * excludes, and the values the role carries from the user's settings: the compact window, the status line, the env
 * values for its env names, and its hooks (D-60, D-62, D-84). A key is added only from RUNTIME_SETTINGS_KEYS, in that
 * order, so a value of any other name or key never appears.
 */
export function renderRuntimeSettings(
  role: RoleSpec,
  scope: CompiledScope,
  user: LaunchUser,
  claudeMdExcludes: readonly string[],
): Readonly<Record<string, unknown>> {
  const entries: [string, unknown][] = [
    ...entryIf('autoCompactWindow', carriedWindow(role, user)),
    ['autoMemoryDirectory', roleMemoryDir(user, role.id)],
    ['claudeMdExcludes', [...claudeMdExcludes]],
    ['enabledPlugins', { ...scope.settings.enabledPlugins }],
    ...entryIf('env', carriedEnv(role, user)),
    ...entryIf('hooks', carriedHooks(role, user)),
    [
      'permissions',
      { defaultMode: scope.settings.permissions.defaultMode, deny: [...runtimeDeny(role, scope, user).deny] },
    ],
    ['sandbox', { enabled: scope.settings.sandbox.enabled }],
    ...entryIf('statusLine', carriedStatusLine(role, user)),
  ]

  return Object.fromEntries(entries.filter(([key]) => RUNTIME_SETTINGS_KEYS.includes(key)))
}

/**
 * The launch half of D-66 for one role (D-98): from the role, its compiled scope and the launching user's facts it
 * returns the runtime settings, the symlinks to create and the warnings to show. It is pure: it reads nothing, writes
 * nothing and keeps nothing between calls, so Phase 3 only gathers the facts and writes the result under
 * `.cadre/<id>/.runtime/`.
 */
export function launchPlan(role: RoleSpec, scope: CompiledScope, user: LaunchUser): LaunchPlan {
  return {
    settings: renderRuntimeSettings(role, scope, user, []),
    links: [],
    warnings: runtimeDeny(role, scope, user).warnings,
  }
}
