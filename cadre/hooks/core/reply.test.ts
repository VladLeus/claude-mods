import { describe, expect, test } from 'claude-code/testing'

import { countedNoun, idsOrNone } from '../facts'
import { cappedErrors, MAX_REPLY_ERRORS, REPLY_ERRORS_INTRO, unfenced, withReplyErrors } from './reply'

describe('reply helpers (S7)', () => {
  test('unfenced takes off the one code fence and its json tag, then trims', () => {
    expect(unfenced('```json\n{}\n```')).toBe('{}')
  })

  test('cappedErrors keeps the first MAX_REPLY_ERRORS errors, then says there are more', () => {
    const errors = Array.from({ length: 21 }, (_, at) => `error ${at + 1}`)
    expect(cappedErrors(errors)).toEqual([...errors.slice(0, MAX_REPLY_ERRORS), 'more errors not shown'])
    expect(cappedErrors(errors.slice(0, MAX_REPLY_ERRORS))).toEqual(errors.slice(0, MAX_REPLY_ERRORS))
    expect(MAX_REPLY_ERRORS).toBe(20)
  })

  test('withReplyErrors adds nothing with no errors, and the intro and one line per error with them', () => {
    expect(withReplyErrors(['a'], [])).toBe('a')
    expect(withReplyErrors(['a'], ['e'])).toBe(`a\n${REPLY_ERRORS_INTRO}\n- e`)
  })
})

describe('facts helpers (S7)', () => {
  test('idsOrNone is none for no ids, else the ids joined with a comma', () => {
    expect(idsOrNone([])).toBe('none')
    expect(idsOrNone(['be', 'qa'])).toBe('be, qa')
  })

  test('countedNoun is singular for exactly one, plural otherwise', () => {
    expect(countedNoun(1, 'file', 'files')).toBe('1 file')
    expect(countedNoun(0, 'file', 'files')).toBe('0 files')
  })
})
