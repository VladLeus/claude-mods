import { describe, expect, test } from 'claude-code/testing'

import type {
  CompiledScope,
  FrameworkId,
  HookScript,
  LaunchStart,
  McpRoute,
  PermissionMode,
  ProbeCheck,
  RoleSpec,
  ScopeContext,
  ScopeRule,
  SettingsSource,
  SetupScan,
} from '../types'
import { CLAUDE_SECURITY_PLUGIN, FRAMEWORK_START_SKILLS, INFRA_SKILLS, SECURITY_GUIDANCE_PLUGIN } from './assign'
import { chainLines, EMPTY_CARRY, ROLE_TEMPLATE, roleFromTemplate } from './roles'
import type { ChainRole } from './roles'
import {
  compileScope,
  infraViolations,
  isContextMonitorScript,
  isSafeDir,
  lintDenyPattern,
  roleOwnPaths,
  scopeCardLines,
} from './scope'
import {
  ABSOLUTE_PATH_MARKERS,
  BIDI_OVERRIDE,
  emptySetupScan,
  FRAMEWORKS,
  leaks,
  session,
  skillRef,
  templateRole,
} from './testkit'

/** A scope context for the GSD framework and the merged MCP route; `over` changes the fields it names. */
function context(over: Partial<ScopeContext> = {}): ScopeContext {
  return {
    framework: 'gsd',
    setup: emptySetupScan(),
    codeDirs: [],
    isAttended: false,
    mcpRoute: 'merged',
    launchStart: { kind: 'git-root' },
    roles: ['pm', 'tl'],
    ...over,
  }
}

/** A hook script the settings of `source` register, the user settings unless named. */
function hook(script: string, source: SettingsSource = 'user'): HookScript {
  return { script, event: 'PostToolUse', source }
}

/** The card rule with exactly this text, or undefined when the card has none. */
function ruleOf(scope: CompiledScope, text: string): ScopeRule | undefined {
  return scope.card.rules.find(candidate => candidate.text === text)
}

/** The plugin keys a scope enables, in the order the settings hold them. */
function pluginKeys(scope: CompiledScope): string[] {
  return Object.keys(scope.settings.enabledPlugins)
}

/** The first card rule of a role that only has the three infra plugins (hard, the whitelist of --setting-sources). */
const PLUGIN_RULE =
  'Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load ' +
  '(--setting-sources project whitelist)'

/** The Bash rule of a role that has Bash: one rule for both platforms, with the weaker label (ROLE-06). */
const SANDBOX_RULE = 'Bash runs in the sandbox (hard on macOS, best-effort on Linux)'

/** The warning that leads the card of a role whose role.json sets bypassPermissions by hand (D-95). */
const BYPASS_RULE = 'WARNING: bypassPermissions is set in role.json: permission prompts are skipped'

/** The rule the card of an attended role carries. */
const ATTENDED_RULE = 'Attended: this role needs a person for framework steps that cannot run unattended'

/** The rule the card of a role without Bash carries on GSD: GSD workflows need Bash, so a person runs them (A1). */
const GSD_NO_BASH_RULE = 'Attended: GSD workflows need Bash; this role runs them through a person'

/** The note on every card when the setup scan could not see every MCP server (A4). */
const PARTIAL_MCP_RULE =
  'MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied'

/** The route rule of a merged scope (D-104): no --strict-mcp-config, so /fleet works; every MCP deny is best effort. */
const MERGED_ROUTE_RULE = 'MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)'

/** The rule on every card that the infra stays (D-77). */
const AVAILABLE_RULE = 'Autopilot, agent-fleet and the handoff skills are always available'

/**
 * The checks of the infra rule (D-112, D-77): the autopilot command, the two handoff skills and autopilot's three MCP
 * tools are in the startup inventory, in this order.
 */
const AVAILABLE_CHECKS: readonly ProbeCheck[] = [
  { kind: 'command-present', token: 'autopilot' },
  { kind: 'skill-present', token: 'create-handoff-doc' },
  { kind: 'skill-present', token: 'resume-handoff-doc' },
  { kind: 'tool-present', token: 'mcp__autopilot__restart_session' },
  { kind: 'tool-present', token: 'mcp__autopilot__wait_for' },
  { kind: 'tool-present', token: 'mcp__autopilot__queue_question' },
]

/** The MCP deny rule on the merged route: the names only; what stays reachable is the next rule (D-124, A1). */
function mergedDenied(names: string): string {
  return `Scanned MCP servers not given are denied: ${names}`
}

/** The rule right after a merged deny rule: denied servers lose their tools and are denied whole (D-124, #39). */
const MERGED_REACHABLE_RULE =
  'Denied servers: tools removed and the whole server denied ' +
  '(deniedMcpServers; best-effort)'

/** The rule that names the code dirs that are the role's own folders, which no deny ever covers (B7). */
function ownRule(dirs: string): string {
  return `Reads and edits under ${dirs} are never denied (own folders)`
}

/** The rule that names the code dirs the committed template leaves alone because their names match the role's own. */
function skippedRule(dirs: string): string {
  return (
    `Reads and edits under ${dirs} are not denied in the committed template: ` +
    "those names match the role's own folders at any depth (exact denies are rendered at launch)"
  )
}

/** The last line of the card of a role: its memory folder pattern and where the config dir in it comes from. */
function memoryLine(id: string): string {
  return (
    `  memory: <config dir>/cadre/<repo>-<hash8>/${id}/ ` +
    '(rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)'
  )
}

/** The launcher flags of the PM role on the merged route: model opus, effort medium, mode auto. */
const PM_FLAGS: readonly string[] = [
  '--setting-sources',
  'project',
  '--settings',
  '.cadre/pm/.runtime/settings.json',
  '--append-system-prompt-file',
  '.cadre/pm/ROLE.md',
  '--name',
  'cadre-pm',
  '--model',
  'opus',
  '--effort',
  'medium',
  '--permission-mode',
  'auto',
  '--add-dir',
  '.cadre/pm/.runtime/overlay',
  '--mcp-config',
  '.cadre/pm/.runtime/mcp.json',
]

describe('compileScope', () => {
  test('the PM gets the infra plugins, no sandbox, and a sorted deny list of Bash, code dirs, secrets and MCP', () => {
    const ctx = context({ setup: emptySetupScan({ mcp: [session('jira')] }), codeDirs: ['cadre'] })
    const scope = compileScope(templateRole('pm'), ctx)

    expect(scope.settings).toEqual({
      enabledPlugins: { 'agent-fleet@local-mods': true, 'autopilot@local-mods': true, 'cadre@local-mods': true },
      permissions: {
        defaultMode: 'auto',
        deny: [
          'Bash',
          'Edit(./cadre/**)',
          'Read(./.env)',
          'Read(./.env.*)',
          'Read(./cadre/**)',
          'Read(~/.aws/**)',
          'Read(~/.ssh/**)',
          'mcp__jira',
        ],
      },
      sandbox: { enabled: false },
    })
  })

  test('the settings template holds only the known keys, with the plugin keys in sorted order', () => {
    const scope = compileScope(templateRole('pm'), context())

    expect(Object.keys(scope.settings)).toEqual(['enabledPlugins', 'permissions', 'sandbox'])
    expect(Object.keys(scope.settings.permissions)).toEqual(['defaultMode', 'deny'])
    expect(Object.keys(scope.settings.sandbox)).toEqual(['enabled'])
    expect(Object.keys(scope.settings.enabledPlugins)).toEqual([
      'agent-fleet@local-mods',
      'autopilot@local-mods',
      'cadre@local-mods',
    ])
    expect(JSON.stringify(scope.settings)).not.toMatch(/autoMemoryDirectory|statusLine|claudeMdExcludes|"env"|"hooks"/)
  })

  test('a PM given the jira server does not deny it and lists it in the MCP file', () => {
    const pm = templateRole('pm', { mcp: ['jira'] })
    const scope = compileScope(pm, context({ setup: emptySetupScan({ mcp: [session('jira')] }), codeDirs: ['cadre'] }))

    expect(scope.settings.permissions.deny).not.toContain('mcp__jira')
    expect(scope.mcp).toEqual({ schema: 1, servers: ['jira'] })
  })

  test('the autopilot server is never denied, whether or not the scan lists it', () => {
    const scanned = emptySetupScan({ mcp: [session('autopilot'), session('jira')] })
    const scope = compileScope(templateRole('pm'), context({ setup: scanned }))
    const deny = scope.settings.permissions.deny

    expect(deny).toContain('mcp__jira')
    expect(deny).not.toContain('mcp__autopilot')
    // The infra server is left out before the lint sees it, so the card has no refusal to report for it.
    expect(scope.card.rules.filter(candidate => candidate.text.includes('was not emitted'))).toEqual([])
    expect(scope.card.notGiven.mcp).toEqual(['jira'])
  })

  test('the MCP file and the deny list are sorted and once each', () => {
    const scanned = emptySetupScan({ mcp: [session('zeta'), session('alpha'), session('zeta'), session('mid')] })
    const role = templateRole('pm', { mcp: ['mid', 'beta', 'beta'] })
    const scope = compileScope(role, context({ setup: scanned }))

    expect(scope.mcp.servers).toEqual(['beta', 'mid'])
    expect(scope.settings.permissions.deny.filter(entry => entry.startsWith('mcp__'))).toEqual([
      'mcp__alpha',
      'mcp__zeta',
    ])
  })

  test('the flags are the launcher flags in order for the role id, model, effort and mode', () => {
    const scope = compileScope(templateRole('pm'), context())

    expect(scope.flags).toEqual(PM_FLAGS)
    expect(scope.flags).not.toContain('--strict-mcp-config')
    expect(scope.flags).not.toContain('--disable-slash-commands')
  })

  test('the flags follow the role: its id, model, effort and permission mode', () => {
    const be = templateRole('be', { model: 'sonnet', effort: 'high', permissionMode: 'acceptEdits' })
    const flags = compileScope(be, context()).flags

    expect(flags).toEqual([
      '--setting-sources',
      'project',
      '--settings',
      '.cadre/be/.runtime/settings.json',
      '--append-system-prompt-file',
      '.cadre/be/ROLE.md',
      '--name',
      'cadre-be',
      '--model',
      'sonnet',
      '--effort',
      'high',
      '--permission-mode',
      'acceptEdits',
      '--add-dir',
      '.cadre/be/.runtime/overlay',
      '--mcp-config',
      '.cadre/be/.runtime/mcp.json',
    ])
  })

  test('on the strict MCP route the last flag is --strict-mcp-config and the others are unchanged', () => {
    const flags = compileScope(templateRole('pm'), context({ mcpRoute: 'strict' })).flags

    expect(flags[flags.length - 1]).toBe('--strict-mcp-config')
    expect(flags.slice(0, -1)).toEqual(PM_FLAGS)
  })

  test('the overlay holds the handoff skills and the GSD start skills sorted, and the gsd agents of the setup', () => {
    const scanned = emptySetupScan({ agents: ['gsd-planner', 'my-agent', 'gsd-executor', 'gsd-planner'] })
    const scope = compileScope(templateRole('pm'), context({ setup: scanned }))

    expect(scope.overlay.skills).toEqual([
      'create-handoff-doc',
      'gsd-autonomous',
      'gsd-code-review',
      'gsd-discuss-phase',
      'gsd-execute-phase',
      'gsd-plan-phase',
      'gsd-validate-phase',
      'resume-handoff-doc',
    ])
    expect(scope.overlay.agents).toEqual(['gsd-executor', 'gsd-planner'])
  })

  test('a role with no MCP servers and no skills still has the infra plugins, the handoff and the start skills', () => {
    const scope = compileScope(templateRole('pm'), context())

    expect(Object.keys(scope.settings.enabledPlugins)).toHaveLength(3)
    expect(scope.overlay.skills).toContain('create-handoff-doc')
    expect(scope.overlay.skills).toContain('resume-handoff-doc')
    expect(scope.overlay.skills).toContain('gsd-plan-phase')
    expect(scope.mcp).toEqual({ schema: 1, servers: [] })
  })

  test('the overlay skills of the role are added sorted and once each', () => {
    const role = templateRole('pm', { skills: ['zeta-skill', 'alpha-skill', 'alpha-skill'] })
    const skills = compileScope(role, context({ framework: 'none' })).overlay.skills

    expect(skills).toEqual(['alpha-skill', 'create-handoff-doc', 'resume-handoff-doc', 'zeta-skill'])
  })

  test('the card starts with the plugin whitelist and says the PM has no Bash', () => {
    const rules = compileScope(templateRole('pm'), context()).card.rules

    expect(rules[0]).toEqual({ text: PLUGIN_RULE, enforcement: 'hard' })
    expect(rules.find(candidate => candidate.text === 'No Bash tool (denied)')).toEqual({
      text: 'No Bash tool (denied)',
      enforcement: 'hard',
      checks: [{ kind: 'tool-absent', token: 'Bash' }],
    })
  })

  test('the card names the memory folder pattern and the decision chain of the team', () => {
    const card = compileScope(templateRole('pm'), context({ roles: ['pm', 'tl'] })).card

    expect(card.memoryPattern).toBe('<config dir>/cadre/<repo>-<hash8>/pm/')
    expect(card.chain).toEqual(chainLines(['pm', 'tl']))
  })

  test('the card chain follows basedOn through the roles of the team', () => {
    const roles: readonly ChainRole[] = ['pm', { id: 'lead', basedOn: 'tl' }]
    const card = compileScope(templateRole('pm'), context({ roles })).card

    expect(card.chain).toEqual(chainLines(roles))
    expect(card.chain.some(line => line.includes('lead -> human'))).toBe(true)
  })

  test('the card carries the role, its framework and settings, and the MCP route', () => {
    const card = compileScope(templateRole('pm'), context({ isAttended: true, mcpRoute: 'strict' })).card

    expect(card.roleId).toBe('pm')
    expect(card.title).toBe('PM')
    expect(card.framework).toBe('gsd')
    expect(card.model).toBe('opus')
    expect(card.effort).toBe('medium')
    expect(card.permissionMode).toBe('auto')
    expect(card.isBypass).toBe(false)
    expect(card.isAttended).toBe(true)
    expect(card.mcpRoute).toBe('strict')
  })

  test('no part of the result holds an absolute user path', () => {
    const scanned = emptySetupScan({ mcp: [session('jira')], plugins: ['superpowers@claude-plugins-official'] })
    const scope = compileScope(templateRole('pm'), context({ setup: scanned, codeDirs: ['cadre', 'src'] }))

    expect(leaks(JSON.stringify(scope), ABSOLUTE_PATH_MARKERS)).toEqual([])
  })

  test('every call returns a fresh value and keeps no state', () => {
    const role = templateRole('pm')
    const ctx = context({ setup: emptySetupScan({ mcp: [session('jira')] }), codeDirs: ['cadre'] })
    const first = compileScope(role, ctx)
    const second = compileScope(role, ctx)

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(second.flags).not.toBe(first.flags)
    expect(second.settings.permissions.deny).not.toBe(first.settings.permissions.deny)
    expect(second.overlay.skills).not.toBe(first.overlay.skills)
    expect(second.card.rules).not.toBe(first.card.rules)
  })
})

/** The any-depth code-dir entries of a deny list: Read and Edit rules on a repo-relative folder. */
function codeDirDenies(deny: readonly string[]): string[] {
  return deny.filter(entry => /^(Read|Edit)\(\.\/.+\/\*\*\)$/.test(entry))
}

/** The literal segments of a repo-relative deny entry such as `Read(./a/b/**)`, `*` and `**` dropped; [] for others. */
function denySegments(entry: string): string[] {
  const argument = /^[A-Za-z]+\((\.\/.*)\)$/.exec(entry)?.[1]
  if (argument === undefined) return []

  return argument
    .slice(2)
    .split('/')
    .filter(segment => segment !== '' && segment !== '*' && segment !== '**')
}

/** The folder names that make up the own paths of a role id, once each. */
function ownSegments(id: string): string[] {
  const segments = roleOwnPaths(id)
    .flatMap(path => path.split('/'))
    .filter(segment => segment !== '')

  return Array.from(new Set(segments))
}

/** Whether a `Tool(./a/b/**)` entry matches the path: the folders a/b appear anywhere in it, with a file below. */
function matchesAtAnyDepth(entry: string, path: string): boolean {
  if (!entry.endsWith('/**)')) return false
  const folders = denySegments(entry)
  if (folders.length === 0) return false
  const parts = path.split('/')
  for (let start = 0; start + folders.length < parts.length; start++) {
    if (folders.every((folder, offset) => parts[start + offset] === folder)) return true
  }

  return false
}

/** The paths a PM must keep reading and writing: its own folder, its handoff folder and GSD's planning folder. */
const PM_OWN_FILES: readonly string[] = [
  '.cadre/pm/ROLE.md',
  'thoughts/shared/handoffs/pm/x.md',
  '.planning/STATE.md',
]

/** The code dirs of the over-blocking cases: five that match a folder of the PM, and three ordinary ones. */
const OVERLAPPING_DIRS: readonly string[] = [
  '.cadre',
  '.planning',
  'cadre',
  'docs',
  'handoffs',
  'pm',
  'shared',
  'src',
  'thoughts',
]

describe('scope rules', () => {
  test('a role with Bash has no Bash deny and no code-dir deny, and its Bash runs in the sandbox', () => {
    const scope = compileScope(templateRole('be'), context({ codeDirs: ['cadre', 'src'] }))

    expect(scope.settings.permissions.deny).toEqual([
      'Read(./.env)',
      'Read(./.env.*)',
      'Read(~/.aws/**)',
      'Read(~/.ssh/**)',
    ])
    expect(scope.settings.sandbox).toEqual({ enabled: true })
    expect(ruleOf(scope, SANDBOX_RULE)).toEqual({ text: SANDBOX_RULE, enforcement: 'best-effort' })
    expect(ruleOf(scope, 'No Bash tool (denied)')).toBeUndefined()
    expect(scope.card.rules.filter(candidate => candidate.text.startsWith('Reads and edits'))).toEqual([])
  })

  test('the platform-dependent sandbox is one rule with the weaker label, and only a role with Bash has it', () => {
    const be = compileScope(templateRole('be'), context())
    const pm = compileScope(templateRole('pm'), context())
    const named = be.card.rules.filter(candidate => candidate.text.includes('macOS'))

    expect(named).toEqual([{ text: SANDBOX_RULE, enforcement: 'best-effort' }])
    expect(named.every(candidate => candidate.text.includes('Linux'))).toBe(true)
    expect(pm.card.rules.filter(candidate => candidate.text.includes('macOS'))).toEqual([])
  })

  test('a superpowers role enables every scanned superpowers plugin key and no other plugin', () => {
    const scanned = emptySetupScan({
      plugins: ['superpowers@my-market', 'codex@openai-codex', 'superpowers@claude-plugins-official'],
    })
    const scope = compileScope(templateRole('be'), context({ framework: 'superpowers', setup: scanned }))

    expect(pluginKeys(scope)).toEqual([
      'agent-fleet@local-mods',
      'autopilot@local-mods',
      'cadre@local-mods',
      'superpowers@claude-plugins-official',
      'superpowers@my-market',
    ])
    expect(scope.overlay.skills).toEqual(['create-handoff-doc', 'resume-handoff-doc'])
  })

  test('a role given a plugin skill enables that plugin and keeps the skill off the overlay', () => {
    const scanned = emptySetupScan({
      plugins: ['codex@openai-codex', 'superpowers@claude-plugins-official'],
      skills: [skillRef('codex:rescue', 'codex')],
    })
    const role = templateRole('be', { skills: ['codex:rescue'] })
    const scope = compileScope(role, context({ framework: 'none', setup: scanned }))

    expect(pluginKeys(scope)).toEqual([
      'agent-fleet@local-mods',
      'autopilot@local-mods',
      'cadre@local-mods',
      'codex@openai-codex',
    ])
    expect(scope.card.skills).toEqual(['codex:rescue'])
    expect(scope.overlay.skills).not.toContain('codex:rescue')
  })

  test('a role given a user skill links it into the overlay and enables no plugin', () => {
    const scanned = emptySetupScan({ plugins: ['codex@openai-codex'] })
    const role = templateRole('be', { skills: ['my-skill'] })
    const scope = compileScope(role, context({ framework: 'none', setup: scanned }))

    expect(scope.overlay.skills).toEqual(['create-handoff-doc', 'my-skill', 'resume-handoff-doc'])
    expect(pluginKeys(scope)).toHaveLength(3)
    expect(scope.card.skills).toEqual(['my-skill'])
  })

  test('a role with no MCP servers and no skills still has the infra, handoff and start skills', () => {
    const scanned = emptySetupScan({ plugins: ['superpowers@claude-plugins-official'] })
    const frameworks: readonly FrameworkId[] = ['gsd', 'superpowers', 'none']
    const missing: string[] = []
    for (const framework of frameworks) {
      const scope = compileScope(templateRole('qa'), context({ framework, setup: scanned }))
      for (const name of [...INFRA_SKILLS, ...FRAMEWORK_START_SKILLS[framework]]) {
        const plugin = name.slice(0, Math.max(name.indexOf(':'), 0))
        const isPresent =
          plugin === ''
            ? scope.overlay.skills.includes(name)
            : pluginKeys(scope).some(key => key.startsWith(`${plugin}@`))
        if (!isPresent) missing.push(`${framework}: ${name}`)
      }
      for (const key of ['agent-fleet@local-mods', 'autopilot@local-mods', 'cadre@local-mods']) {
        if (scope.settings.enabledPlugins[key] !== true) missing.push(`${framework}: ${key}`)
      }
    }

    expect(missing).toEqual([])
  })

  test('the card lists the scanned skills a role does not have; its handoff and start skills count as given', () => {
    const scanned = emptySetupScan({
      skills: [
        skillRef('my-skill'),
        skillRef('other-skill'),
        skillRef('gsd-plan-phase'),
        skillRef('gsd-health'),
        skillRef('create-handoff-doc'),
        skillRef('resume-handoff-doc'),
        skillRef('codex:rescue', 'codex'),
        skillRef('other-skill', 'extra'),
      ],
    })
    const role = templateRole('pm', { skills: ['my-skill'] })

    expect(compileScope(role, context({ setup: scanned })).card.notGiven.skills).toEqual([
      'codex:rescue',
      'gsd-health',
      'other-skill',
    ])
  })

  test('the skills of an enabled plugin, the infra plugins included, are not listed as not given', () => {
    const scanned = emptySetupScan({
      plugins: ['superpowers@claude-plugins-official'],
      skills: [
        skillRef('autopilot', 'autopilot'),
        skillRef('fleet', 'agent-fleet'),
        skillRef('superpowers:systematic-debugging', 'superpowers'),
        skillRef('codex:rescue', 'codex'),
      ],
    })
    const forSuperpowers = compileScope(templateRole('be'), context({ framework: 'superpowers', setup: scanned }))
    const forGsd = compileScope(templateRole('be'), context({ setup: scanned }))

    expect(forSuperpowers.card.notGiven.skills).toEqual(['codex:rescue'])
    expect(forGsd.card.notGiven.skills).toEqual(['codex:rescue', 'superpowers:systematic-debugging'])
  })

  test('the card lists the scanned MCP servers a role was not given, without autopilot, sorted and once each', () => {
    const scanned = emptySetupScan({
      mcp: [session('zeta'), session('autopilot'), session('jira'), session('zeta'), session('alpha')],
    })
    const card = compileScope(templateRole('pm', { mcp: ['jira'] }), context({ setup: scanned })).card

    expect(card.mcp).toEqual(['jira'])
    expect(card.notGiven.mcp).toEqual(['alpha', 'zeta'])
  })

  test('the card lists the hooks the role loads and the other scanned hook scripts, sorted', () => {
    const scanned = emptySetupScan({
      hooks: [
        hook('gsd-statusline.js'),
        hook('gsd-secret-read-guard.js'),
        hook('gsd-context-monitor.js'),
        hook('gsd-statusline.js'),
      ],
    })
    const role = templateRole('pm', { carry: { ...EMPTY_CARRY, hooks: ['gsd-secret-read-guard.js'] } })
    const card = compileScope(role, context({ setup: scanned })).card

    expect(card.hooks.loaded).toEqual(['gsd-secret-read-guard.js'])
    expect(card.hooks.loadedByProject).toEqual([])
    expect(card.hooks.notLoaded).toEqual(['gsd-context-monitor.js', 'gsd-statusline.js'])
  })

  test('the card splits the scanned hooks by source: carried, loaded by project settings, not loaded (A1)', () => {
    const scanned = emptySetupScan({
      hooks: [
        hook('gsd-secret-read-guard.js'),
        hook('user-only.sh'),
        hook('project-only.sh', 'project'),
        hook('local-only.sh', 'local'),
        hook('both.sh'),
        hook('both.sh', 'project'),
      ],
    })
    const role = templateRole('pm', { carry: { ...EMPTY_CARRY, hooks: ['gsd-secret-read-guard.js'] } })
    const card = compileScope(role, context({ setup: scanned })).card
    const lines = scopeCardLines(card)
    const at = lines.indexOf('  hooks loaded: gsd-secret-read-guard.js')

    expect(card.hooks).toEqual({
      loaded: ['gsd-secret-read-guard.js'],
      loadedByProject: ['both.sh', 'project-only.sh'],
      notLoaded: ['local-only.sh', 'user-only.sh'],
    })
    expect(lines.slice(at, at + 3)).toEqual([
      '  hooks loaded: gsd-secret-read-guard.js',
      '  hooks loaded by project settings: both.sh, project-only.sh',
      '  hooks not loaded: local-only.sh, user-only.sh',
    ])
  })

  test(
    'a context monitor registered in project settings gets a warning rule before the MCP route rule; ' +
      'one in user or local settings does not (A1, D-62)',
    () => {
      const inProject = emptySetupScan({
        hooks: [hook('gsd-context-monitor.js', 'project'), hook('gsd-context-monitor-v2.js', 'project')],
      })
      const elsewhere = emptySetupScan({
        hooks: [hook('gsd-context-monitor.js'), hook('gsd-context-monitor.js', 'local')],
      })
      const scope = compileScope(templateRole('pm'), context({ setup: inProject }))
      const quiet = compileScope(templateRole('pm'), context({ setup: elsewhere }))

      expect(scope.card.rules.slice(-4)).toEqual([
        { text: GSD_NO_BASH_RULE, enforcement: 'none' },
        {
          text:
            'WARNING: gsd-context-monitor-v2.js is registered in project settings and loads in every role; ' +
            'it conflicts with the autopilot handoff (D-62)',
          enforcement: 'none',
        },
        {
          text:
            'WARNING: gsd-context-monitor.js is registered in project settings and loads in every role; ' +
            'it conflicts with the autopilot handoff (D-62)',
          enforcement: 'none',
        },
        { text: MERGED_ROUTE_RULE, enforcement: 'none' },
      ])
      expect(quiet.card.rules.filter(item => item.text.includes('registered in project settings'))).toEqual([])
    },
  )

  test(
    'isContextMonitorScript is whether a script name starts with gsd-context-monitor, whatever its letter case (D-62)',
    () => {
      expect(isContextMonitorScript('gsd-context-monitor.js')).toBe(true)
      expect(isContextMonitorScript('GSD-Context-Monitor.JS')).toBe(true)
      expect(isContextMonitorScript('gsd-context-monitor-v2.js')).toBe(true)
      expect(isContextMonitorScript('gsd-statusline.js')).toBe(false)
      expect(isContextMonitorScript('my-gsd-context-monitor.js')).toBe(false)
      expect(isContextMonitorScript('')).toBe(false)
    },
  )

  test('a hand-set bypassPermissions leads the card with a warning and shows in the settings and the flags', () => {
    const scope = compileScope(templateRole('pm', { permissionMode: 'bypassPermissions' }), context())

    expect(scope.card.isBypass).toBe(true)
    expect(scope.card.rules[0]).toEqual({ text: BYPASS_RULE, enforcement: 'none' })
    expect(scope.settings.permissions.defaultMode).toBe('bypassPermissions')
    expect(scope.flags[scope.flags.indexOf('--permission-mode') + 1]).toBe('bypassPermissions')
    expect(ruleOf(scope, 'Permission mode: bypassPermissions')?.enforcement).toBe('hard')
  })

  test('a role in any other permission mode has no bypass warning', () => {
    const modes: readonly PermissionMode[] = ['acceptEdits', 'auto', 'manual', 'dontAsk', 'plan']
    const warned = modes.filter(permissionMode => {
      const scope = compileScope(templateRole('pm', { permissionMode }), context())

      return scope.card.isBypass || ruleOf(scope, BYPASS_RULE) !== undefined
    })

    expect(warned).toEqual([])
  })

  test('an attended role adds the attended rule, and an unattended role has none', () => {
    const attended = compileScope(templateRole('pm'), context({ isAttended: true }))
    const unattended = compileScope(templateRole('pm'), context({ isAttended: false }))

    expect(ruleOf(attended, ATTENDED_RULE)).toEqual({ text: ATTENDED_RULE, enforcement: 'none' })
    expect(ruleOf(unattended, ATTENDED_RULE)).toBeUndefined()
  })

  test('a role without Bash on GSD is attended and says a person runs its GSD workflows', () => {
    const scope = compileScope(templateRole('pm'), context({ framework: 'gsd', isAttended: false }))

    expect(scope.card.isAttended).toBe(true)
    expect(ruleOf(scope, GSD_NO_BASH_RULE)).toEqual({ text: GSD_NO_BASH_RULE, enforcement: 'none' })
    expect(ruleOf(scope, ATTENDED_RULE)).toBeUndefined()
    expect(scope.settings.permissions.deny).toContain('Bash')
    expect(scope.overlay.skills).toContain('gsd-autonomous')
  })

  test('a role without Bash on superpowers or the built-in loop, or one with Bash on GSD, is not attended', () => {
    const others: readonly FrameworkId[] = ['superpowers', 'none']
    const scopes = [
      ...others.map(framework => compileScope(templateRole('pm'), context({ framework }))),
      compileScope(templateRole('be'), context({ framework: 'gsd' })),
    ]

    expect(scopes.map(scope => scope.card.isAttended)).toEqual([false, false, false])
    expect(scopes.filter(scope => ruleOf(scope, GSD_NO_BASH_RULE) !== undefined)).toEqual([])
  })

  test('an attended role without Bash on GSD has the attended rule first, then the GSD rule', () => {
    const rules = compileScope(templateRole('pm'), context({ isAttended: true })).card.rules
    const attended = rules.filter(candidate => candidate.text.startsWith('Attended:'))

    expect(attended).toEqual([
      { text: ATTENDED_RULE, enforcement: 'none' },
      { text: GSD_NO_BASH_RULE, enforcement: 'none' },
    ])
  })

  test('an MCP server with a dot, a colon or another character is denied by its engine tool name', () => {
    const names = ['my.server', 'plugin:context7:context7', 'good-one_2']
    const scope = compileScope(templateRole('pm'), context({ setup: emptySetupScan({ mcp: names.map(session) }) }))
    const denied = mergedDenied('good-one_2, my.server, plugin:context7:context7')

    expect(scope.settings.permissions.deny.filter(entry => entry.startsWith('mcp__'))).toEqual([
      'mcp__good-one_2',
      'mcp__my_server',
      'mcp__plugin_context7_context7',
    ])
    expect(ruleOf(scope, denied)?.enforcement).toBe('best-effort')
    expect(scope.card.rules.filter(candidate => candidate.text.includes('is not denied'))).toEqual([])
  })

  test('a character outside letters, digits, _ and - becomes _ in the tool name, a hidden one included', () => {
    const scanned = emptySetupScan({ mcp: [session(`ev${BIDI_OVERRIDE}il`), session('a@b')] })
    const deny = compileScope(templateRole('pm'), context({ setup: scanned })).settings.permissions.deny

    expect(deny.filter(entry => entry.startsWith('mcp__'))).toEqual(['mcp__a_b', 'mcp__ev_il'])
  })

  test('a server whose tool name is that of a server the role has is not denied, and the card says so', () => {
    const scanned = emptySetupScan({ mcp: [session('my.server'), session('my_server'), session('jira')] })
    const forUnderscore = compileScope(templateRole('pm', { mcp: ['my_server'] }), context({ setup: scanned }))
    const forDot = compileScope(templateRole('pm', { mcp: ['my.server'] }), context({ setup: scanned }))
    const dotted = 'MCP server my.server shares its tool name with a server this role has and is not denied'
    const plain = 'MCP server my_server shares its tool name with a server this role has and is not denied'

    expect(forUnderscore.settings.permissions.deny.filter(entry => entry.startsWith('mcp__'))).toEqual(['mcp__jira'])
    expect(ruleOf(forUnderscore, dotted)).toEqual({ text: dotted, enforcement: 'none' })
    expect(ruleOf(forUnderscore, mergedDenied('jira'))?.enforcement).toBe('best-effort')
    expect(forDot.settings.permissions.deny.filter(entry => entry.startsWith('mcp__'))).toEqual(['mcp__jira'])
    expect(ruleOf(forDot, plain)).toEqual({ text: plain, enforcement: 'none' })
  })

  test('a deny the lint refuses is dropped and the card names it, so a bug cannot ship a broken deny', () => {
    const scanned = emptySetupScan({ mcp: [session('autopilot__wait_for'), session('jira')] })
    const scope = compileScope(templateRole('pm'), context({ setup: scanned }))
    const wait = 'mcp__autopilot__wait_for was not emitted: would block an infra tool (ISO-04)'

    expect(scope.settings.permissions.deny.filter(entry => entry.startsWith('mcp__'))).toEqual(['mcp__jira'])
    expect(ruleOf(scope, wait)).toEqual({ text: wait, enforcement: 'none' })
    expect(ruleOf(scope, mergedDenied('jira'))?.enforcement).toBe('best-effort')
  })

  test('a server whose name only starts like the autopilot server is denied, with no refusal on the card', () => {
    const scanned = emptySetupScan({ mcp: [session('a'), session('auto'), session('jira')] })
    const scope = compileScope(templateRole('pm'), context({ setup: scanned }))

    expect(scope.settings.permissions.deny.filter(entry => entry.startsWith('mcp__'))).toEqual([
      'mcp__a',
      'mcp__auto',
      'mcp__jira',
    ])
    expect(scope.card.rules.filter(candidate => candidate.text.includes('was not emitted'))).toEqual([])
    expect(ruleOf(scope, mergedDenied('a, auto, jira'))?.enforcement).toBe('best-effort')
  })

  test('every MCP server given leaves nothing to deny, and the rule says so', () => {
    const scanned = emptySetupScan({ mcp: [session('jira'), session('autopilot')] })
    const scope = compileScope(templateRole('pm', { mcp: ['jira'] }), context({ setup: scanned }))

    expect(scope.settings.permissions.deny.filter(entry => entry.startsWith('mcp__'))).toEqual([])
    expect(ruleOf(scope, 'No other scanned MCP servers to deny')).toEqual({
      text: 'No other scanned MCP servers to deny',
      enforcement: 'best-effort',
    })
  })

  test('the MCP deny rule is hard on the strict route and best effort on the merged one, with or without names', () => {
    const scanned = emptySetupScan({ mcp: [session('jira')] })
    const denied = 'Scanned MCP servers not given are denied: jira'
    const nothing = 'No other scanned MCP servers to deny'
    const labelOf = (role: RoleSpec, mcpRoute: McpRoute, text: string): string | undefined =>
      ruleOf(compileScope(role, context({ setup: scanned, mcpRoute })), text)?.enforcement

    expect(labelOf(templateRole('pm'), 'strict', denied)).toBe('hard')
    expect(labelOf(templateRole('pm'), 'merged', mergedDenied('jira'))).toBe('best-effort')
    expect(labelOf(templateRole('pm', { mcp: ['jira'] }), 'strict', nothing)).toBe('hard')
    expect(labelOf(templateRole('pm', { mcp: ['jira'] }), 'merged', nothing)).toBe('best-effort')
  })

  test('a partial MCP scan adds a none rule after the MCP rules, and a full scan adds none', () => {
    const partial = compileScope(templateRole('pm'), context({ setup: emptySetupScan({ isMcpPartial: true }) }))
    const full = compileScope(templateRole('pm'), context())
    const texts = partial.card.rules.map(candidate => candidate.text)

    expect(ruleOf(partial, PARTIAL_MCP_RULE)).toEqual({ text: PARTIAL_MCP_RULE, enforcement: 'none' })
    expect(texts.indexOf(PARTIAL_MCP_RULE)).toBe(texts.indexOf('No other scanned MCP servers to deny') + 1)
    expect(ruleOf(full, PARTIAL_MCP_RULE)).toBeUndefined()
  })

  test('roleOwnPaths gives the role folder, .planning and the handoff folder, sorted, as a fresh array', () => {
    expect(roleOwnPaths('pm')).toEqual(['.cadre/pm/', '.planning/', 'thoughts/shared/handoffs/pm/'])
    expect(roleOwnPaths('ops')).toEqual(['.cadre/ops/', '.planning/', 'thoughts/shared/handoffs/ops/'])
    expect(roleOwnPaths('pm')).not.toBe(roleOwnPaths('pm'))
  })

  test('a code dir named like a folder of the role gets no any-depth deny, the others get Read and Edit', () => {
    const scope = compileScope(templateRole('pm'), context({ codeDirs: OVERLAPPING_DIRS }))

    expect(codeDirDenies(scope.settings.permissions.deny)).toEqual([
      'Edit(./cadre/**)',
      'Edit(./docs/**)',
      'Edit(./src/**)',
      'Read(./cadre/**)',
      'Read(./docs/**)',
      'Read(./src/**)',
    ])
  })

  test('no deny of a role has a segment of its own folders, so those folders stay readable at any depth', () => {
    expect(ownSegments('pm')).toEqual(['.cadre', 'pm', '.planning', 'thoughts', 'shared', 'handoffs'])
    const frameworks: readonly FrameworkId[] = ['gsd', 'superpowers', 'none']
    const own = ownSegments('pm')
    const problems: string[] = []
    for (const framework of frameworks) {
      const scope = compileScope(templateRole('pm'), context({ framework, codeDirs: OVERLAPPING_DIRS }))
      for (const entry of scope.settings.permissions.deny) {
        for (const segment of denySegments(entry)) {
          if (own.includes(segment)) problems.push(`${framework}: ${entry} has the segment ${segment}`)
        }
        for (const path of PM_OWN_FILES) {
          if (matchesAtAnyDepth(entry, path)) problems.push(`${framework}: ${entry} matches ${path}`)
        }
      }
    }

    expect(problems).toEqual([])
  })

  test('the any-depth matcher of these tests is not vacuous: it matches a deny on a folder of the role', () => {
    expect(matchesAtAnyDepth('Read(./pm/**)', '.cadre/pm/ROLE.md')).toBe(true)
    expect(matchesAtAnyDepth('Edit(./thoughts/**)', 'thoughts/shared/handoffs/pm/x.md')).toBe(true)
    expect(matchesAtAnyDepth('Read(./.planning/**)', '.planning/STATE.md')).toBe(true)
    expect(matchesAtAnyDepth('Read(./src/**)', 'docs/src/a.ts')).toBe(true)
    expect(matchesAtAnyDepth('Read(./src/**)', '.cadre/pm/ROLE.md')).toBe(false)
    expect(matchesAtAnyDepth('Read(./.env)', '.cadre/pm/ROLE.md')).toBe(false)
    expect(matchesAtAnyDepth('Read(~/.aws/**)', '.cadre/pm/ROLE.md')).toBe(false)
  })

  test('the own folders are those of the role id: a custom role skips its own id, not another role', () => {
    const ops = templateRole('pm', { id: 'ops', title: 'Ops', basedOn: null })
    const scope = compileScope(ops, context({ codeDirs: ['ops', 'pm', 'src'] }))

    expect(codeDirDenies(scope.settings.permissions.deny)).toEqual([
      'Edit(./pm/**)',
      'Edit(./src/**)',
      'Read(./pm/**)',
      'Read(./src/**)',
    ])
    expect(ruleOf(scope, skippedRule('ops'))?.enforcement).toBe('best-effort')
  })

  test('skipped dirs add one card rule naming them sorted, and the rule is absent when no dir is skipped', () => {
    const dirs = ['thoughts', 'cadre', '.cadre', 'pm', 'handoffs', '.planning', 'shared', 'src']
    const skipped = compileScope(templateRole('pm'), context({ codeDirs: dirs }))
    const none = compileScope(templateRole('pm'), context({ codeDirs: ['cadre', 'src'] }))
    const text = skippedRule('handoffs, pm, shared')
    const isSkipRule = (candidate: ScopeRule): boolean => candidate.text.includes('not denied in the committed')

    expect(ruleOf(skipped, text)).toEqual({ text, enforcement: 'best-effort' })
    expect(ruleOf(skipped, ownRule('.cadre, .planning, thoughts'))?.enforcement).toBe('none')
    expect(skipped.card.rules.filter(isSkipRule)).toHaveLength(1)
    expect(none.card.rules.filter(isSkipRule)).toEqual([])
    expect(none.card.rules.filter(candidate => candidate.text.endsWith('(own folders)'))).toEqual([])
  })

  test('a code dir whose name differs only in case from a folder of the role is skipped too', () => {
    const scope = compileScope(templateRole('pm'), context({ codeDirs: ['PM', 'Thoughts', 'src'] }))

    expect(codeDirDenies(scope.settings.permissions.deny)).toEqual(['Edit(./src/**)', 'Read(./src/**)'])
    expect(ruleOf(scope, skippedRule('PM'))?.enforcement).toBe('best-effort')
    expect(ruleOf(scope, ownRule('Thoughts'))?.enforcement).toBe('none')
  })

  test('own folders are never denied and say so, and only the other skipped dirs wait for the launch render', () => {
    const scope = compileScope(templateRole('pm'), context({ codeDirs: ['thoughts', '.planning', 'shared'] }))
    const own = ownRule('.planning, thoughts')
    const launch = skippedRule('shared')
    const texts = scope.card.rules.map(candidate => candidate.text)

    expect(ruleOf(scope, own)).toEqual({ text: own, enforcement: 'none' })
    expect(ruleOf(scope, launch)).toEqual({ text: launch, enforcement: 'best-effort' })
    expect(texts.indexOf(own) + 1).toBe(texts.indexOf(launch))
  })

  test('a code dir with an unusual name is not denied and the card says so', () => {
    const dirs = ['*', 'a b', '..', 'x)', 'src', `ev${BIDI_OVERRIDE}il`]
    const scope = compileScope(templateRole('pm'), context({ codeDirs: dirs }))
    const absent = ['*', 'a b', '..', 'x)', 'evil'].filter(name => {
      const text = `Code dir ${name} has an unusual name and is not denied`

      return ruleOf(scope, text)?.enforcement !== 'none'
    })

    expect(codeDirDenies(scope.settings.permissions.deny)).toEqual(['Edit(./src/**)', 'Read(./src/**)'])
    expect(absent).toEqual([])
  })

  test('the label of every rule is fixed: only what the engine enforces is hard, a pattern is best effort', () => {
    const scanned = emptySetupScan({ mcp: [session('jira'), session('my.server'), session('autopilot__wait_for')] })
    const role = templateRole('pm', { permissionMode: 'bypassPermissions' })
    const ctx = context({ isAttended: true, mcpRoute: 'strict', setup: scanned, codeDirs: ['cadre', 'pm', '*'] })

    expect(compileScope(role, ctx).card.rules).toEqual([
      { text: BYPASS_RULE, enforcement: 'none' },
      { text: PLUGIN_RULE, enforcement: 'hard' },
      { text: 'No Bash tool (denied)', enforcement: 'hard', checks: [{ kind: 'tool-absent', token: 'Bash' }] },
      { text: 'Reads and edits under cadre are denied; the patterns match at any depth', enforcement: 'best-effort' },
      { text: skippedRule('pm'), enforcement: 'best-effort' },
      { text: 'Code dir * has an unusual name and is not denied', enforcement: 'none' },
      { text: 'Reads of .env, .env.*, ~/.ssh and ~/.aws are denied', enforcement: 'best-effort' },
      {
        text: 'Scanned MCP servers not given are denied: jira, my.server',
        enforcement: 'hard',
        checks: [
          { kind: 'tool-prefix-absent', token: 'mcp__jira__' },
          { kind: 'tool-prefix-absent', token: 'mcp__my_server__' },
        ],
      },
      {
        text: 'mcp__autopilot__wait_for was not emitted: would block an infra tool (ISO-04)',
        enforcement: 'none',
      },
      { text: 'Skills: only the listed skills are linked', enforcement: 'best-effort' },
      { text: AVAILABLE_RULE, enforcement: 'hard', checks: AVAILABLE_CHECKS },
      {
        text: 'Permission mode: bypassPermissions',
        enforcement: 'hard',
        checks: [{ kind: 'permission-mode', token: 'bypassPermissions' }],
      },
      { text: ATTENDED_RULE, enforcement: 'none' },
      { text: GSD_NO_BASH_RULE, enforcement: 'none' },
      { text: 'MCP route: strict (--strict-mcp-config)', enforcement: 'none' },
    ])
  })

  test('a role with Bash has the labels of its rules fixed too', () => {
    const scanned = emptySetupScan({ mcp: [session('jira')] })
    const scope = compileScope(templateRole('be'), context({ setup: scanned, codeDirs: ['src'] }))

    expect(scope.card.rules).toEqual([
      { text: PLUGIN_RULE, enforcement: 'hard' },
      { text: SANDBOX_RULE, enforcement: 'best-effort' },
      { text: 'Reads of .env, .env.*, ~/.ssh and ~/.aws are denied', enforcement: 'best-effort' },
      {
        text: mergedDenied('jira'),
        enforcement: 'best-effort',
        checks: [{ kind: 'tool-prefix-absent', token: 'mcp__jira__' }],
      },
      { text: MERGED_REACHABLE_RULE, enforcement: 'best-effort' },
      { text: 'Skills: only the listed skills are linked', enforcement: 'best-effort' },
      { text: AVAILABLE_RULE, enforcement: 'hard', checks: AVAILABLE_CHECKS },
      { text: 'Permission mode: auto', enforcement: 'hard', checks: [{ kind: 'permission-mode', token: 'auto' }] },
      { text: MERGED_ROUTE_RULE, enforcement: 'none' },
    ])
  })
})

/** Names that sort in their own order: `${prefix}00`, `${prefix}01` and on, `count` of them. */
function numbered(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(2, '0')}`)
}

describe('card rule lists', () => {
  test('the MCP deny rule names 12 servers and then counts the rest', () => {
    const names = numbered('mcp-', 15)
    const scope = compileScope(templateRole('pm'), context({ setup: emptySetupScan({ mcp: names.map(session) }) }))
    const text = mergedDenied(`${names.slice(0, 12).join(', ')}, +3 more`)

    expect(ruleOf(scope, text)?.enforcement).toBe('best-effort')
    expect(scope.settings.permissions.deny.filter(entry => entry.startsWith('mcp__'))).toHaveLength(15)
  })

  test('the D-124 sentence keeps its own card line however long the denied list is (A1)', () => {
    const scanned = emptySetupScan({ mcp: numbered('claude_ai_connector_', 15).map(session) })
    const lines = scopeCardLines(compileScope(templateRole('pm'), context({ setup: scanned })).card)
    const listLine = lines.find(line => line.startsWith('    [best-effort] Scanned MCP servers not given are denied: '))

    expect(lines.filter(line => line.endsWith('(deniedMcpServers; best-effort)'))).toEqual([
      `    [best-effort] ${MERGED_REACHABLE_RULE}`,
    ])
    expect(listLine?.endsWith('…')).toBe(true)
  })

  test('the MCP deny rule shows a scanned name cleaned', () => {
    const scanned = emptySetupScan({ mcp: [session(`ev${BIDI_OVERRIDE}il`)] })
    const scope = compileScope(templateRole('pm'), context({ setup: scanned }))

    expect(ruleOf(scope, mergedDenied('evil'))?.enforcement).toBe('best-effort')
  })

  test('a long code dir name is capped in the denied-dirs rule, so the card line keeps its fixed tail', () => {
    const dir = 'd'.repeat(300)
    const scope = compileScope(templateRole('pm'), context({ codeDirs: [dir] }))
    const text = `Reads and edits under ${'d'.repeat(109)}… are denied; the patterns match at any depth`

    expect(ruleOf(scope, text)?.enforcement).toBe('best-effort')
    expect(scopeCardLines(scope.card)).toContain(`    [best-effort] ${text}`)
    expect(scope.settings.permissions.deny).toContain(`Read(./${dir}/**)`)
  })

  test('the plugins rule names 12 plugin keys and then counts the rest', () => {
    const plugins = numbered('p', 12)
    const scanned = emptySetupScan({ plugins: plugins.map(name => `${name}@m`) })
    const role = templateRole('pm', { skills: plugins.map(name => `${name}:s`) })
    const scope = compileScope(role, context({ setup: scanned }))
    const shownKeys = [
      'agent-fleet@local-mods',
      'autopilot@local-mods',
      'cadre@local-mods',
      ...plugins.slice(0, 9).map(name => `${name}@m`),
    ]
    const text = `Plugins: only ${shownKeys.join(', ')}, +3 more load (--setting-sources project whitelist)`

    expect(Object.keys(scope.settings.enabledPlugins)).toHaveLength(15)
    expect(ruleOf(scope, text)?.enforcement).toBe('hard')
  })
})

describe('isSafeDir', () => {
  test('a plain folder name is safe, a dot folder included; dot, dot-dot, a space and a glob character are not', () => {
    expect(['src', 'my-app_2', '.cadre'].filter(name => !isSafeDir(name))).toEqual([])
    expect(['.', '..', 'a b', 'x*', 'x)', 'a/b', ''].filter(isSafeDir)).toEqual([])
  })
})

describe('lintDenyPattern', () => {
  test('a repo-relative, home-relative or bare pattern, Bash and an ordinary MCP server pass', () => {
    const passing = [
      'Read(./src/**)',
      'Edit(./cadre/**)',
      'Read(./.env.*)',
      'Read(~/.ssh/**)',
      'Read(src/**)',
      'Bash',
      'mcp__jira',
      'mcp__jira__*',
      'Skill(my-skill)',
      'Skill(gsd-*)',
    ]

    expect(passing.filter(pattern => lintDenyPattern(pattern) !== null)).toEqual([])
  })

  test('a single leading slash is refused, because it matches nothing (P13)', () => {
    expect(lintDenyPattern('Read(/src/**)')).toBe('single leading / matches nothing (P13)')
    expect(lintDenyPattern('Edit(/x)')).toBe('single leading / matches nothing (P13)')
  })

  test('an absolute // pattern is refused, because it belongs only in .runtime (D-84)', () => {
    expect(lintDenyPattern('Read(//Users/x/**)')).toBe('absolute // patterns belong only in .runtime (D-84)')
    expect(lintDenyPattern('Edit(//repo/src/**)')).toBe('absolute // patterns belong only in .runtime (D-84)')
  })

  test('an infra tool or server, or a glob whose literal start begins one, is refused (ISO-04)', () => {
    const message = 'would block an infra tool (ISO-04)'
    const refused = [
      'mcp__*',
      'mcp__autopilot',
      'mcp__autopilot__*',
      'mcp__autopilot__wait_for',
      'mcp__autopilot__restart_session',
      'mcp__autopilot__queue_question',
      'mcp__au*',
      'mcp__a?topilot',
      'mcp__autopilot__wa[i]t_for',
      'Skill',
      'PushNotification',
    ]

    expect(refused.filter(pattern => lintDenyPattern(pattern) !== message)).toEqual([])
  })

  test('a literal pattern blocks only the infra name it equals or the server it names, not a longer one (B9)', () => {
    const passing = ['mcp__a', 'mcp__auto', 'mcp__autopilot_', 'mcp__autopilot__wait', 'mcp__autopilot__wait_fo']

    expect(passing.filter(pattern => lintDenyPattern(pattern) !== null)).toEqual([])
  })

  test('a rule on an infra tool with an argument, or on a handoff skill, is refused too', () => {
    const message = 'would block an infra tool (ISO-04)'
    const refused = [
      'PushNotification(*)',
      'mcp__autopilot__wait_for(*)',
      'Skill(create-handoff-doc)',
      'Skill(resume-handoff-doc)',
      'Skill(create-*)',
      'Skill(*)',
    ]

    expect(refused.filter(pattern => lintDenyPattern(pattern) !== message)).toEqual([])
  })

  test('a literal naming no infra tool is not refused: the empty pattern, mcp__ and an unclosed Skill( (B9)', () => {
    expect(['', 'mcp__', 'Skill('].filter(pattern => lintDenyPattern(pattern) !== null)).toEqual([])
  })

  test('a name that only starts like an infra tool is not refused', () => {
    expect(lintDenyPattern('mcp__autopilot2')).toBeNull()
    expect(lintDenyPattern('mcp__autopilot_x')).toBeNull()
    expect(lintDenyPattern('mcp__j')).toBeNull()
    expect(lintDenyPattern('Skills')).toBeNull()
  })
})

describe('scopeCardLines', () => {
  test('the card of a PM lists framework, skills, MCP, not given, hooks, rules, decisions and memory', () => {
    const scanned = emptySetupScan({
      mcp: [session('jira')],
      skills: [skillRef('my-skill')],
      hooks: [hook('gsd-context-monitor.js'), hook('gsd-secret-read-guard.js')],
    })
    const role = templateRole('pm', { carry: { ...EMPTY_CARRY, hooks: ['gsd-secret-read-guard.js'] } })
    const card = compileScope(role, context({ setup: scanned, codeDirs: ['cadre'] })).card

    expect(scopeCardLines(card)).toEqual([
      'Scope card: PM (pm)',
      '  framework: GSD; model: opus + medium; permission mode: auto',
      '  skills: none',
      '  MCP servers: none',
      '  not given skills: my-skill',
      '  not given MCP: jira',
      '  hooks loaded: gsd-secret-read-guard.js',
      '  hooks loaded by project settings: none',
      '  hooks not loaded: gsd-context-monitor.js',
      '  rules:',
      `    [hard] ${PLUGIN_RULE}`,
      '    [hard] No Bash tool (denied)',
      '    [best-effort] Reads and edits under cadre are denied; the patterns match at any depth',
      '    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied',
      `    [best-effort] ${mergedDenied('jira')}`,
      `    [best-effort] ${MERGED_REACHABLE_RULE}`,
      '    [best-effort] Skills: only the listed skills are linked',
      '    [hard] Autopilot, agent-fleet and the handoff skills are always available',
      '    [hard] Permission mode: auto',
      `    [none] ${GSD_NO_BASH_RULE}`,
      `    [none] ${MERGED_ROUTE_RULE}`,
      '  decisions:',
      ...chainLines(['pm', 'tl']).map(line => `    ${line}`),
      memoryLine('pm'),
    ])
  })

  test('the lists show the skills and MCP servers the role has', () => {
    const scanned = emptySetupScan({ mcp: [session('jira'), session('github')] })
    const role = templateRole('tl', { mcp: ['github', 'jira'], skills: ['my-skill', 'codex:rescue'] })
    const lines = scopeCardLines(compileScope(role, context({ setup: scanned })).card)

    expect(lines[0]).toBe('Scope card: Team Lead (tl)')
    expect(lines[2]).toBe('  skills: codex:rescue, my-skill')
    expect(lines[3]).toBe('  MCP servers: github, jira')
    expect(lines.slice(4, 6)).toEqual(['  not given skills: none', '  not given MCP: none'])
  })

  test('the framework line names GSD, superpowers or built-in, and the model, effort and mode of the role', () => {
    const role = templateRole('be', { model: 'sonnet', effort: 'high', permissionMode: 'acceptEdits' })
    const names: readonly [FrameworkId, string][] = [
      ['gsd', 'GSD'],
      ['superpowers', 'superpowers'],
      ['none', 'built-in'],
    ]
    const lines = names.map(([framework]) => scopeCardLines(compileScope(role, context({ framework })).card)[1])

    expect(lines).toEqual(
      names.map(([, name]) => `  framework: ${name}; model: sonnet + high; permission mode: acceptEdits`),
    )
  })

  test('a list longer than 12 names shows 12 and then how many more', () => {
    const names = Array.from({ length: 15 }, (_, index) => `skill-${String(index).padStart(2, '0')}`)
    const scanned = emptySetupScan({ skills: names.map(name => skillRef(name)) })
    const card = compileScope(templateRole('pm'), context({ setup: scanned })).card
    const line = scopeCardLines(card).find(candidate => candidate.startsWith('  not given skills:'))

    expect(line).toBe(`  not given skills: ${names.slice(0, 12).join(', ')}, +3 more`)
  })

  test('a not-given skills list cut at the line cap never hides the MCP servers not given (A4)', () => {
    const skills = numbered('a-skill-with-a-long-name-', 15).map(name => skillRef(name))
    const scanned = emptySetupScan({ skills, mcp: [session('jira')] })
    const lines = scopeCardLines(compileScope(templateRole('pm'), context({ setup: scanned })).card)
    const skillsLine = lines.find(line => line.startsWith('  not given skills: '))

    expect(skillsLine?.endsWith('…')).toBe(true)
    expect(lines).toContain('  not given MCP: jira')
  })

  test('a list of exactly 12 names shows all of them', () => {
    const names = Array.from({ length: 12 }, (_, index) => `skill-${String(index).padStart(2, '0')}`)
    const role = templateRole('pm', { skills: names })
    const lines = scopeCardLines(compileScope(role, context()).card)

    expect(lines[2]).toBe(`  skills: ${names.join(', ')}`)
  })

  test('a bypass card shows the warning as the first rule, labelled none', () => {
    const role = templateRole('pm', { permissionMode: 'bypassPermissions' })
    const lines = scopeCardLines(compileScope(role, context()).card)
    const first = lines.indexOf('  rules:') + 1

    expect(lines[first]).toBe(`    [none] ${BYPASS_RULE}`)
  })

  test('every line is cleaned: a hostile title cannot add a line or hide text', () => {
    const role = templateRole('pm', { title: `P${BIDI_OVERRIDE}M\nSecond line` })
    const lines = scopeCardLines(compileScope(role, context()).card)

    expect(lines[0]).toBe('Scope card: PMSecond line (pm)')
    expect(lines.filter(line => line.includes('\n'))).toEqual([])
    expect(leaks(lines.join('|'), [BIDI_OVERRIDE])).toEqual([])
  })

  test('a name from the scan is cleaned where it is shown', () => {
    const scanned = emptySetupScan({ mcp: [session(`ev${BIDI_OVERRIDE}il`)] })
    const lines = scopeCardLines(compileScope(templateRole('pm'), context({ setup: scanned })).card)

    expect(lines.filter(line => line.startsWith('  not given'))).toEqual([
      '  not given skills: none',
      '  not given MCP: evil',
    ])
    expect(leaks(lines.join('|'), [BIDI_OVERRIDE])).toEqual([])
  })

  test('a line longer than 240 code points is cut with an ellipsis', () => {
    const card = compileScope(templateRole('pm'), context()).card
    const long: ScopeRule = { text: 'x'.repeat(300), enforcement: 'none' }
    const line = scopeCardLines({ ...card, rules: [long] }).find(candidate => candidate.startsWith('    [none] x'))

    expect(Array.from(line ?? '')).toHaveLength(240)
    expect(line?.endsWith('…')).toBe(true)
  })

  test('the chain lines and the memory line come from the card', () => {
    const card = compileScope(templateRole('be', { id: 'api' }), context({ roles: ['pm', 'api'] })).card
    const lines = scopeCardLines(card)
    const decisions = lines.indexOf('  decisions:')

    expect(lines.slice(decisions + 1, decisions + 1 + card.chain.length)).toEqual(card.chain.map(line => `    ${line}`))
    expect(lines[lines.length - 1]).toBe(memoryLine('api'))
  })
})

/** What the matrix scans: the superpowers and codex plugins, user and plugin skills, five MCP servers (one infra). */
const MATRIX_SETUP: SetupScan = emptySetupScan({
  plugins: ['superpowers@claude-plugins-official', 'codex@openai-codex'],
  skills: [
    skillRef('my-skill'),
    skillRef('gsd-health'),
    skillRef('gsd-plan-phase'),
    skillRef('create-handoff-doc'),
    skillRef('resume-handoff-doc'),
    skillRef('codex:rescue', 'codex'),
    skillRef('superpowers:brainstorming', 'superpowers'),
    skillRef('autopilot', 'autopilot'),
  ],
  mcp: [session('jira'), session('playwright'), session('github'), session('autopilot'), session('sentry')],
  agents: ['gsd-planner', 'gsd-executor', 'my-agent'],
  hooks: [hook('gsd-secret-read-guard.js'), hook('gsd-context-monitor.js')],
})

/** The six template roles, a custom role with no base, and a custom role with no base and no Bash. */
const MATRIX_ROLES: readonly RoleSpec[] = [
  ...ROLE_TEMPLATE.map(row => roleFromTemplate(row)),
  templateRole('tl', { id: 'ops', title: 'Ops', basedOn: null }),
  templateRole('pm', { id: 'auditor', title: 'Auditor', basedOn: null }),
]

/** The ways a role may be assigned names: nothing; every scanned MCP server and skill; one plugin skill only. */
const ASSIGNMENTS: readonly (readonly [string, (role: RoleSpec) => RoleSpec])[] = [
  ['nothing', role => role],
  [
    'everything',
    role => ({
      ...role,
      mcp: MATRIX_SETUP.mcp.map(ref => ref.name),
      skills: MATRIX_SETUP.skills.map(item => item.name),
    }),
  ],
  ['a plugin skill', role => ({ ...role, skills: ['codex:rescue'] })],
]

/** The scope of a role in a framework, with the matrix setup and the overlapping code dirs. */
function matrixScope(role: RoleSpec, framework: FrameworkId): CompiledScope {
  const ctx = context({ framework, setup: MATRIX_SETUP, codeDirs: OVERLAPPING_DIRS, roles: MATRIX_ROLES })

  return compileScope(role, ctx)
}

/** The scope with one more deny entry; the compiled value is never changed. */
function withDeny(scope: CompiledScope, entry: string): CompiledScope {
  const permissions = { ...scope.settings.permissions, deny: [...scope.settings.permissions.deny, entry] }

  return { ...scope, settings: { ...scope.settings, permissions } }
}

/** The scope with its deny entries in this order. */
function withDenyOrder(scope: CompiledScope, deny: readonly string[]): CompiledScope {
  return { ...scope, settings: { ...scope.settings, permissions: { ...scope.settings.permissions, deny } } }
}

/** The scope with one plugin key set to a value. */
function withPlugin(scope: CompiledScope, key: string, value: boolean): CompiledScope {
  const enabledPlugins = { ...scope.settings.enabledPlugins, [key]: value }

  return { ...scope, settings: { ...scope.settings, enabledPlugins } }
}

/** The scope without one plugin key. */
function withoutPlugin(scope: CompiledScope, key: string): CompiledScope {
  const kept = Object.entries(scope.settings.enabledPlugins).filter(([name]) => name !== key)

  return { ...scope, settings: { ...scope.settings, enabledPlugins: Object.fromEntries(kept) } }
}

/** The scope with one skill taken out of the overlay. */
function withoutOverlaySkill(scope: CompiledScope, name: string): CompiledScope {
  const skills = scope.overlay.skills.filter(candidate => candidate !== name)

  return { ...scope, overlay: { ...scope.overlay, skills } }
}

/** The scope with one more launcher flag. */
function withFlag(scope: CompiledScope, flag: string): CompiledScope {
  return { ...scope, flags: [...scope.flags, flag] }
}

/** The only keys the committed settings template may hold (D-84). */
const SETTINGS_KEYS: readonly string[] = ['enabledPlugins', 'permissions', 'sandbox']

/** The problems of one scope: an infra violation, a lint failure, a stray settings key, or an own folder hidden. */
function scopeProblems(role: RoleSpec, framework: FrameworkId, scope: CompiledScope): string[] {
  const deny = scope.settings.permissions.deny
  const own = ownSegments(role.id)
  const ownFiles = [`.cadre/${role.id}/ROLE.md`, `thoughts/shared/handoffs/${role.id}/x.md`, '.planning/STATE.md']

  return [
    ...infraViolations(scope, framework),
    ...deny.filter(entry => lintDenyPattern(entry) !== null).map(entry => `${entry} fails the lint`),
    ...Object.keys(scope.settings)
      .filter(key => !SETTINGS_KEYS.includes(key))
      .map(key => `settings key ${key} is not in the template`),
    ...deny
      .flatMap(entry => denySegments(entry))
      .filter(segment => own.includes(segment))
      .map(segment => `deny segment ${segment} is one of the role's own folders`),
    ...ownFiles.flatMap(path =>
      deny.filter(entry => matchesAtAnyDepth(entry, path)).map(entry => `${entry} matches ${path}`),
    ),
  ]
}

/** Every problem the ISO-04 properties find in the matrix, each with the combination that has it. */
function matrixProblems(): string[] {
  const problems: string[] = []
  for (const framework of FRAMEWORKS) {
    for (const base of MATRIX_ROLES) {
      for (const [label, assign] of ASSIGNMENTS) {
        const role = assign(base)
        const where = `${framework} / ${role.id} / ${label}`
        const found = scopeProblems(role, framework, matrixScope(role, framework))
        problems.push(...found.map(problem => `${where}: ${problem}`))
      }
    }
  }

  return problems
}

describe('ISO-04', () => {
  test('no generated scope blocks autopilot, fleet or the handoff skills over the whole matrix', () => {
    expect(matrixProblems()).toEqual([])
  })

  test('the matrix is not empty: eight roles, three frameworks and three assignment sets', () => {
    expect(MATRIX_ROLES).toHaveLength(8)
    expect(MATRIX_ROLES.filter(role => !role.hasBash).map(role => role.id)).toEqual(['pm', 'auditor'])
    expect(MATRIX_ROLES.filter(role => role.basedOn === null).map(role => role.id)).toEqual(['ops', 'auditor'])
    expect(FRAMEWORKS).toHaveLength(3)
    expect(ASSIGNMENTS.map(([label]) => label)).toEqual(['nothing', 'everything', 'a plugin skill'])
  })

  test('a role with zero assignments passes the checker in every framework', () => {
    const failing = FRAMEWORKS.filter(framework => {
      const scope = matrixScope(templateRole('pm'), framework)

      return infraViolations(scope, framework).length > 0
    })

    expect(failing).toEqual([])
  })

  test('the checker result does not depend on the order of the deny list', () => {
    const base = matrixScope(templateRole('pm'), 'gsd')
    const broken = withDeny(withDeny(withDeny(base, 'mcp__autopilot'), 'Skill'), 'Skill(resume-handoff-doc)')
    const deny = broken.settings.permissions.deny
    const reversed = withDenyOrder(broken, [...deny].reverse())

    expect(infraViolations(base, 'gsd')).toEqual([])
    expect(infraViolations(withDenyOrder(base, [...base.settings.permissions.deny].reverse()), 'gsd')).toEqual([])
    expect(infraViolations(broken, 'gsd')).not.toHaveLength(0)
    expect(infraViolations(reversed, 'gsd')).toEqual(infraViolations(broken, 'gsd'))
  })

  test('a deny that blocks nothing of the infra is not reported', () => {
    const base = matrixScope(templateRole('pm'), 'gsd')

    expect(infraViolations(withDeny(base, 'mcp__jira'), 'gsd')).toEqual([])
    expect(infraViolations(withDeny(base, 'Read(./secret/**)'), 'gsd')).toEqual([])
    expect(infraViolations(withDeny(base, 'Skill(my-skill)'), 'gsd')).toEqual([])
    expect(infraViolations(withDeny(base, 'mcp__a'), 'gsd')).toEqual([])
  })

  test('mutation: a deny of the autopilot server is caught and named', () => {
    const base = matrixScope(templateRole('pm'), 'gsd')

    expect(infraViolations(base, 'gsd')).toEqual([])
    expect(infraViolations(withDeny(base, 'mcp__autopilot'), 'gsd').join('\n')).toContain('mcp__autopilot')
    expect(infraViolations(base, 'gsd')).toEqual([])
  })

  test('mutation: a deny of the Skill tool is caught and named', () => {
    const base = matrixScope(templateRole('pm'), 'gsd')

    expect(infraViolations(withDeny(base, 'Skill'), 'gsd').join('\n')).toContain('Skill')
  })

  test('mutation: a deny of the infra server, or a glob over an infra tool, is caught, and so are the others', () => {
    const base = matrixScope(templateRole('pm'), 'gsd')
    const entries = [
      'mcp__autopilot',
      'mcp__autopilot__wait_for',
      'mcp__autopilot__restart_session',
      'mcp__autopilot__queue_question',
      'mcp__*',
      'mcp__au*',
      'PushNotification',
      'Skill(create-handoff-doc)',
      'Skill(resume-*)',
    ]

    expect(entries.filter(entry => infraViolations(withDeny(base, entry), 'gsd').length === 0)).toEqual([])
  })

  test('mutation: a deny that names an infra plugin is caught and named', () => {
    const base = matrixScope(templateRole('pm'), 'gsd')

    expect(infraViolations(withDeny(base, 'Skill(autopilot@local-mods)'), 'gsd').join('\n')).toContain(
      'autopilot@local-mods',
    )
  })

  test('mutation: an infra plugin switched off, or missing, is caught and named', () => {
    const base = matrixScope(templateRole('pm'), 'gsd')
    const off = infraViolations(withPlugin(base, 'autopilot@local-mods', false), 'gsd')
    const missing = infraViolations(withoutPlugin(base, 'agent-fleet@local-mods'), 'gsd')

    expect(off.join('\n')).toContain('autopilot@local-mods')
    expect(missing.join('\n')).toContain('agent-fleet@local-mods')
    expect(infraViolations(withoutPlugin(base, 'cadre@local-mods'), 'gsd').join('\n')).toContain('cadre@local-mods')
  })

  test('mutation: a handoff skill missing from the overlay is caught and named', () => {
    const base = matrixScope(templateRole('pm'), 'gsd')

    expect(infraViolations(withoutOverlaySkill(base, 'create-handoff-doc'), 'gsd').join('\n')).toContain(
      'create-handoff-doc',
    )
    expect(infraViolations(withoutOverlaySkill(base, 'resume-handoff-doc'), 'gsd').join('\n')).toContain(
      'resume-handoff-doc',
    )
  })

  test('mutation: a GSD start skill missing from the overlay of a GSD role is caught and named', () => {
    const base = matrixScope(templateRole('be'), 'gsd')

    expect(infraViolations(withoutOverlaySkill(base, 'gsd-autonomous'), 'gsd').join('\n')).toContain('gsd-autonomous')
    expect(infraViolations(withoutOverlaySkill(base, 'gsd-autonomous'), 'none')).toEqual([])
  })

  test('mutation: the superpowers plugin switched off for a superpowers role is caught and named', () => {
    const base = matrixScope(templateRole('be'), 'superpowers')
    const key = 'superpowers@claude-plugins-official'
    const problems = infraViolations(withPlugin(base, key, false), 'superpowers').join('\n')

    expect(infraViolations(base, 'superpowers')).toEqual([])
    expect(problems).toContain('superpowers:brainstorming')
    expect(infraViolations(withoutPlugin(base, key), 'superpowers').join('\n')).toContain('superpowers:writing-plans')
    expect(infraViolations(withPlugin(base, key, false), 'none')).toEqual([])
  })

  test('mutation: the flag that turns off slash commands is caught and named', () => {
    const base = matrixScope(templateRole('pm'), 'gsd')
    const problems = infraViolations(withFlag(base, '--disable-slash-commands'), 'gsd').join('\n')

    expect(problems).toContain('--disable-slash-commands')
    expect(infraViolations(withFlag(base, '--verbose'), 'gsd')).toEqual([])
  })

  test('mutation: several broken parts are all reported, so none hides another', () => {
    const base = matrixScope(templateRole('pm'), 'gsd')
    const noPlugin = withPlugin(withDeny(base, 'Skill'), 'cadre@local-mods', false)
    const broken = withFlag(withoutOverlaySkill(noPlugin, 'create-handoff-doc'), '--disable-slash-commands')
    const problems = infraViolations(broken, 'gsd')

    expect(problems).toHaveLength(4)
    expect(problems.join('\n')).toContain('Skill')
    expect(problems.join('\n')).toContain('cadre@local-mods')
    expect(problems.join('\n')).toContain('create-handoff-doc')
    expect(problems.join('\n')).toContain('--disable-slash-commands')
  })

  test('the lint and the checker agree: the server and a glob over a tool are refused, a tool prefix is not', () => {
    const base = matrixScope(templateRole('pm'), 'gsd')
    const refused = ['mcp__autopilot', 'mcp__autopilot__wa*']
    const literal = 'mcp__autopilot__wait'

    expect(refused.map(pattern => lintDenyPattern(pattern))).toEqual([
      'would block an infra tool (ISO-04)',
      'would block an infra tool (ISO-04)',
    ])
    expect(refused.filter(pattern => infraViolations(withDeny(base, pattern), 'gsd').length === 0)).toEqual([])
    expect(lintDenyPattern(literal)).toBeNull()
    expect(infraViolations(withDeny(base, literal), 'gsd')).toEqual([])
  })
})

/** A setup with the hook script lint.sh in project settings and the GSD secret read guard in user settings. */
const START_SETUP: SetupScan = emptySetupScan({
  hooks: [hook('lint.sh', 'project'), hook('gsd-secret-read-guard.js')],
})

/** BE carrying the GSD secret read guard, the one hook a role carries (D-62). */
const GUARDED_BE: RoleSpec = templateRole('be', { carry: { ...EMPTY_CARRY, hooks: ['gsd-secret-read-guard.js'] } })

/** The folder apps/web of the repo as a launch start (A2). */
const APPS_WEB: LaunchStart = { kind: 'dir', path: 'apps/web' }

/** The three none rules on the card of BE whose launcher starts in `folder` (D-122, D-127, D-113). */
function startNotes(folder: string): ScopeRule[] {
  return [
    `project settings (<git root>/.claude/settings.json) do not load: the session starts in ${folder}`,
    `Additional directory: <git root> (start folder is ${folder})`,
    `Handoffs (thoughts/shared/handoffs/be/) and GSD .planning/ follow the start folder (${folder})`,
  ].map((text): ScopeRule => ({ text, enforcement: 'none' }))
}

describe('launch start card (D-122)', () => {
  test('a dir start lists the project hook scripts as not loaded and none as loaded by project settings', () => {
    const card = compileScope(GUARDED_BE, context({ launchStart: APPS_WEB, setup: START_SETUP })).card

    expect(card.hooks).toEqual({ loaded: ['gsd-secret-read-guard.js'], loadedByProject: [], notLoaded: ['lint.sh'] })
  })

  test('a dir start ends the rules, right before the MCP route rule, with the three start notes labelled none', () => {
    const rules = compileScope(GUARDED_BE, context({ launchStart: APPS_WEB, setup: START_SETUP })).card.rules

    expect(rules.slice(-4, -1)).toEqual(startNotes('<git root>/apps/web'))
    expect(rules.at(-1)?.text.startsWith('MCP route: ')).toBe(true)
  })

  test('a here start names the folder the launcher is run from in all three notes', () => {
    const card = compileScope(GUARDED_BE, context({ launchStart: { kind: 'here' }, setup: START_SETUP })).card

    expect(card.rules.slice(-4, -1)).toEqual(startNotes('the folder the launcher is run from'))
    expect(card.rules.at(-1)?.text.startsWith('MCP route: ')).toBe(true)
    expect(card.hooks.loadedByProject).toEqual([])
  })

  test('a git-root start has no start note and lists the project hook scripts as loaded by project settings', () => {
    const card = compileScope(GUARDED_BE, context({ launchStart: { kind: 'git-root' }, setup: START_SETUP })).card
    const notes = [...startNotes('<git root>/apps/web'), ...startNotes('the folder the launcher is run from')]

    expect(card.rules.filter(item => notes.some(note => note.text === item.text))).toEqual([])
    expect(card.rules.filter(item => item.text.includes('<git root>'))).toEqual([])
    expect(card.hooks).toEqual({ loaded: ['gsd-secret-read-guard.js'], loadedByProject: ['lint.sh'], notLoaded: [] })
  })

  test('a context monitor in project settings gets its warning for a git-root start only', () => {
    const setup = emptySetupScan({ hooks: [hook('gsd-context-monitor.js', 'project')] })
    const warning =
      'WARNING: gsd-context-monitor.js is registered in project settings and loads in every role; ' +
      'it conflicts with the autopilot handoff (D-62)'
    const starts: readonly LaunchStart[] = [{ kind: 'git-root' }, { kind: 'here' }, APPS_WEB]
    const labels = starts.map(launchStart => {
      const scope = compileScope(templateRole('be'), context({ launchStart, setup }))

      return ruleOf(scope, warning)?.enforcement
    })

    expect(labels).toEqual(['none', undefined, undefined])
  })
})

/** One compiled scope of the route matrix, with the combination it was compiled for. */
type RouteCase = {
  readonly where: string
  readonly scope: CompiledScope
}

/** Every template role on every framework, launch start and MCP route, compiled with the matrix setup. */
function routeMatrix(): RouteCase[] {
  const starts: readonly LaunchStart[] = [{ kind: 'git-root' }, { kind: 'here' }, APPS_WEB]
  const routes: readonly McpRoute[] = ['merged', 'strict']

  return ROLE_TEMPLATE.map(row => roleFromTemplate(row)).flatMap(role =>
    FRAMEWORKS.flatMap(framework =>
      starts.flatMap(launchStart =>
        routes.map(mcpRoute => ({
          where: `${role.id} / ${framework} / ${launchStart.kind} / ${mcpRoute}`,
          scope: compileScope(role, context({ framework, launchStart, mcpRoute, setup: MATRIX_SETUP })),
        })),
      ),
    ),
  )
}

describe('decided MCP route (D-104, D-124)', () => {
  test('the route rule of a merged scope says what merged holds, and that of a strict scope names its flag', () => {
    const merged = compileScope(templateRole('be'), context({ mcpRoute: 'merged' })).card.rules
    const strict = compileScope(templateRole('be'), context({ mcpRoute: 'strict' })).card.rules

    expect(merged.at(-1)).toEqual({
      text: 'MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)',
      enforcement: 'none',
    })
    expect(strict.at(-1)).toEqual({ text: 'MCP route: strict (--strict-mcp-config)', enforcement: 'none' })
  })

  test(
    'a merged deny rule is followed by the whole-server deny rule, best-effort; a strict one is not (A1, #39)',
    () => {
      const setup = emptySetupScan({ mcp: [session('redmine'), session('notion')] })
      const merged = compileScope(templateRole('be'), context({ setup, mcpRoute: 'merged' }))
      const strict = compileScope(templateRole('be'), context({ setup, mcpRoute: 'strict' }))
      const allGiven = compileScope(
        templateRole('be', { mcp: ['notion', 'redmine'] }),
        context({ setup, mcpRoute: 'merged' }),
      )
      const listed = 'Scanned MCP servers not given are denied: notion, redmine'
      const texts = merged.card.rules.map(item => item.text)
      const checks: readonly ProbeCheck[] = [
        { kind: 'tool-prefix-absent', token: 'mcp__notion__' },
        { kind: 'tool-prefix-absent', token: 'mcp__redmine__' },
      ]

      expect(ruleOf(merged, listed)).toEqual({ text: listed, enforcement: 'best-effort', checks })
      expect(ruleOf(merged, MERGED_REACHABLE_RULE)).toEqual({ text: MERGED_REACHABLE_RULE, enforcement: 'best-effort' })
      expect(texts.indexOf(MERGED_REACHABLE_RULE)).toBe(texts.indexOf(listed) + 1)
      expect(ruleOf(strict, listed)).toEqual({ text: listed, enforcement: 'hard', checks })
      expect(ruleOf(strict, MERGED_REACHABLE_RULE)).toBeUndefined()
      expect(ruleOf(allGiven, MERGED_REACHABLE_RULE)).toBeUndefined()
    },
  )

  test('no scope card line of any template role, framework, start and route says provisional', () => {
    const cases = routeMatrix()
    const found = cases.flatMap(({ where, scope }) =>
      scopeCardLines(scope.card)
        .filter(line => line.includes('provisional'))
        .map(line => `${where}: ${line}`),
    )

    expect(cases).toHaveLength(6 * 3 * 3 * 2)
    expect(found).toEqual([])
  })

  test('no compiled settings template holds a deniedMcpServers key (D-124)', () => {
    const found = routeMatrix().filter(({ scope }) => JSON.stringify(scope.settings).includes('deniedMcpServers'))

    expect(found.map(({ where }) => where)).toEqual([])
  })
})

/** The start of the text of every card rule that carries probe checks (D-112). */
const CHECKED_RULE_STARTS: readonly string[] = [
  'No Bash tool (denied)',
  'Scanned MCP servers not given are denied: ',
  AVAILABLE_RULE,
  'Permission mode: ',
]

describe('probe checks (D-112)', () => {
  test('the merged deny rule checks that no tool of a denied server is left; none denied, no check (D-124)', () => {
    const setup = emptySetupScan({ mcp: [session('redmine'), session('notion')] })
    const merged = compileScope(templateRole('pm'), context({ setup }))
    const none = compileScope(templateRole('pm'), context())

    expect(ruleOf(merged, mergedDenied('notion, redmine'))?.checks).toEqual([
      { kind: 'tool-prefix-absent', token: 'mcp__notion__' },
      { kind: 'tool-prefix-absent', token: 'mcp__redmine__' },
    ])
    expect(ruleOf(none, 'No other scanned MCP servers to deny')).toEqual({
      text: 'No other scanned MCP servers to deny',
      enforcement: 'best-effort',
    })
  })

  test('the strict deny rule has the checks too, each server by its engine tool name and two underscores', () => {
    const setup = emptySetupScan({ mcp: [session('my.server'), session('jira')] })
    const strict = compileScope(templateRole('pm'), context({ setup, mcpRoute: 'strict' }))

    expect(ruleOf(strict, 'Scanned MCP servers not given are denied: jira, my.server')).toEqual({
      text: 'Scanned MCP servers not given are denied: jira, my.server',
      enforcement: 'hard',
      checks: [
        { kind: 'tool-prefix-absent', token: 'mcp__jira__' },
        { kind: 'tool-prefix-absent', token: 'mcp__my_server__' },
      ],
    })
  })

  test('the infra rule checks the autopilot command, the handoff skills and the autopilot tools, in order', () => {
    for (const role of [templateRole('pm'), templateRole('be')]) {
      expect(ruleOf(compileScope(role, context()), AVAILABLE_RULE)?.checks).toEqual(AVAILABLE_CHECKS)
    }
  })

  test('the permission rule checks the mode, and manual as the engine reports it: default', () => {
    const auto = compileScope(templateRole('be'), context())
    const manual = compileScope(templateRole('be', { permissionMode: 'manual' }), context())

    expect(ruleOf(auto, 'Permission mode: auto')?.checks).toEqual([{ kind: 'permission-mode', token: 'auto' }])
    expect(ruleOf(manual, 'Permission mode: manual')?.checks).toEqual([{ kind: 'permission-mode', token: 'default' }])
  })

  test(
    'only the Bash, MCP deny, infra and permission rules carry checks, in every role, framework, start and route',
    () => {
      const isChecked = (item: ScopeRule): boolean => CHECKED_RULE_STARTS.some(start => item.text.startsWith(start))
      const found = routeMatrix().flatMap(({ where, scope }) =>
        scope.card.rules
          .filter(item => (item.checks !== undefined) !== isChecked(item))
          .map(item => `${where}: ${item.text}`),
      )

      expect(found).toEqual([])
    },
  )
})

describe('security-guidance for Security (decision #39)', () => {
  /** The plugin keys of a role that has only the three infra plugins, in the order the settings hold them. */
  const INFRA_KEYS: readonly string[] = ['agent-fleet@local-mods', 'autopilot@local-mods', 'cadre@local-mods']

  test('a claude-security skill enables only the exact claude-plugins-official key, never another (T-03-46)', () => {
    const security = templateRole('security', { skills: ['claude-security:claude-security'] })
    const other = emptySetupScan({ plugins: ['claude-security@other-market'] })
    const both = emptySetupScan({ plugins: ['claude-security@other-market', CLAUDE_SECURITY_PLUGIN] })

    expect(pluginKeys(compileScope(security, context({ setup: other })))).toEqual(INFRA_KEYS)
    expect(pluginKeys(compileScope(security, context({ setup: both })))).toEqual([
      ...INFRA_KEYS,
      CLAUDE_SECURITY_PLUGIN,
    ])
  })

  test('every role that stands for Security enables the official security-guidance key the setup holds', () => {
    const setup = emptySetupScan({ plugins: ['codex@openai-codex', SECURITY_GUIDANCE_PLUGIN] })

    for (const role of [templateRole('security'), templateRole('security', { id: 'sec' })]) {
      const scope = compileScope(role, context({ setup }))

      expect(scope.settings.enabledPlugins[SECURITY_GUIDANCE_PLUGIN]).toBe(true)
      expect(pluginKeys(scope)).toEqual([...INFRA_KEYS, SECURITY_GUIDANCE_PLUGIN])
    }
  })

  test('a security-guidance key of another marketplace is never enabled, not even for a skill of that name', () => {
    const setup = emptySetupScan({ plugins: ['security-guidance@other-market'] })
    const security = compileScope(templateRole('security'), context({ setup }))
    const named = compileScope(templateRole('security', { skills: ['security-guidance:x'] }), context({ setup }))

    expect(pluginKeys(security)).toEqual(INFRA_KEYS)
    expect(pluginKeys(named)).toEqual(INFRA_KEYS)
  })

  test('a BE role does not enable security-guidance, and a Security role without the key is unchanged', () => {
    const official = emptySetupScan({ plugins: [SECURITY_GUIDANCE_PLUGIN] })

    expect(pluginKeys(compileScope(templateRole('be'), context({ setup: official })))).toEqual(INFRA_KEYS)
    expect(pluginKeys(compileScope(templateRole('security'), context()))).toEqual(INFRA_KEYS)
  })
})
