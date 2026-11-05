import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, OpenQuestion } from '../../../types'
import { askRewrite, PREVIEW_ROWS } from '../preview'
import type { CheckedQuestion } from '../preview'
import type { PaneSeat, SurfaceModule } from './contract'
import { NO_SURFACE } from './none'
import { PANE_DESKTOP } from './pane-desktop'
import { PANE_FULLSCREEN } from './pane-fullscreen'
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

/** PICK_QUESTION with these options after its A and B, each described by its label in lower case (A2). */
function pickWith(...labels: readonly string[]): CheckedQuestion {
  const more = labels.map(label => ({ label, description: label.toLowerCase() }))

  return { ...PICK_QUESTION, options: [...PICK_QUESTION.options, ...more] }
}

describe('the dialog plan of the surface modules (WD-S2, D-353)', () => {
  /** The label of the option that offers a change, as register passes CHANGE_SOMETHING_LABEL (ASKED #24). */
  const CHANGE_LABEL = 'Change it'
  /** The open question's own context (D-203). */
  const CONTEXT: AskContext = {
    title: 'Roles',
    lines: ['BE (be)', 'FE (fe)'],
    kind: 'roles',
    summary: '2 roles: be, fe',
  }
  /** A multi-select question asked after the open one; it is never previewed and has no note. */
  const MULTI = { ...PICK_QUESTION, question: 'Which ones? Type more under Other.', multiSelect: true }
  /**
   * What each surface module and pane seat does with the open question's dialog (D-208, D-234, ASKED #24, D-353):
   * preview it (the TUI default, with the rows its expected preview is fitted to, or a pane seated inline), map a note
   * typed in it (a docked or unknown pane seat, for a question that offers Change or takes a note, D-348), or nothing.
   */
  const SEATS: readonly (readonly [SurfaceModule, PaneSeat, 'preview' | 'note' | 'none', number | null])[] = [
    [TUI_DEFAULT, null, 'preview', PREVIEW_ROWS],
    [TUI_DEFAULT, 'dock', 'preview', PREVIEW_ROWS],
    [TUI_DEFAULT, 'inline', 'preview', PREVIEW_ROWS],
    [PANE_DESKTOP, 'inline', 'preview', null],
    [PANE_FULLSCREEN, 'inline', 'preview', null],
    [PANE_DESKTOP, 'dock', 'note', null],
    [PANE_FULLSCREEN, 'dock', 'note', null],
    [PANE_DESKTOP, null, 'note', null],
    [PANE_FULLSCREEN, null, 'note', null],
    [NO_SURFACE, null, 'none', null],
    [NO_SURFACE, 'dock', 'none', null],
    [NO_SURFACE, 'inline', 'none', null],
  ]
  /** Every context, typed-answer flag, change option and multi-select question a seat is asked with. */
  const CASES = [null, CONTEXT].flatMap(context =>
    [false, true].flatMap(acceptsTyped =>
      [false, true].flatMap(offersChange =>
        [false, true].map(hasMulti => ({ context, acceptsTyped, offersChange, hasMulti })),
      ),
    ),
  )

  test('the plan of each surface, seat, context, typed answer, change option and multi-select (D-239)', () => {
    for (const [surface, placement, seat, rows] of SEATS) {
      for (const { context, acceptsTyped, offersChange, hasMulti } of CASES) {
        const first = offersChange ? pickWith(CHANGE_LABEL) : PICK_QUESTION
        const raw = hasMulti ? [first, MULTI] : [first]
        const open: OpenQuestion = { ...PICK_OPEN, context, acceptsTyped, takesNote: acceptsTyped }
        const rewrite = askRewrite(raw, context, acceptsTyped, acceptsTyped, 40, rows)
        const previewed = rewrite === null ? null : { questions: rewrite.questions, notes: rewrite.asked }
        const labels = offersChange ? ['A', 'B', CHANGE_LABEL] : ['A', 'B']
        const note = { question: 'Pick one?', asked: 'Pick one?', labels, takesNote: acceptsTyped }
        const noted = offersChange || acceptsTyped ? { questions: null, notes: [note] } : null
        const expected = { preview: previewed, note: noted, none: null }[seat]
        expect(surface.dialogPlan(raw, open, placement, 40, CHANGE_LABEL)).toEqual(expected)
        const other = [{ ...first, question: 'Another?' }]
        expect(surface.dialogPlan(other, open, placement, 40, CHANGE_LABEL)).toBe(null)
      }
    }
  })

  test('the note of a docked pane pairs the open question with its labels and its takesNote (D-270)', () => {
    const open: OpenQuestion = { ...PICK_OPEN, context: CONTEXT, acceptsTyped: false, takesNote: true }
    const note = { question: 'Pick one?', asked: 'Pick one?', labels: ['A', 'B', CHANGE_LABEL], takesNote: true }
    for (const pane of [PANE_DESKTOP, PANE_FULLSCREEN]) {
      expect(pane.dialogPlan([pickWith(CHANGE_LABEL)], open, 'dock', 40, CHANGE_LABEL)).toEqual({
        questions: null,
        notes: [note],
      })
    }
  })

  test('a docked pane pairs the note of a question that takes one, with no Change option (D-348)', () => {
    const open: OpenQuestion = { ...PICK_OPEN, context: null, acceptsTyped: false, takesNote: true }
    const note = { question: 'Pick one?', asked: 'Pick one?', labels: ['A', 'B'], takesNote: true }
    const noNote: OpenQuestion = { ...open, takesNote: false }
    for (const pane of [PANE_DESKTOP, PANE_FULLSCREEN]) {
      expect(pane.dialogPlan([PICK_QUESTION], open, 'dock', 40, CHANGE_LABEL)).toEqual({
        questions: null,
        notes: [note],
      })
      expect(pane.dialogPlan([PICK_QUESTION], noNote, 'dock', 40, CHANGE_LABEL)).toBe(null)
    }
    expect(NO_SURFACE.dialogPlan([PICK_QUESTION], open, 'dock', 40, CHANGE_LABEL)).toBe(null)
  })

  test('every surface carries the options that end the open question into its notes (D-350)', () => {
    const seats: readonly (readonly [SurfaceModule, PaneSeat])[] = [
      [TUI_DEFAULT, null],
      [PANE_DESKTOP, 'inline'],
      [PANE_FULLSCREEN, 'inline'],
      [PANE_DESKTOP, 'dock'],
      [PANE_FULLSCREEN, 'dock'],
    ]
    const open: OpenQuestion = {
      ...PICK_OPEN,
      context: CONTEXT,
      acceptsTyped: false,
      takesNote: true,
      endingLabels: ['B'],
    }
    const unmarked: OpenQuestion = { ...PICK_OPEN, context: CONTEXT, acceptsTyped: false, takesNote: true }
    for (const [surface, placement] of seats) {
      const plan = surface.dialogPlan([PICK_QUESTION], open, placement, 40, CHANGE_LABEL)
      expect(plan?.notes.map(note => note.endingLabels)).toEqual([['B']])
      const plain = surface.dialogPlan([PICK_QUESTION], unmarked, placement, 40, CHANGE_LABEL)
      expect(plain?.notes.map(note => Object.hasOwn(note, 'endingLabels'))).toEqual([false])
    }
  })

  test('a multi-select question is copied unchanged and has no note', () => {
    const open: OpenQuestion = { ...PICK_OPEN, context: CONTEXT }
    for (const pane of [PANE_DESKTOP, PANE_FULLSCREEN]) {
      const plan = pane.dialogPlan([PICK_QUESTION, MULTI], open, 'inline', null, CHANGE_LABEL)
      expect(plan?.questions?.[1]).toEqual(MULTI)
      expect(plan?.notes.map(note => note.question)).toEqual(['Pick one?'])
    }
  })
})
