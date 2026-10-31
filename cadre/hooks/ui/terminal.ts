/**
 * The terminal plan, a layer 8 module: the launcher command, its copy to the clipboard (D-110) and where --terminal
 * opens it, as an argv or a refusal (D-109, D-126, D-132), with the AppleScript and tmux texts it runs. It imports the
 * launcher's shell quoting, paths, core and the types, so /cadre start and /cadre epic read it here.
 */
import type { RunOptions, TerminalChoice } from '../../types'
import { reportText } from '../core/text'
import { shQuote } from '../generate/launcher'
import { CONTRACTS, ITERM_LINES, TERMINAL_APP_LINES } from '../locales/contracts'
import { t } from '../locales/t'
import { launcherPath } from '../paths'

/** The command that starts a role: the absolute path of its launcher `<root>/.cadre/bin/<id>`, as one shell word. */
export function launcherCommand(root: string, id: string): string {
  return shQuote(`${root}/${launcherPath(id)}`)
}

/** How long pbcopy may run before it is given up. */
const CLIPBOARD_TIMEOUT_MS = 5_000

/** The line below the launcher command when pbcopy copied it (D-110). */
export const COPIED_LINE = t('ui.terminal.copiedLine')

/**
 * The line below the launcher command when it could not be copied (D-110, D-132): pbcopy is macOS only, and a host
 * without it, or a copy that fails, still has the command printed above, so this is not an error.
 */
export const NOT_COPIED_LINE = t('ui.terminal.notCopiedLine')

/**
 * The run that copies the launcher command to the clipboard (D-110): `/usr/bin/pbcopy`, absolute and with no shell,
 * given the command on stdin and LC_CTYPE=UTF-8, without which pbcopy mangles a non-ASCII letter of the path (RESEARCH
 * Pitfall 8). pbcopy is macOS only, so a run that cannot start or exits non-zero is not an error: the command is
 * printed all the same (D-132).
 */
export function clipboardRun(command: string): { readonly argv: readonly string[]; readonly options: RunOptions } {
  return {
    argv: ['/usr/bin/pbcopy'],
    options: { stdin: command, env: { LC_CTYPE: 'UTF-8' }, timeoutMs: CLIPBOARD_TIMEOUT_MS },
  }
}

/** The refusal of `--terminal` on a host that is not macOS (D-132): the command is printed and copied all the same. */
export const TERMINAL_MAC_ONLY = t('ui.terminal.terminalMacOnly')

/** The refusal of `--terminal` with a value it does not take, or the switch given twice (D-109). */
const TERMINAL_INVALID = t('ui.terminal.terminalInvalid')

/**
 * The refusal of a bare `--terminal` outside tmux when TERM_PROGRAM names no terminal cadre opens (D-109): it names
 * TERM_PROGRAM, shown cleaned, or `unset`.
 */
function terminalUnknownText(termProgram: string | null): string {
  const shown = termProgram === null ? 'unset' : reportText(termProgram)

  return (
    t('ui.terminal.terminalUnknownText', {
      shown,
    })
  )
}

/**
 * What a tmux window runs after a launcher that exits non-zero: a note, then a wait for Enter, so the launcher's
 * refusal stays on screen and does not close with the window (RESEARCH Pitfall 7).
 */
const TMUX_WAIT = CONTRACTS.tmuxWait

/**
 * What the reply names an iTerm open: ITERM_LINES make a tab in the current window, or a window when none is open,
 * and do not say which, so the name covers both (#63).
 */
const ITERM_NAME = t('ui.terminal.itermName')

/**
 * The osascript argv that runs these AppleScript lines, each as one `-e` value, with the shell text as the last argv
 * item: the script reads it through `on run argv`, so no AppleScript is ever built from it (T-03-29).
 */
function osascriptArgv(lines: readonly string[], shellText: string): readonly string[] {
  return Object.freeze(['/usr/bin/osascript', ...lines.flatMap(line => ['-e', line]), shellText])
}

/**
 * The tmux argv that opens the command in a new window `cadre-<id>` at the root (D-126). tmux would run a single
 * command argument with its default-shell, which may be fish or another shell that cannot parse TMUX_WAIT, so the
 * window runs `/bin/sh -c` with the shell text as separate argv items, which tmux 3.0 and later run with no shell
 * between (#63 A5): the command, a shell word already, followed by TMUX_WAIT for when it fails.
 */
function tmuxArgv(id: string, root: string, command: string): readonly string[] {
  const shellText = `${command} || ${TMUX_WAIT}`

  return Object.freeze(['tmux', 'new-window', '-n', `cadre-${id}`, '-c', root, '/bin/sh', '-c', shellText])
}

/**
 * Where `/cadre start --terminal` opens the launcher command (D-109, D-126): the name of what it opens and the argv
 * that opens it, or the refusal to print instead. The command is printed and copied either way.
 */
export type TerminalPlan =
  | { readonly kind: 'open'; readonly name: string; readonly argv: readonly string[] }
  | { readonly kind: 'refuse'; readonly text: string }

/** What a bare `--terminal` picks (D-109): tmux when TMUX is set, else the macOS terminal TERM_PROGRAM names. */
function detectedTerminal(
  tmux: string | null,
  termProgram: string | null,
): Exclude<TerminalChoice, 'none' | 'auto' | 'invalid'> | null {
  if (tmux !== null) return 'tmux'
  if (termProgram === 'Apple_Terminal') return 'terminal'
  if (termProgram === 'iTerm.app') return 'iterm'

  return null
}

/**
 * Where `--terminal` opens the launcher command, as data (D-109, D-126, D-132). Off macOS it refuses with
 * TERMINAL_MAC_ONLY, whatever the choice, and `invalid` refuses. A forced value skips detection; `auto` picks tmux when
 * TMUX is set, else a Terminal window for TERM_PROGRAM `Apple_Terminal` and an iTerm tab for `iTerm.app`, and refuses
 * any other TERM_PROGRAM, or none. Terminal.app and iTerm get the shell text `cd -- <root> && <command>`, the root
 * shQuote'd, as the last osascript argv item, which `on run argv` reads and no AppleScript is built from (T-03-29):
 * Terminal.app opens a new window (`do script`), iTerm a new tab in its current window, or a new window when none is
 * open, named ITERM_NAME. tmux opens a new window `cadre-<id>` at the root whose command, run by `/bin/sh -c`, waits
 * for Enter when the launcher fails (Pitfall 7).
 */
export function terminalPlan(input: {
  readonly choice: Exclude<TerminalChoice, 'none'>
  readonly tmux: string | null
  readonly termProgram: string | null
  readonly isMacOs: boolean
  readonly id: string
  readonly root: string
  readonly command: string
}): TerminalPlan {
  const { choice, tmux, termProgram, isMacOs, id, root, command } = input
  if (!isMacOs) return { kind: 'refuse', text: TERMINAL_MAC_ONLY }
  if (choice === 'invalid') return { kind: 'refuse', text: TERMINAL_INVALID }
  const terminal = choice === 'auto' ? detectedTerminal(tmux, termProgram) : choice
  if (terminal === null) return { kind: 'refuse', text: terminalUnknownText(termProgram) }
  if (terminal === 'tmux') return { kind: 'open', name: t('ui.terminal.tmuxName'), argv: tmuxArgv(id, root, command) }
  const shellText = `cd -- ${shQuote(root)} && ${command}`
  if (terminal === 'iterm') return { kind: 'open', name: ITERM_NAME, argv: osascriptArgv(ITERM_LINES, shellText) }

  return { kind: 'open', name: t('ui.terminal.terminalName'), argv: osascriptArgv(TERMINAL_APP_LINES, shellText) }
}

/** How long `uname -s` may run before it is given up. */
export const UNAME_TIMEOUT_MS = 5_000

/** How long opening a terminal may run before it is given up: osascript may wait on the Automation consent prompt. */
export const TERMINAL_OPEN_TIMEOUT_MS = 15_000
