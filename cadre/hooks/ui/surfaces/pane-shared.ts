/**
 * The rules both pane surfaces share (D-353), a layer 8 module: the fullscreen terminal's docked pane
 * (pane-fullscreen) and the desktop app's pane (pane-desktop) are built from it (paneModule), so a rule in which the
 * two differ goes into its own module, never here. It owns the behaviour-map rows the two panes have in common: the
 * pane opened as an init or regen run starts (row 2), the pane text a dialog asks (row 3), the pane scrolled back to
 * its start per question (row 4), the loader and its summary line (rows 6, 7), the previewed dialog of an inline seat
 * and the docked note pairing (rows 8, 9), the paged asks (row 10), the page columns by seat (row 12), the Review
 * pages under the frame's character cap (row 13), the folds (row 14) and the pane's list words (row 15). A seat
 * changes a pane module's dialog, page columns and paging only through the module's own seat table (D-354).
 */
import type { InitIo, OpenQuestion } from '../../../types'
import { isObject } from '../../core/json'
import { paneQuestionText } from '../ask'
import { MAX_PANE_FRAME_CHARS, PANE_PAGE_ROWS, pageColumnsOf } from '../pane'
import { withPagedAsks } from '../paging'
import { isOpenAsked, previewedPlan } from '../preview'
import type { AskedQuestion, DialogPlan } from '../preview'
import { listWordsOf } from '../surface'
import type {
  PageView,
  PaneSeat,
  ReviewPaging,
  SeatStrategy,
  SeatTable,
  SurfaceEffect,
  SurfaceId,
  SurfaceModule,
} from './contract'

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

/**
 * The dialog a docked pane, or one with no placement, gives the open question's call (ASKED #24, D-270, D-348,
 * D-350): null unless the call asks the open question (isOpenAsked, D-239). A pane that previews nothing passes the
 * dialog of an open question that offers an option labelled `changeLabel` (the Review's Change something…, D-233) or
 * that takes a note (`takesNote`: a typed answer, the Launch folder, D-348) through as asked (questions null), and its
 * one note pairs the open question with itself, with the call's labels, its takesNote and its endingLabels, so a note
 * typed in it becomes its answer; any other call gets null. Part 2 removes it (RF-04, D-353).
 */
export function dockedNotePlan(raw: unknown, open: OpenQuestion, changeLabel: string): DialogPlan | null {
  if (!isOpenAsked(raw, open)) return null
  const first: unknown = Array.isArray(raw) ? raw[0] : undefined
  const options: unknown = isObject(first) ? first.options : null
  const isChange = (option: unknown): boolean => isObject(option) && option.label === changeLabel
  const offersChange = Array.isArray(options) && options.some(isChange)
  if (!offersChange && !open.takesNote) return null
  const offered = Array.isArray(options) ? options.filter(isObject) : []
  const labels = offered.flatMap(option => (typeof option.label === 'string' ? [option.label] : []))
  const ending = open.endingLabels === undefined ? {} : { endingLabels: open.endingLabels }
  const note: AskedQuestion = {
    question: open.question,
    asked: open.question,
    labels,
    takesNote: open.takesNote,
    ...ending,
  }

  return { questions: null, notes: [note] }
}

/**
 * A seat where the dialog previews the open question's whole context (D-354): its plan is the previewed dialog with no
 * rows to fit (previewedPlan, D3, D-203), no question is paged there (N-02), and a page is drawn at the preview's
 * columns (D-292, U-15).
 */
export const PREVIEWED_SEAT: SeatStrategy = Object.freeze({
  previews: true,
  plan: (raw: unknown, open: OpenQuestion, columns: number | null): DialogPlan | null =>
    previewedPlan(raw, open, columns, null),
  pageColumns: (preview: number | null): number | null => preview,
})

/**
 * A seat where the dialog previews nothing and the person types under the dialog (D-354): its plan is the docked note
 * pairing (dockedNotePlan, D-348), a context over the frame cap is paged there (D-306), and a page is drawn at the
 * pane body's columns (D-292).
 */
export const TYPED_SEAT: SeatStrategy = Object.freeze({
  previews: false,
  plan: (raw: unknown, open: OpenQuestion, _columns: number | null, changeLabel: string): DialogPlan | null =>
    dockedNotePlan(raw, open, changeLabel),
  pageColumns: (_preview: number | null, body: number | null): number | null => body,
})

/**
 * The strategy a pane module uses at the seat the terminal reported last (D-354): the table's own entry for the seat,
 * `unplaced` when no placement is known. A pane module reads its seat only through this index, never a branch.
 */
export function seatStrategy(table: SeatTable, seat: PaneSeat): SeatStrategy {
  return table[seat ?? 'unplaced']
}

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
 * The module of a pane surface `id` (D-353), built from the members both panes share: it lists every name (D-256),
 * asks the pane text of a question's context (paneQuestionText, D-255, D-310), pages its Review at PANE_PAGE_ROWS under
 * the frame's character cap (N-04), and gives the open question's call the dialog of the strategy `seats` holds for
 * the seat the terminal reported last (seatStrategy, D-354), looked up once per call.
 */
export function paneModule(id: SurfaceId, seats: SeatTable): SurfaceModule {
  return Object.freeze({
    id,
    listWords: listWordsOf('pane'),
    askedText: paneQuestionText,
    foldsOf: paneFolds,
    pagedPort: panePagedPort,
    reviewPaging: PANE_REVIEW_PAGING,
    pageColumns: panePageColumns,
    dialogPlan: (raw: unknown, open: OpenQuestion, seat: PaneSeat, columns: number | null, changeLabel: string) =>
      seatStrategy(seats, seat).plan(raw, open, columns, changeLabel),
    runStartEffects: paneRunStartEffects,
    dialogOpenEffects: paneDialogOpenEffects,
    progressEffects: paneProgressEffects,
    logEffects: paneLogEffects,
  })
}
