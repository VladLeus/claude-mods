import { describe, expect, test } from 'claude-code/testing'

import type {
  CadreState,
  CompiledScope,
  DesiredFile,
  FrameworkId,
  RoleSpec,
  ScopeContext,
  SetupScan,
  TemplateRoleId,
} from '../types'
import { compareText } from './facts'
import {
  asciiLine,
  desiredFiles,
  kickoffRoleLine,
  kickoffText,
  mcpText,
  ROLE_LINE_MAX,
  roleJsonText,
  settingsText,
} from './generate'
import type { GenerateInput } from './generate'
import { stableJson } from './plan'
import { isAutopilotDuration, parseRoleJson, ROLE_TEMPLATE, roleFromTemplate } from './roles'
import { compileScope } from './scope'

/** The template role with this id, as init builds it: nothing assigned, every other field a default. */
function templateRole(id: TemplateRoleId, over: Partial<RoleSpec> = {}): RoleSpec {
  const row = ROLE_TEMPLATE.find(candidate => candidate.id === id)
  if (row === undefined) throw new Error(`no template role ${id}`)

  return { ...roleFromTemplate(row), ...over }
}

/** The six template roles, as init builds them with nothing assigned. */
const TEMPLATE_ROLES: readonly RoleSpec[] = ROLE_TEMPLATE.map(row => roleFromTemplate(row))

/** The three frameworks a role can run. */
const FRAMEWORKS: readonly FrameworkId[] = ['gsd', 'superpowers', 'none']

/** A setup scan that found nothing. */
function emptySetup(): SetupScan {
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
  }
}

/** The compiled scope of a role on the merged MCP route, with the whole team for the decision chain. */
function scopeOf(role: RoleSpec, framework: FrameworkId, team: readonly RoleSpec[]): CompiledScope {
  const ctx: ScopeContext = {
    framework,
    setup: emptySetup(),
    codeDirs: [],
    isAttended: false,
    mcpRoute: 'merged',
    roles: team,
  }

  return compileScope(role, ctx)
}

/** The repo state of a team on one framework: what init writes as .cadre/cadre.json. */
function stateOf(team: readonly RoleSpec[], framework: FrameworkId): CadreState {
  return { schema: 1, cadreVersion: '0.2.0', framework, gitPolicy: 'definitions', roles: team.map(role => role.id) }
}

/** The input init gives desiredFiles for a team that runs one framework; `over` changes the fields it names. */
function inputOf(team: readonly RoleSpec[], framework: FrameworkId, over: Partial<GenerateInput> = {}): GenerateInput {
  return {
    roles: team,
    scopes: new Map(team.map((role): [string, CompiledScope] => [role.id, scopeOf(role, framework, team)])),
    frameworks: new Map(team.map((role): [string, FrameworkId] => [role.id, framework])),
    state: stateOf(team, framework),
    only: null,
    ...over,
  }
}

/**
 * The start grammar of autopilot/hooks/autopilot.ts (parseStart, line 544), copied character for character and never
 * imported: the golden check that autopilot reads kickoff.txt. Autopilot reads its flags outside the quoted role.
 */
const AUTOPILOT_START =
  /^(?:until\s+(\S+)|(?!until\s)(\S+))\s+(\d{1,3})%?\s+(?:(\d{1,2})\s+)?(["'“«][\s\S]+|[^\d\s][\s\S]*)$/i

/** What autopilot makes of a start command: the duration, the threshold and the role. */
type StartRead = {
  readonly duration: string
  readonly threshold: number
  readonly role: string
}

/**
 * A kickoff as autopilot's start grammar reads it: the `/autopilot ` prefix, the trailing newline and the `--ask-user`
 * switch removed, then the copied pattern, a threshold of 1 to 95 and a role of at least 10 characters. Null when
 * autopilot would refuse it.
 */
function readStart(text: string): StartRead | null {
  const args = text.replace(/^\/autopilot /, '').replace(/\n$/, '').replace(/ --ask-user$/, '')
  const match = AUTOPILOT_START.exec(args)
  if (match === null) return null
  const [, , rawDuration = '', rawThreshold = '', , rawRole = ''] = match
  const threshold = Number(rawThreshold)
  if (threshold < 1 || threshold > 95) return null
  const role = rawRole.trim().replace(/^["'“«]|["'”»]$/g, '').trim()
  if (role.length < 10) return null

  return { duration: rawDuration, threshold, role }
}

/** The characters a role line may hold: printable ASCII, and never a quote or a backtick (D-79). */
const ROLE_LINE_CHARS = /^[\x20-\x7e]+$/
const QUOTE_CHARS = /["'`]/

/** Every way a kickoff of this role and framework breaks the contract with autopilot, as messages; empty when none. */
function kickoffProblems(role: RoleSpec, framework: FrameworkId): string[] {
  const text = kickoffText(role, framework)
  const start = readStart(text)
  if (start === null) return ['autopilot would refuse it']
  const problems: string[] = []
  if (start.duration !== '4h' || !isAutopilotDuration(start.duration)) problems.push(`duration ${start.duration}`)
  if (start.threshold !== 65) problems.push(`threshold ${start.threshold}`)
  if (!ROLE_LINE_CHARS.test(start.role) || QUOTE_CHARS.test(start.role)) problems.push('role line has a bad character')
  if (start.role.length > ROLE_LINE_MAX) problems.push(`role line is ${start.role.length} characters`)
  if (text.endsWith(' --ask-user\n') !== role.autopilot.askUser) problems.push('--ask-user does not follow the role')
  if (text.split('\n').length !== 2) problems.push('kickoff is not one line and a newline')

  return problems
}

describe('kickoff', () => {
  test('asciiLine keeps printable ASCII, drops quotes and backticks and collapses spaces', () => {
    const open = String.fromCodePoint(0x201c)
    const close = String.fromCodePoint(0x201d)
    const smiley = String.fromCodePoint(0x1f600)
    const curly = `Team Lead ${open}x${close} ${smiley}`
    const quoted = ['a', '"b"', "'c'", '`d`', '  e'].join(' ')

    expect(asciiLine(curly, 200)).toBe('Team Lead x')
    expect(asciiLine(quoted, 200)).toBe('a b c d e')
  })

  test('asciiLine reads a tab, a line break and a no-break space as one space', () => {
    expect(asciiLine(`a\tb\nc${String.fromCodePoint(0xa0)}d`, 200)).toBe('a b c d')
  })

  test('asciiLine cuts to the cap without a trailing space, and a cap below 1 gives nothing', () => {
    expect(asciiLine('abcdef', 3)).toBe('abc')
    expect(asciiLine('ab cd', 3)).toBe('ab')
    expect(asciiLine('abcdef', 0)).toBe('')
    expect(asciiLine('abcdef', -2)).toBe('')
  })

  test('the role line names the title in the sentence, the id in paths and the start of the framework', () => {
    const be = templateRole('be')

    expect(kickoffRoleLine(be, 'gsd')).toBe(
      'You are the BE role of this repo (cadre role be). Read .cadre/be/ROLE.md and start with /gsd-autonomous.',
    )
    expect(kickoffRoleLine(be, 'superpowers')).toBe(
      'You are the BE role of this repo (cadre role be). Read .cadre/be/ROLE.md and start with ' +
        'superpowers:brainstorming.',
    )
    expect(kickoffRoleLine(be, 'none')).toBe(
      'You are the BE role of this repo (cadre role be). Read .cadre/be/ROLE.md and start with ' +
        'the plan in .cadre/be/.runtime/plan.md.',
    )
  })

  test('a renamed role uses its title in the sentence and its id in every path', () => {
    const api = templateRole('be', { id: 'api', title: 'Backend API' })

    expect(kickoffRoleLine(api, 'gsd')).toBe(
      'You are the Backend API role of this repo (cadre role api). Read .cadre/api/ROLE.md and start with ' +
        '/gsd-autonomous.',
    )
    expect(kickoffRoleLine(api, 'none')).toContain('start with the plan in .cadre/api/.runtime/plan.md.')
  })

  test('a title with no ASCII character left is replaced by the role id in the sentence', () => {
    const cyrillic = String.fromCodePoint(0x414, 0x438, 0x437, 0x430, 0x439, 0x43d, 0x435, 0x440)
    const role = templateRole('be', { id: 'design', title: cyrillic })

    expect(kickoffRoleLine(role, 'gsd')).toBe(
      'You are the design role of this repo (cadre role design). Read .cadre/design/ROLE.md and start with ' +
        '/gsd-autonomous.',
    )
  })

  test('a title of 300 characters gives a role line of at most 200 that still ends with the instruction', () => {
    const role = templateRole('be', { title: 'T'.repeat(300) })

    for (const framework of FRAMEWORKS) {
      const line = kickoffRoleLine(role, framework)

      expect(line.length <= ROLE_LINE_MAX).toBe(true)
      expect(line.startsWith('You are the TTTT')).toBe(true)
    }
    expect(kickoffRoleLine(role, 'gsd').endsWith('Read .cadre/be/ROLE.md and start with /gsd-autonomous.')).toBe(true)
  })

  test('a 24 character id with a long title keeps the whole plan path of the built-in framework', () => {
    const id = 'a'.repeat(24)
    const line = kickoffRoleLine(templateRole('be', { id, title: 'T'.repeat(40) }), 'none')

    expect(line.length <= ROLE_LINE_MAX).toBe(true)
    expect(line.endsWith(`start with the plan in .cadre/${id}/.runtime/plan.md.`)).toBe(true)
  })

  test('the kickoff of the PM is the autopilot command with the role line and --ask-user, then a newline', () => {
    expect(kickoffText(templateRole('pm'), 'gsd')).toBe(
      '/autopilot 4h 65 "You are the PM role of this repo (cadre role pm). Read .cadre/pm/ROLE.md and start with ' +
        '/gsd-autonomous." --ask-user\n',
    )
  })

  test('the kickoff of the BE has no --ask-user', () => {
    expect(kickoffText(templateRole('be'), 'superpowers')).toBe(
      '/autopilot 4h 65 "You are the BE role of this repo (cadre role be). Read .cadre/be/ROLE.md and start with ' +
        'superpowers:brainstorming."\n',
    )
  })

  test('the duration, the threshold and --ask-user come from the autopilot values of the role', () => {
    const autopilot = { duration: '90m', threshold: 40, askUser: true }
    const text = kickoffText(templateRole('be', { autopilot }), 'gsd')

    expect(text.startsWith('/autopilot 90m 40 "You are the BE role')).toBe(true)
    expect(text.endsWith('/gsd-autonomous." --ask-user\n')).toBe(true)
  })

  test('the copy of the autopilot grammar refuses what autopilot refuses', () => {
    const line = 'You are the BE role of this repo.'

    expect(readStart(`/autopilot 4h 65 "${line}"\n`)).toEqual({ duration: '4h', threshold: 65, role: line })
    expect(readStart(`/autopilot 4h 96 "${line}"\n`)).toBeNull()
    expect(readStart(`/autopilot 4h 0 "${line}"\n`)).toBeNull()
    expect(readStart('/autopilot 4h 65 "short"\n')).toBeNull()
    expect(readStart(`/autopilot 4h "${line}"\n`)).toBeNull()
  })

  test('every kickoff of the six template roles in the three frameworks parses with threshold 65', () => {
    const problems: string[] = []
    for (const framework of FRAMEWORKS) {
      for (const role of TEMPLATE_ROLES) {
        problems.push(...kickoffProblems(role, framework).map(problem => `${framework} / ${role.id}: ${problem}`))
      }
    }

    expect(problems).toEqual([])
    expect(TEMPLATE_ROLES.filter(role => role.autopilot.askUser).map(role => role.id)).toEqual(['pm', 'tl', 'security'])
  })

  test('role.json is the role with schema 1 in stable JSON', () => {
    expect(roleJsonText(templateRole('be'))).toBe(
      [
        '{',
        '  "autopilot": {',
        '    "askUser": false,',
        '    "duration": "4h",',
        '    "threshold": 65',
        '  },',
        '  "basedOn": "be",',
        '  "carry": {',
        '    "autoCompactWindow": false,',
        '    "env": [],',
        '    "hooks": [],',
        '    "statusLine": false',
        '  },',
        '  "effort": "medium",',
        '  "hasBash": true,',
        '  "id": "be",',
        '  "instructions": [],',
        '  "mcp": [],',
        '  "model": "opus",',
        '  "permissionMode": "auto",',
        '  "purpose": "Implements the backend and core code.",',
        '  "schema": 1,',
        '  "skills": [],',
        '  "title": "BE"',
        '}',
        '',
      ].join('\n'),
    )
  })

  test('parseRoleJson reads role.json back to the same role, for every template role', () => {
    for (const role of TEMPLATE_ROLES) {
      expect(parseRoleJson(roleJsonText(role))).toEqual(role)
    }
  })

  test('a role with a framework, servers, skills and carried names reads back to the same role', () => {
    const role = templateRole('tl', {
      framework: 'superpowers',
      mcp: ['github', 'jira'],
      skills: ['codex:rescue', 'my-skill'],
      instructions: ['project-claude-md'],
      carry: { autoCompactWindow: true, statusLine: true, env: ['API_KEY'], hooks: ['gsd-secret-read-guard.js'] },
    })

    expect(roleJsonText(role)).toContain('"framework": "superpowers"')
    expect(parseRoleJson(roleJsonText(role))).toEqual(role)
  })

  test('settingsText is the stable JSON of the settings template and mcpText that of the MCP file', () => {
    const role = templateRole('be', { mcp: ['jira', 'github'] })
    const scope = scopeOf(role, 'gsd', [role])

    expect(settingsText(scope)).toBe(stableJson(scope.settings))
    expect(mcpText(scope)).toBe(stableJson(scope.mcp))
    expect(JSON.parse(mcpText(scope))).toEqual({ schema: 1, servers: ['github', 'jira'] })
    expect(mcpText(scopeOf(templateRole('be'), 'gsd', [templateRole('be')]))).toBe(
      '{\n  "schema": 1,\n  "servers": []\n}\n',
    )
  })
})

/** The paths of the files init wants for the BE role alone, sorted by code unit. */
const BE_PATHS: readonly string[] = [
  '.cadre/INDEX.md',
  '.cadre/be/ROLE.md',
  '.cadre/be/kickoff.txt',
  '.cadre/be/mcp.json',
  '.cadre/be/role.json',
  '.cadre/be/settings.json',
  '.cadre/bin/be',
  '.cadre/cadre.json',
]

/** The text of one desired file; undefined when the path is not desired. */
function contentOf(files: readonly DesiredFile[], path: string): string | undefined {
  return files.find(file => file.path === path)?.content
}

/** The desired paths that belong to one role: its folder and its launcher. */
function pathsOfRole(files: readonly DesiredFile[], id: string): string[] {
  return files.map(file => file.path).filter(path => path.startsWith(`.cadre/${id}/`) || path === `.cadre/bin/${id}`)
}

describe('desiredFiles', () => {
  test('one role gives its five definition files, its launcher, the index and the repo state, sorted by path', () => {
    const files = desiredFiles(inputOf([templateRole('be')], 'gsd'))

    expect(files.map(file => file.path)).toEqual(BE_PATHS)
  })

  test('only the launcher is executable', () => {
    const files = desiredFiles(inputOf([templateRole('be')], 'gsd'))

    expect(files.filter(file => file.mode === 'exec').map(file => file.path)).toEqual(['.cadre/bin/be'])
    expect(files.filter(file => file.mode === 'file')).toHaveLength(BE_PATHS.length - 1)
  })

  test('role.json, kickoff.txt, settings.json and mcp.json hold the text of their builders', () => {
    const be = templateRole('be', { mcp: ['jira'] })
    const scope = scopeOf(be, 'superpowers', [be])
    const files = desiredFiles(inputOf([be], 'superpowers'))

    expect(contentOf(files, '.cadre/be/role.json')).toBe(roleJsonText(be))
    expect(contentOf(files, '.cadre/be/kickoff.txt')).toBe(kickoffText(be, 'superpowers'))
    expect(contentOf(files, '.cadre/be/settings.json')).toBe(settingsText(scope))
    expect(contentOf(files, '.cadre/be/mcp.json')).toBe(mcpText(scope))
  })

  test('each role is generated with its own framework', () => {
    const team = [templateRole('pm'), templateRole('be')]
    const input = inputOf(team, 'gsd', { frameworks: new Map<string, FrameworkId>([['pm', 'gsd'], ['be', 'none']]) })
    const files = desiredFiles(input)

    expect(contentOf(files, '.cadre/pm/kickoff.txt')).toContain('start with /gsd-autonomous.')
    expect(contentOf(files, '.cadre/be/kickoff.txt')).toContain('start with the plan in .cadre/be/.runtime/plan.md.')
  })

  test('the six template roles give 36 role files, the index and the repo state, sorted and once each', () => {
    const paths = desiredFiles(inputOf(TEMPLATE_ROLES, 'gsd')).map(file => file.path)

    expect(paths).toHaveLength(6 * 6 + 2)
    expect(paths).toEqual([...paths].sort(compareText))
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.filter(path => path.startsWith('.cadre/bin/'))).toEqual(
      ['pm', 'tl', 'be', 'fe', 'qa', 'security'].map(id => `.cadre/bin/${id}`).sort(compareText),
    )
  })

  test('with only a role id the set is that role, its launcher and the index, and no repo state (D-68)', () => {
    const files = desiredFiles(inputOf(TEMPLATE_ROLES, 'gsd', { only: 'be' }))

    expect(files.map(file => file.path)).toEqual(BE_PATHS.filter(path => path !== '.cadre/cadre.json'))
  })

  test('with only an id that is not on the team the set is the index alone', () => {
    const files = desiredFiles(inputOf(TEMPLATE_ROLES, 'gsd', { only: 'nobody' }))

    expect(files.map(file => file.path)).toEqual(['.cadre/INDEX.md'])
  })

  test('a role with no scope or no framework is skipped, with its launcher', () => {
    const pm = templateRole('pm')
    const be = templateRole('be')
    const full = inputOf([pm, be], 'gsd')
    const noScope = desiredFiles({ ...full, scopes: new Map([['pm', scopeOf(pm, 'gsd', [pm, be])]]) })
    const noFramework = desiredFiles({ ...full, frameworks: new Map<string, FrameworkId>([['be', 'gsd']]) })

    expect(pathsOfRole(noScope, 'be')).toEqual([])
    expect(pathsOfRole(noScope, 'pm')).toHaveLength(6)
    expect(pathsOfRole(noFramework, 'pm')).toEqual([])
    expect(pathsOfRole(noFramework, 'be')).toHaveLength(6)
  })

  test('generation keeps no state: the same input gives the same files and the input is not changed', () => {
    const input = inputOf(TEMPLATE_ROLES, 'gsd')
    const snapshot = (): string =>
      JSON.stringify([input.roles, Array.from(input.scopes), Array.from(input.frameworks), input.state])
    const before = snapshot()
    const first = desiredFiles(input)
    const second = desiredFiles(input)

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(snapshot()).toBe(before)
  })
})
