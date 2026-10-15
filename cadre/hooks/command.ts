import type { CadreCommand } from '../types'

/** The most code points a reply echoes back, the ellipsis included. */
const MAX_ECHOED = 40
/** Format characters (bidi overrides, zero-width space) a reply must not echo; removed outright. */
const INVISIBLE_CHARS = /\p{Cf}/gu
/** Control characters and line or paragraph separators; each becomes a space so separate words stay separate. */
const BREAK_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/gu
/** Width, in characters, the command column is padded to in the usage lines. */
const COMMAND_COLUMN = 27

/**
 * The lines `/cadre` prints: a title, then the two commands and what each one shows.
 * These are the only commands Phase 1 offers, so no other command is listed.
 */
export const USAGE_LINES: readonly string[] = [
  'cadre commands:',
  `  ${'/cadre detect'.padEnd(COMMAND_COLUMN)}show which dev framework this repo uses, with evidence (read-only)`,
  `  ${'/cadre detect --adapters'.padEnd(COMMAND_COLUMN)}also show the contract cadre would drive each framework with`,
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

/**
 * `/cadre` arguments. Empty or `help` is the help text; `detect`, optionally with `--adapters`, is the
 * detection; anything else is help with the input echoed back as unknown.
 */
export function parseCommand(args: string): CadreCommand {
  const text = visibleText(args)
  if (text === '' || text.toLowerCase() === 'help') return { kind: 'help', unknown: null }

  const head = /^detect(?=\s|$)/i.exec(text)
  if (!head) return { kind: 'help', unknown: echoed(text) }

  const adapters = takeSwitch(text.slice(head[0].length), 'adapters')
  if (adapters.rest !== '') return { kind: 'help', unknown: echoed(text) }

  return { kind: 'detect', adapters: adapters.isOn }
}

/**
 * The reply to `/cadre` without a command, or with unknown input: the usage lines, preceded by an
 * `Unknown subcommand:` line when the input was not a known command.
 */
export function helpText(unknown: string | null): string {
  if (unknown === null) return USAGE_LINES.join('\n')

  return [`Unknown subcommand: ${unknown}`, ...USAGE_LINES].join('\n')
}
