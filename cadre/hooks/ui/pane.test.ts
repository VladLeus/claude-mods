import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, ContextRow, ContextSection, OpenQuestion, PaneKey, PaneState, ShownBlock } from '../../types'
import { ARTIFACT } from '../locales/artifact'
import type { EnKey } from '../locales/en'
import { keyLabel, labelOf } from '../locales/t'
import { BIDI_OVERRIDE } from '../testkit'
import {
  contextPages,
  frameSize,
  MAX_PANE_FRAME_CHARS,
  MAX_PANE_FRAME_ROWS,
  PANE_FALLBACK_COLUMNS,
  PANE_PAGE_ROWS,
  paneBlockOf,
  paneColumns,
  paneDrawn,
  panePlacement,
  paneRows,
  paneSpans,
  questionScroll,
  wrapHanging,
  wrapLine,
} from './pane'
import type { DrawnRow, PaneBlock, PaneRow, PaneSpan } from './pane'

/** A control, format, or line or paragraph separator character. A newline is the one a report may keep. */
const CONTROL_OR_FORMAT = /(?!\n)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

/** A side-pane block of this kind, titled with its key, holding these lines (by default one line named after it). */
function paneBlock(key: PaneKey, lines: readonly string[] = [`${key} line`]): ShownBlock {
  return { key, title: key, lines }
}

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

describe('wrapHanging (D-312)', () => {
  const text = '  name: a long description that wraps over several rows of the pane, never cut'

  test('every row fits the width, each row after the first starts with the indent, and the words come back', () => {
    const rows = wrapHanging(text, 20, 2)
    expect(rows.length).toBeGreaterThan(3)
    expect(rows.every(row => Array.from(row).length <= 20)).toBe(true)
    expect(rows.slice(1).every(row => row.startsWith('  ') && row[2] !== ' ')).toBe(true)
    expect(rows.join(' ').split(' ').filter(word => word !== '')).toEqual(text.split(' ').filter(word => word !== ''))
  })

  test('the first row breaks as wrapLine does: an indent is never a break, a long word is cut at the width', () => {
    expect(wrapHanging('    recommended: tl', 10, 4)).toEqual(['    recomm', '    ended:', '    tl'])
    expect(wrapHanging('a b c d e f g h i j k l', 10, 0)).toEqual(wrapLine('a b c d e f g h i j k l', 10))
  })

  test('an indent as wide as the width leaves one column of text on each row after the first', () => {
    const rows = wrapHanging('aaaa bbbb', 4, 9)
    expect([rows[0], rows.slice(1).every(row => row === '   b'), rows.length]).toEqual(['aaaa', true, 5])
  })

  test('no width, a width under one or not whole keeps the text one row', () => {
    for (const columns of [null, 0, -4, 2.5, Number.NaN]) {
      expect(wrapHanging('abc def', columns, 2)).toEqual(['abc def'])
    }
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
    const rows = paneRows([{ title: `Sc\nan${BIDI_OVERRIDE}`, lines: [`a\nb${bell}`, long] }], null)
    expect(rows.map(row => row.text)).toEqual(['Scan', 'ab', long])
    expect(rows.filter(row => CONTROL_OR_FORMAT.test(row.text) || row.text.includes('\n'))).toEqual([])
  })

  test('at 60 columns no row is longer than 60 code points; a 300-character line is several rows (D-231)', () => {
    const line = Array.from({ length: 60 }, () => 'word').join(' ')
    const title = `Conflict: ${'docs/'.repeat(14)}x.md`
    const rows = paneRows([{ title, lines: [line, 'short'] }], 60)
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

  test('no row is read for a field any more: a label and its value draw as one plain run (D-313, D-322)', () => {
    for (const text of [
      '  stack: ts; frontend: react; backend: none',
      '  framework: GSD; model: opus + high; permission mode: default',
      '  hooks loaded by project settings: none',
      `${'a'.repeat(40)}: x`,
      '    recommended: be, fe',
      '    used 3 times; recommended: be',
    ]) {
      expect(paneSpans(lineRow(text))).toEqual([{ text }])
    }
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

  test('the title of a scope card has its label dim and its role bold (D-322)', () => {
    expect(paneSpans(lineRow('Scope card: Backend (be)'))).toEqual([
      { text: 'Scope card:', dim: true },
      { text: ' ' },
      { text: 'Backend (be)', bold: true },
    ])
    expect(paneSpans(lineRow('  Scope card: Backend (be)'))).toEqual([{ text: '  Scope card: Backend (be)' }])
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
  const question = 'Which roles get the sentry MCP server?'

  return { question, header: 'MCP', context, acceptsTyped: true, takesNote: true }
}

/** The pane state with `open` and `loader` (D-303). */
function stateOf(open: OpenQuestion | null, loader: PaneState['loader'] = null): PaneState {
  return { open, loader }
}

describe('paneBlockOf (D-299, D-301, D-303)', () => {
  const lines = ['Source: session', 'Tools: none listed']
  const context: AskContext = { title: 'MCP: sentry', lines, kind: 'mcp-server', summary: 'Recommended: none' }
  const loader = { label: 'cadre: scanning the repo…', summary: null }

  test('the idle state, no question open and no step running, draws nothing: the empty frame', () => {
    expect(paneBlockOf(stateOf(null))).toBe(null)
  })

  test('an open question draws its own context alone, its title and lines, even while a loader is set', () => {
    const block = { title: 'MCP: sentry', summary: null, rows: null, lines: ['Source: session', 'Tools: none listed'] }
    expect(paneBlockOf(stateOf(openWith(context)))).toEqual(block)
    expect(paneBlockOf(stateOf(openWith(context), loader))).toEqual(block)
  })

  test('a context with rows gives its summary and rows too, which the pane draws in place of its lines (D-313)', () => {
    const rows: readonly ContextSection[] = [{ title: null, rows: [{ role: 'plain', text: 'x', indent: 0 }] }]
    expect(paneBlockOf(stateOf(openWith({ ...context, rows })))).toEqual({
      title: 'MCP: sentry',
      summary: 'Recommended: none',
      rows,
      lines,
    })
  })

  test("a paged context gives its page too, whose marker the pane draws as the frame's last row (D-306, D-334)", () => {
    const rows: readonly ContextSection[] = [{ title: null, rows: [{ role: 'plain', text: 'x', indent: 0 }] }]
    const page = { index: 1, count: 3 }
    expect(paneBlockOf(stateOf(openWith({ ...context, rows, page })))).toEqual({
      title: 'MCP: sentry',
      summary: 'Recommended: none',
      rows,
      lines,
      page,
    })
  })

  test('an open question with no context draws nothing, never a block of an earlier step (D-299)', () => {
    expect(paneBlockOf(stateOf(openWith(null)))).toBe(null)
    expect(paneBlockOf(stateOf(openWith(null), loader))).toBe(null)
  })

  test('with no question open a running step draws its loader alone: its label as the title (D-301)', () => {
    const block = { title: 'cadre: scanning the repo…', summary: null, rows: null, lines: [] }
    expect(paneBlockOf(stateOf(null, loader))).toEqual(block)
  })

  test('a loader with a summary draws it as its one line under the label (D-301)', () => {
    const summary = '3 servers, 2 roles'
    const block = { title: loader.label, summary: null, rows: null, lines: [summary] }
    expect(paneBlockOf(stateOf(null, { ...loader, summary }))).toEqual(block)
  })

  test('the label and the summary are cleaned and not cut, so neither adds a row or hides text (T-02.2-08)', () => {
    const long = `cadre: ${'x'.repeat(300)}`
    const block = paneBlockOf(stateOf(null, { label: `${long}${BIDI_OVERRIDE}\n`, summary: `a\nb${BIDI_OVERRIDE}` }))
    expect(block).toEqual({ title: long, summary: null, rows: null, lines: ['ab'] })
  })

  test('it never changes the state it is given', () => {
    const state = stateOf(openWith(context), loader)
    const before = JSON.stringify(state)
    paneBlockOf(state)
    expect(JSON.stringify(state)).toBe(before)
  })
})

describe('questionScroll (D-209)', () => {
  test('a question cadre opens while its pane is open scrolls the pane back to its start', () => {
    const toStart = { to: 'start', in: 'cadre-init', block: 'start' }
    const context: AskContext = {
      title: 'Review',
      lines: ['Summary: 3 create'],
      kind: 'review',
      summary: '3 files, 1 role',
    }
    expect(questionScroll('cadre-init', openWith(context), true)).toEqual(toStart)
    expect(questionScroll('cadre-init', openWith(null), true)).toEqual(toStart)
  })

  test('each page ask of the review scrolls again, though its question text is the same (ASKED #19)', () => {
    const toStart = { to: 'start', in: 'cadre-init', block: 'start' }
    const second: AskContext = {
      title: 'Review (page 2 of 3)',
      lines: ['Scope card: PM (pm)'],
      kind: 'review',
      summary: '3 files, 1 role',
    }
    const third: AskContext = {
      title: 'Review (page 3 of 3)',
      lines: ['Summary: 3 create'],
      kind: 'review',
      summary: '3 files, 1 role',
    }
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


/** A block of `sections` under the title T, with `summary`, as the pane draws a context with rows (D-313). */
function rowsBlock(sections: readonly ContextSection[], summary: string | null = null): PaneBlock {
  return { title: 'T', summary, rows: sections, lines: [] }
}

/** The text each drawn row shows: its runs joined. */
function rowTexts(rows: readonly DrawnRow[]): string[] {
  return rows.map(row => row.spans.map(span => span.text).join(''))
}

describe('paneDrawn (D-313, D-322, D-323)', () => {
  /** A section of items and one of fields, a row of every role. */
  const SECTIONS: readonly ContextSection[] = [
    {
      title: 'Servers',
      rows: [
        { role: 'item', label: 'github', text: 'be, qa', indent: 2 },
        { role: 'description', text: 'session, 2 tools', indent: 4 },
        { role: 'item', label: 'sentry', text: 'none', indent: 2 },
        { role: 'placeholder', text: 'no description', indent: 4 },
      ],
    },
    {
      title: null,
      rows: [
        { role: 'heading', text: 'Changes:', indent: 0 },
        { role: 'field', label: 'Source', text: '.mcp.json', indent: 0 },
        { role: 'recommended', label: 'recommended', text: 'be', indent: 2 },
        { role: 'recommended', label: 'recommended', text: 'none', indent: 2 },
        { role: 'plain', text: 'Word: value', indent: 0 },
      ],
    },
  ]

  test('a block with rows draws its title, summary and sections, each row in the look of its role alone', () => {
    const block: PaneBlock = { title: 'MCP servers', summary: '2 servers, 1 recommended', rows: SECTIONS, lines: [] }
    expect(paneDrawn(block, null)).toEqual([
      { spans: [{ text: 'MCP servers', color: 'claude', bold: true }] },
      { spans: [{ text: '2 servers, 1 recommended', dim: true }] },
      { spans: [{ text: 'Servers', bold: true }] },
      { spans: [{ text: '  github → ' }, { text: 'be, qa', bold: true }] },
      { spans: [{ text: '    session, 2 tools' }] },
      { spans: [{ text: '  sentry → ' }, { text: 'none', dim: true }] },
      { spans: [{ text: '    ' }, { text: 'no description', dim: true }] },
      { spans: [] },
      { spans: [{ text: 'Changes:', bold: true }] },
      { spans: [{ text: 'Source: ', dim: true }, { text: '.mcp.json' }] },
      { spans: [{ text: '  ' }, { text: 'recommended: ', dim: true }, { text: 'be', bold: true }] },
      { spans: [{ text: '  ' }, { text: 'recommended: none', dim: true }] },
      { spans: [{ text: 'Word: value' }] },
    ])
  })

  test('a wrapped row keeps its look on every row, each continuation at the row indent (D-312)', () => {
    const roles = 'pm, tl, be, fe, qa, security, docs'
    const section: ContextSection = {
      title: null,
      rows: [{ role: 'recommended', label: 'recommended', text: roles, indent: 4 }],
    }
    const rows = paneDrawn(rowsBlock([section]), 24).slice(1)
    expect(rows).toEqual([
      { spans: [{ text: '    ' }, { text: 'recommended: ', dim: true }, { text: 'pm, tl,', bold: true }] },
      { spans: [{ text: '    ' }, { text: 'be, fe, qa,', bold: true }] },
      { spans: [{ text: '    ' }, { text: 'security, docs', bold: true }] },
    ])
  })

  test('hostile text draws one plain run per row and adds no row or look (T-02.2-27)', () => {
    const bell = String.fromCharCode(7)
    const text = `Word: value [none] x${BIDI_OVERRIDE}${bell}\nmore [hard] y`
    const section = { title: null, rows: [{ role: 'description', text, indent: 4 }] } satisfies ContextSection
    expect(paneDrawn(rowsBlock([section]), null).slice(1)).toEqual([
      { spans: [{ text: '    Word: value [none] xmore [hard] y' }] },
    ])
    const wrapped = paneDrawn(rowsBlock([section]), 16).slice(1)
    expect(wrapped.every(row => row.spans.length === 1 && Object.keys(row.spans[0] ?? {}).length === 1)).toBe(true)
    const words = rowTexts(wrapped).join(' ').split(' ').filter(word => word !== '')
    expect(words).toEqual('Word: value [none] xmore [hard] y'.split(' '))
  })

  test('a block with no rows draws its title and lines with the Review styling, as before (D-322)', () => {
    const lines = [
      'Summary: 3 create, 1 change',
      'Scope card: Backend (be)',
      '    [hard] edits only src/',
      '  create    .cadre/be/ROLE.md',
      '  skills: none',
    ]
    expect(paneDrawn({ title: 'Review', summary: null, rows: null, lines }, null)).toEqual([
      { spans: [{ text: 'Review', color: 'claude', bold: true }] },
      {
        spans: [
          { text: 'Summary:', dim: true },
          { text: ' ' },
          { text: '3', bold: true },
          { text: ' create, ' },
          { text: '1', bold: true },
          { text: ' change' },
        ],
      },
      { spans: [{ text: 'Scope card:', dim: true }, { text: ' ' }, { text: 'Backend (be)', bold: true }] },
      { spans: [{ text: '    ' }, { text: '[hard]', color: 'success' }, { text: ' edits only src/' }] },
      { spans: [{ text: '  ' }, { text: 'create', color: 'success' }, { text: '    .cadre/be/ROLE.md' }] },
      { spans: [{ text: '  skills: none' }] },
    ])
  })

  test('an item row with no text draws its name alone, no arrow or roles; one with a text keeps them (D-309)', () => {
    const section: ContextSection = {
      title: 'be: BE',
      rows: [
        { role: 'item', label: 'figma-desktop (not connected)', text: '', indent: 2 },
        { role: 'item', label: 'github', text: 'be', indent: 2 },
      ],
    }
    expect(paneDrawn(rowsBlock([section]), null).slice(1)).toEqual([
      { spans: [{ text: 'be: BE', bold: true }] },
      { spans: [{ text: '  figma-desktop (not connected)' }] },
      { spans: [{ text: '  github → ' }, { text: 'be', bold: true }] },
    ])
  })

  test('the title, the summary and a section title wrap to the width, none cut (D-231)', () => {
    const title = `Conflict: ${'docs/'.repeat(14)}x.md`
    const block: PaneBlock = { title, summary: 'a summary', rows: [{ title: 'Section', rows: [] }], lines: [] }
    const texts = rowTexts(paneDrawn(block, 30))
    expect(texts).toEqual([...wrapLine(title, 30), 'a summary', 'Section'])
  })
})

describe('the page marker (D-334)', () => {
  /** One section of one item with no description. */
  const sections: readonly ContextSection[] = [
    {
      title: 'Skills',
      rows: [
        { role: 'item', label: 'alpha', text: 'be', indent: 2 },
        { role: 'placeholder', text: 'no description', indent: 4 },
      ],
    },
  ]

  test('a paged block draws page i of n, dim, as its last row, after every row it draws unpaged', () => {
    const block = rowsBlock(sections, 'one skill')
    const drawn = paneDrawn({ ...block, page: { index: 1, count: 3 } }, null)
    expect(drawn.at(-1)).toEqual({ spans: [{ text: 'page 2 of 3', dim: true }] })
    expect(drawn.slice(0, -1)).toEqual(paneDrawn(block, null))
  })

  test('a block with no page draws no marker row', () => {
    const texts = rowTexts(paneDrawn(rowsBlock(sections, 'one skill'), null))
    expect(texts).toEqual(['T', 'one skill', 'Skills', '  alpha → be', '    no description'])
  })

  test('a paged block with no rows ends with the marker too, after its lines', () => {
    const block: PaneBlock = { title: 'T', summary: null, rows: null, lines: ['a line'], page: { index: 0, count: 2 } }
    expect(rowTexts(paneDrawn(block, null))).toEqual(['T', 'a line', 'page 1 of 2'])
  })
})

describe('frameSize (D-305)', () => {
  /** One skill under the title T, whose description of 20 four-letter words is two rows at 60 columns. */
  const block = rowsBlock(
    [
      {
        title: 'Skills',
        rows: [
          { role: 'item', label: 'alpha', text: 'be', indent: 2 },
          { role: 'description', text: 'abcd '.repeat(20).trim(), indent: 4 },
        ],
      },
    ],
    'one skill',
  )

  test('a frame is capped at 100 rows and 4,000 characters, and one of no known width is counted at 60 columns', () => {
    expect([MAX_PANE_FRAME_ROWS, MAX_PANE_FRAME_CHARS, PANE_FALLBACK_COLUMNS]).toEqual([100, 4_000, 60])
  })

  test('it counts the rows paneDrawn draws and their characters, wrapped at the width', () => {
    // T, one skill, Skills and `  alpha → be`, then the description: one row of 103 at 200 columns, 58 and 48 at 60.
    expect(frameSize(block, 200)).toEqual({ rows: 5, chars: 1 + 9 + 6 + 12 + 103 })
    expect(frameSize(block, 60)).toEqual({ rows: 6, chars: 1 + 9 + 6 + 12 + 58 + 48 })
    expect(frameSize(block, null)).toEqual(frameSize(block, PANE_FALLBACK_COLUMNS))
  })

  test('characters are counted in code points, and the page marker row is counted too (D-334)', () => {
    const faces = String.fromCodePoint(0x1f600).repeat(3)
    expect(frameSize(rowsBlock([{ title: null, rows: [{ role: 'plain', text: faces, indent: 0 }] }]), 60)).toEqual({
      rows: 2,
      chars: 4,
    })
    const paged = { ...block, page: { index: 0, count: 2 } }
    expect(frameSize(paged, 60)).toEqual({ rows: 7, chars: 1 + 9 + 6 + 12 + 58 + 48 + 11 })
  })
})

describe('contextPages (D-305, D-306, D-308)', () => {
  /** Item `name` given be, with a description of `words` four-letter words and a uses row under it. */
  function itemOf(name: string, words: number): ContextRow[] {
    return [
      { role: 'item', label: name, text: 'be', indent: 2 },
      { role: 'description', text: 'abcd '.repeat(words).trim(), indent: 4 },
      { role: 'plain', text: 'Used 3 times.', indent: 4 },
    ]
  }

  /** Items s0 onwards, `count` of them, each with a description of `words` words. */
  function itemsOf(count: number, words: number): ContextRow[] {
    return Array.from({ length: count }, (_, at) => itemOf(`s${at}`, words)).flat()
  }

  /** A context titled T, summed up as S, of `sections`. */
  function contextOf(sections: readonly ContextSection[]): AskContext {
    return { title: 'T', lines: [], kind: 'mcp-server', summary: 'S', rows: sections }
  }

  /** Whether each of `pages`, its marker drawn, fits both caps at `columns`. */
  function fitCaps(pages: readonly (readonly ContextSection[])[], columns: number | null): boolean {
    return pages.every((rows, index) => {
      const page = { index, count: pages.length }
      const size = frameSize({ title: 'T', summary: 'S', rows, lines: [], page }, columns)

      return size.rows <= MAX_PANE_FRAME_ROWS && size.chars <= MAX_PANE_FRAME_CHARS
    })
  }

  test('a context whose whole frame fits is one page of all its sections', () => {
    const sections = [{ title: 'Skills', rows: itemsOf(2, 3) }]
    expect(contextPages(contextOf(sections), null)).toEqual([sections])
  })

  test('a context over the row cap is pages that fit both caps with their marker, every row on one in order', () => {
    // 40 items of three rows each: 120 rows and the title, summary and section title.
    const rows = itemsOf(40, 3)
    const pages = contextPages(contextOf([{ title: 'Skills', rows }]), null)
    expect(pages.length).toBe(2)
    expect(fitCaps(pages, null)).toBe(true)
    expect(pages.flatMap(page => page.flatMap(section => section.rows))).toEqual(rows)
  })

  test('a context of few long rows over the character cap is paged too', () => {
    // 20 items with 194-character descriptions, one row each at 200 columns: 63 rows, but 4,498 characters.
    const context = contextOf([{ title: 'Skills', rows: itemsOf(20, 39) }])
    expect(frameSize({ title: 'T', summary: 'S', rows: context.rows ?? [], lines: [] }, 200)).toEqual({
      rows: 63,
      chars: 4_498,
    })
    const pages = contextPages(context, 200)
    expect(pages.length).toBe(2)
    expect(fitCaps(pages, 200)).toBe(true)
  })

  test('an item and the rows under it are never split; a page that goes on with a section repeats its title', () => {
    // 30 items of five rows each at 60 columns (a description of three rows): 19 fill the 96 rows a page has for them.
    const rows = itemsOf(30, 25)
    const sections = [
      { title: 'Skills', rows },
      { title: 'Agents', rows: itemOf('a0', 25) },
    ]
    const pages = contextPages(contextOf(sections), null)
    expect(pages.map(page => page.map(section => section.title))).toEqual([['Skills'], ['Skills', 'Agents']])
    expect(pages.map(page => page.map(section => section.rows.length))).toEqual([[19 * 3], [11 * 3, 3]])
    expect(pages.every(page => page.every(section => section.rows[0]?.role === 'item'))).toBe(true)
  })

  test('an item larger than a page alone is split into its rows, and a row too long alone into pieces (N-04)', () => {
    const huge = itemOf('huge', 1_000)
    const [item, about, used] = huge
    const rows = [...itemOf('a', 3), ...huge, ...itemOf('b', 3)]
    const pages = contextPages(contextOf([{ title: 'Skills', rows }]), null)
    const paged = pages.flatMap(page => page.flatMap(section => section.rows))
    const pieces = paged.slice(4, -4)
    expect([...paged.slice(0, 4), ...paged.slice(-4)]).toEqual([...itemOf('a', 3), item, used, ...itemOf('b', 3)])
    expect(pieces.length > 1 && pieces.every(row => row.role === 'description' && row.indent === 4)).toBe(true)
    expect([pieces.map(row => row.text).join(''), fitCaps(pages, null)]).toEqual([about?.text, true])
  })

  test('one row larger than a page alone is cut into pieces that each fit a frame, joined in order (N-04)', () => {
    const text = 'a'.repeat(9_000)
    for (const columns of [null, 60]) {
      const pages = contextPages(contextOf([{ title: null, rows: [{ role: 'plain', text, indent: 0 }] }]), columns)
      const pieces = pages.flatMap(page => page.flatMap(section => section.rows))
      expect([columns, pages.length > 1, fitCaps(pages, columns)]).toEqual([columns, true, true])
      expect(pieces.map(piece => piece.text).join('')).toBe(text)
    }
  })

  test('a field row too large alone keeps its role and label on its first piece; the rest are plain (N-04)', () => {
    const row: ContextRow = { role: 'field', label: 'plugins', text: 'p'.repeat(9_000), indent: 2 }
    const pages = contextPages(contextOf([{ title: null, rows: [row] }]), null)
    const pieces = pages.flatMap(page => page.flatMap(section => section.rows))
    const [first, ...rest] = pieces
    const isPlain = (piece: ContextRow): boolean =>
      piece.role === 'plain' && piece.indent === 2 && piece.label === undefined
    expect([first?.role, first?.label, first?.indent]).toEqual(['field', 'plugins', 2])
    expect([rest.length > 0, rest.every(isPlain), fitCaps(pages, null)]).toEqual([true, true, true])
    expect(pieces.map(piece => piece.text).join('')).toBe(row.text)
  })

  test('an item whose rows under it fill more than a page is split across pages row by row, none cut (N-04)', () => {
    const fields = Array.from({ length: 150 }, (_, at): ContextRow => {
      return { role: 'field', label: `f${at}`, text: 'value', indent: 4 }
    })
    const rows: ContextRow[] = [{ role: 'item', label: 'big', text: 'be', indent: 2 }, ...fields]
    const pages = contextPages(contextOf([{ title: 'Skills', rows }]), null)
    expect([pages.length > 1, fitCaps(pages, null)]).toEqual([true, true])
    expect(pages.flatMap(page => page.flatMap(section => section.rows))).toEqual(rows)
  })
})
