/**
 * Where a /cadre run shows its context (D-208), a layer 8 module: the surface decided from what the engine stamps on
 * the command and the surfaces the session draws on, before anything opens. It imports core only, so register.tsx
 * decides it here and the init state carries it to the stages.
 */
import { isObject } from '../core/json'

/**
 * Where a run shows its context (D-208):
 * - `pane`: the side pane, on a surface beside the terminal (the desktop app), in the fullscreen layout, or when the
 *   engine stamps no presentation, as before (DECIDED #7).
 * - `tui-default`: the terminal main screen alone, where no side pane opens and the option preview carries the context.
 * - `none`: no surface at all, as in `claude -p`, where nobody can be asked.
 */
export type Surface = 'pane' | 'tui-default' | 'none'

/**
 * The surface of one /cadre run (D-208), from the command's presentation and the session's surfaces, both read as
 * unknown: no surface, or surfaces that are not a list, is `none`; any surface beside the terminal, a name that is
 * not one included, is `pane`; the terminal alone is `pane` in the fullscreen layout and `tui-default` on the main
 * screen; with no presentation, or one whose `isFullscreen` is not a boolean, it is `pane`, as before (DECIDED #7).
 */
export function surfaceOf(presentation: unknown, surfaces: unknown): Surface {
  if (!Array.isArray(surfaces) || surfaces.length === 0) return 'none'
  if (surfaces.some(surface => surface !== 'terminal')) return 'pane'
  if (!isObject(presentation) || typeof presentation.isFullscreen !== 'boolean') return 'pane'

  return presentation.isFullscreen ? 'pane' : 'tui-default'
}
