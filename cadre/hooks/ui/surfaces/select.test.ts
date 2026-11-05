import { describe, expect, test } from 'claude-code/testing'

import { surfaceModuleOf } from './select'

/** The presentation of a command run on the terminal main screen (D-208). */
const MAIN_SCREEN = { isFullscreen: false, columns: 120 }

/** The presentation of a command run in the fullscreen layout, which docks a pane (D-208). */
const FULLSCREEN = { isFullscreen: true, columns: 120 }

describe('surfaceModuleOf (D-208, D-353)', () => {
  test('a session drawn on any surface beside the terminal is a pane surface, whatever the layout', () => {
    expect(surfaceModuleOf(MAIN_SCREEN, ['terminal', 'desktop']).id).toBe('pane-desktop')
    expect(surfaceModuleOf(MAIN_SCREEN, ['desktop']).id).toBe('pane-desktop')
    expect(surfaceModuleOf(FULLSCREEN, ['vscode', 'terminal']).id).toBe('pane-desktop')
  })

  test('the terminal alone is the TUI default on the main screen and a pane surface in fullscreen', () => {
    expect(surfaceModuleOf(MAIN_SCREEN, ['terminal']).id).toBe('tui-default')
    expect(surfaceModuleOf(FULLSCREEN, ['terminal']).id).toBe('pane-fullscreen')
  })

  test('no surface at all, as in claude -p, is none, whatever the presentation says', () => {
    expect(surfaceModuleOf(MAIN_SCREEN, []).id).toBe('none')
    expect(surfaceModuleOf(FULLSCREEN, []).id).toBe('none')
    expect(surfaceModuleOf(undefined, []).id).toBe('none')
  })

  test('surfaces that are not a list, as from a host that refused to say, are none', () => {
    for (const surfaces of [null, 'terminal', { 0: 'terminal' }]) {
      expect(surfaceModuleOf(MAIN_SCREEN, surfaces).id).toBe('none')
    }
  })

  test('no surfaces read, as from a host with no surfaces method, takes the presentation alone (D-271, U-29)', () => {
    expect(surfaceModuleOf({ isFullscreen: false }, undefined).id).toBe('tui-default')
    expect(surfaceModuleOf({ isFullscreen: true }, undefined).id).toBe('pane-fullscreen')
    expect(surfaceModuleOf(null, undefined).id).toBe('pane-fullscreen')
    expect(surfaceModuleOf(MAIN_SCREEN, []).id).toBe('none')
    expect(surfaceModuleOf(MAIN_SCREEN, null).id).toBe('none')
  })

  test('the terminal alone with no presentation, or a malformed one, is a pane surface, as today (DECIDED #7)', () => {
    for (const presentation of [undefined, null, 'main', 3, {}, { isFullscreen: 'false' }, { columns: 120 }]) {
      expect(surfaceModuleOf(presentation, ['terminal']).id).toBe('pane-fullscreen')
    }
  })

  test('an entry of the list that is not a surface name counts as a surface beside the terminal', () => {
    expect(surfaceModuleOf(MAIN_SCREEN, ['terminal', 3]).id).toBe('pane-desktop')
    expect(surfaceModuleOf(MAIN_SCREEN, [null]).id).toBe('pane-desktop')
  })
})
