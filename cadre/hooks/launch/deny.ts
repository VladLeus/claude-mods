/**
 * The launch denies, a layer 9 module: a role's runtime deny list at launch with the warnings of what it could not
 * deny, and the Edit rules that keep a role off its private instructions, memory folders, hand-out record,
 * linked memories, launch and team files and the inbox tree in the user config folder. It imports core, the framework
 * registry, paths, the scope lint, the launch links and the types, so the launch settings and plan, and the improver,
 * read it here.
 */
import type { CompiledScope, RoleSpec } from '../../types'
import { shown, sortedUnique } from '../core/text'
import { ADAPTERS } from '../framework/registry'
import { t } from '../locales/t'
import {
  cadreStatePath,
  inboxTreeOf,
  INSTRUCTIONS_RECORD_FILE,
  isSafeRoot,
  memoryFolderOf,
  privateInstructionsCopyOf,
  privateInstructionsDir,
  roleJsonPath,
  roleMemoryDir,
  shortenedProjectPrefixOf,
} from '../paths'
import { PER_SKILL_DENY_PLUGINS } from '../roles/infra'
import { isSafeDir, lintDenyPattern, pluginName, roleOwnPaths, SECRET_READ_DENY } from '../scope/lint'
import { isPartsFlowRole, launchRoots } from './links'
import type { LaunchUser } from './links'

/** The deny list of a role at launch, and what to tell the person about it. */
export type DenyResult = {
  readonly deny: readonly string[]
  readonly warnings: readonly string[]
}

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
const ABSOLUTE_RULE = /^(?:Edit|NotebookEdit|Read)\((\/\/[\s\S]*)\)$/

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

/** The warning for a dir start folder whose path no exact rule can hold: its launch files get no deny. */
export function undeniedStartFolderWarning(folder: string): string {
  return t('launch.deny.undeniedStartFolderWarning', { folder: shown(folder) })
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

/** The warning when the inbox tree has a path no rule can hold, so a role could still edit the inbox files. */
const UNDENIED_INBOX_WARNING = t('launch.deny.undeniedInboxWarning')

/**
 * The exact Edit rule of an absolute path, with suffix after it (/** for a whole folder); null when no exact rule can
 * hold the path. An Edit deny also refuses the Write tool, so no Write rule is written.
 */
export function editRules(path: string, suffix: string): string[] | null {
  if (!isSafeRoot(path)) return null
  const rule = `Edit(/${path}${suffix})`

  return lintRuntimeDenyPattern(rule) === null ? [rule] : null
}

/** The exact Read rule of an absolute path, as editRules builds the Edit rule; null when no exact rule can hold it. */
function readRules(path: string, suffix: string): string[] | null {
  if (!isSafeRoot(path)) return null
  const rule = `Read(/${path}${suffix})`

  return lintRuntimeDenyPattern(rule) === null ? [rule] : null
}

/**
 * The best-effort read-only deny of a role's linked memories, `Edit(//<path>)` for each link path. A path no exact rule
 * can hold gets undeniedMemoryWarning instead and stays editable; a Bash write is never covered.
 */
export function linkedMemoryDeny(paths: readonly string[]): DenyResult {
  const deny: string[] = []
  const warnings: string[] = []
  for (const path of new Set(paths)) {
    const rules = editRules(path, '')
    if (rules === null) warnings.push(undeniedMemoryWarning(path.slice(path.lastIndexOf('/') + 1)))
    else deny.push(...rules)
  }

  return { deny: sortedUnique(deny), warnings }
}

/**
 * The deny of a role's private instructions folder, `Edit(//<folder>/**)`, so the role cannot rewrite what its next
 * session loads through it; a folder no exact rule can hold gets UNDENIED_PRIVATE_WARNING instead.
 */
function privateInstructionsDeny(user: LaunchUser, id: string): DenyResult {
  const rules = editRules(privateInstructionsDir(user, id), '/**')

  return rules === null ? { deny: [], warnings: [UNDENIED_PRIVATE_WARNING] } : { deny: rules, warnings: [] }
}

/**
 * The deny of the team's private instructions copies under every launch root, Edit of every team role's copy and Read
 * of every other role's, a rule no exact pattern can hold dropped with no warning, since runtimeDeny warns of the root.
 */
function privateCopyDeny(user: LaunchUser, id: string): DenyResult {
  const roots = sortedUnique(launchRoots(user))
  const ids = sortedUnique([id, ...(user.teamIds ?? [])])
  const rules = roots.flatMap(root =>
    ids.flatMap(teamId => {
      const copy = privateInstructionsCopyOf(root, teamId)

      return teamId === id ? [editRules(copy, '/**')] : [editRules(copy, '/**'), readRules(copy, '/**')]
    }),
  )

  return { deny: rules.flatMap(rule => rule ?? []), warnings: [] }
}

/**
 * The deny of the repo's memory folders, `Edit(//<folder>/**)` for the memory folder of every launch root and
 * `Edit(//<prefix>*\/memory/**)` for the engine's shortened folder of a root whose encoded name is too long, so no role
 * edits a memory, through a link or not; a folder no exact rule can hold gets UNDENIED_MEMORY_FOLDER_WARNING, once.
 */
function memoryFolderDeny(user: LaunchUser): DenyResult {
  const roots = launchRoots(user)
  const folders = sortedUnique(roots.map(root => memoryFolderOf(user.userDir, root)))
  const prefixes = sortedUnique(roots.flatMap(root => shortenedProjectPrefixOf(user.userDir, root) ?? []))
  const rules = [
    ...folders.map(folder => editRules(folder, '/**')),
    ...prefixes.map(prefix => editRules(prefix, '*/memory/**')),
  ]
  const deny = rules.flatMap(rule => rule ?? [])

  return { deny, warnings: rules.includes(null) ? [UNDENIED_MEMORY_FOLDER_WARNING] : [] }
}

/**
 * The deny of the files a later launch or session runs or trusts, `Edit(//...)` under every launch root: the two
 * `.claude` settings files and each framework's project install folders, of the root and of a dir start's folder,
 * `.cadre/bin/**`, `.cadre/manifest.json`, `.cadre/cadre.json` and the team's role.json files, so an Edit-only role
 * cannot plant a hook, rewrite a launcher or change the team. A root path no exact rule can hold gets none and no
 * warning, since runtimeDeny already warns about such a root; a start folder no exact rule can hold gets none and one
 * undeniedStartFolderWarning, however many launch roots there are.
 */
function launchFilesDeny(user: LaunchUser, id: string): DenyResult {
  const roots = sortedUnique(launchRoots(user))
  const ids = user.teamIds ?? [id]
  const runs = ADAPTERS.flatMap(adapter => adapter.projectInstall?.runs ?? [])
  const settingsRules = (folder: string): (string[] | null)[] => [
    editRules(`${folder}/.claude/settings.json`, ''),
    editRules(`${folder}/.claude/settings.local.json`, ''),
    ...runs.map(dir => editRules(`${folder}/${dir}`, '/**')),
  ]
  const rootRules = roots.flatMap(root => [
    ...settingsRules(root),
    editRules(`${root}/.cadre/bin`, '/**'),
    editRules(`${root}/.cadre/manifest.json`, ''),
    editRules(`${root}/${cadreStatePath()}`, ''),
    ...ids.map(teamId => editRules(`${root}/${roleJsonPath(teamId)}`, '')),
  ])
  const { startDir } = user
  if (startDir === undefined) return { deny: rootRules.flatMap(rule => rule ?? []), warnings: [] }
  const startFolderRules = roots.flatMap(root => settingsRules(`${root}/${startDir}`))
  const deny = [...rootRules, ...startFolderRules].flatMap(rule => rule ?? [])

  return { deny, warnings: startFolderRules.includes(null) ? [undeniedStartFolderWarning(startDir)] : [] }
}

/**
 * The deny of the inbox tree in the user config folder, `Edit(//<userDir>/cadre/inboxes/**)`, so only cadre's tools
 * write the inbox and session files; a path no exact rule can hold gets UNDENIED_INBOX_WARNING instead.
 */
function inboxFilesDeny(user: LaunchUser): DenyResult {
  const rules = editRules(inboxTreeOf(user.userDir), '/**')

  return rules === null ? { deny: [], warnings: [UNDENIED_INBOX_WARNING] } : { deny: rules, warnings: [] }
}

/**
 * The deny of a role's hand-out record, `Edit(//<role memory folder>/instructions.json)`, so the role cannot rewrite
 * which memories its next start links; a path no exact rule can hold gets UNDENIED_RECORD_WARNING instead.
 */
function instructionsRecordDeny(user: LaunchUser, id: string): DenyResult {
  const rules = editRules(`${roleMemoryDir(user, id)}/${INSTRUCTIONS_RECORD_FILE}`, '')

  return rules === null ? { deny: [], warnings: [UNDENIED_RECORD_WARNING] } : { deny: rules, warnings: [] }
}

/** The skill names the launch read for a plugin key; undefined when it read none. */
function listedSkillsOf(user: LaunchUser, key: string): readonly string[] | undefined {
  const listed = user.pluginSkills

  return listed !== undefined && Object.hasOwn(listed, key) ? listed[key] : undefined
}

/**
 * The per-skill deny of the plugins a role's scope enables whose skill list the launch read: `Skill(<plugin
 * name>:<skill>)` for every listed skill the role was not given, so a skill a plugin update adds is denied at the next
 * launch. Every enabled key of the mattpocock-skills plugin whose list was not read, a lookalike of another
 * marketplace included, goes to offPlugins with a warning naming it, so the role gets none of its skills.
 */
export function pluginSkillDeny(
  role: RoleSpec,
  scope: CompiledScope,
  user: LaunchUser,
): DenyResult & { offPlugins: string[] } {
  const given = new Set(role.skills)
  const enabled = scope.settings.enabledPlugins
  const rules = Object.entries(enabled).flatMap(([key, isOn]) => {
    const listed = listedSkillsOf(user, key)
    if (!isOn || listed === undefined) return []
    const names = listed.map(skill => `${pluginName(key)}:${skill}`)

    return names.filter(name => !given.has(name)).map(name => `Skill(${name})`)
  })
  const offPlugins = Object.entries(enabled)
    .filter(([key, isOn]) => isOn && PER_SKILL_DENY_PLUGINS.map(pluginName).includes(pluginName(key)))
    .filter(([key]) => listedSkillsOf(user, key) === undefined)
    .map(([key]) => key)
  const warnings = offPlugins.map(key => t('launch.deny.pluginOffWarning', { plugin: shown(key) }))

  return { ...lintedDeny(rules, warnings), offPlugins }
}

/**
 * The deny list of a role's runtime settings, sorted and once each, with the warnings in this order: runtimeDeny's;
 * for a linked worktree nested in its main checkout (`mainRoot` set), runtimeDeny's denies for the main checkout's root
 * too, so its code dirs get the same exact denies as the worktree's, without its warnings, which would repeat the
 * worktree's; for every role, the deny of its private instructions folder, of the team's private instructions copies
 * in `.runtime` (privateCopyDeny; every launcher adds its own copy), of the repo's memory folders, of the launch files,
 * of the inbox tree in the user config folder and of its hand-out record; and for a parts-flow role the read-only deny
 * of the memories /cadre start linked into its memory folder, never of its MEMORY.md or of its own memories; last, the
 * per-skill deny of its plugins (pluginSkillDeny).
 */
export function settingsDeny(role: RoleSpec, scope: CompiledScope, user: LaunchUser): DenyResult {
  const results = [
    runtimeDeny(role, scope, user),
    ...(user.mainRoot === undefined
      ? []
      : [{ deny: runtimeDeny(role, scope, { ...user, root: user.mainRoot }).deny, warnings: [] }]),
    privateInstructionsDeny(user, role.id),
    privateCopyDeny(user, role.id),
    memoryFolderDeny(user),
    launchFilesDeny(user, role.id),
    inboxFilesDeny(user),
    instructionsRecordDeny(user, role.id),
    isPartsFlowRole(role) ? linkedMemoryDeny(user.linkedMemories) : { deny: [], warnings: [] },
    pluginSkillDeny(role, scope, user),
  ]

  return {
    deny: sortedUnique(results.flatMap(result => result.deny)),
    warnings: results.flatMap(result => result.warnings),
  }
}
