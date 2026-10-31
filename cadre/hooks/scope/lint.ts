/**
 * The scope lint, a layer 5 module: the reads every role is denied, the deny patterns cadre must never emit, the
 * folders a role always keeps, the plugin a key or a skill name belongs to, the rule rows of a card, and the ISO-04
 * checker that a compiled scope blocks no infra tool (ROLE-05, ISO-04, P13, D-77, D-84, D-91, D-112). It imports core,
 * paths, the framework registry, the infra catalog and the types, so the scope card, the scope compiler, launch and
 * init read it here.
 */
import type { CompiledScope, Enforcement, FrameworkId, ProbeCheck, ScopeRule } from '../../types'
import { freezeRows } from '../core/freeze'
import { compareText, shown, sortedUnique } from '../core/text'
import { adapterOf } from '../framework/registry'
import { ARTIFACT } from '../locales/artifact'
import { t } from '../locales/t'
import { handoffFolderOf } from '../paths'
import { INFRA_MCP_SERVERS, INFRA_PLUGINS, INFRA_SKILLS, INFRA_TOOLS } from '../roles/infra'

/**
 * The reads every role is denied, best effort (ROLE-05, D-97c): the repo's .env files and the user's ssh and aws
 * folders. A subprocess that reads the file itself is not stopped by a Read rule, so the card never calls these hard.
 */
export const SECRET_READ_DENY: readonly string[] = Object.freeze([
  'Read(./.env)',
  'Read(./.env.*)',
  'Read(~/.aws/**)',
  'Read(~/.ssh/**)',
])

/**
 * The memory folder pattern a card shows (D-91). Phase 3 renders the real folder at launch: `<config dir>` is
 * CLAUDE_CONFIG_DIR when it is set, else ~/.claude, `<repo>` is the repo's folder name and `<hash8>` the first 8 hex
 * characters of the SHA-256 of its git common dir.
 */
export const MEMORY_PATTERN = '<config dir>/cadre/<repo>-<hash8>/'

/** The script name prefix of the hook that fights autopilot's handoff, which no role ever gets (D-62). */
const CONTEXT_MONITOR_PREFIX = 'gsd-context-monitor'

/**
 * Whether a hook script is the GSD context monitor, which fights autopilot's handoff (D-62): its name starts with
 * `gsd-context-monitor`, whatever its letter case.
 */
export function isContextMonitorScript(script: string): boolean {
  return script.toLowerCase().startsWith(CONTEXT_MONITOR_PREFIX)
}

/** What a top-level code folder must look like for a path rule to be written: no glob character, space or paren. */
const SAFE_DIR_PATTERN = /^[A-Za-z0-9._-]+$/

/** A rule on a tool that takes a path, and its argument. The path anchoring rules of the lint apply to these (P13). */
const PATH_RULE = /^(?:Edit|NotebookEdit|Read|Write)\(([\s\S]*)\)$/

/** The characters that end the literal start of a pattern: the engine reads what follows as a glob. */
const GLOB_CHARS = /[*?\[]/

/** The lint answer for a single leading `/`: the pattern is anchored at the settings file and matches nothing. */
const SINGLE_SLASH_MESSAGE = ARTIFACT.lintSingleSlash

/** The lint answer for an absolute `//` pattern, which the committed template must not hold. */
const ABSOLUTE_MESSAGE = ARTIFACT.lintAbsolute

/** The lint answer for a pattern that is, or covers, an infra tool. */
const INFRA_MESSAGE = ARTIFACT.lintInfra

/**
 * What no deny pattern may cover (ISO-04, D-77): the infra tools, the infra MCP servers by name, and the handoff
 * skills as the `Skill(<name>)` rules that would block them.
 */
const INFRA_DENY_TARGETS: readonly string[] = Object.freeze([
  ...INFRA_TOOLS,
  ...INFRA_MCP_SERVERS.map(server => `mcp__${server}`),
  ...INFRA_SKILLS.map(name => `Skill(${name})`),
])

/**
 * The checks of the infra rule (D-112, D-77): the startup inventory lists the autopilot command, the handoff skills and
 * autopilot's MCP tools, in that order. The fleet command is not checked: its reading is not stable (D-112).
 */
export const INFRA_CHECKS: readonly ProbeCheck[] = freezeRows([
  { kind: 'command-present', token: 'autopilot' },
  ...INFRA_SKILLS.map((name): ProbeCheck => ({ kind: 'skill-present', token: name })),
  ...INFRA_TOOLS.filter(name => name.startsWith('mcp__autopilot__')).map(
    (name): ProbeCheck => ({ kind: 'tool-present', token: name }),
  ),
])

/** The launcher flag that turns off slash commands, and with them the handoff skills and the start skills (S1, S4). */
const DISABLE_SLASH_FLAG = '--disable-slash-commands'

/** One line of the scope card. */
export function rule(text: string, enforcement: Enforcement): ScopeRule {
  return { text, enforcement }
}

/** One line of the scope card with what the startup inventory must show for it to hold (D-112, D-80). */
export function checkedRule(text: string, enforcement: Enforcement, checks: readonly ProbeCheck[]): ScopeRule {
  return { text, enforcement, checks }
}

/**
 * The folders a role must always read and write: its `.cadre` folder, its handoff folder and GSD's `.planning/`.
 * An any-depth deny never uses one of their segment names, because `./x/**` matches every folder named x (D-80, P13).
 * Sorted, and a fresh array on every call.
 */
export function roleOwnPaths(id: string): string[] {
  return [`.cadre/${id}/`, '.planning/', `${handoffFolderOf(id)}/`].sort(compareText)
}

/** The lowercase folder names inside the own paths of a role id. A file system or matcher may ignore case. */
export function ownNames(id: string): ReadonlySet<string> {
  const names = roleOwnPaths(id).flatMap(path => path.split('/'))

  return new Set(names.filter(name => name !== '').map(name => name.toLowerCase()))
}

/** The lowercase first folder of each own path of a role id: `.cadre`, `.planning` and `thoughts` (B7). */
export function ownRoots(id: string): ReadonlySet<string> {
  return new Set(roleOwnPaths(id).map(path => (path.split('/')[0] ?? '').toLowerCase()))
}

/**
 * Whether a deny pattern blocks an infra tool. A rule with an argument on an infra tool other than Skill
 * (`PushNotification(*)`) blocks it; `Skill(<name>)` blocks only the skills it can match. A pattern with a glob
 * character counts up to its first one, so `mcp__*` and `mcp__au*` cover `mcp__autopilot__wait_for`. A literal pattern
 * blocks only an infra name it equals, or the tools of a server it names (`mcp__autopilot` covers
 * `mcp__autopilot__wait_for`), so `mcp__a` and `mcp__autopilot__wait` block nothing of the infra (B9).
 */
function blocksInfra(pattern: string): boolean {
  const open = pattern.indexOf('(')
  const tool = open < 0 ? pattern : pattern.slice(0, open)
  if (INFRA_TOOLS.includes(tool) && (open < 0 || tool !== 'Skill')) return true
  if (GLOB_CHARS.test(pattern)) {
    const literal = pattern.split(GLOB_CHARS)[0] ?? ''

    return INFRA_DENY_TARGETS.some(target => target.startsWith(literal))
  }

  return INFRA_DENY_TARGETS.some(target => target === pattern || target.startsWith(`${pattern}__`))
}

/**
 * The reason a deny pattern must not be emitted, or null when it is fine (ROLE-05, P13, ISO-04, T-02-24): a pattern
 * that blocks an infra tool (an infra name, a server rule over its tools, or a glob over one, B9); a path rule with a
 * single leading `/`, which is anchored at the settings file and matches nothing; or a path rule with `//`, which
 * belongs only in the rendered `.runtime` settings (D-84).
 */
export function lintDenyPattern(pattern: string): string | null {
  if (blocksInfra(pattern)) return INFRA_MESSAGE

  const argument = PATH_RULE.exec(pattern)?.[1]
  if (argument === undefined) return null
  if (argument.startsWith('//')) return ABSOLUTE_MESSAGE
  if (argument.startsWith('/')) return SINGLE_SLASH_MESSAGE

  return null
}

/**
 * The part of a plugin key before `@`: `superpowers@claude-plugins-official` is `superpowers`; a key with no `@` is its
 * own name. The one rule every plugin name cadre shows or matches is cut by (#72 B3).
 */
export function pluginName(key: string): string {
  const at = key.indexOf('@')

  return at < 0 ? key : key.slice(0, at)
}

/**
 * The plugin a skill name belongs to: `codex:rescue` is `codex`. Null for a name with no plugin part, a user-level
 * skill that goes into the overlay (spike S4 V3).
 */
export function skillPlugin(name: string): string | null {
  const colon = name.indexOf(':')

  return colon <= 0 ? null : name.slice(0, colon)
}

/** A deny pattern the lint refused, with the reason. */
export type Refusal = {
  readonly pattern: string
  readonly message: string
}

/**
 * Whether a top-level code folder name is safe to write into a path rule: `*`, spaces and `..` are not. Plan 02-16
 * checks every `user.codeDirs` entry with it before it builds a `Read(//<root>/<d>/**)` rule (B2).
 */
export function isSafeDir(name: string): boolean {
  return SAFE_DIR_PATTERN.test(name) && name !== '.' && name !== '..'
}

/** Splits patterns into the ones that pass the lint, sorted and once each, and the ones that do not. */
export function lintAll(
  patterns: readonly string[],
): { readonly kept: readonly string[]; readonly refused: Refusal[] } {
  const kept: string[] = []
  const refused: Refusal[] = []
  for (const pattern of sortedUnique(patterns)) {
    const message = lintDenyPattern(pattern)
    if (message === null) kept.push(pattern)
    else refused.push({ pattern, message })
  }

  return { kept, refused }
}

/** Whether the plugin key is on in the plugin record: it is an entry of the record itself, with the value true. */
function isEnabled(plugins: Readonly<Record<string, boolean>>, key: string): boolean {
  return Object.hasOwn(plugins, key) && plugins[key] === true
}

/** The problems with the deny entries: one that would block an infra tool, or one that names an infra plugin. */
function denyProblems(deny: readonly string[]): string[] {
  const problems: string[] = []
  for (const entry of sortedUnique(deny)) {
    if (blocksInfra(entry)) problems.push(t('scope.lint.denyProblems', { entry: shown(entry) }))
    const key = INFRA_PLUGINS.find(candidate => entry.includes(candidate))
    if (key !== undefined) problems.push(t('scope.lint.denyProblems2', { entry: shown(entry), key }))
  }

  return problems
}

/**
 * The problem with one start skill of the framework, or null when it is present: a skill without a plugin part must
 * be in the overlay, a skill named `plugin:skill` needs an enabled plugin key of that plugin.
 */
function startSkillProblem(name: string, scope: CompiledScope, framework: FrameworkId): string | null {
  const plugin = skillPlugin(name)
  if (plugin === null) {
    return scope.overlay.skills.includes(name) ? null : t('scope.lint.startSkillProblem', { name, framework })
  }
  const plugins = scope.settings.enabledPlugins
  const isPresent = Object.keys(plugins).some(key => pluginName(key) === plugin && isEnabled(plugins, key))

  return isPresent ? null : t('scope.lint.startSkillProblem2', { name, framework, plugin })
}

/**
 * The checker behind ISO-04 (D-77): every way a compiled scope could block autopilot, agent-fleet or the handoff
 * skills, each as a message that names what broke, and an empty list when none. (a) No deny entry may block an infra
 * tool or server (blocksInfra), cover a handoff skill as `Skill(<name>)`, or name an infra plugin by its key. (b) The
 * three infra plugins must be on, the handoff skills must be in the overlay, every start skill of the framework must
 * be present (in the overlay, or through an enabled plugin), and no flag may turn off slash commands. Absence matters
 * as much as denial: under `--setting-sources project` a user-level skill is missing unless the overlay links it. The
 * result does not depend on the order of the deny list.
 */
export function infraViolations(scope: CompiledScope, framework: FrameworkId): string[] {
  const plugins = scope.settings.enabledPlugins

  return [
    ...denyProblems(scope.settings.permissions.deny),
    ...INFRA_PLUGINS.filter(key => !isEnabled(plugins, key)).map(key => t('scope.lint.infraViolations', { key })),
    ...INFRA_SKILLS.filter(name => !scope.overlay.skills.includes(name)).map(
      name => t('scope.lint.infraViolations2', { name }),
    ),
    ...adapterOf(framework).startSkills
      .map(name => startSkillProblem(name, scope, framework))
      .filter((problem): problem is string => problem !== null),
    ...scope.flags
      .filter(flag => flag === DISABLE_SLASH_FLAG || flag.startsWith(`${DISABLE_SLASH_FLAG}=`))
      .map(flag => t('scope.lint.infraViolations3', { flag: shown(flag) })),
  ]
}
