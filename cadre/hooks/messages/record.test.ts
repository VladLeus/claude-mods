import { describe, expect, test } from 'claude-code/testing'

import type { InboxEntry, InboxItem, InboxMark, InboxState } from '../../types'
import { inboxHiddenOf, PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import {
  entryIdOf,
  foldInbox,
  inboxReadText,
  parseInbox,
  parseInboxLine,
  parseReadInput,
  parseSessionRecord,
  recordLine,
  sessionRecordText,
} from './record'

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
        '"subject":"Hi","body":"Hello","replyTo":"tl-900-89abcdef"}\n',
    )
    expect(recordLine(shuffled)).toBe(recordLine(entry))
    expect(recordLine(mark(A.id, 3000, 'done', { note: 'merged' }))).toBe(
      '{"v":1,"type":"mark","id":"be-1000-0123abcd","at":3000,"by":"tl","state":"done","note":"merged"}\n',
    )
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
  test('one block per item: its head, the body lines indented two spaces, then its note and reply lines', () => {
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
        'pm-2000-89abcdef [blocked] ticket from pm: Ship it',
        '  Line one',
        '  Line two',
        'note: waits on pm',
        'reply: pm-2600-0123abcd',
        '',
        'be-1000-0123abcd [unread] note from be: Hi',
        '  Hello',
      ].join('\n'),
    )
  })

  test('by default done and rejected items are left out and counted on a last line; all lists every item', () => {
    const items: InboxItem[] = [unread(A), { ...unread(B), state: 'done' }, { ...unread(C), state: 'rejected' }]
    const shown = inboxReadText(items, false)
    const every = inboxReadText(items, true)

    expect(shown.split('\n').at(-1)).toBe(fill(inboxHiddenOf(2), { count: 2 }))
    expect([shown.includes(A.id), shown.includes(B.id), shown.includes(C.id)]).toEqual([true, false, false])
    expect([every.includes(B.id), every.includes(C.id)]).toEqual([true, true])
    expect(every).not.toContain(fill(inboxHiddenOf(2), { count: 2 }))
    expect(inboxReadText([{ ...unread(B), state: 'done' }], false)).toBe(fill(inboxHiddenOf(1), { count: 1 }))
  })

  test('an empty inbox gives one line', () => {
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
    const lastLine = (held: string): string | undefined =>
      inboxReadText([{ ...unread(A), state: 'blocked', note: held }], true).split('\n').at(-1)

    expect(lastLine(note)).toBe(`note: ${note}`)
    expect(lastLine(`${note}n`)).toBe(`note: ${'n'.repeat(299)}…`)
  })
})

describe('parseReadInput', () => {
  test('all is false when absent and must be true or false when given', () => {
    expect([parseReadInput({}), parseReadInput({ all: true }), parseReadInput(undefined)]).toEqual([
      { kind: 'ok', all: false },
      { kind: 'ok', all: true },
      { kind: 'ok', all: false },
    ])
    expect(parseReadInput({ all: 'yes' })).toEqual({ kind: 'error', message: PROMPTS.inboxAllNotBoolean })
  })
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
