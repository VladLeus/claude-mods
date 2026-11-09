import { describe, expect, test } from 'claude-code/testing'

import type { RoleContext, TeamView } from '../../types'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import {
  BODY_MAX_CHARS,
  MESSAGE_KINDS,
  NOTE_MAX_CHARS,
  parseMarkInput,
  parseSendInput,
  SUBJECT_MAX_CHARS,
} from './send'

const BE: RoleContext = { id: 'be', root: '/repo' }
const TEAM: TeamView = { ids: ['pm', 'tl', 'be'], parents: { pm: null, tl: 'pm', be: 'tl' }, pm: 'pm' }
const NOTE = { to: 'tl', kind: 'note', subject: 'Hi', body: 'Hello' }

/** A character of four UTF-8 bytes and two UTF-16 units: one code point. */
const WIDE = '\u{1F600}'

/** The refusal of a send, null when it is accepted. */
function refusalOf(event: unknown): string | null {
  const input = parseSendInput(event, BE, TEAM)

  return input.kind === 'error' ? input.message : null
}

describe('parseSendInput', () => {
  test('each refusal names its field: to, kind, subject, body, replyTo', () => {
    const cases: readonly (readonly [unknown, string])[] = [
      [{ ...NOTE, to: undefined }, PROMPTS.inboxToMissing],
      [{ ...NOTE, to: 7 }, PROMPTS.inboxToNotText],
      [{ ...NOTE, to: 'qa' }, fill(PROMPTS.inboxToNotTeam, { ids: 'pm, tl, be' })],
      [{ ...NOTE, to: 'be' }, PROMPTS.inboxToSelf],
      [{ ...NOTE, kind: 'ping' }, fill(PROMPTS.inboxKindUnknown, { kinds: MESSAGE_KINDS.join(', ') })],
      [{ ...NOTE, subject: '' }, PROMPTS.inboxSubjectEmpty],
      [{ ...NOTE, subject: '\u200B\u0007\n' }, PROMPTS.inboxSubjectEmpty],
      [{ ...NOTE, body: '' }, PROMPTS.inboxBodyEmpty],
      [{ ...NOTE, body: WIDE.repeat(BODY_MAX_CHARS + 1) }, fill(PROMPTS.inboxBodyTooLong, { max: BODY_MAX_CHARS })],
      [{ ...NOTE, replyTo: 'not-an-entry' }, PROMPTS.inboxReplyToBad],
      [{ ...NOTE, replyTo: '' }, PROMPTS.inboxReplyToBad],
    ]

    expect(cases.map(([event]) => refusalOf(event))).toEqual(cases.map(([, message]) => message))
  })

  test('the subject loses invisible characters and turns line breaks into one space', () => {
    expect(parseSendInput({ ...NOTE, subject: 'A\u200Bb\nc' }, BE, TEAM)).toMatchObject({ kind: 'ok', subject: 'Ab c' })
    expect(parseSendInput({ ...NOTE, subject: 'a\r\nb' }, BE, TEAM)).toMatchObject({ subject: 'a b' })
  })

  test('a long subject is cut to its cap; a body at its cap in code points is kept whole', () => {
    const input = parseSendInput({ ...NOTE, subject: 'x'.repeat(200), body: WIDE.repeat(BODY_MAX_CHARS) }, BE, TEAM)
    const subject = input.kind === 'ok' ? input.subject : ''
    const body = input.kind === 'ok' ? input.body : ''

    expect(Array.from(subject)).toHaveLength(SUBJECT_MAX_CHARS)
    expect(body).toBe(WIDE.repeat(BODY_MAX_CHARS))
  })

  test('the body keeps line breaks and tabs, turns CR LF and CR into LF and drops other control characters', () => {
    const input = parseSendInput({ ...NOTE, body: 'a\r\nb\rc\td\u200Be\u0007f' }, BE, TEAM)

    expect(input).toMatchObject({ kind: 'ok', body: 'a\nb\nc\tdef' })
  })

  test('only the named keys are read: a sender, a tool name and any other key change nothing', () => {
    const extra = { ...NOTE, from: 'pm', tool: 'mcp__cadre__inbox_send', tool_use_id: 't1', agentId: 'a1', x: 1 }

    expect(parseSendInput(extra, BE, TEAM)).toEqual(parseSendInput(NOTE, BE, TEAM))
    expect(parseSendInput(NOTE, BE, TEAM)).toEqual({
      kind: 'ok',
      to: 'tl',
      kindName: 'note',
      subject: 'Hi',
      body: 'Hello',
      replyTo: null,
    })
  })

  test('ticket and epic-end are sent only by the PM stand-in; every other kind by any role', () => {
    const TL: RoleContext = { id: 'tl', root: '/repo' }
    const PM: RoleContext = { id: 'pm', root: '/repo' }
    const refusalFrom = (ctx: RoleContext, kind: string, team: TeamView = TEAM): string | null => {
      const input = parseSendInput({ ...NOTE, to: 'be', kind }, ctx, team)

      return input.kind === 'error' ? input.message : null
    }

    expect(['ticket', 'epic-end'].map(kind => refusalFrom(TL, kind))).toEqual([
      fill(PROMPTS.inboxKindPmOnly, { kind: 'ticket', pm: 'pm' }),
      fill(PROMPTS.inboxKindPmOnly, { kind: 'epic-end', pm: 'pm' }),
    ])
    expect(['ticket', 'epic-end'].map(kind => refusalFrom(PM, kind))).toEqual([null, null])
    const anyRole = ['report', 'note', 'question', 'answer']
    expect(anyRole.map(kind => refusalFrom(TL, kind))).toEqual([null, null, null, null])
    expect(refusalFrom(TL, 'ticket', { ...TEAM, pm: null })).toBe(fill(PROMPTS.inboxKindNoPm, { kind: 'ticket' }))
  })

  test('a replyTo that is an entry id is kept', () => {
    expect(parseSendInput({ ...NOTE, replyTo: 'tl-1000-0123abcd' }, BE, TEAM)).toMatchObject({
      replyTo: 'tl-1000-0123abcd',
    })
  })
})

describe('parseMarkInput', () => {
  const ID = 'be-1000-0123abcd'

  test('each refusal names its field: state, note, waitsFor', () => {
    const states = fill(PROMPTS.inboxMarkState, { states: 'read, awaiting, blocked, rejected, done' })
    const longNote = 'x'.repeat(NOTE_MAX_CHARS + 1)
    const cases: readonly (readonly [unknown, string])[] = [
      [{ id: ID, state: 'unread' }, states],
      [{ id: ID, state: 'ping' }, states],
      [{ id: ID, state: 'done' }, fill(PROMPTS.inboxMarkNoteNeeded, { state: 'done' })],
      [{ id: ID, state: 'rejected', note: '' }, fill(PROMPTS.inboxMarkNoteNeeded, { state: 'rejected' })],
      [{ id: ID, state: 'blocked', note: '\u200B\n' }, fill(PROMPTS.inboxMarkNoteNeeded, { state: 'blocked' })],
      [{ id: ID, state: 'done', note: longNote }, fill(PROMPTS.inboxMarkNoteTooLong, { max: NOTE_MAX_CHARS })],
      [{ id: ID, state: 'awaiting' }, PROMPTS.inboxMarkWaitsFor],
      [{ id: ID, state: 'awaiting', waitsFor: 'not-an-entry' }, PROMPTS.inboxMarkWaitsFor],
    ]
    const refusals = cases.map(([event]) => {
      const input = parseMarkInput(event)

      return input.kind === 'error' ? input.message : null
    })

    expect(refusals).toEqual(cases.map(([, message]) => message))
  })

  test('read takes no note; done keeps its note on one line; awaiting keeps its waitsFor; by is never read', () => {
    expect(parseMarkInput({ id: ID, state: 'read', by: 'pm' })).toEqual({
      kind: 'ok',
      id: ID,
      state: 'read',
      note: null,
      waitsFor: null,
    })
    expect(parseMarkInput({ id: ID, state: 'done', note: 'merged\nand shipped' })).toMatchObject({
      note: 'merged and shipped',
    })
    expect(parseMarkInput({ id: ID, state: 'awaiting', waitsFor: 'pm-2000-89abcdef' })).toMatchObject({
      waitsFor: 'pm-2000-89abcdef',
    })
  })
})
