/**
 * The words the lists of a run on a surface are shown with (D-256), a layer 8 module, with the old surface values
 * the surface modules still pass while the split moves their rules (D-353): the surface itself is chosen by
 * ui/surfaces/select.ts. It imports core and the locale tables only.
 */
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
