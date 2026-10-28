import { describe, expect, test } from 'claude-code/testing'

import type {
  CompiledScope,
  FrameworkId,
  HookScript,
  RoleSpec,
  ScopeContext,
  SettingsSource,
  SetupScan,
} from '../../types'
import { ROLE_TEMPLATE, roleFromTemplate } from '../roles/template'
import { compileScope } from '../scope'
import { emptySetupScan, FRAMEWORKS, session, skillRef, templateRole } from '../testkit'
import { infraViolations, isSafeDir, lintDenyPattern, pluginName, roleOwnPaths } from './lint'

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

describe('safety net: pluginName (A8)', () => {
  test('pluginName: the part of a plugin key before its first @; a key with no @ is its own name', () => {
    expect(pluginName('superpowers@claude-plugins-official')).toBe('superpowers')
    expect(pluginName('codex')).toBe('codex')
  })
})
