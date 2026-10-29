import { describe, expect, test } from 'claude-code/testing'

import { BIDI_OVERRIDE, ROOT } from '../testkit'
import { launcherCommand, TERMINAL_MAC_ONLY, terminalPlan } from './terminal'
import type { TerminalPlan } from './terminal'

/** TMUX as tmux sets it inside a session: `<socket>,<server pid>,<session id>`. */
const TMUX = '/tmp/tmux-1/default,1,0'

/** The AppleScript lines that open a new Terminal window, each passed to osascript as one -e value (D-126). */
const TERMINAL_LINES = [
  'on run argv',
  'tell application "Terminal"',
  'activate',
  'do script (item 1 of argv)',
  'end tell',
  'end run',
]

/** The AppleScript lines that open a new iTerm tab, or a new window when none is open (D-126). */
const ITERM_LINES = [
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
]

/** The osascript argv that runs these lines, each as one -e value, with the shell text as the last argv item. */
function osascript(lines: readonly string[], shellText: string): string[] {
  return ['/usr/bin/osascript', ...lines.flatMap(line => ['-e', line]), shellText]
}

/** What Terminal.app and iTerm run for BE in /repo: go to the repo root, then run the launcher (D-126). */
const SHELL_TEXT = 'cd -- /repo && /repo/.cadre/bin/be'

/** The argv that opens BE in a new Terminal window. */
const TERMINAL_ARGV = osascript(TERMINAL_LINES, SHELL_TEXT)

/** The argv that opens BE in a new iTerm tab, or a new window when none is open. */
const ITERM_ARGV = osascript(ITERM_LINES, SHELL_TEXT)

/** What a tmux window runs after a launcher that exits non-zero: a note, then a wait for Enter (Pitfall 7). */
const TMUX_WAIT = "{ printf '%s\\n' 'cadre: the launcher stopped; press Enter to close this window'; read -r _; }"

/** The argv that opens BE in a new tmux window cadre-be at /repo, its command run by /bin/sh whatever tmux's shell. */
const TMUX_ARGV = [
  'tmux',
  'new-window',
  '-n',
  'cadre-be',
  '-c',
  '/repo',
  '/bin/sh',
  '-c',
  `/repo/.cadre/bin/be || ${TMUX_WAIT}`,
]

/** The plan that refuses with this text. */
function refusal(text: string): TerminalPlan {
  return { kind: 'refuse', text }
}

/** The refusal of a bare --terminal when TMUX is unset and TERM_PROGRAM, shown as given here, names no terminal. */
function unknownTerminal(shown: string): string {
  return (
    `--terminal could not tell this terminal (TERM_PROGRAM=${shown}): ` +
    'use --terminal=terminal, --terminal=iterm or --terminal=tmux, or run the command above yourself.'
  )
}

/** The refusal of --terminal with a value it does not take. */
const INVALID_TERMINAL = '--terminal takes terminal, iterm or tmux: run the command above yourself.'

/** What terminalPlan is given. */
type TerminalInput = Parameters<typeof terminalPlan>[0]

/** terminalPlan for BE in /repo with this choice, on macOS with TMUX and TERM_PROGRAM unset; `over` changes fields. */
function planFor(choice: TerminalInput['choice'], over: Partial<TerminalInput> = {}): TerminalPlan {
  return terminalPlan({
    choice,
    tmux: null,
    termProgram: null,
    isMacOs: true,
    id: 'be',
    root: ROOT,
    command: '/repo/.cadre/bin/be',
    ...over,
  })
}

/** The argv of a plan that opens a terminal; none for a refusal. */
function argvOf(plan: TerminalPlan): readonly string[] {
  return plan.kind === 'open' ? plan.argv : []
}

/** The plan that opens BE in a new Terminal window. */
const TERMINAL_PLAN: TerminalPlan = { kind: 'open', name: 'Terminal window', argv: TERMINAL_ARGV }

/** The plan that opens BE in a new iTerm tab or window: the script does not say which it made. */
const ITERM_PLAN: TerminalPlan = { kind: 'open', name: 'iTerm tab or window', argv: ITERM_ARGV }

/** The plan that opens BE in a new tmux window. */
const TMUX_PLAN: TerminalPlan = { kind: 'open', name: 'tmux window', argv: TMUX_ARGV }

describe('copy and terminal (D-109, D-110)', () => {
  test('off macOS every --terminal refuses with TERMINAL_MAC_ONLY, whatever the variables say (D-132)', () => {
    const choices: TerminalInput['choice'][] = ['auto', 'terminal', 'iterm', 'tmux', 'invalid']

    expect(TERMINAL_MAC_ONLY).toBe('--terminal works on macOS only: run the command above in a terminal yourself.')
    for (const choice of choices) {
      const plan = planFor(choice, { isMacOs: false, tmux: TMUX, termProgram: 'Apple_Terminal' })

      expect([choice, plan]).toEqual([choice, refusal(TERMINAL_MAC_ONLY)])
    }
  })

  test('auto opens a tmux window when TMUX is set, over any TERM_PROGRAM; it waits for Enter on a failure', () => {
    expect(planFor('auto', { tmux: TMUX })).toEqual(TMUX_PLAN)
    expect(planFor('auto', { tmux: TMUX, termProgram: 'Apple_Terminal' })).toEqual(TMUX_PLAN)
    expect(planFor('auto', { tmux: TMUX, termProgram: 'iTerm.app' })).toEqual(TMUX_PLAN)
  })

  test('auto opens a Terminal window for Apple_Terminal and an iTerm tab for iTerm.app, through osascript', () => {
    expect(planFor('auto', { termProgram: 'Apple_Terminal' })).toEqual(TERMINAL_PLAN)
    expect(planFor('auto', { termProgram: 'iTerm.app' })).toEqual(ITERM_PLAN)
  })

  test('auto refuses any other TERM_PROGRAM, shown cleaned, or none; a forced value skips detection', () => {
    expect(planFor('auto', { termProgram: 'herdr' })).toEqual(refusal(unknownTerminal('herdr')))
    expect(planFor('auto')).toEqual(refusal(unknownTerminal('unset')))
    expect(planFor('auto', { termProgram: `her${BIDI_OVERRIDE}dr` })).toEqual(refusal(unknownTerminal('herdr')))
    expect(planFor('terminal', { termProgram: 'herdr' })).toEqual(TERMINAL_PLAN)
    expect(planFor('iterm', { termProgram: 'Apple_Terminal' })).toEqual(ITERM_PLAN)
    expect(planFor('tmux', { termProgram: 'Apple_Terminal' })).toEqual(TMUX_PLAN)
  })

  test('invalid refuses on macOS, whatever the variables say', () => {
    expect(planFor('invalid')).toEqual(refusal(INVALID_TERMINAL))
    expect(planFor('invalid', { tmux: TMUX, termProgram: 'Apple_Terminal' })).toEqual(refusal(INVALID_TERMINAL))
  })

  test('a root with a space, a quote or a non-ASCII letter: one shell word, only in the last osascript item', () => {
    const root = `/Users/a b/caf${String.fromCharCode(233)}`
    const command = launcherCommand(root, 'be')
    const shellText = `cd -- '${root}' && '${root}/.cadre/bin/be'`
    const viaOsascript: TerminalInput['choice'][] = ['terminal', 'iterm']
    const quoted = "/w/my repo's"
    const quotedCommand = launcherCommand(quoted, 'be')

    expect(command).toBe(`'${root}/.cadre/bin/be'`)
    for (const choice of viaOsascript) {
      const argv = argvOf(planFor(choice, { root, command }))

      expect(argv.at(-1)).toBe(shellText)
      expect(argv.filter(item => item.includes(root))).toEqual([shellText])
    }
    expect(argvOf(planFor('tmux', { root, command }))).toEqual([
      'tmux',
      'new-window',
      '-n',
      'cadre-be',
      '-c',
      root,
      '/bin/sh',
      '-c',
      `${command} || ${TMUX_WAIT}`,
    ])
    expect(quotedCommand).toBe("'/w/my repo'\\''s/.cadre/bin/be'")
    expect(argvOf(planFor('terminal', { root: quoted, command: quotedCommand })).at(-1)).toBe(
      "cd -- '/w/my repo'\\''s' && '/w/my repo'\\''s/.cadre/bin/be'",
    )
  })
})
