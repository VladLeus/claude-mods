import { describe, expect, test } from 'claude-code/testing'

import { PANE_LIST_WORDS, SCREEN_LIST_WORDS } from '../locales/t'
import { listWordsOf, withMax } from './surface'

describe('listWordsOf and withMax (D-256)', () => {
  test('a pane surface lists every name; the TUI default and a run with no surface keep the screen cap of 12', () => {
    expect(listWordsOf('pane')).toBe(PANE_LIST_WORDS)
    expect(listWordsOf('tui-default')).toBe(SCREEN_LIST_WORDS)
    expect(listWordsOf('none')).toBe(SCREEN_LIST_WORDS)
  })

  test('withMax lowers the cap of a capped list and leaves an uncapped list uncapped', () => {
    expect(withMax(SCREEN_LIST_WORDS, 3)).toEqual({ ...SCREEN_LIST_WORDS, max: 3 })
    expect(withMax(SCREEN_LIST_WORDS, 30).max).toBe(12)
    expect(withMax(PANE_LIST_WORDS, 3)).toBe(PANE_LIST_WORDS)
  })
})
