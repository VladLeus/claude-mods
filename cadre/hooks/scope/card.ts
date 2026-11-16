/**
 * The scope card, a layer 5 module: what a role is denied as its card states it, the scanned skills and MCP servers
 * it was not given, every card rule with its label and the probe checks that prove it, and the card as the lines init
 * shows and ROLE.md holds (ROLE-06, D-80, D-104, D-112, D-122, D-124). It imports the scope lint, core, paths, the
 * framework registry, the role template, the infra catalog and the types, so the scope compiler, generate, launch and
 * init read the card here.
 */
import type {
  Enforcement,
  HookScript,
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
import { handoffFolderOf, isSafeRoot } from '../paths'
import { INFRA_MCP_SERVERS, INFRA_SKILLS, PER_SKILL_DENY_PLUGINS } from '../roles/infra'
import { chainLines, runsRepoChecks } from '../roles/template'
import { runnableFrameworks } from './frameworks'
import {
  checkedRule,
  DOCKER_COMMANDS,
  INFRA_CHECKS,
  isContextMonitorScript,
  MEMORY_PATTERN,
  pluginName,
  rule,
  skillPlugin,
} from './lint'
import type { Refusal } from './lint'

/** The enforcement of the card's Skills rule, which each per-skill probe line carries too. */
export const SKILLS_RULE_ENFORCEMENT: Enforcement = 'best-effort'

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

/** The scanned skills this role does not have; see hasScannedSkill. */
function missingSkills(role: RoleSpec, ctx: ScopeContext, plugins: readonly string[]): SkillRef[] {
  const given = givenSkills(role, ctx)
  const enabled = new Set(plugins.map(pluginName))

  return ctx.setup.skills.filter(skill => !hasScannedSkill(skill, given, enabled))
}

function givenSkills(role: RoleSpec, ctx: ScopeContext): Set<string> {
  const startSkills = runnableFrameworks(ctx).flatMap(id => adapterOf(id).startSkills)

  return new Set([...INFRA_SKILLS, ...startSkills, ...role.skills])
}

function callDeniedSkills(role: RoleSpec, ctx: ScopeContext, plugins: readonly string[]): string[] {
  const given = givenSkills(role, ctx)
  const perSkill = PER_SKILL_DENY_PLUGINS.map(pluginName)
  const enabled = plugins.map(pluginName)
  const denied = ctx.setup.skills.filter(skill => {
    if (skill.plugin === null || given.has(skill.name)) return false
    const plugin = pluginName(skill.plugin)

    return perSkill.includes(plugin) && enabled.includes(plugin)
  })

  return sortedUnique(denied.map(skill => skill.name))
}

/** The card lines of the skills denied at call time: one per plugin, with its bare skill names sorted. */
export function callDeniedLines(names: readonly string[]): string[] {
  const plugins = sortedUnique(names.flatMap(name => skillPlugin(name) ?? []))

  return plugins.map(plugin => {
    const group = names.filter(name => skillPlugin(name) === plugin)
    const bare = sortedUnique(group.map(name => name.slice(plugin.length + 1)))

    return fill(ARTIFACT.cardCallDenied, { plugin, count: bare.length, skills: cardList(bare, CARD_LIST_WORDS) })
  })
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
 * The inbox rule of every card: hard for a role without Bash whose repo root an exact rule can hold, or whose root is
 * not known; best effort for a role with Bash, which can still write the files, and at a root no rule can hold, where
 * the launch denies nothing. For a bypass role the note that live messages may be held follows it.
 */
function inboxRules(role: RoleSpec, ctx: ScopeContext): ScopeRule[] {
  const isHard = !role.hasBash && (ctx.root === undefined || isSafeRoot(ctx.root))
  const inbox = rule(ARTIFACT.cardInbox, isHard ? 'hard' : 'best-effort')

  return isBypass(role) ? [inbox, rule(ARTIFACT.cardHeldMessages, 'none')] : [inbox]
}

/**
 * The Bash rule: no Bash tool (hard), which the probe checks as the Bash tool absent from the startup inventory, or the
 * sandbox (hard on macOS, best effort on Linux) for a role with Bash, which the inventory cannot show.
 */
function bashRule(role: RoleSpec): ScopeRule {
  if (!role.hasBash) return checkedRule(ARTIFACT.cardNoBash, 'hard', [{ kind: 'tool-absent', token: 'Bash' }])

  return rule(ARTIFACT.cardSandbox, 'best-effort')
}

function dockerRules(role: RoleSpec, ctx: ScopeContext): ScopeRule[] {
  if (!role.hasBash || !runsRepoChecks(role)) return []
  const programs = DOCKER_COMMANDS.map(pattern => pattern.replace(/ \*$/, ''))
  const scripts = (ctx.dockerScripts ?? []).map(command => shown(command))
  const commands = cardList([...programs, ...scripts], CARD_LIST_WORDS)

  return [rule(fill(ARTIFACT.cardDocker, { commands }), 'none')]
}

/**
 * The secrets rule per role kind: the sandbox of a Bash role applies the Read denies to its commands too, and a role
 * that runs the repo's checks may read the env files git tracks.
 */
function secretsRule(role: RoleSpec): ScopeRule {
  if (!role.hasBash) return rule(ARTIFACT.cardSecrets, 'best-effort')
  if (runsRepoChecks(role)) return rule(ARTIFACT.cardSecretsChecks, 'best-effort')

  return rule(ARTIFACT.cardSecretsSandbox, 'best-effort')
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
 * Whether the role runs GSD without Bash: a framework the role may run needs Bash, and the role has no Bash. GSD
 * workflows need Bash, so such a role keeps its start skills and runs them through a person, which makes it attended
 * (A1).
 */
function isGsdWithoutBash(role: RoleSpec, ctx: ScopeContext): boolean {
  if (role.hasBash) return false

  return runnableFrameworks(ctx).some(id => adapterOf(id).needsBash)
}

/**
 * Whether the role is started with --ask-user and may run a framework whose menus autopilot answers only while asking
 * is off: those menus reach the person as dialogs, so the role is attended.
 */
function isAskedInMenus(role: RoleSpec, ctx: ScopeContext): boolean {
  if (!role.autopilot.askUser) return false

  return runnableFrameworks(ctx).some(id => adapterOf(id).humanGates.some(gate => gate.handling === 'autopilot-denies'))
}

/**
 * The rules of an attended role, in this order: the one for framework steps that cannot run unattended, when the
 * context says so, the one for GSD workflows that need Bash, for a role without Bash on GSD, then the one for framework
 * menus that reach the person, for a role started with --ask-user.
 */
function attendedRules(role: RoleSpec, ctx: ScopeContext): ScopeRule[] {
  const rules: ScopeRule[] = []
  if (ctx.isAttended) {
    rules.push(rule(ARTIFACT.cardAttendedSteps, 'none'))
  }
  if (isGsdWithoutBash(role, ctx)) {
    rules.push(rule(ARTIFACT.cardAttendedGsd, 'none'))
  }
  if (isAskedInMenus(role, ctx)) {
    rules.push(rule(ARTIFACT.cardAttendedAsk, 'none'))
  }

  return rules
}

/**
 * The hooks the project settings of the start load, which cadre's settings cannot remove: the git root's for a
 * git-root start, the start folder's for a dir start (null when its settings could not be read), and null for here,
 * whose folder is not known before launch.
 */
function projectLoadedHooks(ctx: ScopeContext): readonly HookScript[] | null {
  if (ctx.launchStart.kind === 'git-root') return ctx.setup.hooks.filter(hook => hook.source === 'project')
  if (ctx.launchStart.kind !== 'dir') return null
  const settings = ctx.setup.startSettings
  if (settings?.state === 'unknown') return null

  return settings?.state === 'read' ? settings.hooks : []
}

/**
 * The warnings of a GSD context monitor among the given hooks, which load in every role and conflict with the autopilot
 * handoff. One rule per script, sorted; none when no hook is the monitor.
 */
function projectMonitorRules(hooks: readonly HookScript[]): ScopeRule[] {
  const monitors = hooks.filter(hook => isContextMonitorScript(hook.script))

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
 * root do not load; the start folder's `.claude/settings.json` loads, then for a dir start a warning naming the keys
 * of it cadre does not scan and, when no permission rule can hold its path, that its settings files and framework
 * install folders are not write-protected, and for a here start that its settings files are not write-protected and
 * the plugins they enable are not switched off (the folder is not known before launch); the git root is an additional
 * directory; the handoffs and GSD's .planning/ follow the start folder.
 */
function startRules(role: RoleSpec, ctx: ScopeContext): ScopeRule[] {
  const start = ctx.launchStart
  if (start.kind === 'git-root') return []
  const folder = startFolderText(start)
  const handoffs = `${handoffFolderOf(role.id)}/`
  const settings =
    start.kind === 'dir' ? fill(ARTIFACT.cardStartSettingsDir, { folder }) : ARTIFACT.cardStartSettingsHere
  const keys = start.kind === 'dir' ? (ctx.setup.startSettings?.keys ?? []) : []
  const keysRules =
    keys.length === 0 ? [] : [rule(fill(ARTIFACT.cardStartSettingsKeys, { folder, keys: keys.join(', ') }), 'none')]
  const writableRules =
    start.kind === 'dir' && !isSafeRoot(`${ctx.root ?? ''}/${start.path}`)
      ? [rule(fill(ARTIFACT.cardStartSettingsWritable, { folder }), 'none')]
      : []
  const hereRules =
    start.kind === 'here'
      ? [rule(ARTIFACT.cardHereSettingsWritable, 'none'), rule(ARTIFACT.cardHerePlugins, 'none')]
      : []

  return [
    rule(fill(ARTIFACT.cardNoProjectSettings, { folder }), 'none'),
    rule(settings, 'none'),
    ...keysRules,
    ...writableRules,
    ...hereRules,
    rule(fill(ARTIFACT.cardAdditionalDir, { folder }), 'none'),
    rule(fill(ARTIFACT.cardHandoffsFollow, { handoffs, folder }), 'none'),
  ]
}

/**
 * Whether the plugins the start folder's settings enable are not known, so the launch cannot switch them off: a here
 * start, or a dir start whose settings could not be read.
 */
function isStartPluginsUnknown(ctx: ScopeContext): boolean {
  if (ctx.launchStart.kind === 'here') return true

  return ctx.launchStart.kind === 'dir' && ctx.setup.startSettings?.state === 'unknown'
}

/**
 * The rules of the card in their fixed order. The label of each rule is fixed here: a rule an engine setting enforces
 * is hard, a pattern a subprocess can sidestep is best effort, and a note or warning is none. The rules the startup
 * inventory can prove carry their probe checks: the Bash rule, the MCP deny list, the infra rule and the permission
 * mode, which the init event reports for manual as default. Right after the Bash rule a role that runs the repo's
 * checks has a none rule naming what runs outside the sandbox. Right after the Skills rule a none rule names what the
 * role loads as its instructions: its built `.cadre/<id>/CLAUDE.md` and its private instructions folder in the config
 * folder. Right after the infra rule come the inbox rules.
 */
function rulesFor(role: RoleSpec, ctx: ScopeContext, plugins: readonly string[], deny: DenyPlan): ScopeRule[] {
  const mode = role.permissionMode === 'manual' ? 'default' : role.permissionMode
  const pluginList = cardList(plugins.map(plugin => shown(plugin)), CARD_LIST_WORDS)
  const pluginsEnforcement: Enforcement = isStartPluginsUnknown(ctx) ? 'best-effort' : 'hard'

  return [
    ...bypassRules(role),
    rule(fill(ARTIFACT.cardPlugins, { plugins: pluginList }), pluginsEnforcement),
    bashRule(role),
    ...dockerRules(role, ctx),
    ...deniedDirRules(deny),
    ...ownDirRules(deny),
    ...skippedDirRules(deny),
    ...unusualDirRules(deny),
    secretsRule(role),
    ...mcpRules(deny, ctx.mcpRoute),
    ...partialMcpRules(ctx.setup),
    rule(ARTIFACT.cardSkills, SKILLS_RULE_ENFORCEMENT),
    rule(fill(ARTIFACT.cardLoads, { id: role.id }), 'none'),
    checkedRule(ARTIFACT.cardInfra, 'hard', INFRA_CHECKS),
    ...inboxRules(role, ctx),
    checkedRule(fill(ARTIFACT.cardPermissionMode, { mode: role.permissionMode }), 'hard', [
      { kind: 'permission-mode', token: mode },
    ]),
    ...attendedRules(role, ctx),
    ...projectMonitorRules(projectLoadedHooks(ctx) ?? []),
    ...startRules(role, ctx),
    routeRule(ctx.mcpRoute),
  ]
}

/**
 * The scope card of a role, from the same inputs as the settings so the two cannot drift; the hooks the start's project
 * settings load are null when unknown: for a here start, or a dir start whose folder settings could not be read.
 */
export function cardFor(role: RoleSpec, ctx: ScopeContext, plugins: readonly string[], deny: DenyPlan): ScopeCard {
  const loaded = sortedUnique(role.carry.hooks)
  const projectHooks = projectLoadedHooks(ctx)
  const byProject = projectHooks === null ? null : sortedUnique(projectHooks.map(hook => hook.script))
  const loadedByProject = byProject === null ? null : byProject.filter(script => !loaded.includes(script))
  const notLoaded = sortedUnique(ctx.setup.hooks.map(hook => hook.script)).filter(
    script => !loaded.includes(script) && !(byProject ?? []).includes(script),
  )
  const missing = missingSkills(role, ctx, plugins)

  return {
    roleId: role.id,
    title: role.title,
    framework: ctx.framework,
    alsoRuns: runnableFrameworks(ctx).filter(id => id !== ctx.framework),
    model: role.model,
    effort: role.effort,
    permissionMode: role.permissionMode,
    isBypass: isBypass(role),
    isAttended: ctx.isAttended || isGsdWithoutBash(role, ctx) || isAskedInMenus(role, ctx),
    skills: sortedUnique(role.skills),
    mcp: sortedUnique(role.mcp),
    notGiven: {
      skills: sortedUnique(missing.map(skill => skill.name)),
      pluginSkills: sortedUnique(missing.filter(skill => skill.plugin !== null).map(skill => skill.name)),
      mcp: notGivenMcp(role, ctx),
    },
    callDenied: callDeniedSkills(role, ctx, plugins),
    hooks: { loaded, loadedByProject, notLoaded },
    rules: rulesFor(role, ctx, plugins, deny),
    chain: chainLines(ctx.roles),
    memoryPattern: `${MEMORY_PATTERN}${role.id}/`,
    mcpRoute: ctx.mcpRoute,
  }
}

/**
 * The lines of a scope card as init shows it and ROLE.md holds it: one line per list, so a list cut at the line cap
 * never hides another, and the skills denied at call time, one line per plugin. Every line passes through reportText.
 */
export function scopeCardLines(card: ScopeCard): string[] {
  const framework = adapterOf(card.framework).name
  const also = card.alsoRuns.map(id => adapterOf(id).name).join(', ')
  const { loadedByProject } = card.hooks
  const byProject = loadedByProject === null ? ARTIFACT.cardUnknown : cardList(loadedByProject, CARD_LIST_WORDS)
  const lines = [
    fill(ARTIFACT.cardTitle, { title: card.title, id: card.roleId }),
    fill(ARTIFACT.cardFramework, { framework, model: card.model, effort: card.effort, mode: card.permissionMode }),
    ...(card.alsoRuns.length === 0 ? [] : [fill(ARTIFACT.cardAlsoRuns, { frameworks: also })]),
    fill(ARTIFACT.cardSkillsLine, { skills: cardList(card.skills, CARD_LIST_WORDS) }),
    fill(ARTIFACT.cardMcpLine, { servers: cardList(card.mcp, CARD_LIST_WORDS) }),
    fill(ARTIFACT.cardNotGivenSkills, { skills: cardList(card.notGiven.skills, CARD_LIST_WORDS) }),
    ...callDeniedLines(card.callDenied),
    fill(ARTIFACT.cardNotGivenMcp, { servers: cardList(card.notGiven.mcp, CARD_LIST_WORDS) }),
    fill(ARTIFACT.cardHooksLoaded, { hooks: cardList(card.hooks.loaded, CARD_LIST_WORDS) }),
    fill(ARTIFACT.cardHooksByProject, { hooks: byProject }),
    fill(ARTIFACT.cardHooksNotLoaded, { hooks: cardList(card.hooks.notLoaded, CARD_LIST_WORDS) }),
    ARTIFACT.cardRules,
    ...card.rules.map(item => fill(ARTIFACT.cardRule, { enforcement: item.enforcement, text: item.text })),
    ARTIFACT.cardDecisions,
    ...card.chain.map(line => fill(ARTIFACT.cardDecision, { line })),
    fill(ARTIFACT.cardMemory, { pattern: card.memoryPattern }),
  ]

  return lines.map(reportText)
}
