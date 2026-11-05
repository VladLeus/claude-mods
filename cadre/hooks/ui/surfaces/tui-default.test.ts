import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, OpenQuestion } from '../../../types'
import { isObject } from '../../core/json'
import { wrapLine } from '../pane'
import { PREVIEW_LINE_ROWS, previewMarkdown } from '../preview'
import { TUI_DEFAULT } from './tui-default'

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

/**
 * PICK_QUESTION as register keeps it open, with no context: it takes a typed answer, and so a note (D-234, D-270).
 */
const PICK_OPEN: OpenQuestion = {
  question: 'Pick one?',
  header: 'Pick',
  context: null,
  acceptsTyped: true,
  takesNote: true,
}

/** The open question's own context (D-203). */
const CONTEXT: AskContext = {
  title: 'Roles',
  lines: ['BE (be)', 'FE (fe)'],
  kind: 'roles',
  summary: '2 roles: be, fe',
}

/** The preview of each option of each question a dialog would show; undefined where an option has none. */
function optionPreviews(questions: readonly Record<string, unknown>[] | undefined): unknown[][] {
  return (questions ?? []).map(question => {
    const options: unknown = question.options

    return Array.isArray(options) ? options.map(option => (isObject(option) ? option.preview : undefined)) : []
  })
}

describe('TUI_DEFAULT.dialogPlan (WD-S2, D-353)', () => {
  test('a call whose first question is not the open question, by its exact text, gets no plan (D-239)', () => {
    const open: OpenQuestion = { ...PICK_OPEN, context: CONTEXT }
    for (const raw of [null, [], [{ question: 3, options: [] }], [{ ...PICK_QUESTION, question: 'Pick one? ' }]]) {
      expect(TUI_DEFAULT.dialogPlan(raw, open, null, null)).toBe(null)
    }
  })
})

describe('the TUI-default preview rows (WD-S3)', () => {
  /** A context of `count` lines `line 1`, `line 2`, ...: an own-skills list. */
  function linesContext(count: number): AskContext {
    return {
      title: 'Lines',
      lines: Array.from({ length: count }, (_, at) => `line ${at + 1}`),
      kind: 'skills',
      summary: `${count} lines`,
    }
  }

  test('with the title and marker rows counted, 21 lines show 19 and +2 more above; 20 fit whole (D-260)', () => {
    const cases: readonly (readonly [number, readonly string[]])[] = [
      [22, [...linesContext(19).lines, '+3 more above']],
      [21, [...linesContext(19).lines, '+2 more above']],
      [20, linesContext(20).lines],
    ]
    for (const [count, shown] of cases) {
      const context = linesContext(count)
      const open: OpenQuestion = { ...PICK_OPEN, context, acceptsTyped: false, takesNote: false }
      const plan = TUI_DEFAULT.dialogPlan([PICK_QUESTION], open, null, null)
      const [previews = []] = optionPreviews(plan?.questions ?? undefined)
      expect([count, previews[0]]).toEqual([count, previewMarkdown([{ ...context, lines: shown }])])
    }
  })
})

describe('the TUI-default preview by wrapped rows (D-260)', () => {
  test('a preview keeps the whole lines whose rows at its columns fit with the title and marker rows', () => {
    // 15 lines of 100 characters and no space: three rows each at 40 columns.
    const lines = Array.from({ length: 15 }, (_, at) => String(at).padStart(2, '0').padEnd(100, 'x'))
    const context: AskContext = { title: 'Lines', lines, kind: 'skills', summary: '15 lines' }
    const open: OpenQuestion = { ...PICK_OPEN, context, acceptsTyped: false, takesNote: false }
    const plan = TUI_DEFAULT.dialogPlan([PICK_QUESTION], open, null, 40)
    const [previews = []] = optionPreviews(plan?.questions ?? undefined)
    const shown = [...lines.slice(0, 6), '+9 more above']
    expect(previews[0]).toBe(previewMarkdown([{ ...context, lines: shown }], 40))
    const rows = 1 + shown.flatMap(line => wrapLine(line, 40)).length
    expect([rows <= PREVIEW_LINE_ROWS, rows + wrapLine(lines[6] ?? '', 40).length > PREVIEW_LINE_ROWS]).toEqual([
      true,
      true,
    ])
  })
})
