import { describe, expect, test } from 'claude-code/testing'

import {
  ENV_NAME_PATTERN,
  isSha256Hex,
  MAX_HEADING_CHARS,
  MAX_HOOK_NAME_CHARS,
  NAME_PATTERN,
  SHA256_HEX,
} from './names'

/** The SHA-256 of the empty text, as sha256Hex gives it: 64 lowercase hex characters. */
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('name rules (core/names)', () => {
  test('NAME_PATTERN takes a letter or digit, then up to 99 letters, digits or :_.@- characters', () => {
    const names = ['jira', 'gsd:plan-phase', 'skill@1.2.0', 'a.b_c', '7up', `a${'b'.repeat(99)}`]
    const refused = ['', '-a', ':a', 'a b', 'a/b', 'a\nb', `a${'b'.repeat(100)}`]

    for (const name of names) expect(NAME_PATTERN.test(name)).toBe(true)
    for (const name of refused) expect(NAME_PATTERN.test(name)).toBe(false)
  })

  test('ENV_NAME_PATTERN takes upper case letters, digits and underscores, no leading digit, at most 64', () => {
    const names = ['API_KEY', '_TOKEN', 'A1', `A${'B'.repeat(63)}`]
    const refused = ['', 'api_key', '1A', 'A-B', 'A B', `A${'B'.repeat(64)}`]

    for (const name of names) expect(ENV_NAME_PATTERN.test(name)).toBe(true)
    for (const name of refused) expect(ENV_NAME_PATTERN.test(name)).toBe(false)
  })

  test('a hook script basename and a part heading are capped at 80 characters each', () => {
    expect(MAX_HOOK_NAME_CHARS).toBe(80)
    expect(MAX_HEADING_CHARS).toBe(80)
  })

  test('a SHA-256 is exactly 64 lowercase hex characters, for isSha256Hex and SHA256_HEX alike', () => {
    const refused = [
      EMPTY_SHA256.toUpperCase(),
      EMPTY_SHA256.slice(1),
      `${EMPTY_SHA256}0`,
      `g${EMPTY_SHA256.slice(1)}`,
      '',
    ]

    expect([isSha256Hex(EMPTY_SHA256), SHA256_HEX.test(EMPTY_SHA256)]).toEqual([true, true])
    for (const text of refused) expect([isSha256Hex(text), SHA256_HEX.test(text)]).toEqual([false, false])
  })
})
