/**
 * The desktop app surface (D-353), a layer 8 module: the cadre-init pane on a surface beside the terminal, such as the
 * desktop app, where the pane scrolls. It owns the pane rows of the behaviour map for this surface (rows 2-4, 6-10,
 * 12-15): the members both panes share (pane-shared) and its own seat table (D-354).
 */
import type { SeatTable, SurfaceModule } from './contract'
import { paneModule, PREVIEWED_SEAT, TYPED_SEAT } from './pane-shared'

/**
 * The seat strategies of the desktop pane (D-354), today's: a pane seated inline is previewed in the dialog, a docked
 * pane, or one with no placement, is typed under the dialog. Part 2 makes every seat TYPED_SEAT, as the desktop never
 * uses previews or notes (D-354).
 */
const DESKTOP_SEATS: SeatTable = Object.freeze({ dock: TYPED_SEAT, inline: PREVIEWED_SEAT, unplaced: TYPED_SEAT })

/**
 * The desktop app's pane module (D-353): selected for a session drawn on any surface beside the terminal (Q1), and the
 * module of a run given no surface at all, as the tests and the golden capture run (Q6, D-358).
 */
export const PANE_DESKTOP: SurfaceModule = paneModule('pane-desktop', DESKTOP_SEATS)
