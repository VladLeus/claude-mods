/**
 * No surface at all (D-353), a layer 8 module: a run nobody can be asked in, as in `claude -p` (D-208). It owns the
 * behaviour-map rows of such a run: no status line or loader (row 6), every logged line in the transcript (row 7), no
 * dialog plan (row 8), no page columns (row 12), Review pages at PANE_PAGE_ROWS with no character cap (row 13), every
 * bound fold (row 14) and the screen's list words (row 15).
 */
import type { InitIo } from '../../../types'
import { SCREEN_LIST_WORDS } from '../../locales/t'
import { PANE_PAGE_ROWS } from '../pane'
import type { DialogPlan } from '../preview'
import type { ReviewPaging, SurfaceEffect, SurfaceModule } from './contract'

/** The Review pages of a run with no surface (D-233): PANE_PAGE_ROWS rows, any number of code points. */
const NONE_REVIEW_PAGING: ReviewPaging = Object.freeze({ rows: PANE_PAGE_ROWS, maxChars: Number.POSITIVE_INFINITY })

/** A run with no surface asks a question as given. */
function noneAskedText(question: string): string {
  return question
}

/** A run with no surface keeps every fold bound to the asking stage (D-302). */
function noneFolds<T>(bound: readonly T[]): readonly T[] {
  return bound
}

/** A run with no surface pages no question, so it asks through its port as it is: it shows no context (D-306). */
function nonePagedPort(io: InitIo): InitIo {
  return io
}

/** A run with no surface draws no page, so it has no page width (D-292). */
function nonePageColumns(): number | null {
  return null
}

/** A run with no surface rewrites no dialog: every call and its result pass through untouched (WD-S2, D-239). */
function noneDialogPlan(): DialogPlan | null {
  return null
}

/** A run with no surface opens nothing as it starts, scrolls nothing and shows no progress. */
function noEffects(): readonly SurfaceEffect[] {
  return []
}

/** A run with no surface logs every line to the transcript (D-325). */
function noneLogEffects(text: string): readonly SurfaceEffect[] {
  return [{ kind: 'transcript', text }]
}

/**
 * The module of a run with no surface (D-353): selected when the session draws on no surface, or the host gives its
 * surfaces in another shape than a list (D-208, D-271). Its lists keep the screen's cap (D-256).
 */
export const NO_SURFACE: SurfaceModule = Object.freeze({
  id: 'none',
  listWords: SCREEN_LIST_WORDS,
  askedText: noneAskedText,
  foldsOf: noneFolds,
  pagedPort: nonePagedPort,
  reviewPaging: NONE_REVIEW_PAGING,
  pageColumns: nonePageColumns,
  dialogPlan: noneDialogPlan,
  runStartEffects: noEffects,
  dialogOpenEffects: noEffects,
  progressEffects: noEffects,
  logEffects: noneLogEffects,
})
