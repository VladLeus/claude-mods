import type { CompiledScope, RoleSpec } from '../types'
import { clean, compareText, isChangedByClean, sortedUnique } from './facts'
import { isSafeDir, lintDenyPattern, roleOwnPaths } from './scope'
import { mangledProjectDir } from './setup'

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
  /** The git top level as the session gave it, before the realpath; equal to `root` when no link is in the way. */
  readonly givenRoot: string
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
  /**
   * The user's hooks: the event, the script basename, the whole command, which may hold absolute paths, the matcher of
   * the settings group the hook is in (null when the group has none) and its timeout in seconds (null when unset).
   */
  readonly hooks: readonly {
    readonly event: string
    readonly script: string
    readonly command: string
    readonly matcher: string | null
    readonly timeout: number | null
  }[]
  /** The CLAUDE.md files the engine loads for the root: the root's, `.claude/CLAUDE.md` and every ancestor's. */
  readonly claudeMd: readonly string[]
  /** `<userDir>/CLAUDE.md` first, then the files it imports as the caller resolved them; empty with no global file. */
  readonly globalClaudeMd: readonly string[]
  /** File names in the auto-memory folder of `root`. */
  readonly memoryFiles: readonly string[]
  /** File names in the auto-memory folder of `givenRoot`. */
  readonly givenMemoryFiles: readonly string[]
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

/** Symlinks to create, and what to tell the person about the names that were not linked. */
type LinkSet = {
  readonly links: readonly OverlayLink[]
  readonly warnings: readonly string[]
}

/** A group that plans no link and no warning. */
const NO_LINKS: LinkSet = Object.freeze({ links: Object.freeze([]), warnings: Object.freeze([]) })

/** The most code points of a scanned name that a warning shows. */
const MAX_SHOWN_CHARS = 110

/** The repo name used in the memory slug when the common dir has no parent folder to name it after. */
const FALLBACK_REPO_NAME = 'repo'

/** A character a memory slug may not hold: anything but letters, digits, dot, underscore and dash, per code point. */
const UNSAFE_SLUG_CHARS = /[^A-Za-z0-9._-]/gu

/** A repo root a permission rule can hold: a canonical absolute path of safe characters (`/a/b`), nothing else. */
const SAFE_ROOT = /^(?:\/[A-Za-z0-9._-]+)+$/

/**
 * The template's code-dir denies are exactly `Read(./<dir>/**)` and `Edit(./<dir>/**)`, and the group holds the dir;
 * the secret denies differ.
 */
const CODE_DIR_DENY = /^(?:Read|Edit)\(\.\/([^/]+)\/\*\*\)$/

/** A rule on a tool that takes a path, with an absolute `//` argument. */
const ABSOLUTE_RULE = /^(?:Edit|NotebookEdit|Read|Write)\((\/\/[\s\S]*)\)$/

/** The lint answer for an absolute pattern with a `..` segment. */
const DOTDOT_MESSAGE = 'a .. segment is not allowed in an absolute pattern'

/** The warning when the repo path cannot be written into a rule, so the any-depth denies of the template stay. */
const UNSAFE_ROOT_WARNING =
  'the repo path holds characters a permission rule cannot hold: code-dir denies stay any-depth'

/** The script name prefix of the hook that fights autopilot's handoff, which no role ever gets (D-62). */
const CONTEXT_MONITOR_PREFIX = 'gsd-context-monitor'

/** A token after an `@`: the `@` starts the text or follows white space, and the token runs to the next white space. */
const IMPORT_TOKEN = /(?:^|\s)@(\S+)/g

/** The characters that end a sentence rather than a path, when they trail an import. */
const TRAILING_MARKS = /[.,;:!?)\]}>"']+$/

/** A relative import with nothing in front of it: a name or path of plain characters that ends in `.md`. */
const BARE_MARKDOWN = /^[A-Za-z0-9_.]\S*\.md$/i

/** The most code points a file name may have to be linked. */
const MAX_NAME_CHARS = 255

/** A skill or agent name that may become a link name: a plain name of 1 to 80 characters (T-02-46). */
const SAFE_OVERLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/

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
 * The absolute memory folder of a role (D-20, D-91): `<userDir>/cadre/<slug>/<id>`, the folder the scope card names.
 * It follows CLAUDE_CONFIG_DIR as userDir does, so it is `~/.claude/cadre/...` only when that is not set. It is
 * absolute because the engine ignores a repo-relative `autoMemoryDirectory` (spike S2). The role id is a validated
 * slug, so it is safe in a path.
 */
export function roleMemoryDir(user: LaunchUser, id: string): string {
  return `${user.userDir}/cadre/${memorySlug(user.gitCommonDir, user.commonDirHash)}/${id}`
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
 * named x) are replaced by exact absolute ones, `Read(//<root>/<dir>/**)` and `Edit(//<root>/<dir>/**)`, which hit
 * that one folder and no other, for every code dir the launch scan names and every dir a template code-dir deny names,
 * so a folder the launch scan missed keeps its deny (fail closed). A dir is skipped when `<root>/<dir>/` is a prefix of
 * one of the role's own paths (`.cadre/<id>/`, `.planning/`, `thoughts/shared/handoffs/<id>/`; compared without letter
 * case, as a file system may ignore it), so those stay readable (D-80); a dir with an unusual name (`isSafeDir`) is
 * skipped with a warning. A root a rule cannot hold keeps the template's denies and warns. The result is sorted and
 * once each, and an entry that fails `lintRuntimeDenyPattern` is dropped with a warning, so no deny can block an infra
 * tool.
 */
export function runtimeDeny(role: RoleSpec, scope: CompiledScope, user: LaunchUser): DenyResult {
  const template = scope.settings.permissions.deny
  if (role.hasBash) return lintedDeny(template, [])
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
    .map(dir => `Code dir ${clean(dir, MAX_SHOWN_CHARS)} has an unusual name and is not denied`)

  return lintedDeny([...template.filter(entry => !CODE_DIR_DENY.test(entry)), ...exact], unusual)
}

/** A run of backticks in a text: where it starts, and where it ends (exclusive). */
type BacktickRun = {
  readonly start: number
  readonly end: number
}

/** Every run of backticks in the text, in order. */
function backtickRuns(text: string): BacktickRun[] {
  const runs: BacktickRun[] = []
  let start = text.indexOf('`')
  while (start !== -1) {
    let end = start
    while (text[end] === '`') end += 1
    runs.push({ start, end })
    start = text.indexOf('`', end)
  }

  return runs
}

/** The index of the next run after `opener` that is as long as it is, which closes the span it opens; -1 for none. */
function closingRun(runs: readonly BacktickRun[], opener: number): number {
  const first = runs[opener]
  if (first === undefined) return -1
  const length = first.end - first.start
  for (let next = opener + 1; next < runs.length; next += 1) {
    const run = runs[next]
    if (run !== undefined && run.end - run.start === length) return next
  }

  return -1
}

/**
 * The text with every code span and fenced block replaced by a space, as an import inside code is not an import. A run
 * of backticks opens a span that the next run of the same length closes, so a fence of four backticks holds fences of
 * three; a run that closes nothing is plain text and hides nothing after it.
 */
function withoutCode(text: string): string {
  const runs = backtickRuns(text)
  const kept: string[] = []
  let copied = 0
  let opener = 0
  while (opener < runs.length) {
    const closer = closingRun(runs, opener)
    const first = runs[opener]
    const last = runs[closer]
    if (first === undefined || last === undefined) {
      opener += 1
      continue
    }
    kept.push(text.slice(copied, first.start), ' ')
    copied = last.end
    opener = closer + 1
  }
  kept.push(text.slice(copied))

  return kept.join('')
}

/** The absolute path with its empty and `.` segments dropped and each `..` taking off the segment before it. */
function resolveSegments(path: string): string {
  const kept: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') kept.pop()
    else kept.push(part)
  }

  return `/${kept.join('/')}`
}

/**
 * The file one import token names, as an absolute path, or null when the token is not an import. A token starts with
 * `~/` (the home), `/`, `./` or `../` (the folder of the importing file), or is a bare relative path that ends in
 * `.md`. A sentence mark after the path is not part of it, and a folder is not a file.
 */
function importPath(token: string, fileDir: string, home: string): string | null {
  const path = token.replace(TRAILING_MARKS, '')
  if (path === '' || path.endsWith('/')) return null
  if (path.startsWith('~/')) return resolveSegments(`${home}/${path.slice(2)}`)
  if (path.startsWith('/')) return resolveSegments(path)
  if (path.startsWith('./') || path.startsWith('../') || BARE_MARKDOWN.test(path)) {
    return resolveSegments(`${fileDir}/${path}`)
  }

  return null
}

/**
 * The files a CLAUDE.md imports (D-63 group 1), as sorted absolute paths once each. An import is an `@` that starts a
 * line or follows white space, and a token inside backticks or a fenced block is not one, nor is an `@` inside a word
 * such as an e-mail address. Paths resolve against the folder of the importing file (`fileDir`) and `~` against `home`,
 * with every `.` and `..` segment resolved away. It reads nothing: the caller reads each file and calls it again on
 * what that file imports.
 */
export function claudeMdImports(text: string, fileDir: string, home: string): string[] {
  const found: string[] = []
  for (const match of withoutCode(text).matchAll(IMPORT_TOKEN)) {
    const path = importPath(match[1] ?? '', fileDir, home)
    if (path !== null) found.push(path)
  }

  return sortedUnique(found)
}

/** The folder that holds everything the launch creates for a role: `<root>/.cadre/<id>/.runtime`. */
function runtimeDir(user: LaunchUser, id: string): string {
  return `${user.root}/.cadre/${id}/.runtime`
}

/** The links in the order of their paths, as a new array. */
function sortedLinks(links: readonly OverlayLink[]): OverlayLink[] {
  return [...links].sort((a, b) => compareText(a.path, b.path))
}

/** Whether a name is worth showing and linking: not empty, and with no hidden character and not too long. */
function isCleanName(name: string): boolean {
  return name !== '' && !isChangedByClean(name, MAX_NAME_CHARS)
}

/**
 * Whether a file name may become a link name as it is: it is clean, has no `/`, and does not start with `.`, so it
 * cannot hold a `..` segment or leave its folder. The name of a memory file becomes the name of its link (T-02-46).
 */
function isSafeFileName(name: string): boolean {
  return isCleanName(name) && !name.includes('/') && !name.startsWith('.')
}

/**
 * The links for the global CLAUDE.md and the files it imports, in the order given: each is `<nn>-<name>`, where the
 * number is the 1-based position in the list, so the order is kept and two files with the same name do not clash. A
 * file with an empty or hidden-character name is not linked and is named in a warning; the numbers of the others stay.
 */
function globalLinks(id: string, user: LaunchUser): LinkSet {
  const links: OverlayLink[] = []
  const warnings: string[] = []
  for (const [index, target] of user.globalClaudeMd.entries()) {
    const name = target.slice(target.lastIndexOf('/') + 1)
    if (!isCleanName(name)) {
      warnings.push(`global file ${clean(name, MAX_SHOWN_CHARS)} has an unsafe name: not linked`)
      continue
    }
    const number = String(index + 1).padStart(2, '0')
    links.push({ path: `${runtimeDir(user, id)}/instructions/global/${number}-${name}`, target })
  }

  return { links, warnings }
}

/** The folder where the engine keeps the auto-memory files of a project root: `<userDir>/projects/<mangled>/memory`. */
function projectMemoryDir(user: LaunchUser, root: string): string {
  return `${user.userDir}/projects/${mangledProjectDir(root)}/memory`
}

/**
 * The links for the auto-memory files of this repo. The engine keeps them in the user's
 * `projects/<mangled root>/memory` folder, and the scan lists both such folders, that of the root as a realpath and
 * that of the root as given (a checkout opened through a link). Each name is linked to the file in the folder that
 * listed it; a name both folders list is linked once, to the realpath folder, so no link points at a folder that did
 * not list its name. A file with an unsafe name (isSafeFileName) is not linked and is named in one warning. The links
 * come in name order.
 */
function memoryLinks(id: string, user: LaunchUser): LinkSet {
  const sources: readonly (readonly [string, readonly string[]])[] = [
    [projectMemoryDir(user, user.root), user.memoryFiles],
    [projectMemoryDir(user, user.givenRoot), user.givenMemoryFiles],
  ]
  const targets = new Map<string, string>()
  for (const [folder, names] of sources) {
    for (const name of names) {
      if (!targets.has(name)) targets.set(name, `${folder}/${name}`)
    }
  }
  const links: OverlayLink[] = []
  const warnings: string[] = []
  for (const [name, target] of [...targets].sort(([a], [b]) => compareText(a, b))) {
    if (!isSafeFileName(name)) {
      warnings.push(`memory file ${clean(name, MAX_SHOWN_CHARS)} has an unsafe name: not linked`)
      continue
    }
    links.push({ path: `${runtimeDir(user, id)}/instructions/memory/${name}`, target })
  }

  return { links, warnings }
}

/**
 * What a role gets of the user's instructions and memories, from the D-63 answers (D-98). Under
 * `--setting-sources project` the user-level CLAUDE.md never loads, while the project's and every ancestor's does
 * (P11). So without the 'project-claude-md' group every CLAUDE.md of the loaded chain is excluded, and with it none
 * is. The global CLAUDE.md with its imports is linked into `.runtime/instructions/global/` only for
 * 'global-claude-md', and this repo's memory files into `.runtime/instructions/memory/` only for 'auto-memory': a role
 * is narrow by default, whatever exists on disk. Delivering the linked files into the session is Phase 3 wiring
 * (D-100).
 */
export function instructionPlan(
  role: RoleSpec,
  user: LaunchUser,
): InstructionPlan & { readonly warnings: readonly string[] } {
  const globals = role.instructions.includes('global-claude-md') ? globalLinks(role.id, user) : NO_LINKS
  const memories = role.instructions.includes('auto-memory') ? memoryLinks(role.id, user) : NO_LINKS

  return {
    claudeMdExcludes: role.instructions.includes('project-claude-md') ? [] : sortedUnique(user.claudeMd),
    links: sortedLinks([...globals.links, ...memories.links]),
    warnings: [...globals.warnings, ...memories.warnings],
  }
}

/** Whether a skill or agent name may become a link name: a plain name, and no `..` segment (T-02-46). */
function isSafeOverlayName(name: string): boolean {
  return SAFE_OVERLAY_NAME.test(name) && !name.split('/').includes('..')
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
      warnings.push(`${kind} ${clean(name, MAX_SHOWN_CHARS)} has an unsafe name: not linked`)
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

/** Whether a hook script is the context monitor, which fights autopilot's handoff (D-62), whatever its letter case. */
function isContextMonitor(script: string): boolean {
  return script.toLowerCase().startsWith(CONTEXT_MONITOR_PREFIX)
}

/** One carried hook command as the settings hold it; `timeout` only when the user set one. */
type HookEntry = { readonly type: 'command'; readonly command: string; readonly timeout?: number }

/**
 * The hooks of the role: the user's hooks whose script the role carries, never the context monitor (D-62), with the
 * matcher and the timeout the user's settings give them, so a hook still runs only on the tools its owner set. Each
 * event holds one group per matcher, as `{ [event]: [{ matcher, hooks: [{ type: 'command', command, timeout }] }] }`;
 * a group with a null matcher has no `matcher` key and a hook with a null timeout no `timeout` key. The events, and
 * the groups of an event, come in the order they are first seen, and the commands of a group in the order given. Null
 * when no hook is left.
 */
function carriedHooks(role: RoleSpec, user: LaunchUser): Record<string, unknown> | null {
  const wanted = new Set(role.carry.hooks)
  const events = new Map<string, Map<string | null, HookEntry[]>>()
  for (const hook of user.hooks) {
    if (!wanted.has(hook.script) || isContextMonitor(hook.script)) continue
    const groups = events.get(hook.event) ?? new Map<string | null, HookEntry[]>()
    const list = groups.get(hook.matcher) ?? []
    const entry: HookEntry = { type: 'command', command: hook.command }
    list.push(hook.timeout === null ? entry : { ...entry, timeout: hook.timeout })
    groups.set(hook.matcher, list)
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
 * returns the runtime settings, the symlinks to create (the instruction and memory links and the overlay links, sorted
 * by path, all under `<root>/.cadre/<id>/.runtime/`) and the warnings to show, in the order of the steps: denies,
 * instructions, overlay. It is pure: it reads nothing, writes nothing and keeps nothing between calls, so Phase 3 only
 * gathers the facts and writes the result under `.cadre/<id>/.runtime/`.
 */
export function launchPlan(role: RoleSpec, scope: CompiledScope, user: LaunchUser): LaunchPlan {
  const deny = runtimeDeny(role, scope, user)
  const instructions = instructionPlan(role, user)
  const overlay = overlayLinks(role.id, scope.overlay, user)

  return {
    settings: renderRuntimeSettings(role, scope, user, instructions.claudeMdExcludes),
    links: sortedLinks([...instructions.links, ...overlay.links]),
    warnings: [...deny.warnings, ...instructions.warnings, ...overlay.warnings],
  }
}
