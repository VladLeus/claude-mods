import { describe, expect, test } from 'claude-code/testing'

import { isRoleId, RESERVED_ROLE_IDS, ROLE_ID_PATTERN } from './role-id'

describe('ROLE_ID_PATTERN', () => {
  test('a lowercase slug of 1 to 24 characters is a role id', () => {
    expect(ROLE_ID_PATTERN.test('security')).toBe(true)
    expect(ROLE_ID_PATTERN.test('a-1')).toBe(true)
    expect(ROLE_ID_PATTERN.test('a')).toBe(true)
    expect(ROLE_ID_PATTERN.test('a'.repeat(24))).toBe(true)
  })

  test('a capital, a leading digit or hyphen, an underscore or a 25th character is not a role id', () => {
    expect(ROLE_ID_PATTERN.test('Be')).toBe(false)
    expect(ROLE_ID_PATTERN.test('1a')).toBe(false)
    expect(ROLE_ID_PATTERN.test('-a')).toBe(false)
    expect(ROLE_ID_PATTERN.test('a_b')).toBe(false)
    expect(ROLE_ID_PATTERN.test('a'.repeat(25))).toBe(false)
    expect(ROLE_ID_PATTERN.test('')).toBe(false)
  })

  test('a slash, a dot segment, a space or a line break can never be part of a role id', () => {
    expect(ROLE_ID_PATTERN.test('a/b')).toBe(false)
    expect(ROLE_ID_PATTERN.test('../x')).toBe(false)
    expect(ROLE_ID_PATTERN.test('..')).toBe(false)
    expect(ROLE_ID_PATTERN.test('a b')).toBe(false)
    expect(ROLE_ID_PATTERN.test('a\n')).toBe(false)
  })
})

describe('isRoleId', () => {
  test('bin, all and none are reserved: bin is the launcher folder, all and none are answer words', () => {
    expect(RESERVED_ROLE_IDS).toEqual(['bin', 'all', 'none'])
    expect(Object.isFrozen(RESERVED_ROLE_IDS)).toBe(true)
  })

  test('a slug that is not reserved is a role id', () => {
    for (const id of ['be', 'security', 'a-1', 'binary', 'nonexistent', 'allies']) expect(isRoleId(id)).toBe(true)
  })

  test('a reserved id, or anything that is not a slug, is not a role id', () => {
    for (const id of ['bin', 'all', 'none', 'Bin', 'ALL', '', '../x', 'a b', 'a'.repeat(25)]) {
      expect(isRoleId(id)).toBe(false)
    }
  })
})
