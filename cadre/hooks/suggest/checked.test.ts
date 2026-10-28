import { describe, expect, test } from 'claude-code/testing'

import { cappedErrors } from '../core/reply'
import { invalidReply, NOT_JSON_ERROR } from './checked'

describe('NOT_JSON_ERROR', () => {
  test('is the one error every reply check gives a model reply that is not JSON', () => {
    expect(NOT_JSON_ERROR).toBe('the reply is not JSON')
  })
})

describe('invalidReply', () => {
  test('marks the reply invalid with its errors capped as cappedErrors caps them', () => {
    const errors = Array.from({ length: 25 }, (_, at) => `error ${at + 1}`)
    expect(invalidReply(errors)).toEqual({ kind: 'invalid', errors: cappedErrors(errors) })
  })
})
