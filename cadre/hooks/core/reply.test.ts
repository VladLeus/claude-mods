import { describe, expect, test } from 'claude-code/testing'

import { PROMPTS } from '../locales/prompts'
import { cappedErrors, MAX_REPLY_ERRORS, unfenced, withReplyErrors } from './reply'

describe('reply helpers (S7)', () => {
  test('unfenced takes off the one code fence and its json tag, then trims', () => {
    expect(unfenced('```json\n{}\n```')).toBe('{}')
  })

  test('cappedErrors keeps the first MAX_REPLY_ERRORS errors, then says there are more', () => {
    const errors = Array.from({ length: 21 }, (_, at) => `error ${at + 1}`)
    const kept = errors.slice(0, MAX_REPLY_ERRORS)
    expect(cappedErrors(errors, PROMPTS.moreErrors)).toEqual([...kept, 'more errors not shown'])
    expect(cappedErrors(kept, PROMPTS.moreErrors)).toEqual(kept)
    expect(MAX_REPLY_ERRORS).toBe(20)
  })

  test('withReplyErrors adds nothing with no errors, and the intro and one line per error with them', () => {
    expect(withReplyErrors(['a'], [], PROMPTS.replyErrorsIntro)).toBe('a')
    expect(withReplyErrors(['a'], ['e'], PROMPTS.replyErrorsIntro)).toBe(`a\n${PROMPTS.replyErrorsIntro}\n- e`)
  })
})
