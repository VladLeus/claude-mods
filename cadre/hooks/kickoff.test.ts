import { describe, expect, test } from 'claude-code/testing'

import {
  cleanKickoffText,
  cleanKickoffTextOr,
  DONE_MARKER_LINE,
  MAX_ROLE_CHARS,
  MAX_SPEC_PATH_CHARS,
  UNNAMED_ROLE,
} from './kickoff'

/** A character outside the BMP, which takes two UTF-16 units but is one code point. */
const ASTRAL = '\u{1F600}'

/** Matches a high surrogate with no low one after it, or a low surrogate with no high one before it. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

describe('kickoff constants', () => {
  test('the role cap is 40, the spec path cap is 260, and the role fallback is unnamed', () => {
    expect(MAX_ROLE_CHARS).toBe(40)
    expect(MAX_SPEC_PATH_CHARS).toBe(260)
    expect(UNNAMED_ROLE).toBe('unnamed')
  })
})

describe('cleanKickoffText', () => {
  test('each unsafe character is removed, whatever its class', () => {
    const unsafe = [
      '\u0085',
      '\u2028',
      '\u2029',
      '\v',
      '\f',
      '\r',
      '\n',
      '\u0007',
      '\u200B',
      '\u202E',
      '\u{E0041}',
      '\uD800',
      '\uDC00',
      '\uE000',
      '\u{F0000}',
    ]

    for (const char of unsafe) {
      expect(cleanKickoffText(`a${char}b`, MAX_ROLE_CHARS)).toBe('ab')
    }
  })

  test('safe text, spaces and astral characters are kept as they are', () => {
    expect(cleanKickoffText(`Backend Dev ${ASTRAL}`, MAX_ROLE_CHARS)).toBe(`Backend Dev ${ASTRAL}`)
  })

  test('text of exactly the role cap is kept whole, and one more code point is cut with an ellipsis', () => {
    expect(cleanKickoffText('r'.repeat(40), MAX_ROLE_CHARS)).toBe('r'.repeat(40))
    expect(cleanKickoffText('r'.repeat(41), MAX_ROLE_CHARS)).toBe(`${'r'.repeat(39)}\u{2026}`)
  })

  test('the role cap counts code points, so 40 astral characters are kept and 41 are cut', () => {
    const atCap = cleanKickoffText(ASTRAL.repeat(40), MAX_ROLE_CHARS)
    const overCap = cleanKickoffText(ASTRAL.repeat(41), MAX_ROLE_CHARS)

    expect(atCap).toBe(ASTRAL.repeat(40))
    expect(overCap).toBe(`${ASTRAL.repeat(39)}\u{2026}`)
    expect(LONE_SURROGATE.test(overCap)).toBe(false)
  })

  test('text of exactly the spec path cap is kept whole, and one more code point is cut with an ellipsis', () => {
    expect(cleanKickoffText('p'.repeat(260), MAX_SPEC_PATH_CHARS)).toBe('p'.repeat(260))
    expect(cleanKickoffText('p'.repeat(261), MAX_SPEC_PATH_CHARS)).toBe(`${'p'.repeat(259)}\u{2026}`)
  })

  test('the spec path cap counts code points, so 260 astral characters are kept and 261 are cut', () => {
    const atCap = cleanKickoffText(ASTRAL.repeat(260), MAX_SPEC_PATH_CHARS)
    const overCap = cleanKickoffText(ASTRAL.repeat(261), MAX_SPEC_PATH_CHARS)

    expect(atCap).toBe(ASTRAL.repeat(260))
    expect(Array.from(overCap).length).toBe(260)
    expect(overCap).toBe(`${ASTRAL.repeat(259)}\u{2026}`)
    expect(LONE_SURROGATE.test(overCap)).toBe(false)
  })

  test('unsafe characters are removed before the cap is counted', () => {
    expect(cleanKickoffText(`${'r'.repeat(40)}\u200B\u202E`, MAX_ROLE_CHARS)).toBe('r'.repeat(40))
  })
})

describe('cleanKickoffTextOr', () => {
  test('empty or whitespace-only text gives the fallback', () => {
    expect(cleanKickoffTextOr('', MAX_ROLE_CHARS, UNNAMED_ROLE)).toBe(UNNAMED_ROLE)
    expect(cleanKickoffTextOr(' \u{3000}\u{A0}', MAX_ROLE_CHARS, UNNAMED_ROLE)).toBe(UNNAMED_ROLE)
    expect(cleanKickoffTextOr('\t ', MAX_SPEC_PATH_CHARS, null)).toBeNull()
  })

  test('text that is only unsafe characters gives the fallback', () => {
    expect(cleanKickoffTextOr('\u200B\u202E\n\u0085', MAX_ROLE_CHARS, UNNAMED_ROLE)).toBe(UNNAMED_ROLE)
    expect(cleanKickoffTextOr('\u2028 \u2029', MAX_SPEC_PATH_CHARS, null)).toBeNull()
  })

  test('text with something left once cleaned is returned cleaned, untrimmed', () => {
    expect(cleanKickoffTextOr(' BE\n', MAX_ROLE_CHARS, UNNAMED_ROLE)).toBe(' BE')
  })
})

describe('DONE_MARKER_LINE', () => {
  test('it matches AUTOPILOT_DONE at a line start, after optional spaces or tabs', () => {
    expect(DONE_MARKER_LINE.test('AUTOPILOT_DONE')).toBe(true)
    expect(DONE_MARKER_LINE.test('x\n \tAUTOPILOT_DONE: ok')).toBe(true)
  })

  test('it does not match the marker inside a line or as part of a longer word', () => {
    expect(DONE_MARKER_LINE.test('answer with a line that starts with AUTOPILOT_DONE.')).toBe(false)
    expect(DONE_MARKER_LINE.test('AUTOPILOT_DONEX')).toBe(false)
  })
})
