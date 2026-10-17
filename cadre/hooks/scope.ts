import type {
  CompiledScope,
  Enforcement,
  FrameworkId,
  McpRoute,
  RoleSpec,
  ScopeCard,
  ScopeContext,
  ScopeRule,
  SetupScan,
  SkillRef,
} from '../types'
import { FRAMEWORK_START_SKILLS, INFRA_MCP_SERVERS, INFRA_PLUGINS, INFRA_SKILLS, INFRA_TOOLS } from './assign'
import { clean, compareText } from './facts'
import { reportText } from './render'
import { chainLines } from './roles'

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
 * The memory folder pattern a card shows (D-91). Phase 3 renders the real folder at launch: `<repo>` is the repo's
 * folder name and `<hash8>` the first 8 hex characters of the SHA-256 of its git common dir.
 */
export const MEMORY_PATTERN = '~/.claude/cadre/<repo>-<hash8>/'

/** The most code points of a scanned name that a card rule shows. A scanned name is data, not text to trust. */
const MAX_SHOWN_CHARS = 110

/** The most names one card list shows before it counts the rest. */
const MAX_CARD_LIST = 12

/** What an MCP server name must look like for its `mcp__<name>` rule to be written: letters, digits, `_` and `-`. */
const MCP_NAME_PATTERN = /^[A-Za-z0-9_-]+$/

/** What a top-level code folder must look like for a path rule to be written: no glob character, space or paren. */
const SAFE_DIR_PATTERN = /^[A-Za-z0-9._-]+$/

/** A rule on a tool that takes a path, and its argument. The path anchoring rules of the lint apply to these (P13). */
const PATH_RULE = /^(?:Edit|NotebookEdit|Read|Write)\(([\s\S]*)\)$/

/** The characters that end the literal start of a pattern: the engine reads what follows as a glob. */
const GLOB_CHARS = /[*?\[]/

/** The lint answer for a single leading `/`: the pattern is anchored at the settings file and matches nothing. */
const SINGLE_SLASH_MESSAGE = 'single leading / matches nothing (P13)'

/** The lint answer for an absolute `//` pattern, which the committed template must not hold. */
const ABSOLUTE_MESSAGE = 'absolute // patterns belong only in .runtime (D-84)'

/** The lint answer for a pattern that is, or covers, an infra tool. */
const INFRA_MESSAGE = 'would block an infra tool (ISO-04)'

/**
 * What no deny pattern may cover (ISO-04, D-77): the infra tools, the infra MCP servers by name, and the handoff
 * skills as the `Skill(<name>)` rules that would block them.
 */
const INFRA_DENY_TARGETS: readonly string[] = Object.freeze([
  ...INFRA_TOOLS,
  ...INFRA_MCP_SERVERS.map(server => `mcp__${server}`),
  ...INFRA_SKILLS.map(name => `Skill(${name})`),
])

/** The launcher flag that turns off slash commands, and with them the handoff skills and the start skills (S1, S4). */
const DISABLE_SLASH_FLAG = '--disable-slash-commands'

/** The framework names a card shows. */
const FRAMEWORK_NAMES: Readonly<Record<FrameworkId, string>> = Object.freeze({
  gsd: 'GSD',
  superpowers: 'superpowers',
  none: 'built-in',
})

/** The names once each, in code point order, so a list hashes the same on every run. */
function sortedUnique(names: readonly string[]): string[] {
  return Array.from(new Set(names)).sort(compareText)
}

/** A scanned name or pattern as a card rule shows it: unsafe characters removed and the length capped. */
function shown(text: string): string {
  return clean(text, MAX_SHOWN_CHARS)
}

/** One line of the scope card. */
function rule(text: string, enforcement: Enforcement): ScopeRule {
  return { text, enforcement }
}

/**
 * The folders a role must always read and write: its `.cadre` folder, its handoff folder and GSD's `.planning/`.
 * An any-depth deny never uses one of their segment names, because `./x/**` matches every folder named x (D-80, P13).
 * Sorted, and a fresh array on every call.
 */
export function roleOwnPaths(id: string): string[] {
  return [`.cadre/${id}/`, '.planning/', `thoughts/shared/handoffs/${id}/`].sort(compareText)
}

/** The lowercase folder names inside the own paths of a role id. A file system or matcher may ignore case. */
function ownNames(id: string): ReadonlySet<string> {
  const names = roleOwnPaths(id).flatMap(path => path.split('/'))

  return new Set(names.filter(name => name !== '').map(name => name.toLowerCase()))
}

/**
 * Whether a deny pattern is an infra tool, covers one, or is the start of one. A pattern counts up to its first glob
 * character, so `mcp__*` and `mcp__au*` cover `mcp__autopilot__wait_for`. A rule with an argument on an infra tool
 * other than Skill (`PushNotification(*)`) blocks it; `Skill(<name>)` blocks only the skills it can match.
 */
function blocksInfra(pattern: string): boolean {
  const open = pattern.indexOf('(')
  const tool = open < 0 ? pattern : pattern.slice(0, open)
  if (INFRA_TOOLS.includes(tool) && (open < 0 || tool !== 'Skill')) return true

  const literal = pattern.split(GLOB_CHARS)[0] ?? ''

  return INFRA_DENY_TARGETS.some(target => target.startsWith(literal))
}

/**
 * The reason a deny pattern must not be emitted, or null when it is fine (ROLE-05, P13, ISO-04, T-02-24): a pattern
 * that is, or starts like, an infra tool; a path rule with a single leading `/`, which is anchored at the settings
 * file and matches nothing; or a path rule with `//`, which belongs only in the rendered `.runtime` settings (D-84).
 */
export function lintDenyPattern(pattern: string): string | null {
  if (blocksInfra(pattern)) return INFRA_MESSAGE

  const argument = PATH_RULE.exec(pattern)?.[1]
  if (argument === undefined) return null
  if (argument.startsWith('//')) return ABSOLUTE_MESSAGE
  if (argument.startsWith('/')) return SINGLE_SLASH_MESSAGE

  return null
}

/** The part of a plugin key before `@`: `superpowers@claude-plugins-official` is `superpowers`. */
function pluginName(key: string): string {
  const at = key.indexOf('@')

  return at < 0 ? key : key.slice(0, at)
}

/**
 * The plugin a skill name belongs to: `codex:rescue` is `codex`. Null for a name with no plugin part, a user-level
 * skill that goes into the overlay (spike S4 V3).
 */
function skillPlugin(name: string): string | null {
  const colon = name.indexOf(':')

  return colon <= 0 ? null : name.slice(0, colon)
}

/** The enabledPlugins record of these plugin keys, every one on, with the keys inserted in sorted order. */
function enabledRecord(keys: readonly string[]): Readonly<Record<string, boolean>> {
  const entries: [string, boolean][] = sortedUnique(keys).map(key => [key, true])

  return Object.fromEntries(entries)
}

/**
 * The plugins the role session loads under the whitelist: the three infra plugins, and every scanned key of a plugin
 * that adds a skill of the role or a start skill of its framework (a skill named `plugin:skill` is present only when
 * its plugin is enabled). The superpowers framework also enables every scanned `superpowers@` key.
 */
function pluginsFor(role: RoleSpec, ctx: ScopeContext): Readonly<Record<string, boolean>> {
  const skills = [...FRAMEWORK_START_SKILLS[ctx.framework], ...role.skills]
  const wanted = new Set(skills.map(skillPlugin).filter((plugin): plugin is string => plugin !== null))
  if (ctx.framework === 'superpowers') wanted.add('superpowers')
  const scanned = ctx.setup.plugins.filter(key => wanted.has(pluginName(key)))

  return enabledRecord([...INFRA_PLUGINS, ...scanned])
}

/**
 * The scanned MCP servers this role was not given, once each and sorted. The infra servers are never in the list:
 * every role has them (ISO-04).
 */
function notGivenMcp(role: RoleSpec, ctx: ScopeContext): string[] {
  const scanned = sortedUnique(ctx.setup.mcp.map(ref => ref.name))

  return scanned.filter(name => !INFRA_MCP_SERVERS.includes(name) && !role.mcp.includes(name))
}

/**
 * Whether the role has a scanned skill: it was given, it is an infra or start skill, or its plugin is enabled (the
 * commands of the infra plugins count, and so does every skill of a plugin enabled for another of its skills).
 */
function hasSkill(skill: SkillRef, given: ReadonlySet<string>, enabled: ReadonlySet<string>): boolean {
  if (given.has(skill.name)) return true
  const plugin = skill.plugin ?? skillPlugin(skill.name)

  return plugin !== null && enabled.has(pluginName(plugin))
}

/** The scanned skill names this role does not have; see hasSkill. */
function notGivenSkills(role: RoleSpec, ctx: ScopeContext, plugins: readonly string[]): string[] {
  const given = new Set([...INFRA_SKILLS, ...FRAMEWORK_START_SKILLS[ctx.framework], ...role.skills])
  const enabled = new Set(plugins.map(pluginName))

  return sortedUnique(ctx.setup.skills.filter(skill => !hasSkill(skill, given, enabled)).map(skill => skill.name))
}

/** A deny pattern the lint refused, with the reason. */
type Refusal = {
  readonly pattern: string
  readonly message: string
}

/** What the role is denied, and what the card says about it. */
type DenyPlan = {
  /** The deny entries, sorted, once each, and every one passing the lint. */
  readonly entries: readonly string[]
  /** The code dirs whose reads and edits are denied, sorted. */
  readonly dirs: readonly string[]
  /** The code dirs left out because their name matches a folder of the role's own paths. */
  readonly skippedDirs: readonly string[]
  /** The code dirs left out because their name could widen or break a pattern. */
  readonly unusualDirs: readonly string[]
  /** The MCP servers denied, by name, sorted. */
  readonly mcp: readonly string[]
  /** The not-given MCP servers left out because their name is unusual. */
  readonly unusualMcp: readonly string[]
  /** The patterns the lint refused. */
  readonly refused: readonly Refusal[]
}

/** Whether a top-level code folder name is safe to write into a path rule: `*`, spaces and `..` are not. */
function isSafeDir(name: string): boolean {
  return SAFE_DIR_PATTERN.test(name) && name !== '.' && name !== '..'
}

/** Splits patterns into the ones that pass the lint, sorted and once each, and the ones that do not. */
function lintAll(patterns: readonly string[]): { readonly kept: readonly string[]; readonly refused: Refusal[] } {
  const kept: string[] = []
  const refused: Refusal[] = []
  for (const pattern of sortedUnique(patterns)) {
    const message = lintDenyPattern(pattern)
    if (message === null) kept.push(pattern)
    else refused.push({ pattern, message })
  }

  return { kept, refused }
}

/**
 * The deny list of a role (ROLE-05, D-80): Bash for a role without it (hard), reads and edits under each scanned code
 * dir for that role (best effort, and `./x/**` matches at any depth, P13), the secret reads for every role, and every
 * scanned MCP server the role was not given. A code dir whose name matches a folder of the role's own paths is left
 * out, so those folders stay readable; exact denies for it are rendered at launch (D-98). A dir or server with an
 * unusual name is left out too. Every entry must pass the lint, and one that does not is dropped and named (T-02-24).
 */
function denyFor(role: RoleSpec, ctx: ScopeContext): DenyPlan {
  const dirs = role.hasBash ? [] : sortedUnique(ctx.codeDirs)
  const usable = dirs.filter(isSafeDir)
  const own = ownNames(role.id)
  const covered = usable.filter(dir => !own.has(dir.toLowerCase()))
  const notGiven = notGivenMcp(role, ctx)
  const named = notGiven.filter(name => MCP_NAME_PATTERN.test(name))
  const { kept, refused } = lintAll([
    ...(role.hasBash ? [] : ['Bash']),
    ...covered.flatMap(dir => [`Read(./${dir}/**)`, `Edit(./${dir}/**)`]),
    ...SECRET_READ_DENY,
    ...named.map(name => `mcp__${name}`),
  ])

  return {
    entries: kept,
    dirs: covered.filter(dir => kept.includes(`Read(./${dir}/**)`) && kept.includes(`Edit(./${dir}/**)`)),
    skippedDirs: usable.filter(dir => own.has(dir.toLowerCase())),
    unusualDirs: dirs.filter(dir => !isSafeDir(dir)),
    mcp: named.filter(name => kept.includes(`mcp__${name}`)),
    unusualMcp: notGiven.filter(name => !MCP_NAME_PATTERN.test(name)),
    refused,
  }
}

/**
 * The skills and agents linked into the overlay at launch (spike S4 V3): the handoff skills, the start skills of the
 * framework and the skills of the role, and for GSD the `gsd-*` agents of the setup. Under `--setting-sources project`
 * a user-level skill is absent unless the overlay links it. A skill named `plugin:skill` is not linked: its plugin is
 * enabled instead.
 */
function overlayFor(role: RoleSpec, ctx: ScopeContext): CompiledScope['overlay'] {
  const names = [...INFRA_SKILLS, ...FRAMEWORK_START_SKILLS[ctx.framework], ...role.skills]
  const skills = sortedUnique(names.filter(name => skillPlugin(name) === null))
  const agents = ctx.framework === 'gsd' ? sortedUnique(ctx.setup.agents.filter(name => name.startsWith('gsd-'))) : []

  return { skills, agents }
}

/**
 * The launcher flags as argv tokens, a flag and its value each their own token, so a launcher can quote every token
 * (D-50, D-78, S1, S4). The paths are repo-relative: the launcher starts in the git top level. The MCP route is a
 * parameter, and the flag that turns off slash commands is never added, because it would turn off the handoff skills.
 * The role id is a validated slug (validateRoleId), so it is safe in a path and in a token.
 */
function flagsFor(role: RoleSpec, ctx: ScopeContext): string[] {
  const runtime = `.cadre/${role.id}/.runtime`
  const flags = [
    '--setting-sources',
    'project',
    '--settings',
    `${runtime}/settings.json`,
    '--append-system-prompt-file',
    `.cadre/${role.id}/ROLE.md`,
    '--name',
    `cadre-${role.id}`,
    '--model',
    role.model,
    '--effort',
    role.effort,
    '--permission-mode',
    role.permissionMode,
    '--add-dir',
    `${runtime}/overlay`,
    '--mcp-config',
    `${runtime}/mcp.json`,
  ]

  return ctx.mcpRoute === 'strict' ? [...flags, '--strict-mcp-config'] : flags
}

/** Whether role.json sets the mode that skips every permission prompt (D-95). */
function isBypass(role: RoleSpec): boolean {
  return role.permissionMode === 'bypassPermissions'
}

/** The warning that leads the card of a bypass role. No engine setting makes it safe, so it is label none (D-95). */
function bypassRules(role: RoleSpec): ScopeRule[] {
  if (!isBypass(role)) return []

  return [rule('WARNING: bypassPermissions is set in role.json: permission prompts are skipped', 'none')]
}

/** The Bash rule: no Bash tool (hard), or the sandbox (hard on macOS, best effort on Linux) for a role with Bash. */
function bashRule(role: RoleSpec): ScopeRule {
  if (!role.hasBash) return rule('No Bash tool (denied)', 'hard')

  return rule('Bash runs in the sandbox (hard on macOS, best-effort on Linux)', 'best-effort')
}

/** The rule for the code dirs that are denied; none when no dir is. */
function deniedDirRules(deny: DenyPlan): ScopeRule[] {
  if (deny.dirs.length === 0) return []
  const text = `Reads and edits under ${deny.dirs.join(', ')} are denied; the patterns match at any depth`

  return [rule(text, 'best-effort')]
}

/** The rule for the code dirs the committed template leaves to the launch render; none when no dir is skipped. */
function skippedDirRules(deny: DenyPlan): ScopeRule[] {
  if (deny.skippedDirs.length === 0) return []
  const text =
    `Reads and edits under ${deny.skippedDirs.join(', ')} are not denied in the committed template: ` +
    "those names match the role's own folders at any depth (exact denies are rendered at launch)"

  return [rule(text, 'best-effort')]
}

/** One rule for each code dir that is not denied because its name is unusual. */
function unusualDirRules(deny: DenyPlan): ScopeRule[] {
  return deny.unusualDirs.map(dir => rule(`Code dir ${shown(dir)} has an unusual name and is not denied`, 'none'))
}

/**
 * The MCP rules: the scanned servers denied, or that there are none, then the unusual names and the refused patterns.
 * The first rule is hard only on the strict route; on the merged route a server the scan did not see still loads, so it
 * is best effort (A4).
 */
function mcpRules(deny: DenyPlan, route: McpRoute): ScopeRule[] {
  const enforcement: Enforcement = route === 'strict' ? 'hard' : 'best-effort'
  const denied =
    deny.mcp.length === 0
      ? rule('No other scanned MCP servers to deny', enforcement)
      : rule(`Scanned MCP servers not given are denied: ${deny.mcp.join(', ')}`, enforcement)

  return [
    denied,
    ...deny.unusualMcp.map(name => rule(`MCP server ${shown(name)} has an unusual name and is not denied`, 'none')),
    ...deny.refused.map(item => rule(`${shown(item.pattern)} was not emitted: ${item.message}`, 'none')),
  ]
}

/**
 * The note when the setup scan could not see every MCP server (A4): it dropped a name a role.json cannot hold, or it
 * did not read `~/.claude.json`. A server it did not see is not on the deny list, so the role can still use it.
 */
function partialMcpRules(setup: SetupScan): ScopeRule[] {
  if (!setup.isMcpPartial) return []
  const text =
    'MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied'

  return [rule(text, 'none')]
}

/**
 * Whether the role runs GSD without Bash. GSD workflows need Bash, so such a role keeps its start skills and runs them
 * through a person, which makes it attended (A1).
 */
function isGsdWithoutBash(role: RoleSpec, ctx: ScopeContext): boolean {
  return ctx.framework === 'gsd' && !role.hasBash
}

/**
 * The rules of an attended role (ROLE-04), in this order: the one for framework steps that cannot run unattended, when
 * the context says so, then the one for GSD workflows that need Bash, for a role without Bash on GSD (A1).
 */
function attendedRules(role: RoleSpec, ctx: ScopeContext): ScopeRule[] {
  const rules: ScopeRule[] = []
  if (ctx.isAttended) {
    rules.push(rule('Attended: this role needs a person for framework steps that cannot run unattended', 'none'))
  }
  if (isGsdWithoutBash(role, ctx)) {
    rules.push(rule('Attended: GSD workflows need Bash; this role runs them through a person', 'none'))
  }

  return rules
}

/**
 * The rules of the card in their fixed order. The label of each rule is fixed here: a rule an engine setting enforces
 * is hard, a pattern a subprocess can sidestep is best effort, and a note or warning is none (ROLE-06).
 */
function rulesFor(role: RoleSpec, ctx: ScopeContext, plugins: readonly string[], deny: DenyPlan): ScopeRule[] {
  return [
    ...bypassRules(role),
    rule(`Plugins: only ${plugins.map(shown).join(', ')} load (--setting-sources project whitelist)`, 'hard'),
    bashRule(role),
    ...deniedDirRules(deny),
    ...skippedDirRules(deny),
    ...unusualDirRules(deny),
    rule('Reads of .env, .env.*, ~/.ssh and ~/.aws are denied', 'best-effort'),
    ...mcpRules(deny, ctx.mcpRoute),
    ...partialMcpRules(ctx.setup),
    rule('Skills: only the listed skills are linked', 'best-effort'),
    rule('Autopilot, agent-fleet and the handoff skills are always available', 'hard'),
    rule(`Permission mode: ${role.permissionMode}`, 'hard'),
    ...attendedRules(role, ctx),
    rule(`MCP route: ${ctx.mcpRoute} (provisional; Phase 3 decides)`, 'none'),
  ]
}

/**
 * The scope card of a role, from the same inputs as the settings, so the two cannot drift (D-80). The role is attended
 * when the context says so, and also when it runs GSD without Bash (A1).
 */
function cardFor(role: RoleSpec, ctx: ScopeContext, plugins: readonly string[], deny: DenyPlan): ScopeCard {
  const loaded = sortedUnique(role.carry.hooks)
  const notLoaded = sortedUnique(ctx.setup.hooks.map(hook => hook.script)).filter(script => !loaded.includes(script))

  return {
    roleId: role.id,
    title: role.title,
    framework: ctx.framework,
    model: role.model,
    effort: role.effort,
    permissionMode: role.permissionMode,
    isBypass: isBypass(role),
    isAttended: ctx.isAttended || isGsdWithoutBash(role, ctx),
    skills: sortedUnique(role.skills),
    mcp: sortedUnique(role.mcp),
    notGiven: { skills: notGivenSkills(role, ctx, plugins), mcp: notGivenMcp(role, ctx) },
    hooks: { loaded, notLoaded },
    rules: rulesFor(role, ctx, plugins, deny),
    chain: chainLines(ctx.roles),
    memoryPattern: `${MEMORY_PATTERN}${role.id}/`,
    mcpRoute: ctx.mcpRoute,
  }
}

/**
 * Compiles the whole scope of one role from one computation (D-80): the committed settings template, the MCP file,
 * the launcher flags, the skill overlay and the card cannot drift apart, and Phase 3's probe checks against the same
 * value. The settings hold only the portable keys `enabledPlugins`, `permissions` and `sandbox` (D-84); every
 * per-user value is rendered at launch. Every deny entry passes lintDenyPattern, and one that does not is dropped and
 * named on the card. Every list is sorted and without repeats, so the template hashes stably, and nothing is kept
 * between calls.
 */
export function compileScope(role: RoleSpec, ctx: ScopeContext): CompiledScope {
  const enabledPlugins = pluginsFor(role, ctx)
  const deny = denyFor(role, ctx)

  return {
    settings: {
      enabledPlugins,
      permissions: { defaultMode: role.permissionMode, deny: deny.entries },
      sandbox: { enabled: role.hasBash },
    },
    mcp: { schema: 1, servers: sortedUnique(role.mcp) },
    flags: flagsFor(role, ctx),
    overlay: overlayFor(role, ctx),
    card: cardFor(role, ctx, Object.keys(enabledPlugins), deny),
  }
}

/** Whether the plugin key is on in the plugin record: it is an entry of the record itself, with the value true. */
function isEnabled(plugins: Readonly<Record<string, boolean>>, key: string): boolean {
  return Object.hasOwn(plugins, key) && plugins[key] === true
}

/** The problems with the deny entries: one that would block an infra tool, or one that names an infra plugin. */
function denyProblems(deny: readonly string[]): string[] {
  const problems: string[] = []
  for (const entry of sortedUnique(deny)) {
    if (blocksInfra(entry)) problems.push(`deny entry ${shown(entry)} would block an infra tool`)
    const key = INFRA_PLUGINS.find(candidate => entry.includes(candidate))
    if (key !== undefined) problems.push(`deny entry ${shown(entry)} names the infra plugin ${key}`)
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
    return scope.overlay.skills.includes(name) ? null : `start skill ${name} of ${framework} is not in the overlay`
  }
  const plugins = scope.settings.enabledPlugins
  const isPresent = Object.keys(plugins).some(key => pluginName(key) === plugin && isEnabled(plugins, key))

  return isPresent ? null : `start skill ${name} of ${framework} needs the plugin ${plugin}, which is not enabled`
}

/**
 * The checker behind ISO-04 (D-77): every way a compiled scope could block autopilot, agent-fleet or the handoff
 * skills, each as a message that names what broke, and an empty list when none. (a) No deny entry may be, or start
 * like, an infra tool or server, cover a handoff skill as `Skill(<name>)`, or name an infra plugin by its key. (b) The
 * three infra plugins must be on, the handoff skills must be in the overlay, every start skill of the framework must
 * be present (in the overlay, or through an enabled plugin), and no flag may turn off slash commands. Absence matters
 * as much as denial: under `--setting-sources project` a user-level skill is missing unless the overlay links it. The
 * result does not depend on the order of the deny list.
 */
export function infraViolations(scope: CompiledScope, framework: FrameworkId): string[] {
  const plugins = scope.settings.enabledPlugins

  return [
    ...denyProblems(scope.settings.permissions.deny),
    ...INFRA_PLUGINS.filter(key => !isEnabled(plugins, key)).map(key => `infra plugin ${key} is not enabled`),
    ...INFRA_SKILLS.filter(name => !scope.overlay.skills.includes(name)).map(
      name => `handoff skill ${name} is not in the overlay`,
    ),
    ...FRAMEWORK_START_SKILLS[framework]
      .map(name => startSkillProblem(name, scope, framework))
      .filter((problem): problem is string => problem !== null),
    ...scope.flags
      .filter(flag => flag === DISABLE_SLASH_FLAG || flag.startsWith(`${DISABLE_SLASH_FLAG}=`))
      .map(flag => `flag ${shown(flag)} would turn off the handoff skills`),
  ]
}

/** A list as a card line shows it: `none` when empty, else the names, past 12 of them the first 12 and `+N more`. */
function listText(names: readonly string[]): string {
  if (names.length === 0) return 'none'
  const rest = names.length - MAX_CARD_LIST
  if (rest <= 0) return names.join(', ')

  return [...names.slice(0, MAX_CARD_LIST), `+${rest} more`].join(', ')
}

/**
 * The lines of a scope card, as init shows it and ROLE.md holds it (ROLE-06): the title, the framework with the model,
 * effort and permission mode, the skills and MCP servers, what the role was not given, the hooks loaded and not loaded,
 * each rule marked `[hard]`, `[best-effort]` or `[none]`, the decision chain and the memory folder. Every line passes
 * through reportText, so a hostile value cannot add a line or hide text.
 */
export function scopeCardLines(card: ScopeCard): string[] {
  const framework = FRAMEWORK_NAMES[card.framework]
  const lines = [
    `Scope card: ${card.title} (${card.roleId})`,
    `  framework: ${framework}; model: ${card.model} + ${card.effort}; permission mode: ${card.permissionMode}`,
    `  skills: ${listText(card.skills)}`,
    `  MCP servers: ${listText(card.mcp)}`,
    `  not given: skills: ${listText(card.notGiven.skills)}; MCP: ${listText(card.notGiven.mcp)}`,
    `  hooks loaded: ${listText(card.hooks.loaded)}; not loaded: ${listText(card.hooks.notLoaded)}`,
    '  rules:',
    ...card.rules.map(item => `    [${item.enforcement}] ${item.text}`),
    '  decisions:',
    ...card.chain.map(line => `    ${line}`),
    `  memory: ${card.memoryPattern} (rendered at launch)`,
  ]

  return lines.map(reportText)
}
