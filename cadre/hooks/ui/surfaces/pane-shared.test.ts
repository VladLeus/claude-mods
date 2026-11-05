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
  /** The label of an option that offers a change, as the Review's Change something… does (D-233). */
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
   * What each surface module and pane seat does with the open question's dialog (D-208, D-234, D-353): preview it (the
   * TUI default, with the rows its expected preview is fitted to, or the fullscreen pane seated inline), or nothing: a
   * docked or unknown pane seat, and the desktop pane on any seat (D-354), plans no dialog, so an answer typed there
   * reaches the stage as given (RF-04).
   */
  const SEATS: readonly (readonly [SurfaceModule, PaneSeat, 'preview' | 'none', number | null])[] = [
    [TUI_DEFAULT, null, 'preview', PREVIEW_ROWS],
    [TUI_DEFAULT, 'dock', 'preview', PREVIEW_ROWS],
    [TUI_DEFAULT, 'inline', 'preview', PREVIEW_ROWS],
    [PANE_DESKTOP, 'inline', 'none', null],
    [PANE_FULLSCREEN, 'inline', 'preview', null],
    [PANE_DESKTOP, 'dock', 'none', null],
    [PANE_FULLSCREEN, 'dock', 'none', null],
    [PANE_DESKTOP, null, 'none', null],
    [PANE_FULLSCREEN, null, 'none', null],
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
        const expected = { preview: previewed, none: null }[seat]
        expect(surface.dialogPlan(raw, open, placement, 40)).toEqual(expected)
        const other = [{ ...first, question: 'Another?' }]
        expect(surface.dialogPlan(other, open, placement, 40)).toBe(null)
      }
    }
  })

  test('a docked pane plans no dialog for a question that offers Change: no note is paired (RF-04, D-353)', () => {
    const open: OpenQuestion = { ...PICK_OPEN, context: CONTEXT, acceptsTyped: false, takesNote: true }
    for (const pane of [PANE_DESKTOP, PANE_FULLSCREEN]) {
      expect(pane.dialogPlan([pickWith(CHANGE_LABEL)], open, 'dock', 40)).toBe(null)
    }
  })

  test('a docked pane plans no dialog for a question that takes a note: no note is paired (RF-04, D-353)', () => {
    const open: OpenQuestion = { ...PICK_OPEN, context: null, acceptsTyped: false, takesNote: true }
    const noNote: OpenQuestion = { ...open, takesNote: false }
    for (const pane of [PANE_DESKTOP, PANE_FULLSCREEN]) {
      expect(pane.dialogPlan([PICK_QUESTION], open, 'dock', 40)).toBe(null)
      expect(pane.dialogPlan([PICK_QUESTION], noNote, 'dock', 40)).toBe(null)
    }
    expect(NO_SURFACE.dialogPlan([PICK_QUESTION], open, 'dock', 40)).toBe(null)
  })

  test('every surface carries the options that end the open question into its notes (D-350)', () => {
    // Each surface and seat, and whether its dialog reads notes: a docked pane plans no dialog (RF-04, D-353), and nor
    // does the desktop pane on any seat (D-354).
    const seats: readonly (readonly [SurfaceModule, PaneSeat, boolean])[] = [
      [TUI_DEFAULT, null, true],
      [PANE_DESKTOP, 'inline', false],
      [PANE_FULLSCREEN, 'inline', true],
      [PANE_DESKTOP, 'dock', false],
      [PANE_FULLSCREEN, 'dock', false],
    ]
    const open: OpenQuestion = {
      ...PICK_OPEN,
      context: CONTEXT,
      acceptsTyped: false,
      takesNote: true,
      endingLabels: ['B'],
    }
    const unmarked: OpenQuestion = { ...PICK_OPEN, context: CONTEXT, acceptsTyped: false, takesNote: true }
    for (const [surface, placement, readsNotes] of seats) {
      const plan = surface.dialogPlan([PICK_QUESTION], open, placement, 40)
      expect(plan?.notes.map(note => note.endingLabels) ?? null).toEqual(readsNotes ? [['B']] : null)
      const plain = surface.dialogPlan([PICK_QUESTION], unmarked, placement, 40)
      const marks = plain?.notes.map(note => Object.hasOwn(note, 'endingLabels')) ?? null
      expect(marks).toEqual(readsNotes ? [false] : null)
    }
  })

  test('a multi-select question is copied unchanged and has no note', () => {
    const open: OpenQuestion = { ...PICK_OPEN, context: CONTEXT }
    const plan = PANE_FULLSCREEN.dialogPlan([PICK_QUESTION, MULTI], open, 'inline', null)
    expect(plan?.questions?.[1]).toEqual(MULTI)
    expect(plan?.notes.map(note => note.question)).toEqual(['Pick one?'])
    // The desktop pane previews nothing on any seat, so it plans no dialog (D-354).
    expect(PANE_DESKTOP.dialogPlan([PICK_QUESTION, MULTI], open, 'inline', null)).toBe(null)
  })
})

describe('the page columns of the surface modules (D-292, U-15, D-353)', () => {
  test('the TUI default and an inline pane page at the preview, a docked pane and the desktop at the body', () => {
    // The desktop pane previews nothing on any seat, so an inline one pages at the body too (D-354).
    const inline: readonly (readonly [SurfaceModule, number])[] = [
      [PANE_DESKTOP, 62],
      [PANE_FULLSCREEN, 82],
    ]
    for (const [pane, columns] of inline) {
      expect([
        TUI_DEFAULT.pageColumns(null, 82, 62),
        pane.pageColumns('inline', 82, 62),
        pane.pageColumns('dock', 82, 62),
        pane.pageColumns(null, 82, 62),
      ]).toEqual([82, columns, 62, 62])
    }
  })

  test('a surface that shows no context has no page width, and an unknown width stays unknown', () => {
    for (const pane of [PANE_DESKTOP, PANE_FULLSCREEN]) {
      expect([NO_SURFACE.pageColumns('dock', 82, 62), pane.pageColumns('dock', 82, null)]).toEqual([null, null])
    }
  })
})
