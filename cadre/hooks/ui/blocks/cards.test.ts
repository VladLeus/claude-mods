import { describe, expect, test } from 'claude-code/testing'

import { STATUS_LABEL } from './cards'

describe('STATUS_LABEL', () => {
  test('names each status as the report shows it', () => {
    expect(STATUS_LABEL).toEqual({
      'in-use': 'in use',
      installed: 'installed',
      'not-found': 'not found',
      unsupported: 'unsupported',
    })
  })
})
