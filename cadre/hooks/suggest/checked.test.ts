import { describe, expect, test } from 'claude-code/testing'

import { NOT_JSON_ERROR } from './checked'

describe('NOT_JSON_ERROR', () => {
  test('is the one error every reply check gives a model reply that is not JSON', () => {
    expect(NOT_JSON_ERROR).toBe('the reply is not JSON')
  })
})
