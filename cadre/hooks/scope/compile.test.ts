import { describe, expect, test } from 'claude-code/testing'

import type {
  CompiledScope,
  FrameworkId,
  HookScript,
  McpRoute,
  PermissionMode,
  ProbeCheck,
  RoleSpec,
  ScopeContext,
  ScopeRule,
  SettingsSource,
} from '../../types'
import { adapterOf } from '../framework/registry'
import { CLAUDE_SECURITY_PLUGIN, INFRA_SKILLS, SECURITY_GUIDANCE_PLUGIN } from '../roles/infra'
import { chainLines, EMPTY_CARRY } from '../roles/template'
import type { ChainRole } from '../roles/template'
import {
  ABSOLUTE_PATH_MARKERS,
  BIDI_OVERRIDE,
  emptySetupScan,
  leaks,
  session,
  skillRef,
  templateRole,
} from '../testkit'
import { scopeCardLines } from './card'
import { compileScope } from './compile'
import { isContextMonitorScript, roleOwnPaths } from './lint'

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

/** The card rule that names what a role loads as its instructions: its built and private files (02-GAPS-B2 N9). */
function loadsRule(id: string): string {
  return (
    `Loads .cadre/${id}/CLAUDE.md and its private instructions ` +
    `(<config dir>/cadre/<repo>-<hash8>/${id}/instructions/)`
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
  '--add-dir',
  '.cadre/pm',
  '--add-dir',
  '.cadre/pm/.runtime/private-instructions',
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
      '--add-dir',
      '.cadre/be',
      '--add-dir',
      '.cadre/be/.runtime/private-instructions',
      '--mcp-config',
      '.cadre/be/.runtime/mcp.json',
    ])
  })

  test('the role folder and its private instructions link are added directories, repo-relative (D-140 q1-b)', () => {
    const flags = compileScope(templateRole('qa'), context()).flags
    const added = flags.flatMap((flag, index) => (flags[index - 1] === '--add-dir' ? [flag] : []))

    expect(added).toEqual(['.cadre/qa/.runtime/overlay', '.cadre/qa', '.cadre/qa/.runtime/private-instructions'])
    expect(flags[flags.indexOf('--append-system-prompt-file') + 1]).toBe('.cadre/qa/ROLE.md')
    expect(added.filter(path => path.startsWith('/') || path.startsWith('~'))).toEqual([])
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
      for (const name of [...INFRA_SKILLS, ...adapterOf(framework).startSkills]) {
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
      { text: loadsRule('pm'), enforcement: 'none' },
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
      { text: loadsRule('be'), enforcement: 'none' },
      { text: AVAILABLE_RULE, enforcement: 'hard', checks: AVAILABLE_CHECKS },
      { text: 'Permission mode: auto', enforcement: 'hard', checks: [{ kind: 'permission-mode', token: 'auto' }] },
      { text: MERGED_ROUTE_RULE, enforcement: 'none' },
    ])
  })
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

  test('a BE role given a security-guidance skill enables exactly the official key (#69 B4)', () => {
    const official = emptySetupScan({ plugins: ['security-guidance@other-market', SECURITY_GUIDANCE_PLUGIN] })
    const be = compileScope(templateRole('be', { skills: ['security-guidance:x'] }), context({ setup: official }))

    expect(pluginKeys(be)).toEqual([...INFRA_KEYS, SECURITY_GUIDANCE_PLUGIN])
  })
})
