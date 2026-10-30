import { describe, expect, test } from 'claude-code/testing'

import { surfaceOf } from './surface'

/** The presentation of a command run on the terminal main screen (D-208). */
const MAIN_SCREEN = { isFullscreen: false, columns: 120 }

/** The presentation of a command run in the fullscreen layout, which docks a pane (D-208). */
const FULLSCREEN = { isFullscreen: true, columns: 120 }

describe('surfaceOf (D-208)', () => {
  test('a session drawn on any surface beside the terminal is a pane surface, whatever the layout', () => {
    expect(surfaceOf(MAIN_SCREEN, ['terminal', 'desktop'])).toBe('pane')
    expect(surfaceOf(MAIN_SCREEN, ['desktop'])).toBe('pane')
    expect(surfaceOf(FULLSCREEN, ['vscode', 'terminal'])).toBe('pane')
  })

  test('the terminal alone is the TUI default on the main screen and a pane surface in fullscreen', () => {
    expect(surfaceOf(MAIN_SCREEN, ['terminal'])).toBe('tui-default')
    expect(surfaceOf(FULLSCREEN, ['terminal'])).toBe('pane')
  })

  test('no surface at all, as in claude -p, is none, whatever the presentation says', () => {
    expect(surfaceOf(MAIN_SCREEN, [])).toBe('none')
    expect(surfaceOf(FULLSCREEN, [])).toBe('none')
    expect(surfaceOf(undefined, [])).toBe('none')
  })

  test('surfaces that are not a list, as from a host that refused to say, are none', () => {
    for (const surfaces of [null, undefined, 'terminal', { 0: 'terminal' }]) {
      expect(surfaceOf(MAIN_SCREEN, surfaces)).toBe('none')
    }
  })

  test('the terminal alone with no presentation, or a malformed one, is a pane surface, as today (DECIDED #7)', () => {
    for (const presentation of [undefined, null, 'main', 3, {}, { isFullscreen: 'false' }, { columns: 120 }]) {
      expect(surfaceOf(presentation, ['terminal'])).toBe('pane')
    }
  })

  test('an entry of the list that is not a surface name counts as a surface beside the terminal', () => {
    expect(surfaceOf(MAIN_SCREEN, ['terminal', 3])).toBe('pane')
    expect(surfaceOf(MAIN_SCREEN, [null])).toBe('pane')
  })
})
