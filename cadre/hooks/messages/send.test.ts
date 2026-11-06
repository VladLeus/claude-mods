import { describe, expect, test } from 'claude-code/testing'

import type { RoleContext, TeamView } from '../../types'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { BODY_MAX_CHARS, MESSAGE_KINDS, parseSendInput, SUBJECT_MAX_CHARS } from './send'

const BE: RoleContext = { id: 'be', root: '/repo' }
const TEAM: TeamView = { ids: ['pm', 'tl', 'be'], parents: { pm: null, tl: 'pm', be: 'tl' } }
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

  test('a replyTo that is an entry id is kept', () => {
    expect(parseSendInput({ ...NOTE, replyTo: 'tl-1000-0123abcd' }, BE, TEAM)).toMatchObject({
      replyTo: 'tl-1000-0123abcd',
    })
  })
})
