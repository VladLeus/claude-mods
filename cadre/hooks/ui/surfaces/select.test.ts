import { describe, expect, test } from 'claude-code/testing'

import { PANE_LIST_WORDS, SCREEN_LIST_WORDS } from '../../locales/t'
import { memIo, memWorld } from '../../testkit'
import type { PageView } from './contract'
import { NO_SURFACE } from './none'
import { PANE_DESKTOP } from './pane-desktop'
import { PANE_FULLSCREEN } from './pane-fullscreen'
import { surfaceModuleOf } from './select'
import { TUI_DEFAULT } from './tui-default'

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

describe('the list words of each module (D-256, D-353)', () => {
  test('a pane surface lists every name; the TUI default and a run with no surface keep the screen cap of 12', () => {
    expect(PANE_DESKTOP.listWords).toBe(PANE_LIST_WORDS)
    expect(PANE_FULLSCREEN.listWords).toBe(PANE_LIST_WORDS)
    expect(TUI_DEFAULT.listWords).toBe(SCREEN_LIST_WORDS)
    expect(NO_SURFACE.listWords).toBe(SCREEN_LIST_WORDS)
  })
})

describe('the paged port of the modules that never page (D-306, D-353)', () => {
  test('the TUI default and a surface that shows no context are given the port as it is', () => {
    const { io } = memIo(memWorld({}), [])
    const view: PageView = { columns: () => null, seat: () => null }
    expect(TUI_DEFAULT.pagedPort(io, view)).toBe(io)
    expect(NO_SURFACE.pagedPort(io, view)).toBe(io)
  })
})
