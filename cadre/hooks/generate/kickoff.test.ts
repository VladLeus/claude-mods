import { describe, expect, test } from 'claude-code/testing'

import type { FrameworkId, RoleSpec } from '../../types'
import { stableJson } from '../core/json'
import { parseRoleJson } from '../roles/rolejson'
import { isAutopilotDuration } from '../roles/validate'
import { FRAMEWORKS, scopeOf, TEMPLATE_ROLES, templateRole } from '../testkit'
import { mcpText, roleJsonText, settingsText } from './docs'
import { asciiLine, autopilotCommand, budgetedRoleLine, kickoffRoleLine, kickoffText, ROLE_LINE_MAX } from './kickoff'

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

  test('role.json holds the repo part records of a role that has them, and reads back to it (G-02-1f)', () => {
    const hash = '0123456789abcdef'.repeat(4)
    const role = templateRole('be', {
      instructionParts: [
        { file: 'CLAUDE.md', heading: 'Git', hash },
        { file: '.claude/rules/api.md', heading: '', hash: 'a'.repeat(64) },
      ],
    })
    const records = [
      '  "instructionParts": [',
      '    {',
      '      "file": "CLAUDE.md",',
      `      "hash": "${hash}",`,
      '      "heading": "Git"',
      '    },',
      '    {',
      '      "file": ".claude/rules/api.md",',
      `      "hash": "${'a'.repeat(64)}",`,
      '      "heading": ""',
      '    }',
      '  ],',
    ].join('\n')

    expect(roleJsonText(role)).toContain(records)
    expect(parseRoleJson(roleJsonText(role))).toEqual(role)
    expect(parseRoleJson(roleJsonText(templateRole('be', { instructionParts: [] })))?.instructionParts).toEqual([])
    expect(roleJsonText(templateRole('be'))).not.toContain('instructionParts')
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

describe('budgetedRoleLine (SHOULD 3)', () => {
  test('a title with no ASCII character left gives way to the role id in the line the sentence builds', () => {
    const role = templateRole('be', { title: '\u00e9\u00e8\u2014' })
    const sentence = (title: string) => `You are ${title}, read your ROLE.md.`

    expect(budgetedRoleLine(role, sentence)).toBe('You are be, read your ROLE.md.')
  })
})

describe('autopilotCommand (SHOULD 3)', () => {
  test('the line is the one quoted text and the flag follows it outside the quotes, then a newline', () => {
    expect(autopilotCommand('4h', 65, 'You are be.', ' --ask-user')).toBe('/autopilot 4h 65 "You are be." --ask-user\n')
    expect(autopilotCommand('90m', 70, 'You are qa.', '')).toBe('/autopilot 90m 70 "You are qa."\n')
  })
})
