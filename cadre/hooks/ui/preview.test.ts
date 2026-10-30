import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, PaneKey, ShownBlock } from '../../types'
import { isObject } from '../core/json'
import { BIDI_OVERRIDE } from '../testkit'
import { wrapLine } from './pane'
import {
  answersFromNotes,
  askRewrite,
  fitPreview,
  MAX_PREVIEW_CHARS,
  OWN_ANSWER_HINT,
  previewColumns,
  previewMarkdown,
  PREVIEW_ROWS,
  withDescribeOwn,
  withPreviews,
} from './preview'
import type { AskedQuestion, CheckedQuestion } from './preview'

/** A block of the side pane with this key, title and lines, for the preview tests (D3). */
function shownBlock(key: PaneKey, title: string, lines: readonly string[]): ShownBlock {
  return { key, title, lines }
}

/** Whether a preview line is one of its fences: three or more backticks and nothing else. */
function isFence(line: string): boolean {
  return /^`{3,}$/.test(line)
}

/** `count` lines of 99 characters, each its own, for the cut tests: `<tag> <n>` padded with x. */
function longLines(tag: string, count: number): string[] {
  return Array.from({ length: count }, (_, at) => `${tag} ${at}`.padEnd(99, 'x'))
}

/** A line of 299 characters: 60 words of four letters, one space apart. */
const WIDE_LINE = Array.from({ length: 60 }, () => 'word').join(' ')

describe('previewColumns (D-231)', () => {
  test('the preview box is the terminal columns less 38, as the spike measured it: 122 at 160, 72 at 110', () => {
    expect([previewColumns(160), previewColumns(110), previewColumns(39)]).toEqual([122, 72, 1])
  })

  test('columns that leave no room, or are not a whole number, give none', () => {
    for (const columns of [38, 10, 0, -1, 80.5, Number.NaN]) expect(previewColumns(columns)).toBe(null)
  })
})

describe('previewMarkdown (D3)', () => {
  test('no blocks give no preview', () => {
    expect(previewMarkdown([])).toBe('')
  })

  test('each line wraps to the preview width, and with no width none is cut at 240 code points (D-231)', () => {
    const rows = previewMarkdown([shownBlock('review', 'Review', [WIDE_LINE])], 40).split('\n')
    expect(rows).toEqual(['**Review**', '```', ...wrapLine(WIDE_LINE, 40), '```'])
    expect(rows.every(row => Array.from(row).length <= 40)).toBe(true)
    expect(previewMarkdown([shownBlock('review', 'Review', [WIDE_LINE])]).split('\n')[2]).toBe(WIDE_LINE)
  })

  test('MAX_PREVIEW_CHARS still caps the whole preview once its lines are wrapped (D-231)', () => {
    const lines = Array.from({ length: 40 }, () => WIDE_LINE.slice(0, 99))
    const preview = previewMarkdown([shownBlock('review', 'Review', lines)], 30)
    expect(preview.length).toBeLessThanOrEqual(MAX_PREVIEW_CHARS)
    expect(preview.split('\n').at(-1)).toBe('…')
    expect(preview.split('\n').every(row => Array.from(row).length <= 30)).toBe(true)
  })

  test('each block is its bold title and its lines in a fence, in the given order, a blank line between', () => {
    const blocks = [
      shownBlock('review', 'Review', ['Roles:', '  BE (be)']),
      shownBlock('scan', 'Scan', ['  stack: ts']),
    ]
    expect(previewMarkdown(blocks).split('\n')).toEqual([
      '**Review**',
      '```',
      'Roles:',
      '  BE (be)',
      '```',
      '',
      '**Scan**',
      '```',
      '  stack: ts',
      '```',
    ])
  })

  test('a fence is one backtick longer than the longest backtick run of its block, and at least three', () => {
    const blocks = [
      shownBlock('scan', 'Scan', ['run ``` here', 'and `` there']),
      shownBlock('roles', 'Roles', ['two `` only']),
    ]
    expect(previewMarkdown(blocks).split('\n')).toEqual([
      '**Scan**',
      '````',
      'run ``` here',
      'and `` there',
      '````',
      '',
      '**Roles**',
      '```',
      'two `` only',
      '```',
    ])
  })

  test('a title has its markdown characters escaped with a backslash', () => {
    const title = 'a*b_c`d[e]f<g>h#i\\j~k|l'
    expect(previewMarkdown([shownBlock('scan', title, ['x'])]).split('\n')[0]).toBe(
      '**a\\*b\\_c\\`d\\[e\\]f\\<g\\>h\\#i\\\\j\\~k\\|l**',
    )
  })

  test('control characters in a title or a line are removed, so neither can add a line', () => {
    const bell = String.fromCharCode(7)
    const block = shownBlock('scan', `Sc\nan${BIDI_OVERRIDE}`, [`a\nb${bell}`, '  c'])
    expect(previewMarkdown([block]).split('\n')).toEqual(['**Scan**', '```', 'ab', '  c', '```'])
  })

  test('past the cap the preview is cut after a whole line, its fence closed, and ends with a … line', () => {
    const lines = longLines('review', 30)
    const preview = previewMarkdown([shownBlock('review', 'Review', lines), shownBlock('scan', 'Scan', ['x'])])
    const rows = preview.split('\n')
    expect(preview.length).toBeLessThanOrEqual(MAX_PREVIEW_CHARS)
    expect(rows.slice(-2)).toEqual(['```', '…'])
    expect(rows.filter(isFence)).toHaveLength(2)
    const kept = rows.slice(2, -2)
    expect(kept.length > 0 && kept.length < lines.length).toBe(true)
    expect(kept).toEqual(lines.slice(0, kept.length))
    expect(rows).not.toContain('**Scan**')
  })

  test('a block whose first line does not fit is left out with its title, after the closed block before it', () => {
    const lines = longLines('review', 18)
    const blocks = [shownBlock('review', 'Review', lines), shownBlock('scan', 'Scan', longLines('scan', 1))]
    const preview = previewMarkdown(blocks)
    expect(preview.length).toBeLessThanOrEqual(MAX_PREVIEW_CHARS)
    expect(preview.split('\n')).toEqual(['**Review**', '```', ...lines, '```', '…'])
  })

  test('every opened fence is closed and the preview stays under the cap, however many blocks there are', () => {
    const keys: PaneKey[] = ['scan', 'history', 'roles', 'recommendations', 'review', 'env', 'notes']
    const blocks = keys.map(key => shownBlock(key, key, longLines(key, 9)))
    const preview = previewMarkdown(blocks)
    const rows = preview.split('\n')
    expect(preview.length).toBeLessThanOrEqual(MAX_PREVIEW_CHARS)
    expect(rows.filter(isFence).length % 2).toBe(0)
    expect(rows.at(-1)).toBe('…')
    const kept = rows.filter(row => !isFence(row) && row !== '' && row !== '…' && !row.startsWith('**'))
    expect(kept).toEqual(blocks.flatMap(block => block.lines).slice(0, kept.length))
  })
})

/** One single-select AskUserQuestion question with two options and no preview, as a model asks it (D3). */
const PICK_QUESTION = {
  question: 'Pick one?',
  header: 'Pick',
  multiSelect: false,
  options: [
    { label: 'A', description: 'a' },
    { label: 'B', description: 'b' },
  ],
}

/** Questions whose shape withPreviews cannot check (D3, A1): a call that asks them passes through unchanged. */
const UNCHECKED_QUESTIONS: readonly unknown[] = [
  'x',
  {},
  null,
  undefined,
  [],
  ['x'],
  [null],
  [[]],
  [{ options: [{ label: 'A' }] }],
  [{ question: 3, options: [{ label: 'A' }] }],
  [{ question: 'Q?' }],
  [{ question: 'Q?', options: 'A' }],
  [{ question: 'Q?', options: [] }],
  [{ question: 'Q?', options: ['A'] }],
  [{ question: 'Q?', options: [null] }],
  [{ question: 'Q?', options: [{ description: 'a' }] }],
  [{ question: 'Q?', options: [{ label: 3 }] }],
  [PICK_QUESTION, { question: 'Q?', options: [] }],
]

/** PICK_QUESTION with these options after its A and B, each described by its label in lower case (A2). */
function pickWith(...labels: readonly string[]): CheckedQuestion {
  const more = labels.map(label => ({ label, description: label.toLowerCase() }))

  return { ...PICK_QUESTION, options: [...PICK_QUESTION.options, ...more] }
}

describe('withPreviews (D3)', () => {
  test('each option of a single-select question gets the preview, every other field kept, the input unchanged', () => {
    const questions = [PICK_QUESTION, { question: 'Next?', options: [{ label: 'C' }] }]
    const before = JSON.stringify(questions)
    const result = withPreviews(questions, () => 'P')
    expect(result).toEqual([
      {
        question: 'Pick one?',
        header: 'Pick',
        multiSelect: false,
        options: [
          { label: 'A', description: 'a', preview: 'P' },
          { label: 'B', description: 'b', preview: 'P' },
        ],
      },
      { question: 'Next?', options: [{ label: 'C', preview: 'P' }] },
    ])
    expect(JSON.stringify(questions)).toBe(before)
    expect(result === questions || result?.[0] === questions[0]).toBe(false)
  })

  test('a shape it cannot check gives null, so the call passes through', () => {
    for (const questions of UNCHECKED_QUESTIONS) expect(withPreviews(questions, () => 'P')).toBe(null)
  })

  test('only multi-select questions give null; one among single-select ones is copied unchanged', () => {
    const multi = { ...PICK_QUESTION, question: 'Which?', multiSelect: true }
    expect(withPreviews([multi], () => 'P')).toBe(null)
    const result = withPreviews([PICK_QUESTION, multi], () => 'P')
    expect(result?.[1]).toEqual(multi)
    expect(result?.[1] === multi).toBe(false)
    expect(result?.[0]?.options).toEqual([
      { label: 'A', description: 'a', preview: 'P' },
      { label: 'B', description: 'b', preview: 'P' },
    ])
  })

  test('an option that has a preview of its own keeps it', () => {
    const questions = [{ question: 'Q?', options: [{ label: 'A', preview: 'mine' }, { label: 'B' }] }]
    expect(withPreviews(questions, () => 'P')).toEqual([
      {
        question: 'Q?',
        options: [
          { label: 'A', preview: 'mine' },
          { label: 'B', preview: 'P' },
        ],
      },
    ])
  })

  test('each single-select question gets the preview made for its own header, undefined when it has none', () => {
    const questions = [PICK_QUESTION, { question: 'Next?', options: [{ label: 'C' }] }]
    const result = withPreviews(questions, header => `P ${String(header)}`)
    expect(result?.map(question => question.options)).toEqual([
      [
        { label: 'A', description: 'a', preview: 'P Pick' },
        { label: 'B', description: 'b', preview: 'P Pick' },
      ],
      [{ label: 'C', preview: 'P undefined' }],
    ])
  })
})

describe('withDescribeOwn (A2)', () => {
  /** The option a question with room for it gets, with the preview 'P'. */
  const OWN_OPTION = {
    label: 'Describe your own',
    description: 'Press n, type your answer, then Enter',
    preview: 'P',
  }

  test('a question with 2 or 3 options gets one last option to type an own answer, and the hint line (R3)', () => {
    const hinted = `Pick one?\n${OWN_ANSWER_HINT}`
    expect(withDescribeOwn(PICK_QUESTION, 'P')).toEqual({
      question: hinted,
      header: 'Pick',
      multiSelect: false,
      options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }, OWN_OPTION],
    })
    const three = withDescribeOwn(pickWith('C'), 'P')
    expect(three).toEqual({ ...pickWith('C'), question: hinted, options: [...pickWith('C').options, OWN_OPTION] })
  })

  test('a question with 4 options keeps them and gets the hint line as the last line of its text', () => {
    const four = pickWith('C', 'D')
    const hinted = 'Pick one?\nOr press n, type your own answer, then Enter.'
    expect(withDescribeOwn(four, 'P')).toEqual({ ...four, question: hinted })
  })

  test('a question that already has a Describe your own option gets no other one, but the hint line (R3)', () => {
    const two = { ...PICK_QUESTION, options: [{ label: 'A' }, { label: 'Describe your own', description: 'mine' }] }
    for (const question of [two, pickWith('C', 'Describe your own')]) {
      expect(withDescribeOwn(question, 'P')).toEqual({ ...question, question: `Pick one?\n${OWN_ANSWER_HINT}` })
    }
  })

  test('a question whose text already ends with the hint line does not get it a second time (R3)', () => {
    const hinted = `Pick one?\n${OWN_ANSWER_HINT}`
    expect(withDescribeOwn({ ...PICK_QUESTION, question: hinted }, 'P').question).toBe(hinted)
    const four = { ...pickWith('C', 'D'), question: hinted }
    expect(withDescribeOwn(four, 'P')).toEqual(four)
  })

  test("every 'under Other' reads 'as a note (press n)', and the hint line follows (R4)", () => {
    const question = { ...PICK_QUESTION, question: 'Type ids under Other.' }
    expect(withDescribeOwn(question, 'P').question).toBe(`Type ids as a note (press n).\n${OWN_ANSWER_HINT}`)
    const twice = { ...PICK_QUESTION, question: 'Pick under Other, or type ids under Other.' }
    const both = `Pick as a note (press n), or type ids as a note (press n).\n${OWN_ANSWER_HINT}`
    expect(withDescribeOwn(twice, 'P').question).toBe(both)
    expect(withDescribeOwn(PICK_QUESTION, 'P').question).toBe(`Pick one?\n${OWN_ANSWER_HINT}`)
  })

  test('the question it is given is never changed, and the result is a new object', () => {
    const other = { ...PICK_QUESTION, question: 'Type ids under Other.' }
    for (const question of [pickWith('C'), pickWith('C', 'D'), pickWith('C', 'Describe your own'), other]) {
      const before = JSON.stringify(question)
      const result = withDescribeOwn(question, 'P')
      expect(JSON.stringify(question)).toBe(before)
      expect(result === question).toBe(false)
    }
  })
})

/** The preview of each option of each question a dialog would show; undefined where an option has none. */
function optionPreviews(questions: readonly Record<string, unknown>[] | undefined): unknown[][] {
  return (questions ?? []).map(question => {
    const options: unknown = question.options

    return Array.isArray(options) ? options.map(option => (isObject(option) ? option.preview : undefined)) : []
  })
}

describe('askRewrite (A1, A2, D-203)', () => {
  /** The open question's own context, so every previewed option shows it whatever its header. */
  const CONTEXT: AskContext = { title: 'Review', lines: ['Roles:', '  BE (be)'], kind: 'review' }

  test('a question with no context gives null, so the call passes through with no preview (D-203)', () => {
    expect(askRewrite([PICK_QUESTION], null)).toBe(null)
  })

  test('a shape withPreviews cannot check gives null', () => {
    for (const questions of UNCHECKED_QUESTIONS) expect(askRewrite(questions, CONTEXT)).toBe(null)
  })

  test('only multi-select questions give null', () => {
    expect(askRewrite([{ ...PICK_QUESTION, multiSelect: true }], CONTEXT)).toBe(null)
  })

  test('a single-select question gets the preview on every option, Describe your own and the hint (R3)', () => {
    const questions = [PICK_QUESTION]
    const before = JSON.stringify(questions)
    const preview = previewMarkdown([CONTEXT])
    const hinted = `Pick one?\n${OWN_ANSWER_HINT}`
    const rewrite = askRewrite(questions, CONTEXT)
    expect(rewrite?.questions).toEqual([
      {
        ...PICK_QUESTION,
        question: hinted,
        options: [
          { label: 'A', description: 'a', preview },
          { label: 'B', description: 'b', preview },
          { label: 'Describe your own', description: 'Press n, type your answer, then Enter', preview },
        ],
      },
    ])
    expect(rewrite?.asked).toEqual([{ question: 'Pick one?', asked: hinted }])
    expect(JSON.stringify(questions)).toBe(before)
  })

  test('the asked entry of a 2-option question pairs its text as asked with the text shown (R3, R4)', () => {
    const shownText = `Type ids as a note (press n).\n${OWN_ANSWER_HINT}`
    const rewrite = askRewrite([{ ...PICK_QUESTION, question: 'Type ids under Other.' }], CONTEXT)
    expect(rewrite?.asked).toEqual([{ question: 'Type ids under Other.', asked: shownText }])
    expect(rewrite?.questions[0]?.question).toBe(shownText)
  })

  test('a 4-option question is asked with the hint line, and its asked entry pairs the two texts', () => {
    const hinted = 'Pick one?\nOr press n, type your own answer, then Enter.'
    const rewrite = askRewrite([pickWith('C', 'D')], CONTEXT)
    expect(rewrite?.asked).toEqual([{ question: 'Pick one?', asked: hinted }])
    expect(rewrite?.questions[0]?.question).toBe(hinted)
    expect(rewrite?.questions[0]?.options).toHaveLength(4)
  })

  test("a multi-select question among single-select ones is copied unchanged, 'under Other' kept, unasked", () => {
    const multi = { ...PICK_QUESTION, question: 'Which? Type more under Other.', multiSelect: true }
    const rewrite = askRewrite([PICK_QUESTION, multi], CONTEXT)
    expect(rewrite?.questions[1]).toEqual(multi)
    expect(rewrite?.questions[1] === multi).toBe(false)
    expect(rewrite?.asked).toEqual([{ question: 'Pick one?', asked: `Pick one?\n${OWN_ANSWER_HINT}` }])
  })

  test("every single-select question previews the open question's own context, whatever its header (D-203)", () => {
    const questions = [
      { ...PICK_QUESTION, header: 'Roles' },
      { ...PICK_QUESTION, question: 'Carry?', header: 'Env' },
    ]
    const preview = previewMarkdown([CONTEXT])
    expect(optionPreviews(askRewrite(questions, CONTEXT)?.questions)).toEqual([
      [preview, preview, preview],
      [preview, preview, preview],
    ])
  })

  test('each option previews its context wrapped to the width it is given (D-231)', () => {
    const context: AskContext = { title: 'Wide', lines: [WIDE_LINE], kind: 'review' }
    const preview = previewMarkdown([context], 40)
    expect(optionPreviews(askRewrite([PICK_QUESTION], context, 40)?.questions)).toEqual([[preview, preview, preview]])
    expect(preview.split('\n').slice(2, -1)).toEqual(wrapLine(WIDE_LINE, 40))
  })

  test('Topic i/n, Memory i/n and Git policy preview only their own context (G-02-16)', () => {
    const policies = [
      'Commit definitions: .cadre/ is committed except .cadre/*/.runtime/.',
      'Commit all: only per-user files are ignored.',
      'Ignore all: nothing in .cadre/ is committed.',
    ]
    const contexts: readonly AskContext[] = [
      { title: 'Topic 2 of 3', lines: ['Git and commits: How commits are made.', '  recommended: tl'], kind: 'topic' },
      { title: 'Memory 1 of 2', lines: ['squad.md: Unsigned commits on per-phase branches.'], kind: 'memory' },
      { title: 'Git policy', lines: policies, kind: 'git-policy' },
    ]
    for (const context of contexts) {
      const rewrite = askRewrite([{ ...PICK_QUESTION, header: context.title }], context)
      const [previews = []] = optionPreviews(rewrite?.questions)
      const lines = typeof previews[0] === 'string' ? previews[0].split('\n') : []
      expect([lines, new Set(previews).size]).toEqual([[`**${context.title}**`, '```', ...context.lines, '```'], 1])
    }
  })
})

describe('fitPreview (D-228)', () => {
  /** A context of `count` lines `line 1`, `line 2`, ... of `kind`. */
  function linesContext(count: number, kind: AskContext['kind'] = 'skills'): AskContext {
    return { title: 'Lines', lines: Array.from({ length: count }, (_, at) => `line ${at + 1}`), kind }
  }

  test('the preview fits the rows the spike measured on the main screen at 48 terminal rows', () => {
    expect(PREVIEW_ROWS).toBe(22)
  })

  test('a context that fits the rows keeps every line, and nothing overflows', () => {
    for (const count of [0, 1, PREVIEW_ROWS]) {
      const context = linesContext(count)
      expect(fitPreview(context, PREVIEW_ROWS)).toEqual({ lines: context.lines, isOverflow: false })
    }
  })

  test('a longer context keeps its first rows less one, then +N more above, and overflows', () => {
    const fitted = fitPreview(linesContext(30), 5)
    expect(fitted).toEqual({ lines: ['line 1', 'line 2', 'line 3', 'line 4', '+26 more above'], isOverflow: true })
    expect(fitPreview(linesContext(PREVIEW_ROWS + 1), PREVIEW_ROWS).lines.at(-1)).toBe('+2 more above')
  })

  test('the Review is kept whole, since it is paged instead (D-233)', () => {
    const review = linesContext(40, 'review')
    expect(fitPreview(review, 5)).toEqual({ lines: review.lines, isOverflow: false })
  })

  test('on the TUI default each option previews the fitted context (askRewrite with rows)', () => {
    const context = linesContext(30)
    const fitted = { ...context, lines: fitPreview(context, 5).lines }
    const preview = previewMarkdown([fitted])
    expect(optionPreviews(askRewrite([PICK_QUESTION], context, null, 5)?.questions)).toEqual([
      [preview, preview, preview],
    ])
    const whole = previewMarkdown([context])
    expect(optionPreviews(askRewrite([PICK_QUESTION], context)?.questions)).toEqual([[whole, whole, whole]])
  })
})

describe('answersFromNotes (A3)', () => {
  /** The one question these results answer, asked as the dialog showed it. */
  const ASKED: readonly AskedQuestion[] = [{ question: 'Q?', asked: 'Q?' }]

  /** A dialog result that answers Q? with `answer`, with `notes` typed for it when given. */
  function answered(answer: string, notes?: string): Record<string, unknown> {
    const result = { answers: { 'Q?': answer } }

    return notes === undefined ? result : { ...result, annotations: { 'Q?': { notes } } }
  }

  test('notes typed in the dialog are the answer, trimmed, whatever was chosen', () => {
    expect(answersFromNotes(ASKED, answered('A', '  my words  '))).toEqual({ 'Q?': 'my words' })
    expect(answersFromNotes(ASKED, answered('(notes only)', 'my words'))).toEqual({ 'Q?': 'my words' })
    expect(answersFromNotes(ASKED, answered('Describe your own', ' mine '))).toEqual({ 'Q?': 'mine' })
  })

  test('with blank or no notes the chosen answer stays, and Describe your own is an empty answer', () => {
    expect(answersFromNotes(ASKED, answered('B', '   '))).toEqual({ 'Q?': 'B' })
    expect(answersFromNotes(ASKED, answered('B'))).toEqual({ 'Q?': 'B' })
    expect(answersFromNotes(ASKED, answered('Describe your own'))).toEqual({ 'Q?': '' })
  })

  test('the answer is stored under the question as asked, and the text the dialog showed is dropped', () => {
    const asked = [{ question: 'Q?', asked: 'Q?\nhint' }]
    expect(answersFromNotes(asked, { answers: { 'Q?\nhint': 'C' } })).toEqual({ 'Q?': 'C' })
    const noted = { answers: { 'Q?\nhint': 'C' }, annotations: { 'Q?\nhint': { notes: 'mine' } } }
    expect(answersFromNotes(asked, noted)).toEqual({ 'Q?': 'mine' })
  })

  test("an answer to a question whose 'under Other' was rewritten is stored under the text as asked (R4)", () => {
    const shownText = `Type ids as a note (press n).\n${OWN_ANSWER_HINT}`
    const asked = [{ question: 'Type ids under Other.', asked: shownText }]
    expect(answersFromNotes(asked, { answers: { [shownText]: 'A' } })).toEqual({ 'Type ids under Other.': 'A' })
  })

  test('another question keeps its answer, and a question with no answer and no notes adds no key', () => {
    const both = { answers: { 'Q?': 'A', 'Other?': 'Describe your own' } }
    expect(answersFromNotes(ASKED, both)).toEqual({ 'Q?': 'A', 'Other?': 'Describe your own' })
    const other = answersFromNotes(ASKED, { answers: { 'Other?': 'X' } })
    expect(other === null ? null : Object.keys(other)).toEqual(['Other?'])
  })

  test('a malformed annotation counts as no notes, and only own keys are read', () => {
    for (const annotation of [null, { notes: 3 }, 'x']) {
      const result = { answers: { 'Q?': 'B' }, annotations: { 'Q?': annotation } }
      expect(answersFromNotes(ASKED, result)).toEqual({ 'Q?': 'B' })
    }
    const inherited = [
      { question: 'constructor', asked: 'constructor' },
      { question: 'toString', asked: 'toString' },
    ]
    const none = answersFromNotes(inherited, { answers: {}, annotations: {} })
    expect(none === null ? null : Object.keys(none)).toEqual([])
  })

  test('a result whose shape does not validate gives null', () => {
    const bad: unknown[] = [
      'x',
      null,
      {},
      { answers: 'x' },
      { answers: [] },
      { answers: { 'Q?': 3 } },
      { answers: {}, annotations: 'x' },
      { answers: {}, annotations: [] },
    ]
    for (const result of bad) expect(answersFromNotes(ASKED, result)).toBe(null)
  })

  test('the result it reads is never changed', () => {
    const result = { answers: { 'Q?\nhint': 'C', 'Other?': 'X' }, annotations: { 'Q?\nhint': { notes: ' mine ' } } }
    const before = JSON.stringify(result)
    const answers = answersFromNotes([{ question: 'Q?', asked: 'Q?\nhint' }], result)
    expect(answers).toEqual({ 'Other?': 'X', 'Q?': 'mine' })
    expect(JSON.stringify(result)).toBe(before)
    expect(answers === result.answers).toBe(false)
  })
})
