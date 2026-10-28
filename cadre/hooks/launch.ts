import type { CompiledScope, RoleSpec } from '../types'
import { shown, sortedUnique } from './core/text'
import { instructionPlan, isPartsFlowRole, runtimeDir, sortedLinks } from './launch/links'
import type { LaunchUser, LinkSet, OverlayLink } from './launch/links'
import { INSTRUCTIONS_RECORD_FILE, memoryFolderOf, privateInstructionsDir, roleMemoryDir } from './paths'
import { mcpToolName } from './scope/card'
import { isContextMonitorScript, isSafeDir, lintDenyPattern, roleOwnPaths, SECRET_READ_DENY } from './scope/lint'

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

/** A repo root a permission rule can hold: a canonical absolute path of safe characters (`/a/b`), nothing else. */
const SAFE_ROOT = /^(?:\/[A-Za-z0-9._-]+)+$/

/**
 * The template's code-dir denies are exactly `Read(./<dir>/**)` and `Edit(./<dir>/**)`, and the group holds the dir;
 * the secret denies differ.
 */
const CODE_DIR_DENY = /^(?:Read|Edit)\(\.\/([^/]+)\/\*\*\)$/

/** The start of a template Read deny anchored at the session's cwd. */
const RELATIVE_READ_PREFIX = 'Read(./'

/**
 * The template's secret denies that are anchored at the session's cwd, the two repo .env rules; a launcher that starts
 * in a sub-folder or elsewhere would miss the root's files (A2, P13).
 */
const RELATIVE_SECRET_DENY: readonly string[] = Object.freeze(
  SECRET_READ_DENY.filter(entry => entry.startsWith(RELATIVE_READ_PREFIX)),
)

/** A rule on a tool that takes a path, with an absolute `//` argument. */
const ABSOLUTE_RULE = /^(?:Edit|NotebookEdit|Read|Write)\((\/\/[\s\S]*)\)$/

/** The lint answer for an absolute pattern with a `..` segment. */
const DOTDOT_MESSAGE = 'a .. segment is not allowed in an absolute pattern'

/** The warning when the repo path cannot be written into a rule, so the any-depth denies of the template stay. */
const UNSAFE_ROOT_WARNING =
  'the repo path holds characters a permission rule cannot hold: code-dir denies stay any-depth'

/** A skill or agent name that may become a link name: a plain name of 1 to 80 characters (T-02-46). */
const SAFE_OVERLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/

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
    else refused.push(`${shown(entry)} was not emitted: ${message}`)
  }

  return { deny, warnings: [...warnings, ...refused] }
}

/**
 * The repo .env read denies made absolute (A2, P13): each at the repo root and at any depth under it, so the deny
 * holds wherever the launcher starts.
 */
function absoluteSecretDeny(root: string): string[] {
  return RELATIVE_SECRET_DENY.flatMap(entry => {
    const name = entry.slice(RELATIVE_READ_PREFIX.length, -1)

    return [`Read(//${root}/${name})`, `Read(//${root}/**/${name})`]
  })
}

/**
 * The deny list of a role at launch (ROLE-05, D-84, P13). The .env denies are absolute for every role with a safe
 * root, Bash roles included (D-123): the template's two repo .env denies (`Read(./.env)`, `Read(./.env.*)`), anchored
 * at the cwd, are replaced by `Read(//<root>/.env)`, `Read(//<root>/.env.*)`, `Read(//<root>/**\/.env)` and
 * `Read(//<root>/**\/.env.*)`, so they hold wherever the launcher starts; the ~/ denies stay as written (A2). Code-dir
 * denies are for a role without Bash only; a Bash role's template holds none, and none is added. For a role without
 * Bash, the template's any-depth code-dir denies (`Read(./x/**)` matches every folder named x) are replaced by exact
 * absolute ones, `Read(//<root>/<dir>/**)` and `Edit(//<root>/<dir>/**)`, which hit that one folder and no other, for
 * every code dir the launch scan names and every dir a template code-dir deny names, so a folder the launch scan missed
 * keeps its deny (fail closed). A dir is skipped when `<root>/<dir>/` is a prefix of one of the role's own paths
 * (`.cadre/<id>/`, `.planning/`, `thoughts/shared/handoffs/<id>/`; compared without letter case, as a file system may
 * ignore it), so those stay readable (D-80); a dir with an unusual name (`isSafeDir`) is skipped with a warning. A root
 * a rule cannot hold keeps the template's denies; a role without Bash is then warned that its code-dir denies stay
 * any-depth. The result is sorted and once each, and an entry that fails `lintRuntimeDenyPattern` is dropped with a
 * warning, so no deny can block an infra tool.
 */
export function runtimeDeny(role: RoleSpec, scope: CompiledScope, user: LaunchUser): DenyResult {
  const template = scope.settings.permissions.deny
  if (role.hasBash && !isSafeRoot(user.root)) return lintedDeny(template, [])
  if (role.hasBash) {
    const kept = template.filter(entry => !RELATIVE_SECRET_DENY.includes(entry))

    return lintedDeny([...kept, ...absoluteSecretDeny(user.root.slice(1))], [])
  }
  if (!isSafeRoot(user.root)) return lintedDeny(template, [UNSAFE_ROOT_WARNING])

  const templateDirs = template.flatMap(entry => {
    const dir = CODE_DIR_DENY.exec(entry)?.[1]

    return dir === undefined ? [] : [dir]
  })
  const dirs = sortedUnique([...user.codeDirs, ...templateDirs])
  const own = roleOwnPaths(role.id).map(path => path.toLowerCase())
  const exact = dirs
    .filter(isSafeDir)
    .filter(dir => !own.some(path => path.startsWith(`${dir.toLowerCase()}/`)))
    .flatMap(dir => [`Read(//${user.root.slice(1)}/${dir}/**)`, `Edit(//${user.root.slice(1)}/${dir}/**)`])
  const unusual = dirs
    .filter(dir => !isSafeDir(dir))
    .map(dir => `Code dir ${shown(dir)} has an unusual name and is not denied`)

  return lintedDeny(
    [
      ...template.filter(entry => !CODE_DIR_DENY.test(entry) && !RELATIVE_SECRET_DENY.includes(entry)),
      ...exact,
      ...absoluteSecretDeny(user.root.slice(1)),
    ],
    unusual,
  )
}

/** The warning for a linked memory whose path no exact rule can hold (G-02-1f, T-02-73): it gets no deny. */
export function undeniedMemoryWarning(file: string): string {
  return `memory ${shown(file)} has a path a permission rule cannot hold: it stays editable`
}

/** The warning for a private instructions folder whose path no exact rule can hold (02-GAPS-B2 S3): it gets no deny. */
export const UNDENIED_PRIVATE_WARNING =
  'the private instructions folder has a path a permission rule cannot hold: it stays editable'

/**
 * The warning for a memory folder of the repo whose path no exact rule can hold (02-GAPS-B3 C2): it gets no deny, so
 * a role could still edit the memories there, through a link or not.
 */
export const UNDENIED_MEMORY_FOLDER_WARNING =
  'the memory folder of this repo has a path a permission rule cannot hold: its memories stay editable'

/**
 * The warning for a hand-out record whose path no exact rule can hold (02-GAPS-B3 C3): it gets no deny, so a role
 * could still rewrite which memories its next start links.
 */
export const UNDENIED_RECORD_WARNING =
  'the hand-out record instructions.json has a path a permission rule cannot hold: it stays editable'

/**
 * The exact Edit and Write rules of an absolute path, with `suffix` after it (`/**` for a whole folder); null when an
 * exact `//` rule cannot hold the path as it is (isSafeRoot) or the runtime lint refuses either rule. Exported for the
 * improver guard (02-GAPS-B3 M1).
 */
export function editWriteRules(path: string, suffix: string): string[] | null {
  if (!isSafeRoot(path)) return null
  const rules = [`Edit(/${path}${suffix})`, `Write(/${path}${suffix})`]

  return rules.every(rule => lintRuntimeDenyPattern(rule) === null) ? rules : null
}

/**
 * The best-effort read-only deny of a role's linked memories (G-02-1f, D-140 q3-a, T-02-73): `Edit(//<path>)` and
 * `Write(//<path>)` for each link path in the role memory folder, its leading slash part of the `//`, each passing
 * lintRuntimeDenyPattern. A path an exact rule cannot hold as it is (isSafeRoot: not absolute, a `.` or `..` segment,
 * or a character other than a letter, digit, `.`, `_` or `-`) gets no rule but undeniedMemoryWarning, naming its file:
 * that memory stays editable. A Bash write is never covered. The rules are sorted and once each, the warnings in the
 * order of the paths, once per path.
 */
export function linkedMemoryDeny(paths: readonly string[]): DenyResult {
  const deny: string[] = []
  const warnings: string[] = []
  for (const path of new Set(paths)) {
    const rules = editWriteRules(path, '')
    if (rules === null) warnings.push(undeniedMemoryWarning(path.slice(path.lastIndexOf('/') + 1)))
    else deny.push(...rules)
  }

  return { deny: sortedUnique(deny), warnings }
}

/**
 * The deny of a role's private instructions folder (02-GAPS-B2 S3): `Edit(//<folder>/**)` and `Write(//<folder>/**)`
 * for privateInstructionsDir, so the role cannot rewrite what its next session loads through the folder its launcher
 * adds (`.runtime/private-instructions`), a working folder git does not see; a deny rule holds for a path that
 * resolves into the folder too. A folder an exact rule cannot hold gets none, with UNDENIED_PRIVATE_WARNING.
 */
function privateInstructionsDeny(user: LaunchUser, id: string): DenyResult {
  const rules = editWriteRules(privateInstructionsDir(user, id), '/**')

  return rules === null ? { deny: [], warnings: [UNDENIED_PRIVATE_WARNING] } : { deny: rules, warnings: [] }
}

/**
 * The deny of the repo's memory folders (02-GAPS-B3 C2): `Edit(//<folder>/**)` and `Write(//<folder>/**)` for the
 * memory folder of the root as resolved and as given, and of the main checkout when `mainRoot` is set (03.1-W3 M1),
 * (memoryFolderOf), once each, so no role edits a memory, through the links /cadre start makes or the ones under
 * `.runtime/instructions/memory`. A folder an exact rule cannot hold gets none, and the warning
 * UNDENIED_MEMORY_FOLDER_WARNING comes once.
 */
function memoryFolderDeny(user: LaunchUser): DenyResult {
  const roots = [user.root, user.givenRoot, ...(user.mainRoot === undefined ? [] : [user.mainRoot])]
  const folders = sortedUnique(roots.map(root => memoryFolderOf(user.userDir, root)))
  const rules = folders.map(folder => editWriteRules(folder, '/**'))
  const deny = rules.flatMap(rule => rule ?? [])

  return { deny, warnings: rules.includes(null) ? [UNDENIED_MEMORY_FOLDER_WARNING] : [] }
}

/**
 * The deny of the files a later launch runs or trusts (03.1-SEC-S1): `Edit` and `Write` of
 * `<root>/.claude/settings.json` and `<root>/.claude/settings.local.json` (their hooks run at the next session start),
 * `<root>/.cadre/bin/**` and `<root>/.cadre/manifest.json`, for the root as resolved and as given and for the main
 * checkout when `mainRoot` is set, once each, so an Edit-only role cannot plant a hook or rewrite a launcher. A path an
 * exact rule cannot hold gets none and no warning: a role without Bash already gets runtimeDeny's root warning, and a
 * Bash role is not held by an Edit deny. Each role's `.runtime/` stays writable.
 */
function launchFilesDeny(user: LaunchUser): DenyResult {
  const roots = sortedUnique([user.root, user.givenRoot, ...(user.mainRoot === undefined ? [] : [user.mainRoot])])
  const rules = roots.flatMap(root => [
    editWriteRules(`${root}/.claude/settings.json`, ''),
    editWriteRules(`${root}/.claude/settings.local.json`, ''),
    editWriteRules(`${root}/.cadre/bin`, '/**'),
    editWriteRules(`${root}/.cadre/manifest.json`, ''),
  ])

  return { deny: rules.flatMap(rule => rule ?? []), warnings: [] }
}

/**
 * The deny of a role's hand-out record (02-GAPS-B3 C3): `Edit(//<role memory folder>/instructions.json)` and
 * `Write(...)`, so the role cannot rewrite which memories its next start links. A path an exact rule cannot hold gets
 * none, with UNDENIED_RECORD_WARNING.
 */
function instructionsRecordDeny(user: LaunchUser, id: string): DenyResult {
  const rules = editWriteRules(`${roleMemoryDir(user, id)}/${INSTRUCTIONS_RECORD_FILE}`, '')

  return rules === null ? { deny: [], warnings: [UNDENIED_RECORD_WARNING] } : { deny: rules, warnings: [] }
}

/**
 * The deny list of a role's runtime settings, sorted and once each, with the warnings in this order: runtimeDeny's;
 * for a linked worktree nested in its main checkout (`mainRoot` set, D-157, 03.1-W3 M1), runtimeDeny's denies for the
 * main checkout's root too, so its code dirs get the same exact denies as the worktree's (RESEARCH Pitfall 2), without
 * its warnings, which would repeat the worktree's; the deny of the role's private instructions folder, for every role,
 * as every launcher adds that folder (privateInstructionsDeny, 02-GAPS-B2 S3); for every role, the deny of the repo's
 * memory folders (memoryFolderDeny, 02-GAPS-B3 C2), of the launch files (launchFilesDeny, 03.1-SEC-S1) and of its
 * hand-out record (instructionsRecordDeny, 02-GAPS-B3 C3); and for a parts-flow role the read-only deny of the memories
 * /cadre start linked into its memory folder (linkedMemoryDeny, G-02-1f), never of its MEMORY.md or of its own
 * memories.
 */
function settingsDeny(role: RoleSpec, scope: CompiledScope, user: LaunchUser): DenyResult {
  const results = [
    runtimeDeny(role, scope, user),
    ...(user.mainRoot === undefined
      ? []
      : [{ deny: runtimeDeny(role, scope, { ...user, root: user.mainRoot }).deny, warnings: [] }]),
    privateInstructionsDeny(user, role.id),
    memoryFolderDeny(user),
    launchFilesDeny(user),
    instructionsRecordDeny(user, role.id),
    isPartsFlowRole(role) ? linkedMemoryDeny(user.linkedMemories) : { deny: [], warnings: [] },
  ]

  return {
    deny: sortedUnique(results.flatMap(result => result.deny)),
    warnings: results.flatMap(result => result.warnings),
  }
}

/**
 * Whether a skill or agent name may become a link name: a plain name (T-02-46). The pattern has no `/` and starts with
 * a letter or digit, so it alone rules out a `..` segment.
 */
function isSafeOverlayName(name: string): boolean {
  return SAFE_OVERLAY_NAME.test(name)
}

/**
 * The links for one kind of overlay entry, in name order, once each. A name that is not a plain name is not linked and
 * is named in a warning, even when the user has it, and so is a name the user does not have. `extension` is added to
 * the name in the link path and in the target (an agent is a `.md` file, a skill is a folder).
 */
function overlayGroup(
  kind: 'skill' | 'agent',
  names: readonly string[],
  have: readonly string[],
  linkDir: string,
  targetDir: string,
  extension: string,
): LinkSet {
  const links: OverlayLink[] = []
  const warnings: string[] = []
  for (const name of sortedUnique(names)) {
    if (!isSafeOverlayName(name)) {
      warnings.push(`${kind} ${shown(name)} has an unsafe name: not linked`)
      continue
    }
    if (!have.includes(name)) {
      warnings.push(`${kind} ${name} was not found in your user ${kind}s: not linked`)
      continue
    }
    links.push({ path: `${linkDir}/${name}${extension}`, target: `${targetDir}/${name}${extension}` })
  }

  return { links, warnings }
}

/**
 * The links that build the role's overlay (spike S4 V3): each overlay skill is linked to `<userDir>/skills/<name>`
 * under `.runtime/overlay/.claude/skills/`, and each overlay agent to `<userDir>/agents/<name>.md` under
 * `.runtime/overlay/.claude/agents/`. Under `--setting-sources project` a user-level skill or agent is absent unless an
 * `--add-dir` overlay links it. A skill named `plugin:skill` never reaches the overlay, as compileScope enables its
 * plugin instead. The links are sorted by path, the warnings list the skills before the agents, and a name that is not
 * found among the user's, or is not a safe name, is not linked.
 */
export function overlayLinks(id: string, overlay: CompiledScope['overlay'], user: LaunchUser): LinkSet {
  const base = `${runtimeDir(user, id)}/overlay/.claude`
  const skillsDir = `${user.userDir}/skills`
  const agentsDir = `${user.userDir}/agents`
  const skills = overlayGroup('skill', overlay.skills, user.userSkills, `${base}/skills`, skillsDir, '')
  const agents = overlayGroup('agent', overlay.agents, user.userAgents, `${base}/agents`, agentsDir, '.md')

  return { links: sortedLinks([...skills.links, ...agents.links]), warnings: [...skills.warnings, ...agents.warnings] }
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
function settingsFor(
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

/**
 * The launch half of D-66 for one role (D-98): from the role, its compiled scope and the launching user's facts it
 * returns the runtime settings, the symlinks to create (the instruction and memory links and the overlay links, sorted
 * by path, all under `<root>/.cadre/<id>/.runtime/`) and the warnings to show, in the order of the steps: denies,
 * instructions, overlay. It is pure: it reads nothing, writes nothing and keeps nothing between calls, so Phase 3 only
 * gathers the facts and writes the result under `.cadre/<id>/.runtime/`.
 */
export function launchPlan(role: RoleSpec, scope: CompiledScope, user: LaunchUser): LaunchPlan {
  const deny = settingsDeny(role, scope, user)
  const instructions = instructionPlan(role, user)
  const overlay = overlayLinks(role.id, scope.overlay, user)

  return {
    settings: settingsFor(role, scope, user, instructions.claudeMdExcludes, deny.deny),
    links: sortedLinks([...instructions.links, ...overlay.links]),
    warnings: [...deny.warnings, ...instructions.warnings, ...overlay.warnings],
  }
}
