import { describe, expect, test } from 'claude-code/testing'

import type { PaneKey, ShownBlock } from '../../types'
import { reportText } from '../core/text'
import { BIDI_OVERRIDE } from '../testkit'
import { panePlacement, paneRows, paneSpans, paneView } from './pane'
import type { PaneRow, PaneSpan } from './pane'

/** A control, format, or line or paragraph separator character. A newline is the one a report may keep. */
const CONTROL_OR_FORMAT = /(?!\n)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

/** A side-pane block of this kind, titled with its key, holding these lines (by default one line named after it). */
function paneBlock(key: PaneKey, lines: readonly string[] = [`${key} line`]): ShownBlock {
  return { key, title: key, lines }
}

describe('paneView', () => {
  test('a new block goes first and the other blocks keep their order', () => {
    const scan = paneBlock('scan')
    const history = paneBlock('history')
    const roles = paneBlock('roles')
    expect(paneView([scan, history], roles)).toEqual([roles, scan, history])
  })

  test('a block shown again replaces the block of its key and moves to the top', () => {
    const roles = paneBlock('roles')
    const scan2 = paneBlock('scan', ['Repo scan (read-only):', '  stack: TypeScript'])
    expect(paneView([roles, paneBlock('scan')], scan2)).toEqual([scan2, roles])
    expect(paneView([], scan2)).toEqual([scan2])
  })

  test('it never changes the blocks it is given', () => {
    const blocks = [paneBlock('roles'), paneBlock('scan')]
    const before = JSON.stringify(blocks)
    paneView(blocks, paneBlock('roles', ['changed']))
    expect(JSON.stringify(blocks)).toBe(before)
  })

  test('a notes block shown again keeps the old notes before its own lines and goes first (S1)', () => {
    const notesA = paneBlock('notes', ['note 1'])
    const notesB = paneBlock('notes', ['note 2'])
    const scan = paneBlock('scan')
    const blocks = [notesA, scan]
    const before = JSON.stringify(blocks)
    const merged = { key: 'notes', title: notesB.title, lines: [...notesA.lines, ...notesB.lines] }
    expect(paneView(blocks, notesB)).toEqual([merged, scan])
    expect(JSON.stringify(blocks)).toBe(before)
  })

  test('the first notes block goes first, as any new block does (S1)', () => {
    const notesA = paneBlock('notes', ['note 1'])
    const scan = paneBlock('scan')
    expect(paneView([scan], notesA)).toEqual([notesA, scan])
  })

  test('a block of another key still replaces its own and moves to the top, above the notes (S1)', () => {
    const notesA = paneBlock('notes', ['note 1'])
    const scan = paneBlock('scan')
    const roles2 = paneBlock('roles', ['changed'])
    expect(paneView([notesA, paneBlock('roles'), scan], roles2)).toEqual([roles2, notesA, scan])
  })
})

describe('paneRows', () => {
  test('a block gives its title row, then one row per line', () => {
    expect(paneRows([{ key: 'scan', title: 'Scan', lines: ['Repo scan (read-only):', '  stack: none'] }])).toEqual([
      { text: 'Scan', isTitle: true },
      { text: 'Repo scan (read-only):', isTitle: false },
      { text: '  stack: none', isTitle: false },
    ])
  })

  test('one empty row parts two blocks, none comes after the last, and no blocks give no rows', () => {
    expect(paneRows([paneBlock('review', ['a']), paneBlock('scan', ['b'])])).toEqual([
      { text: 'review', isTitle: true },
      { text: 'a', isTitle: false },
      { text: '', isTitle: false },
      { text: 'scan', isTitle: true },
      { text: 'b', isTitle: false },
    ])
    expect(paneRows([])).toEqual([])
  })

  test('every title and line is cleaned as a report cell, so none can add a row or hide text (T-02-48)', () => {
    const bell = String.fromCharCode(7)
    const long = 'x'.repeat(300)
    const rows = paneRows([{ key: 'scan', title: `Sc\nan${BIDI_OVERRIDE}`, lines: [`a\nb${bell}`, long] }])
    expect(rows.map(row => row.text)).toEqual(['Scan', 'ab', reportText(long)])
    expect(rows.filter(row => CONTROL_OR_FORMAT.test(row.text) || row.text.includes('\n'))).toEqual([])
    expect(Array.from(rows[2]?.text ?? '')).toHaveLength(240)
  })
})

/** A pane row that is not a title, as paneRows gives every line of a block. */
function lineRow(text: string): PaneRow {
  return { text, isTitle: false }
}

/** Whether a span has a look of its own: a colour, bold or dim. */
function isStyled(span: PaneSpan): boolean {
  return span.color !== undefined || span.bold === true || span.dim === true
}

/**
 * The styled spans of a line row and the text all its spans join to, so a test pins the looks and the join without
 * depending on how the plain text between the styled spans is split.
 */
function looksOf(text: string): { readonly styled: PaneSpan[]; readonly joined: string } {
  const spans = paneSpans(lineRow(text))

  return { styled: spans.filter(isStyled), joined: spans.map(span => span.text).join('') }
}

/** Every row the paneSpans tests use, for the invariants that hold over all of them (D1). */
const SPAN_ROWS: readonly string[] = [
  '',
  'Review',
  '    [hard] edits only src/',
  '    [best-effort] asks before a push',
  '    [none] reads anything',
  '    [none]',
  '    [hard]x',
  '  create    .cadre/be/ROLE.md',
  '  change    .claude/settings.json',
  '  conflict  .cadre/fe/ROLE.md',
  '  leave     .cadre/pm/ROLE.md',
  '  hunk      x',
  '  create .cadre/x',
  '  stack: ts; frontend: react; backend: none',
  '  framework: GSD; model: opus + high; permission mode: default',
  '  hooks loaded by project settings: none',
  `${'a'.repeat(40)}: x`,
  `${'a'.repeat(41)}: x`,
  'Summary: 3 create, 1 change, 2 leave, 0 conflict, 0 hunks',
  'Summary: 12 create, 0 change, 0 leave, 0 conflict, 2 hunks (1 accepted)',
  '    recommended: be, fe',
  '    recommended: none',
  '    used 3 times; recommended: be',
  'Scope card: Backend (be)',
  'Roles:',
  'Repo scan (read-only):',
  '- tool for BE: why',
  '+ added line',
  'The model gave no usable recommendation: no role gets a skill unless you pick one.',
]

describe('paneSpans (D1)', () => {
  test('a title row is one bold span in the claude colour, whatever its text; an empty row has none', () => {
    expect(paneSpans({ text: 'Review', isTitle: true })).toEqual([{ text: 'Review', color: 'claude', bold: true }])
    expect(paneSpans({ text: 'Summary: 3', isTitle: true })).toEqual([
      { text: 'Summary: 3', color: 'claude', bold: true },
    ])
    expect(paneSpans(lineRow(''))).toEqual([])
  })

  test('a rule marker is success for hard, warning for best-effort and error for none, the rest plain', () => {
    expect(paneSpans(lineRow('    [hard] edits only src/'))).toEqual([
      { text: '    ' },
      { text: '[hard]', color: 'success' },
      { text: ' edits only src/' },
    ])
    expect(looksOf('    [best-effort] asks before a push')).toEqual({
      styled: [{ text: '[best-effort]', color: 'warning' }],
      joined: '    [best-effort] asks before a push',
    })
    expect(looksOf('    [none] reads anything').styled).toEqual([{ text: '[none]', color: 'error' }])
    expect(paneSpans(lineRow('    [none]'))).toEqual([{ text: '    ' }, { text: '[none]', color: 'error' }])
    expect(paneSpans(lineRow('    [hard]x'))).toEqual([{ text: '    [hard]x' }])
  })

  test('a plan op row colours only its kind: create, change, conflict and leave', () => {
    expect(paneSpans(lineRow('  create    .cadre/be/ROLE.md'))).toEqual([
      { text: '  ' },
      { text: 'create', color: 'success' },
      { text: '    .cadre/be/ROLE.md' },
    ])
    expect(looksOf('  change    .claude/settings.json')).toEqual({
      styled: [{ text: 'change', color: 'warning' }],
      joined: '  change    .claude/settings.json',
    })
    expect(looksOf('  conflict  .cadre/fe/ROLE.md').styled).toEqual([{ text: 'conflict', color: 'error' }])
    expect(looksOf('  leave     .cadre/pm/ROLE.md').styled).toEqual([{ text: 'leave', dim: true }])
  })

  test('a hunk row and a kind not padded to the plan column get no op span', () => {
    expect(looksOf('  hunk      x').styled).toEqual([])
    expect(looksOf('  create .cadre/x').styled).toEqual([])
  })

  test('each field of a row has its label dim and its value plain', () => {
    expect(looksOf('  stack: ts; frontend: react; backend: none')).toEqual({
      styled: [
        { text: 'stack:', dim: true },
        { text: 'frontend:', dim: true },
        { text: 'backend:', dim: true },
      ],
      joined: '  stack: ts; frontend: react; backend: none',
    })
    expect(looksOf('  framework: GSD; model: opus + high; permission mode: default').styled).toEqual([
      { text: 'framework:', dim: true },
      { text: 'model:', dim: true },
      { text: 'permission mode:', dim: true },
    ])
    expect(looksOf('  hooks loaded by project settings: none').styled).toEqual([
      { text: 'hooks loaded by project settings:', dim: true },
    ])
  })

  test('a label has at most 40 code points', () => {
    expect(looksOf(`${'a'.repeat(40)}: x`).styled).toEqual([{ text: `${'a'.repeat(40)}:`, dim: true }])
    expect(paneSpans(lineRow(`${'a'.repeat(41)}: x`))).toEqual([{ text: `${'a'.repeat(41)}: x` }])
  })

  test('the summary has its label dim and each run of digits bold', () => {
    expect(looksOf('Summary: 3 create, 1 change, 2 leave, 0 conflict, 0 hunks')).toEqual({
      styled: [
        { text: 'Summary:', dim: true },
        { text: '3', bold: true },
        { text: '1', bold: true },
        { text: '2', bold: true },
        { text: '0', bold: true },
        { text: '0', bold: true },
      ],
      joined: 'Summary: 3 create, 1 change, 2 leave, 0 conflict, 0 hunks',
    })
    expect(looksOf('Summary: 12 create, 0 change, 0 leave, 0 conflict, 2 hunks (1 accepted)').styled).toEqual([
      { text: 'Summary:', dim: true },
      { text: '12', bold: true },
      { text: '0', bold: true },
      { text: '0', bold: true },
      { text: '0', bold: true },
      { text: '2', bold: true },
      { text: '1', bold: true },
    ])
  })

  test('the roles after recommended: are bold unless none, and so is the title of a scope card', () => {
    expect(looksOf('    recommended: be, fe')).toEqual({
      styled: [
        { text: 'recommended:', dim: true },
        { text: 'be, fe', bold: true },
      ],
      joined: '    recommended: be, fe',
    })
    expect(looksOf('    recommended: none').styled).toEqual([{ text: 'recommended:', dim: true }])
    expect(looksOf('    used 3 times; recommended: be')).toEqual({
      styled: [
        { text: 'recommended:', dim: true },
        { text: 'be', bold: true },
      ],
      joined: '    used 3 times; recommended: be',
    })
    expect(looksOf('Scope card: Backend (be)').styled).toEqual([
      { text: 'Scope card:', dim: true },
      { text: 'Backend (be)', bold: true },
    ])
  })

  test('a row whose colon follows no label is one plain span', () => {
    const rows = [
      'Roles:',
      'Repo scan (read-only):',
      '- tool for BE: why',
      '+ added line',
      'The model gave no usable recommendation: no role gets a skill unless you pick one.',
    ]
    for (const text of rows) expect(paneSpans(lineRow(text))).toEqual([{ text }])
  })

  test('the spans of every row join to its text, none is empty, and no row is dim as a whole', () => {
    for (const text of SPAN_ROWS) {
      for (const isTitle of [false, true]) {
        const spans = paneSpans({ text, isTitle })
        expect(spans.map(span => span.text).join('')).toBe(text)
        expect(spans.filter(span => span.text === '')).toEqual([])
        expect(spans.filter(span => span.dim === true && span.text === text)).toEqual([])
      }
    }
  })
})

describe('panePlacement (D3)', () => {
  test('the placement is read only when it is dock or inline', () => {
    expect(panePlacement({ placement: 'inline' })).toBe('inline')
    expect(panePlacement({ placement: 'dock' })).toBe('dock')
    for (const props of [{}, null, undefined, 'x', { placement: 3 }, { placement: 'Inline' }]) {
      expect(panePlacement(props)).toBe(null)
    }
  })
})
