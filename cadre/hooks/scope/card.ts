/**
 * The scope card, a layer 5 module: what a role is denied as its card states it, the scanned skills and MCP servers
 * it was not given, every card rule with its label and the probe checks that prove it, and the card as the lines init
 * shows and ROLE.md holds (ROLE-06, D-80, D-104, D-112, D-122, D-124). It imports the scope lint, core, paths, the
 * framework registry, the role template, the infra catalog and the types, so the scope compiler, generate, launch and
 * init read the card here.
 */
import type {
  Enforcement,
  LaunchStart,
  McpRoute,
  ProbeCheck,
  RoleSpec,
  ScopeCard,
  ScopeContext,
  ScopeRule,
  SetupScan,
  SkillRef,
} from '../../types'
import { cardList, MAX_CARD_LIST, reportText, shown, sortedUnique } from '../core/text'
import type { ListWords } from '../core/text'
import { adapterOf } from '../framework/registry'
import { ARTIFACT } from '../locales/artifact'
import { fill } from '../locales/t'
import { handoffFolderOf } from '../paths'
import { INFRA_MCP_SERVERS, INFRA_SKILLS } from '../roles/infra'
import { chainLines } from '../roles/template'
import {
  checkedRule,
  INFRA_CHECKS,
  isContextMonitorScript,
  MEMORY_PATTERN,
  pluginName,
  rule,
  skillPlugin,
} from './lint'
import type { Refusal } from './lint'

/**
 * The words of a scope card or INDEX.md list (core/text cardList): generated-file text, so ARTIFACT words (D-221), and
 * the MAX_CARD_LIST cap on every surface (D-256: only pane blocks lose it).
 */
export const CARD_LIST_WORDS: ListWords = Object.freeze({
  none: ARTIFACT.cardNone,
  more: (count: number) => fill(ARTIFACT.cardMore, { count }),
  max: MAX_CARD_LIST,
})

/**
 * The scanned MCP servers this role was not given, once each and sorted. The infra servers are never in the list:
 * every role has them (ISO-04).
 */
export function notGivenMcp(role: RoleSpec, ctx: ScopeContext): string[] {
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
  const given = new Set([...INFRA_SKILLS, ...adapterOf(ctx.framework).startSkills, ...role.skills])
  const enabled = new Set(plugins.map(pluginName))
  const missing = ctx.setup.skills.filter(skill => !hasScannedSkill(skill, given, enabled))

  return sortedUnique(missing.map(skill => skill.name))
}

/** What the role is denied, and what the card says about it. */
export type DenyPlan = {
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
 * The tool name the engine gives an MCP server, which is what a deny rule must name: `mcp__` and the server name with
 * every character outside letters, digits, `_` and `-` replaced by `_`, so `my.server` is `mcp__my_server` (A5).
 */
export function mcpToolName(name: string): string {
  return `mcp__${name.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

/** Whether role.json sets the mode that skips every permission prompt (D-95). */
function isBypass(role: RoleSpec): boolean {
  return role.permissionMode === 'bypassPermissions'
}

/** The warning that leads the card of a bypass role. No engine setting makes it safe, so it is label none (D-95). */
function bypassRules(role: RoleSpec): ScopeRule[] {
  if (!isBypass(role)) return []

  return [rule(ARTIFACT.cardBypass, 'none')]
}

/**
 * The Bash rule: no Bash tool (hard), which the probe checks as the Bash tool absent from the startup inventory, or the
 * sandbox (hard on macOS, best effort on Linux) for a role with Bash, which the inventory cannot show.
 */
function bashRule(role: RoleSpec): ScopeRule {
  if (!role.hasBash) return checkedRule(ARTIFACT.cardNoBash, 'hard', [{ kind: 'tool-absent', token: 'Bash' }])

  return rule(ARTIFACT.cardSandbox, 'best-effort')
}

/** The rule for the code dirs that are denied; none when no dir is. */
function deniedDirRules(deny: DenyPlan): ScopeRule[] {
  if (deny.dirs.length === 0) return []
  const dirList = cardList(deny.dirs.map(dir => shown(dir)), CARD_LIST_WORDS)
  const text = fill(ARTIFACT.cardDeniedDirs, { dirs: dirList })

  return [rule(text, 'best-effort')]
}

/**
 * The rule for the code dirs that are the role's own top folders: no deny covers them, so the rule is a note labelled
 * none (B7); none when there is no such dir.
 */
function ownDirRules(deny: DenyPlan): ScopeRule[] {
  if (deny.ownDirs.length === 0) return []
  const dirList = cardList(deny.ownDirs.map(dir => shown(dir)), CARD_LIST_WORDS)

  return [rule(fill(ARTIFACT.cardOwnDirs, { dirs: dirList }), 'none')]
}

/** The rule for the code dirs the committed template leaves to the launch render; none when no dir is skipped. */
function skippedDirRules(deny: DenyPlan): ScopeRule[] {
  if (deny.skippedDirs.length === 0) return []
  const dirList = cardList(deny.skippedDirs.map(dir => shown(dir)), CARD_LIST_WORDS)
  const text = fill(ARTIFACT.cardSkippedDirs, { dirs: dirList })

  return [rule(text, 'best-effort')]
}

/** One rule for each code dir that is not denied because its name is unusual. */
function unusualDirRules(deny: DenyPlan): ScopeRule[] {
  return deny.unusualDirs.map(dir => rule(fill(ARTIFACT.cardUnusualDir, { dir: shown(dir) }), 'none'))
}

/** What the launch render does to a denied server on the merged route, as its own card rule (D-124, B6, #39). */
const MCP_REACHABLE_TEXT = ARTIFACT.cardMcpReachable

/**
 * The deny rule of the scanned servers: none to deny, the list, and on the merged route the reachable rule after it.
 * The probe checks the list for each denied server as no tool whose name starts with `mcp__<server>__` in the startup
 * inventory: the tool deny removes them, and deniedMcpServers removes the whole server where the engine honours it, so
 * a tools check holds for both (D-112, D-124, #39).
 */
function deniedMcpRules(deny: DenyPlan, route: McpRoute): ScopeRule[] {
  const enforcement: Enforcement = route === 'strict' ? 'hard' : 'best-effort'
  if (deny.mcp.length === 0) return [rule(ARTIFACT.cardNoMcpToDeny, enforcement)]
  const text = fill(ARTIFACT.cardDeniedMcp, { servers: cardList(deny.mcp.map(name => shown(name)), CARD_LIST_WORDS) })
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
      rule(fill(ARTIFACT.cardUnusualMcp, { name: shown(name) }), 'none'),
    ),
    ...deny.refused.map(item =>
      rule(fill(ARTIFACT.cardRefused, { pattern: shown(item.pattern), message: item.message }), 'none'),
    ),
  ]
}

/**
 * The rule that names the MCP route (D-104): merged leaves out --strict-mcp-config, so /fleet works and every MCP deny
 * is best effort; strict passes the flag. It states the route and enforces nothing, so it is labelled none.
 */
function routeRule(route: McpRoute): ScopeRule {
  if (route === 'strict') return rule(ARTIFACT.cardRouteStrict, 'none')

  return rule(ARTIFACT.cardRouteMerged, 'none')
}

/**
 * The note when the setup scan could not see every MCP server (A4): it dropped a name a role.json cannot hold, or it
 * did not read `~/.claude.json`. A server it did not see is not on the deny list, so the role can still use it.
 */
function partialMcpRules(setup: SetupScan): ScopeRule[] {
  if (!setup.isMcpPartial) return []
  return [rule(ARTIFACT.cardPartialMcp, 'none')]
}

/**
 * Whether the role runs GSD without Bash. GSD workflows need Bash, so such a role keeps its start skills and runs them
 * through a person, which makes it attended (A1).
 */
function isGsdWithoutBash(role: RoleSpec, ctx: ScopeContext): boolean {
  return adapterOf(ctx.framework).needsBash && !role.hasBash
}

/**
 * The rules of an attended role (ROLE-04), in this order: the one for framework steps that cannot run unattended, when
 * the context says so, then the one for GSD workflows that need Bash, for a role without Bash on GSD (A1).
 */
function attendedRules(role: RoleSpec, ctx: ScopeContext): ScopeRule[] {
  const rules: ScopeRule[] = []
  if (ctx.isAttended) {
    rules.push(rule(ARTIFACT.cardAttendedSteps, 'none'))
  }
  if (isGsdWithoutBash(role, ctx)) {
    rules.push(rule(ARTIFACT.cardAttendedGsd, 'none'))
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
    return rule(fill(ARTIFACT.cardProjectMonitor, { script: shown(script) }), 'none')
  })
}

/**
 * The folder a launcher that does not start at the git root starts the session in, as the card names it: the folder
 * of a `dir` start under `<git root>`, or for `here` the folder the launcher is run from.
 */
function startFolderText(start: Exclude<LaunchStart, { readonly kind: 'git-root' }>): string {
  if (start.kind === 'dir') return fill(ARTIFACT.cardStartDir, { path: shown(start.path) })

  return ARTIFACT.cardStartHere
}

/**
 * The notes of a launch start other than the git root, labelled none, in this order: the project settings of the git
 * root do not load, since the session starts in another folder (D-122); the git root is an additional directory
 * (D-127); and the handoffs and GSD's .planning/ follow the start folder (D-113). None for a git-root start.
 */
function startRules(role: RoleSpec, start: LaunchStart): ScopeRule[] {
  if (start.kind === 'git-root') return []
  const folder = startFolderText(start)
  const handoffs = `${handoffFolderOf(role.id)}/`

  return [
    rule(fill(ARTIFACT.cardNoProjectSettings, { folder }), 'none'),
    rule(fill(ARTIFACT.cardAdditionalDir, { folder }), 'none'),
    rule(fill(ARTIFACT.cardHandoffsFollow, { handoffs, folder }), 'none'),
  ]
}

/**
 * The rules of the card in their fixed order. The label of each rule is fixed here: a rule an engine setting enforces
 * is hard, a pattern a subprocess can sidestep is best effort, and a note or warning is none (ROLE-06). The rules the
 * startup inventory can prove carry their probe checks (D-112): the Bash rule, the MCP deny list, the infra rule and
 * the permission mode, which the init event reports for manual as default (RESEARCH 1.1). Right after the Skills rule
 * a none rule names what the role loads as its instructions: its built `.cadre/<id>/CLAUDE.md` and its private
 * instructions folder in the config folder (02-GAPS-B2 N9).
 */
function rulesFor(role: RoleSpec, ctx: ScopeContext, plugins: readonly string[], deny: DenyPlan): ScopeRule[] {
  const mode = role.permissionMode === 'manual' ? 'default' : role.permissionMode
  const pluginList = cardList(plugins.map(plugin => shown(plugin)), CARD_LIST_WORDS)

  return [
    ...bypassRules(role),
    rule(fill(ARTIFACT.cardPlugins, { plugins: pluginList }), 'hard'),
    bashRule(role),
    ...deniedDirRules(deny),
    ...ownDirRules(deny),
    ...skippedDirRules(deny),
    ...unusualDirRules(deny),
    rule(ARTIFACT.cardSecrets, 'best-effort'),
    ...mcpRules(deny, ctx.mcpRoute),
    ...partialMcpRules(ctx.setup),
    rule(ARTIFACT.cardSkills, 'best-effort'),
    rule(fill(ARTIFACT.cardLoads, { id: role.id }), 'none'),
    checkedRule(ARTIFACT.cardInfra, 'hard', INFRA_CHECKS),
    checkedRule(fill(ARTIFACT.cardPermissionMode, { mode: role.permissionMode }), 'hard', [
      { kind: 'permission-mode', token: mode },
    ]),
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
export function cardFor(role: RoleSpec, ctx: ScopeContext, plugins: readonly string[], deny: DenyPlan): ScopeCard {
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
 * The lines of a scope card, as init shows it and ROLE.md holds it (ROLE-06): the title, the framework with the model,
 * effort and permission mode, the skills and MCP servers, the skills and the MCP servers the role was not given, the
 * hooks loaded, loaded by project settings and not loaded, one line per list so a list cut at the line cap never hides
 * another (B6), each rule marked `[hard]`, `[best-effort]` or `[none]`, the decision chain and the memory folder. Every
 * line passes through reportText, so a hostile value cannot add a line or hide text.
 */
export function scopeCardLines(card: ScopeCard): string[] {
  const framework = adapterOf(card.framework).name
  const lines = [
    fill(ARTIFACT.cardTitle, { title: card.title, id: card.roleId }),
    fill(ARTIFACT.cardFramework, { framework, model: card.model, effort: card.effort, mode: card.permissionMode }),
    fill(ARTIFACT.cardSkillsLine, { skills: cardList(card.skills, CARD_LIST_WORDS) }),
    fill(ARTIFACT.cardMcpLine, { servers: cardList(card.mcp, CARD_LIST_WORDS) }),
    fill(ARTIFACT.cardNotGivenSkills, { skills: cardList(card.notGiven.skills, CARD_LIST_WORDS) }),
    fill(ARTIFACT.cardNotGivenMcp, { servers: cardList(card.notGiven.mcp, CARD_LIST_WORDS) }),
    fill(ARTIFACT.cardHooksLoaded, { hooks: cardList(card.hooks.loaded, CARD_LIST_WORDS) }),
    fill(ARTIFACT.cardHooksByProject, { hooks: cardList(card.hooks.loadedByProject, CARD_LIST_WORDS) }),
    fill(ARTIFACT.cardHooksNotLoaded, { hooks: cardList(card.hooks.notLoaded, CARD_LIST_WORDS) }),
    ARTIFACT.cardRules,
    ...card.rules.map(item => fill(ARTIFACT.cardRule, { enforcement: item.enforcement, text: item.text })),
    ARTIFACT.cardDecisions,
    ...card.chain.map(line => fill(ARTIFACT.cardDecision, { line })),
    fill(ARTIFACT.cardMemory, { pattern: card.memoryPattern }),
  ]

  return lines.map(reportText)
}
