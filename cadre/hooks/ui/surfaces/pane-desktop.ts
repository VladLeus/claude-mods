/**
 * The desktop app surface (D-353), a layer 8 module: the cadre-init pane on a surface beside the terminal, such as the
 * desktop app, where the pane scrolls. It owns the pane rows of the behaviour map for this surface (rows 2-4, 6-10,
 * 12-15) and takes every one from pane-shared, so today it behaves as the fullscreen pane does.
 */
import type { SurfaceModule } from './contract'
import { PANE_MEMBERS } from './pane-shared'

/**
 * The desktop app's pane module (D-353): selected for a session drawn on any surface beside the terminal (Q1), and the
 * module of a run given no surface at all, as the tests and the golden capture run (Q6, D-358).
 */
export const PANE_DESKTOP: SurfaceModule = Object.freeze({ ...PANE_MEMBERS, id: 'pane-desktop' })
