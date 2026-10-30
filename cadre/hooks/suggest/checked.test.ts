import { describe, expect, test } from 'claude-code/testing'

import { cappedErrors } from '../core/reply'
import { memIo, memWorld } from '../testkit'
import { checkedCompletion, invalidReply, NOT_JSON_ERROR } from './checked'
import type { Checked } from './checked'

describe('NOT_JSON_ERROR', () => {
  test('is the one error every reply check gives a model reply that is not JSON', () => {
    expect(NOT_JSON_ERROR).toBe('the reply is not JSON')
  })
})

describe('checkedCompletion (D-83, D-232)', () => {
  test('each attempt first sets the status line it is given, so a retry shows it again', async () => {
    const run = memIo(memWorld({ replies: ['not json', 'ok'] }), {})
    const parse = (reply: string): Checked<string> =>
      reply === 'ok' ? { kind: 'ok', value: reply } : { kind: 'invalid', errors: ['no'] }
    const value = await checkedCompletion(run.io, 'cadre: thinking…', 'system', () => 'prompt', parse, () => 'none')
    expect([value, run.progress, run.prompts.length]).toEqual(['ok', ['cadre: thinking…', 'cadre: thinking…'], 2])
  })
})

describe('invalidReply', () => {
  test('marks the reply invalid with its errors capped as cappedErrors caps them', () => {
    const errors = Array.from({ length: 25 }, (_, at) => `error ${at + 1}`)
    expect(invalidReply(errors)).toEqual({ kind: 'invalid', errors: cappedErrors(errors) })
  })
})
