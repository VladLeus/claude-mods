/**
 * The launch denies, a layer 9 module: a role's runtime deny list at launch with the warnings of what it could not
 * deny, and the Edit and Write rules that keep a role off its private instructions, memory folders, hand-out record,
 * linked memories and launch files (D-80, D-84, D-123, D-157, G-02-1f, 02-GAPS-B3 C2, C3, S3). It imports core, paths,
 * the scope lint, the launch links and the types, so the launch settings and plan, and the improver, read it here.
 */
import type { CompiledScope, RoleSpec } from '../../types'
import { shown, sortedUnique } from '../core/text'
import { t } from '../locales/t'
import { INSTRUCTIONS_RECORD_FILE, memoryFolderOf, privateInstructionsDir, roleMemoryDir } from '../paths'
import { isSafeDir, lintDenyPattern, roleOwnPaths, SECRET_READ_DENY } from '../scope/lint'
import { isPartsFlowRole, launchRoots } from './links'
import type { LaunchUser } from './links'

/** The deny list of a role at launch, and what to tell the person about it. */
export type DenyResult = {
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
const DOTDOT_MESSAGE = t('launch.deny.dotdotMessage')

/** The warning when the repo path cannot be written into a rule, so the any-depth denies of the template stay. */
const UNSAFE_ROOT_WARNING = t('launch.deny.unsafeRootWarning')

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
    else refused.push(t('launch.deny.lintedDeny', { entry: shown(entry), message }))
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
    .map(dir => t('launch.deny.runtimeDeny', { dir: shown(dir) }))

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
  return t('launch.deny.undeniedMemoryWarning', { file: shown(file) })
}

/** The warning for a private instructions folder whose path no exact rule can hold (02-GAPS-B2 S3): it gets no deny. */
export const UNDENIED_PRIVATE_WARNING = t('launch.deny.undeniedPrivateWarning')

/**
 * The warning for a memory folder of the repo whose path no exact rule can hold (02-GAPS-B3 C2): it gets no deny, so
 * a role could still edit the memories there, through a link or not.
 */
export const UNDENIED_MEMORY_FOLDER_WARNING = t('launch.deny.undeniedMemoryFolderWarning')

/**
 * The warning for a hand-out record whose path no exact rule can hold (02-GAPS-B3 C3): it gets no deny, so a role
 * could still rewrite which memories its next start links.
 */
export const UNDENIED_RECORD_WARNING = t('launch.deny.undeniedRecordWarning')

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
  const roots = launchRoots(user)
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
  const roots = sortedUnique(launchRoots(user))
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
export function settingsDeny(role: RoleSpec, scope: CompiledScope, user: LaunchUser): DenyResult {
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
