import { describe, expect, test } from 'claude-code/testing'

import type { InboxEntry, InboxMark, InboxState, PortStat } from '../../types'
import { utf8Bytes } from '../core/text'
import { CONTRACTS } from '../locales/contracts'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { parseInboxLine, recordLine } from './record'
import { inboxRotationOf, isInboxOverRotation } from './rotate'
import { BODY_MAX_CHARS, INBOX_LINE_MAX_BYTES, INBOX_ROTATE_BYTES } from './send'

/** An entry from tl to be with this id. */
function toBe(id: string): InboxEntry {
  return { v: 1, type: 'entry', id, at: 1000, from: 'tl', to: 'be', kind: 'note', subject: 'Hi', body: 'Hello' }
}

/** A mark by be on the entry with this id. */
function markByBe(id: string, state: Exclude<InboxState, 'unread'>): InboxMark {
  return { v: 1, type: 'mark', id, at: 2000, by: 'be', state, ...(state === 'awaiting' ? {} : { note: 'n' }) }
}

/** The body of the fresh entry a rotation of be's inbox at 1000 appends, read back from its line. */
async function freshBody(text: string | null): Promise<string> {
  const event = parseInboxLine((await inboxRotationOf('/repo', 'be', text, 1000)).text)

  return event?.type === 'entry' ? event.body : ''
}

describe('isInboxOverRotation', () => {
  test('only a regular file that is not a link and is over the threshold is rotated', () => {
    const file = (size: number, isLink = false): PortStat => ({ kind: 'file', size, isLink })
    const over = INBOX_ROTATE_BYTES + 1

    expect(isInboxOverRotation(file(over))).toBe(true)
    expect([
      isInboxOverRotation(null),
      isInboxOverRotation(file(over, true)),
      isInboxOverRotation({ kind: 'dir', size: over, isLink: false }),
      isInboxOverRotation(file(INBOX_ROTATE_BYTES)),
    ]).toEqual([false, false, false, false])
  })
})

describe('inboxRotationOf', () => {
  const A = toBe('tl-1000-0000000a')
  const B = toBe('tl-1000-0000000b')
  const C = toBe('tl-1000-0000000c')
  const D = toBe('tl-1000-0000000d')
  const text = [A, B, C, D, markByBe(B.id, 'done'), markByBe(C.id, 'rejected'), markByBe(D.id, 'awaiting')]
    .map(recordLine)
    .join('')

  test('the archive lies beside the inbox, and the fresh entry from cadre to the role lists the open ids', async () => {
    const rotation = await inboxRotationOf('/repo', 'be', text, 1000)
    const fresh = parseInboxLine(rotation.text)
    const body = await freshBody(text)

    expect(rotation.archive).toBe('/repo/.cadre/be/.runtime/inbox-1000.jsonl')
    expect(rotation.text.split('\n')).toEqual([rotation.text.slice(0, -1), ''])
    expect(fresh).toMatchObject({ type: 'entry', from: CONTRACTS.cadreSender, to: 'be', kind: 'note', at: 1000 })
    expect(fresh).toMatchObject({ subject: 'Inbox archived' })
    expect(body).toContain('768 KiB')
    expect(body).toContain('inbox-1000.jsonl')
    expect([A, B, C, D].map(entry => body.includes(entry.id))).toEqual([true, false, false, true])
  })

  test('with no open entry the ids slot says none', async () => {
    const closed = [B, markByBe(B.id, 'done')].map(recordLine).join('')

    expect(await freshBody(closed)).toBe(
      fill(PROMPTS.inboxRotatedBody, { max: 768, archive: 'inbox-1000.jsonl', ids: 'none' }),
    )
  })

  test('500 open entries list the first 40 in file order, count the rest, and stay within the send caps', async () => {
    // The longest id inbox_send stamps: a 24-character role id, a 16-digit time and the 8-hex hash.
    const from = 'x'.repeat(24)
    const idOf = (index: number): string => `${from}-${1e15 + index}-${index.toString(16).padStart(8, '0')}`
    const ids = Array.from({ length: 500 }, (_, index) => idOf(index))
    const many = ids.map(id => recordLine({ ...toBe(id), from })).join('')
    const rotation = await inboxRotationOf('/repo', 'be', many, 1000)
    const body = await freshBody(many)

    expect(body).toContain(`: ${ids.slice(0, 40).join(', ')} and 460 more.`)
    expect(body.includes(ids[40] ?? '')).toBe(false)
    expect(utf8Bytes(rotation.text)).toBeLessThanOrEqual(INBOX_LINE_MAX_BYTES)
    expect(Array.from(body).length).toBeLessThanOrEqual(BODY_MAX_CHARS)
  })

  test('an inbox that could not be read gives the unlisted text naming the archive', async () => {
    expect(await freshBody(null)).toBe(fill(PROMPTS.inboxRotatedUnlisted, { max: 768, archive: 'inbox-1000.jsonl' }))
  })
})
