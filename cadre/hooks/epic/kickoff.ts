/**
 * The epic kickoff of a role (D-158 to D-160), a layer 11 module: the text /cadre epic writes to a role's
 * `.runtime/kickoff.txt`, the positional autopilot command whose ASCII line tells PM to fetch the epic and feed its
 * tickets, and every other role to wait for its parent (epicKickoffText); with EpicWorktree, the worktree as runEpic
 * hands it to its mirror stage. It is pure and imports generate/kickoff and the types; epic/create reads it.
 */
import type { EpicRecord, RoleSpec } from '../../types'
import { asciiLine, autopilotCommand, budgetedRoleLine, KICKOFF_LOAD_TOOLS, ROLE_LINE_MAX } from '../generate/kickoff'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'

/** The epic worktree as runEpic hands it to its mirror stage once git has made or found it (D-147, D-164). */
export type EpicWorktree = {
  readonly path: string
  readonly branch: string
  readonly outcome: 'created' | 'reused' | 're-added'
  /** The title the reply shows. */
  readonly title: string
  /** The worktree's git dir as git named it; anything but an absolute path means git named none. */
  readonly gitDir: string
  /** The record to write once the mirror ran: the one on disk, or a new one with what this run can name. */
  readonly record: EpicRecord
}

/**
 * Whom PM feeds the epic's tickets (D-144): the TL's session `cadre-<tl id>` when the team has a TL, else its roles.
 */
function feedTarget(tlId: string | null): string {
  return tlId === null ? PROMPTS.epicFeedRoles : `cadre-${tlId}`
}

/** What stands between the epic key and its title in PM's epic kickoff line (D-158). */
const TITLE_SEPARATOR = ': '

/**
 * The role line of PM's epic kickoff: the epic key, and its title when there is one, then what PM does first: read its
 * ROLE.md and inbox, get the epic, grill the user as ROLE.md says, then feed `target` ticket by ticket.
 */
function pmEpicSentence(id: string, key: string, title: string, target: string): string {
  const epic = title === '' ? key : `${key}${TITLE_SEPARATOR}${title}`
  const next = fill(PROMPTS.epicPmNext, { id, target })

  return fill(PROMPTS.epicPmLine, { epic, next })
}

/**
 * The role line of every epic role but PM: it waits with wait_for reason idle-inbox and no timeout for its parent
 * `cadre-<parent>` (no `from` without one), reads its inbox, then runs TL's ticket loop or works what the parent sends.
 */
function workerEpicSentence(id: string, key: string, title: string, parent: string | null, isTl: boolean): string {
  const from = parent === null ? '' : fill(PROMPTS.epicFrom, { parent })
  const wait = fill(isTl ? PROMPTS.epicTlWait : PROMPTS.epicWait, { from })

  return fill(PROMPTS.epicWorkerLine, { title, id, key, wait })
}

/**
 * PM's epic kickoff line (D-158): the epic title, with its separator, gets what ROLE_LINE_MAX leaves once the rest of
 * the line is in, so a long title never cuts off the instruction at the end; the whole line is then capped.
 */
function pmEpicLine(id: string, key: string, title: string, target: string): string {
  const room = ROLE_LINE_MAX - pmEpicSentence(id, key, '', target).length - TITLE_SEPARATOR.length
  const kept = asciiLine(title, room)

  return asciiLine(pmEpicSentence(id, key, kept, target), ROLE_LINE_MAX)
}

/**
 * The epic kickoff line of every role but PM, as kickoffRoleLine budgets its title: the role title gets what
 * ROLE_LINE_MAX leaves once the rest of the line is in, a title with no ASCII character left gives way to the role id,
 * and the whole line is then capped.
 */
function workerEpicLine(role: RoleSpec, key: string, parent: string | null, isTl: boolean): string {
  return budgetedRoleLine(role, title => workerEpicSentence(role.id, key, title, parent, isTl))
}

/**
 * The text /cadre epic writes to a role's `.runtime/kickoff.txt`. PM feeds the epic's tickets and always asks the user
 * (` --ask-user` whatever role.json says); every other role waits with wait_for reason idle-inbox and no timeout and
 * never asks. Each line keeps the key whole within ROLE_LINE_MAX by cutting the title first, then ends with the tool
 * load sentence.
 */
export function epicKickoffText(input: {
  readonly role: RoleSpec
  readonly key: string
  readonly title: string
  readonly isPm: boolean
  readonly parent: string | null
  readonly tlId: string | null
}): string {
  const { role, key, title, isPm, parent, tlId } = input
  const { duration, threshold } = role.autopilot
  const line = isPm
    ? pmEpicLine(role.id, key, title, feedTarget(tlId))
    : workerEpicLine(role, key, parent, role.id === tlId)
  const flag = isPm ? ' --ask-user' : ''

  return autopilotCommand(duration, threshold, `${line} ${KICKOFF_LOAD_TOOLS}`, flag)
}
