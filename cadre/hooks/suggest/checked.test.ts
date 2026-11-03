import { describe, expect, test } from 'claude-code/testing'

import { cappedErrors } from '../core/reply'
import { PROMPTS } from '../locales/prompts'
import { memIo, memWorld } from '../testkit'
import { checkedCompletion, invalidReply, NOT_JSON_ERROR } from './checked'
import type { Checked } from './checked'

describe('NOT_JSON_ERROR', () => {
  test('is the one error every reply check gives a model reply that is not JSON', () => {
    expect(NOT_JSON_ERROR).toBe('the reply is not JSON')
  })
})

describe('checkedCompletion (D-83, D-232, D-301)', () => {
  /** A reply check that takes `ok` only. */
  const parse = (reply: string): Checked<string> =>
    reply === 'ok' ? { kind: 'ok', value: reply } : { kind: 'invalid', errors: ['no'] }

  test('each attempt first sets the status line it is given, so a retry shows it again', async () => {
    const run = memIo(memWorld({ replies: ['not json', 'ok'] }), {})
    const step = { label: 'cadre: thinking…', summary: null }
    const value = await checkedCompletion(run.io, step, 'system', () => 'prompt', parse, () => 'none')
    expect([value, run.progress, run.prompts.length]).toEqual(['ok', ['cadre: thinking…', 'cadre: thinking…'], 2])
  })

  test('each attempt sets the step summary beside its label, the same on a retry; none gives none', async () => {
    const run = memIo(memWorld({ replies: ['not json', 'ok'] }), {})
    const step = { label: 'cadre: thinking…', summary: '2 items' }
    await checkedCompletion(run.io, step, 'system', () => 'prompt', parse, () => 'none')
    const bare = memIo(memWorld({ replies: ['ok'] }), {})
    await checkedCompletion(bare.io, { ...step, summary: null }, 'system', () => 'prompt', parse, () => 'none')
    expect([run.progressSummaries, bare.progressSummaries]).toEqual([['2 items', '2 items'], [null]])
  })
})

describe('invalidReply', () => {
  test('marks the reply invalid with its errors capped as cappedErrors caps them', () => {
    const errors = Array.from({ length: 25 }, (_, at) => `error ${at + 1}`)
    expect(invalidReply(errors)).toEqual({ kind: 'invalid', errors: cappedErrors(errors, PROMPTS.moreErrors) })
  })
})
