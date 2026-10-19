import { describe, expect, test } from 'claude-code/testing'

import type { CompiledScope, RoleSpec, ScopeContext, SetupScan, TemplateRoleId } from '../types'
import {
  claudeMdImports,
  instructionPlan,
  launchPlan,
  lintRuntimeDenyPattern,
  memorySlug,
  renderRuntimeSettings,
  roleMemoryDir,
  RUNTIME_SETTINGS_KEYS,
  runtimeDeny,
} from './launch'
import type { LaunchUser } from './launch'
import { ROLE_TEMPLATE, roleFromTemplate } from './roles'
import { compileScope } from './scope'
import { BIDI_OVERRIDE } from './testkit'

/** The fixture hash: the 8 characters the memory slug shows, then 56 zeros. */
const HASH = `1a2b3c4d${'0'.repeat(56)}`

/** The launching user of the fixtures: repo /repo, home /home/u, nothing to carry; `over` changes named fields. */
function user(over: Partial<LaunchUser> = {}): LaunchUser {
  return {
    root: '/repo',
    home: '/home/u',
    userDir: '/home/u/.claude',
    gitCommonDir: '/repo/.git',
    commonDirHash: HASH,
    autoCompactWindow: null,
    statusLine: null,
    env: {},
    hooks: [],
    claudeMd: [],
    globalClaudeMd: [],
    memoryFiles: [],
    userSkills: [],
    userAgents: [],
    codeDirs: [],
    ...over,
  }
}

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
    isMcpPartial: false,
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
    roles: ['pm', 'tl'],
    ...over,
  }
}

/** The scope with one more deny entry; the compiled value is never changed. */
function withDeny(scope: CompiledScope, entry: string): CompiledScope {
  const permissions = { ...scope.settings.permissions, deny: [...scope.settings.permissions.deny, entry] }

  return { ...scope, settings: { ...scope.settings, permissions } }
}

/** What a role carries from the user's settings: the window, the status line, one env name and one hook script. */
const CARRY_ALL = {
  autoCompactWindow: true,
  statusLine: true,
  env: ['JIRA_URL'],
  hooks: ['gsd-secret-read-guard.js'],
}

/** The user's secret guard hook and the context monitor, as the launch collects them from the user's settings. */
const USER_HOOKS = [
  {
    event: 'PreToolUse',
    script: 'gsd-secret-read-guard.js',
    command: 'node /home/u/.claude/hooks/gsd-secret-read-guard.js',
  },
  { event: 'PostToolUse', script: 'gsd-context-monitor.js', command: 'node /home/u/m.js' },
]

/** A launching user that has something to carry and one env value the roles do not carry. */
function carrier(over: Partial<LaunchUser> = {}): LaunchUser {
  return user({
    autoCompactWindow: 800000,
    statusLine: { type: 'command', command: '/home/u/x.js' },
    env: { JIRA_URL: 'https://j', API_KEY: 'k' },
    hooks: USER_HOOKS,
    codeDirs: ['cadre'],
    ...over,
  })
}

/** The absolute path prefixes (`/repo/cadre/`) that the exact Read and Edit denies cover. */
function coveredPrefixes(deny: readonly string[]): string[] {
  return deny.flatMap(entry => {
    const path = /^(?:Read|Edit)\(\/(\/.+)\/\*\*\)$/.exec(entry)?.[1]

    return path === undefined ? [] : [`${path}/`]
  })
}

describe('launch render', () => {
  test('RUNTIME_SETTINGS_KEYS lists the nine allowed settings keys and is frozen', () => {
    expect(RUNTIME_SETTINGS_KEYS).toEqual([
      'autoCompactWindow',
      'autoMemoryDirectory',
      'claudeMdExcludes',
      'enabledPlugins',
      'env',
      'hooks',
      'permissions',
      'sandbox',
      'statusLine',
    ])
    expect(Object.isFrozen(RUNTIME_SETTINGS_KEYS)).toBe(true)
  })

  test('memorySlug is the repo folder name and the first 8 hex characters of the hash (D-91)', () => {
    expect(memorySlug('/repo/.git', HASH)).toBe('repo-1a2b3c4d')
  })

  test('memorySlug of a linked worktree is named after the main checkout that holds the common dir', () => {
    expect(memorySlug('/w/main/.git', HASH)).toBe('main-1a2b3c4d')
  })

  test('memorySlug replaces each character outside letters, digits, dot, underscore and dash with a dash', () => {
    expect(memorySlug('/w/my repo/.git', HASH)).toBe('my-repo-1a2b3c4d')
    expect(memorySlug('/w/a(b)@c/.git', HASH)).toBe('a-b--c-1a2b3c4d')
    expect(memorySlug('/w/x\u{1F600}y/.git', HASH)).toBe('x-y-1a2b3c4d')
  })

  test('memorySlug keeps only the first 8 characters of the hash and always stays one path segment', () => {
    expect(memorySlug('/repo/.git', 'ffffffff00000000')).toBe('repo-ffffffff')
    expect(memorySlug('/repo/.git', `../../evil${'0'.repeat(54)}`)).toBe('repo-..-..-ev')
    expect(memorySlug('/repo/.git', `../../evil${'0'.repeat(54)}`)).not.toContain('/')
  })

  test('memorySlug ignores a trailing slash and names a common dir with no parent folder repo', () => {
    expect(memorySlug('/repo/.git/', HASH)).toBe('repo-1a2b3c4d')
    expect(memorySlug('/.git', HASH)).toBe('repo-1a2b3c4d')
  })

  test('roleMemoryDir is the absolute memory folder of the role under the home folder (D-20, D-91, S2)', () => {
    expect(roleMemoryDir(user(), 'pm')).toBe('/home/u/.claude/cadre/repo-1a2b3c4d/pm')
    expect(roleMemoryDir(user({ gitCommonDir: '/w/main/.git', root: '/w/wt' }), 'be')).toBe(
      '/home/u/.claude/cadre/main-1a2b3c4d/be',
    )
  })

  test('roleMemoryDir stays under <home>/.claude/cadre, as the scope card promises, even with a config dir', () => {
    expect(roleMemoryDir(user({ userDir: '/cfg' }), 'pm')).toBe('/home/u/.claude/cadre/repo-1a2b3c4d/pm')
  })

  test('launchPlan renders the memory dir, the carried values and exact denies for a PM (D-84, D-91, P13)', () => {
    const role = templateRole('pm', { carry: CARRY_ALL })
    const scope = compileScope(role, context({ codeDirs: ['cadre'] }))
    const plan = launchPlan(role, scope, carrier())

    expect(plan.settings).toEqual({
      autoCompactWindow: 800000,
      autoMemoryDirectory: '/home/u/.claude/cadre/repo-1a2b3c4d/pm',
      claudeMdExcludes: [],
      enabledPlugins: { 'agent-fleet@local-mods': true, 'autopilot@local-mods': true, 'cadre@local-mods': true },
      env: { JIRA_URL: 'https://j' },
      hooks: {
        PreToolUse: [
          { hooks: [{ type: 'command', command: 'node /home/u/.claude/hooks/gsd-secret-read-guard.js' }] },
        ],
      },
      permissions: {
        defaultMode: 'auto',
        deny: [
          'Bash',
          'Edit(//repo/cadre/**)',
          'Read(./.env)',
          'Read(./.env.*)',
          'Read(//repo/cadre/**)',
          'Read(~/.aws/**)',
          'Read(~/.ssh/**)',
        ],
      },
      sandbox: { enabled: false },
      statusLine: { type: 'command', command: '/home/u/x.js' },
    })
    expect(plan.links).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  test('the permissions of the render hold the deny list of runtimeDeny', () => {
    const role = templateRole('pm', { carry: CARRY_ALL })
    const scope = compileScope(role, context({ codeDirs: ['cadre'] }))
    const plan = launchPlan(role, scope, carrier())

    expect(plan.settings.permissions).toEqual({
      defaultMode: 'auto',
      deny: runtimeDeny(role, scope, carrier()).deny,
    })
  })

  test('the rendered settings hold only the allowed keys, in the order of the allow-list', () => {
    const role = templateRole('pm', { carry: CARRY_ALL })
    const scope = compileScope(role, context({ codeDirs: ['cadre'] }))
    const keys = Object.keys(launchPlan(role, scope, carrier()).settings)

    expect(keys.filter(key => !RUNTIME_SETTINGS_KEYS.includes(key))).toEqual([])
    expect(keys).toEqual(RUNTIME_SETTINGS_KEYS)
  })

  test('only the env names the role carries are rendered, and no other value is in the result', () => {
    const role = templateRole('pm', { carry: CARRY_ALL })
    const scope = compileScope(role, context())
    const plan = launchPlan(role, scope, carrier())
    const text = JSON.stringify(plan)

    expect(plan.settings.env).toEqual({ JIRA_URL: 'https://j' })
    expect(text).not.toContain('API_KEY')
    expect(text).not.toContain('"k"')
  })

  test('a carried env name the user has no value for is left out, and so is an empty env', () => {
    const role = templateRole('pm', { carry: { ...CARRY_ALL, env: ['JIRA_URL', 'MISSING'] } })
    const scope = compileScope(role, context())
    const some = launchPlan(role, scope, carrier({ env: { JIRA_URL: 'https://j' } }))
    const none = launchPlan(role, scope, carrier({ env: { OTHER: 'x' } }))

    expect(some.settings.env).toEqual({ JIRA_URL: 'https://j' })
    expect(Object.keys(none.settings)).not.toContain('env')
  })

  test('an env name that is a property of every object is never read as a value', () => {
    const role = templateRole('pm', { carry: { ...CARRY_ALL, env: ['constructor', 'toString', '__proto__'] } })
    const scope = compileScope(role, context())
    const plan = launchPlan(role, scope, carrier({ env: {} }))

    expect(Object.keys(plan.settings)).not.toContain('env')
  })

  test('an env value the user object only inherits is not the value of the user settings and is not rendered', () => {
    const role = templateRole('pm', { carry: CARRY_ALL })
    const scope = compileScope(role, context())
    const inherited = Object.create({ JIRA_URL: 'SENTINEL_SECRET_VALUE' })
    const plan = launchPlan(role, scope, carrier({ env: inherited }))

    expect(Object.keys(plan.settings)).not.toContain('env')
    expect(JSON.stringify(plan)).not.toContain('SENTINEL_SECRET_VALUE')
  })

  test('a value the role does not carry, or the user does not have, is not rendered', () => {
    const scope = compileScope(templateRole('pm'), context())
    const notCarried = launchPlan(templateRole('pm'), scope, carrier())
    const notHad = launchPlan(templateRole('pm', { carry: CARRY_ALL }), scope, user())
    const base = ['autoMemoryDirectory', 'claudeMdExcludes', 'enabledPlugins', 'permissions', 'sandbox']

    expect(Object.keys(notCarried.settings)).toEqual(base)
    expect(Object.keys(notHad.settings)).toEqual(base)
  })

  test('a role that carries nothing gets only the plugins, permissions, sandbox, memory dir and excludes', () => {
    const role = templateRole('be')
    const scope = compileScope(role, context({ codeDirs: ['cadre'] }))
    const plan = launchPlan(role, scope, carrier())

    expect(plan.settings).toEqual({
      autoMemoryDirectory: '/home/u/.claude/cadre/repo-1a2b3c4d/be',
      claudeMdExcludes: [],
      enabledPlugins: { 'agent-fleet@local-mods': true, 'autopilot@local-mods': true, 'cadre@local-mods': true },
      permissions: {
        defaultMode: 'auto',
        deny: ['Read(./.env)', 'Read(./.env.*)', 'Read(~/.aws/**)', 'Read(~/.ssh/**)'],
      },
      sandbox: { enabled: true },
    })
  })

  test('the context monitor hook is never rendered, even when the role lists it (D-62)', () => {
    const names = ['gsd-context-monitor.js', 'GSD-Context-Monitor.JS', 'gsd-context-monitor-v2.js']
    const carry = { ...CARRY_ALL, hooks: ['gsd-secret-read-guard.js', ...names] }
    const role = templateRole('be', { carry })
    const scope = compileScope(role, context())
    const monitors = names.map((script, index) => ({ event: 'Stop', script, command: `node /home/u/m${index}.js` }))
    const plan = launchPlan(role, scope, carrier({ hooks: [...USER_HOOKS, ...monitors] }))
    const text = JSON.stringify(plan.settings.hooks)

    expect(text).toContain('gsd-secret-read-guard.js')
    expect(text).not.toContain('/home/u/m')
    expect(Object.keys(plan.settings.hooks ?? {})).toEqual(['PreToolUse'])
  })

  test('hooks are grouped by event in the order given, each command in the order given', () => {
    const carry = { ...CARRY_ALL, hooks: ['a.js', 'b.js', 'c.js'] }
    const role = templateRole('be', { carry })
    const scope = compileScope(role, context())
    const hooks = [
      { event: 'PreToolUse', script: 'a.js', command: 'node /h/a.js' },
      { event: 'PostToolUse', script: 'b.js', command: 'node /h/b.js' },
      { event: 'PreToolUse', script: 'c.js', command: 'node /h/c.js' },
      { event: 'PreToolUse', script: 'd.js', command: 'node /h/d.js' },
    ]
    const rendered = launchPlan(role, scope, carrier({ hooks })).settings.hooks

    expect(rendered).toEqual({
      PreToolUse: [
        {
          hooks: [
            { type: 'command', command: 'node /h/a.js' },
            { type: 'command', command: 'node /h/c.js' },
          ],
        },
      ],
      PostToolUse: [{ hooks: [{ type: 'command', command: 'node /h/b.js' }] }],
    })
    expect(Object.keys(rendered ?? {})).toEqual(['PreToolUse', 'PostToolUse'])
  })

  test('renderRuntimeSettings puts the given CLAUDE.md excludes into the settings', () => {
    const role = templateRole('be')
    const scope = compileScope(role, context())
    const settings = renderRuntimeSettings(role, scope, user(), ['/x/CLAUDE.md', '/y/CLAUDE.md'])

    expect(settings.claudeMdExcludes).toEqual(['/x/CLAUDE.md', '/y/CLAUDE.md'])
  })

  test('the launch half changes none of its inputs and keeps nothing between two calls (D-98)', () => {
    const role = templateRole('pm', { carry: CARRY_ALL })
    const scope = compileScope(role, context({ codeDirs: ['cadre'] }))
    const launcher = carrier()
    const before = JSON.stringify({ role, scope, launcher })
    const first = launchPlan(role, scope, launcher)
    const other = launchPlan(templateRole('be'), compileScope(templateRole('be'), context()), user())
    const second = launchPlan(role, scope, launcher)

    expect(JSON.stringify({ role, scope, launcher })).toBe(before)
    expect(second).toEqual(first)
    expect(JSON.stringify(other)).not.toContain('JIRA_URL')
  })
})

describe('runtimeDeny', () => {
  test('lintRuntimeDenyPattern accepts an exact absolute pattern', () => {
    expect(lintRuntimeDenyPattern('Read(//repo/cadre/**)')).toBeNull()
    expect(lintRuntimeDenyPattern('Edit(//repo/cadre/**)')).toBeNull()
    expect(lintRuntimeDenyPattern('Write(//repo/x..y/**)')).toBeNull()
  })

  test('lintRuntimeDenyPattern refuses a .. segment in an absolute pattern', () => {
    expect(lintRuntimeDenyPattern('Read(//repo/../x/**)')).toBe('a .. segment is not allowed in an absolute pattern')
    expect(lintRuntimeDenyPattern('Edit(//../x/**)')).toBe('a .. segment is not allowed in an absolute pattern')
  })

  test('lintRuntimeDenyPattern refuses a single leading slash and an infra tool, as the committed lint does', () => {
    expect(lintRuntimeDenyPattern('Read(/repo/x/**)')).toBe('single leading / matches nothing (P13)')
    expect(lintRuntimeDenyPattern('mcp__autopilot')).toBe('would block an infra tool (ISO-04)')
    expect(lintRuntimeDenyPattern('Skill')).toBe('would block an infra tool (ISO-04)')
  })

  test('lintRuntimeDenyPattern answers every other pattern as the committed lint does', () => {
    expect(lintRuntimeDenyPattern('Bash')).toBeNull()
    expect(lintRuntimeDenyPattern('Read(./x/**)')).toBeNull()
    expect(lintRuntimeDenyPattern('Read(~/.ssh/**)')).toBeNull()
    expect(lintRuntimeDenyPattern('mcp__jira')).toBeNull()
  })

  test('the any-depth code dir denies are replaced by exact ones, and the secret and Bash denies stay', () => {
    const role = templateRole('pm')
    const scope = compileScope(role, context({ codeDirs: ['cadre'] }))
    const launcher = user({ codeDirs: ['cadre', 'pm', 'src', 'thoughts'] })

    expect(runtimeDeny(role, scope, launcher)).toEqual({
      deny: [
        'Bash',
        'Edit(//repo/cadre/**)',
        'Edit(//repo/pm/**)',
        'Edit(//repo/src/**)',
        'Read(./.env)',
        'Read(./.env.*)',
        'Read(//repo/cadre/**)',
        'Read(//repo/pm/**)',
        'Read(//repo/src/**)',
        'Read(~/.aws/**)',
        'Read(~/.ssh/**)',
      ],
      warnings: [],
    })
  })

  test('a dir the template had to skip for its name is denied exactly, since an exact pattern hits one folder', () => {
    const role = templateRole('pm')
    const scope = compileScope(role, context({ codeDirs: ['shared', 'handoffs', 'src'] }))
    const launcher = user({ codeDirs: ['shared', 'handoffs', 'src'] })

    expect(coveredPrefixes(runtimeDeny(role, scope, launcher).deny)).toEqual([
      '/repo/handoffs/',
      '/repo/shared/',
      '/repo/src/',
      '/repo/handoffs/',
      '/repo/shared/',
      '/repo/src/',
    ])
  })

  test('the own folders of the role are never covered: no pattern reads as a prefix of them (D-80, P13)', () => {
    const role = templateRole('pm')
    const scope = compileScope(role, context({ codeDirs: ['cadre'] }))
    const launcher = user({ codeDirs: ['.cadre', '.planning', 'cadre', 'pm', 'src', 'thoughts'] })
    const covered = coveredPrefixes(runtimeDeny(role, scope, launcher).deny)
    const own = ['/repo/.cadre/pm/', '/repo/thoughts/shared/handoffs/pm/', '/repo/.planning/']

    expect(covered).toContain('/repo/src/')
    expect(covered).toContain('/repo/pm/')
    expect(own.filter(path => covered.some(prefix => path.startsWith(prefix)))).toEqual([])
  })

  test('an own folder named in another letter case is skipped too, since the file system may ignore case', () => {
    const role = templateRole('pm')
    const scope = compileScope(role, context())
    const launcher = user({ codeDirs: ['Thoughts', '.PLANNING', '.Cadre', 'src'] })

    expect(coveredPrefixes(runtimeDeny(role, scope, launcher).deny)).toEqual(['/repo/src/', '/repo/src/'])
  })

  test('a role that is not named pm has its own folders, and only those, left readable', () => {
    const role = templateRole('pm', { id: 'product', basedOn: 'pm' })
    const scope = compileScope(role, context())
    const launcher = user({ codeDirs: ['pm', 'product', 'thoughts'] })

    expect(coveredPrefixes(runtimeDeny(role, scope, launcher).deny)).toEqual([
      '/repo/pm/',
      '/repo/product/',
      '/repo/pm/',
      '/repo/product/',
    ])
  })

  test('the deny list is sorted and has every entry once, whatever order the code dirs come in', () => {
    const role = templateRole('pm')
    const scope = compileScope(role, context())
    const a = runtimeDeny(role, scope, user({ codeDirs: ['src', 'cadre', 'src'] }))
    const b = runtimeDeny(role, scope, user({ codeDirs: ['cadre', 'src'] }))

    expect(a).toEqual(b)
    expect(a.deny).toEqual([...a.deny].sort())
    expect(new Set(a.deny).size).toBe(a.deny.length)
  })

  test('a role with Bash gets its template deny unchanged', () => {
    const role = templateRole('be')
    const scope = compileScope(role, context({ codeDirs: ['cadre'] }))

    expect(runtimeDeny(role, scope, user({ codeDirs: ['cadre', 'src'] }))).toEqual({
      deny: scope.settings.permissions.deny,
      warnings: [],
    })
  })

  test('a role with Bash is not warned about the repo path, since its template holds no code-dir deny', () => {
    const role = templateRole('be')
    const scope = compileScope(role, context())

    expect(runtimeDeny(role, scope, user({ root: '/w/a(b)', codeDirs: ['src'] }))).toEqual({
      deny: scope.settings.permissions.deny,
      warnings: [],
    })
  })

  test('a repo path with a character a permission rule cannot hold keeps the any-depth denies and warns', () => {
    const role = templateRole('pm')
    const scope = compileScope(role, context({ codeDirs: ['cadre'] }))
    const launcher = user({ root: '/w/a(b)', codeDirs: ['cadre', 'src'] })

    expect(runtimeDeny(role, scope, launcher)).toEqual({
      deny: scope.settings.permissions.deny,
      warnings: [
        'the repo path holds characters a permission rule cannot hold: code-dir denies stay any-depth',
      ],
    })
  })

  test('a repo path that is not plain and canonical is unsafe: a space, a dot segment, a double slash', () => {
    const role = templateRole('pm')
    const scope = compileScope(role, context({ codeDirs: ['cadre'] }))
    const roots = ['/w/a b', '/w/a/../b', '/w/a/./b', '/w/a//b', '/repo/', '/', '/w/é']
    const results = roots.map(root => runtimeDeny(role, scope, user({ root, codeDirs: ['cadre'] })))

    expect(results.map(result => result.deny)).toEqual(roots.map(() => scope.settings.permissions.deny))
    expect(results.map(result => result.warnings.length)).toEqual(roots.map(() => 1))
  })

  test('a root with letters, digits, dots, underscores, dashes and slashes is safe', () => {
    const role = templateRole('pm')
    const scope = compileScope(role, context())
    const launcher = user({ root: '/srv/me_1/work.d/claude-mods', codeDirs: ['src'] })

    expect(coveredPrefixes(runtimeDeny(role, scope, launcher).deny)).toEqual([
      '/srv/me_1/work.d/claude-mods/src/',
      '/srv/me_1/work.d/claude-mods/src/',
    ])
    expect(runtimeDeny(role, scope, launcher).warnings).toEqual([])
  })

  test('a code dir with an unusual name gets no pattern, and a warning names it cleaned', () => {
    const role = templateRole('pm')
    const scope = compileScope(role, context())
    const launcher = user({ codeDirs: ['a b', '*', '..', 'x)', 'src'] })
    const result = runtimeDeny(role, scope, launcher)

    expect(coveredPrefixes(result.deny)).toEqual(['/repo/src/', '/repo/src/'])
    expect(result.warnings).toEqual([
      'Code dir * has an unusual name and is not denied',
      'Code dir .. has an unusual name and is not denied',
      'Code dir a b has an unusual name and is not denied',
      'Code dir x) has an unusual name and is not denied',
    ])
  })

  test('a template entry the runtime lint refuses is dropped with a warning that names the reason', () => {
    const role = templateRole('pm')
    const base = compileScope(role, context())
    const scope = withDeny(withDeny(base, 'Read(/repo/x/**)'), 'mcp__autopilot')
    const result = runtimeDeny(role, scope, user({ codeDirs: ['src'] }))

    expect(result.deny).toEqual(runtimeDeny(role, base, user({ codeDirs: ['src'] })).deny)
    expect(result.warnings).toEqual([
      'Read(/repo/x/**) was not emitted: single leading / matches nothing (P13)',
      'mcp__autopilot was not emitted: would block an infra tool (ISO-04)',
    ])
  })

  test('every deny of the result passes the runtime lint', () => {
    const role = templateRole('pm')
    const scope = compileScope(role, context({ codeDirs: ['cadre', 'src'] }))
    const result = runtimeDeny(role, scope, user({ codeDirs: ['cadre', 'src', 'docs'] }))

    expect(result.deny.filter(entry => lintRuntimeDenyPattern(entry) !== null)).toEqual([])
    expect(result.deny).toContain('Read(//repo/docs/**)')
  })
})

/** The CLAUDE.md files the engine loads for the fixture repo: its own, the one in `.claude` and an ancestor's. */
const CHAIN = ['/repo/CLAUDE.md', '/repo/.claude/CLAUDE.md', '/home/u/work/CLAUDE.md']

/** The folder the instruction links of the PM are created in, for the group `global` or `memory`. */
function linkDir(group: 'global' | 'memory'): string {
  return `/repo/.cadre/pm/.runtime/instructions/${group}`
}

describe('claudeMdImports', () => {
  const imports = (text: string): string[] => claudeMdImports(text, '/home/u/.claude', '/home/u')

  test('it finds the files a CLAUDE.md imports, resolved against its folder and the home, sorted', () => {
    const text = 'See @~/notes/a.md and @./b.md\n`@./code.md`\n@../c.md\nmail me@x.org\n@d.md'

    expect(imports(text)).toEqual([
      '/home/u/.claude/b.md',
      '/home/u/.claude/d.md',
      '/home/u/c.md',
      '/home/u/notes/a.md',
    ])
  })

  test('an absolute path is kept, and a dot or dot-dot segment is resolved away', () => {
    expect(imports('@/etc/x/../y.md and @/opt/./z.txt')).toEqual(['/etc/y.md', '/opt/z.txt'])
  })

  test('a path given twice, in any spelling, is listed once', () => {
    expect(imports('@./b.md @b.md @./x/../b.md\n@~/../u/.claude/b.md')).toEqual(['/home/u/.claude/b.md'])
  })

  test('a .. segment cannot climb above the root of the file system', () => {
    expect(imports('@../../../../../x.md')).toEqual(['/x.md'])
  })

  test('a bare name needs .md, while a path that starts with ~/, ./, ../ or / needs no extension', () => {
    expect(imports('@README @notes.md @docs/x.md @./dir/file @~/f.txt @/abs/g')).toEqual([
      '/abs/g',
      '/home/u/.claude/dir/file',
      '/home/u/.claude/docs/x.md',
      '/home/u/.claude/notes.md',
      '/home/u/f.txt',
    ])
  })

  test('an import inside an inline code span, a double-backtick span or a fenced block is ignored', () => {
    const text = [
      'Use `@./a.md` to import.',
      '```markdown',
      '@./b.md',
      '```',
      'Also ``x @./c.md y`` here and @./d.md.',
    ].join('\n')

    expect(imports(text)).toEqual(['/home/u/.claude/d.md'])
  })

  test('a backtick that closes nothing is plain text and hides no import', () => {
    expect(imports('it`s here\n@./a.md')).toEqual(['/home/u/.claude/a.md'])
  })

  test('a fence of four backticks is not closed by a fence of three inside it', () => {
    expect(imports('````\n```\n@./a.md\n```\n````\n@./b.md')).toEqual(['/home/u/.claude/b.md'])
  })

  test('an e-mail address, and a word with an @ inside it, are not imports', () => {
    expect(imports('write to me@x.md or a@b.md, c.d@e.md')).toEqual([])
  })

  test('a mark right before the @, such as a parenthesis or a quote, makes it plain text', () => {
    expect(imports('(@./a.md) "@./b.md" see @./c.md')).toEqual(['/home/u/.claude/c.md'])
  })

  test('a sentence mark after the path is not part of it', () => {
    expect(imports('see @./b.md, then @./c.md. And @./d.md)')).toEqual([
      '/home/u/.claude/b.md',
      '/home/u/.claude/c.md',
      '/home/u/.claude/d.md',
    ])
  })

  test('a heading, a flag, a folder and a lone mark are not imports', () => {
    expect(imports('@#section @-flag @./dir/ @/ @. @.. @')).toEqual([])
  })

  test('a token after a tab or at the very start of the text counts', () => {
    expect(imports('@./a.md\n\t@./b.md')).toEqual(['/home/u/.claude/a.md', '/home/u/.claude/b.md'])
  })

  test('text with no import, and empty text, give nothing', () => {
    expect(imports('')).toEqual([])
    expect(imports('# Notes\n\nNothing is imported here.')).toEqual([])
  })

  test('no result holds a . or .. segment, whatever the spelling', () => {
    const found = imports('@./a/./b.md @../../../c.md @~/./d/../e.md @/f/../../g.md @h/./i.md')

    expect(found).toHaveLength(5)
    expect(found.filter(path => /(^|\/)\.{1,2}(\/|$)/.test(path))).toEqual([])
  })

  test('many backtick runs that close nothing are plain text and hide no import', () => {
    const runs = Array.from({ length: 300 }, (_, index) => '`'.repeat(index + 1)).join(' ')

    expect(imports(`${runs}\n@./a.md`)).toEqual(['/home/u/.claude/a.md'])
  })
})

describe('instructionPlan', () => {
  test('without the project CLAUDE.md group every CLAUDE.md of the loaded chain is excluded, sorted (P11)', () => {
    const plan = instructionPlan(templateRole('pm'), user({ claudeMd: CHAIN }))

    expect(plan.claudeMdExcludes).toEqual(['/home/u/work/CLAUDE.md', '/repo/.claude/CLAUDE.md', '/repo/CLAUDE.md'])
    expect(plan.links).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  test('with the project CLAUDE.md group nothing is excluded: the chain loads by itself (P11)', () => {
    const role = templateRole('pm', { instructions: ['project-claude-md'] })

    expect(instructionPlan(role, user({ claudeMd: CHAIN })).claudeMdExcludes).toEqual([])
  })

  test('the excludes list each file once, whatever order and repeats the chain comes in', () => {
    const claudeMd = [...[...CHAIN].reverse(), ...CHAIN]
    const plan = instructionPlan(templateRole('pm'), user({ claudeMd }))

    expect(plan.claudeMdExcludes).toEqual(['/home/u/work/CLAUDE.md', '/repo/.claude/CLAUDE.md', '/repo/CLAUDE.md'])
  })

  test('the global CLAUDE.md group links the file and its imports, numbered in the order given', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md'] })
    const global = ['/home/u/.claude/CLAUDE.md', '/home/u/notes/a.md']
    const plan = instructionPlan(role, user({ globalClaudeMd: global }))

    expect(plan.links).toEqual([
      { path: `${linkDir('global')}/01-CLAUDE.md`, target: '/home/u/.claude/CLAUDE.md' },
      { path: `${linkDir('global')}/02-a.md`, target: '/home/u/notes/a.md' },
    ])
    expect(plan.warnings).toEqual([])
  })

  test('two global files with the same name do not clash: the number tells them apart', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md'] })
    const global = ['/home/u/.claude/CLAUDE.md', '/home/u/a/notes.md', '/home/u/b/notes.md']
    const plan = instructionPlan(role, user({ globalClaudeMd: global }))

    expect(plan.links.map(link => link.path)).toEqual([
      `${linkDir('global')}/01-CLAUDE.md`,
      `${linkDir('global')}/02-notes.md`,
      `${linkDir('global')}/03-notes.md`,
    ])
    expect(plan.links.map(link => link.target)).toEqual(global)
  })

  test('with no global file the group plans no link and no warning', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md'] })

    expect(instructionPlan(role, user({ globalClaudeMd: [] }))).toEqual({
      claudeMdExcludes: [],
      links: [],
      warnings: [],
    })
  })

  test('a global file whose name is empty or has hidden characters is not linked and the number is kept', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md'] })
    const hidden = `/home/u/x/a${BIDI_OVERRIDE}b.md`
    const global = ['/home/u/.claude/CLAUDE.md', hidden, '/home/u/x/', '/c.md']
    const plan = instructionPlan(role, user({ globalClaudeMd: global }))

    expect(plan.links.map(link => link.path)).toEqual([
      `${linkDir('global')}/01-CLAUDE.md`,
      `${linkDir('global')}/04-c.md`,
    ])
    expect(plan.warnings).toEqual([
      'global file ab.md has an unsafe name: not linked',
      'global file  has an unsafe name: not linked',
    ])
  })

  test('the memory group links each memory file of this repo to its folder under projects (D-100)', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const plan = instructionPlan(role, user({ memoryFiles: ['MEMORY.md', 'b.md'] }))

    expect(plan.links).toEqual([
      {
        path: `${linkDir('memory')}/MEMORY.md`,
        target: '/home/u/.claude/projects/-repo/memory/MEMORY.md',
      },
      { path: `${linkDir('memory')}/b.md`, target: '/home/u/.claude/projects/-repo/memory/b.md' },
    ])
    expect(plan.warnings).toEqual([])
  })

  test('the memory folder is named after the mangled root and lies in the config dir of the user', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const plan = instructionPlan(role, user({ root: '/w/my repo', userDir: '/cfg', memoryFiles: ['x.md'] }))

    expect(plan.links).toEqual([
      {
        path: '/w/my repo/.cadre/pm/.runtime/instructions/memory/x.md',
        target: '/cfg/projects/-w-my-repo/memory/x.md',
      },
    ])
  })

  test('a memory name with a slash, a .. segment or a leading dot is not linked and warns', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const names = ['../x.md', '.hidden.md', '..', 'a/b.md', 'a..b.md', 'ok.md', '']
    const plan = instructionPlan(role, user({ memoryFiles: names }))

    expect(plan.links.map(link => link.path)).toEqual([`${linkDir('memory')}/a..b.md`, `${linkDir('memory')}/ok.md`])
    expect(plan.warnings).toEqual([
      'memory file  has an unsafe name: not linked',
      'memory file .. has an unsafe name: not linked',
      'memory file ../x.md has an unsafe name: not linked',
      'memory file .hidden.md has an unsafe name: not linked',
      'memory file a/b.md has an unsafe name: not linked',
    ])
  })

  test('a memory name with hidden characters is not linked, and the warning shows it cleaned', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const plan = instructionPlan(role, user({ memoryFiles: [`ev${BIDI_OVERRIDE}il.md`] }))

    expect(plan.links).toEqual([])
    expect(plan.warnings).toEqual(['memory file evil.md has an unsafe name: not linked'])
  })

  test('a memory file listed twice is linked once', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })

    expect(instructionPlan(role, user({ memoryFiles: ['b.md', 'b.md'] })).links).toHaveLength(1)
  })

  test('a role without the global or memory group gets no link of that group, whatever exists on disk', () => {
    const files = { globalClaudeMd: ['/home/u/.claude/CLAUDE.md'], memoryFiles: ['MEMORY.md'] }
    const none = instructionPlan(templateRole('pm'), user(files))
    const onlyGlobal = instructionPlan(templateRole('pm', { instructions: ['global-claude-md'] }), user(files))
    const onlyMemory = instructionPlan(templateRole('pm', { instructions: ['auto-memory'] }), user(files))
    const onlyProject = instructionPlan(templateRole('pm', { instructions: ['project-claude-md'] }), user(files))

    expect(none.links).toEqual([])
    expect(onlyProject.links).toEqual([])
    expect(onlyGlobal.links.map(link => link.path)).toEqual([`${linkDir('global')}/01-CLAUDE.md`])
    expect(onlyMemory.links.map(link => link.path)).toEqual([`${linkDir('memory')}/MEMORY.md`])
  })

  test('the links of both groups are sorted by path and lie in the instructions folder of the role', () => {
    const role = templateRole('pm', { instructions: ['auto-memory', 'global-claude-md'] })
    const launcher = user({ globalClaudeMd: ['/home/u/.claude/CLAUDE.md'], memoryFiles: ['MEMORY.md'] })
    const paths = instructionPlan(role, launcher).links.map(link => link.path)

    expect(paths).toEqual([`${linkDir('global')}/01-CLAUDE.md`, `${linkDir('memory')}/MEMORY.md`])
    expect(paths.filter(path => !path.startsWith('/repo/.cadre/pm/.runtime/instructions/'))).toEqual([])
  })

  test('launchPlan puts the excludes into the settings and appends the links and the warnings', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md', 'auto-memory'], carry: CARRY_ALL })
    const scope = compileScope(role, context())
    const launcher = carrier({
      claudeMd: CHAIN,
      globalClaudeMd: ['/home/u/.claude/CLAUDE.md'],
      memoryFiles: ['MEMORY.md', '.bad.md'],
    })
    const plan = launchPlan(role, scope, launcher)

    expect(plan.settings.claudeMdExcludes).toEqual([
      '/home/u/work/CLAUDE.md',
      '/repo/.claude/CLAUDE.md',
      '/repo/CLAUDE.md',
    ])
    expect(plan.links).toEqual([
      { path: `${linkDir('global')}/01-CLAUDE.md`, target: '/home/u/.claude/CLAUDE.md' },
      { path: `${linkDir('memory')}/MEMORY.md`, target: '/home/u/.claude/projects/-repo/memory/MEMORY.md' },
    ])
    expect(plan.warnings).toEqual(['memory file .bad.md has an unsafe name: not linked'])
  })

  test('launchPlan lists the warnings of the denies before those of the instructions', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const scope = compileScope(role, context())
    const plan = launchPlan(role, scope, user({ root: '/w/a(b)', memoryFiles: ['../x.md'] }))

    expect(plan.warnings).toEqual([
      'the repo path holds characters a permission rule cannot hold: code-dir denies stay any-depth',
      'memory file ../x.md has an unsafe name: not linked',
    ])
  })

  test('a role given the project CLAUDE.md has no exclude in its settings', () => {
    const role = templateRole('pm', { instructions: ['project-claude-md'] })
    const plan = launchPlan(role, compileScope(role, context()), user({ claudeMd: CHAIN }))

    expect(plan.settings.claudeMdExcludes).toEqual([])
  })
})
