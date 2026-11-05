/**
 * Where a /cadre run shows its context (D-208), a layer 8 module: the surface decided from what the engine stamps on
 * the command and the surfaces the session draws on, before anything opens, and the words its lists are shown with
 * (D-256). It imports core and the locale tables only, so register.tsx decides the surface here, the init state carries
 * it to the stages, and they take their list words from it.
 */
import { isObject } from '../core/json'
import type { ListWords } from '../core/text'
import { PANE_LIST_WORDS, SCREEN_LIST_WORDS } from '../locales/t'

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
 * Surfaces left undefined, as from a host with no surfaces method, are unknown, not none: the surface then comes from
 * the presentation alone, as for the terminal alone (D-271, U-29).
 */
export function surfaceOf(presentation: unknown, surfaces: unknown): Surface {
  if (surfaces !== undefined && (!Array.isArray(surfaces) || surfaces.length === 0)) return 'none'
  if (Array.isArray(surfaces) && surfaces.some(surface => surface !== 'terminal')) return 'pane'
  if (!isObject(presentation) || typeof presentation.isFullscreen !== 'boolean') return 'pane'

  return presentation.isFullscreen ? 'pane' : 'tui-default'
}

/**
 * The words the lists of a run on `surface` are shown with (D-256): a pane surface's pane shows every name
 * (PANE_LIST_WORDS); the TUI default and a run with no surface keep the screen's cap of 12 names and how many more
 * (SCREEN_LIST_WORDS).
 */
export function listWordsOf(surface: Surface): ListWords {
  return surface === 'pane' ? PANE_LIST_WORDS : SCREEN_LIST_WORDS
}

/**
 * The word set `words` with a smaller cap, `max` at most (D-256, D-283): the TUI default's three titles or sources and
 * its five names in a question; a word set with no cap, a pane surface's, stays uncapped.
 */
export function withMax(words: ListWords, max: number): ListWords {
  if (!Number.isFinite(words.max)) return words

  return { ...words, max: Math.min(words.max, max) }
}
