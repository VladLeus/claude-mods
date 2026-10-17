import { describe, expect, test } from 'claude-code/testing'

import type { McpRef, RoleSpec, ScopeContext, SetupScan, TemplateRoleId } from '../types'
import { chainLines, ROLE_TEMPLATE, roleFromTemplate } from './roles'
import { compileScope } from './scope'
import { ABSOLUTE_PATH_MARKERS, leaks } from './testkit'

/** The template role with this id, as init builds it: nothing assigned, every other field a default. */
function templateRole(id: TemplateRoleId, over: Partial<RoleSpec> = {}): RoleSpec {
  const row = ROLE_TEMPLATE.find(candidate => candidate.id === id)
  if (row === undefined) throw new Error(`no template role ${id}`)

  return { ...roleFromTemplate(row), ...over }
}

/** A setup scan that found nothing; `over` changes the fields it names. */
function setup(over: Partial<SetupScan> = {}): SetupScan {
  return {
    plugins: [],
    skills: [],
    mcp: [],
    agents: [],
    claudeMd: [],
    hasGlobalClaudeMd: false,
    memoryFiles: [],
    settingsKeys: [],
    hooks: [],
    carry: { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] },
    warnings: [],
    ...over,
  }
}

/** A scope context for the GSD framework and the merged MCP route; `over` changes the fields it names. */
function context(over: Partial<ScopeContext> = {}): ScopeContext {
  return {
    framework: 'gsd',
    setup: setup(),
    codeDirs: [],
    isAttended: false,
    mcpRoute: 'merged',
    roleIds: ['pm', 'tl'],
    ...over,
  }
}

/** An MCP server the live session lists. */
function session(name: string): McpRef {
  return { name, source: 'session' }
}

/** The first card rule of a role that only has the three infra plugins (hard, the whitelist of --setting-sources). */
const PLUGIN_RULE =
  'Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load ' +
  '(--setting-sources project whitelist)'

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
    const ctx = context({ setup: setup({ mcp: [session('jira')] }), codeDirs: ['cadre'] })
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
    const scope = compileScope(pm, context({ setup: setup({ mcp: [session('jira')] }), codeDirs: ['cadre'] }))

    expect(scope.settings.permissions.deny).not.toContain('mcp__jira')
    expect(scope.mcp).toEqual({ schema: 1, servers: ['jira'] })
  })

  test('the autopilot server is never denied, whether or not the scan lists it', () => {
    const scanned = setup({ mcp: [session('autopilot'), session('jira')] })
    const deny = compileScope(templateRole('pm'), context({ setup: scanned })).settings.permissions.deny

    expect(deny).toContain('mcp__jira')
    expect(deny).not.toContain('mcp__autopilot')
  })

  test('the MCP file and the deny list are sorted and once each', () => {
    const scanned = setup({ mcp: [session('zeta'), session('alpha'), session('zeta'), session('mid')] })
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
    const scanned = setup({ agents: ['gsd-planner', 'my-agent', 'gsd-executor', 'gsd-planner'] })
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
    })
  })

  test('the card names the memory folder pattern and the decision chain of the team', () => {
    const card = compileScope(templateRole('pm'), context({ roleIds: ['pm', 'tl'] })).card

    expect(card.memoryPattern).toBe('~/.claude/cadre/<repo>-<hash8>/pm/')
    expect(card.chain).toEqual(chainLines(['pm', 'tl']))
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
    const scanned = setup({ mcp: [session('jira')], plugins: ['superpowers@claude-plugins-official'] })
    const scope = compileScope(templateRole('pm'), context({ setup: scanned, codeDirs: ['cadre', 'src'] }))

    expect(leaks(JSON.stringify(scope), ABSOLUTE_PATH_MARKERS)).toEqual([])
  })

  test('every call returns a fresh value and keeps no state', () => {
    const role = templateRole('pm')
    const ctx = context({ setup: setup({ mcp: [session('jira')] }), codeDirs: ['cadre'] })
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
