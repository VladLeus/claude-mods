import { describe, expect, test } from 'claude-code/testing'

import { epicKeyOf, epicSlug } from './key'

describe('epic keys and slugs (D-162)', () => {
  test('a key drops one leading #, then is 1-32 letters, digits, - or _ starting with a letter or digit', () => {
    expect(epicKeyOf('#123')).toBe('123')
    expect(epicKeyOf('PROJ-1')).toBe('PROJ-1')
    expect(epicKeyOf('A'.repeat(33))).toBeNull()
    expect(epicKeyOf('a/b')).toBeNull()
    expect(epicKeyOf('-x')).toBeNull()
  })

  test('the slug is the key and title lowercased with one - per gap, cut at a - to at most 48 characters', () => {
    expect(epicSlug('PROJ-1', 'Add retry')).toBe('proj-1-add-retry')
    expect(epicSlug('PLATFORM-ENGINEERING', 'add retry to all outbound call')).toBe(
      'platform-engineering-add-retry-to-all-outbound',
    )
    expect(epicSlug('PROJ-1', 'ÉÀÜ éàü')).toBe('proj-1')
  })
})
