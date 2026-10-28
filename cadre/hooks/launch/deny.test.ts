import { describe, expect, test } from 'claude-code/testing'

import type {
  CompiledScope,
  FrameworkId,
  HookScript,
  RoleSpec,
  ScopeContext,
  SettingsTemplate,
  SetupScan,
  TemplateRoleId,
} from '../../types'
import { isObject } from '../core/json'
import { sortedUnique } from '../core/text'
import { adapterOf } from '../framework/registry'
import { INSTRUCTIONS_RECORD_FILE, roleMemoryDir } from '../paths'
import { INFRA_SKILLS } from '../roles/infra'
import { ROLE_TEMPLATE, roleFromTemplate } from '../roles/template'
import { compileScope } from '../scope/compile'
import { infraViolations, roleOwnPaths } from '../scope/lint'
import {
  BIDI_OVERRIDE,
  emptySetupScan,
  FRAMEWORKS,
  leaks,
  SECRET_FIXTURES,
  session,
  skillRef,
  templateRole,
} from '../testkit'
import {
  linkedMemoryDeny,
  lintRuntimeDenyPattern,
  runtimeDeny,
  UNDENIED_MEMORY_FOLDER_WARNING,
  UNDENIED_PRIVATE_WARNING,
  UNDENIED_RECORD_WARNING,
  undeniedMemoryWarning,
} from './deny'
import { isPartsFlowRole } from './links'
import type { LaunchUser } from './links'
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

/** The scope with one more deny entry; the compiled value is never changed. */
function withDeny(scope: CompiledScope, entry: string): CompiledScope {
  const permissions = { ...scope.settings.permissions, deny: [...scope.settings.permissions.deny, entry] }

  return { ...scope, settings: { ...scope.settings, permissions } }
}

/** The runtime deny list of the template BE at /repo: the ~/ denies, and the .env denies made absolute (D-123). */
const BASH_DENY: readonly string[] = [
  'Read(//repo/**/.env)',
  'Read(//repo/**/.env.*)',
  'Read(//repo/.env)',
  'Read(//repo/.env.*)',
  'Read(~/.aws/**)',
  'Read(~/.ssh/**)',
]

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

  test(
    'the any-depth code dir and .env denies are replaced by exact ones, and the home-folder and Bash denies stay',
    () => {
      const role = templateRole('pm')
      const scope = compileScope(role, context({ codeDirs: ['cadre'] }))
      const launcher = user({ codeDirs: ['cadre', 'pm', 'src', 'thoughts'] })

      expect(runtimeDeny(role, scope, launcher)).toEqual({
        deny: [
          'Bash',
          'Edit(//repo/cadre/**)',
          'Edit(//repo/pm/**)',
          'Edit(//repo/src/**)',
          'Read(//repo/**/.env)',
          'Read(//repo/**/.env.*)',
          'Read(//repo/.env)',
          'Read(//repo/.env.*)',
          'Read(//repo/cadre/**)',
          'Read(//repo/pm/**)',
          'Read(//repo/src/**)',
          'Read(~/.aws/**)',
          'Read(~/.ssh/**)',
        ],
        warnings: [],
      })
    },
  )

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

  test('a role with Bash gets its template deny with only the .env denies made absolute (D-123)', () => {
    const role = templateRole('be')
    const scope = compileScope(role, context({ codeDirs: ['cadre'] }))

    expect(runtimeDeny(role, scope, user({ codeDirs: ['cadre', 'src'] }))).toEqual({
      deny: BASH_DENY,
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

  test(
    'the .env denies are rendered absolute at the repo root and at any depth under it, ' +
      'and the template keeps them relative (A2)',
    () => {
      const role = templateRole('pm')
      const scope = compileScope(role, context({ codeDirs: ['cadre'] }))
      const launcher = user({ codeDirs: ['cadre'] })
      const result = runtimeDeny(role, scope, launcher)
      const be = templateRole('be')
      const bashDeny = runtimeDeny(be, compileScope(be, context({ codeDirs: ['cadre'] })), launcher).deny

      expect(result.deny).toContain('Read(//repo/.env)')
      expect(result.deny).toContain('Read(//repo/.env.*)')
      expect(result.deny).toContain('Read(//repo/**/.env)')
      expect(result.deny).toContain('Read(//repo/**/.env.*)')
      expect(result.deny).toContain('Read(~/.aws/**)')
      expect(result.deny).toContain('Read(~/.ssh/**)')
      expect(result.deny).not.toContain('Read(./.env)')
      expect(result.deny).not.toContain('Read(./.env.*)')
      expect(scope.settings.permissions.deny).toContain('Read(./.env)')
      expect(scope.settings.permissions.deny).toContain('Read(./.env.*)')
      expect(result.warnings).toEqual([])
      expect(bashDeny).toContain('Read(//repo/.env)')
      expect(bashDeny).not.toContain('Read(./.env)')
      expect(bashDeny).not.toContain('Read(./.env.*)')
    },
  )

  test('every deny of the result passes the runtime lint', () => {
    const role = templateRole('pm')
    const scope = compileScope(role, context({ codeDirs: ['cadre', 'src'] }))
    const result = runtimeDeny(role, scope, user({ codeDirs: ['cadre', 'src', 'docs'] }))

    expect(result.deny.filter(entry => lintRuntimeDenyPattern(entry) !== null)).toEqual([])
    expect(result.deny).toContain('Read(//repo/docs/**)')
  })
})

describe('runtimeDeny for Bash roles (D-123)', () => {
  test('a Bash role at a safe root gets the four absolute .env denies, no relative one, and the ~/ denies', () => {
    const role = templateRole('be')
    const result = runtimeDeny(role, compileScope(role, context()), user())

    expect(result).toEqual({ deny: BASH_DENY, warnings: [] })
    expect(result.deny).toContain('Read(//repo/.env)')
    expect(result.deny).toContain('Read(//repo/.env.*)')
    expect(result.deny).toContain('Read(//repo/**/.env)')
    expect(result.deny).toContain('Read(//repo/**/.env.*)')
    expect(result.deny).not.toContain('Read(./.env)')
    expect(result.deny).not.toContain('Read(./.env.*)')
  })

  test('a Bash role gets no code-dir deny, whatever code dirs the launch scan names: its template holds none', () => {
    const role = templateRole('be')
    const scope = compileScope(role, context({ codeDirs: ['cadre'] }))
    const result = runtimeDeny(role, scope, user({ codeDirs: ['cadre', 'src', 'docs'] }))

    expect(coveredPrefixes(result.deny)).toEqual([])
    expect(result).toEqual({ deny: BASH_DENY, warnings: [] })
  })

  test('launchPlan for BE renders that deny list, with its private folder, memory and record deny (S3, C2, C3)', () => {
    const role = templateRole('be')
    const scope = compileScope(role, context())
    const folder = roleMemoryDir(user(), 'be')

    expect(launchPlan(role, scope, user()).settings.permissions).toEqual({
      defaultMode: scope.settings.permissions.defaultMode,
      deny: sortedUnique([
        ...BASH_DENY,
        ...privateDeny(folder),
        ...memoryAndRecordDeny('/home/u/.claude', folder),
        ...launchFileRules('/repo'),
      ]),
    })
  })

  test('a Bash role at a root a rule cannot hold keeps its template deny, with no warning', () => {
    const role = templateRole('be')
    const scope = compileScope(role, context())

    expect(runtimeDeny(role, scope, user({ root: '/re po' }))).toEqual({
      deny: scope.settings.permissions.deny,
      warnings: [],
    })
  })

  test('for every template role at a safe root, no runtime deny is a cwd-relative .env deny', () => {
    const roles = ROLE_TEMPLATE.map(row => roleFromTemplate(row))
    const denies = roles.map(role => runtimeDeny(role, compileScope(role, context()), user()).deny)

    expect(roles.filter(role => role.hasBash).length).toBeGreaterThan(0)
    expect(denies.flatMap(deny => deny.filter(entry => entry.startsWith('Read(./.env')))).toEqual([])
    expect(denies.filter(deny => !deny.includes('Read(//repo/.env)'))).toEqual([])
  })
})

/** BE's role memory folder for the fixture user (D-20, D-91). */
const BE_MEMORY = '/home/u/.claude/cadre/repo-1a2b3c4d/be'

/** The link paths of two memories /cadre start linked into BE's memory folder (G-02-1f, D-140 q3-a). */
const LINKED: readonly string[] = [`${BE_MEMORY}/squad.md`, `${BE_MEMORY}/notes.md`]

/** The file name a path ends in. */
function fileOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

describe('linked memory deny (G-02-1f)', () => {
  test('linkedMemoryDeny gives an Edit and a Write rule for each linked path, sorted and once each', () => {
    const result = linkedMemoryDeny([...LINKED, `${BE_MEMORY}/squad.md`])

    expect(result).toEqual({
      deny: [
        'Edit(//home/u/.claude/cadre/repo-1a2b3c4d/be/notes.md)',
        'Edit(//home/u/.claude/cadre/repo-1a2b3c4d/be/squad.md)',
        'Write(//home/u/.claude/cadre/repo-1a2b3c4d/be/notes.md)',
        'Write(//home/u/.claude/cadre/repo-1a2b3c4d/be/squad.md)',
      ],
      warnings: [],
    })
    expect(result.deny.filter(entry => lintRuntimeDenyPattern(entry) !== null)).toEqual([])
    expect(linkedMemoryDeny([])).toEqual({ deny: [], warnings: [] })
  })

  test('a path a permission rule cannot hold is skipped with a warning naming its file: it stays editable', () => {
    const odd = [
      `${BE_MEMORY}/../pm/old.md`,
      `${BE_MEMORY}/a*.md`,
      `${BE_MEMORY}/my notes.md`,
      `${BE_MEMORY}/x${BIDI_OVERRIDE}y.md`,
      'notes/rel.md',
    ]
    const result = linkedMemoryDeny([`${BE_MEMORY}/squad.md`, ...odd])

    expect(result.deny).toEqual([`Edit(/${BE_MEMORY}/squad.md)`, `Write(/${BE_MEMORY}/squad.md)`])
    expect(result.warnings).toEqual(odd.map(path => undeniedMemoryWarning(fileOf(path))))
    expect(undeniedMemoryWarning('my notes.md')).toBe(
      'memory my notes.md has a path a permission rule cannot hold: it stays editable',
    )
    expect(undeniedMemoryWarning(`x${BIDI_OVERRIDE}y.md`)).toBe(
      'memory xy.md has a path a permission rule cannot hold: it stays editable',
    )
  })

  test('renderRuntimeSettings denies the linked memories of a parts-flow role, never MEMORY.md or its own', () => {
    const role = templateRole('be')
    const scope = compileScope(role, context())
    const launcher = user({ linkedMemories: LINKED })
    const deny = denyOf(renderRuntimeSettings(role, scope, launcher, []))
    const base = runtimeDeny(role, scope, launcher).deny

    const own = [...privateDeny(BE_MEMORY), ...memoryAndRecordDeny('/home/u/.claude', BE_MEMORY)]
    expect(isPartsFlowRole(role)).toBe(true)
    expect(deny).toEqual(sortedUnique([...base, ...own, ...linkedMemoryDeny(LINKED).deny, ...launchFileRules('/repo')]))
    expect(deny.filter(entry => entry.includes(BE_MEMORY.slice(1)))).toEqual([
      `Edit(/${BE_MEMORY}/instructions.json)`,
      `Edit(/${BE_MEMORY}/instructions/**)`,
      `Edit(/${BE_MEMORY}/notes.md)`,
      `Edit(/${BE_MEMORY}/squad.md)`,
      `Write(/${BE_MEMORY}/instructions.json)`,
      `Write(/${BE_MEMORY}/instructions/**)`,
      `Write(/${BE_MEMORY}/notes.md)`,
      `Write(/${BE_MEMORY}/squad.md)`,
    ])
  })

  test('a whole-files role gets no linked memory deny, even with linked paths: its private folder and record', () => {
    const role = templateRole('be', { instructions: ['auto-memory'] })
    const scope = compileScope(role, context())
    const deny = denyOf(renderRuntimeSettings(role, scope, user({ linkedMemories: LINKED }), []))
    const record = [`Edit(/${BE_MEMORY}/instructions.json)`, `Write(/${BE_MEMORY}/instructions.json)`]

    expect(isPartsFlowRole(role)).toBe(false)
    expect(deny.filter(entry => entry.includes(BE_MEMORY.slice(1)))).toEqual(
      sortedUnique([...privateDeny(BE_MEMORY), ...record]),
    )
  })

  test('every role, of either flow, denies Edit and Write on its private instructions folder (S3)', () => {
    const launcher = user({ userDir: '/cfg', userSkills: GSD_SKILLS })
    const roles = [templateRole('pm'), templateRole('pm', { instructions: ['global-claude-md'] }), templateRole('be')]
    const denies = roles.map(role => {
      const deny = denyOf(launchPlan(role, compileScope(role, context()), launcher).settings)

      return deny.filter(entry => entry.includes('/instructions/'))
    })

    expect(denies).toEqual([
      privateDeny('/cfg/cadre/repo-1a2b3c4d/pm'),
      privateDeny('/cfg/cadre/repo-1a2b3c4d/pm'),
      privateDeny('/cfg/cadre/repo-1a2b3c4d/be'),
    ])
    expect(privateDeny('/cfg/cadre/repo-1a2b3c4d/pm')).toEqual([
      'Edit(//cfg/cadre/repo-1a2b3c4d/pm/instructions/**)',
      'Write(//cfg/cadre/repo-1a2b3c4d/pm/instructions/**)',
    ])
  })

  test('a private folder or memory path no rule can hold is not denied; the plan warns after runtimeDeny', () => {
    const role = templateRole('be')
    const scope = compileScope(role, context())
    const userDir = '/home/u s/.claude'
    const linkedMemories = [`${userDir}/cadre/repo-1a2b3c4d/be/a.md`]
    const launcher = user({ userDir, userSkills: GSD_SKILLS, linkedMemories })
    const plan = launchPlan(role, scope, launcher)
    const lead = runtimeDeny(role, scope, launcher).warnings

    const expected = sortedUnique([...runtimeDeny(role, scope, launcher).deny, ...launchFileRules('/repo')])
    expect(denyOf(plan.settings)).toEqual(expected)
    expect(plan.warnings.slice(0, lead.length + 4)).toEqual([
      ...lead,
      UNDENIED_PRIVATE_WARNING,
      UNDENIED_MEMORY_FOLDER_WARNING,
      UNDENIED_RECORD_WARNING,
      undeniedMemoryWarning('a.md'),
    ])
    expect(UNDENIED_PRIVATE_WARNING).toBe(
      'the private instructions folder has a path a permission rule cannot hold: it stays editable',
    )
  })

  test('the matrix with a linked memory per role keeps no problem: no infra violation, no own folder denied', () => {
    const results = FRAMEWORKS.flatMap(framework =>
      MATRIX_ROLES.flatMap(base =>
        ASSIGNMENTS.map(([label, assign]) => {
          const role = assign(base)
          const scope = matrixScope(role, framework)
          const folder = roleMemoryDir(MATRIX_USER, role.id)
          const plan = launchPlan(role, scope, { ...MATRIX_USER, linkedMemories: [`${folder}/squad.md`] })
          const memory = isPartsFlowRole(role) ? [`Edit(/${folder}/squad.md)`, `Write(/${folder}/squad.md)`] : []
          const home = denyOf(plan.settings).filter(entry => entry.includes('//home/'))
          const own = [...privateDeny(folder), ...memoryAndRecordDeny(MATRIX_USER.userDir, folder)]
          const expected = sortedUnique([...own, ...memory])
          const problems = [
            ...launchProblems(plan, role, scope, framework),
            ...(JSON.stringify(home) === JSON.stringify(expected) ? [] : [`home denies ${home.join(', ')}`]),
          ]

          return { problems: problems.map(problem => `${framework} / ${role.id} / ${label}: ${problem}`), memory }
        }),
      ),
    )

    expect(results.flatMap(result => result.problems)).toEqual([])
    expect(results.filter(result => result.memory.length > 0)).toHaveLength(21)
    expect(results).toHaveLength(42)
  })
})

describe('memory folder and record deny (02-GAPS-B3 C2, C3)', () => {
  test('every role denies Edit and Write on the memory folder of the root as resolved and as given, once each', () => {
    const roles = [templateRole('pm'), templateRole('pm', { instructions: ['auto-memory'] }), templateRole('be')]
    const launcher = user({ givenRoot: '/link/repo', userSkills: GSD_SKILLS })
    const folders = roles.map(role => {
      const deny = denyOf(launchPlan(role, compileScope(role, context()), launcher).settings)

      return deny.filter(entry => entry.includes('/projects/'))
    })

    expect(folders).toEqual(
      roles.map(() => [
        'Edit(//home/u/.claude/projects/-link-repo/memory/**)',
        'Edit(//home/u/.claude/projects/-repo/memory/**)',
        'Write(//home/u/.claude/projects/-link-repo/memory/**)',
        'Write(//home/u/.claude/projects/-repo/memory/**)',
      ]),
    )
    const be = templateRole('be')
    const once = denyOf(launchPlan(be, compileScope(be, context()), user()).settings)
    expect(once.filter(entry => entry.includes('/projects/'))).toEqual([
      'Edit(//home/u/.claude/projects/-repo/memory/**)',
      'Write(//home/u/.claude/projects/-repo/memory/**)',
    ])
  })

  test('every role denies Edit and Write on its own hand-out record instructions.json, never on a memory', () => {
    const launcher = user({ userDir: '/cfg', userSkills: GSD_SKILLS })
    const ids: readonly TemplateRoleId[] = ['pm', 'tl', 'be', 'security']
    const records = ids.map(id => {
      const role = templateRole(id)
      const deny = denyOf(launchPlan(role, compileScope(role, context()), launcher).settings)

      return deny.filter(entry => entry.endsWith(`/${INSTRUCTIONS_RECORD_FILE})`))
    })

    expect(records).toEqual(
      ids.map(id => [
        `Edit(//cfg/cadre/repo-1a2b3c4d/${id}/instructions.json)`,
        `Write(//cfg/cadre/repo-1a2b3c4d/${id}/instructions.json)`,
      ]),
    )
    expect(INSTRUCTIONS_RECORD_FILE).toBe('instructions.json')
  })

  test('a memory folder or record no rule can hold is not denied: each warns once, after the private folder', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const scope = compileScope(role, context())
    const launcher = user({ userDir: '/home/u s/.claude', givenRoot: '/link/repo', userSkills: GSD_SKILLS })
    const plan = launchPlan(role, scope, launcher)
    const lead = runtimeDeny(role, scope, launcher).warnings

    const launch = [...launchFileRules('/link/repo'), ...launchFileRules('/repo')]
    expect(denyOf(plan.settings)).toEqual(sortedUnique([...runtimeDeny(role, scope, launcher).deny, ...launch]))
    expect(plan.warnings.slice(lead.length)).toEqual([
      UNDENIED_PRIVATE_WARNING,
      UNDENIED_MEMORY_FOLDER_WARNING,
      UNDENIED_RECORD_WARNING,
    ])
    expect(UNDENIED_MEMORY_FOLDER_WARNING).toBe(
      'the memory folder of this repo has a path a permission rule cannot hold: its memories stay editable',
    )
    expect(UNDENIED_RECORD_WARNING).toBe(
      'the hand-out record instructions.json has a path a permission rule cannot hold: it stays editable',
    )
  })

  test('the matrix with both denies keeps no deny over .cadre/<id>/, the handoff folder or .planning/ (B4)', () => {
    const results = matrixCases(MATRIX_USER).map(item => {
      const deny = denyOf(item.plan.settings)
      const ownFolder = `//repo/.cadre/${item.role.id}/`
      const repo = deny.filter(entry => entry.includes(ownFolder) || entry.includes('//repo/.planning/'))
      const memory = deny.filter(entry => entry.includes('/projects/-repo/memory/'))
      const record = deny.filter(entry => entry.endsWith(`/${item.role.id}/instructions.json)`))

      return { label: item.label, repo, isDenied: memory.length === 2 && record.length === 2 }
    })

    expect(results.filter(result => result.repo.length > 0 || !result.isDenied).map(result => result.label)).toEqual([])
    expect(results).toHaveLength(42)
  })
})

describe('the denies of an epic render (D-157, RESEARCH Pitfall 2)', () => {
  test('every role denies Edit and Write of the launch files under its root, given root and main (03.1-SEC-S1)', () => {
    const role = templateRole('pm', { hasBash: false })
    const scope = compileScope(role, context())
    const worktree = '/repo/.claude/worktrees/x'
    const epicUser = user({ root: worktree, givenRoot: worktree, mainRoot: '/repo' })
    const epicDeny = denyOf(launchPlan(role, scope, epicUser).settings)
    const mainDeny = denyOf(launchPlan(role, scope, user({ givenRoot: '/link/repo' })).settings)
    const epicRules = [...launchFileRules('/repo'), ...launchFileRules(worktree)]
    const mainRules = [...launchFileRules('/link/repo'), ...launchFileRules('/repo')]

    expect(epicRules.filter(rule => !epicDeny.includes(rule))).toEqual([])
    expect(mainRules.filter(rule => !mainDeny.includes(rule))).toEqual([])
    expect(epicDeny.filter(entry => entry.includes('/.runtime/'))).toEqual([])
  })

  test('an epic role denies the code dirs of the main checkout as well as of its worktree', () => {
    const role = templateRole('be', { hasBash: false })
    const scope = compileScope(role, context())
    const worktree = '/repo/.claude/worktrees/x'
    const launcher = user({ root: worktree, givenRoot: worktree, codeDirs: ['src'] })
    const epicDeny = denyOf(launchPlan(role, scope, { ...launcher, mainRoot: '/repo' }).settings)
    const ownDeny = denyOf(launchPlan(role, scope, launcher).settings)
    const main = ['Read(//repo/src/**)', 'Edit(//repo/src/**)']
    const own = ['Read(//repo/.claude/worktrees/x/src/**)', 'Edit(//repo/.claude/worktrees/x/src/**)']

    expect([...main, ...own].filter(entry => !epicDeny.includes(entry))).toEqual([])
    // Without mainRoot the list is the worktree's alone, as before.
    expect([...main, ...own].filter(entry => ownDeny.includes(entry))).toEqual(own)
  })
})
