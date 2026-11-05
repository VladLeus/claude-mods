/**
 * The fullscreen terminal surface (D-353), a layer 8 module: the cadre-init pane docked beside the dialog in the
 * fullscreen layout, or seated inline when the terminal is narrow. It owns the pane rows of the behaviour map for this
 * surface (rows 2-4, 6-10, 12-15): the members both panes share (pane-shared) and its own seat table (D-354).
 */
import type { SeatTable, SurfaceModule } from './contract'
import { paneModule, PREVIEWED_SEAT, TYPED_SEAT } from './pane-shared'

/**
 * The seat strategies of the fullscreen pane (D-354): a pane seated inline is previewed in the dialog, as the engine
 * shows previews and notes there; a docked pane, or one with no placement, is typed under the dialog.
 */
const FULLSCREEN_SEATS: SeatTable = Object.freeze({ dock: TYPED_SEAT, inline: PREVIEWED_SEAT, unplaced: TYPED_SEAT })

/**
 * The fullscreen terminal's pane module (D-353): selected for the terminal alone in the fullscreen layout, and for the
 * terminal alone with no usable presentation (DECIDED #7, D-358).
 */
export const PANE_FULLSCREEN: SurfaceModule = paneModule('pane-fullscreen', FULLSCREEN_SEATS)
