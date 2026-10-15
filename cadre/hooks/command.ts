import type { CadreCommand } from '../types'

const MAX_ECHOED = 40
/** Characters a reply must not echo: control, format, line and paragraph separators (bidi overrides are format characters). */
const INVISIBLE_ALL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
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

/** Takes every `--name` switch (no value) out of the arguments; whether there was one. */
function takeSwitch(text: string, name: string): { isOn: boolean; rest: string } {
  const pattern = new RegExp(`\\s--${name}(?=\\s|$)`, 'g')
  const rest = ` ${text}`.replace(pattern, '')

  return { isOn: rest.length !== text.length + 1, rest: rest.trim() }
}

/** The person's input as a reply shows it: invisible characters out, at most 40 code points, the last one an ellipsis when cut. */
function echoed(raw: string): string {
  const visible = Array.from(raw.replace(INVISIBLE_ALL, ''))
  if (visible.length <= MAX_ECHOED) return visible.join('')

  return `${visible.slice(0, MAX_ECHOED - 1).join('')}…`
}

/**
 * `/cadre` arguments. Empty or `help` is the help text; `detect`, optionally with `--adapters`, is the
 * detection; anything else is help with the input echoed back as unknown.
 */
export function parseCommand(args: string): CadreCommand {
  const text = args.trim()
  if (text === '' || text.toLowerCase() === 'help') return { kind: 'help', unknown: null }

  const word = /^detect(?=\s|$)/i.exec(text)
  if (!word) return { kind: 'help', unknown: echoed(text) }

  const switched = takeSwitch(text.slice(word[0].length), 'adapters')
  if (switched.rest !== '') return { kind: 'help', unknown: echoed(text) }

  return { kind: 'detect', adapters: switched.isOn }
}

/**
 * The reply to `/cadre` without a command, or with unknown input: the usage lines, preceded by an
 * `Unknown subcommand:` line when the input was not a known command.
 */
export function helpText(unknown: string | null): string {
  if (unknown === null) return USAGE_LINES.join('\n')

  return [`Unknown subcommand: ${unknown}`, ...USAGE_LINES].join('\n')
}
