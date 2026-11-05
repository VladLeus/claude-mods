/**
 * The rules both pane surfaces share (D-353), a layer 8 module: the fullscreen terminal's docked pane
 * (pane-fullscreen) and the desktop app's pane (pane-desktop) are built from it (paneModule), so a rule in which the
 * two differ goes into its own module, never here. It owns the behaviour-map rows the two panes have in common: the
 * pane opened as an init or regen run starts (row 2), the pane text a dialog asks (row 3), the pane scrolled back to
 * its start per question (row 4), the loader and its summary line (rows 6, 7), the previewed dialog of an inline seat
 * and no dialog plan on a typed seat (rows 8, 9), the paged asks (row 10), the page columns by seat (row 12), the
 * Review pages under the frame's character cap (row 13), the folds (row 14) and the pane's list words (row 15). A seat
 * changes a pane module's dialog, page columns and paging only through the module's own seat table (D-354).
 */
import type { AskContext, InitIo, OpenQuestion } from '../../../types'
import { PANE_LIST_WORDS, t } from '../../locales/t'
import { paneQuestionText } from '../ask'
import { MAX_PANE_FRAME_CHARS, PANE_PAGE_ROWS } from '../pane'
import { withPagedAsks } from '../paging'
import { NOTE_WORDING, OTHER_WORDING, previewedPlan } from '../preview'
import type { DialogPlan } from '../preview'
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

/**
 * What a pane surface says in place of OTHER_WORDING where its dialog previews nothing (D-357, Q13): a docked or
 * unplaced pane, and the desktop pane on any seat, has no notes field, and the engine's free-typing row, `Type
 * something.`, is where a typed answer goes.
 */
export const PANE_TYPED_WORDING = t('ui.pane.typedWording')

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
 * A seat where the dialog previews the open question's whole context (D-354): a typed answer goes in the dialog's
 * notes field, so a question asked there says NOTE_WORDING (D-359, R4); its plan is the previewed dialog with no rows
 * to fit (previewedPlan, D3, D-203), no question is paged there (N-02), and a page is drawn at the preview's columns
 * (D-292, U-15).
 */
export const PREVIEWED_SEAT: SeatStrategy = Object.freeze({
  previews: true,
  typedWording: NOTE_WORDING,
  plan: (raw: unknown, open: OpenQuestion, columns: number | null): DialogPlan | null =>
    previewedPlan(raw, open, columns, null),
  pageColumns: (preview: number | null): number | null => preview,
})

/**
 * A seat where the dialog previews nothing and the person types under the dialog (D-354): a docked or unplaced pane
 * shows no preview and so no notes field; its typed input is the engine's free-typing row, whose text the dialog
 * answers as given, so it plans no dialog (RF-04, probe 2026-11-05, D-353; supersedes D-348 and ASKED #24's docked
 * pairing), and a question asked there says PANE_TYPED_WORDING (D-357, D-359). A context over the frame cap is paged
 * there (D-306), and a page is drawn at the pane body's columns (D-292).
 */
export const TYPED_SEAT: SeatStrategy = Object.freeze({
  previews: false,
  typedWording: PANE_TYPED_WORDING,
  plan: (): DialogPlan | null => null,
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
 * asks the pane text of a question's context (paneQuestionText, D-255, D-310) and pages its Review at PANE_PAGE_ROWS
 * under the frame's character cap (N-04). Its asked text, dialog plan, page columns and paging are the strategy `seats`
 * holds for the seat the terminal reported last (seatStrategy, D-354), looked up once per call: the asked text says
 * the seat's typedWording for every OTHER_WORDING, as a pane with no notes field takes a typed answer in its
 * free-typing row (D-353, D-359, Q13, Q14); a context over the frame cap is asked a page at a time at the columns the
 * view reads, and whole where the seat previews it (withPagedAsks, D-306, N-02), the seat read again at each ask.
 */
export function paneModule(id: SurfaceId, seats: SeatTable): SurfaceModule {
  return Object.freeze({
    id,
    listWords: PANE_LIST_WORDS,
    askedText: (question: string, context: AskContext | null, seat: PaneSeat): string =>
      paneQuestionText(question, context).replaceAll(OTHER_WORDING, seatStrategy(seats, seat).typedWording),
    foldsOf: paneFolds,
    pagedPort: (io: InitIo, view: PageView): InitIo =>
      withPagedAsks(io, view.columns, () => seatStrategy(seats, view.seat()).previews),
    reviewPaging: PANE_REVIEW_PAGING,
    pageColumns: (seat: PaneSeat, preview: number | null, body: number | null): number | null =>
      seatStrategy(seats, seat).pageColumns(preview, body),
    dialogPlan: (raw: unknown, open: OpenQuestion, seat: PaneSeat, columns: number | null) =>
      seatStrategy(seats, seat).plan(raw, open, columns),
    runStartEffects: paneRunStartEffects,
    dialogOpenEffects: paneDialogOpenEffects,
    progressEffects: paneProgressEffects,
    logEffects: paneLogEffects,
  })
}
