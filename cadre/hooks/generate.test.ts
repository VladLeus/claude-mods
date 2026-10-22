import { describe, expect, test } from 'claude-code/testing'

import type {
  CadreState,
  CompiledScope,
  DesiredFile,
  FileOp,
  FrameworkAdapter,
  FrameworkId,
  InstructionPart,
  LaunchStart,
  RoleSpec,
  ScopeContext,
  SetupScan,
} from '../types'
import { BUILTIN_ADAPTER } from './builtin'
import { compareText, isObject } from './facts'
import {
  asciiLine,
  cadreJsonText,
  desiredFiles,
  GIT_TRACKING_UNKNOWN_WARNING,
  gitTrackedArgv,
  indexMdText,
  kickoffRoleLine,
  kickoffText,
  launcherText,
  mcpText,
  repoPartFiles,
  ROLE_LINE_MAX,
  roleClaudeMdText,
  roleJsonText,
  roleMdText,
  settingsText,
  shQuote,
  trackedFilesOf,
  trackedRepoParts,
  untrackedPartsWarning,
} from './generate'
import type { GenerateInput } from './generate'
import { GSD_ADAPTER } from './gsd'
import { buildPlan, isSafeOpPath, stableJson } from './plan'
import { isAutopilotDuration, parseRoleJson, ROLE_TEMPLATE, roleFromTemplate } from './roles'
import { parseCadreState } from './scan'
import { compileScope, infraViolations, scopeCardLines } from './scope'
import { SUPERPOWERS_ADAPTER } from './superpowers'
import {
  ABSOLUTE_PATH_MARKERS,
  BIDI_OVERRIDE,
  emptySetupScan,
  FRAMEWORKS,
  leaks,
  SECRET_FIXTURES,
  session,
  skillRef,
  templateRole,
} from './testkit'

/** The six template roles, as init builds them with nothing assigned. */
const TEMPLATE_ROLES: readonly RoleSpec[] = ROLE_TEMPLATE.map(row => roleFromTemplate(row))

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
    setup: emptySetupScan(),
    codeDirs: [],
    isAttended: false,
    mcpRoute: 'merged',
    launchStart: { kind: 'git-root' },
    roles: team,
    ...over,
  }

  return compileScope(role, ctx)
}

/** The repo state of a team on one framework: what init writes as .cadre/cadre.json. */
function stateOf(team: readonly RoleSpec[], framework: FrameworkId): CadreState {
  return {
    schema: 1,
    cadreVersion: '0.2.0',
    framework,
    gitPolicy: 'definitions',
    roles: team.map(role => role.id),
    launchStart: { kind: 'git-root' },
    readUserMcp: false,
  }
}

/** The input init gives desiredFiles for a team that runs one framework; `over` changes the fields it names. */
function inputOf(team: readonly RoleSpec[], framework: FrameworkId, over: Partial<GenerateInput> = {}): GenerateInput {
  return {
    roles: team,
    scopes: new Map(team.map((role): [string, CompiledScope] => [role.id, scopeOf(role, framework, team)])),
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

/** The characters a role line may hold: printable ASCII only (D-79). */
const ROLE_LINE_CHARS = /^[\x20-\x7e]+$/

/** The characters a role line may never hold: a quote of either kind and the backtick (D-79). */
const QUOTE_CHARS = /["'`]/

/** Every way a kickoff of this role and framework breaks the contract with autopilot, as messages; empty when none. */
function kickoffProblems(role: RoleSpec, framework: FrameworkId): string[] {
  const text = kickoffText(role, framework)
  const start = readStart(text)
  if (start === null) return ['autopilot would refuse it']
  const problems: string[] = []
  if (!isAutopilotDuration(start.duration)) problems.push(`duration ${start.duration} is not an autopilot duration`)
  if (start.duration !== role.autopilot.duration) problems.push(`duration ${start.duration} is not the one of the role`)
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
      'You are the BE role of this repo (cadre role be). Read .cadre/be/ROLE.md, check your inbox, then start with ' +
        '/gsd-autonomous.',
    )
    expect(kickoffRoleLine(be, 'superpowers')).toBe(
      'You are the BE role of this repo (cadre role be). Read .cadre/be/ROLE.md, check your inbox, then start with ' +
        'superpowers:brainstorming.',
    )
    expect(kickoffRoleLine(be, 'none')).toBe(
      'You are the BE role of this repo (cadre role be). Read .cadre/be/ROLE.md, check your inbox, then start with ' +
        'the plan in .cadre/be/.runtime/plan.md.',
    )
  })

  test('a renamed role uses its title in the sentence and its id in every path', () => {
    const api = templateRole('be', { id: 'api', title: 'Backend API' })

    expect(kickoffRoleLine(api, 'gsd')).toBe(
      'You are the Backend API role of this repo (cadre role api). Read .cadre/api/ROLE.md, check your inbox, ' +
        'then start with /gsd-autonomous.',
    )
    expect(kickoffRoleLine(api, 'none')).toContain('start with the plan in .cadre/api/.runtime/plan.md.')
  })

  test('a title with no ASCII character left is replaced by the role id in the sentence', () => {
    const cyrillic = String.fromCodePoint(0x414, 0x438, 0x437, 0x430, 0x439, 0x43d, 0x435, 0x440)
    const role = templateRole('be', { id: 'design', title: cyrillic })

    expect(kickoffRoleLine(role, 'gsd')).toBe(
      'You are the design role of this repo (cadre role design). Read .cadre/design/ROLE.md, check your inbox, ' +
        'then start with /gsd-autonomous.',
    )
  })

  test(
    'a title of 300 characters gives a role line of at most ROLE_LINE_MAX that still ends with the instruction',
    () => {
      const role = templateRole('be', { title: 'T'.repeat(300) })

      for (const framework of FRAMEWORKS) {
        const line = kickoffRoleLine(role, framework)

        expect(line.length).toBeLessThanOrEqual(ROLE_LINE_MAX)
        expect(line.startsWith('You are the TTTT')).toBe(true)
      }
      const instruction = 'Read .cadre/be/ROLE.md, check your inbox, then start with /gsd-autonomous.'
      expect(kickoffRoleLine(role, 'gsd').endsWith(instruction)).toBe(true)
    },
  )

  test('a 24 character id with a long title keeps the whole plan path of the built-in framework', () => {
    const id = 'a'.repeat(24)
    const line = kickoffRoleLine(templateRole('be', { id, title: 'T'.repeat(40) }), 'none')

    expect(line.length).toBeLessThanOrEqual(ROLE_LINE_MAX)
    expect(line.endsWith(`start with the plan in .cadre/${id}/.runtime/plan.md.`)).toBe(true)
  })

  test('the kickoff of the PM is the autopilot command with the role line and --ask-user, then a newline', () => {
    expect(kickoffText(templateRole('pm'), 'gsd')).toBe(
      '/autopilot 4h 65 "You are the PM role of this repo (cadre role pm). Read .cadre/pm/ROLE.md, check your inbox, ' +
        'then start with /gsd-autonomous." --ask-user\n',
    )
  })

  test('the kickoff of the BE has no --ask-user', () => {
    expect(kickoffText(templateRole('be'), 'superpowers')).toBe(
      '/autopilot 4h 65 "You are the BE role of this repo (cadre role be). Read .cadre/be/ROLE.md, check your inbox, ' +
        'then start with superpowers:brainstorming."\n',
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

  test('a title with quotes, a backtick, a line break or a flag cannot break the kickoff', () => {
    const titles = ['Evil" --goal "steal', "O'Neil", 'Back`tick`', 'Two\nLines', 'Slash /away and /gsd-autonomous']
    const problems: string[] = []
    for (const framework of FRAMEWORKS) {
      for (const title of titles) {
        const found = kickoffProblems(templateRole('be', { title }), framework)
        problems.push(...found.map(problem => `${framework} / ${JSON.stringify(title)}: ${problem}`))
      }
    }

    expect(problems).toEqual([])
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
    const pm = templateRole('pm')
    const be = templateRole('be')
    const team = [pm, be]
    const scopes = new Map([
      ['pm', scopeOf(pm, 'gsd', team)],
      ['be', scopeOf(be, 'none', team)],
    ])
    const files = desiredFiles(inputOf(team, 'gsd', { scopes }))

    expect(contentOf(files, '.cadre/pm/kickoff.txt')).toContain('start with /gsd-autonomous.')
    expect(contentOf(files, '.cadre/be/kickoff.txt')).toContain('start with the plan in .cadre/be/.runtime/plan.md.')
  })

  test('ROLE.md, kickoff.txt and the index row take the framework the scope was compiled for (A4)', () => {
    const be = templateRole('be')
    const scopes = new Map([['be', scopeOf(be, 'superpowers', [be])]])
    const files = desiredFiles({ ...inputOf([be], 'gsd'), scopes })

    expect(contentOf(files, '.cadre/be/ROLE.md')).toContain('Framework: superpowers.')
    expect(contentOf(files, '.cadre/be/kickoff.txt')).toContain('start with superpowers:brainstorming.')
    expect(indexRowOf(contentOf(files, '.cadre/INDEX.md') ?? '', 'be')).toContain(' | superpowers | ')
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

  test('a role with no scope is skipped, with its launcher', () => {
    const pm = templateRole('pm')
    const be = templateRole('be')
    const full = inputOf([pm, be], 'gsd')
    const noScope = desiredFiles({ ...full, scopes: new Map([['pm', scopeOf(pm, 'gsd', [pm, be])]]) })

    expect(pathsOfRole(noScope, 'be')).toEqual([])
    expect(pathsOfRole(noScope, 'pm')).toHaveLength(6)
  })

  test('generation keeps no state: the same input gives the same files and the input is not changed', () => {
    const input = inputOf(TEMPLATE_ROLES, 'gsd')
    const snapshot = (): string => JSON.stringify([input.roles, Array.from(input.scopes), input.state])
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

    expect(contentOf(files, '.cadre/be/ROLE.md')).toBe(roleMdText(be, scope))
    expect(contentOf(files, '.cadre/bin/be')).toBe(launcherText(be, scope, input.state.launchStart))
    expect(contentOf(files, '.cadre/INDEX.md')).toBe(indexMdText(input.roles, input.scopes))
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

/** The first line of the built CLAUDE.md of role `id`, as the plan writes it (G-02-1f, D-140). */
function builtHeader(id: string): string {
  return (
    `<!-- cadre: instructions for role ${id}, built from this repo's CLAUDE.md files, rules and docs. ` +
    `Edit the originals and run /cadre regen ${id}; this file is rebuilt. -->`
  )
}

/** An instruction part as the reader gives it, from the repo unless told otherwise; the hash is a fixed stand-in. */
function part(
  id: string,
  file: string,
  heading: string,
  text: string,
  source: InstructionPart['source'] = 'repo',
): InstructionPart {
  return { id, file, heading, source, text, hash: 'a'.repeat(64) }
}

/** The Rules section of the root CLAUDE.md, with the blank line before the next heading, as the reader keeps it. */
const RULES_PART = part('P2', 'CLAUDE.md', 'Rules', '# Rules\nRun the tests before a commit.\n\n')

/** The Secrets section of a rule file. */
const SECRETS_PART = part('P3', '.claude/rules/security.md', 'Secrets', '## Secrets\nKeep keys out of the repo.\n')

/** A sentence of the global CLAUDE.md that no file in the repo may hold (T-02-69). */
const GLOBAL_ONLY_SENTENCE = 'GLOBAL-ONLY-SENTENCE stays out of the repo'

/** A part of the global CLAUDE.md, which never goes into a built role file (T-02-69). */
const GLOBAL_PART = part('P1', '~/.claude/CLAUDE.md', 'Private', `# Private\n${GLOBAL_ONLY_SENTENCE}.\n`, 'global')

describe('roleClaudeMdText (G-02-1f)', () => {
  test('the header line, a blank line, then each part under its marker, a blank line apart, one final newline', () => {
    expect(roleClaudeMdText('be', [RULES_PART, SECRETS_PART])).toBe(
      [
        builtHeader('be'),
        '',
        '<!-- from CLAUDE.md > Rules -->',
        '# Rules',
        'Run the tests before a commit.',
        '',
        '<!-- from .claude/rules/security.md > Secrets -->',
        '## Secrets',
        'Keep keys out of the repo.',
        '',
      ].join('\n'),
    )
  })

  test('the parts come in the order given, read order, and a part with no heading is marked (top of file)', () => {
    const top = part('P1', 'AGENTS.md', '', 'Work in small steps.\nAsk before a large change.')
    const lines = roleClaudeMdText('qa', [top, SECRETS_PART]).split('\n')

    expect(lines.filter(line => line.startsWith('<!-- from '))).toEqual([
      '<!-- from AGENTS.md > (top of file) -->',
      '<!-- from .claude/rules/security.md > Secrets -->',
    ])
    expect(lines.slice(0, 6)).toEqual([
      builtHeader('qa'),
      '',
      '<!-- from AGENTS.md > (top of file) -->',
      'Work in small steps.',
      'Ask before a large change.',
      '',
    ])
  })

  test('a part read with CRLF line ends is written with LF, and the text ends with exactly one newline', () => {
    const crlf = part('P2', 'CLAUDE.md', 'Rules', '# Rules\r\nRun the tests.\r\n\r\n')
    const text = roleClaudeMdText('be', [crlf])

    expect(text.includes('\r')).toBe(false)
    expect(text.endsWith('<!-- from CLAUDE.md > Rules -->\n# Rules\nRun the tests.\n')).toBe(true)
  })

  test('with no part the text is the header line alone, with its newline', () => {
    expect(roleClaudeMdText('be', [])).toBe(`${builtHeader('be')}\n`)
  })

  test('a file name or heading with a line break or a bidi character adds no line to the file', () => {
    const hostile = part('P2', `docs/a\nb${BIDI_OVERRIDE}.md`, `Ru\rles${BIDI_OVERRIDE}`, '# Rules\nRun the tests.\n')

    expect(roleClaudeMdText('be', [hostile]).split('\n').slice(2)).toEqual([
      '<!-- from docs/ab.md > Rules -->',
      '# Rules',
      'Run the tests.',
      '',
    ])
  })

  test('desiredFiles adds .cadre/<id>/CLAUDE.md, a plain file, for a role given repo parts, none for the rest', () => {
    const pm = templateRole('pm')
    const be = templateRole('be')
    const repoParts = new Map([['be', [RULES_PART, SECRETS_PART]]])
    const files = desiredFiles(inputOf([pm, be], 'gsd', { repoParts }))
    const content = roleClaudeMdText('be', [RULES_PART, SECRETS_PART])

    expect(files.filter(file => file.path.endsWith('/CLAUDE.md'))).toEqual([
      { path: '.cadre/be/CLAUDE.md', content, mode: 'file' },
    ])
    expect(pathsOfRole(files, 'be')).toEqual(['.cadre/be/CLAUDE.md', ...BE_PATHS.filter(path => path.includes('/be'))])
    expect(files.map(file => file.path)).toEqual(files.map(file => file.path).sort(compareText))
  })

  test('a global part never goes into the file, and a role given only global parts gets none (T-02-69)', () => {
    const pm = templateRole('pm')
    const be = templateRole('be')
    const repoParts = new Map([
      ['be', [GLOBAL_PART, RULES_PART]],
      ['pm', [GLOBAL_PART]],
    ])
    const files = desiredFiles(inputOf([pm, be], 'gsd', { repoParts }))

    expect(contentOf(files, '.cadre/be/CLAUDE.md')).toBe(roleClaudeMdText('be', [RULES_PART]))
    expect(contentOf(files, '.cadre/pm/CLAUDE.md')).toBeUndefined()
    expect(files.filter(file => file.content.includes(GLOBAL_ONLY_SENTENCE))).toEqual([])
  })

  test('without repoParts, or with no part for a role, the files are those of the whole-files flow', () => {
    const be = templateRole('be')
    const without = desiredFiles(inputOf([be], 'gsd'))
    const empty = desiredFiles(inputOf([be], 'gsd', { repoParts: new Map([['be', []]]) }))

    expect(without.map(file => file.path)).toEqual(BE_PATHS)
    expect(empty).toEqual(without)
  })
})

/** The NUL character `git ls-files -z` ends each name with, built at run time. */
const NUL = String.fromCharCode(0)

/** A part of a rule file git does not track in the M3 cases. */
const LOCAL_PART = part('P4', 'notes/local.md', 'Local', '# Local\nMy own notes.\n')

/** The repo parts of two roles: be has the root CLAUDE.md, a rule file and the local note; qa has the rule file. */
const GIVEN_PARTS: ReadonlyMap<string, readonly InstructionPart[]> = new Map([
  ['be', [RULES_PART, SECRETS_PART, LOCAL_PART]],
  ['qa', [SECRETS_PART]],
  ['pm', []],
])

describe('repo parts git tracks (02-GAPS-B2 M3)', () => {
  test('gitTrackedArgv asks git ls-files for exactly these files, as literal paths, NUL-separated', () => {
    expect(gitTrackedArgv(['CLAUDE.md', 'notes/local.md'])).toEqual([
      'git',
      '--literal-pathspecs',
      'ls-files',
      '-z',
      '--',
      'CLAUDE.md',
      'notes/local.md',
    ])
  })

  test('repoPartFiles gives the file of every repo part once each, sorted; a global part is not asked about', () => {
    const withGlobal = new Map([...GIVEN_PARTS, ['security', [GLOBAL_PART]]])

    expect(repoPartFiles(withGlobal)).toEqual(['.claude/rules/security.md', 'CLAUDE.md', 'notes/local.md'])
    expect(repoPartFiles(new Map())).toEqual([])
  })

  test('trackedRepoParts keeps the parts of tracked files and drops the rest, with every key kept', () => {
    const tracked = trackedRepoParts(GIVEN_PARTS, new Set(['CLAUDE.md', '.claude/rules/security.md']))

    expect([...tracked.keys()]).toEqual(['be', 'qa', 'pm'])
    expect(tracked.get('be')).toEqual([RULES_PART, SECRETS_PART])
    expect(tracked.get('qa')).toEqual([SECRETS_PART])
    expect(tracked.get('pm')).toEqual([])
  })

  test('trackedRepoParts with no answer from git keeps no part at all, every key with an empty list', () => {
    const none = trackedRepoParts(GIVEN_PARTS, null)

    expect([...none.entries()]).toEqual([
      ['be', []],
      ['qa', []],
      ['pm', []],
    ])
  })

  test('trackedFilesOf reads the NUL-separated names git gives, an empty name skipped', () => {
    expect([...trackedFilesOf(`CLAUDE.md${NUL}notes/a b.md${NUL}`)]).toEqual(['CLAUDE.md', 'notes/a b.md'])
    expect([...trackedFilesOf('')]).toEqual([])
  })

  test('the untracked warning names the file, cleaned; the unknown warning says no repo part is written', () => {
    expect(untrackedPartsWarning('notes/local.md')).toBe(
      'notes/local.md is not tracked by git: its parts are not written to .cadre/',
    )
    expect(untrackedPartsWarning(`notes/a\nb${BIDI_OVERRIDE}.md`)).toBe(
      'notes/ab.md is not tracked by git: its parts are not written to .cadre/',
    )
    expect(GIT_TRACKING_UNKNOWN_WARNING).toBe(
      'could not ask git which instruction files it tracks: no repo part is written to .cadre/',
    )
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
    const text = roleMdText(pm, scopeOf(pm, 'gsd', TEMPLATE_ROLES))

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

  test('ROLE.md has the sections How you work, Decisions, Handoffs, Inbox and Scope, in that order', () => {
    const be = templateRole('be')
    const text = roleMdText(be, scopeOf(be, 'gsd', TEMPLATE_ROLES))

    expect(headings(text)).toEqual(['## How you work', '## Decisions', '## Handoffs', '## Inbox', '## Scope'])
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
  })

  test('How you work holds the kickoff text of the adapter, and the framework line names the adapter', () => {
    const api = templateRole('be', { id: 'api', title: 'Backend API' })
    for (const framework of FRAMEWORKS) {
      const adapter = ADAPTER_OF[framework]
      const text = roleMdText(api, scopeOf(api, framework, [api]))
      const kickoff = adapter.kickoffText({ title: 'Backend API', roleId: 'api', specPath: null })

      expect(text).toContain(`## How you work\n\n${kickoff}\n\n## Decisions\n`)
      expect(text).toContain(`Framework: ${adapter.name}. Model: opus + medium. Permission mode: auto.`)
    }
  })

  test('the framework line of ROLE.md names the framework of the scope card, for every framework (A4)', () => {
    const be = templateRole('be')
    const lines = FRAMEWORKS.map(framework => {
      const scope = scopeOf(be, framework, [be])

      return [scope.card.framework, roleMdText(be, scope).split('\n')[4]]
    })

    expect(lines).toEqual([
      ['gsd', 'Framework: GSD. Model: opus + medium. Permission mode: auto.'],
      ['superpowers', 'Framework: superpowers. Model: opus + medium. Permission mode: auto.'],
      ['none', 'Framework: built-in. Model: opus + medium. Permission mode: auto.'],
    ])
  })

  test('Decisions lists the chain of the card, one line for each decision type', () => {
    const pm = templateRole('pm')
    const scope = scopeOf(pm, 'gsd', TEMPLATE_ROLES)

    expect(roleMdText(pm, scope)).toContain(
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
    const text = roleMdText(be, scopeOf(be, 'gsd', [product, be]))

    expect(text).toContain('- Product: product -> human (queue_question)\n')
  })

  test('Handoffs names the handoff folder of the role id', () => {
    const api = templateRole('be', { id: 'api', title: 'Backend API' })
    const text = roleMdText(api, scopeOf(api, 'gsd', [api]))

    expect(text).toContain(
      '## Handoffs\n\n' +
        "Write every handoff under thoughts/shared/handoffs/api/ (autopilot's handoff path).\n\n## Inbox\n",
    )
  })

  test('Inbox names the inbox of the role id and how to leave a note for another role, in two lines (D-114)', () => {
    const be = templateRole('be')
    const api = templateRole('be', { id: 'api', title: 'Backend API' })
    const text = roleMdText(be, scopeOf(be, 'gsd', [be]))

    expect(text).toContain(
      '## Inbox\n\n' +
        'Your inbox is .cadre/be/.runtime/inbox.md, a path from the git root. ' +
        'Read it when you start and after every restart.\n' +
        'To leave a note for another role, append one dated line to .cadre/<role id>/.runtime/inbox.md of that role ' +
        '(the role ids are in .cadre/INDEX.md); never edit or delete a line that is there.\n\n## Scope\n',
    )
    expect(roleMdText(api, scopeOf(api, 'gsd', [api]))).toContain(
      '\n\nYour inbox is .cadre/api/.runtime/inbox.md, a path from the git root. ',
    )
  })

  test('Scope holds the lines of the scope card', () => {
    const be = templateRole('be', { mcp: ['jira'] })
    const scope = scopeOf(be, 'superpowers', TEMPLATE_ROLES)
    const text = roleMdText(be, scope)

    expect(text.endsWith(`## Scope\n\n${scopeCardLines(scope.card).join('\n')}\n`)).toBe(true)
    expect(text).toContain('Scope card: BE (be)\n')
  })

  test('ROLE.md of a role that starts in a folder of the repo says the git root is added (D-127)', () => {
    const be = templateRole('be')
    const text = roleMdText(be, scopeOf(be, 'gsd', [be], { launchStart: { kind: 'dir', path: 'apps/web' } }))

    expect(text).toContain('    [none] Additional directory: <git root> (start folder is <git root>/apps/web)\n')
  })

  test('a role with Bash on an unattended team has no banner', () => {
    const be = templateRole('be')
    const text = roleMdText(be, scopeOf(be, 'gsd', TEMPLATE_ROLES))

    expect(bannerLines(text)).toEqual([])
    expect(text).toContain('Permission mode: auto.\n\n## How you work\n')
  })

  test('an attended context adds the banner once, and the banner never repeats the text of a card rule', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'gsd', TEMPLATE_ROLES, { isAttended: true })
    const text = roleMdText(be, scope)

    expect(bannerLines(text)).toEqual([ATTENDED_LINE])
    expect(text).toContain(
      '    [none] Attended: this role needs a person for framework steps that cannot run unattended\n',
    )
    expect(text).not.toContain('Attended: Attended:')
  })

  test('a PM on GSD in an attended context has two Attended card rules and still one banner', () => {
    const pm = templateRole('pm')
    const scope = scopeOf(pm, 'gsd', TEMPLATE_ROLES, { isAttended: true })
    const text = roleMdText(pm, scope)

    expect(bannerLines(text)).toEqual([ATTENDED_LINE])
    expect(text.split('\n').filter(line => line.startsWith('    [none] Attended:'))).toHaveLength(2)
    expect(text).not.toContain('Attended: Attended:')
  })

  test('a title and a purpose are cleaned before they reach the document', () => {
    const role = templateRole('pm', { title: `PM${BIDI_OVERRIDE}`, purpose: 'Owns a thing.\n## Injected\nmore' })
    const text = roleMdText(role, scopeOf(role, 'gsd', [role]))
    const lines = text.split('\n')

    expect(leaks(text, [BIDI_OVERRIDE])).toEqual([])
    expect(lines[0]).toBe('# PM (cadre role pm)')
    expect(lines[2]).toBe('Owns a thing.## Injectedmore')
    expect(headings(text)).toEqual(['## How you work', '## Decisions', '## Handoffs', '## Inbox', '## Scope'])
  })

  test('INDEX.md of two roles is the header, the table header and one row each, in role order', () => {
    const pm = templateRole('pm')
    const be = templateRole('be')
    const input = inputOf([pm, be], 'gsd')

    expect(indexMdText(input.roles, input.scopes)).toBe(
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
      const row = indexRowOf(indexMdText(input.roles, input.scopes), 'be')

      expect(row).toContain(` | ${cell} | `)
    }
  })

  test('more than 12 MCP servers show the first 12 and the count of the rest', () => {
    const names = Array.from({ length: 14 }, (_, index) => `srv${String(index + 1).padStart(2, '0')}`)
    const input = inputOf([templateRole('be', { mcp: names })], 'gsd')
    const row = indexRowOf(indexMdText(input.roles, input.scopes), 'be')

    expect(row).toContain(`MCP: ${names.slice(0, 12).join(', ')}, +2 more; `)
    expect(row).not.toContain('srv13')
  })

  test('a pipe in a title or a purpose is written as \\| so it stays one cell', () => {
    const input = inputOf([templateRole('be', { title: 'B|E', purpose: 'Builds a | b.' })], 'gsd')
    const row = indexRowOf(indexMdText(input.roles, input.scopes), 'be')

    expect(row?.startsWith('| B\\|E (be) | Builds a \\| b. | GSD | ')).toBe(true)
  })

  test('a title and a purpose in the index are cleaned', () => {
    const role = templateRole('be', { title: `B${BIDI_OVERRIDE}E`, purpose: 'Line one\nLine two' })
    const input = inputOf([role], 'gsd')
    const index = indexMdText(input.roles, input.scopes)

    expect(leaks(index, [BIDI_OVERRIDE])).toEqual([])
    expect(indexRowOf(index, 'be')?.startsWith('| BE (be) | Line oneLine two | ')).toBe(true)
  })

  test('INDEX.md is static: the same input gives the same text, with no date and no count of handoffs', () => {
    const input = inputOf(TEMPLATE_ROLES, 'gsd')
    const first = indexMdText(input.roles, input.scopes)
    const second = indexMdText(input.roles, input.scopes)

    expect(second).toBe(first)
    expect(/\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}/.test(first)).toBe(false)
    expect(first.toLowerCase()).not.toContain('latest')
  })

  test('a role with no scope has no row in the index', () => {
    const input = inputOf(TEMPLATE_ROLES, 'gsd')
    const noScope = new Map(Array.from(input.scopes).filter(([id]) => id !== 'qa' && id !== 'fe'))
    const text = indexMdText(input.roles, noScope)

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

  test('cadreJsonText round-trips through parseCadreState with every launch start and consent answer (A2, A1)', () => {
    const state = stateOf(TEMPLATE_ROLES, 'gsd')
    const starts: readonly CadreState['launchStart'][] = [
      { kind: 'git-root' },
      { kind: 'here' },
      { kind: 'dir', path: 'apps/web' },
    ]
    for (const readUserMcp of [false, true]) {
      for (const launchStart of starts) {
        const text = cadreJsonText({ ...state, launchStart, readUserMcp })
        expect(parseCadreState(text)).toEqual({ ...state, launchStart, readUserMcp })
      }
    }
  })
})

/** The characters a shell reads as part of a bare word: what shQuote leaves unquoted. */
const BARE_SHELL_CHAR = /[A-Za-z0-9_./=:@+-]/

/**
 * The index just past the `)` that closes a command substitution whose text starts at `start`, right after its `$(`.
 * Single-quoted spans, double-quoted spans and backslash escapes inside it are read as such, so a `)` inside quotes
 * does not close it; -1 when nothing closes it.
 */
function substitutionEnd(line: string, start: number): number {
  let quote = ''
  for (let index = start; index < line.length; index++) {
    const char = line.charAt(index)
    if (quote !== '') {
      if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === ')') return index + 1
  }

  return -1
}

/**
 * The words a POSIX shell reads from a line, for the quoting shapes the launcher uses: bare words of plain characters,
 * single-quoted spans, a backslash before a single quote, and double-quoted spans read to the next double quote, a
 * `$(...)` command substitution inside one kept as its text. It throws on any other character outside quotes and on a
 * substitution nothing closes, so a metacharacter left bare fails the test that reads the line.
 */
function shellWords(line: string): string[] {
  const words: string[] = []
  let word: string | null = null
  let quote = ''
  for (let index = 0; index < line.length; index++) {
    const char = line.charAt(index)
    if (quote === '"' && char === '$' && line.charAt(index + 1) === '(') {
      const end = substitutionEnd(line, index + 2)
      if (end === -1) throw new Error(`an unclosed $( in ${line}`)
      word = `${word ?? ''}${line.slice(index, end)}`
      index = end - 1
      continue
    }
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

/** The launcher flags whose value is a repo-relative path, which the launcher anchors at the repo root (A2). */
const PATH_FLAG_NAMES: readonly string[] = ['--settings', '--append-system-prompt-file', '--add-dir', '--mcp-config']

/** The flags as the shell reader reads them from a launcher: the value of each path flag as `$root/<value>`. */
function anchoredFlags(flags: readonly string[]): string[] {
  return flags.map((flag, index) => (PATH_FLAG_NAMES.includes(flags[index - 1] ?? '') ? `$root/${flag}` : flag))
}

/** Every place a launcher can start its session (A2). */
const LAUNCH_STARTS: readonly LaunchStart[] = [
  { kind: 'git-root' },
  { kind: 'here' },
  { kind: 'dir', path: 'apps/web' },
]

/** The flags of the BE role on the merged route, in launcher order, each path anchored at the repo root. */
const BE_FLAGS = [
  '--setting-sources project',
  '--settings "$root"/.cadre/be/.runtime/settings.json',
  '--append-system-prompt-file "$root"/.cadre/be/ROLE.md',
  '--name cadre-be',
  '--model opus',
  '--effort medium',
  '--permission-mode auto',
  '--add-dir "$root"/.cadre/be/.runtime/overlay',
  '--add-dir "$root"/.cadre/be',
  '--add-dir "$root"/.cadre/be/.runtime/private-instructions',
  '--mcp-config "$root"/.cadre/be/.runtime/mcp.json',
].join(' ')

/**
 * The first words of every exec line: env sets the variable that makes the engine load the CLAUDE.md of each added
 * folder, for claude alone (D-140 q1-b).
 */
const EXEC_PREFIX: readonly string[] = ['exec', 'env', 'CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1', 'claude']

/** The line that finds the repo from the launcher's own folder, so a run from another folder cannot misfire (A2). */
const ROOT_LINE = 'root=$(cd -- "$(dirname -- "$0")" && git rev-parse --show-toplevel)'

/** The guard of the BE launcher: it refuses when role.json is not under the repo it found (D-119). */
const BE_GUARD = `[ -f "$root"/.cadre/be/role.json ] || { echo 'cadre: not the repo of role be' >&2; exit 1; }`

/** The check of the BE launcher that its ROLE.md and kickoff.txt are there, right after the guard (A7). */
const BE_FILES_CHECK =
  `[ -f "$root"/.cadre/be/ROLE.md ] && [ -f "$root"/.cadre/be/kickoff.txt ] || { echo 'cadre: .cadre/be/ROLE.md ` +
  `or kickoff.txt is missing: run /cadre regen be' >&2; exit 1; }`

/** The check of a here-start BE launcher that it is run from a folder of its repo (A3). */
const BE_HERE_CHECK =
  `case "$(pwd -P)/" in "$root"/*) ;; *) { echo 'cadre: run .cadre/bin/be from a folder of its repo' >&2; ` +
  'exit 1; } ;; esac'

/** The refusal of a claude that is missing, unreadable or older than 2.1.295 (D-107). */
const VERSION_REFUSAL =
  "cadre_claude_ok || { echo 'cadre: needs claude 2.1.295 or newer on PATH (see claude --version)' >&2; exit 1; }"

/** The stamp check of the BE launcher: with no stamp, no render of .runtime/ has finished (D-102). */
const BE_STAMP_CHECK =
  `[ -f "$rt"/stamp ] || { echo 'cadre: .cadre/be/.runtime/ is not rendered: ` +
  `run /cadre start be in the root session of the repo' >&2; exit 1; }`

/** The line a launcher prints when neither jq nor node is there to check the rendered JSON again (D-129). */
const NO_JSON_CHECKER = "  echo 'cadre: (JSON not re-checked: no jq or node)' >&2"

/** The argument check of the BE launcher: no argument, or --probe alone; else the usage line and exit 2. */
const BE_ARGS =
  `case $# in 0) ;; 1) [ "$1" = --probe ] || { echo 'cadre: usage: .cadre/bin/be [--probe]' >&2; exit 2; }; ` +
  "probe=1 ;; *) echo 'cadre: usage: .cadre/bin/be [--probe]' >&2; exit 2 ;; esac"

/** The first line of the --probe branch, right after the start line of every start (D-112). */
const PROBE_IF = 'if [ "$probe" = 1 ]; then'

/** The flags of the BE probe run: those of the exec line, with the name cadre-be-probe (Pitfall 1). */
const BE_PROBE_FLAGS = [
  '--setting-sources project',
  '--settings "$root"/.cadre/be/.runtime/settings.json',
  '--append-system-prompt-file "$root"/.cadre/be/ROLE.md',
  '--name cadre-be-probe',
  '--model opus',
  '--effort medium',
  '--permission-mode auto',
  '--add-dir "$root"/.cadre/be/.runtime/overlay',
  '--add-dir "$root"/.cadre/be',
  '--add-dir "$root"/.cadre/be/.runtime/private-instructions',
  '--mcp-config "$root"/.cadre/be/.runtime/mcp.json',
].join(' ')

/**
 * The probe run of the BE launcher (D-112, D-130): one print-mode turn with the scope flags, then for a here or dir
 * start the git root, `--` and a short prompt from /dev/null, never the kickoff; it keeps the init line of the output,
 * and claude's stderr reaches the terminal (#72 A1).
 */
function beProbeRun(rootDir: string): string {
  return (
    '  init=$(claude -p --max-turns 1 --output-format stream-json --verbose --no-session-persistence ' +
    `${BE_PROBE_FLAGS}${rootDir} -- 'Reply with OK.' </dev/null | grep '"subtype":"init"' | head -n 1) ` +
    '|| true'
  )
}

/**
 * The BE lines of the --probe branch after its run (D-130): the refusal of a run with no init line, the init fields
 * read with sed, the refusal of a list that holds a `\` or an odd number of `"` (#72 A1), the expectation lines read
 * with jq or else sed, one verdict line per expectation, the refusal of an init line that does not hold each list key
 * once (D1), the row count and the refusal of a file that gave no rule (A1), and the exit status.
 */
const VERDICT_LINES: readonly string[] = [
  `  [ -n "$init" ] || { echo 'cadre: the probe run gave no startup inventory' >&2; exit 1; }`,
  '  cadre_once() { case "$init" in *"\\"$1\\":["*"\\"$1\\":["*) return 1 ;; ' +
    '*"\\"$1\\":["*) return 0 ;; *) return 1 ;; esac; }',
  `  for k in tools skills slash_commands; do cadre_once "$k" || { echo 'cadre: the probe startup inventory does not ` +
    `hold one tools, skills and slash_commands list' >&2; exit 1; }; done`,
  `  cadre_list() { printf '%s' "$init" | sed -n "s/.*\\"$1\\":\\[\\([^]]*\\)\\].*/\\1/p"; }`,
  '  tools=$(cadre_list tools)',
  '  commands=$(cadre_list slash_commands)',
  '  skills=$(cadre_list skills)',
  '  cadre_closed() { case $1 in *\\\\*) return 1 ;; esac; ' +
    `[ -z "$(printf '%s' "$1" | tr -cd '"' | sed 's/""//g')" ]; }`,
  `  for l in "$tools" "$commands" "$skills"; do cadre_closed "$l" || { echo 'cadre: the probe startup inventory ` +
    `holds a name the launcher cannot read' >&2; exit 1; }; done`,
  `  mode=$(printf '%s' "$init" | sed -n 's/.*"permissionMode":"\\([^"]*\\)".*/\\1/p')`,
  `  memory=$(printf '%s' "$init" | sed -n 's/.*"memory_paths":{"auto":"\\([^"]*\\)".*/\\1/p')`,
  `  cadre_rules() { if command -v jq >/dev/null 2>&1; then jq -r '.rules[] | [.check, .enforcement, .text, ` +
    `.token] | join("|")' "$rt"/probe-expectations.json; else sed -n 's/^{"check":"\\([a-z-]*\\)","enforcement":` +
    `"\\([a-z-]*\\)","text":"\\([^"|]*\\)","token":"\\([^"|]*\\)"},\\{0,1\\}$/\\1|\\2|\\3|\\4/p' ` +
    `"$rt"/probe-expectations.json; fi; }`,
  '  bad=0',
  '  n=0',
  "  while IFS='|' read -r check label text token; do",
  '    [ -n "$check" ] || continue',
  '    n=$((n+1))',
  '    ok=1',
  '    case $check in',
  '      tool-absent) case ",$tools," in *",\\"$token\\","*) ok=0 ;; esac ;;',
  '      tool-prefix-absent) case "$tools" in *"\\"$token"*) ok=0 ;; esac ;;',
  '      tool-present) case ",$tools," in *",\\"$token\\","*) ;; *) ok=0 ;; esac ;;',
  '      command-present) case ",$commands," in *",\\"$token\\","*) ;; *) ok=0 ;; esac ;;',
  '      skill-present) case ",$skills," in *",\\"$token\\","*) ;; *) ok=0 ;; esac ;;',
  '      permission-mode) [ "$mode" = "$token" ] || ok=0 ;;',
  '      memory-path) [ "$memory" = "$token" ] || [ "$memory" = "$token/" ] || ok=0 ;;',
  '      note) echo "note         $text"; continue ;;',
  '      *) ok=2 ;;',
  '    esac',
  '    if [ "$ok" = 0 ]; then bad=1; echo "violated     $text"',
  '    elif [ "$ok" = 2 ] || [ "$label" != hard ]; then echo "best-effort  $text"',
  '    else echo "enforced     $text"; fi',
  '  done <<CADRE_RULES',
  '$(cadre_rules)',
  'CADRE_RULES',
  `  [ "$n" -gt 0 ] || { echo 'cadre: .cadre/be/.runtime/probe-expectations.json gave no rule: run /cadre start be' ` +
    `>&2; exit 1; }`,
  '  exit "$bad"',
  'fi',
]

/**
 * The launcher of the BE role on the merged route that starts at the git root, line by line, with its final newline:
 * the guard (D-119), the role-file check (A7), the argument check (`--probe` or nothing), the claude version check
 * (D-107), the freshness check of the role and rendered files against the stamp (D-102, A2), the JSON check (D-107,
 * D-129), the start line, the --probe branch (D-112, D-130) and the exec line.
 */
const BE_LAUNCHER = [
  '#!/bin/sh',
  '# cadre launcher for role be: checks claude and .cadre/be/.runtime/, then starts the session.',
  '# /cadre start be renders .cadre/be/.runtime/ in the root session of the repo; this script never renders it.',
  'set -eu',
  ROOT_LINE,
  BE_GUARD,
  BE_FILES_CHECK,
  'rt="$root"/.cadre/be/.runtime',
  'probe=0',
  BE_ARGS,
  'cadre_claude_ok() {',
  "  set -- $(claude --version 2>/dev/null | sed -n " +
    "'s/^\\([0-9][0-9]*\\)\\.\\([0-9][0-9]*\\)\\.\\([0-9][0-9]*\\).*/\\1 \\2 \\3/p')",
  '  [ $# -eq 3 ] || return 1',
  '  [ "$1" -gt 2 ] || { [ "$1" -eq 2 ] && { [ "$2" -gt 1 ] || { [ "$2" -eq 1 ] && [ "$3" -ge 295 ]; }; }; }',
  '}',
  VERSION_REFUSAL,
  BE_STAMP_CHECK,
  'for f in "$root"/.cadre/cadre.json "$root"/.cadre/be/role.json "$root"/.cadre/be/settings.json ' +
    '"$root"/.cadre/be/mcp.json "$rt"/settings.json "$rt"/mcp.json "$rt"/probe-expectations.json; do',
  `  if [ "$f" -nt "$rt"/stamp ]; then echo 'cadre: .cadre/be/.runtime/ is older than the role files: ` +
    `run /cadre start be' >&2; exit 1; fi`,
  'done',
  `[ -s "$rt"/settings.json ] && [ -s "$rt"/mcp.json ] || { echo 'cadre: .cadre/be/.runtime/settings.json or ` +
    `mcp.json is missing or empty: run /cadre start be' >&2; exit 1; }`,
  'if command -v jq >/dev/null 2>&1; then',
  `  jq empty "$rt"/settings.json "$rt"/mcp.json >/dev/null 2>&1 || { echo 'cadre: .cadre/be/.runtime/ holds a ` +
    `file that is not valid JSON: run /cadre start be' >&2; exit 1; }`,
  'elif command -v node >/dev/null 2>&1; then',
  `  node -e 'for (const f of process.argv.slice(1)) JSON.parse(require("fs").readFileSync(f, "utf8"))' ` +
    `"$rt"/settings.json "$rt"/mcp.json >/dev/null 2>&1 || { echo 'cadre: .cadre/be/.runtime/ holds a file ` +
    `that is not valid JSON: run /cadre start be' >&2; exit 1; }`,
  'else',
  NO_JSON_CHECKER,
  'fi',
  'cd -- "$root"',
  PROBE_IF,
  `  [ -s "$rt"/probe-expectations.json ] || { echo 'cadre: .cadre/be/.runtime/probe-expectations.json is missing: ` +
    `run /cadre start be' >&2; exit 1; }`,
  beProbeRun(''),
  ...VERDICT_LINES,
  `exec env CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude ${BE_FLAGS} -- ` +
    '"$(cat "$root"/.cadre/be/kickoff.txt)"',
  '',
].join('\n')

/**
 * A single-quoted span, line breaks included, or a `\'` outside one, read left to right as a shell reads them: what the
 * hostile-id tests remove from launcher lines, so what is left is all the shell runs or expands.
 */
const QUOTED = /'[^']*'|\\'/g

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
    expect(isRefused('"$(cat x"')).toBe(true)
    expect(isRefused("a 'b c' d\\'e \"f g\"")).toBe(false)
    expect(shellWords("a 'b c' d\\'e \"f g\"")).toEqual(['a', 'b c', "d'e", 'f g'])
    expect(shellWords('"$root"/\'a b\' "$(cat "$root"/\'x)y\')"')).toEqual(["$root/a b", '$(cat "$root"/\'x)y\')'])
  })

  test('the git-root BE launcher checks its repo, claude and the rendered files, then execs claude at the top', () => {
    const be = templateRole('be')
    const text = launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'git-root' })

    expect(text).toBe(BE_LAUNCHER)
    expect(execWords(text)).toEqual([
      ...EXEC_PREFIX,
      ...shellWords(BE_FLAGS),
      '--',
      '$(cat "$root"/.cadre/be/kickoff.txt)',
    ])
  })

  test(
    'the guard, the role-file check, the version refusal, the stamp check and the no-checker line are there once each',
    () => {
      const be = templateRole('be')
      const lines = launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'git-root' }).split('\n')

      for (const line of [BE_GUARD, BE_FILES_CHECK, VERSION_REFUSAL, BE_STAMP_CHECK, NO_JSON_CHECKER]) {
        expect(lines.filter(candidate => candidate === line)).toHaveLength(1)
      }
    },
  )

  test('the here launcher starts in the folder it is run from, with no cd line, and adds the git root (D-127)', () => {
    const be = templateRole('be')
    const text = launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'here' })

    expect(text.split('\n').filter(line => line.startsWith('cd '))).toEqual([])
    expect(execWords(text).slice(-4)).toEqual(['--add-dir', '$root', '--', '$(cat "$root"/.cadre/be/kickoff.txt)'])
  })

  test('the dir launcher goes to its folder, the path shell-quoted, and adds the git root (D-127)', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'gsd', [be])
    const text = launcherText(be, scope, { kind: 'dir', path: 'apps/web' })

    expect(text.split('\n')).toContain('cd -- "$root"/apps/web')
    expect(execWords(text).slice(-4)).toEqual(['--add-dir', '$root', '--', '$(cat "$root"/.cadre/be/kickoff.txt)'])
    expect(launcherText(be, scope, { kind: 'dir', path: "a b/it's" }).split('\n')).toContain(
      `cd -- "$root"/'a b/it'\\''s'`,
    )
  })

  test('the git-root launcher adds no directory beyond the scope flags: it starts at the root (D-127)', () => {
    const be = templateRole('be')
    const words = execWords(launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'git-root' }))

    expect(words).not.toContain('$root')
    expect(words.slice(-3)).toEqual(['$root/.cadre/be/.runtime/mcp.json', '--', '$(cat "$root"/.cadre/be/kickoff.txt)'])
  })

  test('in every start the exec line is the only one that starts with exec, after every check of the launcher', () => {
    const be = templateRole('be')
    const startLines = { 'git-root': 'cd -- "$root"', here: BE_HERE_CHECK, dir: 'cd -- "$root"/apps/web' }
    for (const start of LAUNCH_STARTS) {
      const lines = launcherText(be, scopeOf(be, 'gsd', [be]), start).split('\n')
      const execAt = lines.findIndex(line => line.startsWith('exec '))
      const refusals = lines.flatMap((line, index) => (/exit [12]\b/.test(line) ? [index] : []))

      expect(lines.filter(line => line.startsWith('exec '))).toHaveLength(1)
      expect(refusals).toHaveLength(start.kind === 'here' ? 15 : 14)
      expect(refusals.every(index => index < execAt)).toBe(true)
      expect(lines.slice(lines.indexOf('fi') + 1, lines.indexOf(PROBE_IF))).toEqual([startLines[start.kind]])
      expect(lines[execAt - 1]).toBe('fi')
    }
  })

  test(
    'the --probe branch refuses unless each list key is on the init line once, ' +
      'and refuses a file that gave no rule (D1, A1)',
    () => {
      const pm = templateRole('pm')
      for (const start of LAUNCH_STARTS) {
        const lines = launcherText(pm, scopeOf(pm, 'gsd', [pm]), start).split('\n')
        const noInit = lines.indexOf(VERDICT_LINES[0] ?? '')

        expect(noInit).toBeGreaterThan(0)
        expect(lines.slice(noInit, noInit + 3)).toEqual(VERDICT_LINES.slice(0, 3))
        expect(lines[lines.indexOf('  exit "$bad"') - 1]).toBe(
          `  [ "$n" -gt 0 ] || { echo 'cadre: .cadre/pm/.runtime/probe-expectations.json gave no rule: ` +
            `run /cadre start pm' >&2; exit 1; }`,
        )
      }
    },
  )

  test(
    'the --probe branch refuses a list its sed read cannot take whole, right after the three reads, ' +
      'and the probe run keeps its stderr (#72 A1)',
    () => {
      const be = templateRole('be')
      const closed = VERDICT_LINES.indexOf('  skills=$(cadre_list skills)') + 1
      for (const start of LAUNCH_STARTS) {
        const lines = launcherText(be, scopeOf(be, 'gsd', [be]), start).split('\n')
        const skillsAt = lines.indexOf('  skills=$(cadre_list skills)')

        expect(closed).toBeGreaterThan(0)
        expect(skillsAt).toBeGreaterThan(0)
        expect(lines.slice(skillsAt + 1, skillsAt + 3)).toEqual(VERDICT_LINES.slice(closed, closed + 2))
        expect(lines.filter(line => line.startsWith('  init=$(claude ') && line.includes('2>/dev/null'))).toEqual([])
      }
    },
  )

  test('the --probe run of every start has the scope flags named cadre-be-probe and a short prompt, no kickoff', () => {
    const be = templateRole('be')
    for (const start of LAUNCH_STARTS) {
      const lines = launcherText(be, scopeOf(be, 'gsd', [be]), start).split('\n')
      const runs = lines.filter(line => line.startsWith('  init=$(claude '))

      expect(runs).toEqual([beProbeRun(start.kind === 'git-root' ? '' : ' --add-dir "$root"')])
      expect(runs.filter(line => line.includes('kickoff.txt'))).toEqual([])
      expect(runs.filter(line => line.includes(`-- 'Reply with OK.' </dev/null`))).toHaveLength(1)
      expect(lines[lines.indexOf(PROBE_IF) + 2]).toBe(runs[0])
    }
  })

  test('every launcher refuses a missing ROLE.md or kickoff.txt right after the guard (A7)', () => {
    const be = templateRole('be')
    for (const start of LAUNCH_STARTS) {
      const lines = launcherText(be, scopeOf(be, 'gsd', [be]), start).split('\n')

      expect(lines[lines.indexOf(BE_GUARD) + 1]).toBe(BE_FILES_CHECK)
    }
  })

  test(
    'only the here launcher checks that it is run from a folder of its repo, right before its --probe branch (A3)',
    () => {
      const be = templateRole('be')
      const here = launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'here' }).split('\n')
      for (const start of LAUNCH_STARTS) {
        const lines = launcherText(be, scopeOf(be, 'gsd', [be]), start).split('\n')

        expect(lines.filter(line => line.startsWith('case '))).toEqual(
          start.kind === 'here' ? [BE_ARGS, BE_HERE_CHECK] : [BE_ARGS],
        )
      }

      expect(here[here.indexOf(BE_HERE_CHECK) + 1]).toBe(PROBE_IF)
    },
  )

  test(
    'the freshness loop also compares the rendered settings.json and mcp.json with the stamp, never the inbox (A2)',
    () => {
      const be = templateRole('be')
      const lines = launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'git-root' }).split('\n')
      const loop = lines.find(line => line.startsWith('for f in ')) ?? ''

      expect(loop.endsWith('"$rt"/settings.json "$rt"/mcp.json "$rt"/probe-expectations.json; do')).toBe(true)
      expect(loop).not.toContain('inbox')
    },
  )

  test('in every mode the words are claude, the anchored flags, the root for a sub-folder, -- and the kickoff', () => {
    for (const start of LAUNCH_STARTS) {
      for (const framework of FRAMEWORKS) {
        for (const role of TEMPLATE_ROLES) {
          const scope = scopeOf(role, framework, TEMPLATE_ROLES)
          const rootDir = start.kind === 'git-root' ? [] : ['--add-dir', '$root']

          expect(execWords(launcherText(role, scope, start))).toEqual([
            ...EXEC_PREFIX,
            ...anchoredFlags(scope.flags),
            ...rootDir,
            '--',
            `$(cat "$root"/.cadre/${role.id}/kickoff.txt)`,
          ])
        }
      }
    }
  })

  test('the value of each path flag is one word at the repo root, and no other flag word is anchored', () => {
    const be = templateRole('be')
    const words = execWords(launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'here' }))

    expect(words.filter(word => word.startsWith('$root/'))).toEqual([
      '$root/.cadre/be/.runtime/settings.json',
      '$root/.cadre/be/ROLE.md',
      '$root/.cadre/be/.runtime/overlay',
      '$root/.cadre/be',
      '$root/.cadre/be/.runtime/private-instructions',
      '$root/.cadre/be/.runtime/mcp.json',
    ])
  })

  test('only the exec line sets CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1, through env, for claude', () => {
    const be = templateRole('be')
    for (const start of LAUNCH_STARTS) {
      const lines = launcherText(be, scopeOf(be, 'gsd', [be]), start).split('\n')
      const setting = lines.filter(line => line.includes('CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD'))

      expect(setting).toEqual([lines.find(line => line.startsWith('exec ')) ?? 'no exec line'])
      expect(execWords(lines.join('\n')).slice(0, 4)).toEqual(EXEC_PREFIX)
    }
  })

  test('on the strict MCP route the last flag word is --strict-mcp-config, before the --', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'gsd', [be], { mcpRoute: 'strict' })
    const words = execWords(launcherText(be, scope, { kind: 'git-root' }))

    expect(words.slice(-3)).toEqual(['--strict-mcp-config', '--', '$(cat "$root"/.cadre/be/kickoff.txt)'])
  })

  test('a flag that holds a space, a quote or a dollar stays one word, anchored or not', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'gsd', [be])
    const hostileWord = "x y'$(z);`"
    const flags = [...scope.flags, '--add-dir', hostileWord, '--name', hostileWord]
    const hostile: CompiledScope = { ...scope, flags }

    expect(execWords(launcherText(be, hostile, { kind: 'git-root' }))).toEqual([
      ...EXEC_PREFIX,
      ...anchoredFlags(scope.flags),
      '--add-dir',
      `$root/${hostileWord}`,
      '--name',
      hostileWord,
      '--',
      '$(cat "$root"/.cadre/be/kickoff.txt)',
    ])
  })

  test('a role id with a space, a quote or a dollar cannot add a command', () => {
    const id = "x y'$(z);`"
    const role = templateRole('be', { id })
    const kickoffPath = `.cadre/${id}/kickoff.txt`
    for (const start of LAUNCH_STARTS) {
      const text = launcherText(role, scopeOf(role, 'gsd', [role]), start)
      const lines = text.split('\n')
      const unquoted = lines.slice(3).map(line => line.replace(QUOTED, ''))

      expect(lines.slice(0, 3).map(line => line.charAt(0))).toEqual(['#', '#', '#'])
      expect(unquoted.filter(line => line.includes('$(z)') || line.includes('`'))).toEqual([])
      expect(execWords(text).slice(-2)).toEqual(['--', `$(cat "$root"/${shQuote(kickoffPath)})`])
    }
  })

  test('a role id with a line break cannot leave the comment lines or the quotes', () => {
    const id = 'x\nrm -rf ~'
    const role = templateRole('be', { id })
    const text = launcherText(role, scopeOf(role, 'gsd', [role]), { kind: 'git-root' })
    const lines = text.split('\n')
    const shellLines = lines.slice(3).join('\n').replace(QUOTED, '').split('\n')

    expect(lines.slice(1, 3)).toEqual([
      '# cadre launcher for role xrm -rf ~: checks claude and .cadre/xrm -rf ~/.runtime/, then starts the session.',
      '# /cadre start xrm -rf ~ renders .cadre/xrm -rf ~/.runtime/ in the root session of the repo; ' +
        'this script never renders it.',
    ])
    expect(shellLines.filter(line => line.startsWith('rm '))).toEqual([])
    expect(execWords(text)).toContain(`$root/.cadre/${id}/.runtime/settings.json`)
  })

  test('a title never reaches the launcher', () => {
    const be = templateRole('be', { title: '$(evil) `x`; rm -rf ~' })
    const text = launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'git-root' })

    expect(text).not.toContain('evil')
    expect(text).not.toContain('rm -rf')
  })

  test('the launcher holds no absolute user path and no variable reference, whatever role, framework and start', () => {
    const problems: string[] = []
    for (const start of LAUNCH_STARTS) {
      for (const framework of FRAMEWORKS) {
        for (const role of TEMPLATE_ROLES) {
          const text = launcherText(role, scopeOf(role, framework, TEMPLATE_ROLES), start)
          const found = leaks(text, [...ABSOLUTE_PATH_MARKERS, '${'])
          problems.push(...found.map(needle => `${start.kind} / ${framework} / ${role.id}: ${needle}`))
        }
      }
    }

    expect(problems).toEqual([])
  })

  test('desiredFiles writes the launcher with the launch start of the repo state (A2)', () => {
    const be = templateRole('be')
    const input = inputOf([be], 'gsd')
    const start: LaunchStart = { kind: 'dir', path: 'apps/web' }
    const files = desiredFiles({ ...input, state: { ...input.state, launchStart: start } })
    const launcher = contentOf(files, '.cadre/bin/be') ?? ''

    expect(launcher).toBe(launcherText(be, scopeOf(be, 'gsd', [be]), start))
    expect(launcher.split('\n')).toContain('cd -- "$root"/apps/web')
  })
})

/**
 * What a scan of the secret world kept, as names only: the env names and hook basenames of the secret settings beside
 * the scanned servers, skills, agents and plugins. The values of that world are the SECRET_FIXTURES, which a scan never
 * keeps and a generated file must never hold.
 */
const WORLD_SETUP: SetupScan = {
  plugins: ['superpowers@claude-plugins-official', 'codex@openai-codex'],
  installedPlugins: ['codex@openai-codex', 'superpowers@claude-plugins-official'],
  skills: [
    skillRef('my-skill'),
    skillRef('gsd-health'),
    skillRef('create-handoff-doc'),
    skillRef('codex:rescue', 'codex'),
    skillRef('superpowers:brainstorming', 'superpowers'),
    skillRef('autopilot', 'autopilot'),
  ],
  mcp: [session('jira'), session('playwright'), session('github'), session('autopilot'), session('sentry')],
  isMcpPartial: false,
  agents: ['gsd-planner', 'my-agent'],
  claudeMd: ['<repo>/CLAUDE.md', '~/.claude/CLAUDE.md'],
  hasGlobalClaudeMd: true,
  memoryFiles: ['~/.claude/projects/-repo/memory/MEMORY.md'],
  settingsKeys: [{ source: 'user', keys: ['autoCompactWindow', 'env', 'hooks', 'statusLine'] }],
  hooks: [
    { script: 'gsd-secret-read-guard.js', event: 'PreToolUse', source: 'user' },
    { script: 'my-hook.sh', event: 'PreToolUse', source: 'user' },
  ],
  carry: { autoCompactWindow: 800000, hasStatusLine: true, isGsdStatusline: true, envNames: ['API_KEY', 'JIRA_URL'] },
  warnings: [],
}

/** The ways a template role may be assigned names: nothing, or every scanned server, skill, hook and env name. */
const WORLD_ASSIGNMENTS: readonly (readonly [string, (role: RoleSpec) => RoleSpec])[] = [
  ['nothing assigned', role => role],
  [
    'everything assigned',
    role => ({
      ...role,
      mcp: WORLD_SETUP.mcp.map(ref => ref.name),
      skills: WORLD_SETUP.skills.map(item => item.name),
      instructions: ['global-claude-md', 'auto-memory', 'project-claude-md'],
      carry: {
        autoCompactWindow: true,
        statusLine: true,
        env: WORLD_SETUP.carry.envNames,
        hooks: WORLD_SETUP.hooks.map(item => item.script),
      },
    }),
  ],
]

/** The contexts the matrix runs: the merged MCP route unattended, and the strict route attended. */
const WORLD_CONTEXTS: readonly (readonly [string, Partial<ScopeContext>])[] = [
  ['merged', { mcpRoute: 'merged' }],
  ['strict and attended', { mcpRoute: 'strict', isAttended: true }],
]

/** The input init gives desiredFiles for the six template roles in one framework, with the secret world scanned. */
function worldInput(
  framework: FrameworkId,
  assign: (role: RoleSpec) => RoleSpec,
  over: Partial<ScopeContext>,
): GenerateInput {
  const team = TEMPLATE_ROLES.map(assign)
  const world: Partial<ScopeContext> = { setup: WORLD_SETUP, codeDirs: ['autopilot', 'cadre'], ...over }

  return {
    roles: team,
    scopes: new Map(team.map((role): [string, CompiledScope] => [role.id, scopeOf(role, framework, team, world)])),
    state: stateOf(team, framework),
    only: null,
  }
}

/** A check of the files init wants for one matrix input: its problems as messages, empty when there are none. */
type FilesCheck = (input: GenerateInput, files: readonly DesiredFile[]) => string[]

/** Every problem a check finds over the matrix of frameworks, assignments and contexts, with where it was found. */
function worldProblems(check: FilesCheck): string[] {
  const problems: string[] = []
  for (const framework of FRAMEWORKS) {
    for (const [assignment, assign] of WORLD_ASSIGNMENTS) {
      for (const [context, over] of WORLD_CONTEXTS) {
        const input = worldInput(framework, assign, over)
        const where = `${framework} / ${assignment} / ${context}`
        problems.push(...check(input, desiredFiles(input)).map(problem => `${where}: ${problem}`))
      }
    }
  }

  return problems
}

/** What no committed file may hold (PLAN-05): a secret, the start of an absolute user path, or a variable reference. */
const FORBIDDEN_TEXT: readonly string[] = [...SECRET_FIXTURES, ...ABSOLUTE_PATH_MARKERS, '${']

/** The ways a desired file holds forbidden text, as messages. */
function contentProblems(file: DesiredFile): string[] {
  return leaks(file.content, FORBIDDEN_TEXT).map(needle => `${file.path} holds ${needle}`)
}

/**
 * Whether lowercased path segments name a role's built `.cadre/<id>/CLAUDE.md`, the one CLAUDE.md a plan may hold
 * (G-02-1f Storage split, D-140): directly in a role folder, never in `.cadre/bin/` or deeper.
 */
function isBuiltRoleFile(segments: readonly string[]): boolean {
  return segments.length === 3 && segments[0] === '.cadre' && segments[1] !== 'bin' && segments[2] === 'claude.md'
}

/** The ways the path of a desired file breaks PLAN-06 (D-50, as D-140 amends it for built role files), as messages. */
function pathProblems(file: DesiredFile): string[] {
  const segments = file.path.toLowerCase().split('/')
  const problems: string[] = []
  const isInstructionFile = /(?:claude|agents)\.md$/.test(file.path.toLowerCase())
  if (!isSafeOpPath(file.path)) problems.push(`${file.path} is not a safe op path`)
  if (isInstructionFile && !isBuiltRoleFile(segments)) problems.push(`${file.path} is a CLAUDE.md or AGENTS.md`)
  if (segments.includes('.claude')) problems.push(`${file.path} is under a .claude folder`)
  if (segments.includes('.runtime')) problems.push(`${file.path} is in a .runtime folder`)

  return problems
}

/** The problems with the text of an mcp.json: it must hold exactly the schema and the sorted server names (D-93). */
function mcpFileProblems(path: string, content: string): string[] {
  const parsed: unknown = JSON.parse(content)
  if (!isObject(parsed)) return [`${path} is not an object`]
  const problems: string[] = []
  if (Object.keys(parsed).sort(compareText).join(',') !== 'schema,servers') problems.push(`${path} has other keys`)
  if (parsed.schema !== 1) problems.push(`${path} has schema ${JSON.stringify(parsed.schema)}`)
  const servers = parsed.servers
  const isNames = Array.isArray(servers) && servers.every(name => typeof name === 'string')
  if (!isNames) return [...problems, `${path} servers are not a list of names`]
  if (servers.join(',') !== [...servers].sort(compareText).join(',')) problems.push(`${path} servers are not sorted`)

  return problems
}

/** The problems with the text of a settings.json: only the three template keys, and no infra tool blocked. */
function settingsFileProblems(path: string, content: string, scope: CompiledScope, framework: FrameworkId): string[] {
  const parsed = JSON.parse(content)
  const keys = Object.keys(parsed).sort(compareText).join(',')
  const problems: string[] = []
  if (keys !== 'enabledPlugins,permissions,sandbox') problems.push(`${path} has the keys ${keys}`)
  problems.push(...infraViolations({ ...scope, settings: parsed }, framework).map(problem => `${path}: ${problem}`))

  return problems
}

/** The mcp.json problems of every role of an input. */
const mcpFilesCheck: FilesCheck = (input, files) =>
  input.roles.flatMap(role => {
    const path = `.cadre/${role.id}/mcp.json`
    const content = contentOf(files, path)

    return content === undefined ? [`${path} is missing`] : mcpFileProblems(path, content)
  })

/** The settings.json problems of every role of an input. */
const settingsFilesCheck: FilesCheck = (input, files) =>
  input.roles.flatMap(role => {
    const path = `.cadre/${role.id}/settings.json`
    const content = contentOf(files, path)
    const scope = input.scopes.get(role.id)
    if (content === undefined || scope === undefined) return [`${path} is missing`]

    return settingsFileProblems(path, content, scope, scope.card.framework)
  })

describe('generated file properties', () => {
  test('the matrix is six roles, three frameworks, two assignments and two contexts of 38 files each', () => {
    let runs = 0
    const sizes = new Set<number>()
    worldProblems((_input, files) => {
      runs += 1
      sizes.add(files.length)

      return []
    })

    expect(runs).toBe(3 * 2 * 2)
    expect(Array.from(sizes)).toEqual([6 * 6 + 2])
    expect(WORLD_ASSIGNMENTS.map(([label]) => label)).toEqual(['nothing assigned', 'everything assigned'])
  })

  test('no generated file holds a secret, an absolute user path or a variable reference (PLAN-05)', () => {
    expect(worldProblems((_input, files) => files.flatMap(contentProblems))).toEqual([])
  })

  test('every generated path is a safe op path, and none is a CLAUDE.md, an AGENTS.md, in .claude or .runtime', () => {
    expect(worldProblems((_input, files) => files.flatMap(pathProblems))).toEqual([])
  })

  test('built role CLAUDE.md files pass the content and path checks and hold no global part (PLAN-05, T-02-69)', () => {
    const input = worldInput('gsd', role => role, {})
    const keys = `# Keys\n${SECRET_FIXTURES[0]} in /Users/alice\n`
    const secretPart = part('P1', '~/.claude/CLAUDE.md', 'Keys', keys, 'global')
    const given = (role: RoleSpec): [string, InstructionPart[]] => [role.id, [secretPart, RULES_PART]]
    const files = desiredFiles({ ...input, repoParts: new Map(input.roles.map(given)) })
    const built = files.filter(file => file.path.endsWith('/CLAUDE.md')).map(file => file.path)

    expect(built).toEqual(input.roles.map(role => `.cadre/${role.id}/CLAUDE.md`).sort(compareText))
    expect(files.flatMap(contentProblems)).toEqual([])
    expect(files.flatMap(pathProblems)).toEqual([])
  })

  test('every mcp.json holds exactly the schema and a sorted list of server names (D-93)', () => {
    expect(worldProblems(mcpFilesCheck)).toEqual([])
  })

  test('every settings.json has only the three template keys and passes the ISO-04 checker, parsed back (D-84)', () => {
    expect(worldProblems(settingsFilesCheck)).toEqual([])
  })

  test('buildPlan creates every generated file on an empty disk, the launchers executable, no warning', async () => {
    const files = desiredFiles(worldInput('gsd', role => role, {}))
    const plan = await buildPlan({
      desired: files,
      disk: new Map(),
      manifest: null,
      manifestState: 'absent',
      carried: [],
      gitignore: null,
      hunks: [],
      cadreVersion: '0.2.0',
    })
    const created = plan.ops.filter((op): op is FileOp => op.kind === 'create')
    const wanted = [...files.map(file => file.path), '.cadre/manifest.json'].sort(compareText)

    expect(plan.warnings).toEqual([])
    expect(created).toHaveLength(plan.ops.length)
    expect(created.map(op => op.path)).toEqual(wanted)
    expect(created.filter(op => op.path.startsWith('.cadre/bin/')).every(op => op.mode === 'exec')).toBe(true)
  })

  test('the content check finds a secret, an absolute user path and a variable reference', () => {
    const bad = (content: string): DesiredFile => ({ path: '.cadre/be/ROLE.md', content, mode: 'file' })

    expect(contentProblems(bad(`key ${SECRET_FIXTURES[0]}`))).toHaveLength(1)
    expect(contentProblems(bad('cd /Users/alice/repo'))).toEqual(['.cadre/be/ROLE.md holds /Users/'])
    expect(contentProblems(bad('/home/u/.claude'))).toEqual(['.cadre/be/ROLE.md holds /home/'])
    expect(contentProblems(bad('${HOME}/x'))).toEqual(['.cadre/be/ROLE.md holds ${'])
    expect(contentProblems(bad('fine'))).toEqual([])
  })

  test('the path check finds a path outside .cadre, a non-role CLAUDE.md, an AGENTS.md, .claude and .runtime', () => {
    const at = (path: string): DesiredFile => ({ path, content: '', mode: 'file' })

    expect(pathProblems(at('CLAUDE.md')).length > 0).toBe(true)
    expect(pathProblems(at('.cadre/be/CLAUDE.md'))).toEqual([])
    expect(pathProblems(at('.cadre/bin/CLAUDE.md')).length > 0).toBe(true)
    expect(pathProblems(at('.cadre/be/docs/CLAUDE.md')).length > 0).toBe(true)
    expect(pathProblems(at('.cadre/be/agents.md')).length > 0).toBe(true)
    expect(pathProblems(at('.cadre/.claude/settings.json')).length > 0).toBe(true)
    expect(pathProblems(at('.cadre/be/.runtime/settings.json')).length > 0).toBe(true)
    expect(pathProblems(at('../outside'))).toContain('../outside is not a safe op path')
    expect(pathProblems(at('.cadre/be/ROLE.md'))).toEqual([])
  })

  test('the json checks find an extra key, a bad schema, an unsorted list, a blocked tool and a missing plugin', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'gsd', [be])
    const mcp = (value: unknown): string[] => mcpFileProblems('mcp.json', JSON.stringify(value))
    const settings = (value: unknown): string[] => settingsFileProblems('s.json', JSON.stringify(value), scope, 'gsd')
    const good = scope.settings
    const deny = [...good.permissions.deny, 'mcp__autopilot__wait_for']

    expect(mcp({ schema: 1, servers: ['a', 'b'] })).toEqual([])
    expect(mcp({ schema: 1, servers: ['a'], env: {} })).toEqual(['mcp.json has other keys'])
    expect(mcp({ schema: 2, servers: [] })).toEqual(['mcp.json has schema 2'])
    expect(mcp({ schema: 1, servers: ['b', 'a'] })).toEqual(['mcp.json servers are not sorted'])
    expect(mcp({ schema: 1, servers: [1] })).toEqual(['mcp.json servers are not a list of names'])
    expect(settings(good)).toEqual([])
    expect(settings({ ...good, autoCompactWindow: 800000 })).toEqual([
      's.json has the keys autoCompactWindow,enabledPlugins,permissions,sandbox',
    ])
    expect(settings({ ...good, permissions: { ...good.permissions, deny } })).toEqual([
      's.json: deny entry mcp__autopilot__wait_for would block an infra tool',
    ])
    expect(settings({ ...good, enabledPlugins: {} }).length > 0).toBe(true)
  })
})
