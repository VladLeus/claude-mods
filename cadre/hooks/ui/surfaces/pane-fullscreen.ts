/**
 * The fullscreen terminal surface (D-353), a layer 8 module: the cadre-init pane docked beside the dialog in the
 * fullscreen layout, or seated inline when the terminal is narrow. It owns the pane rows of the behaviour map for this
 * surface (rows 2-4, 6-10, 12-15): the members both panes share (pane-shared), its own seat table (D-354) and its own
 * paged port: the fullscreen pane does not scroll, so every long context is paged to the rows it shows (RF-05, D-353).
 * The Review keeps its pages of PANE_PAGE_ROWS (Q9).
 */
import type { InitIo } from '../../../types'
import { MAX_PANE_FRAME_ROWS, PANE_PAGE_ROWS } from '../pane'
import { withPagedAsks } from '../paging'
import type { PageView, SeatTable, SurfaceModule } from './contract'
import { paneModule, PREVIEWED_SEAT, seatStrategy, TYPED_SEAT } from './pane-shared'

/**
 * The rows a fullscreen page holds while no Pane render has given the rows the docked pane shows (Q8, RF-05): the
 * spike's fallback of PANE_PAGE_ROWS.
 */
const FULLSCREEN_FALLBACK_ROWS = PANE_PAGE_ROWS

/**
 * The seat strategies of the fullscreen pane (D-354): a pane seated inline is previewed in the dialog, as the engine
 * shows previews and notes there; a docked pane, or one with no placement, is typed under the dialog.
 */
const FULLSCREEN_SEATS: SeatTable = Object.freeze({ dock: TYPED_SEAT, inline: PREVIEWED_SEAT, unplaced: TYPED_SEAT })

/**
 * The port a fullscreen run asks through (RF-05, D-306, N-02, D-353): a context with rows whose frame is taller than
 * the rows the docked pane showed at its last render, FULLSCREEN_FALLBACK_ROWS before any, and never more than
 * MAX_PANE_FRAME_ROWS, is asked a page at a time at the columns the view reads; a seat that previews the context asks
 * it whole (withPagedAsks), the seat and the rows read again at each ask.
 */
function pagedPort(io: InitIo, view: PageView): InitIo {
  return withPagedAsks(
    io,
    view.columns,
    () => seatStrategy(FULLSCREEN_SEATS, view.seat()).previews,
    () => Math.min(MAX_PANE_FRAME_ROWS, view.rows() ?? FULLSCREEN_FALLBACK_ROWS),
  )
}

/**
 * The fullscreen terminal's pane module (D-353): selected for the terminal alone in the fullscreen layout, and for the
 * terminal alone with no usable presentation (DECIDED #7, D-358).
 */
export const PANE_FULLSCREEN: SurfaceModule = Object.freeze({
  ...paneModule('pane-fullscreen', FULLSCREEN_SEATS),
  pagedPort,
})
