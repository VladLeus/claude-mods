import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, PaneKey, ShownBlock } from '../../types'
import { isObject } from '../core/json'
import { BIDI_OVERRIDE } from '../testkit'
import { ASK_HEADERS, countedChip, PANE_TITLES } from './ask'
import {
  answersFromNotes,
  askedHeader,
  askRewrite,
  headerTopic,
  MAX_PREVIEW_CHARS,
  OWN_ANSWER_HINT,
  PREVIEW_BLOCKS,
  previewBlockFor,
  previewMarkdown,
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

describe('previewMarkdown (D3)', () => {
  test('no blocks give no preview', () => {
    expect(previewMarkdown([])).toBe('')
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

describe('headerTopic (B1)', () => {
  test('one counted suffix at the very end is stripped: i/n, or i of n as the hunk chip counts', () => {
    expect(headerTopic('Skill 3/7')).toBe('Skill')
    expect(headerTopic('Hunk 2 of 5')).toBe('Hunk')
    expect(headerTopic('Topic 10/12')).toBe('Topic')
  })

  test('a header with no counted suffix at its very end is kept as it is', () => {
    expect(headerTopic('Launch dir')).toBe('Launch dir')
    expect(headerTopic('Roles')).toBe('Roles')
    expect(headerTopic('v 2/3x')).toBe('v 2/3x')
  })

  test('a counted chip gives its word, and a chip too long to count is its bare word (countedChip)', () => {
    expect(headerTopic(countedChip('Memory', 2, 4))).toBe('Memory')
    expect(countedChip('Instructions', 1, 2)).toBe('Instructions')
    expect(headerTopic(countedChip('Instructions', 1, 2))).toBe('Instructions')
  })
})

describe('PREVIEW_BLOCKS (B1)', () => {
  test('the table and each of its lists are frozen, and each list holds one pane key or more', () => {
    const paneKeys: readonly string[] = Object.keys(PANE_TITLES)
    expect(Object.isFrozen(PREVIEW_BLOCKS)).toBe(true)
    for (const [topic, keys] of Object.entries(PREVIEW_BLOCKS)) {
      const isPaneKeys = keys.length > 0 && keys.every(key => paneKeys.includes(key))
      expect([topic, Object.isFrozen(keys), isPaneKeys]).toEqual([topic, true, true])
    }
  })

  test('every ASK_HEADERS chip is a topic but claude.json and Git policy; Skill, Topic, Regen are, Hunk is not', () => {
    const unmapped = Object.values(ASK_HEADERS).filter(header => !Object.hasOwn(PREVIEW_BLOCKS, header))
    expect(unmapped).toEqual(['claude.json', 'Git policy'])
    for (const topic of ['Skill', 'Topic', 'Regen']) expect(Object.hasOwn(PREVIEW_BLOCKS, topic)).toBe(true)
    expect(Object.hasOwn(PREVIEW_BLOCKS, 'Hunk')).toBe(false)
  })

  test('each topic lists the blocks its question is asked after, as the user locked them (B1)', () => {
    expect(PREVIEW_BLOCKS).toEqual({
      History: ['scan'],
      Roles: ['roles'],
      Adjust: ['roles'],
      Describe: ['roles'],
      Framework: ['roles'],
      Duration: ['roles'],
      Model: ['roles'],
      Launch: ['roles'],
      'Launch dir': ['roles'],
      Security: ['recommendations'],
      MCP: ['recommendations'],
      Skills: ['recommendations'],
      Skill: ['skills'],
      Instructions: ['instructions'],
      Topic: ['instructions'],
      Memory: ['instructions'],
      Regen: ['instructions'],
      Env: ['env'],
      Review: ['review'],
      Conflict: ['review'],
      Improver: ['improver', 'instructions'],
    })
  })
})

describe('previewBlockFor (B1)', () => {
  /** A pane of blocks with these keys, newest first, each titled by its key. */
  function paneOf(...keys: readonly PaneKey[]): ShownBlock[] {
    return keys.map(key => shownBlock(key, key, [`${key} line`]))
  }

  test('no blocks give none', () => {
    expect(previewBlockFor('Roles', [])).toEqual([])
  })

  test('a mapped header gives its block, wherever the pane holds it', () => {
    const pane = paneOf('review', 'roles', 'scan')
    expect(previewBlockFor('Roles', pane)).toEqual([pane[1]])
    const skills = paneOf('review', 'skills')
    expect(previewBlockFor('Skill 2/5', skills)).toEqual([skills[1]])
  })

  test('the improver question gives the improver block, else the instruction parts', () => {
    for (const pane of [paneOf('improver', 'instructions'), paneOf('instructions', 'improver')]) {
      expect(previewBlockFor('Improver', pane)).toEqual(pane.filter(block => block.key === 'improver'))
    }
    const parts = paneOf('review', 'instructions')
    expect(previewBlockFor('Improver', parts)).toEqual([parts[1]])
  })

  test('the newest block stands in for a header with no block in the pane, no key of its own, or no text', () => {
    const pane = paneOf('review', 'roles')
    for (const header of ['Env', 'Git policy', 3, undefined, '__proto__', 'constructor']) {
      expect(previewBlockFor(header, pane)).toEqual([pane[0]])
    }
  })
})

describe('askedHeader (R1)', () => {
  test('the header of the first question of the call', () => {
    expect(askedHeader([{ question: 'Q?', header: 'Roles', options: [] }])).toBe('Roles')
    const two = [
      { question: 'Q?', header: 'Roles', options: [] },
      { question: 'Next?', header: 'Env', options: [] },
    ]
    expect(askedHeader(two)).toBe('Roles')
  })

  test('no string header on the first question, or no list of questions, gives null', () => {
    const none: unknown[] = [
      [{ question: 'Q?', options: [] }],
      [{ question: 'Q?', header: 3, options: [] }],
      [null, { question: 'Next?', header: 'Env', options: [] }],
      [],
      'x',
      null,
      undefined,
    ]
    for (const questions of none) expect(askedHeader(questions)).toBe(null)
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
