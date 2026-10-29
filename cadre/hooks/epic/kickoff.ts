/**
 * The epic kickoff of a role (D-158 to D-160), a layer 11 module: the text /cadre epic writes to a role's
 * `.runtime/kickoff.txt`, the positional autopilot command whose ASCII line tells PM to fetch the epic and feed its
 * tickets, and every other role to wait for its parent (epicKickoffText); with EpicWorktree, the worktree as runEpic
 * hands it to its mirror stage. It is pure and imports generate/kickoff and the types; epic/create reads it.
 */
import type { EpicRecord, RoleSpec } from '../../types'
import { asciiLine, autopilotCommand, budgetedRoleLine, ROLE_LINE_MAX } from '../generate/kickoff'

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
  return tlId === null ? 'your roles' : `cadre-${tlId}`
}

/** What stands between the epic key and its title in PM's epic kickoff line (D-158). */
const TITLE_SEPARATOR = ': '

/**
 * The role line of PM's epic kickoff (D-158): the epic key, and its title when there is one, then what PM does first:
 * read its ROLE.md and inbox, fetch the epic with its tracker MCP, resolve its gaps (decide, or ask the user), then
 * feed `target` ticket by ticket (D-144).
 */
function pmEpicSentence(id: string, key: string, title: string, target: string): string {
  const epic = title === '' ? key : `${key}${TITLE_SEPARATOR}${title}`
  const next =
    `Read .cadre/${id}/ROLE.md and your inbox, fetch the epic with your tracker MCP, resolve its gaps ` +
    `(decide or ask the user), then feed ${target} ticket by ticket.`

  return `You are the PM of epic ${epic}. ${next}`
}

/**
 * The role line of a worker's epic kickoff (D-158): who the role is, the epic key and its ROLE.md, then the wait for
 * its parent's session `cadre-<parent>` with wait_for reason session-answer, and to work what it sends. With no parent
 * named it waits with no `from`, so it never names a session that is not its parent.
 */
function workerEpicSentence(id: string, key: string, title: string, parent: string | null): string {
  const from = parent === null ? '' : ` from cadre-${parent}`
  const wait = `wait for your parent: wait_for reason session-answer${from}, then work what it sends.`

  return `You are ${title} (cadre role ${id}) on epic ${key}. Read .cadre/${id}/ROLE.md, then ${wait}`
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
 * A worker's epic kickoff line (D-158), as kickoffRoleLine budgets its title: the role title gets what ROLE_LINE_MAX
 * leaves once the rest of the line is in, a title with no ASCII character left gives way to the role id, and the whole
 * line is then capped.
 */
function workerEpicLine(role: RoleSpec, key: string, parent: string | null): string {
  return budgetedRoleLine(role, title => workerEpicSentence(role.id, key, title, parent))
}

/**
 * The epic kickoff of a role, the text /cadre epic writes to its `.runtime/kickoff.txt` (D-158 to D-160): D-79's
 * positional autopilot command `/autopilot <duration> <threshold> "<line>"` with the role's own duration and threshold,
 * and a newline. PM's line names the epic key and title and says to fetch the epic with its tracker MCP, resolve its
 * gaps (decide or ask the user) and feed the TL `tlId`, else its roles, ticket by ticket, and it ends ` --ask-user`
 * whatever its role.json says, as PM is the one role that asks the user (D-144). Every other role's line names the role
 * and the key and says to wait for its parent's session `cadre-<parent>` (epicParentOf) with wait_for reason
 * session-answer, then work what it sends, and it never carries ` --ask-user` (D-160). Each line is one line of
 * printable ASCII with no quote or backtick (asciiLine), so it sits inside the command's quotes, at most ROLE_LINE_MAX
 * long: the epic title (PM) or the role title is cut first, so the key stays whole and the line keeps its end whenever
 * the line with no title fits.
 */
export function epicKickoffText(input: {
  readonly role: RoleSpec
  readonly key: string
  readonly title: string
  readonly isPm: boolean
  readonly parent: string | null
  readonly tlId: string | null
}): string {
  const { role, key, title, parent, tlId } = input
  const { duration, threshold } = role.autopilot
  if (!input.isPm) return autopilotCommand(duration, threshold, workerEpicLine(role, key, parent), '')

  return autopilotCommand(duration, threshold, pmEpicLine(role.id, key, title, feedTarget(tlId)), ' --ask-user')
}
