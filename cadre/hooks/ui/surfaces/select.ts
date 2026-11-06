/**
 * The one selection point of the UI surfaces (D-353), a layer 8 module: it maps what the engine stamps on a /cadre
 * command and the surfaces the session draws on to the module of that surface, before anything opens (D-208).
 * register.tsx calls it once per command; every other file uses the module it is handed.
 */
import { isObject } from '../../core/json'
import type { SurfaceModule } from './contract'
import { NO_SURFACE } from './none'
import { PANE_DESKTOP } from './pane-desktop'
import { PANE_FULLSCREEN } from './pane-fullscreen'
import { TUI_DEFAULT } from './tui-default'

/**
 * The module of the surface one /cadre run shows its context on (D-208, D-353), from the command's presentation and
 * the session's surfaces, both read as unknown: no surface, or surfaces that are not a list, is NO_SURFACE; any
 * surface beside the terminal, a name that is not one included, is PANE_DESKTOP, also beside a terminal in the
 * fullscreen layout (Q1); the terminal alone is PANE_FULLSCREEN in the fullscreen layout and TUI_DEFAULT on the main
 * screen; with no presentation, or one whose `isFullscreen` is not a boolean, it is PANE_FULLSCREEN, a pane surface as
 * before (DECIDED #7, D-358). Surfaces left undefined, as from a host with no surfaces method, are unknown, not none:
 * the module then comes from the presentation alone, as for the terminal alone (D-271, U-29).
 */
export function surfaceModuleOf(presentation: unknown, surfaces: unknown): SurfaceModule {
  if (surfaces !== undefined && (!Array.isArray(surfaces) || surfaces.length === 0)) return NO_SURFACE
  if (Array.isArray(surfaces) && surfaces.some(surface => surface !== 'terminal')) return PANE_DESKTOP
  if (!isObject(presentation) || typeof presentation.isFullscreen !== 'boolean') return PANE_FULLSCREEN

  return presentation.isFullscreen ? PANE_FULLSCREEN : TUI_DEFAULT
}
