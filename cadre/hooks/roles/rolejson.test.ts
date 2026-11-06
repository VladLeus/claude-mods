import { describe, expect, test } from 'claude-code/testing'

import type { RoleSpec } from '../../types'
import { BIDI_OVERRIDE, row, ZERO_WIDTH_SPACE } from '../testkit'
import { parseRoleJson } from './rolejson'
import { roleFromTemplate, ROLE_TEMPLATE } from './template'

/** The role.json object of the BE template role, with its schema; a test overrides only the fields it checks. */
const BE_JSON = { schema: 1, ...roleFromTemplate(row('be')) }

/** The role.json text of the BE role with these fields replaced. */
function jsonWith(over: Record<string, unknown>): string {
  return JSON.stringify({ ...BE_JSON, ...over })
}

/** The role.json text of the BE role without this key. */
function jsonWithout(key: string): string {
  return JSON.stringify(Object.fromEntries(Object.entries(BE_JSON).filter(([name]) => name !== key)))
}

/** The autopilot object of the BE role with these fields replaced. */
function autopilotWith(over: Record<string, unknown>): Record<string, unknown> {
  return { ...BE_JSON.autopilot, ...over }
}

/** The carry object of the BE role with these fields replaced. */
function carryWith(over: Record<string, unknown>): Record<string, unknown> {
  return { ...BE_JSON.carry, ...over }
}

/** A role that sets every optional part: a framework, MCP, skills, instructions and what it carries. */
const FULL_ROLE: RoleSpec = {
  id: 'docs-writer',
  title: 'Docs writer',
  purpose: 'Writes the docs.',
  basedOn: null,
  framework: 'superpowers',
  model: 'sonnet',
  effort: 'high',
  permissionMode: 'plan',
  autopilot: { duration: '1h30m', threshold: 80, askUser: true },
  hasBash: true,
  mcp: ['jira', 'plugin:foo:bar'],
  skills: ['security-review', 'gsd:plan-phase'],
  instructions: ['global-claude-md', 'auto-memory', 'project-claude-md'],
  carry: {
    autoCompactWindow: true,
    statusLine: true,
    env: ['PATH', 'MY_TOKEN_NAME'],
    hooks: ['gsd-secret-read-guard.js'],
  },
}

/** Each case is a field that must reject the whole file, with a name that shows in a failing diff. */
const BAD_FIELDS: readonly (readonly [string, Record<string, unknown>])[] = [
  ['an id that is not a slug', { id: 'Be' }],
  ['the reserved id', { id: 'bin' }],
  ['an empty id', { id: '' }],
  ['an id that is not text', { id: 5 }],
  ['a title that is not text', { title: 5 }],
  ['a title that cleans to nothing', { title: BIDI_OVERRIDE }],
  ['a purpose that is not text', { purpose: 5 }],
  ['a purpose that cleans to nothing', { purpose: '\n' }],
  ['a basedOn outside the template', { basedOn: 'cto' }],
  ['a basedOn in capitals', { basedOn: 'PM' }],
  ['a framework outside the three', { framework: 'bmad' }],
  ['a framework in capitals', { framework: 'GSD' }],
  ['a null framework', { framework: null }],
  ['a model with a digit', { model: 'opus4' }],
  ['a model in capitals', { model: 'Opus' }],
  ['a pinned model id', { model: 'claude-opus-4-5' }],
  ['a typo of a family alias', { model: 'sonet' }],
  ['a model of 25 letters', { model: 'a'.repeat(25) }],
  ['a model that is not text', { model: 5 }],
  ['an unknown effort', { effort: 'ultra' }],
  ['an effort in capitals', { effort: 'LOW' }],
  ['a permission mode outside the six', { permissionMode: 'yolo' }],
  ['a permission mode in capitals', { permissionMode: 'Auto' }],
  ['no autopilot object', { autopilot: null }],
  ['an autopilot list', { autopilot: [] }],
  ['no duration', { autopilot: { threshold: 65, askUser: false } }],
  ['a duration with a space', { autopilot: autopilotWith({ duration: '4 h' }) }],
  ['a duration that is not text', { autopilot: autopilotWith({ duration: 4 }) }],
  ['a duration of zero', { autopilot: autopilotWith({ duration: '0' }) }],
  ['a duration over 168 hours', { autopilot: autopilotWith({ duration: '169h' }) }],
  ['a threshold of 0', { autopilot: autopilotWith({ threshold: 0 }) }],
  ['a threshold of 96', { autopilot: autopilotWith({ threshold: 96 }) }],
  ['a fractional threshold', { autopilot: autopilotWith({ threshold: 65.5 }) }],
  ['a threshold as text', { autopilot: autopilotWith({ threshold: '65' }) }],
  ['an autopilot askUser that is not a boolean', { autopilot: autopilotWith({ askUser: 'yes' }) }],
  ['a hasBash that is not a boolean', { hasBash: 'true' }],
  ['mcp that is not a list', { mcp: 'jira' }],
  ['mcp with a non-string', { mcp: ['jira', 5] }],
  ['mcp with a space', { mcp: ['my server'] }],
  ['mcp with an empty name', { mcp: [''] }],
  ['mcp starting with a dash', { mcp: ['-x'] }],
  ['mcp with a name of 101 characters', { mcp: ['a'.repeat(101)] }],
  ['skills that are null', { skills: null }],
  ['skills with a slash', { skills: ['a/b'] }],
  ['instructions that are not a list', { instructions: 'auto-memory' }],
  ['an unknown instruction group', { instructions: ['auto-memory', 'nope'] }],
  ['carry that is a list', { carry: [] }],
  ['carry with nothing in it', { carry: {} }],
  ['an autoCompactWindow that is not a boolean', { carry: carryWith({ autoCompactWindow: 1 }) }],
  ['a statusLine that is not a boolean', { carry: carryWith({ statusLine: 'no' }) }],
  ['an env name in lowercase', { carry: carryWith({ env: ['path'] }) }],
  ['an env name of 65 characters', { carry: carryWith({ env: ['A'.repeat(65)] }) }],
  ['an env that is not a list', { carry: carryWith({ env: 'PATH' }) }],
  ['a hook name with a slash', { carry: carryWith({ hooks: ['a/b.js'] }) }],
  ['a hook name of 81 characters', { carry: carryWith({ hooks: ['a'.repeat(81)] }) }],
  ['a hook name with a space', { carry: carryWith({ hooks: ['a b.js'] }) }],
  ['a schema other than 1', { schema: 2 }],
  ['a schema as text', { schema: '1' }],
]

describe('parseRoleJson', () => {
  test('every template role reads back as itself from its role.json text', () => {
    for (const role of ROLE_TEMPLATE.map(roleFromTemplate)) {
      expect(parseRoleJson(JSON.stringify({ schema: 1, ...role }))).toEqual(role)
    }
  })

  test('a role that sets every part reads back as itself', () => {
    expect(parseRoleJson(JSON.stringify({ schema: 1, ...FULL_ROLE }))).toEqual(FULL_ROLE)
  })

  test('every effort and every permission mode reads back', () => {
    const efforts = ['low', 'medium', 'high', 'xhigh', 'max']
    const modes = ['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan']

    for (const effort of efforts) {
      expect(parseRoleJson(jsonWith({ effort }))?.effort).toBe(effort)
    }
    for (const permissionMode of modes) {
      expect(parseRoleJson(jsonWith({ permissionMode }))?.permissionMode).toBe(permissionMode)
    }
  })

  test('the schema key is dropped, and keys that are not part of a role are ignored', () => {
    const parsed = parseRoleJson(jsonWith({ notes: 'by hand', extra: { a: 1 } }))

    expect(parsed).toEqual(roleFromTemplate(row('be')))
    expect(Object.hasOwn(parsed ?? {}, 'schema')).toBe(false)
    expect(Object.hasOwn(parsed ?? {}, 'notes')).toBe(false)
  })

  test('the order of the keys does not matter', () => {
    const reversed = JSON.stringify(Object.fromEntries(Object.entries(BE_JSON).reverse()))

    expect(parseRoleJson(reversed)).toEqual(roleFromTemplate(row('be')))
  })

  test('without a framework key the role has none, and with one it keeps it', () => {
    expect(Object.hasOwn(parseRoleJson(jsonWithout('framework')) ?? {}, 'framework')).toBe(false)
    expect(parseRoleJson(jsonWith({ framework: 'none' }))?.framework).toBe('none')
  })

  test('a title and a purpose are cleaned and capped, not refused', () => {
    const parsed = parseRoleJson(
      jsonWith({ title: `Dev${BIDI_OVERRIDE}Ops`, purpose: `${'p'.repeat(250)}${BIDI_OVERRIDE}` }),
    )
    const longTitle = parseRoleJson(jsonWith({ title: 'T'.repeat(41) }))

    expect(parsed?.title).toBe('DevOps')
    expect(parsed?.purpose).toBe(`${'p'.repeat(199)}…`)
    expect(longTitle?.title).toBe(`${'T'.repeat(39)}…`)
  })

  test('values at the edge of each rule are accepted', () => {
    const edges: Record<string, unknown>[] = [
      { model: 'haiku' },
      { model: 'opus' },
      { model: 'sonnet' },
      { model: 'fable' },
      { autopilot: autopilotWith({ threshold: 1 }) },
      { autopilot: autopilotWith({ threshold: 95 }) },
      { autopilot: autopilotWith({ duration: '4H' }) },
      { autopilot: autopilotWith({ duration: '45' }) },
      { autopilot: autopilotWith({ duration: '168h' }) },
      { mcp: ['a.b@c-d_e:f', 'a'.repeat(100), 'A'] },
      { skills: ['gsd:plan-phase', 'x'] },
      { instructions: ['auto-memory'] },
      { carry: carryWith({ env: ['A', '_', 'A'.repeat(64)] }) },
      { carry: carryWith({ hooks: ['a', 'a'.repeat(80), 'gsd-secret-read-guard.js'] }) },
    ]

    for (const over of edges) {
      expect([JSON.stringify(over), parseRoleJson(jsonWith(over)) === null]).toEqual([JSON.stringify(over), false])
    }
  })

  test('text that is not a role.json object is null', () => {
    for (const text of ['not json', '', '[]', 'null', '5', '"role"', '{', '{}']) {
      expect([text, parseRoleJson(text)]).toEqual([text, null])
    }
  })

  test('a missing field gives null', () => {
    const keys = [
      'schema',
      'id',
      'title',
      'purpose',
      'basedOn',
      'model',
      'effort',
      'permissionMode',
      'autopilot',
      'hasBash',
      'mcp',
      'skills',
      'instructions',
      'carry',
    ]

    for (const key of keys) {
      expect([key, parseRoleJson(jsonWithout(key))]).toEqual([key, null])
    }
  })

  test('a field that is not valid gives null for the whole file', () => {
    for (const [name, over] of BAD_FIELDS) {
      expect([name, parseRoleJson(jsonWith(over))]).toEqual([name, null])
    }
  })

  test('PM never has Bash: a role based on pm with hasBash true gives null', () => {
    const pm = { schema: 1, ...roleFromTemplate(row('pm')) }
    const product = { ...pm, id: 'product' }

    expect(parseRoleJson(JSON.stringify(pm))?.hasBash).toBe(false)
    expect(parseRoleJson(JSON.stringify({ ...pm, hasBash: true }))).toBeNull()
    expect(parseRoleJson(JSON.stringify({ ...product, hasBash: true }))).toBeNull()
    expect(parseRoleJson(JSON.stringify({ ...BE_JSON, hasBash: false }))?.hasBash).toBe(false)
  })
})

/** A SHA-256 as a role.json part record holds it: 64 lowercase hex characters (G-02-1f Regen). */
const PART_HASH = '0123456789abcdef'.repeat(4)

/** A role.json record of a repo part, the Git section of the root CLAUDE.md; `over` changes the fields it names. */
function partRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { file: 'CLAUDE.md', heading: 'Git', hash: PART_HASH, ...over }
}

/** Each case is a part record that must refuse the whole file, with a name that shows in a failing diff (T-02-78). */
const BAD_PART_RECORDS: readonly (readonly [string, unknown])[] = [
  ['records that are not a list', partRecord()],
  ['null records', null],
  ['a record that is not an object', ['CLAUDE.md']],
  ['an absolute file', [partRecord({ file: '/etc/CLAUDE.md' })]],
  ['a file above the repo', [partRecord({ file: '../CLAUDE.md' })]],
  ['a file with a .. segment', [partRecord({ file: 'docs/../../CLAUDE.md' })]],
  ['a file with a . segment', [partRecord({ file: './CLAUDE.md' })]],
  ['a file with an empty segment', [partRecord({ file: 'docs//guide.md' })]],
  ['a file with a trailing slash', [partRecord({ file: 'docs/' })]],
  ['an empty file', [partRecord({ file: '' })]],
  ['a file that is not a .md file', [partRecord({ file: '.env' })]],
  ['a file under .git', [partRecord({ file: '.git/info/notes.md' })]],
  ['a file under .GIT in capitals', [partRecord({ file: 'sub/.GIT/notes.md' })]],
  ['a file with a hidden character', [partRecord({ file: `CLAUDE${BIDI_OVERRIDE}.md` })]],
  ['a file that is not text', [partRecord({ file: 5 })]],
  ['no file', [{ heading: 'Git', hash: PART_HASH }]],
  ['a heading with a hidden character', [partRecord({ heading: `Gi${ZERO_WIDTH_SPACE}t` })]],
  ['a heading with a line break', [partRecord({ heading: 'Git\nand more' })]],
  ['a heading of 81 code points', [partRecord({ heading: 'h'.repeat(81) })]],
  ['a heading that is not text', [partRecord({ heading: null })]],
  ['no heading', [{ file: 'CLAUDE.md', hash: PART_HASH }]],
  ['a hash of 63 characters', [partRecord({ hash: PART_HASH.slice(1) })]],
  ['a hash in capitals', [partRecord({ hash: PART_HASH.toUpperCase() })]],
  ['a hash that is not hex', [partRecord({ hash: 'g'.repeat(64) })]],
  ['a hash that is not text', [partRecord({ hash: 5 })]],
  ['no hash', [{ file: 'CLAUDE.md', heading: 'Git' }]],
  ['one bad record among good ones', [partRecord(), partRecord({ file: '/CLAUDE.md' })]],
]

describe('role.json part records (G-02-1f)', () => {
  test('a role with repo part records reads back with them, in their order', () => {
    const records = [
      { file: 'CLAUDE.md', heading: 'Git', hash: PART_HASH },
      { file: '.claude/rules/frontend/react.md', heading: '', hash: 'a'.repeat(64) },
      { file: 'docs/My Guide.md', heading: 'h'.repeat(80), hash: 'b'.repeat(64) },
    ]
    const role: RoleSpec = { ...roleFromTemplate(row('be')), instructionParts: records }

    expect(parseRoleJson(JSON.stringify({ schema: 1, ...role }))).toEqual(role)
    expect(parseRoleJson(jsonWith({ instructionParts: [] }))?.instructionParts).toEqual([])
  })

  test('a role.json without part records still parses, with no instructionParts key', () => {
    const parsed = parseRoleJson(jsonWithout('instructionParts'))

    expect(parsed).toEqual(roleFromTemplate(row('be')))
    expect(Object.hasOwn(parsed ?? {}, 'instructionParts')).toBe(false)
  })

  test('a record that is not a safe repo .md file, a clean heading of 80 at most or a 64-hex hash refuses it', () => {
    for (const [name, records] of BAD_PART_RECORDS) {
      expect([name, parseRoleJson(jsonWith({ instructionParts: records }))]).toEqual([name, null])
    }
  })

  test('the parts not given read back beside the given ones, and are absent when the file has none (Q1)', () => {
    const given = [{ file: 'CLAUDE.md', heading: 'Git', hash: PART_HASH }]
    const notGiven = [{ file: 'CLAUDE.md', heading: 'Rules', hash: 'c'.repeat(64) }]
    const role: RoleSpec = {
      ...roleFromTemplate(row('be')),
      instructionParts: given,
      instructionPartsNotGiven: notGiven,
    }
    const parsed = parseRoleJson(jsonWith({ instructionParts: given }))

    expect(parseRoleJson(JSON.stringify({ schema: 1, ...role }))).toEqual(role)
    expect(Object.hasOwn(parsed ?? {}, 'instructionPartsNotGiven')).toBe(false)
  })

  test('a not-given record that is not a safe repo .md file, a clean heading or a 64-hex hash refuses it (Q1)', () => {
    for (const [name, records] of BAD_PART_RECORDS) {
      const text = jsonWith({ instructionParts: [], instructionPartsNotGiven: records })
      expect([name, parseRoleJson(text)]).toEqual([name, null])
    }
  })
})
