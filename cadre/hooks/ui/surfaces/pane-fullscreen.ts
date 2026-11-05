/**
 * The fullscreen terminal surface (D-353), a layer 8 module: the cadre-init pane docked beside the dialog in the
 * fullscreen layout, or seated inline when the terminal is narrow. It owns the pane rows of the behaviour map for this
 * surface (rows 2-4, 6-10, 12-15) and takes every one from pane-shared, so today it behaves as the desktop pane does.
 */
import type { SurfaceModule } from './contract'
import { PANE_MEMBERS } from './pane-shared'

/**
 * The fullscreen terminal's pane module (D-353): selected for the terminal alone in the fullscreen layout, and for the
 * terminal alone with no usable presentation (DECIDED #7, D-358).
 */
export const PANE_FULLSCREEN: SurfaceModule = Object.freeze({ ...PANE_MEMBERS, id: 'pane-fullscreen' })
