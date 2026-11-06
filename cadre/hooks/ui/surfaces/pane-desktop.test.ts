import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, OpenQuestion } from '../../../types'
import type { PaneSeat } from './contract'
import { PANE_DESKTOP } from './pane-desktop'
import { PANE_FULLSCREEN } from './pane-fullscreen'

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

/** The open question's own context (D-203). */
const CONTEXT: AskContext = {
  title: 'Roles',
  lines: ['BE (be)', 'FE (fe)'],
  kind: 'roles',
  summary: '2 roles: be, fe',
}

/** PICK_QUESTION as register keeps it open, with its own context: it takes a typed answer, and so a note (D-270). */
const PICK_OPEN: OpenQuestion = {
  question: 'Pick one?',
  header: 'Pick',
  context: CONTEXT,
  acceptsTyped: true,
  takesNote: true,
}

describe('the desktop pane module (D-353, D-354)', () => {
  test('a desktop pane previews nothing on any seat, and pages at the body (D-354)', () => {
    const seats: readonly PaneSeat[] = ['dock', 'inline', null]
    for (const seat of seats) {
      expect([seat, PANE_DESKTOP.dialogPlan([PICK_QUESTION], PICK_OPEN, seat, 40)]).toEqual([seat, null])
      expect([seat, PANE_DESKTOP.pageColumns(seat, 82, 62)]).toEqual([seat, 62])
    }
    const fullscreen = PANE_FULLSCREEN.dialogPlan([PICK_QUESTION], PICK_OPEN, 'inline', 40)
    expect(Array.isArray(fullscreen?.questions)).toBe(true)
  })
})
