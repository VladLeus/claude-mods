/**
 * The TUI default surface, a layer 8 module: the terminal main screen alone, where no side pane opens and the dialog's
 * option preview carries the open question's context. It owns the behaviour-map rows of this surface: the status line
 * cleared and a context the preview leaves lines out of printed above the dialog, never a paged one (row 5), the status
 * line as progress (row 6), every logged line in the transcript (row 7), the previewed dialog fitted to
 * PREVIEW_LINE_ROWS, a paged page's preview ending with its page marker (row 8), the page columns of the preview
 * (row 12), the Review pages at PREVIEW_ROWS (row 13), no folds (row 14) and the screen's list words (row 15). The
 * preview fit and the transcript entries (row 16) stay in ui/preview, which only this module calls them from.
 */
import type { AskContext, InitIo, OpenQuestion } from '../../../types'
import { SCREEN_LIST_WORDS, t } from '../../locales/t'
import { withPagedAsks } from '../paging'
import { PREVIEW_LINE_ROWS, PREVIEW_ROWS, previewedPlan, previewFits, tuiTranscriptEntries } from '../preview'
import type { DialogPlan } from '../preview'
import type { PageView, PaneSeat, ReviewPaging, SurfaceEffect, SurfaceModule } from './contract'

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

/** A paged context with its page marker as one last plain row: the TUI preview draws it and the page fit counts it. */
function withPageMarker(context: AskContext): AskContext {
  if (context.page === undefined || context.rows === undefined) return context
  const text = t('ui.paging.marker', { number: context.page.index + 1, count: context.page.count })

  return { ...context, rows: [...context.rows, { title: null, rows: [{ role: 'plain', text, indent: 0 }] }] }
}

/**
 * The TUI default pages only the conflict question: a diff the preview does not show whole at the view's columns is
 * asked a page at a time, each page as much as its preview shows whole with its page marker, so no line is cut or left
 * out. Every other question is asked as given, its context fitted to the preview's rows.
 */
function tuiPagedPort(io: InitIo, view: PageView): InitIo {
  const fitsPage = (page: AskContext): boolean => previewFits(withPageMarker(page), PREVIEW_LINE_ROWS, view.columns())
  const paged = withPagedAsks(io, view.columns, () => false, () => PREVIEW_LINE_ROWS, fitsPage)

  return {
    ...io,
    ask: async (question, spec) =>
      spec.context?.kind === 'conflict-diff' ? paged.ask(question, spec) : io.ask(question, spec),
  }
}

/** The columns a page is drawn at on the TUI default: the dialog preview's, whatever the seat (D-292, U-15). */
function tuiPageColumns(_seat: PaneSeat, preview: number | null): number | null {
  return preview
}

/**
 * The previewed dialog the TUI default gives the open question's call, its context fitted to PREVIEW_LINE_ROWS and a
 * paged page's preview ending with its marker; no pane opens here, so no seat and no change option changes it.
 */
function tuiDialogPlan(raw: unknown, open: OpenQuestion, _seat: PaneSeat, columns: number | null): DialogPlan | null {
  const marked = open.context === null ? open : { ...open, context: withPageMarker(open.context) }

  return previewedPlan(raw, marked, columns, PREVIEW_LINE_ROWS)
}

/** The TUI default opens no pane: the option preview carries each context (D-208). */
function tuiRunStartEffects(): readonly SurfaceEffect[] {
  return []
}

/**
 * What the TUI default does as a dialog opens: it clears the status line, then prints a context whose preview leaves
 * lines out right above the dialog, one transcript entry per row, and records it as printed, so it prints once; a
 * context the preview shows whole, a paged page included, and the Review print nothing.
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
