import { describe, expect, test } from 'claude-code/testing'

import { allOrNull, keysOf, stableJson } from './json'

const VERSION = '0.2.0'

describe('allOrNull (02-GAPS-B3 S6)', () => {
  test('gives each value parsed, in order, or null when any one does not parse', () => {
    const isNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null)
    const calls: unknown[] = []
    const counted = (value: unknown): number | null => {
      calls.push(value)

      return isNumber(value)
    }

    expect(allOrNull([1, 2], value => value)).toEqual([1, 2])
    expect(allOrNull([1, 'x'], isNumber)).toBeNull()
    expect(allOrNull([], isNumber)).toEqual([])
    expect(allOrNull(['x', 1, 2], counted)).toBeNull()
    expect(calls).toEqual(['x'])
  })
})

describe('safety net: keysOf (A8)', () => {
  test('keysOf: the own key names of a plain object, never its values; [] for anything else', () => {
    expect(keysOf({ b: 1, a: { c: 2 } })).toEqual(['b', 'a'])
    expect([keysOf(['a']), keysOf(null), keysOf('ab')]).toEqual([[], [], []])
  })
})

describe('stableJson', () => {
  test('sorts the keys at every depth, keeps arrays in order and ends with a newline', () => {
    const value = { b: 1, a: { d: [2, { z: 1, y: 0 }], c: null } }

    expect(stableJson(value)).toBe(
      '{\n  "a": {\n    "c": null,\n    "d": [\n      2,\n      {\n        "y": 0,\n        "z": 1\n      }\n' +
        '    ]\n  },\n  "b": 1\n}\n',
    )
  })

  test('gives the same text whatever order the keys were added in', () => {
    const first = { schema: 1, files: [{ path: 'a', mode: 'file' }], cadreVersion: VERSION }
    const second = { cadreVersion: VERSION, files: [{ mode: 'file', path: 'a' }], schema: 1 }

    expect(stableJson(first)).toBe(stableJson(second))
  })

  test('orders keys by code unit, not by locale: capitals first', () => {
    const keys = Object.keys(JSON.parse(stableJson({ b: 1, B: 2, a: 3, A: 4 })))

    expect(keys).toEqual(['A', 'B', 'a', 'b'])
  })

  test('keeps an own key named __proto__ as a key', () => {
    const value = JSON.parse('{"a": 2, "__proto__": 1}')

    expect(stableJson(value)).toBe('{\n  "__proto__": 1,\n  "a": 2\n}\n')
  })

  test('writes a value that is not an object, and the empty containers, with one trailing newline', () => {
    expect(stableJson('a')).toBe('"a"\n')
    expect(stableJson(null)).toBe('null\n')
    expect(stableJson([])).toBe('[]\n')
    expect(stableJson({})).toBe('{}\n')
  })

  test('does not change the value it is given', () => {
    const value = Object.freeze({ b: Object.freeze([1]), a: 1 })

    expect(stableJson(value)).toBe('{\n  "a": 1,\n  "b": [\n    1\n  ]\n}\n')
    expect(Object.keys(value)).toEqual(['b', 'a'])
  })
})
