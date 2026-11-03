import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, ContextKind, OpenQuestion, PaneKey, ShownBlock } from '../../types'
import { ARTIFACT } from '../locales/artifact'
import type { EnKey } from '../locales/en'
import { keyLabel, labelOf } from '../locales/t'
import { BIDI_OVERRIDE } from '../testkit'
import {
  PANE_PAGE_ROWS,
  paneColumns,
  panePlacement,
  paneRows,
  paneSpans,
  paneView,
  questionPaneBlocks,
  questionScroll,
  withLoader,
  wrapLine,
} from './pane'
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

describe('wrapLine (D-231)', () => {
  test('a line longer than the width ends its row at the last space at or before the width', () => {
    expect(wrapLine('a b c d e f g h i j k l', 10)).toEqual(['a b c d e', 'f g h i j', 'k l'])
    expect(wrapLine('aaaa bbbbb ccc', 10)).toEqual(['aaaa bbbbb', 'ccc'])
    expect(wrapLine('fits in ten', 11)).toEqual(['fits in ten'])
  })

  test('a word longer than the width is cut at the width', () => {
    expect(wrapLine('abcdefghijklmnop', 5)).toEqual(['abcde', 'fghij', 'klmno', 'p'])
    expect(wrapLine('one twothreefourfive six', 8)).toEqual(['one', 'twothree', 'fourfive', 'six'])
  })

  test('no text is dropped: only the one space at each break is left out', () => {
    const line = Array.from({ length: 40 }, (_, at) => `w${at}`).join(' ')
    const rows = wrapLine(line, 17)
    expect(rows.every(row => Array.from(row).length <= 17)).toBe(true)
    expect(rows.join(' ')).toBe(line)
  })

  test('an indent is never a break, so no row is only spaces; an empty line is one empty row', () => {
    expect(wrapLine('    recommended: tl', 10)).toEqual(['    recomm', 'ended: tl'])
    expect(wrapLine('', 10)).toEqual([''])
  })

  test('a width under one, or not a whole number, keeps the line whole', () => {
    for (const columns of [0, -4, 2.5, Number.NaN]) expect(wrapLine('abc def', columns)).toEqual(['abc def'])
  })
})

describe('paneRows', () => {
  test('a block gives its title row, then one row per line', () => {
    const block: ShownBlock = { key: 'scan', title: 'Scan', lines: ['Repo scan (read-only):', '  stack: none'] }
    expect(paneRows([block], null)).toEqual([
      { text: 'Scan', isTitle: true },
      { text: 'Repo scan (read-only):', isTitle: false },
      { text: '  stack: none', isTitle: false },
    ])
  })

  test('one empty row parts two blocks, none comes after the last, and no blocks give no rows', () => {
    expect(paneRows([paneBlock('review', ['a']), paneBlock('scan', ['b'])], null)).toEqual([
      { text: 'review', isTitle: true },
      { text: 'a', isTitle: false },
      { text: '', isTitle: false },
      { text: 'scan', isTitle: true },
      { text: 'b', isTitle: false },
    ])
    expect(paneRows([], 60)).toEqual([])
  })

  test('every title and line is cleaned, so none can add a row or hide text; none is cut (T-02-48, D-231)', () => {
    const bell = String.fromCharCode(7)
    const long = 'x'.repeat(300)
    const rows = paneRows([{ key: 'scan', title: `Sc\nan${BIDI_OVERRIDE}`, lines: [`a\nb${bell}`, long] }], null)
    expect(rows.map(row => row.text)).toEqual(['Scan', 'ab', long])
    expect(rows.filter(row => CONTROL_OR_FORMAT.test(row.text) || row.text.includes('\n'))).toEqual([])
  })

  test('at 60 columns no row is longer than 60 code points; a 300-character line is several rows (D-231)', () => {
    const line = Array.from({ length: 60 }, () => 'word').join(' ')
    const title = `Conflict: ${'docs/'.repeat(14)}x.md`
    const rows = paneRows([{ key: 'review', title, lines: [line, 'short'] }], 60)
    expect(rows.every(row => Array.from(row.text).length <= 60)).toBe(true)
    expect(rows.filter(row => !row.isTitle).map(row => row.text)).toEqual([...wrapLine(line, 60), 'short'])
    expect(rows.filter(row => row.isTitle).map(row => row.text)).toEqual(wrapLine(title, 60))
    expect([rows.filter(row => row.isTitle).length, rows.filter(row => !row.isTitle).length]).toEqual([3, 6])
  })
})

describe('paneColumns (D-231)', () => {
  test('the body columns are read only when they are a whole number of at least one', () => {
    expect([paneColumns({ bodyColumns: 71 }), paneColumns({ bodyColumns: 1 })]).toEqual([71, 1])
    const invalid: unknown[] = [{}, null, undefined, 'x', { bodyColumns: 0 }, { bodyColumns: -3 }, { bodyColumns: 1.5 }]
    for (const props of [...invalid, { bodyColumns: '60' }, { bodyColumns: Number.POSITIVE_INFINITY }]) {
      expect(paneColumns(props)).toBe(null)
    }
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

  test('the styled labels come from the templates that build their rows (WE-S4)', () => {
    const recommended: readonly EnKey[] = [
      'init.answers.ownSkillRecommended',
      'ui.instructions.topicRows3',
      'ui.instructions.memoryRows2',
      'ui.context.topicContext3',
      'ui.context.memoryContext2',
    ]
    expect(recommended.map(key => keyLabel(key))).toEqual(recommended.map(() => 'recommended'))
    expect(keyLabel('plan.text.planSummary4')).toBe('Summary')
    expect(labelOf(ARTIFACT.cardTitle)).toBe('Scope card')
    expect(labelOf('a text with no field')).toBe('')
  })
})

/** The question cadre has open, asked with `context` (null for none), as register keeps it (D-203). */
function openWith(context: AskContext | null): OpenQuestion {
  return { question: 'Which roles get the sentry MCP server?', header: 'MCP', context, acceptsTyped: true }
}

describe('questionPaneBlocks (D-203)', () => {
  const blocks = [paneBlock('recommendations'), paneBlock('roles'), paneBlock('scan')]

  test('while a question with its own context is open, the pane holds that context only, as one block', () => {
    const lines = ['Source: session', 'Tools: none listed']
    const context: AskContext = { title: 'MCP: sentry', lines, kind: 'mcp-server' }
    expect(questionPaneBlocks(openWith(context), blocks)).toEqual([
      { key: 'notes', title: 'MCP: sentry', lines: ['Source: session', 'Tools: none listed'] },
    ])
  })

  test('between questions, or while a question with no context is open (a hunk), the newest block shows', () => {
    expect(questionPaneBlocks(null, blocks)).toEqual([blocks[0]])
    expect(questionPaneBlocks(openWith(null), blocks)).toEqual([blocks[0]])
    expect(questionPaneBlocks(null, [])).toEqual([])
  })

  test('a context of a kind a pane block has keeps that key; every other kind draws as notes', () => {
    const kinds: readonly ContextKind[] = [
      'scan',
      'roles',
      'review',
      'env',
      'instructions',
      'skills',
      'git-policy',
      'topic',
    ]
    const keys = kinds.map(kind => questionPaneBlocks(openWith({ title: 'T', lines: [], kind }), blocks)[0]?.key)
    expect(keys).toEqual(['scan', 'roles', 'review', 'env', 'instructions', 'skills', 'notes', 'notes'])
    expect(questionPaneBlocks(openWith({ title: 'T', lines: [], kind: 'history' }), [])[0]?.key).toBe('history')
    expect(questionPaneBlocks(openWith({ title: 'T', lines: [], kind: 'improver' }), [])[0]?.key).toBe('improver')
  })
})

describe('withLoader (D-257)', () => {
  const shown = [paneBlock('roles')]

  test('with no long step running, the blocks are drawn as they are', () => {
    expect(withLoader(shown, null)).toEqual(shown)
    expect(withLoader(shown, '')).toEqual(shown)
    expect(withLoader([], null)).toEqual([])
  })

  test('a running step draws its label first, as a title with no lines, then the blocks', () => {
    expect(withLoader(shown, 'cadre: scanning the repo…')).toEqual([
      { key: 'loader', title: 'cadre: scanning the repo…', lines: [] },
      paneBlock('roles'),
    ])
    expect(withLoader([], 'cadre: scanning the repo…')).toEqual([
      { key: 'loader', title: 'cadre: scanning the repo…', lines: [] },
    ])
  })

  test('the label is cleaned and not cut, so it cannot add a row or hide text (T-02.2-08)', () => {
    const long = `cadre: ${'x'.repeat(300)}`
    expect(withLoader([], `${long}${BIDI_OVERRIDE}\n`)[0]?.title).toBe(long)
  })

  test('it never changes the blocks it is given', () => {
    const blocks = [paneBlock('scan')]
    withLoader(blocks, 'cadre: scanning the repo…')
    expect(blocks).toEqual([paneBlock('scan')])
  })
})

describe('questionScroll (D-209)', () => {
  test('a question cadre opens while its pane is open scrolls the pane back to its start', () => {
    const toStart = { to: 'start', in: 'cadre-init', block: 'start' }
    const context: AskContext = { title: 'Review', lines: ['Summary: 3 create'], kind: 'review' }
    expect(questionScroll('cadre-init', openWith(context), true)).toEqual(toStart)
    expect(questionScroll('cadre-init', openWith(null), true)).toEqual(toStart)
  })

  test('each page ask of the review scrolls again, though its question text is the same (ASKED #19)', () => {
    const toStart = { to: 'start', in: 'cadre-init', block: 'start' }
    const second: AskContext = { title: 'Review (page 2 of 3)', lines: ['Scope card: PM (pm)'], kind: 'review' }
    const third: AskContext = { title: 'Review (page 3 of 3)', lines: ['Summary: 3 create'], kind: 'review' }
    const scrolls = [openWith(second), openWith(third)].map(open => questionScroll('cadre-init', open, true))
    expect(scrolls).toEqual([toStart, toStart])
  })

  test('a cleared question, or a run that has not opened the pane, scrolls nothing', () => {
    expect(questionScroll('cadre-init', null, true)).toBe(null)
    expect(questionScroll('cadre-init', openWith(null), false)).toBe(null)
    expect(questionScroll('cadre-init', null, false)).toBe(null)
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

describe('PANE_PAGE_ROWS (D-233, ASKED #19)', () => {
  test('a page of the review on a pane surface is 20 rows: its title and 19 review lines', () => {
    expect(PANE_PAGE_ROWS).toBe(20)
  })
})

