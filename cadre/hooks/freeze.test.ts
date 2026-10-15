import { describe, expect, test } from 'claude-code/testing'

import { freezeRows } from './freeze'

describe('freezeRows', () => {
  test('freezes the table and every row, keeping the rows in order', () => {
    const rows = freezeRows([{ id: 'a' }, { id: 'b' }])

    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(Object.isFrozen(rows)).toBe(true)
    expect(rows.every(row => Object.isFrozen(row))).toBe(true)
  })

  test('an empty table comes back frozen and empty', () => {
    const rows = freezeRows([])

    expect(rows).toEqual([])
    expect(Object.isFrozen(rows)).toBe(true)
  })
})
