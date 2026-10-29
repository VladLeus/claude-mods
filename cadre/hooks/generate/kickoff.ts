/**
 * The kickoff, a layer 6 module: the text of `.cadre/<id>/kickoff.txt`, the positional autopilot command whose short
 * ASCII role line says who the role is, where its ROLE.md is and what it starts with (D-48, D-79, D-114). It imports
 * the framework registry and the types, so the file set, epic and the probe read it here.
 */
import type { FrameworkId, RoleSpec } from '../../types'
import { adapterOf } from '../framework/registry'

/**
 * The most characters the role line of a kickoff may have (D-79; 240 since the inbox sentence of D-114,
 * decisions #32/#39).
 */
export const ROLE_LINE_MAX = 240

/** What the role line drops: any character outside printable ASCII, and the quote and backtick characters. */
const NOT_ROLE_LINE_CHAR = /[^\x20-\x7e]|["'`]/g

/**
 * Text as one line of printable ASCII, for the role line of a kickoff (D-79): whitespace of any kind becomes a space,
 * every character outside printable ASCII is dropped, and so are the quote characters and the backtick, which could end
 * the quoted role in autopilot's grammar or open a command in a shell. Runs of spaces collapse to one and the ends are
 * trimmed. The text is cut to maxChars characters without a trailing space, and a cap below 1 gives ''.
 */
export function asciiLine(text: string, maxChars: number): string {
  const kept = text.replace(/\s+/g, ' ').replace(NOT_ROLE_LINE_CHAR, '')

  return kept.replace(/ +/g, ' ').trim().slice(0, Math.max(0, maxChars)).trimEnd()
}

/** What the role line starts the session with: the GSD workflow, a superpowers skill, or the built-in plan file. */
function startText(roleId: string, framework: FrameworkId): string {
  return adapterOf(framework).roleStart(roleId)
}

/**
 * The role line around a title: the title goes in the sentence, the role id in every path (D-48). The role reads its
 * ROLE.md and checks its inbox before it starts (D-114: text only, no new command).
 */
function roleSentence(role: RoleSpec, framework: FrameworkId, title: string): string {
  const intro = `You are the ${title} role of this repo (cadre role ${role.id}).`
  const next = `Read .cadre/${role.id}/ROLE.md, check your inbox, then start with ${startText(role.id, framework)}.`

  return `${intro} ${next}`
}

/**
 * A role line whose title is budgeted (D-79): `sentence` puts a title into the line's fixed text, the role title gets
 * what ROLE_LINE_MAX leaves once that text is in, so a long title never cuts off the instruction at the end, a title
 * with no ASCII character left gives way to the role id, and the whole line is then capped. The kickoff of init and the
 * epic kickoff of a worker build their lines with it (SHOULD 3).
 */
export function budgetedRoleLine(role: RoleSpec, sentence: (title: string) => string): string {
  const room = ROLE_LINE_MAX - sentence('').length
  const own = asciiLine(role.title, room)
  const title = own === '' ? asciiLine(role.id, room) : own

  return asciiLine(sentence(title), ROLE_LINE_MAX)
}

/**
 * The short ASCII role line of a kickoff (D-79): who the role is, where its ROLE.md is, and what to start with. The
 * title is cut to what is left of ROLE_LINE_MAX once the fixed text is in, so a long title never cuts off the
 * instruction at the end, and a title with no ASCII character left gives way to the role id. The line has no quote or
 * backtick character, so it sits inside the quotes of the autopilot command.
 */
export function kickoffRoleLine(role: RoleSpec, framework: FrameworkId): string {
  return budgetedRoleLine(role, title => roleSentence(role, framework, title))
}

/**
 * The positional autopilot command of a kickoff (D-79): `/autopilot <duration> <threshold> "<line>"`, then `flag`
 * (` --ask-user` or '') outside the quotes, and a newline. `line` is already one line of printable ASCII with no quote
 * or backtick (asciiLine), so it is the only quoted text. The kickoff of init and the epic kickoff build their text
 * with it (SHOULD 3).
 */
export function autopilotCommand(duration: string, threshold: number, line: string, flag: string): string {
  return `/autopilot ${duration} ${threshold} "${line}"${flag}\n`
}

/**
 * The text of `.cadre/<id>/kickoff.txt` (D-79): the positional autopilot command `/autopilot <duration> <threshold>
 * "<role line>"`, with ` --ask-user` for a role that asks the person, and a newline. The role line is the only quoted
 * text, so autopilot reads the switch outside it.
 */
export function kickoffText(role: RoleSpec, framework: FrameworkId): string {
  const { duration, threshold, askUser } = role.autopilot
  const flag = askUser ? ' --ask-user' : ''

  return autopilotCommand(duration, threshold, kickoffRoleLine(role, framework), flag)
}
