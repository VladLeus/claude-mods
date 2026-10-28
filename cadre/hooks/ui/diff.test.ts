import { describe, expect, test } from 'claude-code/testing'

import { reportText } from '../core/text'
import { BIDI_OVERRIDE } from '../testkit'
import { diffLines, lineDiff } from './diff'

/** The lines of a text, numbered from `from`: `line <n>`, each ended by a line end. */
function numberedLines(count: number, from = 1): string {
  return Array.from({ length: count }, (_, at) => `line ${from + at}\n`).join('')
}

describe('lineDiff', () => {
  test('equal texts give no rows and no counts', () => {
    expect(lineDiff('a\nb\n', 'a\nb\n')).toEqual({ rows: [], added: 0, removed: 0 })
    expect(lineDiff('', '')).toEqual({ rows: [], added: 0, removed: 0 })
  })

  test('a line added or removed gives one row with its count', () => {
    expect(lineDiff('a\nc\n', 'a\nb\nc\n')).toEqual({ rows: [{ kind: 'added', line: 'b' }], added: 1, removed: 0 })
    expect(lineDiff('a\nb\nc\n', 'a\nc\n')).toEqual({ rows: [{ kind: 'removed', line: 'b' }], added: 0, removed: 1 })
  })

  test('a changed line is removed, then added, in text order, around the lines both texts keep', () => {
    expect(lineDiff('h\na\nb\nc\nd\n', 'h\na\nB\nc\nd\ne\n')).toEqual({
      rows: [
        { kind: 'removed', line: 'b' },
        { kind: 'added', line: 'B' },
        { kind: 'added', line: 'e' },
      ],
      added: 2,
      removed: 1,
    })
  })

  test('the longest run of common lines is kept: a moved line is removed where it was and added where it is', () => {
    expect(lineDiff('x\na\nb\nc\n', 'a\nb\nc\nx\n')).toEqual({
      rows: [
        { kind: 'removed', line: 'x' },
        { kind: 'added', line: 'x' },
      ],
      added: 1,
      removed: 1,
    })
  })

  test('texts that differ only in their last line end still give a row', () => {
    expect(lineDiff('a', 'a\n')).toEqual({ rows: [{ kind: 'added', line: '' }], added: 1, removed: 0 })
    expect(lineDiff('a\n', 'a')).toEqual({ rows: [{ kind: 'removed', line: '' }], added: 0, removed: 1 })
  })

  test('one change in a long text gives just that change: the common start and end are not compared', () => {
    const before = numberedLines(5000)
    const after = before.replace('line 2500\n', 'line 2500 changed\n')
    expect(lineDiff(before, after)).toEqual({
      rows: [
        { kind: 'removed', line: 'line 2500' },
        { kind: 'added', line: 'line 2500 changed' },
      ],
      added: 1,
      removed: 1,
    })
  })

  test('two long texts with nothing in common count every line once, the removed ones first', () => {
    const diff = lineDiff(numberedLines(1500), numberedLines(1500, 2001))
    expect([diff.added, diff.removed, diff.rows.length]).toEqual([1500, 1500, 3000])
    expect(diff.rows.slice(0, 1500).every(row => row.kind === 'removed')).toBe(true)
    expect(diff.rows.slice(1500).every(row => row.kind === 'added')).toBe(true)
    expect([diff.rows[0], diff.rows[1500]]).toEqual([
      { kind: 'removed', line: 'line 1' },
      { kind: 'added', line: 'line 2001' },
    ])
  })

  test('past a million compared line pairs the differing middle counts as removed, then added (T-02-77)', () => {
    const xs = Array.from({ length: 1100 }, (_, at) => `x${at}\n`).join('')
    const ys = Array.from({ length: 1100 }, (_, at) => `y${at}\n`).join('')
    const huge = lineDiff(`${xs}c\n`, `c\n${ys}`)
    expect([huge.removed, huge.added, huge.rows.at(1100), huge.rows.at(1101)]).toEqual([
      1101,
      1101,
      { kind: 'removed', line: 'c' },
      { kind: 'added', line: 'c' },
    ])
    expect(lineDiff('x0\nc\n', 'c\ny0\n')).toEqual({
      rows: [
        { kind: 'removed', line: 'x0' },
        { kind: 'added', line: 'y0' },
      ],
      added: 1,
      removed: 1,
    })
  })
})

describe('diffLines', () => {
  test('each added line is a + row and each removed one a - row, cleaned as a report cell', () => {
    const bell = String.fromCharCode(7)
    const diff = lineDiff(`keep\nold${BIDI_OVERRIDE}\n`, `keep\nnew${bell}\n${'x'.repeat(300)}\n`)
    expect(diffLines(diff)).toEqual(['- old', '+ new', `+ ${reportText('x'.repeat(300))}`])
    expect(diffLines(lineDiff('a\n', 'a\n'))).toEqual([])
  })

  test('past 200 rows the first 200 are shown, then how many more changed lines there are', () => {
    const many = diffLines(lineDiff('', numberedLines(205)))
    expect(many).toHaveLength(201)
    expect(many.slice(0, 2)).toEqual(['+ line 1', '+ line 2'])
    expect(many.at(-1)).toBe('... 5 more changed lines')
    expect(diffLines(lineDiff('', numberedLines(201))).at(-1)).toBe('... 1 more changed line')
    expect(diffLines(lineDiff('', numberedLines(200)))).toHaveLength(200)
  })
})
