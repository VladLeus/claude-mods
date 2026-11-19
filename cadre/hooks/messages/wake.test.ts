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

  test('common punctuation maps to ASCII and quotes stay', () => {
    const wake = (subject: string): string => wakeText({ ...ENTRY, subject })
    const question = wake('which \u201cconnect\u201d asks?')

    expect(wake('KAN-3 report: partial \u2014 built and reviewed\u2026')).toContain(
      ': KAN-3 report: partial - built and reviewed... Read it with inbox_read.',
    )
    expect(wake('exactly today\u2019s')).toContain("exactly today's. Read it")
    expect(question).toContain('which "connect" asks? Read it')
    expect(question).not.toContain('?.')
    expect(wake('the \u2018fix\u2019 \u2013 done')).toContain("the 'fix' - done. Read it")
  })

  test('the method wake of a subject that ends in ! puts no period after it', () => {
    const method = 'superpowers:subagent-driven-development'
    const task: InboxEntry = { ...ENTRY, kind: 'task', ticketKey: 'PROJ-2', method, subject: 'Ship it!' }

    expect(wakeText(task)).toContain('! Read it with inbox_read and execute it with')
  })
})
