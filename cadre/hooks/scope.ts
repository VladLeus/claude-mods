import type {
  CompiledScope,
  Enforcement,
  FrameworkId,
  LaunchStart,
  McpRoute,
  ProbeCheck,
  RoleSpec,
  ScopeCard,
  ScopeContext,
  ScopeRule,
  SetupScan,
  SkillRef,
} from '../types'
import { adapterOf } from './adapters'
import {
  FRAMEWORK_START_SKILLS,
  INFRA_MCP_SERVERS,
  INFRA_PLUGINS,
  INFRA_SKILLS,
  INFRA_TOOLS,
  SECURITY_GUIDANCE_PLUGIN,
  SECURITY_PLUGINS,
} from './assign'
import { compareText, sortedUnique } from './facts'
import { freezeRows } from './freeze'
import { PRIVATE_INSTRUCTIONS_LINK } from './plan'
import { cardList, reportText, shown } from './render'
import { chainLines, standsFor } from './roles'

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

/**
 * The checks of the infra rule (D-112, D-77): the startup inventory lists the autopilot command, the handoff skills and
 * autopilot's MCP tools, in that order. The fleet command is not checked: its reading is not stable (D-112).
 */
const INFRA_CHECKS: readonly ProbeCheck[] = freezeRows([
  { kind: 'command-present', token: 'autopilot' },
  ...INFRA_SKILLS.map((name): ProbeCheck => ({ kind: 'skill-present', token: name })),
  ...INFRA_TOOLS.filter(name => name.startsWith('mcp__autopilot__')).map(
    (name): ProbeCheck => ({ kind: 'tool-present', token: name }),
  ),
])

/** The launcher flag that turns off slash commands, and with them the handoff skills and the start skills (S1, S4). */
const DISABLE_SLASH_FLAG = '--disable-slash-commands'

/** One line of the scope card. */
function rule(text: string, enforcement: Enforcement): ScopeRule {
  return { text, enforcement }
}

/** One line of the scope card with what the startup inventory must show for it to hold (D-112, D-80). */
function checkedRule(text: string, enforcement: Enforcement, checks: readonly ProbeCheck[]): ScopeRule {
  return { text, enforcement, checks }
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

/** The lowercase first folder of each own path of a role id: `.cadre`, `.planning` and `thoughts` (B7). */
function ownRoots(id: string): ReadonlySet<string> {
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
 * its plugin is enabled). The superpowers framework also enables every scanned `superpowers@` key. A scanned key of a
 * plugin named in SECURITY_PLUGINS (claude-security, security-guidance) is enabled only when it is that key exactly,
 * never by its plugin name, since the scanned keys include the repo's own settings (T-03-46, T-03-47); every other
 * plugin is matched by its name. A role that stands for Security also gets SECURITY_GUIDANCE_PLUGIN itself when the
 * setup holds that exact key, so its hooks warn that role about risky edits (decision #39); another role enables it
 * only for a `security-guidance:` skill the person gave it (decision #69 B4).
 */
function pluginsFor(role: RoleSpec, ctx: ScopeContext): Readonly<Record<string, boolean>> {
  const skills = [...FRAMEWORK_START_SKILLS[ctx.framework], ...role.skills]
  const wanted = new Set(skills.map(skillPlugin).filter((plugin): plugin is string => plugin !== null))
  if (ctx.framework === 'superpowers') wanted.add('superpowers')
  const scanned = ctx.setup.plugins.filter(key => {
    const name = pluginName(key)
    const exact = SECURITY_PLUGINS.find(official => pluginName(official) === name)

    return wanted.has(name) && (exact === undefined || key === exact)
  })
  const isGuidanceOn = standsFor(role, 'security') && ctx.setup.plugins.includes(SECURITY_GUIDANCE_PLUGIN)

  return enabledRecord([...INFRA_PLUGINS, ...scanned, ...(isGuidanceOn ? [SECURITY_GUIDANCE_PLUGIN] : [])])
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
function hasScannedSkill(skill: SkillRef, given: ReadonlySet<string>, enabled: ReadonlySet<string>): boolean {
  if (given.has(skill.name)) return true
  const plugin = skill.plugin ?? skillPlugin(skill.name)

  return plugin !== null && enabled.has(pluginName(plugin))
}

/** The scanned skill names this role does not have; see hasScannedSkill. */
function notGivenSkills(role: RoleSpec, ctx: ScopeContext, plugins: readonly string[]): string[] {
  const given = new Set([...INFRA_SKILLS, ...FRAMEWORK_START_SKILLS[ctx.framework], ...role.skills])
  const enabled = new Set(plugins.map(pluginName))
  const missing = ctx.setup.skills.filter(skill => !hasScannedSkill(skill, given, enabled))

  return sortedUnique(missing.map(skill => skill.name))
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
  /** The code dirs left out because they are the role's own top folders (`.cadre`, `.planning`, `thoughts`), sorted. */
  readonly ownDirs: readonly string[]
  /** The other code dirs left out because their name matches a folder inside the role's own paths, sorted. */
  readonly skippedDirs: readonly string[]
  /** The code dirs left out because their name could widen or break a pattern. */
  readonly unusualDirs: readonly string[]
  /** The MCP servers denied, by name as scanned, sorted: those whose tool-name pattern passed the lint. */
  readonly mcp: readonly string[]
  /** The not-given MCP servers left out because their tool name is that of a server the role has (A5). */
  readonly unusualMcp: readonly string[]
  /** The patterns the lint refused. */
  readonly refused: readonly Refusal[]
}

/**
 * Whether a top-level code folder name is safe to write into a path rule: `*`, spaces and `..` are not. Plan 02-16
 * checks every `user.codeDirs` entry with it before it builds a `Read(//<root>/<d>/**)` rule (B2).
 */
export function isSafeDir(name: string): boolean {
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
 * The tool name the engine gives an MCP server, which is what a deny rule must name: `mcp__` and the server name with
 * every character outside letters, digits, `_` and `-` replaced by `_`, so `my.server` is `mcp__my_server` (A5).
 */
export function mcpToolName(name: string): string {
  return `mcp__${name.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

/**
 * The deny list of a role (ROLE-05, D-80): Bash for a role without it (hard), reads and edits under each scanned code
 * dir for that role (best effort, and `./x/**` matches at any depth, P13), the secret reads for every role, and every
 * scanned MCP server the role was not given, by its engine tool name (A5). A code dir whose name matches a folder of
 * the role's own paths is left out, so those folders stay readable: a top folder of its own paths is never denied, and
 * exact denies for any other such name are rendered at launch (D-98, B7). A dir with an unusual name is left out too,
 * and so is a server whose tool name is that of a server the role has or of an infra server, since denying it would
 * block that server. Every entry must pass the lint, and one that does not is dropped and named (T-02-24).
 */
function denyFor(role: RoleSpec, ctx: ScopeContext): DenyPlan {
  const dirs = role.hasBash ? [] : sortedUnique(ctx.codeDirs)
  const usable = dirs.filter(isSafeDir)
  const own = ownNames(role.id)
  const roots = ownRoots(role.id)
  const covered = usable.filter(dir => !own.has(dir.toLowerCase()))
  const skipped = usable.filter(dir => own.has(dir.toLowerCase()))
  const notGiven = notGivenMcp(role, ctx)
  const had = new Set([...role.mcp, ...INFRA_MCP_SERVERS].map(mcpToolName))
  const named = notGiven.filter(name => !had.has(mcpToolName(name)))
  const { kept, refused } = lintAll([
    ...(role.hasBash ? [] : ['Bash']),
    ...covered.flatMap(dir => [`Read(./${dir}/**)`, `Edit(./${dir}/**)`]),
    ...SECRET_READ_DENY,
    ...named.map(mcpToolName),
  ])

  return {
    entries: kept,
    dirs: covered.filter(dir => kept.includes(`Read(./${dir}/**)`) && kept.includes(`Edit(./${dir}/**)`)),
    ownDirs: skipped.filter(dir => roots.has(dir.toLowerCase())),
    skippedDirs: skipped.filter(dir => !roots.has(dir.toLowerCase())),
    unusualDirs: dirs.filter(dir => !isSafeDir(dir)),
    mcp: named.filter(name => kept.includes(mcpToolName(name))),
    unusualMcp: notGiven.filter(name => had.has(mcpToolName(name))),
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
 * (D-50, D-78, S1, S4). The paths are repo-relative: the launcher starts in the git top level. Beside the overlay, the
 * role folder and the private instructions link in `.runtime` are added directories, so the engine loads the role's
 * built `.cadre/<id>/CLAUDE.md` and its private CLAUDE.md as CLAUDE.md files when the exec line sets
 * CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD (D-140 q1-b); ROLE.md stays the appended system prompt. The MCP route
 * is a parameter, and the flag that turns off slash commands is never added, because it would turn off the handoff
 * skills. The role id is a validated slug (validateRoleId), so it is safe in a path and in a token.
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
    '--add-dir',
    `.cadre/${role.id}`,
    '--add-dir',
    `${runtime}/${PRIVATE_INSTRUCTIONS_LINK}`,
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

/**
 * The Bash rule: no Bash tool (hard), which the probe checks as the Bash tool absent from the startup inventory, or the
 * sandbox (hard on macOS, best effort on Linux) for a role with Bash, which the inventory cannot show.
 */
function bashRule(role: RoleSpec): ScopeRule {
  if (!role.hasBash) return checkedRule('No Bash tool (denied)', 'hard', [{ kind: 'tool-absent', token: 'Bash' }])

  return rule('Bash runs in the sandbox (hard on macOS, best-effort on Linux)', 'best-effort')
}

/** The rule for the code dirs that are denied; none when no dir is. */
function deniedDirRules(deny: DenyPlan): ScopeRule[] {
  if (deny.dirs.length === 0) return []
  const text = `Reads and edits under ${cardList(deny.dirs.map(shown))} are denied; the patterns match at any depth`

  return [rule(text, 'best-effort')]
}

/**
 * The rule for the code dirs that are the role's own top folders: no deny covers them, so the rule is a note labelled
 * none (B7); none when there is no such dir.
 */
function ownDirRules(deny: DenyPlan): ScopeRule[] {
  if (deny.ownDirs.length === 0) return []

  return [rule(`Reads and edits under ${cardList(deny.ownDirs.map(shown))} are never denied (own folders)`, 'none')]
}

/** The rule for the code dirs the committed template leaves to the launch render; none when no dir is skipped. */
function skippedDirRules(deny: DenyPlan): ScopeRule[] {
  if (deny.skippedDirs.length === 0) return []
  const text =
    `Reads and edits under ${cardList(deny.skippedDirs.map(shown))} are not denied in the committed template: ` +
    "those names match the role's own folders at any depth (exact denies are rendered at launch)"

  return [rule(text, 'best-effort')]
}

/** One rule for each code dir that is not denied because its name is unusual. */
function unusualDirRules(deny: DenyPlan): ScopeRule[] {
  return deny.unusualDirs.map(dir => rule(`Code dir ${shown(dir)} has an unusual name and is not denied`, 'none'))
}

/** What the launch render does to a denied server on the merged route, as its own card rule (D-124, B6, #39). */
const MCP_REACHABLE_TEXT = 'Denied servers: tools removed and the whole server denied (deniedMcpServers; best-effort)'

/**
 * The deny rule of the scanned servers: none to deny, the list, and on the merged route the reachable rule after it.
 * The probe checks the list for each denied server as no tool whose name starts with `mcp__<server>__` in the startup
 * inventory: the tool deny removes them, and deniedMcpServers removes the whole server where the engine honours it, so
 * a tools check holds for both (D-112, D-124, #39).
 */
function deniedMcpRules(deny: DenyPlan, route: McpRoute): ScopeRule[] {
  const enforcement: Enforcement = route === 'strict' ? 'hard' : 'best-effort'
  if (deny.mcp.length === 0) return [rule('No other scanned MCP servers to deny', enforcement)]
  const text = `Scanned MCP servers not given are denied: ${cardList(deny.mcp.map(shown))}`
  const checks = deny.mcp.map((name): ProbeCheck => ({ kind: 'tool-prefix-absent', token: `${mcpToolName(name)}__` }))
  const listed = checkedRule(text, enforcement, checks)
  if (route === 'strict') return [listed]

  return [listed, rule(MCP_REACHABLE_TEXT, 'best-effort')]
}

/**
 * The MCP rules: the deny rules of the scanned servers (deniedMcpRules), then the servers left out because they share
 * a tool name with one the role has (A5), and the refused patterns. The list rule is hard only on the strict route; on
 * the merged route a server the scan did not see still loads, so it is best effort (A4), and the next rule says that
 * the launch render denies such a server whole as well as its tools (D-124, #39). That sentence is a rule of its own,
 * so a long list cannot cut it from its card line (B6).
 */
function mcpRules(deny: DenyPlan, route: McpRoute): ScopeRule[] {
  return [
    ...deniedMcpRules(deny, route),
    ...deny.unusualMcp.map(name =>
      rule(`MCP server ${shown(name)} shares its tool name with a server this role has and is not denied`, 'none'),
    ),
    ...deny.refused.map(item => rule(`${shown(item.pattern)} was not emitted: ${item.message}`, 'none')),
  ]
}

/**
 * The rule that names the MCP route (D-104): merged leaves out --strict-mcp-config, so /fleet works and every MCP deny
 * is best effort; strict passes the flag. It states the route and enforces nothing, so it is labelled none.
 */
function routeRule(route: McpRoute): ScopeRule {
  if (route === 'strict') return rule('MCP route: strict (--strict-mcp-config)', 'none')

  return rule('MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)', 'none')
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
 * The warnings of a GSD context monitor registered in project settings (D-62, A1): it loads in every role that starts
 * at the git root, since the launcher runs --setting-sources project, and cadre's settings cannot remove it; rulesFor
 * gives them for a git-root start only (D-122). One rule per script, sorted; none when no project hook is the monitor.
 */
function projectMonitorRules(setup: SetupScan): ScopeRule[] {
  const monitors = setup.hooks.filter(hook => hook.source === 'project' && isContextMonitorScript(hook.script))

  return sortedUnique(monitors.map(hook => hook.script)).map(script => {
    const text =
      `WARNING: ${shown(script)} is registered in project settings and loads in every role; ` +
      'it conflicts with the autopilot handoff (D-62)'

    return rule(text, 'none')
  })
}

/**
 * The folder a launcher that does not start at the git root starts the session in, as the card names it: the folder
 * of a `dir` start under `<git root>`, or for `here` the folder the launcher is run from.
 */
function startFolderText(start: Exclude<LaunchStart, { readonly kind: 'git-root' }>): string {
  if (start.kind === 'dir') return `<git root>/${shown(start.path)}`

  return 'the folder the launcher is run from'
}

/**
 * The notes of a launch start other than the git root, labelled none, in this order: the project settings of the git
 * root do not load, since the session starts in another folder (D-122); the git root is an additional directory
 * (D-127); and the handoffs and GSD's .planning/ follow the start folder (D-113). None for a git-root start.
 */
function startRules(role: RoleSpec, start: LaunchStart): ScopeRule[] {
  if (start.kind === 'git-root') return []
  const folder = startFolderText(start)
  const handoffs = `thoughts/shared/handoffs/${role.id}/`

  return [
    rule(`project settings (<git root>/.claude/settings.json) do not load: the session starts in ${folder}`, 'none'),
    rule(`Additional directory: <git root> (start folder is ${folder})`, 'none'),
    rule(`Handoffs (${handoffs}) and GSD .planning/ follow the start folder (${folder})`, 'none'),
  ]
}

/**
 * The rules of the card in their fixed order. The label of each rule is fixed here: a rule an engine setting enforces
 * is hard, a pattern a subprocess can sidestep is best effort, and a note or warning is none (ROLE-06). The rules the
 * startup inventory can prove carry their probe checks (D-112): the Bash rule, the MCP deny list, the infra rule and
 * the permission mode, which the init event reports for manual as default (RESEARCH 1.1).
 */
function rulesFor(role: RoleSpec, ctx: ScopeContext, plugins: readonly string[], deny: DenyPlan): ScopeRule[] {
  const mode = role.permissionMode === 'manual' ? 'default' : role.permissionMode

  return [
    ...bypassRules(role),
    rule(`Plugins: only ${cardList(plugins.map(shown))} load (--setting-sources project whitelist)`, 'hard'),
    bashRule(role),
    ...deniedDirRules(deny),
    ...ownDirRules(deny),
    ...skippedDirRules(deny),
    ...unusualDirRules(deny),
    rule('Reads of .env, .env.*, ~/.ssh and ~/.aws are denied', 'best-effort'),
    ...mcpRules(deny, ctx.mcpRoute),
    ...partialMcpRules(ctx.setup),
    rule('Skills: only the listed skills are linked', 'best-effort'),
    checkedRule('Autopilot, agent-fleet and the handoff skills are always available', 'hard', INFRA_CHECKS),
    checkedRule(`Permission mode: ${role.permissionMode}`, 'hard', [{ kind: 'permission-mode', token: mode }]),
    ...attendedRules(role, ctx),
    ...(ctx.launchStart.kind === 'git-root' ? projectMonitorRules(ctx.setup) : []),
    ...startRules(role, ctx.launchStart),
    routeRule(ctx.mcpRoute),
  ]
}

/**
 * The scope card of a role, from the same inputs as the settings, so the two cannot drift (D-80). The role is attended
 * when the context says so, and also when it runs GSD without Bash (A1). The project hook scripts are loaded by
 * project settings for a git-root start only; for a `here` or `dir` start they are not loaded (D-122).
 */
function cardFor(role: RoleSpec, ctx: ScopeContext, plugins: readonly string[], deny: DenyPlan): ScopeCard {
  const loaded = sortedUnique(role.carry.hooks)
  const projectScripts = ctx.setup.hooks.filter(hook => hook.source === 'project').map(hook => hook.script)
  const byProject = ctx.launchStart.kind === 'git-root' ? sortedUnique(projectScripts) : []
  const loadedByProject = byProject.filter(script => !loaded.includes(script))
  const notLoaded = sortedUnique(ctx.setup.hooks.map(hook => hook.script)).filter(
    script => !loaded.includes(script) && !byProject.includes(script),
  )

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
    hooks: { loaded, loadedByProject, notLoaded },
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

/**
 * The lines of a scope card, as init shows it and ROLE.md holds it (ROLE-06): the title, the framework with the model,
 * effort and permission mode, the skills and MCP servers, the skills and the MCP servers the role was not given, the
 * hooks loaded, loaded by project settings and not loaded, one line per list so a list cut at the line cap never hides
 * another (B6), each rule marked `[hard]`, `[best-effort]` or `[none]`, the decision chain and the memory folder. Every
 * line passes through reportText, so a hostile value cannot add a line or hide text.
 */
export function scopeCardLines(card: ScopeCard): string[] {
  const framework = adapterOf(card.framework).name
  const lines = [
    `Scope card: ${card.title} (${card.roleId})`,
    `  framework: ${framework}; model: ${card.model} + ${card.effort}; permission mode: ${card.permissionMode}`,
    `  skills: ${cardList(card.skills)}`,
    `  MCP servers: ${cardList(card.mcp)}`,
    `  not given skills: ${cardList(card.notGiven.skills)}`,
    `  not given MCP: ${cardList(card.notGiven.mcp)}`,
    `  hooks loaded: ${cardList(card.hooks.loaded)}`,
    `  hooks loaded by project settings: ${cardList(card.hooks.loadedByProject)}`,
    `  hooks not loaded: ${cardList(card.hooks.notLoaded)}`,
    '  rules:',
    ...card.rules.map(item => `    [${item.enforcement}] ${item.text}`),
    '  decisions:',
    ...card.chain.map(line => `    ${line}`),
    `  memory: ${card.memoryPattern} (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)`,
  ]

  return lines.map(reportText)
}
