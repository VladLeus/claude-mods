/**
 * The rules both pane surfaces share (D-353), a layer 8 module: the fullscreen terminal's docked pane
 * (pane-fullscreen) and the desktop app's pane (pane-desktop) are built from it, so a rule in which the two differ
 * goes into its own module, never here. It owns the behaviour-map rows the two panes have in common: the pane opened
 * as an init or regen run starts (row 2), the pane text a dialog asks (row 3), the pane scrolled back to its start per
 * question (row 4), the loader and its summary line (rows 6, 7), the dialog of the open question (rows 8, 9), the paged
 * asks (row 10), the page columns (row 12), the Review pages under the frame's character cap (row 13), the folds (row
 * 14) and the pane's list words (row 15).
 */
import type { InitIo, OpenQuestion } from '../../../types'
import { paneQuestionText } from '../ask'
import { MAX_PANE_FRAME_CHARS, PANE_PAGE_ROWS, pageColumnsOf } from '../pane'
import { withPagedAsks } from '../paging'
import { dialogPlan } from '../preview'
import type { DialogPlan } from '../preview'
import { listWordsOf } from '../surface'
import type { PageView, PaneSeat, ReviewPaging, SurfaceEffect, SurfaceModule } from './contract'

/** Room, in code points, a pane Review frame keeps for its title, summary and page-marker rows (N-04). */
const REVIEW_FRAME_RESERVE = 200

/**
 * The Review pages of a pane (D-233, ASKED #19, N-04): PANE_PAGE_ROWS rows, and under the frame's character cap less
 * REVIEW_FRAME_RESERVE.
 */
const PANE_REVIEW_PAGING: ReviewPaging = Object.freeze({
  rows: PANE_PAGE_ROWS,
  maxChars: MAX_PANE_FRAME_CHARS - REVIEW_FRAME_RESERVE,
})

/** A pane asks a question with every fold bound to its stage, which the pane draws above its context (D-302). */
function paneFolds<T>(bound: readonly T[]): readonly T[] {
  return bound
}

/**
 * The paged port of a pane (D-306, N-02): a context over the frame cap is asked a page at a time at the columns `view`
 * reads, and whole while the pane is seated inline.
 */
function panePagedPort(io: InitIo, view: PageView): InitIo {
  return withPagedAsks(io, 'pane', view.columns, () => view.seat() === 'inline')
}

/** The columns a page of a pane is drawn at (D-292, U-15): the preview's when seated inline, else the body's. */
function panePageColumns(seat: PaneSeat, preview: number | null, body: number | null): number | null {
  return pageColumnsOf('pane', seat, preview, body)
}

/**
 * The dialog a pane gives the open question's call (WD-S2): previewed while seated inline, else the docked note
 * pairing of a question that offers `changeLabel` or takes a note (ASKED #24, D-270, D-348, D-350).
 */
function paneDialogPlan(
  raw: unknown,
  open: OpenQuestion,
  seat: PaneSeat,
  columns: number | null,
  changeLabel: string,
): DialogPlan | null {
  return dialogPlan(raw, open, 'pane', seat, columns, changeLabel)
}

/** A pane surface opens the cadre-init pane as an init or regen run starts, before its first question (D-324). */
function paneRunStartEffects(): readonly SurfaceEffect[] {
  return [{ kind: 'open-pane' }]
}

/**
 * Each question scrolls the pane the run opened back to its start, so its own context shows from its first row
 * (D-209); register skips the scroll when the run did not open the pane, and holds the question at most SCROLL_WAIT_MS
 * for a scroll that never settles (D-271).
 */
function paneDialogOpenEffects(): readonly SurfaceEffect[] {
  return [{ kind: 'scroll-start' }]
}

/**
 * A pane draws a long step's label and summary as its loader, alone between questions, and clears it on a null
 * `text` (D-301, D-325, D-327).
 */
function paneProgressEffects(text: string | null, summary: string | null): readonly SurfaceEffect[] {
  return [{ kind: 'loader', label: text, summary }]
}

/**
 * A line logged on a pane while a step runs is the loader's summary line and is not printed (D-325, OC-03-N); any
 * other line goes to the transcript.
 */
function paneLogEffects(text: string, isLoading: boolean): readonly SurfaceEffect[] {
  if (isLoading) return [{ kind: 'loader-summary', text }]

  return [{ kind: 'transcript', text }]
}

/**
 * Every member the two pane modules share (D-353): each pane module is these members and its own id. The pane lists
 * every name (D-256), asks the pane text of a question's context (paneQuestionText, D-255, D-310) and pages its
 * Review at PANE_PAGE_ROWS under the frame's character cap (N-04).
 */
export const PANE_MEMBERS: Omit<SurfaceModule, 'id'> = Object.freeze({
  listWords: listWordsOf('pane'),
  askedText: paneQuestionText,
  foldsOf: paneFolds,
  pagedPort: panePagedPort,
  reviewPaging: PANE_REVIEW_PAGING,
  pageColumns: panePageColumns,
  dialogPlan: paneDialogPlan,
  runStartEffects: paneRunStartEffects,
  dialogOpenEffects: paneDialogOpenEffects,
  progressEffects: paneProgressEffects,
  logEffects: paneLogEffects,
})
