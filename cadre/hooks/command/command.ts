/**
 * The command parser, a layer 9 module: the `/cadre` arguments as one command (help, detect, init, regen, start,
 * status, epic, epic done), with the text a reply echoes back cleaned of invisible characters and capped. It
 * imports core/role-id and the types, so register dispatches every /cadre command here.
 */
import type { CadreCommand, TerminalChoice } from '../../types'
import { ROLE_ID_PATTERN } from '../core/role-id'

/** The most code points a reply echoes back, the ellipsis included. */
const MAX_ECHOED = 40
/** Format characters (bidi overrides, zero-width space) a reply must not echo; removed outright. */
const INVISIBLE_CHARS = /\p{Cf}/gu
/** Control characters and line or paragraph separators; each becomes a space so separate words stay separate. */
const BREAK_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/gu

/**
 * Takes every `--name` switch (no value) out of the arguments, ignoring case; whether there was one. A switch is a
 * whole word, so `--dry-runner` is not `--dry-run`. Init answer parsing and the regen grammar reuse it, so every
 * command reads a switch the same way.
 */
export function takeSwitch(text: string, name: string): { isOn: boolean; rest: string } {
  const pattern = new RegExp(`\\s--${name}(?=\\s|$)`, 'gi')
  const rest = ` ${text}`.replace(pattern, '')

  return { isOn: rest.length !== text.length + 1, rest: rest.trim() }
}

/**
 * Removes INVISIBLE_CHARS, turns BREAK_CHARS into spaces, collapses runs of whitespace to one space, trims. Init answer
 * parsing and the plan and card renderers reuse it, so no reply echoes a hidden or line-breaking character.
 */
export function visibleText(raw: string): string {
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
 * The regen of one role (D-68), when the arguments after `regen` are one role id that matches ROLE_ID_PATTERN exactly,
 * with no case folding, and at most `--dry-run` on either side of it; null for anything else (D-48).
 */
function regenCommand(rest: string): CadreCommand | null {
  const dryRun = takeSwitch(rest, 'dry-run')
  if (!ROLE_ID_PATTERN.test(dryRun.rest)) return null

  return { kind: 'regen', id: dryRun.rest, dryRun: dryRun.isOn }
}

/** The places `--terminal=<value>` can name, as the value reads lowercased (D-109, D-126). */
const TERMINAL_VALUES: readonly TerminalChoice[] = Object.freeze(['terminal', 'iterm', 'tmux'])

/**
 * Takes every `--terminal` switch, with or without `=<value>`, out of the arguments as whole words in any letter case
 * (D-109): no switch is `none`; one bare switch is `auto`; one switch whose value, lowercased, is `terminal`, `iterm`
 * or `tmux` is that value; one with any other value, an empty one included, or two switches or more is `invalid`.
 */
function terminalOf(rest: string): { readonly terminal: TerminalChoice; readonly rest: string } {
  const pattern = /\s--terminal(?:=(\S*))?(?=\s|$)/gi
  const text = ` ${rest}`
  const matches = Array.from(text.matchAll(pattern))
  const left = text.replace(pattern, '').trim()
  if (matches.length === 0) return { terminal: 'none', rest: left }
  if (matches.length > 1) return { terminal: 'invalid', rest: left }
  const value = matches[0]?.[1]
  if (value === undefined) return { terminal: 'auto', rest: left }
  const named = TERMINAL_VALUES.find(choice => choice === value.toLowerCase())

  return { terminal: named ?? 'invalid', rest: left }
}

/**
 * The start of one role (LNCH-04), when the arguments after `start` are one role id that matches ROLE_ID_PATTERN
 * exactly, with no case folding, and the `--terminal` switches terminalOf takes, on either side of it; null for
 * anything else (D-48).
 */
function startCommand(rest: string): CadreCommand | null {
  const terminal = terminalOf(rest)
  if (!ROLE_ID_PATTERN.test(terminal.rest)) return null

  return { kind: 'start', id: terminal.rest, terminal: terminal.terminal }
}

/**
 * The status of one role (D-111), when the arguments after `status` are exactly one role id that matches
 * ROLE_ID_PATTERN, with no case folding and no switch; null for anything else (D-48).
 */
function statusCommand(rest: string): CadreCommand | null {
  const id = rest.trim()
  if (!ROLE_ID_PATTERN.test(id)) return null

  return { kind: 'status', id }
}

/**
 * The epic's worktree (D-145, D-167), when the arguments after `epic` hold at least one word besides the `--terminal`
 * switches terminalOf takes: the first word is the key as typed (epicKeyOf checks it later), the other words, joined by
 * one space, are the title, and the roles open where `--terminal` says, `auto` without it; null when no word is left.
 */
function epicCommand(rest: string): CadreCommand | null {
  const terminal = terminalOf(rest)
  const [key, ...title] = terminal.rest.split(/\s+/).filter(word => word !== '')
  if (key === undefined) return null

  return {
    kind: 'epic',
    key,
    title: title.join(' '),
    terminal: terminal.terminal === 'none' ? 'auto' : terminal.terminal,
  }
}

/**
 * The removal of a finished epic's worktree (D-152), when the arguments after `epic done` are exactly one word besides
 * the `--force` switches takeSwitch takes, on either side of it: that word is the key as typed (epicKeyOf checks it
 * later); null when no word or more than one is left.
 */
function epicDoneCommand(rest: string): CadreCommand | null {
  const force = takeSwitch(rest, 'force')
  const words = force.rest.split(/\s+/).filter(word => word !== '')
  const [key] = words
  if (key === undefined || words.length !== 1) return null

  return { kind: 'epic-done', key, force: force.isOn }
}

/**
 * `/cadre` arguments. Empty or `help` is the help text; `detect`, optionally with `--adapters`, is the
 * detection; `init`, optionally with `--dry-run`, is the guided setup; `regen` with one role id, optionally with
 * `--dry-run`, re-renders that role; `start` with one role id, optionally with `--terminal[=terminal|iterm|tmux]`,
 * renders that role's runtime files and prints its launcher command; `status` with exactly one role id reports that
 * role's autopilot run from disk; `epic` with a key and optional title words, optionally with
 * `--terminal[=terminal|iterm|tmux]`, creates or reuses the epic's worktree; `epic done`, `done` in any letter case as
 * the first word after `epic`, with one key and optionally `--force`, removes a finished epic's worktree (D-152).
 * Anything else is help with the input echoed back as unknown, `regen`, `start` or `status` with no id or with an id
 * that is not a slug, `epic` with no key, and `epic done` with no key or more than one word, included.
 */
export function parseCommand(args: string): CadreCommand {
  const text = visibleText(args)
  if (text === '' || text.toLowerCase() === 'help') return { kind: 'help', unknown: null }

  const detect = /^detect(?=\s|$)/i.exec(text)
  if (detect) return detectCommand(text.slice(detect[0].length)) ?? unknownCommand(text)

  const init = /^init(?=\s|$)/i.exec(text)
  if (init) return initCommand(text.slice(init[0].length)) ?? unknownCommand(text)

  const regen = /^regen(?=\s|$)/i.exec(text)
  if (regen) return regenCommand(text.slice(regen[0].length)) ?? unknownCommand(text)

  const start = /^start(?=\s|$)/i.exec(text)
  if (start) return startCommand(text.slice(start[0].length)) ?? unknownCommand(text)

  const status = /^status(?=\s|$)/i.exec(text)
  if (status) return statusCommand(text.slice(status[0].length)) ?? unknownCommand(text)

  const epicDone = /^epic\s+done(?=\s|$)/i.exec(text)
  if (epicDone) return epicDoneCommand(text.slice(epicDone[0].length)) ?? unknownCommand(text)

  const epic = /^epic(?=\s|$)/i.exec(text)
  if (epic) return epicCommand(text.slice(epic[0].length)) ?? unknownCommand(text)

  return unknownCommand(text)
}
