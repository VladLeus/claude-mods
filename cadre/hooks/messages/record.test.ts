import { describe, expect, test } from 'claude-code/testing'

import type {
  InboxEntry,
  InboxEntryFields,
  InboxEvent,
  InboxItem,
  InboxMark,
  InboxState,
  MessageKind,
} from '../../types'
import { utf8Bytes } from '../core/text'
import { CONTRACTS } from '../locales/contracts'
import { inboxHiddenOf, PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import {
  entryIdOf,
  foldInbox,
  inboxReadText,
  lineRefusal,
  parseInbox,
  parseInboxLine,
  parseReadInput,
  parseSessionRecord,
  recordLine,
  sessionRecordText,
  ticketPinOf,
} from './record'
import {
  BODY_MAX_CHARS,
  CHANGES_MAX_CHARS,
  INBOX_LINE_MAX_BYTES,
  LIST_ITEM_MAX_CHARS,
  LIST_MAX_ITEMS,
  MESSAGE_KINDS,
  REASON_MAX_CHARS,
  REPORT_FORM_MAX_CHARS,
  SPEC_PATH_MAX_CHARS,
  SUBJECT_MAX_CHARS,
  TICKET_KEY_MAX_CHARS,
  TICKETS_MAX_ITEMS,
  VERIFICATION_MAX_CHARS,
} from './send'
import { SP_METHOD, SP_PLAN_DIR } from './sizing'

/** A character of four UTF-8 bytes. */
const WIDE = '\u{1F600}'

/** The idle wait sentence, spelled out so the specs pin its words. */
const IDLE_WAIT =
  'When your inbox is empty, call wait_for with reason idle-inbox if more work may come; ' +
  'when your task is finished, give the done answer autopilot asks for.'

const A: InboxEntry = {
  v: 1,
  type: 'entry',
  id: 'be-1000-0123abcd',
  at: 1000,
  from: 'be',
  to: 'tl',
  kind: 'note',
  subject: 'Hi',
  body: 'Hello',
}
const B: InboxEntry = {
  ...A,
  id: 'pm-2000-89abcdef',
  at: 2000,
  from: 'pm',
  kind: 'ticket',
  subject: 'Ship it',
  body: 'Line one\nLine two',
}
const C: InboxEntry = { ...A, id: 'qa-2500-00ff00ff', at: 2500, from: 'qa', kind: 'report', subject: 'Done' }

/** A mark by tl, the owner of the fixture entries. */
function mark(id: string, at: number, state: Exclude<InboxState, 'unread'>, over: Partial<InboxMark> = {}): InboxMark {
  return { v: 1, type: 'mark', id, at, by: 'tl', state, ...over }
}

/** The item of an entry with no mark. */
function unread(entry: InboxEntry): InboxItem {
  return { entry, state: 'unread', note: null, waitsFor: null, reply: null, markedAt: null }
}

describe('recordLine, parseInboxLine and the session record', () => {
  test('recordLine writes the fixed key order with no spaces, then a newline, whatever order it was given', () => {
    const entry: InboxEntry = { ...A, replyTo: 'tl-900-89abcdef' }
    const shuffled: InboxEntry = {
      replyTo: 'tl-900-89abcdef',
      body: 'Hello',
      subject: 'Hi',
      kind: 'note',
      to: 'tl',
      from: 'be',
      at: 1000,
      id: 'be-1000-0123abcd',
      type: 'entry',
      v: 1,
    }

    expect(recordLine(entry)).toBe(
      '{"v":1,"type":"entry","id":"be-1000-0123abcd","at":1000,"from":"be","to":"tl","kind":"note",' +
        '"subject":"Hi","body":"Hello","replyTo":"tl-900-89abcdef","end":"be-1000-0123abcd"}\n',
    )
    expect(recordLine(shuffled)).toBe(recordLine(entry))
    expect(recordLine(mark(A.id, 3000, 'done', { note: 'merged' }))).toBe(
      '{"v":1,"type":"mark","id":"be-1000-0123abcd","at":3000,"by":"tl","state":"done","note":"merged",' +
        '"end":"be-1000-0123abcd"}\n',
    )
  })

  test('recordLine writes a vector in the order scope, complexity, risk, effort, with the numbers as given', () => {
    const task: InboxEntry = {
      ...A,
      kind: 'task',
      ticketKey: 'PROJ-2',
      vector: { effort: 0.5, risk: 0.30000000000000004, complexity: 0.6, scope: 0.4 },
      use: { gsdPath: 'phase', framework: 'gsd' },
      size: 0.6,
      large: true,
    }

    expect(recordLine(task)).toBe(
      '{"v":1,"type":"entry","id":"be-1000-0123abcd","at":1000,"from":"be","to":"tl","kind":"task",' +
        '"subject":"Hi","body":"Hello","ticketKey":"PROJ-2",' +
        '"vector":{"scope":0.4,"complexity":0.6,"risk":0.30000000000000004,"effort":0.5},' +
        '"use":{"framework":"gsd","gsdPath":"phase"},"size":0.6,"large":true,"end":"be-1000-0123abcd"}\n',
    )
    expect(parseInboxLine(recordLine(task))).toEqual(task)
  })

  test('parseInboxLine reads back what recordLine wrote; v 2 or an unknown kind, sender or id gives null', () => {
    const awaiting = mark(A.id, 3000, 'awaiting', { waitsFor: 'pm-2000-89abcdef' })
    const bad = (over: Readonly<Record<string, unknown>>) => parseInboxLine(JSON.stringify({ ...A, ...over }))

    expect(parseInboxLine(recordLine(A))).toEqual(A)
    expect(parseInboxLine(recordLine(awaiting))).toEqual(awaiting)
    expect(parseInboxLine(JSON.stringify({ ...A, from: 'cadre' }))).toMatchObject({ from: 'cadre' })
    expect([bad({ v: 2 }), bad({ kind: 'ping' }), bad({ from: 'BE!' }), bad({ id: 'not-an-id' })]).toEqual([
      null,
      null,
      null,
      null,
    ])
  })

  test('an entry from cadre is read only as the cadre sender, and an entry to cadre gives null', () => {
    const fromCadre = parseInboxLine(JSON.stringify({ ...A, id: 'cadre-1000-0123abcd', from: 'cadre' }))

    expect(fromCadre).toMatchObject({ type: 'entry', from: CONTRACTS.cadreSender })
    expect(parseInboxLine(JSON.stringify({ ...A, to: 'cadre' }))).toBeNull()
  })

  test('parseSessionRecord reads the id sessionRecordText writes and refuses {} and text that is not JSON', () => {
    expect(sessionRecordText('s-be')).toBe('{"sessionId":"s-be","v":1}\n')
    expect(parseSessionRecord(sessionRecordText('s-be'))).toBe('s-be')
    expect([parseSessionRecord('{}'), parseSessionRecord('not json')]).toEqual([null, null])
  })

  test('entryIdOf gives two entries of one sender in the same millisecond two ids', async () => {
    const first = await entryIdOf('be', 1000, 'tl\nnote\nHi\nHello')
    const second = await entryIdOf('be', 1000, 'tl\nnote\nHi\nHello again')

    expect([first, second].every(id => /^be-1000-[0-9a-f]{8}$/.test(id))).toBe(true)
    expect(first).not.toBe(second)
  })
})

describe('the end key of an inbox record', () => {
  test('every line ends with an end key that echoes its id; the entry or mark read back carries no end', () => {
    const done = mark(A.id, 3000, 'done')

    expect([recordLine(A), recordLine(done)].map(line => line.endsWith(`,"end":"${A.id}"}\n`))).toEqual([true, true])
    expect([parseInboxLine(recordLine(A)), parseInboxLine(recordLine(done))]).toEqual([A, done])
    expect(Object.keys(parseInboxLine(recordLine(A)) ?? {})).not.toContain('end')
    expect(Object.keys(parseInboxLine(recordLine(done)) ?? {})).not.toContain('end')
  })

  test('a line whose end differs from its id is dropped; a line without an end reads as before', () => {
    const done = mark(A.id, 3000, 'done')
    const torn = (event: InboxEvent) => JSON.stringify({ ...event, end: 'pm-2000-89abcdef' })

    expect([parseInboxLine(torn(A)), parseInboxLine(torn(done))]).toEqual([null, null])
    expect([parseInboxLine(JSON.stringify(A)), parseInboxLine(JSON.stringify(done))]).toEqual([A, done])
  })

  test('two records over 8 KiB whose appends interleave in 8192-character chunks never read as one entry', () => {
    const fromFe: InboxEntry = { ...A, id: 'fe-1000-0123abcd', from: 'fe', body: 'a'.repeat(10_000) }
    const fromBe: InboxEntry = { ...A, id: 'be-1000-89abcdef', body: 'b'.repeat(10_000) }
    const chunks = (stdin: string): readonly [string, string] => [stdin.slice(0, 8192), stdin.slice(8192)]
    const [a1, a2] = chunks(`\n${recordLine(fromFe)}`)
    const [b1, b2] = chunks(`\n${recordLine(fromBe)}`)

    expect(parseInbox(`${a1}${b1}${a2}${b2}`)).toEqual([])
  })
})

describe('the kind fields of an entry on its line', () => {
  const VECTOR = { scope: 0.4, complexity: 0.6, risk: 0.3, effort: 0.5 }
  const TICKET: InboxEntry = {
    ...B,
    to: 'tl',
    ticketKey: 'PROJ-2',
    scores: { scope: 0.3, risk: 0.9 },
    pin: 'large',
    reportForm: 'Outcome first',
  }
  const REPORT: InboxEntry = {
    ...C,
    outcome: 'partial',
    changes: 'Added the endpoint',
    verification: 'The specs pass',
    vector: VECTOR,
    reason: 'A new endpoint',
    frameworkUsed: 'gsd',
    docPaths: ['.planning/workstreams/cadre-be'],
    openQuestions: ['Which status code?'],
    size: 0.6,
    large: true,
  }
  const TASK: InboxEntry = {
    ...A,
    kind: 'task',
    ticketKey: 'PROJ-2',
    vector: VECTOR,
    use: { framework: 'superpowers' },
    specPath: 'docs/specs/PROJ-2.md',
    size: 0.6,
    large: true,
    planPath: 'docs/superpowers/plans/tl-PROJ-2.md',
    method: 'superpowers:subagent-driven-development',
  }
  const BRIEF: InboxEntry = { ...A, mode: 'gsd-epic', tickets: ['PROJ-2', 'PROJ-3'] }

  test('a ticket, a report, a superpowers task and a brief come back as they were written', () => {
    for (const entry of [TICKET, REPORT, TASK, BRIEF]) {
      expect(parseInboxLine(recordLine(entry))).toEqual(entry)
    }
  })

  test('recordLine writes the kind fields after the body, then the stamps, each in the fixed order', () => {
    expect(recordLine({ ...TICKET, reportForm: 'R', pin: 'small', scores: { risk: 0.9, scope: 0.3 } })).toBe(
      '{"v":1,"type":"entry","id":"pm-2000-89abcdef","at":2000,"from":"pm","to":"tl","kind":"ticket",' +
        '"subject":"Ship it","body":"Line one\\nLine two","ticketKey":"PROJ-2","scores":{"scope":0.3,"risk":0.9},' +
        '"pin":"small","reportForm":"R","end":"pm-2000-89abcdef"}\n',
    )
    expect(Object.keys(parseInboxLine(recordLine(TASK)) ?? {}).slice(9)).toEqual([
      'ticketKey',
      'vector',
      'use',
      'specPath',
      'size',
      'large',
      'planPath',
      'method',
    ])
  })

  test('a ticket or a report written before these fields existed still reads, with none of them', () => {
    expect(parseInboxLine(recordLine(B))).toEqual(B)
    expect(parseInboxLine(recordLine(C))).toEqual(C)
  })

  test('a stored field with a bad value makes the line null', () => {
    const bad = (over: Readonly<Record<string, unknown>>) => parseInboxLine(JSON.stringify({ ...REPORT, ...over }))

    expect([
      bad({ outcome: 'ok' }),
      bad({ vector: { ...VECTOR, risk: 2 } }),
      bad({ docPaths: ['../x'] }),
      bad({ size: 'big' }),
      parseInboxLine(JSON.stringify({ ...TASK, planPath: '../x.md' })),
    ]).toEqual([null, null, null, null, null])
  })

  test('a pinned stamp is written after large and read back; a stored pinned medium makes the line null', () => {
    const pinned: InboxEntry = { ...TASK, large: false, pinned: 'small' }

    expect(parseInboxLine(recordLine(pinned))).toEqual(pinned)
    expect(Object.keys(parseInboxLine(recordLine(pinned)) ?? {}).slice(13)).toEqual([
      'size',
      'large',
      'pinned',
      'planPath',
      'method',
    ])
    expect(parseInboxLine(JSON.stringify({ ...TASK, pinned: 'medium' }))).toBeNull()
  })
})

describe('parseInbox and foldInbox', () => {
  test('parseInbox keeps the good lines in file order and skips the rest, line by line', () => {
    const text = [
      recordLine(A),
      'not json\n',
      `${JSON.stringify({ ...A, v: 2 })}\n`,
      `${JSON.stringify({ ...A, kind: 'ping' })}\n`,
      '\n',
      recordLine(B),
    ].join('')

    expect(parseInbox(text)).toEqual([A, B])
  })

  test('an entry with no mark is unread; entries keep file order', () => {
    expect(foldInbox([A, B])).toEqual([unread(A), unread(B)])
  })

  test('a later mark sets the state, its note and its time; a mark on an id the inbox does not hold is ignored', () => {
    const events = [A, mark('xx-1500-0123abcd', 1500, 'read'), mark(A.id, 3000, 'done', { note: 'merged' })]

    expect(foldInbox(events)).toEqual([
      { entry: A, state: 'done', note: 'merged', waitsFor: null, reply: null, markedAt: 3000 },
    ])
  })

  test('of two marks with the same time the later line wins', () => {
    const events = [A, mark(A.id, 3000, 'blocked', { note: 'waits on pm' }), mark(A.id, 3000, 'read')]

    expect(foldInbox(events).map(item => [item.state, item.note])).toEqual([['read', null]])
  })
})

describe('inboxReadText', () => {
  test('an unread item shows in full; a blocked item shows one head line with its note and reply', () => {
    const blocked: InboxItem = {
      entry: B,
      state: 'blocked',
      note: 'waits on pm',
      waitsFor: null,
      reply: 'pm-2600-0123abcd',
      markedAt: 3000,
    }

    expect(inboxReadText([blocked, unread(A)], false)).toBe(
      [
        'pm-2000-89abcdef [blocked] ticket from pm: Ship it; note: waits on pm; reply: pm-2600-0123abcd',
        '',
        'be-1000-0123abcd [unread] note from be: Hi',
        '  Hello',
      ].join('\n'),
    )
  })

  test('read and awaiting items with a body show only their head line; all shows a done item as one line', () => {
    const read: InboxItem = { ...unread(B), state: 'read', markedAt: 3000 }
    const awaiting: InboxItem = { ...unread(A), state: 'awaiting', waitsFor: B.id, markedAt: 3000 }
    const done: InboxItem = { ...unread(B), state: 'done', note: 'merged', markedAt: 3000 }

    expect(inboxReadText([read, awaiting], false)).toBe(
      [
        'pm-2000-89abcdef [read] ticket from pm: Ship it',
        '',
        'be-1000-0123abcd [awaiting] note from be: Hi',
      ].join('\n'),
    )
    expect(inboxReadText([done], true)).toBe('pm-2000-89abcdef [done] ticket from pm: Ship it; note: merged')
  })

  test('by default done and rejected items are left out and counted on a last line; all lists every item', () => {
    const items: InboxItem[] = [unread(A), { ...unread(B), state: 'done' }, { ...unread(C), state: 'rejected' }]
    const shown = inboxReadText(items, false)
    const every = inboxReadText(items, true)

    expect(shown.split('\n').at(-1)).toBe(fill(inboxHiddenOf(2), { count: 2 }))
    expect([shown.includes(A.id), shown.includes(B.id), shown.includes(C.id)]).toEqual([true, false, false])
    expect([every.includes(B.id), every.includes(C.id)]).toEqual([true, true])
    expect(every).not.toContain(fill(inboxHiddenOf(2), { count: 2 }))
    expect(inboxReadText([{ ...unread(B), state: 'done' }], false)).toBe(
      `${fill(inboxHiddenOf(1), { count: 1 })}\n\n${IDLE_WAIT}`,
    )
  })

  test('an inbox of only done or rejected entries ends with the idle wait; an open, awaiting or blocked entry, or all, does not', () => {
    const done: InboxItem = { ...unread(B), state: 'done' }
    const rejected: InboxItem = { ...unread(C), state: 'rejected' }
    const every = inboxReadText([done], true)

    expect(inboxReadText([done, rejected], false)).toBe(`${fill(inboxHiddenOf(2), { count: 2 })}\n\n${IDLE_WAIT}`)
    expect(every).toContain(B.id)
    expect(every).not.toContain(IDLE_WAIT)
    expect(inboxReadText([{ ...unread(A), state: 'awaiting' }, done], false)).not.toContain(IDLE_WAIT)
    expect(inboxReadText([{ ...unread(A), state: 'blocked' }, done], false)).not.toContain(IDLE_WAIT)
  })

  test('an empty inbox gives one line', () => {
    expect(inboxReadText([], false)).toBe(`Your inbox is empty. ${IDLE_WAIT}`)
    expect(inboxReadText([], false)).toBe(PROMPTS.inboxEmpty)
  })

  test('the subject, the body and the note are shown cleaned', () => {
    const entry: InboxEntry = { ...A, subject: 'H\u202Ei', body: 'a\u200Bb' }
    const text = inboxReadText([{ ...unread(entry), note: 'n\u202Eo' }], true)

    expect(text).toBe(['be-1000-0123abcd [unread] note from be: Hi', '  ab', 'note: no'].join('\n'))
  })

  test('a body line of 1000 code points is shown whole after its indent, and a tab in a body line is kept', () => {
    const line = 'x'.repeat(1000)
    const entry: InboxEntry = { ...A, body: `${line}\n\tindented` }

    expect(inboxReadText([unread(entry)], true).split('\n').slice(1)).toEqual([`  ${line}`, '  \tindented'])
  })

  test('a note of 300 code points is shown whole; a stored note of 301 is cut to 299 and an ellipsis', () => {
    const note = 'n'.repeat(300)
    const head = 'be-1000-0123abcd [blocked] note from be: Hi; note: '
    const line = (held: string): string => inboxReadText([{ ...unread(A), state: 'blocked', note: held }], true)

    expect(line(note)).toBe(`${head}${note}`)
    expect(line(`${note}n`)).toBe(`${head}${'n'.repeat(299)}…`)
  })
})

describe('inboxReadText of the kind fields', () => {
  const VECTOR = { scope: 0.4, complexity: 0.6, risk: 0.3, effort: 0.5 }

  test('a superpowers task shows one line per field under its body, the method with the line not to ask', () => {
    const task: InboxEntry = {
      ...A,
      kind: 'task',
      ticketKey: 'PROJ-2',
      vector: VECTOR,
      use: { framework: 'superpowers' },
      specPath: 'docs/specs/PROJ-2.md',
      size: 0.6,
      large: true,
      planPath: 'docs/superpowers/plans/tl-PROJ-2.md',
      method: 'superpowers:subagent-driven-development',
    }
    const field = (name: string, value: string): string => fill(PROMPTS.inboxItemField, { field: name, value })
    const vector = fill(PROMPTS.inboxItemVector, VECTOR)

    expect(inboxReadText([unread(task)], true).split('\n')).toEqual([
      'be-1000-0123abcd [unread] task from be: Hi',
      '  Hello',
      field('ticketKey', 'PROJ-2'),
      field('vector', fill(PROMPTS.inboxItemSized, { vector, size: 0.6, sizeClass: 'large' })),
      field('use', 'superpowers'),
      field('specPath', 'docs/specs/PROJ-2.md'),
      field('planPath', 'docs/superpowers/plans/tl-PROJ-2.md'),
      field('method', fill(PROMPTS.inboxItemMethod, { method: 'superpowers:subagent-driven-development' })),
    ])
  })

  test('a ticket, a report and a brief show their fields; an empty list shows none', () => {
    const ticket: InboxEntry = { ...B, ticketKey: 'PROJ-2', scores: { scope: 0.3, risk: 0.9 }, pin: 'large' }
    const report: InboxEntry = {
      ...C,
      outcome: 'done',
      vector: VECTOR,
      frameworkUsed: 'gsd',
      docPaths: ['a.md', 'cadre-be'],
      openQuestions: [],
    }
    const gsdTask: InboxEntry = { ...A, kind: 'task', use: { framework: 'gsd', gsdPath: 'phase' } }
    const brief: InboxEntry = { ...A, mode: 'gsd-epic', tickets: ['PROJ-2', 'PROJ-3'] }
    const field = (name: string, value: string): string => fill(PROMPTS.inboxItemField, { field: name, value })
    const linesOf = (entry: InboxEntry): string[] => inboxReadText([unread(entry)], true).split('\n')

    expect(linesOf(ticket).slice(3)).toEqual([
      field('ticketKey', 'PROJ-2'),
      field('scores', fill(PROMPTS.inboxItemScores, { scope: 0.3, risk: 0.9 })),
      field('pin', 'large'),
    ])
    expect(linesOf(gsdTask).slice(2)).toEqual([field('use', fill(PROMPTS.inboxItemUseGsd, { gsdPath: 'phase' }))])
    expect(linesOf(report).slice(2)).toEqual([
      field('vector', fill(PROMPTS.inboxItemVector, VECTOR)),
      field('outcome', 'done'),
      field('frameworkUsed', 'gsd'),
      field('docPaths', 'a.md, cadre-be'),
      field('openQuestions', PROMPTS.inboxItemNone),
    ])
    expect(linesOf(brief).slice(2)).toEqual([field('mode', 'gsd-epic'), field('tickets', 'PROJ-2, PROJ-3')])
  })

  test('a task whose class a pin set shows the pinned class and the computed size on its vector line', () => {
    const task: InboxEntry = {
      ...A,
      kind: 'task',
      ticketKey: 'PROJ-2',
      vector: VECTOR,
      use: { framework: 'gsd', gsdPath: 'quick' },
      size: 0.6,
      large: false,
      pinned: 'small',
    }

    expect(inboxReadText([unread(task)], true).split('\n')[3]).toBe(
      'vector: scope 0.4, complexity 0.6, risk 0.3, effort 0.5; size small (pinned; computed 0.6)',
    )
  })

  test('a specPath at its cap of 200 is shown whole', () => {
    const specPath = `docs/${'a'.repeat(192)}.md`
    const task: InboxEntry = {
      ...A,
      kind: 'task',
      ticketKey: 'PROJ-2',
      vector: VECTOR,
      use: { framework: 'gsd', gsdPath: 'quick' },
      specPath,
    }
    const field = (name: string, value: string): string => fill(PROMPTS.inboxItemField, { field: name, value })

    expect(inboxReadText([unread(task)], true).split('\n').slice(2)).toEqual([
      field('ticketKey', 'PROJ-2'),
      field('vector', fill(PROMPTS.inboxItemVector, VECTOR)),
      field('use', fill(PROMPTS.inboxItemUseGsd, { gsdPath: 'quick' })),
      field('specPath', specPath),
    ])
  })

  test('changes are shown whole up to their cap, and every value is cleaned', () => {
    const changes = 'c'.repeat(CHANGES_MAX_CHARS)
    const report: InboxEntry = { ...C, changes, reason: 'R\u202Eeason', openQuestions: ['Why\u200B?', 'How?'] }
    const lines = inboxReadText([unread(report)], true).split('\n')
    const field = (name: string, value: string): string => fill(PROMPTS.inboxItemField, { field: name, value })

    expect(lines.slice(2)).toEqual([
      field('changes', changes),
      field('reason', 'Reason'),
      field('openQuestions', 'Why?; How?'),
    ])
  })
})

describe('the line cap', () => {
  test('the largest entry of every kind the stated caps allow fits the line cap of 32 KiB', () => {
    const role = 'r'.repeat(24)
    const id = `${'a'.repeat(64)}-${'9'.repeat(16)}-${'f'.repeat(8)}`
    const score = 0.30000000000000004
    const vector = { scope: score, complexity: score, risk: score, effort: score }
    const ticketKey = 'K'.repeat(TICKET_KEY_MAX_CHARS)
    const fieldsOf: Readonly<Record<MessageKind, InboxEntryFields>> = {
      ticket: {
        ticketKey,
        scores: { scope: score, risk: score },
        pin: 'large',
        reportForm: WIDE.repeat(REPORT_FORM_MAX_CHARS),
      },
      task: {
        ticketKey,
        vector,
        use: { framework: 'superpowers' },
        specPath: 's'.repeat(SPEC_PATH_MAX_CHARS),
        size: score,
        large: false,
        pinned: 'small',
        planPath: `${SP_PLAN_DIR}/${role}-${ticketKey}.md`,
        method: SP_METHOD,
      },
      report: {
        outcome: 'partial',
        changes: WIDE.repeat(CHANGES_MAX_CHARS),
        verification: WIDE.repeat(VERIFICATION_MAX_CHARS),
        vector,
        reason: WIDE.repeat(REASON_MAX_CHARS),
        frameworkUsed: 'superpowers',
        docPaths: Array.from({ length: LIST_MAX_ITEMS }, () => 'd'.repeat(LIST_ITEM_MAX_CHARS)),
        openQuestions: Array.from({ length: LIST_MAX_ITEMS }, () => WIDE.repeat(LIST_ITEM_MAX_CHARS)),
      },
      question: {},
      answer: {},
      'epic-end': {},
      note: { mode: 'gsd-epic', tickets: Array.from({ length: TICKETS_MAX_ITEMS }, () => ticketKey) },
    }
    const sizes = MESSAGE_KINDS.map(kind => {
      const entry: InboxEntry = {
        v: 1,
        type: 'entry',
        id,
        at: Number.MAX_SAFE_INTEGER,
        from: role,
        to: role,
        kind,
        subject: WIDE.repeat(SUBJECT_MAX_CHARS),
        body: WIDE.repeat(BODY_MAX_CHARS),
        replyTo: id,
        ...fieldsOf[kind],
      }

      return utf8Bytes(recordLine(entry))
    })
    const largest = Math.max(...sizes)

    expect(sizes.filter(size => size > INBOX_LINE_MAX_BYTES)).toEqual([])
    expect(INBOX_LINE_MAX_BYTES).toBe(32768)
    expect(INBOX_LINE_MAX_BYTES < 2 * largest).toBe(true)
  })

  test('a line over the cap is refused with its size and its three largest fields; one under it is not', () => {
    const large: InboxEntry = { ...A, body: 'x'.repeat(40000) }
    const line = recordLine(large)

    expect(lineRefusal(A, recordLine(A))).toBeNull()
    expect(lineRefusal(large, line)).toBe(
      fill(PROMPTS.inboxLineTooLarge, { size: utf8Bytes(line), max: 32768, parts: 'body 40002, id 18, type 7' }),
    )
  })
})

describe('parseReadInput', () => {
  test('all is false and id null when absent; all must be true or false, and an id must be an entry id', () => {
    expect([parseReadInput({}), parseReadInput({ all: true }), parseReadInput(undefined)]).toEqual([
      { kind: 'ok', all: false, id: null },
      { kind: 'ok', all: true, id: null },
      { kind: 'ok', all: false, id: null },
    ])
    expect(parseReadInput({ id: A.id })).toEqual({ kind: 'ok', all: false, id: A.id })
    expect(parseReadInput({ all: 'yes' })).toEqual({ kind: 'error', message: PROMPTS.inboxAllNotBoolean })
    expect(parseReadInput({ id: 'not-an-id' })).toEqual({ kind: 'error', message: PROMPTS.inboxReadIdBad })
  })
})

describe('ticketPinOf', () => {
  test(
    'the pin of the last ticket of the key that carries one; unpinned when none does; ' +
      'no-ticket when no ticket has the key',
    () => {
      const large: InboxEntry = { ...B, ticketKey: 'PROJ-2', pin: 'large' }
      const small: InboxEntry = { ...B, id: 'pm-3000-89abcdef', at: 3000, ticketKey: 'PROJ-2', pin: 'small' }
      const unpinned: InboxEntry = { ...B, id: 'pm-4000-89abcdef', at: 4000, ticketKey: 'PROJ-2' }
      const other: InboxEntry = { ...B, id: 'pm-5000-89abcdef', at: 5000, ticketKey: 'PROJ-3', pin: 'large' }
      const task: InboxEntry = { ...A, id: 'tl-6000-0123abcd', at: 6000, kind: 'task', ticketKey: 'PROJ-2' }

      expect(ticketPinOf([large, small, other, task], 'PROJ-2')).toBe('small')
      expect(ticketPinOf([large, small, unpinned], 'PROJ-2')).toBe('small')
      expect(ticketPinOf([large, unpinned], 'PROJ-2')).toBe('large')
      expect(ticketPinOf([unpinned], 'PROJ-2')).toBe('unpinned')
      expect(ticketPinOf([large, task], 'PROJ-9')).toBe('no-ticket')
      expect(ticketPinOf([task], 'PROJ-2')).toBe('no-ticket')
      expect(ticketPinOf([{ ...large, ticketKey: 'proj-2' }], 'PROJ-2')).toBe('no-ticket')
      expect(ticketPinOf([], 'PROJ-2')).toBe('no-ticket')
    },
  )
})

describe('foldInbox owner marks and replies', () => {
  test('a mark by a role that is not the receiver of the entry is ignored', () => {
    expect(foldInbox([A, { ...mark(A.id, 3000, 'done', { note: 'merged' }), by: 'pm' }])).toEqual([unread(A)])
  })

  test('an awaiting mark links the first later entry that replies to what it waits for', () => {
    const waitsFor = B.id
    const reply: InboxEntry = { ...C, id: 'qa-4000-00ff00ff', at: 4000, replyTo: waitsFor }
    const later: InboxEntry = { ...reply, id: 'qa-5000-00ff00ff', at: 5000 }
    const events = [A, reply, mark(A.id, 3000, 'awaiting', { waitsFor }), { ...reply, id: 'qa-3500-00ff00ff' }, later]

    expect(foldInbox(events).map(item => item.reply)).toEqual([
      'qa-3500-00ff00ff',
      null,
      null,
      null,
    ])
  })
})
