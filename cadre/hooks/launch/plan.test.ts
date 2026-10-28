import { describe, expect, test } from 'claude-code/testing'

import type {
  CompiledScope,
  FrameworkId,
  HookScript,
  RoleSpec,
  ScopeContext,
  SettingsTemplate,
  SetupScan,
} from '../../types'
import { isObject } from '../core/json'
import { sortedUnique } from '../core/text'
import { adapterOf } from '../framework/registry'
import { memorySlug, roleMemoryDir } from '../paths'
import { INFRA_SKILLS } from '../roles/infra'
import { ROLE_TEMPLATE, roleFromTemplate } from '../roles/template'
import { compileScope } from '../scope/compile'
import { infraViolations, roleOwnPaths } from '../scope/lint'
import { emptySetupScan, FRAMEWORKS, leaks, SECRET_FIXTURES, session, skillRef, templateRole } from '../testkit'
import { linkedMemoryDeny, lintRuntimeDenyPattern, runtimeDeny } from './deny'
import { isPartsFlowRole } from './links'
import type { LaunchUser, OverlayLink } from './links'
import { launchPlan } from './plan'
import type { LaunchPlan } from './plan'
import { renderRuntimeSettings, RUNTIME_SETTINGS_KEYS } from './settings'

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
    rules: [],
    roleClaudeMds: [],
    globalClaudeMd: [],
    memoryFiles: [],
    givenMemoryFiles: [],
    userSkills: [],
    userAgents: [],
    codeDirs: [],
    linkedMemories: [],
    ...over,
  }
}

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
const GSD_SKILLS: readonly string[] = [...INFRA_SKILLS, ...adapterOf('gsd').startSkills]

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

/**
 * The deny of a role's private instructions folder under its role memory folder `folder` (02-GAPS-B2 S3): Edit and
 * Write on `<folder>/instructions/**`, written as exact `//` rules.
 */
function privateDeny(folder: string): string[] {
  return [`Edit(/${folder}/instructions/**)`, `Write(/${folder}/instructions/**)`]
}

/**
 * The deny every role gets beside its private folder deny, for the fixture repo /repo (02-GAPS-B3 C2, C3): Edit and
 * Write on the repo's memory folder under `userDir`, `<userDir>/projects/-repo/memory/**`, and on the hand-out record
 * in the role memory folder `folder`, `<folder>/instructions.json`.
 */
function memoryAndRecordDeny(userDir: string, folder: string): string[] {
  return [
    `Edit(/${userDir}/projects/-repo/memory/**)`,
    `Write(/${userDir}/projects/-repo/memory/**)`,
    `Edit(/${folder}/instructions.json)`,
    `Write(/${folder}/instructions.json)`,
  ]
}

/**
 * The deny of the launch files under the root `root` (03.1-SEC-S1): Edit and Write on `.claude/settings.json`,
 * `.claude/settings.local.json`, `.cadre/manifest.json` and `.cadre/bin/**`, as exact `//` rules.
 */
function launchFileRules(root: string): string[] {
  const files = ['.cadre/bin/**', '.cadre/manifest.json', '.claude/settings.json', '.claude/settings.local.json']

  return ['Edit', 'Write'].flatMap(tool => files.map(file => `${tool}(/${root}/${file})`))
}

describe('launch render', () => {
  test('RUNTIME_SETTINGS_KEYS lists the ten allowed settings keys and is frozen', () => {
    expect(RUNTIME_SETTINGS_KEYS).toEqual([
      'autoCompactWindow',
      'autoMemoryDirectory',
      'claudeMdExcludes',
      'deniedMcpServers',
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
      deniedMcpServers: [],
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
          'Edit(//home/u/.claude/cadre/repo-1a2b3c4d/pm/instructions.json)',
          'Edit(//home/u/.claude/cadre/repo-1a2b3c4d/pm/instructions/**)',
          'Edit(//home/u/.claude/projects/-repo/memory/**)',
          'Edit(//repo/.cadre/bin/**)',
          'Edit(//repo/.cadre/manifest.json)',
          'Edit(//repo/.claude/settings.json)',
          'Edit(//repo/.claude/settings.local.json)',
          'Edit(//repo/cadre/**)',
          'Read(//repo/**/.env)',
          'Read(//repo/**/.env.*)',
          'Read(//repo/.env)',
          'Read(//repo/.env.*)',
          'Read(//repo/cadre/**)',
          'Read(~/.aws/**)',
          'Read(~/.ssh/**)',
          'Write(//home/u/.claude/cadre/repo-1a2b3c4d/pm/instructions.json)',
          'Write(//home/u/.claude/cadre/repo-1a2b3c4d/pm/instructions/**)',
          'Write(//home/u/.claude/projects/-repo/memory/**)',
          'Write(//repo/.cadre/bin/**)',
          'Write(//repo/.cadre/manifest.json)',
          'Write(//repo/.claude/settings.json)',
          'Write(//repo/.claude/settings.local.json)',
        ],
      },
      sandbox: { enabled: false },
      statusLine: { type: 'command', command: '/home/u/x.js' },
    })
    expect(plan.links).toHaveLength(GSD_SKILLS.length)
    expect(plan.links.filter(link => !link.path.includes('/overlay/.claude/skills/'))).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  test('the render holds the deny of runtimeDeny, the private folder, memory folder and record (S3, C2, C3)', () => {
    const role = templateRole('pm', { carry: CARRY_ALL })
    const scope = compileScope(role, context({ codeDirs: ['cadre'] }))
    const plan = launchPlan(role, scope, carrier())
    const folder = roleMemoryDir(carrier(), 'pm')
    const own = [...privateDeny(folder), ...memoryAndRecordDeny('/home/u/.claude', folder)]

    expect(plan.settings.permissions).toEqual({
      defaultMode: 'auto',
      deny: sortedUnique([...runtimeDeny(role, scope, carrier()).deny, ...own, ...launchFileRules('/repo')]),
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
    const base = [
      'autoMemoryDirectory',
      'claudeMdExcludes',
      'deniedMcpServers',
      'enabledPlugins',
      'permissions',
      'sandbox',
    ]

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
      deniedMcpServers: [],
      enabledPlugins: { 'agent-fleet@local-mods': true, 'autopilot@local-mods': true, 'cadre@local-mods': true },
      permissions: {
        defaultMode: 'auto',
        deny: [
          'Edit(//home/u/.claude/cadre/repo-1a2b3c4d/be/instructions.json)',
          'Edit(//home/u/.claude/cadre/repo-1a2b3c4d/be/instructions/**)',
          'Edit(//home/u/.claude/projects/-repo/memory/**)',
          'Edit(//repo/.cadre/bin/**)',
          'Edit(//repo/.cadre/manifest.json)',
          'Edit(//repo/.claude/settings.json)',
          'Edit(//repo/.claude/settings.local.json)',
          'Read(//repo/**/.env)',
          'Read(//repo/**/.env.*)',
          'Read(//repo/.env)',
          'Read(//repo/.env.*)',
          'Read(~/.aws/**)',
          'Read(~/.ssh/**)',
          'Write(//home/u/.claude/cadre/repo-1a2b3c4d/be/instructions.json)',
          'Write(//home/u/.claude/cadre/repo-1a2b3c4d/be/instructions/**)',
          'Write(//home/u/.claude/projects/-repo/memory/**)',
          'Write(//repo/.cadre/bin/**)',
          'Write(//repo/.cadre/manifest.json)',
          'Write(//repo/.claude/settings.json)',
          'Write(//repo/.claude/settings.local.json)',
        ],
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

  test('null and empty matchers share one group with no matcher key, in order, and a null timeout has no key', () => {
    const carry = { ...CARRY_ALL, hooks: ['a.js', 'b.js', 'c.js'] }
    const role = templateRole('be', { carry })
    const scope = compileScope(role, context())
    const hooks = [
      { event: 'Stop', script: 'a.js', command: 'node /h/a.js', matcher: '', timeout: 0 },
      { event: 'Stop', script: 'b.js', command: 'node /h/b.js', matcher: null, timeout: null },
      { event: 'Stop', script: 'c.js', command: 'node /h/c.js', matcher: '', timeout: null },
    ]
    const rendered = launchPlan(role, scope, carrier({ hooks })).settings.hooks

    expect(JSON.stringify(rendered)).toBe(
      JSON.stringify({
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'node /h/a.js', timeout: 0 },
              { type: 'command', command: 'node /h/b.js' },
              { type: 'command', command: 'node /h/c.js' },
            ],
          },
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

/** The CLAUDE.md files the engine loads for the fixture repo: its own, the one in `.claude` and an ancestor's. */
const CHAIN = ['/repo/CLAUDE.md', '/repo/.claude/CLAUDE.md', '/home/u/work/CLAUDE.md']

/** A hook script the user's settings register. */
function hook(script: string): HookScript {
  return { script, event: 'PostToolUse', source: 'user' }
}

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
  ...adapterOf('gsd').startSkills,
  ...adapterOf('superpowers').startSkills,
  ...adapterOf('none').startSkills,
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
      const memories = isPartsFlowRole(item.role) ? linkedMemoryDeny(item.launcher.linkedMemories).deny : []
      const folder = roleMemoryDir(item.launcher, item.role.id)
      const own = [...privateDeny(folder), ...memoryAndRecordDeny(item.launcher.userDir, folder)]
      const launch = [item.launcher.root, item.launcher.givenRoot].flatMap(launchFileRules)
      const expected = sortedUnique([...deny.deny, ...own, ...launch, ...memories])

      return {
        label: item.label,
        isSameDeny: JSON.stringify(denyOf(item.plan.settings)) === JSON.stringify(expected),
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

  test(
    'the render denies every scanned server the role was not given as a whole server, by its scanned name, ' +
      'beside the tool denies (D-124, #39)',
    () => {
      const role = templateRole('pm', { mcp: ['github'] })
      const scope = matrixScope(role, 'gsd')
      const plan = launchPlan(role, scope, MATRIX_USER)

      expect(plan.settings.deniedMcpServers).toEqual([
        { serverName: 'jira' },
        { serverName: 'playwright' },
        { serverName: 'sentry' },
      ])
      expect(denyOf(plan.settings)).toContain('mcp__jira')
      expect(denyOf(plan.settings)).toContain('mcp__playwright')
      expect(denyOf(plan.settings)).toContain('mcp__sentry')
      expect(JSON.stringify(plan.settings.deniedMcpServers)).not.toContain('autopilot')
      expect(JSON.stringify(plan.settings.deniedMcpServers)).not.toContain('github')
    },
  )

  test(
    'a server whose tool name is rewritten is denied by its scanned name, and a role with every server denies none ' +
      '(D-124, #39)',
    () => {
      const role = templateRole('pm')
      const scope = compileScope(role, context({ setup: emptySetupScan({ mcp: [session('my.server')] }) }))

      expect(launchPlan(role, scope, carrier()).settings.deniedMcpServers).toEqual([{ serverName: 'my.server' }])
      expect(denyOf(launchPlan(role, scope, carrier()).settings)).toContain('mcp__my_server')
      expect(renderRuntimeSettings(role, scope, carrier(), []).deniedMcpServers).toEqual([{ serverName: 'my.server' }])

      const { plan } = pmCase()

      expect(plan.settings.deniedMcpServers).toEqual([])
    },
  )

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
