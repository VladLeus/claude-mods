import { describe, expect, test } from 'claude-code/testing'

import type {
  CompiledScope,
  FrameworkId,
  HookScript,
  McpRef,
  PermissionMode,
  RoleSpec,
  ScopeContext,
  ScopeRule,
  SetupScan,
  SkillRef,
  TemplateRoleId,
} from '../types'
import { FRAMEWORK_START_SKILLS, INFRA_SKILLS } from './assign'
import { chainLines, EMPTY_CARRY, ROLE_TEMPLATE, roleFromTemplate } from './roles'
import type { ChainRole } from './roles'
import { compileScope, infraViolations, lintDenyPattern, roleOwnPaths, scopeCardLines } from './scope'
import { ABSOLUTE_PATH_MARKERS, BIDI_OVERRIDE, leaks } from './testkit'

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

/** A skill or plugin command the scan listed; `plugin` is null for a user or project skill. */
function skill(name: string, plugin: string | null = null): SkillRef {
  return { name, plugin }
}

/** A hook script the user's settings register. */
function hook(script: string): HookScript {
  return { script, event: 'PostToolUse', source: 'user' }
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

/** The rule that names the code dirs the committed template leaves alone because their names match the role's own. */
function skippedRule(dirs: string): string {
  return (
    `Reads and edits under ${dirs} are not denied in the committed template: ` +
    "those names match the role's own folders at any depth (exact denies are rendered at launch)"
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
    const scope = compileScope(templateRole('pm'), context({ setup: scanned }))
    const deny = scope.settings.permissions.deny

    expect(deny).toContain('mcp__jira')
    expect(deny).not.toContain('mcp__autopilot')
    // The infra server is left out before the lint sees it, so the card has no refusal to report for it.
    expect(scope.card.rules.filter(candidate => candidate.text.includes('was not emitted'))).toEqual([])
    expect(scope.card.notGiven.mcp).toEqual(['jira'])
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
    const scanned = setup({
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
    const scanned = setup({
      plugins: ['codex@openai-codex', 'superpowers@claude-plugins-official'],
      skills: [skill('codex:rescue', 'codex')],
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
    const scanned = setup({ plugins: ['codex@openai-codex'] })
    const role = templateRole('be', { skills: ['my-skill'] })
    const scope = compileScope(role, context({ framework: 'none', setup: scanned }))

    expect(scope.overlay.skills).toEqual(['create-handoff-doc', 'my-skill', 'resume-handoff-doc'])
    expect(pluginKeys(scope)).toHaveLength(3)
    expect(scope.card.skills).toEqual(['my-skill'])
  })

  test('a role with no MCP servers and no skills still has the infra, handoff and start skills', () => {
    const scanned = setup({ plugins: ['superpowers@claude-plugins-official'] })
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
    const scanned = setup({
      skills: [
        skill('my-skill'),
        skill('other-skill'),
        skill('gsd-plan-phase'),
        skill('gsd-health'),
        skill('create-handoff-doc'),
        skill('resume-handoff-doc'),
        skill('codex:rescue', 'codex'),
        skill('other-skill', 'extra'),
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
    const scanned = setup({
      plugins: ['superpowers@claude-plugins-official'],
      skills: [
        skill('autopilot', 'autopilot'),
        skill('fleet', 'agent-fleet'),
        skill('superpowers:systematic-debugging', 'superpowers'),
        skill('codex:rescue', 'codex'),
      ],
    })
    const forSuperpowers = compileScope(templateRole('be'), context({ framework: 'superpowers', setup: scanned }))
    const forGsd = compileScope(templateRole('be'), context({ setup: scanned }))

    expect(forSuperpowers.card.notGiven.skills).toEqual(['codex:rescue'])
    expect(forGsd.card.notGiven.skills).toEqual(['codex:rescue', 'superpowers:systematic-debugging'])
  })

  test('the card lists the scanned MCP servers a role was not given, without autopilot, sorted and once each', () => {
    const scanned = setup({
      mcp: [session('zeta'), session('autopilot'), session('jira'), session('zeta'), session('alpha')],
    })
    const card = compileScope(templateRole('pm', { mcp: ['jira'] }), context({ setup: scanned })).card

    expect(card.mcp).toEqual(['jira'])
    expect(card.notGiven.mcp).toEqual(['alpha', 'zeta'])
  })

  test('the card lists the hooks the role loads and the other scanned hook scripts, sorted', () => {
    const scanned = setup({
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
    expect(card.hooks.notLoaded).toEqual(['gsd-context-monitor.js', 'gsd-statusline.js'])
  })

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

  test('an MCP server with an unusual name is not denied and the card says so', () => {
    const scanned = setup({ mcp: [session('my.server'), session(`ev${BIDI_OVERRIDE}il`), session('good-one_2')] })
    const scope = compileScope(templateRole('pm'), context({ setup: scanned }))
    const dotted = 'MCP server my.server has an unusual name and is not denied'
    const hidden = 'MCP server evil has an unusual name and is not denied'

    expect(scope.settings.permissions.deny.filter(entry => entry.startsWith('mcp__'))).toEqual(['mcp__good-one_2'])
    expect(ruleOf(scope, dotted)).toEqual({ text: dotted, enforcement: 'none' })
    expect(ruleOf(scope, hidden)).toEqual({ text: hidden, enforcement: 'none' })
    expect(ruleOf(scope, 'MCP servers not given are denied: good-one_2')?.enforcement).toBe('hard')
  })

  test('a deny the lint refuses is dropped and the card names it, so a bug cannot ship a broken deny', () => {
    const scanned = setup({ mcp: [session('autopilot__wait_for'), session('a'), session('jira')] })
    const scope = compileScope(templateRole('pm'), context({ setup: scanned }))
    const notice = 'would block an infra tool (ISO-04)'
    const wait = `mcp__autopilot__wait_for was not emitted: ${notice}`
    const short = `mcp__a was not emitted: ${notice}`

    expect(scope.settings.permissions.deny.filter(entry => entry.startsWith('mcp__'))).toEqual(['mcp__jira'])
    expect(ruleOf(scope, wait)).toEqual({ text: wait, enforcement: 'none' })
    expect(ruleOf(scope, short)).toEqual({ text: short, enforcement: 'none' })
    expect(ruleOf(scope, 'MCP servers not given are denied: jira')?.enforcement).toBe('hard')
  })

  test('every MCP server given leaves nothing to deny, and the rule says so', () => {
    const scanned = setup({ mcp: [session('jira'), session('autopilot')] })
    const scope = compileScope(templateRole('pm', { mcp: ['jira'] }), context({ setup: scanned }))

    expect(scope.settings.permissions.deny.filter(entry => entry.startsWith('mcp__'))).toEqual([])
    expect(ruleOf(scope, 'No other MCP servers to deny')).toEqual({
      text: 'No other MCP servers to deny',
      enforcement: 'hard',
    })
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
    const text = skippedRule('.cadre, .planning, handoffs, pm, shared, thoughts')
    const isSkipRule = (candidate: ScopeRule): boolean => candidate.text.includes('not denied in the committed')

    expect(ruleOf(skipped, text)).toEqual({ text, enforcement: 'best-effort' })
    expect(skipped.card.rules.filter(isSkipRule)).toHaveLength(1)
    expect(none.card.rules.filter(isSkipRule)).toEqual([])
  })

  test('a code dir whose name differs only in case from a folder of the role is skipped too', () => {
    const scope = compileScope(templateRole('pm'), context({ codeDirs: ['PM', 'Thoughts', 'src'] }))

    expect(codeDirDenies(scope.settings.permissions.deny)).toEqual(['Edit(./src/**)', 'Read(./src/**)'])
    expect(ruleOf(scope, skippedRule('PM, Thoughts'))?.enforcement).toBe('best-effort')
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
    const scanned = setup({ mcp: [session('jira'), session('my.server'), session('autopilot__wait_for')] })
    const role = templateRole('pm', { permissionMode: 'bypassPermissions' })
    const ctx = context({ isAttended: true, mcpRoute: 'strict', setup: scanned, codeDirs: ['cadre', 'pm', '*'] })

    expect(compileScope(role, ctx).card.rules).toEqual([
      { text: BYPASS_RULE, enforcement: 'none' },
      { text: PLUGIN_RULE, enforcement: 'hard' },
      { text: 'No Bash tool (denied)', enforcement: 'hard' },
      { text: 'Reads and edits under cadre are denied; the patterns match at any depth', enforcement: 'best-effort' },
      { text: skippedRule('pm'), enforcement: 'best-effort' },
      { text: 'Code dir * has an unusual name and is not denied', enforcement: 'none' },
      { text: 'Reads of .env, .env.*, ~/.ssh and ~/.aws are denied', enforcement: 'best-effort' },
      { text: 'MCP servers not given are denied: jira', enforcement: 'hard' },
      { text: 'MCP server my.server has an unusual name and is not denied', enforcement: 'none' },
      {
        text: 'mcp__autopilot__wait_for was not emitted: would block an infra tool (ISO-04)',
        enforcement: 'none',
      },
      { text: 'Skills: only the listed skills are linked', enforcement: 'best-effort' },
      { text: 'Autopilot, agent-fleet and the handoff skills are always available', enforcement: 'hard' },
      { text: 'Permission mode: bypassPermissions', enforcement: 'hard' },
      { text: ATTENDED_RULE, enforcement: 'none' },
      { text: 'MCP route: strict (provisional; Phase 3 decides)', enforcement: 'none' },
    ])
  })

  test('a role with Bash has the labels of its rules fixed too', () => {
    const scanned = setup({ mcp: [session('jira')] })
    const scope = compileScope(templateRole('be'), context({ setup: scanned, codeDirs: ['src'] }))

    expect(scope.card.rules).toEqual([
      { text: PLUGIN_RULE, enforcement: 'hard' },
      { text: SANDBOX_RULE, enforcement: 'best-effort' },
      { text: 'Reads of .env, .env.*, ~/.ssh and ~/.aws are denied', enforcement: 'best-effort' },
      { text: 'MCP servers not given are denied: jira', enforcement: 'hard' },
      { text: 'Skills: only the listed skills are linked', enforcement: 'best-effort' },
      { text: 'Autopilot, agent-fleet and the handoff skills are always available', enforcement: 'hard' },
      { text: 'Permission mode: auto', enforcement: 'hard' },
      { text: 'MCP route: merged (provisional; Phase 3 decides)', enforcement: 'none' },
    ])
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

  test('a pattern that is, or is a prefix of, an infra tool is refused (ISO-04)', () => {
    const message = 'would block an infra tool (ISO-04)'
    const refused = [
      'mcp__*',
      'mcp__',
      'mcp__autopilot',
      'mcp__autopilot_',
      'mcp__autopilot__wait',
      'mcp__autopilot__wait_for',
      'mcp__autopilot__restart_session',
      'mcp__autopilot__queue_question',
      'mcp__au*',
      'mcp__a',
      'Skill',
      'PushNotification',
    ]

    expect(refused.filter(pattern => lintDenyPattern(pattern) !== message)).toEqual([])
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
      'Skill(',
    ]

    expect(refused.filter(pattern => lintDenyPattern(pattern) !== message)).toEqual([])
  })

  test('the empty pattern is refused, and a name that only starts like an infra tool is not', () => {
    expect(lintDenyPattern('')).toBe('would block an infra tool (ISO-04)')
    expect(lintDenyPattern('mcp__autopilot2')).toBeNull()
    expect(lintDenyPattern('mcp__autopilot_x')).toBeNull()
    expect(lintDenyPattern('mcp__j')).toBeNull()
    expect(lintDenyPattern('Skills')).toBeNull()
  })
})

describe('scopeCardLines', () => {
  test('the card of a PM lists framework, skills, MCP, not given, hooks, rules, decisions and memory', () => {
    const scanned = setup({
      mcp: [session('jira')],
      skills: [skill('my-skill')],
      hooks: [hook('gsd-context-monitor.js'), hook('gsd-secret-read-guard.js')],
    })
    const role = templateRole('pm', { carry: { ...EMPTY_CARRY, hooks: ['gsd-secret-read-guard.js'] } })
    const card = compileScope(role, context({ setup: scanned, codeDirs: ['cadre'] })).card

    expect(scopeCardLines(card)).toEqual([
      'Scope card: PM (pm)',
      '  framework: GSD; model: opus + medium; permission mode: auto',
      '  skills: none',
      '  MCP servers: none',
      '  not given: skills: my-skill; MCP: jira',
      '  hooks loaded: gsd-secret-read-guard.js; not loaded: gsd-context-monitor.js',
      '  rules:',
      `    [hard] ${PLUGIN_RULE}`,
      '    [hard] No Bash tool (denied)',
      '    [best-effort] Reads and edits under cadre are denied; the patterns match at any depth',
      '    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied',
      '    [hard] MCP servers not given are denied: jira',
      '    [best-effort] Skills: only the listed skills are linked',
      '    [hard] Autopilot, agent-fleet and the handoff skills are always available',
      '    [hard] Permission mode: auto',
      '    [none] MCP route: merged (provisional; Phase 3 decides)',
      '  decisions:',
      ...chainLines(['pm', 'tl']).map(line => `    ${line}`),
      '  memory: ~/.claude/cadre/<repo>-<hash8>/pm/ (rendered at launch)',
    ])
  })

  test('the lists show the skills and MCP servers the role has', () => {
    const scanned = setup({ mcp: [session('jira'), session('github')] })
    const role = templateRole('tl', { mcp: ['github', 'jira'], skills: ['my-skill', 'codex:rescue'] })
    const lines = scopeCardLines(compileScope(role, context({ setup: scanned })).card)

    expect(lines[0]).toBe('Scope card: Team Lead (tl)')
    expect(lines[2]).toBe('  skills: codex:rescue, my-skill')
    expect(lines[3]).toBe('  MCP servers: github, jira')
    expect(lines[4]).toBe('  not given: skills: none; MCP: none')
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
    const scanned = setup({ skills: names.map(name => skill(name)) })
    const card = compileScope(templateRole('pm'), context({ setup: scanned })).card
    const line = scopeCardLines(card).find(candidate => candidate.startsWith('  not given:'))

    expect(line).toBe(`  not given: skills: ${names.slice(0, 12).join(', ')}, +3 more; MCP: none`)
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
    const scanned = setup({ mcp: [session(`ev${BIDI_OVERRIDE}il`)] })
    const lines = scopeCardLines(compileScope(templateRole('pm'), context({ setup: scanned })).card)

    expect(lines.filter(line => line.startsWith('  not given:'))).toEqual(['  not given: skills: none; MCP: evil'])
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
    const card = compileScope(templateRole('be', { id: 'api' }), context({ roleIds: ['pm', 'api'] })).card
    const lines = scopeCardLines(card)
    const decisions = lines.indexOf('  decisions:')

    expect(lines.slice(decisions + 1, decisions + 1 + card.chain.length)).toEqual(card.chain.map(line => `    ${line}`))
    expect(lines[lines.length - 1]).toBe('  memory: ~/.claude/cadre/<repo>-<hash8>/api/ (rendered at launch)')
  })
})

/** The three frameworks the ISO-04 matrix runs. */
const FRAMEWORKS: readonly FrameworkId[] = ['gsd', 'superpowers', 'none']

/** What the matrix scans: the superpowers and codex plugins, user and plugin skills, five MCP servers (one infra). */
const MATRIX_SETUP: SetupScan = setup({
  plugins: ['superpowers@claude-plugins-official', 'codex@openai-codex'],
  skills: [
    skill('my-skill'),
    skill('gsd-health'),
    skill('gsd-plan-phase'),
    skill('create-handoff-doc'),
    skill('resume-handoff-doc'),
    skill('codex:rescue', 'codex'),
    skill('superpowers:brainstorming', 'superpowers'),
    skill('autopilot', 'autopilot'),
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
  const roleIds = MATRIX_ROLES.map(member => member.id)

  return compileScope(role, context({ framework, setup: MATRIX_SETUP, codeDirs: OVERLAPPING_DIRS, roleIds }))
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

  test('mutation: a deny that is a prefix of an infra tool is caught, and so are the other infra denies', () => {
    const base = matrixScope(templateRole('pm'), 'gsd')
    const entries = [
      'mcp__autopilot__wait',
      'mcp__autopilot__wait_for',
      'mcp__autopilot__restart_session',
      'mcp__autopilot__queue_question',
      'mcp__*',
      'mcp__',
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

  test('the lint and the checker both reject a deny that is a prefix of an infra tool name', () => {
    const base = matrixScope(templateRole('pm'), 'gsd')
    const prefixes = ['mcp__autopilot', 'mcp__autopilot__wait']

    expect(prefixes.map(prefix => lintDenyPattern(prefix))).toEqual([
      'would block an infra tool (ISO-04)',
      'would block an infra tool (ISO-04)',
    ])
    expect(prefixes.filter(prefix => infraViolations(withDeny(base, prefix), 'gsd').length === 0)).toEqual([])
  })
})
