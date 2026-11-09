import { describe, expect, test } from 'claude-code/testing'

import type { InboxEntry } from '../../types'
import { ROLE_LINE_MAX } from '../generate/kickoff'
import { SUBJECT_MAX_CHARS } from './send'
import { wakeText } from './wake'

const ENTRY: InboxEntry = {
  v: 1,
  type: 'entry',
  id: 'security-1000000000000-0123abcd',
  at: 1_000_000_000_000,
  from: 'security',
  to: 'tl',
  kind: 'epic-end',
  subject: 'Hi',
  body: 'Hello',
}

describe('wakeText', () => {
  test('the wake of a superpowers task names the method and stays one ASCII line within ROLE_LINE_MAX', () => {
    const method = 'superpowers:subagent-driven-development'
    const task: InboxEntry = { ...ENTRY, kind: 'task', ticketKey: 'PROJ-2', method }
    for (const subject of ['Add the endpoint', 'S'.repeat(SUBJECT_MAX_CHARS)]) {
      const text = wakeText({ ...task, subject })

      expect(text).toContain(method)
      expect(text).toContain(ENTRY.id)
      expect(/^[\x20-\x7E]*$/.test(text)).toBe(true)
      expect(text.length).toBeLessThanOrEqual(ROLE_LINE_MAX)
    }
    expect(wakeText(ENTRY)).not.toContain(method)
  })

  test('one line of printable ASCII within ROLE_LINE_MAX that holds the entry id and names inbox_read', () => {
    const subjects = ['Hi', 'S'.repeat(SUBJECT_MAX_CHARS), 'caf\u00e9 "quoted" `tick`\nnext line\u200B']
    for (const subject of subjects) {
      const text = wakeText({ ...ENTRY, subject })

      expect(/^[\x20-\x7E]*$/.test(text)).toBe(true)
      expect(text.length).toBeLessThanOrEqual(ROLE_LINE_MAX)
      expect(text).toContain(ENTRY.id)
      expect(text).toContain('inbox_read')
    }
  })
})
