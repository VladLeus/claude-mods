import type { CompiledScope, RoleSpec } from '../types'
import { compareText, isChangedByClean, shown, sortedUnique } from './core/text'
import {
  INSTRUCTIONS_RECORD_FILE,
  memoryFolderOf,
  privateInstructionsDir,
  resolveSegments,
  roleMemoryDir,
} from './paths'
import {
  isContextMonitorScript,
  isSafeDir,
  lintDenyPattern,
  mcpToolName,
  roleOwnPaths,
  SECRET_READ_DENY,
} from './scope'

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
  /** The rule files the engine loads for the root: `<root>/.claude/rules/<name>.md`, files and links (G-02-1f). */
  readonly rules: readonly string[]
  /**
   * The built role files of the repo: `<root>/.cadre/<id>/CLAUDE.md` of every folder there that has one, the folders
   * of roles no longer on the team included (G-02-1f).
   */
  readonly roleClaudeMds: readonly string[]
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
  /**
   * The absolute link paths in the role memory folder of the memories /cadre start links for the role (G-02-1f, D-140
   * q3-a), from its hand-out record; empty for a whole-files role and for a role given no memory. The role's settings
   * deny Edit and Write on each of them (linkedMemoryDeny).
   */
  readonly linkedMemories: readonly string[]
  /**
   * The main checkout of a linked worktree nested in it (gatherLaunchUser, mainCheckoutOf; D-157), whose worktree is
   * `root`: its exact code-dir denies and its memory folder's deny are added too, and its memories link (RESEARCH
   * Pitfall 2, 03.1-W3 M1). Absent for the main checkout.
   */
  readonly mainRoot?: string
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

/** A token after an `@`: the `@` starts the text or follows white space, and the token runs to the next white space. */
const IMPORT_TOKEN = /(?:^|\s)@(\S+)/g

/**
 * The characters that end a sentence rather than a path, when they trail an import. The pattern is anchored at the
 * start of the mark run, so a long run of marks is linear (02-GAPS-B2 M1).
 */
const TRAILING_MARKS = /(?<![.,;:!?)\]}>"'])[.,;:!?)\]}>"']+$/

/** The most code points an import token may have; no import path is longer (02-GAPS-B2 M1). */
const MAX_IMPORT_TOKEN_CHARS = 4_096

/** A relative import with nothing in front of it: a name or path of plain characters that ends in `.md`. */
const BARE_MARKDOWN = /^[A-Za-z0-9_.]\S*\.md$/i

/** The most code points a file name may have to be linked. */
const MAX_NAME_CHARS = 255

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

/**
 * The file one import token names, as an absolute path, or null when the token is not an import. A token starts with
 * `~/` (the home), `/`, `./` or `../` (the folder of the importing file), or is a bare relative path that ends in
 * `.md`. A sentence mark after the path is not part of it, and a folder is not a file. A token of more than
 * MAX_IMPORT_TOKEN_CHARS code points is no import (02-GAPS-B2 M1).
 */
function importPath(token: string, fileDir: string, home: string): string | null {
  if (Array.from(token).length > MAX_IMPORT_TOKEN_CHARS) return null
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
 * cannot hold a `..` segment or leave its folder. The name of a memory file becomes the name of its link (T-02-46), in
 * `.runtime/instructions/memory/` for a whole-files role and in the role memory folder for a parts-flow role.
 */
export function isSafeFileName(name: string): boolean {
  return isCleanName(name) && !name.includes('/') && !name.startsWith('.')
}

/** The warning for a memory file whose name may not become a link name: it is not linked (T-02-46). */
export function unsafeMemoryNameWarning(name: string): string {
  return `memory file ${shown(name)} has an unsafe name: not linked`
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
      warnings.push(`global file ${shown(name)} has an unsafe name: not linked`)
      continue
    }
    const number = String(index + 1).padStart(2, '0')
    links.push({ path: `${runtimeDir(user, id)}/instructions/global/${number}-${name}`, target })
  }

  return { links, warnings }
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
    [memoryFolderOf(user.userDir, user.root), user.memoryFiles],
    [memoryFolderOf(user.userDir, user.givenRoot), user.givenMemoryFiles],
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
      warnings.push(unsafeMemoryNameWarning(name))
      continue
    }
    links.push({ path: `${runtimeDir(user, id)}/instructions/memory/${name}`, target })
  }

  return { links, warnings }
}

/**
 * Whether a role is a parts-flow role (G-02-1f): it has no instruction group, as the parts hand-out gives every role,
 * so it loads only its built files, and /cadre start links the memories its hand-out record names into its memory
 * folder. A role with a group is a whole-files role (D-63).
 */
export function isPartsFlowRole(role: Pick<RoleSpec, 'instructions'>): boolean {
  return role.instructions.length === 0
}

/**
 * The CLAUDE.md files a role must not load, sorted and once each (P11, G-02-1f). A parts-flow role (isPartsFlowRole)
 * loads only its built files, so every CLAUDE.md of the loaded chain, every rule file and every other role's built
 * `.cadre/<other>/CLAUDE.md` is excluded, never its own `<root>/.cadre/<id>/CLAUDE.md` (T-02-70). A role with groups
 * keeps the whole-files rule: without 'project-claude-md' every CLAUDE.md of the loaded chain is excluded, and with it
 * none is.
 */
function claudeMdExcludesOf(role: RoleSpec, user: LaunchUser): string[] {
  if (role.instructions.includes('project-claude-md')) return []
  if (!isPartsFlowRole(role)) return sortedUnique(user.claudeMd)
  const own = `${user.root}/.cadre/${role.id}/CLAUDE.md`
  const others = user.roleClaudeMds.filter(path => path !== own)

  return sortedUnique([...user.claudeMd, ...user.rules, ...others])
}

/**
 * What a role gets of the user's instructions and memories, from the D-63 answers (D-98) or the parts flow (G-02-1f).
 * Under `--setting-sources project` the user-level CLAUDE.md never loads, while the project's and every ancestor's
 * does, and so do the rule files (P11): the excludes of claudeMdExcludesOf keep a role to what it was given. The
 * global CLAUDE.md with its imports is linked into `.runtime/instructions/global/` only for 'global-claude-md', and
 * this repo's memory files into `.runtime/instructions/memory/` only for 'auto-memory': a role is narrow by default,
 * whatever exists on disk. Delivering the linked files into the session is Phase 3 wiring (D-100).
 */
export function instructionPlan(
  role: RoleSpec,
  user: LaunchUser,
): InstructionPlan & { readonly warnings: readonly string[] } {
  const globals = role.instructions.includes('global-claude-md') ? globalLinks(role.id, user) : NO_LINKS
  const memories = role.instructions.includes('auto-memory') ? memoryLinks(role.id, user) : NO_LINKS

  return {
    claudeMdExcludes: claudeMdExcludesOf(role, user),
    links: sortedLinks([...globals.links, ...memories.links]),
    warnings: [...globals.warnings, ...memories.warnings],
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
