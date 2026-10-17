import type { CompiledScope, Enforcement, RoleSpec, ScopeCard, ScopeContext, ScopeRule } from '../types'
import { FRAMEWORK_START_SKILLS, INFRA_MCP_SERVERS, INFRA_PLUGINS, INFRA_SKILLS } from './assign'
import { compareText } from './facts'
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

/** The names once each, in code point order, so a list hashes the same on every run. */
function sortedUnique(names: readonly string[]): string[] {
  return Array.from(new Set(names)).sort(compareText)
}

/** One line of the scope card. */
function rule(text: string, enforcement: Enforcement): ScopeRule {
  return { text, enforcement }
}

/** The enabledPlugins record of these plugin keys, every one on, with the keys inserted in sorted order. */
function enabledRecord(keys: readonly string[]): Readonly<Record<string, boolean>> {
  const entries: [string, boolean][] = sortedUnique(keys).map(key => [key, true])

  return Object.fromEntries(entries)
}

/** The plugins every role session loads under the whitelist. Plugin skills of the role are added by a later step. */
function pluginsFor(): Readonly<Record<string, boolean>> {
  return enabledRecord(INFRA_PLUGINS)
}

/**
 * The scanned MCP servers this role was not given, once each and sorted. The infra servers are never in the list:
 * every role has them (ISO-04).
 */
function notGivenMcp(role: RoleSpec, ctx: ScopeContext): string[] {
  const scanned = sortedUnique(ctx.setup.mcp.map(ref => ref.name))

  return scanned.filter(name => !INFRA_MCP_SERVERS.includes(name) && !role.mcp.includes(name))
}

/** The scanned skill names this role does not have; its handoff and framework start skills count as given. */
function notGivenSkills(role: RoleSpec, ctx: ScopeContext): string[] {
  const have = new Set([...INFRA_SKILLS, ...FRAMEWORK_START_SKILLS[ctx.framework], ...role.skills])

  return sortedUnique(ctx.setup.skills.map(skill => skill.name).filter(name => !have.has(name)))
}

/** What the role is denied, and the code dirs and MCP servers behind the entries the card names. */
type DenyPlan = {
  /** The deny entries, sorted and once each. */
  readonly entries: readonly string[]
  /** The code dirs whose reads and edits are denied, sorted. */
  readonly dirs: readonly string[]
  /** The MCP servers denied, by name, sorted. */
  readonly mcp: readonly string[]
}

/**
 * The deny list of a role (ROLE-05, D-80): Bash for a role without it (hard), reads and edits under each scanned code
 * dir for that role (best effort, `./x/**` matches at any depth, P13), the secret reads for every role, and every
 * scanned MCP server the role was not given.
 */
function denyFor(role: RoleSpec, ctx: ScopeContext): DenyPlan {
  const dirs = role.hasBash ? [] : sortedUnique(ctx.codeDirs)
  const mcp = notGivenMcp(role, ctx)
  const entries = [
    ...(role.hasBash ? [] : ['Bash']),
    ...dirs.flatMap(dir => [`Read(./${dir}/**)`, `Edit(./${dir}/**)`]),
    ...SECRET_READ_DENY,
    ...mcp.map(name => `mcp__${name}`),
  ]

  return { entries: sortedUnique(entries), dirs, mcp }
}

/**
 * The skills and agents linked into the overlay at launch (spike S4 V3): the handoff skills, the start skills of the
 * framework and the skills of the role, and for GSD the `gsd-*` agents of the setup. Under `--setting-sources project`
 * a user-level skill is absent unless the overlay links it.
 */
function overlayFor(role: RoleSpec, ctx: ScopeContext): CompiledScope['overlay'] {
  const skills = sortedUnique([...INFRA_SKILLS, ...FRAMEWORK_START_SKILLS[ctx.framework], ...role.skills])
  const agents = ctx.framework === 'gsd' ? sortedUnique(ctx.setup.agents.filter(name => name.startsWith('gsd-'))) : []

  return { skills, agents }
}

/**
 * The launcher flags as argv tokens, a flag and its value each their own token, so a launcher can quote every token
 * (D-50, D-78, S1, S4). The paths are repo-relative: the launcher starts in the git top level. The MCP route is a
 * parameter, and the flag that turns off slash commands is never added, because it would turn off the handoff skills.
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

/** The Bash rule: no Bash tool (hard), or the sandbox (hard on macOS, best effort on Linux) for a role with Bash. */
function bashRule(role: RoleSpec): ScopeRule {
  if (!role.hasBash) return rule('No Bash tool (denied)', 'hard')

  return rule('Bash runs in the sandbox (hard on macOS, best-effort on Linux)', 'best-effort')
}

/** The code-dir rule, present only when some dir is denied. */
function dirRules(deny: DenyPlan): ScopeRule[] {
  if (deny.dirs.length === 0) return []

  const text = `Reads and edits under ${deny.dirs.join(', ')} are denied; the patterns match at any depth`

  return [rule(text, 'best-effort')]
}

/** The MCP rule: the servers denied, or that there are none to deny. */
function mcpRule(deny: DenyPlan): ScopeRule {
  if (deny.mcp.length === 0) return rule('No other MCP servers to deny', 'hard')

  return rule(`MCP servers not given are denied: ${deny.mcp.join(', ')}`, 'hard')
}

/**
 * The rules of the card in their fixed order. The label of each rule is fixed here: a rule an engine setting enforces
 * is hard, a pattern a subprocess can sidestep is best effort, and a note or warning is none (ROLE-06).
 */
function rulesFor(role: RoleSpec, ctx: ScopeContext, plugins: readonly string[], deny: DenyPlan): ScopeRule[] {
  return [
    rule(`Plugins: only ${plugins.join(', ')} load (--setting-sources project whitelist)`, 'hard'),
    bashRule(role),
    ...dirRules(deny),
    rule('Reads of .env, .env.*, ~/.ssh and ~/.aws are denied', 'best-effort'),
    mcpRule(deny),
    rule('Skills: only the listed skills are linked', 'best-effort'),
    rule('Autopilot, agent-fleet and the handoff skills are always available', 'hard'),
    rule(`Permission mode: ${role.permissionMode}`, 'hard'),
    rule(`MCP route: ${ctx.mcpRoute} (provisional; Phase 3 decides)`, 'none'),
  ]
}

/** The scope card of a role, from the same inputs as the settings, so the two cannot drift (D-80). */
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
    isBypass: role.permissionMode === 'bypassPermissions',
    isAttended: ctx.isAttended,
    skills: sortedUnique(role.skills),
    mcp: sortedUnique(role.mcp),
    notGiven: { skills: notGivenSkills(role, ctx), mcp: notGivenMcp(role, ctx) },
    hooks: { loaded, notLoaded },
    rules: rulesFor(role, ctx, plugins, deny),
    chain: chainLines(ctx.roleIds),
    memoryPattern: `${MEMORY_PATTERN}${role.id}/`,
    mcpRoute: ctx.mcpRoute,
  }
}

/**
 * Compiles the whole scope of one role from one computation (D-80): the committed settings template, the MCP file,
 * the launcher flags, the skill overlay and the card cannot drift apart, and Phase 3's probe checks against the same
 * value. The settings hold only the portable keys `enabledPlugins`, `permissions` and `sandbox` (D-84); every
 * per-user value is rendered at launch. Every list is sorted and without repeats, so the template hashes stably, and
 * nothing is kept between calls.
 */
export function compileScope(role: RoleSpec, ctx: ScopeContext): CompiledScope {
  const enabledPlugins = pluginsFor()
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
