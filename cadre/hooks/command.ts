import type { CadreCommand } from '../types'

/** The most code points a reply echoes back, the ellipsis included. */
const MAX_ECHOED = 40
/** Format characters (bidi overrides, zero-width space) a reply must not echo; removed outright. */
const INVISIBLE_CHARS = /\p{Cf}/gu
/** Control characters and line or paragraph separators; each becomes a space so separate words stay separate. */
const BREAK_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/gu
/** Width, in characters, the command column is padded to in the usage lines; the usage rows and their tests share it. */
export const COMMAND_COLUMN = 30

/** A role id (D-48): a lowercase slug of 1 to 24 characters, so `/`, `..` and spaces are impossible. */
export const ROLE_ID_PATTERN = /^[a-z][a-z0-9-]{0,23}$/

/**
 * The lines `/cadre` prints: a title, then each command and what it shows. A command that writes nothing says so,
 * and every row starts its description in the same column.
 */
export const USAGE_LINES: readonly string[] = [
  'cadre commands:',
  `  ${'/cadre detect'.padEnd(COMMAND_COLUMN)}show which dev framework this repo uses, with evidence (read-only)`,
  `  ${'/cadre detect --adapters'.padEnd(COMMAND_COLUMN)}also show the contract cadre would drive each framework with`,
  `  ${'/cadre init'.padEnd(COMMAND_COLUMN)}guided setup: scan, propose roles, show the file plan (writes nothing yet)`,
  `  ${'/cadre init --dry-run'.padEnd(COMMAND_COLUMN)}the same guided flow; prints the plan and writes nothing`,
]

/** Takes every `--name` switch (no value) out of the arguments, ignoring case; whether there was one. */
function takeSwitch(text: string, name: string): { isOn: boolean; rest: string } {
  const pattern = new RegExp(`\\s--${name}(?=\\s|$)`, 'gi')
  const rest = ` ${text}`.replace(pattern, '')

  return { isOn: rest.length !== text.length + 1, rest: rest.trim() }
}

/** Removes INVISIBLE_CHARS, turns BREAK_CHARS into spaces, collapses runs of whitespace to one space, trims. */
function visibleText(raw: string): string {
  return raw.replace(INVISIBLE_CHARS, '').replace(BREAK_CHARS, ' ').replace(/\s+/g, ' ').trim()
}

/** The already-visible input as a reply shows it: at most 40 code points, the last one an ellipsis when cut. */
function echoed(raw: string): string {
  const points = Array.from(raw)
  if (points.length <= MAX_ECHOED) return raw

  return `${points.slice(0, MAX_ECHOED - 1).join('')}\u2026`
}

/** The help reply for input that is not a command: the help text, with the input echoed back as unknown. */
function unknownCommand(text: string): CadreCommand {
  return { kind: 'help', unknown: echoed(text) }
}

/** The detection, when the arguments after `detect` are only `--adapters`; null when anything else follows. */
function detectCommand(rest: string): CadreCommand | null {
  const adapters = takeSwitch(rest, 'adapters')
  if (adapters.rest !== '') return null

  return { kind: 'detect', adapters: adapters.isOn }
}

/** The guided setup, when the arguments after `init` are only `--dry-run`; null when anything else follows. */
function initCommand(rest: string): CadreCommand | null {
  const dryRun = takeSwitch(rest, 'dry-run')
  if (dryRun.rest !== '') return null

  return { kind: 'init', dryRun: dryRun.isOn }
}

/**
 * `/cadre` arguments. Empty or `help` is the help text; `detect`, optionally with `--adapters`, is the
 * detection; `init`, optionally with `--dry-run`, is the guided setup; anything else is help with the input
 * echoed back as unknown.
 */
export function parseCommand(args: string): CadreCommand {
  const text = visibleText(args)
  if (text === '' || text.toLowerCase() === 'help') return { kind: 'help', unknown: null }

  const detect = /^detect(?=\s|$)/i.exec(text)
  if (detect) return detectCommand(text.slice(detect[0].length)) ?? unknownCommand(text)

  const init = /^init(?=\s|$)/i.exec(text)
  if (init) return initCommand(text.slice(init[0].length)) ?? unknownCommand(text)

  return unknownCommand(text)
}

/**
 * The reply to `/cadre` without a command, or with unknown input: the usage lines, preceded by an
 * `Unknown subcommand:` line when the input was not a known command.
 */
export function helpText(unknown: string | null): string {
  if (unknown === null) return USAGE_LINES.join('\n')

  return [`Unknown subcommand: ${unknown}`, ...USAGE_LINES].join('\n')
}
