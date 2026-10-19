import { describe, expect, test } from 'claude-code/testing'

import type {
  CadreState,
  CompiledScope,
  DesiredFile,
  FrameworkAdapter,
  FrameworkId,
  RoleSpec,
  ScopeContext,
  SetupScan,
  TemplateRoleId,
} from '../types'
import { BUILTIN_ADAPTER } from './builtin'
import { compareText } from './facts'
import {
  asciiLine,
  cadreJsonText,
  desiredFiles,
  indexMdText,
  kickoffRoleLine,
  kickoffText,
  launcherText,
  mcpText,
  ROLE_LINE_MAX,
  roleJsonText,
  roleMdText,
  settingsText,
  shQuote,
} from './generate'
import type { GenerateInput } from './generate'
import { GSD_ADAPTER } from './gsd'
import { stableJson } from './plan'
import { isAutopilotDuration, parseRoleJson, ROLE_TEMPLATE, roleFromTemplate } from './roles'
import { compileScope, scopeCardLines } from './scope'
import { SUPERPOWERS_ADAPTER } from './superpowers'
import { ABSOLUTE_PATH_MARKERS, BIDI_OVERRIDE, leaks } from './testkit'

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

/**
 * The compiled scope of a role on the merged MCP route, with the whole team for the decision chain; `over` changes the
 * context fields it names.
 */
function scopeOf(
  role: RoleSpec,
  framework: FrameworkId,
  team: readonly RoleSpec[],
  over: Partial<ScopeContext> = {},
): CompiledScope {
  const ctx: ScopeContext = {
    framework,
    setup: emptySetup(),
    codeDirs: [],
    isAttended: false,
    mcpRoute: 'merged',
    roles: team,
    ...over,
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

  test('ROLE.md, the launcher, the index and the repo state hold the text of their builders', () => {
    const pm = templateRole('pm')
    const be = templateRole('be')
    const input = inputOf([pm, be], 'gsd')
    const files = desiredFiles(input)
    const scope = scopeOf(be, 'gsd', [pm, be])

    expect(contentOf(files, '.cadre/be/ROLE.md')).toBe(roleMdText(be, scope, 'gsd'))
    expect(contentOf(files, '.cadre/bin/be')).toBe(launcherText(be, scope))
    expect(contentOf(files, '.cadre/INDEX.md')).toBe(indexMdText(input.roles, input.scopes, input.frameworks))
    expect(contentOf(files, '.cadre/cadre.json')).toBe(cadreJsonText(input.state))
  })

  test('with only a role id the index still lists every role and has the same text as for init (D-68)', () => {
    const all = desiredFiles(inputOf(TEMPLATE_ROLES, 'gsd'))
    const one = desiredFiles(inputOf(TEMPLATE_ROLES, 'gsd', { only: 'be' }))
    const index = contentOf(one, '.cadre/INDEX.md') ?? ''

    expect(index).toBe(contentOf(all, '.cadre/INDEX.md'))
    expect(index.split('\n').filter(line => line.includes('| .cadre/bin/'))).toHaveLength(TEMPLATE_ROLES.length)
  })
})

/** The line ROLE.md adds after the framework line of an attended role. It is no card rule, so it never repeats one. */
const ATTENDED_LINE =
  'Attended: this role needs a person for some framework steps; the Attended rules under Scope say which.'

/** The adapter each framework is driven with: where ROLE.md takes its framework name and kickoff text from. */
const ADAPTER_OF: Readonly<Record<FrameworkId, FrameworkAdapter>> = {
  gsd: GSD_ADAPTER,
  superpowers: SUPERPOWERS_ADAPTER,
  none: BUILTIN_ADAPTER,
}

/** The lines of a document that start a section. */
function headings(text: string): string[] {
  return text.split('\n').filter(line => line.startsWith('## '))
}

/** The lines of a document that start with `Attended:` at the left margin: the banner, never an indented card rule. */
function bannerLines(text: string): string[] {
  return text.split('\n').filter(line => line.startsWith('Attended:'))
}

/** The table row of the role with this id in an index; undefined when it has none. */
function indexRowOf(index: string, id: string): string | undefined {
  return index.split('\n').find(line => line.includes(`| .cadre/bin/${id} |`))
}

describe('role documents', () => {
  test('ROLE.md opens with the title and id, the purpose, the framework line and the banner of an attended PM', () => {
    const pm = templateRole('pm')
    const text = roleMdText(pm, scopeOf(pm, 'gsd', TEMPLATE_ROLES), 'gsd')

    expect(text.split('\n').slice(0, 7)).toEqual([
      '# PM (cadre role pm)',
      '',
      'Owns product decisions: scope, requirements and acceptance.',
      '',
      'Framework: GSD. Model: opus + medium. Permission mode: auto.',
      ATTENDED_LINE,
      '',
    ])
  })

  test('ROLE.md has the sections How you work, Decisions, Handoffs and Scope, in that order', () => {
    const be = templateRole('be')
    const text = roleMdText(be, scopeOf(be, 'gsd', TEMPLATE_ROLES), 'gsd')

    expect(headings(text)).toEqual(['## How you work', '## Decisions', '## Handoffs', '## Scope'])
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
  })

  test('How you work holds the kickoff text of the adapter, and the framework line names the adapter', () => {
    const api = templateRole('be', { id: 'api', title: 'Backend API' })
    for (const framework of FRAMEWORKS) {
      const adapter = ADAPTER_OF[framework]
      const text = roleMdText(api, scopeOf(api, framework, [api]), framework)
      const kickoff = adapter.kickoffText({ title: 'Backend API', roleId: 'api', specPath: null })

      expect(text).toContain(`## How you work\n\n${kickoff}\n\n## Decisions\n`)
      expect(text).toContain(`Framework: ${adapter.name}. Model: opus + medium. Permission mode: auto.`)
    }
  })

  test('Decisions lists the chain of the card, one line for each decision type', () => {
    const pm = templateRole('pm')
    const scope = scopeOf(pm, 'gsd', TEMPLATE_ROLES)

    expect(roleMdText(pm, scope, 'gsd')).toContain(
      '## Decisions\n\n' +
        '- Product: pm -> human (queue_question)\n' +
        '- Arch: tl -> human (queue_question)\n' +
        '- Security: security -> human (queue_question)\n' +
        '- QA: tl -> human (queue_question)\n\n## Handoffs\n',
    )
    expect(scope.card.chain).toHaveLength(4)
  })

  test('Decisions follow basedOn: a renamed PM still takes the product decisions', () => {
    const product = templateRole('pm', { id: 'product', title: 'Product' })
    const be = templateRole('be')
    const text = roleMdText(be, scopeOf(be, 'gsd', [product, be]), 'gsd')

    expect(text).toContain('- Product: product -> human (queue_question)\n')
  })

  test('Handoffs names the handoff folder of the role id', () => {
    const api = templateRole('be', { id: 'api', title: 'Backend API' })
    const text = roleMdText(api, scopeOf(api, 'gsd', [api]), 'gsd')

    expect(text).toContain(
      '## Handoffs\n\n' +
        "Write every handoff under thoughts/shared/handoffs/api/ (autopilot's handoff path).\n\n## Scope\n",
    )
  })

  test('Scope holds the lines of the scope card', () => {
    const be = templateRole('be', { mcp: ['jira'] })
    const scope = scopeOf(be, 'superpowers', TEMPLATE_ROLES)
    const text = roleMdText(be, scope, 'superpowers')

    expect(text.endsWith(`## Scope\n\n${scopeCardLines(scope.card).join('\n')}\n`)).toBe(true)
    expect(text).toContain('Scope card: BE (be)\n')
  })

  test('a role with Bash on an unattended team has no banner', () => {
    const be = templateRole('be')
    const text = roleMdText(be, scopeOf(be, 'gsd', TEMPLATE_ROLES), 'gsd')

    expect(bannerLines(text)).toEqual([])
    expect(text).toContain('Permission mode: auto.\n\n## How you work\n')
  })

  test('an attended context adds the banner once, and the banner never repeats the text of a card rule', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'gsd', TEMPLATE_ROLES, { isAttended: true })
    const text = roleMdText(be, scope, 'gsd')

    expect(bannerLines(text)).toEqual([ATTENDED_LINE])
    expect(text).toContain(
      '    [none] Attended: this role needs a person for framework steps that cannot run unattended\n',
    )
    expect(text).not.toContain('Attended: Attended:')
  })

  test('a PM on GSD in an attended context has two Attended card rules and still one banner', () => {
    const pm = templateRole('pm')
    const scope = scopeOf(pm, 'gsd', TEMPLATE_ROLES, { isAttended: true })
    const text = roleMdText(pm, scope, 'gsd')

    expect(bannerLines(text)).toEqual([ATTENDED_LINE])
    expect(text.split('\n').filter(line => line.startsWith('    [none] Attended:'))).toHaveLength(2)
    expect(text).not.toContain('Attended: Attended:')
  })

  test('a title and a purpose are cleaned before they reach the document', () => {
    const role = templateRole('pm', { title: `PM${BIDI_OVERRIDE}`, purpose: 'Owns a thing.\n## Injected\nmore' })
    const text = roleMdText(role, scopeOf(role, 'gsd', [role]), 'gsd')
    const lines = text.split('\n')

    expect(leaks(text, [BIDI_OVERRIDE])).toEqual([])
    expect(lines[0]).toBe('# PM (cadre role pm)')
    expect(lines[2]).toBe('Owns a thing.## Injectedmore')
    expect(headings(text)).toEqual(['## How you work', '## Decisions', '## Handoffs', '## Scope'])
  })

  test('INDEX.md of two roles is the header, the table header and one row each, in role order', () => {
    const pm = templateRole('pm')
    const be = templateRole('be')
    const input = inputOf([pm, be], 'gsd')

    expect(indexMdText(input.roles, input.scopes, input.frameworks)).toBe(
      [
        '# cadre roles',
        '',
        'Generated by cadre from the role definitions. Edit .cadre/<id>/role.json and run /cadre regen <id>.',
        '',
        '| Role | Purpose | Framework | Model | Scope | Launcher | Handoffs |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        '| PM (pm) | Owns product decisions: scope, requirements and acceptance. | GSD | opus + medium | ' +
          'no Bash; MCP: none; skills: 8 | .cadre/bin/pm | thoughts/shared/handoffs/pm/ |',
        '| BE (be) | Implements the backend and core code. | GSD | opus + medium | ' +
          'sandboxed Bash; MCP: none; skills: 8 | .cadre/bin/be | thoughts/shared/handoffs/be/ |',
        '',
      ].join('\n'),
    )
  })

  test('the scope cell lists the MCP servers sorted and counts the skills the role can run, by framework', () => {
    const be = templateRole('be', { mcp: ['jira', 'github'], skills: ['codex:rescue', 'my-skill', 'gsd-plan-phase'] })
    const expected: readonly (readonly [FrameworkId, string])[] = [
      ['gsd', 'sandboxed Bash; MCP: github, jira; skills: 10'],
      ['superpowers', 'sandboxed Bash; MCP: github, jira; skills: 9'],
      ['none', 'sandboxed Bash; MCP: github, jira; skills: 5'],
    ]
    for (const [framework, cell] of expected) {
      const input = inputOf([be], framework)
      const row = indexRowOf(indexMdText(input.roles, input.scopes, input.frameworks), 'be')

      expect(row).toContain(` | ${cell} | `)
    }
  })

  test('more than 12 MCP servers show the first 12 and the count of the rest', () => {
    const names = Array.from({ length: 14 }, (_, index) => `srv${String(index + 1).padStart(2, '0')}`)
    const input = inputOf([templateRole('be', { mcp: names })], 'gsd')
    const row = indexRowOf(indexMdText(input.roles, input.scopes, input.frameworks), 'be')

    expect(row).toContain(`MCP: ${names.slice(0, 12).join(', ')}, +2 more; `)
    expect(row).not.toContain('srv13')
  })

  test('a pipe in a title or a purpose is written as \\| so it stays one cell', () => {
    const input = inputOf([templateRole('be', { title: 'B|E', purpose: 'Builds a | b.' })], 'gsd')
    const row = indexRowOf(indexMdText(input.roles, input.scopes, input.frameworks), 'be')

    expect(row?.startsWith('| B\\|E (be) | Builds a \\| b. | GSD | ')).toBe(true)
  })

  test('a title and a purpose in the index are cleaned', () => {
    const role = templateRole('be', { title: `B${BIDI_OVERRIDE}E`, purpose: 'Line one\nLine two' })
    const input = inputOf([role], 'gsd')
    const index = indexMdText(input.roles, input.scopes, input.frameworks)

    expect(leaks(index, [BIDI_OVERRIDE])).toEqual([])
    expect(indexRowOf(index, 'be')?.startsWith('| BE (be) | Line oneLine two | ')).toBe(true)
  })

  test('INDEX.md is static: the same input gives the same text, with no date and no count of handoffs', () => {
    const input = inputOf(TEMPLATE_ROLES, 'gsd')
    const first = indexMdText(input.roles, input.scopes, input.frameworks)
    const second = indexMdText(input.roles, input.scopes, input.frameworks)

    expect(second).toBe(first)
    expect(/\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}/.test(first)).toBe(false)
    expect(first.toLowerCase()).not.toContain('latest')
  })

  test('a role with no scope or no framework has no row in the index', () => {
    const input = inputOf(TEMPLATE_ROLES, 'gsd')
    const noScope = new Map(Array.from(input.scopes).filter(([id]) => id !== 'qa'))
    const noFramework = new Map(Array.from(input.frameworks).filter(([id]) => id !== 'fe'))
    const text = indexMdText(input.roles, noScope, noFramework)

    expect(indexRowOf(text, 'qa')).toBeUndefined()
    expect(indexRowOf(text, 'fe')).toBeUndefined()
    expect(indexRowOf(text, 'security')).toContain('| Security (security) |')
  })

  test('cadreJsonText is the stable JSON of the repo state and parses back to it', () => {
    const state = stateOf(TEMPLATE_ROLES, 'gsd')

    expect(cadreJsonText(state)).toBe(stableJson(state))
    expect(JSON.parse(cadreJsonText(state))).toEqual(state)
    expect(cadreJsonText({ ...state, framework: null })).toContain('"framework": null')
  })
})

/** The characters a shell reads as part of a bare word: what shQuote leaves unquoted. */
const BARE_SHELL_CHAR = /[A-Za-z0-9_./=:@+-]/

/**
 * The words a POSIX shell reads from a line, for the quoting shapes the launcher uses: bare words of plain characters,
 * single-quoted spans, a backslash before a single quote, and double-quoted spans read to the next double quote. It
 * throws on any other character outside quotes, so a metacharacter left bare fails the test that reads the line.
 */
function shellWords(line: string): string[] {
  const words: string[] = []
  let word: string | null = null
  let quote = ''
  for (let index = 0; index < line.length; index++) {
    const char = line.charAt(index)
    if (quote !== '') {
      if (char === quote) quote = ''
      else word = `${word ?? ''}${char}`
      continue
    }
    if (char === ' ') {
      if (word !== null) words.push(word)
      word = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      word = word ?? ''
      continue
    }
    if (char === '\\' && line.charAt(index + 1) === "'") {
      word = `${word ?? ''}'`
      index += 1
      continue
    }
    if (!BARE_SHELL_CHAR.test(char)) throw new Error(`a bare ${JSON.stringify(char)} in ${line}`)
    word = `${word ?? ''}${char}`
  }
  if (quote !== '') throw new Error(`an unclosed quote in ${line}`)
  if (word !== null) words.push(word)

  return words
}

/** Whether the shell reader refuses a line (a bare metacharacter or an unclosed quote). */
function isRefused(line: string): boolean {
  try {
    shellWords(line)
  } catch {
    return true
  }

  return false
}

/** The words of the `exec claude` line of a launcher. */
function execWords(launcher: string): string[] {
  const start = launcher.indexOf('\nexec ')

  return shellWords(launcher.slice(start + 1).replace(/\n$/, ''))
}

/** The flags of the BE role on the merged route, in launcher order. */
const BE_FLAGS = [
  '--setting-sources project',
  '--settings .cadre/be/.runtime/settings.json',
  '--append-system-prompt-file .cadre/be/ROLE.md',
  '--name cadre-be',
  '--model opus',
  '--effort medium',
  '--permission-mode auto',
  '--add-dir .cadre/be/.runtime/overlay',
  '--mcp-config .cadre/be/.runtime/mcp.json',
].join(' ')

/** Words a shell would treat as more than one word, a command or a substitution if they were left bare. */
const HOSTILE_WORDS: readonly string[] = [
  '',
  'a b',
  "it's",
  "'",
  "''",
  '$(x)',
  '${HOME}',
  '$HOME',
  '`x`',
  'a;b',
  'a|b',
  'a&b',
  'a>b',
  'a<b',
  'a\nb',
  'a"b',
  'a\\b',
  '*',
  '~',
  '#x',
  '!x',
  '{a,b}',
  '--flag=value with space',
  `caf${String.fromCodePoint(0xe9)}`,
]

describe('launcher', () => {
  test('shQuote leaves a plain word bare and single-quotes any other, writing a quote as four characters', () => {
    expect(shQuote('cadre-be')).toBe('cadre-be')
    expect(shQuote('.cadre/be/.runtime/settings.json')).toBe('.cadre/be/.runtime/settings.json')
    expect(shQuote('a b')).toBe("'a b'")
    expect(shQuote("it's")).toBe("'it'\\''s'")
    expect(shQuote('$(x)')).toBe("'$(x)'")
    expect(shQuote('')).toBe("''")
  })

  test('a shell reads shQuote of any hostile word back as that one word', () => {
    for (const word of HOSTILE_WORDS) {
      expect(shellWords(shQuote(word))).toEqual([word])
    }
  })

  test('the shell reader refuses a bare metacharacter, so it can fail the launcher tests', () => {
    expect(isRefused('a;b')).toBe(true)
    expect(isRefused('$(x)')).toBe(true)
    expect(isRefused("'open")).toBe(true)
    expect(isRefused("a 'b c' d\\'e \"f g\"")).toBe(false)
    expect(shellWords("a 'b c' d\\'e \"f g\"")).toEqual(['a', 'b c', "d'e", 'f g'])
  })

  test('the launcher of the BE is the shebang, two comment lines, set -eu, cd to the top level and exec claude', () => {
    const be = templateRole('be')

    expect(launcherText(be, scopeOf(be, 'gsd', [be]))).toBe(
      [
        '#!/bin/sh',
        '# cadre launcher for role be. Provisional (Phase 2): Phase 3 adds the claude version check',
        '# and renders .cadre/be/.runtime/ before it starts the session.',
        'set -eu',
        'cd "$(git rev-parse --show-toplevel)"',
        `exec claude ${BE_FLAGS} -- "$(cat .cadre/be/kickoff.txt)"`,
        '',
      ].join('\n'),
    )
  })

  test('the words of the exec line are claude, the flags of the scope one by one, --, and the kickoff text', () => {
    for (const framework of FRAMEWORKS) {
      for (const role of TEMPLATE_ROLES) {
        const scope = scopeOf(role, framework, TEMPLATE_ROLES)

        expect(execWords(launcherText(role, scope))).toEqual([
          'exec',
          'claude',
          ...scope.flags,
          '--',
          `$(cat .cadre/${role.id}/kickoff.txt)`,
        ])
      }
    }
  })

  test('on the strict MCP route the last flag word is --strict-mcp-config, before the --', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'gsd', [be], { mcpRoute: 'strict' })
    const words = execWords(launcherText(be, scope))

    expect(words.slice(-3)).toEqual(['--strict-mcp-config', '--', '$(cat .cadre/be/kickoff.txt)'])
  })

  test('a flag that holds a space, a quote or a dollar stays one word', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'gsd', [be])
    const hostile: CompiledScope = { ...scope, flags: [...scope.flags, '--add-dir', "x y'$(z);`"] }

    expect(execWords(launcherText(be, hostile))).toEqual([
      'exec',
      'claude',
      ...scope.flags,
      '--add-dir',
      "x y'$(z);`",
      '--',
      '$(cat .cadre/be/kickoff.txt)',
    ])
  })

  test('a role id with a space, a quote or a dollar cannot add a command', () => {
    const id = "x y'$(z);`"
    const role = templateRole('be', { id })
    const text = launcherText(role, scopeOf(role, 'gsd', [role]))
    const lines = text.split('\n')
    const kickoffPath = `.cadre/${id}/kickoff.txt`

    expect(lines).toHaveLength(7)
    expect(lines.slice(0, 3).map(line => line.charAt(0))).toEqual(['#', '#', '#'])
    expect(lines.slice(3, 5)).toEqual(['set -eu', 'cd "$(git rev-parse --show-toplevel)"'])
    expect(execWords(text).slice(-2)).toEqual(['--', `$(cat ${shQuote(kickoffPath)})`])
  })

  test('a role id with a line break cannot leave the comment lines or the quotes', () => {
    const id = 'x\nrm -rf ~'
    const role = templateRole('be', { id })
    const text = launcherText(role, scopeOf(role, 'gsd', [role]))
    const lines = text.split('\n')

    expect(lines.slice(0, 5).map(line => line.charAt(0))).toEqual(['#', '#', '#', 's', 'c'])
    expect(lines[1]).toBe(
      '# cadre launcher for role xrm -rf ~. Provisional (Phase 2): Phase 3 adds the claude version check',
    )
    expect(execWords(text)).toContain(`.cadre/${id}/.runtime/settings.json`)
  })

  test('a title never reaches the launcher', () => {
    const be = templateRole('be', { title: '$(evil) `x`; rm -rf ~' })
    const text = launcherText(be, scopeOf(be, 'gsd', [be]))

    expect(text).not.toContain('evil')
    expect(text).not.toContain('rm -rf')
  })

  test('the launcher holds no absolute user path and no variable reference, whatever the role and framework', () => {
    const problems: string[] = []
    for (const framework of FRAMEWORKS) {
      for (const role of TEMPLATE_ROLES) {
        const text = launcherText(role, scopeOf(role, framework, TEMPLATE_ROLES))
        const found = leaks(text, [...ABSOLUTE_PATH_MARKERS, '${'])
        problems.push(...found.map(needle => `${framework} / ${role.id}: ${needle}`))
      }
    }

    expect(problems).toEqual([])
  })
})
