/**
 * The TUI default surface (D-353), a layer 8 module: the terminal main screen alone, where no side pane opens and the
 * dialog's option preview carries the open question's context (D-208). It owns the behaviour-map rows of this surface:
 * the status line cleared and an overflowing context printed above the dialog (row 5), the status line as progress
 * (row 6), every logged line in the transcript (row 7), the previewed dialog fitted to PREVIEW_LINE_ROWS (row 8), the
 * page columns of the preview (row 12), the Review pages at PREVIEW_ROWS (row 13), no folds (row 14) and the screen's
 * list words (row 15). The preview fit and the transcript entries (row 16) stay in ui/preview, which only this module
 * calls them from.
 */
import type { AskContext, InitIo, OpenQuestion } from '../../../types'
import { SCREEN_LIST_WORDS } from '../../locales/t'
import { PREVIEW_LINE_ROWS, PREVIEW_ROWS, previewedPlan, tuiTranscriptEntries } from '../preview'
import type { DialogPlan } from '../preview'
import type { PaneSeat, ReviewPaging, SurfaceEffect, SurfaceModule } from './contract'

/** The Review pages of the TUI default (D-233, ASKED #19): PREVIEW_ROWS rows, any number of code points. */
const TUI_REVIEW_PAGING: ReviewPaging = Object.freeze({ rows: PREVIEW_ROWS, maxChars: Number.POSITIVE_INFINITY })

/** The TUI default asks a question as given: the option preview, not the question, carries its context (D-203). */
function tuiAskedText(question: string): string {
  return question
}

/** The TUI default asks with no fold: the option preview shows the open question's own context only (D-302). */
function tuiFolds<T>(_bound: readonly T[]): readonly T[] {
  return []
}

/**
 * The TUI default pages no question, so a run asks through its port as it is: the preview carries the context, fitted
 * to its rows (D-228, D-306).
 */
function tuiPagedPort(io: InitIo): InitIo {
  return io
}

/** The columns a page is drawn at on the TUI default: the dialog preview's, whatever the seat (D-292, U-15). */
function tuiPageColumns(_seat: PaneSeat, preview: number | null): number | null {
  return preview
}

/**
 * The previewed dialog the TUI default gives the open question's call, its context fitted to PREVIEW_LINE_ROWS
 * (previewedPlan, D3, D-203, D-228, D-234, A3, D-270, D-350): no pane opens here, so no seat and no change option
 * changes it.
 */
function tuiDialogPlan(
  raw: unknown,
  open: OpenQuestion,
  _seat: PaneSeat,
  columns: number | null,
  _changeLabel: string,
): DialogPlan | null {
  return previewedPlan(raw, open, columns, PREVIEW_LINE_ROWS)
}

/** The TUI default opens no pane: the option preview carries each context (D-208). */
function tuiRunStartEffects(): readonly SurfaceEffect[] {
  return []
}

/**
 * What the TUI default does as a dialog opens: it clears the status line (D-232), then prints a context too long for
 * the preview drawn at `columns` right above the dialog, one transcript entry per row, its title first, each line
 * cleaned and uncut, as the terminal draws no newline inside an entry (D-262), and records it as the context printed
 * last. It prints once per question: a question asked again with the context `printed` last prints nothing
 * (tuiTranscriptEntries, D-228, D-260, D-262, WD-S4); the preview ends with how many lines it left out. A context that
 * fits, and the Review, print nothing. Register ignores a status or log call the host throws on (D-271).
 */
function tuiDialogOpenEffects(
  context: AskContext | null,
  printed: AskContext | null,
  columns: number | null,
): readonly SurfaceEffect[] {
  const clear: SurfaceEffect = { kind: 'status', text: null }
  const entries = tuiTranscriptEntries(context, printed, columns)
  if (context === null || entries.length === 0) return [clear]
  const lines = entries.map((text): SurfaceEffect => ({ kind: 'transcript', text }))

  return [clear, ...lines, { kind: 'printed', context }]
}

/** The TUI default shows a long step as its one status line, the label alone, and clears it on null (D-232). */
function tuiProgressEffects(text: string | null): readonly SurfaceEffect[] {
  return [{ kind: 'status', text }]
}

/** The TUI default logs every line to the transcript (D-325). */
function tuiLogEffects(text: string): readonly SurfaceEffect[] {
  return [{ kind: 'transcript', text }]
}

/**
 * The TUI default's module (D-353): selected for the terminal alone on the main screen (D-208). Its lists keep the
 * screen's cap (D-256) and its Review pages at PREVIEW_ROWS with no character cap (D-233).
 */
export const TUI_DEFAULT: SurfaceModule = Object.freeze({
  id: 'tui-default',
  listWords: SCREEN_LIST_WORDS,
  askedText: tuiAskedText,
  foldsOf: tuiFolds,
  pagedPort: tuiPagedPort,
  reviewPaging: TUI_REVIEW_PAGING,
  pageColumns: tuiPageColumns,
  dialogPlan: tuiDialogPlan,
  runStartEffects: tuiRunStartEffects,
  dialogOpenEffects: tuiDialogOpenEffects,
  progressEffects: tuiProgressEffects,
  logEffects: tuiLogEffects,
})
