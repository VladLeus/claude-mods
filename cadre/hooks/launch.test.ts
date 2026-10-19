import { describe, expect, test } from 'claude-code/testing'

import type {
  CompiledScope,
  FrameworkId,
  HookScript,
  McpRef,
  RoleSpec,
  ScopeContext,
  SettingsTemplate,
  SetupScan,
  SkillRef,
  TemplateRoleId,
} from '../types'
import { FRAMEWORK_START_SKILLS, INFRA_SKILLS } from './assign'
import { isObject, sortedUnique } from './facts'
import {
  claudeMdImports,
  instructionPlan,
  launchPlan,
  lintRuntimeDenyPattern,
  memorySlug,
  overlayLinks,
  renderRuntimeSettings,
  roleMemoryDir,
  RUNTIME_SETTINGS_KEYS,
  runtimeDeny,
} from './launch'
import type { LaunchPlan, LaunchUser, OverlayLink } from './launch'
import { ROLE_TEMPLATE, roleFromTemplate } from './roles'
import { compileScope, infraViolations, roleOwnPaths } from './scope'
import { BIDI_OVERRIDE, leaks, SECRET_FIXTURES } from './testkit'

/** The fixture hash: the 8 characters the memory slug shows, then 56 zeros. */
const HASH = `1a2b3c4d${'0'.repeat(56)}`

/** The launching user of the fixtures: repo /repo, home /home/u, nothing to carry; `over` changes named fields. */
function user(over: Partial<LaunchUser> = {}): LaunchUser {
  return {
    root: '/repo',
    givenRoot: '/repo',
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
    givenMemoryFiles: [],
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
    matcher: null,
    timeout: null,
  },
  {
    event: 'PostToolUse',
    script: 'gsd-context-monitor.js',
    command: 'node /home/u/m.js',
    matcher: null,
    timeout: null,
  },
]

/** The skills every role on GSD has in its overlay: the handoff skills and the start skills of GSD. */
const GSD_SKILLS: readonly string[] = [...INFRA_SKILLS, ...FRAMEWORK_START_SKILLS.gsd]

/** A launching user that has something to carry, the skills of a GSD overlay, and one env value no role carries. */
function carrier(over: Partial<LaunchUser> = {}): LaunchUser {
  return user({
    autoCompactWindow: 800000,
    statusLine: { type: 'command', command: '/home/u/x.js' },
    env: { JIRA_URL: 'https://j', API_KEY: 'k' },
    hooks: USER_HOOKS,
    codeDirs: ['cadre'],
    userSkills: GSD_SKILLS,
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

  test('memorySlug names a bare repo and a submodule after their own folder, one trailing .git removed (B7)', () => {
    expect(memorySlug('/srv/repo.git', HASH)).toBe('repo-1a2b3c4d')
    expect(memorySlug('/srv/repo.git/', HASH)).toBe('repo-1a2b3c4d')
    expect(memorySlug('/super/.git/modules/sub', HASH)).toBe('sub-1a2b3c4d')
    expect(memorySlug('/srv/x.git.git', HASH)).toBe('x.git-1a2b3c4d')
  })

  test('memorySlug names the root folder, or an empty common dir, repo', () => {
    expect(memorySlug('/', HASH)).toBe('repo-1a2b3c4d')
    expect(memorySlug('', HASH)).toBe('repo-1a2b3c4d')
  })

  test('roleMemoryDir is the absolute memory folder of the role under the home folder (D-20, D-91, S2)', () => {
    expect(roleMemoryDir(user(), 'pm')).toBe('/home/u/.claude/cadre/repo-1a2b3c4d/pm')
    expect(roleMemoryDir(user({ gitCommonDir: '/w/main/.git', root: '/w/wt' }), 'be')).toBe(
      '/home/u/.claude/cadre/main-1a2b3c4d/be',
    )
  })

  test('roleMemoryDir follows the config dir of the user (CLAUDE_CONFIG_DIR, else ~/.claude), as the card says', () => {
    expect(roleMemoryDir(user({ userDir: '/cfg' }), 'pm')).toBe('/cfg/cadre/repo-1a2b3c4d/pm')
    expect(roleMemoryDir(user(), 'pm')).toBe('/home/u/.claude/cadre/repo-1a2b3c4d/pm')
  })

  test('the rendered memory dir lies in the config dir of the user', () => {
    const role = templateRole('pm')
    const plan = launchPlan(role, compileScope(role, context()), user({ userDir: '/cfg', userSkills: GSD_SKILLS }))

    expect(plan.settings.autoMemoryDirectory).toBe('/cfg/cadre/repo-1a2b3c4d/pm')
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
    expect(plan.links).toHaveLength(GSD_SKILLS.length)
    expect(plan.links.filter(link => !link.path.includes('/overlay/.claude/skills/'))).toEqual([])
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

  test('the env holds the carried names in name order, whatever order the role lists them', () => {
    const role = templateRole('pm', { carry: { ...CARRY_ALL, env: ['ZED', 'JIRA_URL', 'ALPHA'] } })
    const scope = compileScope(role, context())
    const env = { ZED: 'z', JIRA_URL: 'https://j', ALPHA: 'a' }
    const plan = launchPlan(role, scope, carrier({ env }))

    expect(Object.keys(plan.settings.env ?? {})).toEqual(['ALPHA', 'JIRA_URL', 'ZED'])
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
    const monitors = names.map((script, index) => ({
      event: 'Stop',
      script,
      command: `node /home/u/m${index}.js`,
      matcher: null,
      timeout: null,
    }))
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
      { event: 'PreToolUse', script: 'a.js', command: 'node /h/a.js', matcher: null, timeout: null },
      { event: 'PostToolUse', script: 'b.js', command: 'node /h/b.js', matcher: null, timeout: null },
      { event: 'PreToolUse', script: 'c.js', command: 'node /h/c.js', matcher: null, timeout: null },
      { event: 'PreToolUse', script: 'd.js', command: 'node /h/d.js', matcher: null, timeout: null },
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

  test('carried hooks keep their matcher and timeout: one group per event and matcher, in the order given (A7)', () => {
    const carry = { ...CARRY_ALL, hooks: ['a.js', 'b.js', 'c.js', 'd.js'] }
    const role = templateRole('be', { carry })
    const scope = compileScope(role, context())
    const hooks = [
      { event: 'PreToolUse', script: 'a.js', command: 'node /h/a.js', matcher: 'Read|Grep', timeout: 30 },
      { event: 'PreToolUse', script: 'b.js', command: 'node /h/b.js', matcher: 'Bash', timeout: null },
      { event: 'PreToolUse', script: 'c.js', command: 'node /h/c.js', matcher: 'Read|Grep', timeout: null },
      { event: 'Stop', script: 'd.js', command: 'node /h/d.js', matcher: null, timeout: null },
    ]
    const rendered = launchPlan(role, scope, carrier({ hooks })).settings.hooks

    expect(rendered).toEqual({
      PreToolUse: [
        {
          matcher: 'Read|Grep',
          hooks: [
            { type: 'command', command: 'node /h/a.js', timeout: 30 },
            { type: 'command', command: 'node /h/c.js' },
          ],
        },
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'node /h/b.js' }] },
      ],
      Stop: [{ hooks: [{ type: 'command', command: 'node /h/d.js' }] }],
    })
  })

  test('a group without a matcher has no matcher key, and a hook without a timeout no timeout key', () => {
    const carry = { ...CARRY_ALL, hooks: ['a.js', 'b.js'] }
    const role = templateRole('be', { carry })
    const scope = compileScope(role, context())
    const hooks = [
      { event: 'Stop', script: 'a.js', command: 'node /h/a.js', matcher: null, timeout: null },
      { event: 'Stop', script: 'b.js', command: 'node /h/b.js', matcher: '', timeout: 0 },
    ]
    const rendered = launchPlan(role, scope, carrier({ hooks })).settings.hooks

    expect(JSON.stringify(rendered)).toBe(
      JSON.stringify({
        Stop: [
          { hooks: [{ type: 'command', command: 'node /h/a.js' }] },
          { matcher: '', hooks: [{ type: 'command', command: 'node /h/b.js', timeout: 0 }] },
        ],
      }),
    )
  })

  test('the context monitor is never rendered, whatever matcher or timeout it has (D-62)', () => {
    const carry = { ...CARRY_ALL, hooks: ['gsd-context-monitor.js'] }
    const role = templateRole('be', { carry })
    const scope = compileScope(role, context())
    const monitor = { event: 'PostToolUse', script: 'gsd-context-monitor.js', command: 'node /home/u/m.js' }
    const hooks = [{ ...monitor, matcher: '*', timeout: 9 }]

    expect(Object.keys(launchPlan(role, scope, carrier({ hooks })).settings)).not.toContain('hooks')
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

  test('a template code-dir deny the launch scan missed is still denied, exactly (B1)', () => {
    const role = templateRole('pm')
    const scope = compileScope(role, context({ codeDirs: ['cadre', 'src'] }))
    const missed = runtimeDeny(role, scope, user({ codeDirs: ['src'] }))
    const none = runtimeDeny(role, scope, user({ codeDirs: [] }))

    expect(scope.settings.permissions.deny).toContain('Read(./cadre/**)')
    expect(missed.deny).toContain('Read(//repo/cadre/**)')
    expect(missed.deny).toContain('Edit(//repo/cadre/**)')
    expect(missed.deny).not.toContain('Read(./cadre/**)')
    expect(missed.warnings).toEqual([])
    expect(coveredPrefixes(none.deny)).toEqual(['/repo/cadre/', '/repo/src/', '/repo/cadre/', '/repo/src/'])
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

  test('a global file keeps its name behind the number, even a hidden name or one with a space', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md'] })
    const global = ['/home/u/.claude/CLAUDE.md', '/home/u/.claude/.rules.md', '/home/u/my notes.md']
    const plan = instructionPlan(role, user({ globalClaudeMd: global }))

    expect(plan.links.map(link => link.path)).toEqual([
      `${linkDir('global')}/01-CLAUDE.md`,
      `${linkDir('global')}/02-.rules.md`,
      `${linkDir('global')}/03-my notes.md`,
    ])
    expect(plan.warnings).toEqual([])
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

  test('each memory is linked to the project folder that lists it, the realpath folder first (A6)', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const launcher = user({
      root: '/w/real',
      givenRoot: '/w/link',
      memoryFiles: ['a.md'],
      givenMemoryFiles: ['a.md', 'b.md'],
    })
    const plan = instructionPlan(role, launcher)

    expect(plan.links).toEqual([
      {
        path: '/w/real/.cadre/pm/.runtime/instructions/memory/a.md',
        target: '/home/u/.claude/projects/-w-real/memory/a.md',
      },
      {
        path: '/w/real/.cadre/pm/.runtime/instructions/memory/b.md',
        target: '/home/u/.claude/projects/-w-link/memory/b.md',
      },
    ])
    expect(plan.warnings).toEqual([])
  })

  test('with no link in the way each memory is linked once, to the realpath folder', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const plan = instructionPlan(role, user({ memoryFiles: ['a.md', 'b.md'], givenMemoryFiles: ['b.md', 'a.md'] }))

    expect(plan.links).toEqual([
      { path: `${linkDir('memory')}/a.md`, target: '/home/u/.claude/projects/-repo/memory/a.md' },
      { path: `${linkDir('memory')}/b.md`, target: '/home/u/.claude/projects/-repo/memory/b.md' },
    ])
  })

  test('no memory link points at a folder that did not list its name', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const real = '/home/u/.claude/projects/-w-real/memory/'
    const given = '/home/u/.claude/projects/-w-link/memory/'
    const lists: readonly Pick<LaunchUser, 'memoryFiles' | 'givenMemoryFiles'>[] = [
      { memoryFiles: ['a.md'], givenMemoryFiles: ['b.md'] },
      { memoryFiles: [], givenMemoryFiles: ['a.md', 'b.md'] },
      { memoryFiles: ['a.md', 'b.md'], givenMemoryFiles: [] },
      { memoryFiles: ['b.md', 'c.md'], givenMemoryFiles: ['a.md', 'b.md'] },
    ]
    const cases = lists.map(list => ({
      list,
      links: instructionPlan(role, user({ root: '/w/real', givenRoot: '/w/link', ...list })).links,
    }))
    const isListed = (target: string, list: Pick<LaunchUser, 'memoryFiles' | 'givenMemoryFiles'>): boolean => {
      const name = target.slice(target.lastIndexOf('/') + 1)
      if (target === `${real}${name}`) return list.memoryFiles.includes(name)

      return target === `${given}${name}` && list.givenMemoryFiles.includes(name) && !list.memoryFiles.includes(name)
    }

    expect(cases.flatMap(({ list, links }) => links.filter(link => !isListed(link.target, list)))).toEqual([])
    expect(cases.map(({ links }) => links.length)).toEqual([2, 2, 2, 3])
  })

  test('an unsafe memory name both folders list is warned about once and not linked', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const launcher = user({ givenRoot: '/w/link', memoryFiles: ['../x.md'], givenMemoryFiles: ['../x.md'] })
    const plan = instructionPlan(role, launcher)

    expect(plan.links).toEqual([])
    expect(plan.warnings).toEqual(['memory file ../x.md has an unsafe name: not linked'])
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

  test('a memory name of 255 characters is linked and one of 256 is not', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const fits = `${'a'.repeat(252)}.md`
    const tooLong = `${'a'.repeat(253)}.md`
    const plan = instructionPlan(role, user({ memoryFiles: [fits, tooLong] }))

    expect(plan.links.map(link => link.path)).toEqual([`${linkDir('memory')}/${fits}`])
    expect(plan.warnings).toHaveLength(1)
  })

  test('a memory name with a space is linked: only a slash, a leading dot or hidden characters are refused', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const plan = instructionPlan(role, user({ memoryFiles: ['my memory.md'] }))

    expect(plan.links.map(link => link.target)).toEqual(['/home/u/.claude/projects/-repo/memory/my memory.md'])
    expect(plan.warnings).toEqual([])
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
    expect(plan.links.filter(link => link.path.includes('/instructions/'))).toEqual([
      { path: `${linkDir('global')}/01-CLAUDE.md`, target: '/home/u/.claude/CLAUDE.md' },
      { path: `${linkDir('memory')}/MEMORY.md`, target: '/home/u/.claude/projects/-repo/memory/MEMORY.md' },
    ])
    expect(plan.warnings).toEqual(['memory file .bad.md has an unsafe name: not linked'])
  })

  test('launchPlan lists the warnings of the denies before those of the instructions', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const scope = compileScope(role, context())
    const plan = launchPlan(role, scope, user({ root: '/w/a(b)', memoryFiles: ['../x.md'], userSkills: GSD_SKILLS }))

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

describe('overlayLinks', () => {
  const OVERLAY = '/repo/.cadre/pm/.runtime/overlay/.claude'

  test('each overlay skill and agent is linked to the user folder it lives in, sorted by path (S4 V3)', () => {
    const overlay = { skills: ['create-handoff-doc', 'gsd-autonomous', 'resume-handoff-doc'], agents: ['gsd-planner'] }
    const launcher = user({ userSkills: overlay.skills, userAgents: ['gsd-planner'] })

    expect(overlayLinks('pm', overlay, launcher)).toEqual({
      links: [
        { path: `${OVERLAY}/agents/gsd-planner.md`, target: '/home/u/.claude/agents/gsd-planner.md' },
        { path: `${OVERLAY}/skills/create-handoff-doc`, target: '/home/u/.claude/skills/create-handoff-doc' },
        { path: `${OVERLAY}/skills/gsd-autonomous`, target: '/home/u/.claude/skills/gsd-autonomous' },
        { path: `${OVERLAY}/skills/resume-handoff-doc`, target: '/home/u/.claude/skills/resume-handoff-doc' },
      ],
      warnings: [],
    })
  })

  test('the targets lie in the config dir of the user, and the links under the role folder of the repo', () => {
    const overlay = { skills: ['a'], agents: ['b'] }
    const launcher = user({ root: '/w/my repo', userDir: '/cfg', userSkills: ['a'], userAgents: ['b'] })
    const result = overlayLinks('be', overlay, launcher)

    expect(result.links).toEqual([
      {
        path: '/w/my repo/.cadre/be/.runtime/overlay/.claude/agents/b.md',
        target: '/cfg/agents/b.md',
      },
      {
        path: '/w/my repo/.cadre/be/.runtime/overlay/.claude/skills/a',
        target: '/cfg/skills/a',
      },
    ])
  })

  test('a skill the user does not have is not linked and warns', () => {
    const result = overlayLinks('pm', { skills: ['a', 'b'], agents: [] }, user({ userSkills: ['a'] }))

    expect(result.links.map(link => link.path)).toEqual([`${OVERLAY}/skills/a`])
    expect(result.warnings).toEqual(['skill b was not found in your user skills: not linked'])
  })

  test('an agent the user does not have is not linked and warns', () => {
    const result = overlayLinks('pm', { skills: [], agents: ['a', 'b'] }, user({ userAgents: ['b'] }))

    expect(result.links.map(link => link.path)).toEqual([`${OVERLAY}/agents/b.md`])
    expect(result.warnings).toEqual(['agent a was not found in your user agents: not linked'])
  })

  test('a name that is not a plain name is not linked and warns, even when the user lists it', () => {
    const unsafe = ['../x', '.hidden', 'a b', 'a/../b', 'codex:rescue']
    const names = [...unsafe, 'ok']
    const result = overlayLinks('pm', { skills: names, agents: names }, user({ userSkills: names, userAgents: names }))

    expect(result.links.map(link => link.path)).toEqual([`${OVERLAY}/agents/ok.md`, `${OVERLAY}/skills/ok`])
    expect(result.warnings).toEqual([
      ...unsafe.map(name => `skill ${name} has an unsafe name: not linked`),
      ...unsafe.map(name => `agent ${name} has an unsafe name: not linked`),
    ])
  })

  test('pin: a name with a .. segment or a slash is refused, and dots inside a plain name are kept (B5)', () => {
    const names = ['..', '../x', 'x/..', 'a/../b', 'a..b', 'v1.2']
    const result = overlayLinks('pm', { skills: names, agents: [] }, user({ userSkills: names }))

    expect(result.links.map(link => link.path)).toEqual([`${OVERLAY}/skills/a..b`, `${OVERLAY}/skills/v1.2`])
    expect(result.warnings).toEqual([
      'skill .. has an unsafe name: not linked',
      'skill ../x has an unsafe name: not linked',
      'skill a/../b has an unsafe name: not linked',
      'skill x/.. has an unsafe name: not linked',
    ])
  })

  test('a name that is both unsafe and absent from the user is reported as unsafe, never looked up', () => {
    const result = overlayLinks('pm', { skills: ['../x'], agents: ['a b'] }, user())

    expect(result.links).toEqual([])
    expect(result.warnings).toEqual([
      'skill ../x has an unsafe name: not linked',
      'agent a b has an unsafe name: not linked',
    ])
  })

  test('a name is plain up to 80 characters; an empty name and a name of 81 are not', () => {
    const fits = 'a'.repeat(80)
    const names = ['', fits, 'a'.repeat(81)]
    const result = overlayLinks('pm', { skills: names, agents: [] }, user({ userSkills: names }))

    expect(result.links.map(link => link.path)).toEqual([`${OVERLAY}/skills/${fits}`])
    expect(result.warnings).toHaveLength(2)
  })

  test('a hidden character in a name is refused, and the warning shows the name cleaned', () => {
    const name = `ev${BIDI_OVERRIDE}il`
    const result = overlayLinks('pm', { skills: [name], agents: [] }, user({ userSkills: [name] }))

    expect(result.links).toEqual([])
    expect(result.warnings).toEqual(['skill evil has an unsafe name: not linked'])
  })

  test('the warnings list the skills before the agents, each in name order', () => {
    const result = overlayLinks('pm', { skills: ['s2', 's1'], agents: ['a2', 'a1'] }, user())

    expect(result.warnings).toEqual([
      'skill s1 was not found in your user skills: not linked',
      'skill s2 was not found in your user skills: not linked',
      'agent a1 was not found in your user agents: not linked',
      'agent a2 was not found in your user agents: not linked',
    ])
  })

  test('a name given twice is linked once, and an empty overlay plans nothing', () => {
    const twice = overlayLinks('pm', { skills: ['a', 'a'], agents: [] }, user({ userSkills: ['a'] }))

    expect(twice.links).toHaveLength(1)
    expect(overlayLinks('pm', { skills: [], agents: [] }, user())).toEqual({ links: [], warnings: [] })
  })

  test('launchPlan links the instructions and the overlay together, sorted by path, and warns in step order', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md', 'auto-memory'] })
    const scope = compileScope(role, context())
    const launcher = user({
      codeDirs: ['*'],
      globalClaudeMd: ['/home/u/.claude/CLAUDE.md'],
      memoryFiles: ['.bad.md'],
      userSkills: [...INFRA_SKILLS],
    })
    const plan = launchPlan(role, scope, launcher)
    const notFound = (name: string): string => `skill ${name} was not found in your user skills: not linked`

    expect(plan.links.map(link => link.path)).toEqual([
      '/repo/.cadre/pm/.runtime/instructions/global/01-CLAUDE.md',
      `${OVERLAY}/skills/create-handoff-doc`,
      `${OVERLAY}/skills/resume-handoff-doc`,
    ])
    expect(plan.warnings).toEqual([
      'Code dir * has an unusual name and is not denied',
      'memory file .bad.md has an unsafe name: not linked',
      ...sortedUnique(FRAMEWORK_START_SKILLS.gsd).map(notFound),
    ])
  })

  test('a hostile long name is cleaned and cut to 110 characters wherever a warning shows it', () => {
    const name = `a${BIDI_OVERRIDE}b${'x'.repeat(300)}`
    const shown = `ab${'x'.repeat(107)}…`
    const role = templateRole('pm', { skills: [name], instructions: ['global-claude-md', 'auto-memory'] })
    const scope = withDeny(compileScope(role, context()), `Read(/${name}/**)`)
    const launcher = carrier({ codeDirs: [name], globalClaudeMd: [`/home/u/x/${name}`], memoryFiles: [name] })
    const plan = launchPlan(role, scope, launcher)

    expect(plan.warnings).toEqual([
      `Code dir ${shown} has an unusual name and is not denied`,
      `Read(/ab${'x'.repeat(101)}… was not emitted: single leading / matches nothing (P13)`,
      `global file ${shown} has an unsafe name: not linked`,
      `memory file ${shown} has an unsafe name: not linked`,
      `skill ${shown} has an unsafe name: not linked`,
    ])
  })

  test('launchPlan links the overlay skills and the gsd agents for a user who has them all', () => {
    const role = templateRole('be')
    const scope = compileScope(role, context({ setup: setup({ agents: ['gsd-planner', 'my-agent'] }) }))
    const launcher = user({
      userSkills: [...INFRA_SKILLS, ...FRAMEWORK_START_SKILLS.gsd],
      userAgents: ['gsd-planner', 'my-agent'],
    })
    const plan = launchPlan(role, scope, launcher)

    expect(plan.warnings).toEqual([])
    expect(plan.links.filter(link => link.path.includes('/agents/')).map(link => link.target)).toEqual([
      '/home/u/.claude/agents/gsd-planner.md',
    ])
    expect(plan.links.filter(link => link.path.includes('/skills/'))).toHaveLength(scope.overlay.skills.length)
  })
})

/** A skill or plugin command the scan listed; `plugin` is null for a user or project skill. */
function skill(name: string, plugin: string | null = null): SkillRef {
  return { name, plugin }
}

/** An MCP server the live session lists. */
function session(name: string): McpRef {
  return { name, source: 'session' }
}

/** A hook script the user's settings register. */
function hook(script: string): HookScript {
  return { script, event: 'PostToolUse', source: 'user' }
}

/** The three frameworks the launch properties run. */
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

/** The six template roles and a custom role with no base. */
const MATRIX_ROLES: readonly RoleSpec[] = [
  ...ROLE_TEMPLATE.map(row => roleFromTemplate(row)),
  templateRole('tl', { id: 'ops', title: 'Ops', basedOn: null }),
]

/** The role with every scanned name, every instruction group and everything it can carry. */
function assignEverything(role: RoleSpec): RoleSpec {
  return {
    ...role,
    mcp: MATRIX_SETUP.mcp.map(ref => ref.name),
    skills: MATRIX_SETUP.skills.map(item => item.name),
    instructions: ['global-claude-md', 'auto-memory', 'project-claude-md'],
    carry: {
      autoCompactWindow: true,
      statusLine: true,
      env: ['JIRA_URL'],
      hooks: ['gsd-secret-read-guard.js', 'gsd-context-monitor.js'],
    },
  }
}

/** The ways a role may be assigned: nothing, or everything. */
const ASSIGNMENTS: readonly (readonly [string, (role: RoleSpec) => RoleSpec])[] = [
  ['nothing', role => role],
  ['everything', assignEverything],
]

/** Every skill name the matrix overlays could hold, so the user of the matrix has all of them. */
const MATRIX_SKILLS: readonly string[] = sortedUnique([
  ...INFRA_SKILLS,
  ...FRAMEWORK_START_SKILLS.gsd,
  ...FRAMEWORK_START_SKILLS.superpowers,
  ...FRAMEWORK_START_SKILLS.none,
  ...MATRIX_SETUP.skills.map(item => item.name),
])

/**
 * The launching user of the matrix: everything to carry, every overlay name, the whole CLAUDE.md chain, global files,
 * memory files, and one decoy env value for each secret fixture under a name no role carries.
 */
const MATRIX_USER: LaunchUser = user({
  autoCompactWindow: 800000,
  statusLine: { type: 'command', command: '/home/u/x.js' },
  env: {
    JIRA_URL: 'https://j',
    ...Object.fromEntries(SECRET_FIXTURES.map((value, index) => [`DECOY_${index}`, value])),
  },
  hooks: USER_HOOKS,
  claudeMd: CHAIN,
  globalClaudeMd: ['/home/u/.claude/CLAUDE.md', '/home/u/notes/a.md'],
  memoryFiles: ['MEMORY.md', 'b.md'],
  userSkills: MATRIX_SKILLS,
  userAgents: MATRIX_SETUP.agents,
  codeDirs: ['.planning', 'cadre', 'pm', 'src', 'thoughts'],
})

/** The scope of a role in a framework, with the matrix setup and the code dirs the scan found at init. */
function matrixScope(role: RoleSpec, framework: FrameworkId): CompiledScope {
  const codeDirs = ['.planning', 'cadre', 'pm', 'src', 'thoughts']

  return compileScope(role, context({ framework, setup: MATRIX_SETUP, codeDirs, roles: MATRIX_ROLES }))
}

/** Whether a value is a list of strings. */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/** The deny list of rendered settings; empty when they hold none. */
function denyOf(settings: Readonly<Record<string, unknown>>): string[] {
  const permissions = settings.permissions
  if (!isObject(permissions)) return []
  const deny = permissions.deny

  return isStringList(deny) ? deny : []
}

/** The template keys of rendered settings, as the ISO-04 checker reads them; null when one has the wrong shape. */
function templateOf(settings: Readonly<Record<string, unknown>>, scope: CompiledScope): SettingsTemplate | null {
  const { enabledPlugins, permissions, sandbox } = settings
  if (!isObject(enabledPlugins) || !isObject(permissions) || !isObject(sandbox)) return null
  const deny = permissions.deny
  const enabled = sandbox.enabled
  if (!isStringList(deny) || typeof enabled !== 'boolean') return null
  const entries = Object.entries(enabledPlugins)
  const flags = entries.filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
  if (flags.length !== entries.length) return null

  return {
    enabledPlugins: Object.fromEntries(flags),
    permissions: { defaultMode: scope.settings.permissions.defaultMode, deny },
    sandbox: { enabled },
  }
}

/** The command of the context monitor among the user's hooks, which no plan may render (D-62). */
const MONITOR_COMMAND = '/home/u/m.js'

/** Whether the plan renders the context monitor hook, which no plan may (D-62). */
function isMonitorRendered(plan: LaunchPlan): boolean {
  return JSON.stringify(plan.settings.hooks ?? null).includes(MONITOR_COMMAND)
}

/** Whether a path has a `..` segment. */
function hasDotDot(path: string): boolean {
  return path.split('/').includes('..')
}

/**
 * Every problem one launch plan has, as messages (empty when none): a link outside `<root>/.cadre/<id>/.runtime/`, a
 * link with a `..` segment or a relative target, a link planned twice, a settings key outside RUNTIME_SETTINGS_KEYS, an
 * env name the role does not carry, a deny the runtime lint refuses, an exact deny that covers an own folder of the
 * role, a secret fixture anywhere in the plan, the context monitor hook (D-62), an infra violation in the template keys
 * of the runtime settings (D-77), and a warning (the user of the matrix has everything, so none is expected).
 */
function launchProblems(plan: LaunchPlan, role: RoleSpec, scope: CompiledScope, framework: FrameworkId): string[] {
  const runtime = `/repo/.cadre/${role.id}/.runtime/`
  const deny = denyOf(plan.settings)
  const covered = coveredPrefixes(deny).map(prefix => prefix.toLowerCase())
  const own = roleOwnPaths(role.id).map(path => `/repo/${path}`)
  const template = templateOf(plan.settings, scope)
  const env = isObject(plan.settings.env) ? Object.keys(plan.settings.env) : []
  const paths = plan.links.map(link => link.path)

  return [
    ...paths.filter(path => !path.startsWith(runtime)).map(path => `link ${path} is outside ${runtime}`),
    ...plan.links
      .filter(link => hasDotDot(link.path) || hasDotDot(link.target) || !link.target.startsWith('/'))
      .map(link => `link ${link.path} has a .. segment or a relative target`),
    ...paths.filter((path, index) => paths.indexOf(path) !== index).map(path => `link ${path} is planned twice`),
    ...Object.keys(plan.settings)
      .filter(key => !RUNTIME_SETTINGS_KEYS.includes(key))
      .map(key => `settings key ${key} is not allowed`),
    ...env.filter(name => !role.carry.env.includes(name)).map(name => `env ${name} is not carried by the role`),
    ...deny.flatMap(entry => {
      const message = lintRuntimeDenyPattern(entry)

      return message === null ? [] : [`deny ${entry} fails the lint: ${message}`]
    }),
    ...own.flatMap(path =>
      covered.filter(prefix => path.toLowerCase().startsWith(prefix)).map(prefix => `deny covers ${prefix} of ${path}`),
    ),
    ...leaks(JSON.stringify(plan), SECRET_FIXTURES).map(secret => `the plan holds the secret ${secret}`),
    ...(isMonitorRendered(plan) ? ['the context monitor hook is rendered'] : []),
    ...(template === null
      ? ['the runtime settings do not hold the template keys']
      : infraViolations({ ...scope, settings: template }, framework)),
    ...plan.warnings.map(warning => `warning: ${warning}`),
  ]
}

/** Every problem the properties find over the matrix, each with the combination that has it. */
function matrixProblems(): string[] {
  const problems: string[] = []
  for (const framework of FRAMEWORKS) {
    for (const base of MATRIX_ROLES) {
      for (const [label, assign] of ASSIGNMENTS) {
        const role = assign(base)
        const scope = matrixScope(role, framework)
        const plan = launchPlan(role, scope, MATRIX_USER)
        const found = launchProblems(plan, role, scope, framework)
        problems.push(...found.map(problem => `${framework} / ${role.id} / ${label}: ${problem}`))
      }
    }
  }

  return problems
}

/** One combination of the matrix: its label, the role, its scope, the launching user and the launch plan. */
type MatrixCase = {
  readonly label: string
  readonly role: RoleSpec
  readonly scope: CompiledScope
  readonly launcher: LaunchUser
  readonly plan: LaunchPlan
}

/** Every combination of the matrix (framework, role, assignment) for a launching user. */
function matrixCases(launcher: LaunchUser): MatrixCase[] {
  return FRAMEWORKS.flatMap(framework =>
    MATRIX_ROLES.flatMap(base =>
      ASSIGNMENTS.map(([label, assign]) => {
        const role = assign(base)
        const scope = matrixScope(role, framework)
        const plan = launchPlan(role, scope, launcher)

        return { label: `${framework} / ${role.id} / ${label}`, role, scope, launcher, plan }
      }),
    ),
  )
}

/** The PM of the matrix with everything assigned on GSD: its scope, its launch plan and no problem. */
function pmCase(): { readonly role: RoleSpec; readonly scope: CompiledScope; readonly plan: LaunchPlan } {
  const role = assignEverything(templateRole('pm'))
  const scope = matrixScope(role, 'gsd')

  return { role, scope, plan: launchPlan(role, scope, MATRIX_USER) }
}

/** The plan with one more deny entry; the plan itself is never changed. */
function withDenyEntry(plan: LaunchPlan, entry: string): LaunchPlan {
  const permissions = plan.settings.permissions
  const base = isObject(permissions) ? permissions : {}

  return { ...plan, settings: { ...plan.settings, permissions: { ...base, deny: [...denyOf(plan.settings), entry] } } }
}

/** The plan with one more link. */
function withLink(plan: LaunchPlan, link: OverlayLink): LaunchPlan {
  return { ...plan, links: [...plan.links, link] }
}

/** The plan with one settings key set to a value. */
function withSetting(plan: LaunchPlan, key: string, value: unknown): LaunchPlan {
  return { ...plan, settings: { ...plan.settings, [key]: value } }
}

describe('launch properties', () => {
  test('every role, framework and assignment of the matrix gives a plan without a problem (ISO-04, D-77, D-84)', () => {
    expect(matrixProblems()).toEqual([])
  })

  test('the matrix is not empty: seven roles, three frameworks, two assignment sets, and links to check', () => {
    const plans = FRAMEWORKS.flatMap(framework =>
      MATRIX_ROLES.flatMap(base =>
        ASSIGNMENTS.map(([, assign]) => {
          const role = assign(base)

          return launchPlan(role, matrixScope(role, framework), MATRIX_USER)
        }),
      ),
    )

    expect(MATRIX_ROLES.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'fe', 'qa', 'security', 'ops'])
    expect(FRAMEWORKS).toHaveLength(3)
    expect(ASSIGNMENTS.map(([label]) => label)).toEqual(['nothing', 'everything'])
    expect(plans).toHaveLength(42)
    expect(plans.filter(plan => plan.links.length === 0)).toEqual([])
  })

  test('pin: every matrix plan holds the deny of runtimeDeny and starts its warnings with those of it (B4)', () => {
    const unusual: LaunchUser = { ...MATRIX_USER, codeDirs: [...MATRIX_USER.codeDirs, '*'] }
    const results = [...matrixCases(MATRIX_USER), ...matrixCases(unusual)].map(item => {
      const deny = runtimeDeny(item.role, item.scope, item.launcher)
      const leading = item.plan.warnings.slice(0, deny.warnings.length)

      return {
        label: item.label,
        isSameDeny: JSON.stringify(denyOf(item.plan.settings)) === JSON.stringify(deny.deny),
        isLedByDeny: JSON.stringify(leading) === JSON.stringify(deny.warnings),
        hasWarnings: deny.warnings.length > 0,
      }
    })

    expect(results.filter(result => !result.isSameDeny || !result.isLedByDeny).map(result => result.label)).toEqual([])
    expect(results.filter(result => result.hasWarnings).length > 0).toBe(true)
    expect(results).toHaveLength(84)
  })

  test('pin: a plan that carries everything holds every allowed settings key, in the order of the list (B4)', () => {
    const keys = FRAMEWORKS.flatMap(framework =>
      MATRIX_ROLES.map(base => {
        const role = assignEverything(base)

        return Object.keys(launchPlan(role, matrixScope(role, framework), MATRIX_USER).settings)
      }),
    )

    expect(keys).toHaveLength(21)
    expect(keys).toEqual(keys.map(() => RUNTIME_SETTINGS_KEYS))
  })

  test('the plan of a role with everything holds instruction links, overlay skills and agents under .runtime', () => {
    const { plan } = pmCase()
    const paths = plan.links.map(link => link.path)

    expect(paths.filter(path => path.includes('/.runtime/instructions/global/'))).toHaveLength(2)
    expect(paths.filter(path => path.includes('/.runtime/instructions/memory/'))).toHaveLength(2)
    expect(paths.filter(path => path.includes('/.runtime/overlay/.claude/agents/'))).toHaveLength(2)
    expect(paths.filter(path => path.includes('/.runtime/overlay/.claude/skills/')).length > 0).toBe(true)
    expect(paths).toEqual([...paths].sort())
  })

  test('the clean plan has no problem, so each mutation below changes the verdict', () => {
    const { role, scope, plan } = pmCase()

    expect(launchProblems(plan, role, scope, 'gsd')).toEqual([])
    expect(coveredPrefixes(denyOf(plan.settings))).toContain('/repo/src/')
  })

  test('mutation: a deny of the autopilot server in the runtime settings is caught and named', () => {
    const { role, scope, plan } = pmCase()
    const problems = launchProblems(withDenyEntry(plan, 'mcp__autopilot'), role, scope, 'gsd').join('\n')

    expect(problems).toContain('deny mcp__autopilot fails the lint')
    expect(problems).toContain('mcp__autopilot')
    expect(launchProblems(plan, role, scope, 'gsd')).toEqual([])
  })

  test('mutation: a link to a path outside .runtime is caught and named', () => {
    const { role, scope, plan } = pmCase()
    const link = { path: '/repo/.cadre/pm/elsewhere/x', target: '/home/u/.claude/skills/x' }
    const problems = launchProblems(withLink(plan, link), role, scope, 'gsd')

    expect(problems).toEqual(['link /repo/.cadre/pm/elsewhere/x is outside /repo/.cadre/pm/.runtime/'])
  })

  test('mutation: a link with a .. segment, a relative target, or planned twice is caught', () => {
    const { role, scope, plan } = pmCase()
    const runtime = '/repo/.cadre/pm/.runtime/overlay/.claude/skills'
    const up = withLink(plan, { path: `${runtime}/../../x`, target: '/home/u/x' })
    const relative = withLink(plan, { path: `${runtime}/y`, target: 'skills/y' })
    const twice = withLink(plan, plan.links[0] ?? { path: '', target: '' })

    expect(launchProblems(up, role, scope, 'gsd')).toHaveLength(1)
    expect(launchProblems(relative, role, scope, 'gsd')).toHaveLength(1)
    expect(launchProblems(twice, role, scope, 'gsd').join('\n')).toContain('is planned twice')
  })

  test('mutation: a key outside the allow-list in the settings is caught and named', () => {
    const { role, scope, plan } = pmCase()

    expect(launchProblems(withSetting(plan, 'model', 'opus'), role, scope, 'gsd')).toEqual([
      'settings key model is not allowed',
    ])
  })

  test('mutation: a secret value anywhere in the plan is caught and named', () => {
    const { role, scope, plan } = pmCase()
    const secret = SECRET_FIXTURES[0] ?? ''
    const problems = launchProblems(withSetting(plan, 'env', { DECOY_0: secret }), role, scope, 'gsd')

    expect(problems).toContain(`the plan holds the secret ${secret}`)
    expect(problems).toContain('env DECOY_0 is not carried by the role')
  })

  test('mutation: an exact deny that covers an own folder of the role is caught', () => {
    const { role, scope, plan } = pmCase()
    const handoffs = launchProblems(withDenyEntry(plan, 'Read(//repo/thoughts/**)'), role, scope, 'gsd')
    const planning = launchProblems(withDenyEntry(plan, 'Edit(//repo/.PLANNING/**)'), role, scope, 'gsd')

    expect(handoffs).toEqual(['deny covers /repo/thoughts/ of /repo/thoughts/shared/handoffs/pm/'])
    expect(planning).toEqual(['deny covers /repo/.planning/ of /repo/.planning/'])
  })

  test('mutation: a single-slash deny and a deny with a .. segment are caught by the lint', () => {
    const { role, scope, plan } = pmCase()
    const single = launchProblems(withDenyEntry(plan, 'Read(/repo/src/**)'), role, scope, 'gsd')
    const dotdot = launchProblems(withDenyEntry(plan, 'Read(//repo/../src/**)'), role, scope, 'gsd')

    expect(single).toEqual(['deny Read(/repo/src/**) fails the lint: single leading / matches nothing (P13)'])
    expect(dotdot).toEqual([
      'deny Read(//repo/../src/**) fails the lint: a .. segment is not allowed in an absolute pattern',
    ])
  })

  test('mutation: an infra plugin switched off in the runtime settings is caught by the ISO-04 checker', () => {
    const { role, scope, plan } = pmCase()
    const plugins = isObject(plan.settings.enabledPlugins) ? plan.settings.enabledPlugins : {}
    const off = withSetting(plan, 'enabledPlugins', { ...plugins, 'autopilot@local-mods': false })

    expect(launchProblems(off, role, scope, 'gsd')).toEqual(['infra plugin autopilot@local-mods is not enabled'])
  })

  test('mutation: runtime settings without the template keys are caught', () => {
    const { role, scope, plan } = pmCase()
    const bare = { ...plan, settings: { autoMemoryDirectory: '/home/u/.claude/cadre/x/pm' } }

    expect(launchProblems(bare, role, scope, 'gsd')).toEqual(['the runtime settings do not hold the template keys'])
  })

  test('mutation: the context monitor hook rendered into the settings is caught', () => {
    const { role, scope, plan } = pmCase()
    const monitor = { Stop: [{ hooks: [{ type: 'command', command: `node ${MONITOR_COMMAND}` }] }] }

    expect(launchProblems(withSetting(plan, 'hooks', monitor), role, scope, 'gsd')).toEqual([
      'the context monitor hook is rendered',
    ])
  })

  test('mutation: a warning in the plan is a problem for the matrix user, who has everything', () => {
    const { role, scope, plan } = pmCase()

    expect(launchProblems({ ...plan, warnings: ['x'] }, role, scope, 'gsd')).toEqual(['warning: x'])
  })
})
