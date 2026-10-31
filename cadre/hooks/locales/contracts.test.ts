import { describe, expect, test } from 'claude-code/testing'

import { CONTRACTS, DONE_MARKER_LINE, ITERM_LINES, TERMINAL_APP_LINES } from './contracts'

/**
 * Each on-disk, shell or protocol marker with the exact bytes it had in its module before it moved (D-221): a byte
 * change would break a file cadre wrote before, autopilot's log reading or the launcher's shell.
 */
const MARKERS: readonly (readonly [string, string, string])[] = [
  [
    'memoryBlockBegin',
    CONTRACTS.memoryBlockBegin,
    '<!-- >>> cadre linked memories (read-only; rebuilt by /cadre start) -->',
  ],
  ['memoryBlockEnd', CONTRACTS.memoryBlockEnd, '<!-- <<< cadre linked memories -->'],
  ['memoryBlockLine', CONTRACTS.memoryBlockLine, '- [{file}]({file}) — {summary}'],
  ['stamp', CONTRACTS.stamp, 'rendered by cadre {version}\n'],
  [
    'tmuxWait',
    CONTRACTS.tmuxWait,
    "{ printf '%s\\n' 'cadre: the launcher stopped; press Enter to close this window'; read -r _; }",
  ],
  ['autopilotFinished', CONTRACTS.autopilotFinished, 'finished ('],
  ['autopilotFinishedDone', CONTRACTS.autopilotFinishedDone, 'finished (done)'],
  ['autopilotStarted', CONTRACTS.autopilotStarted, 'started: '],
  ['autopilotStopped', CONTRACTS.autopilotStopped, 'stopped by the person'],
  ['ignoreBegin', CONTRACTS.ignoreBegin, '# >>> cadre'],
  ['ignoreEnd', CONTRACTS.ignoreEnd, '# <<< cadre'],
  ['topOfFile', CONTRACTS.topOfFile, '(top of file)'],
  ['excludesHeading', CONTRACTS.excludesHeading, '# cadre links (cadre epic)'],
  ['runtimeExcludeLine', CONTRACTS.runtimeExcludeLine, '/.cadre/*/.runtime/'],
]

/** The probe texts written into a role's probe file (D-221): one plain line each, read back by the probe skill. */
const PROBE_TEXTS: readonly string[] = [
  CONTRACTS.probeUnusual,
  CONTRACTS.probeToolAbsent,
  CONTRACTS.probeToolsAbsent,
  CONTRACTS.probeToolPresent,
  CONTRACTS.probeCommandPresent,
  CONTRACTS.probeSkillPresent,
  CONTRACTS.probePermissionMode,
  CONTRACTS.probeChecked,
  CONTRACTS.probeMemoryFolder,
]

describe('locales/contracts (D-221)', () => {
  for (const [name, value, literal] of MARKERS) {
    test(`${name} keeps its exact bytes`, () => {
      expect(value).toBe(literal)
    })
  }

  test('every probe text has no | and no \\, the characters the probe file reserves', () => {
    for (const text of PROBE_TEXTS) {
      expect(text.includes('|')).toBe(false)
      expect(text.includes('\\')).toBe(false)
    }
  })

  test('the probe texts keep their exact bytes', () => {
    expect(PROBE_TEXTS).toEqual([
      ' (not checked: unusual characters)',
      'tool {token} absent',
      'tools of {token} absent',
      'tool {token} present',
      'command {token} present',
      'skill {token} present',
      'permission mode {token}',
      '{text} [{label}]',
      'Memory folder: {dir} (autoMemoryDirectory)',
    ])
  })

  test('the AppleScript lines of Terminal and iTerm keep their exact bytes', () => {
    expect(TERMINAL_APP_LINES).toEqual([
      'on run argv',
      'tell application "Terminal"',
      'activate',
      'do script (item 1 of argv)',
      'end tell',
      'end run',
    ])
    expect(ITERM_LINES).toEqual([
      'on run argv',
      'tell application "iTerm"',
      'activate',
      'if (count of windows) is 0 then',
      'create window with default profile',
      'else',
      'tell current window to create tab with default profile',
      'end if',
      'tell current session of current window to write text (item 1 of argv)',
      'end tell',
      'end run',
    ])
  })
})

describe('DONE_MARKER_LINE', () => {
  test('it matches AUTOPILOT_DONE at a line start, after optional spaces or tabs', () => {
    expect(DONE_MARKER_LINE.test('AUTOPILOT_DONE')).toBe(true)
    expect(DONE_MARKER_LINE.test('x\n \tAUTOPILOT_DONE: ok')).toBe(true)
  })

  test('it does not match the marker inside a line or as part of a longer word', () => {
    expect(DONE_MARKER_LINE.test('answer with a line that starts with AUTOPILOT_DONE.')).toBe(false)
    expect(DONE_MARKER_LINE.test('AUTOPILOT_DONEX')).toBe(false)
  })
})
