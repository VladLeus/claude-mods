import { describe, expect, test } from 'claude-code/testing'

import { MIN_CLAUDE_VERSION, MIN_CLAUDE_VERSION_TEXT } from '../generate/launcher'

describe('the claude version floor (SHOULD 3)', () => {
  test('MIN_CLAUDE_VERSION_TEXT is MIN_CLAUDE_VERSION written with dots, so the floor has one value', () => {
    expect(MIN_CLAUDE_VERSION_TEXT).toBe(MIN_CLAUDE_VERSION.join('.'))
  })
})
