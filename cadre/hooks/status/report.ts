/**
 * The report of /cadre status (D-111, D-131, LNCH-06), a layer 10 module: the role's newest handoff below its start
 * folder (handoffOf), whether a built-in role's DONE.md marker is there (hasDoneMarker, D-17), and statusReportText,
 * which puts what /cadre status found for one role into words. It reads through the InitIo port only; it imports
 * core, paths and the other status modules, and status/run reads it.
 */
import type { InitIo, PortEntry } from '../../types'
import { reportText } from '../core/text'
import { handoffFolderOf, trimSlash } from '../paths'
import { NO_LOG_LINE } from './autopilot-files'
import type { StatusState } from './autopilot-files'
import { isRegularFile, newestFirst, sessionName } from './session-find'

/** What `/cadre status <id>` found for one role, before statusReportText puts it into words. */
export type StatusReport = {
  /** The role id, a slug (D-48). */
  readonly id: string
  readonly state: StatusState
  /** The session the role's run is in; null when none was found. */
  readonly sessionId: string | null
  /** How the session was found: by the title of its transcript, by its fleet beat, or null when it was not found. */
  readonly foundBy: 'title' | 'beat' | null
  /** The text of autopilot's last log line, cleaned and capped (lastLogText); null when there is none. */
  readonly lastLog: string | null
  /** The newest handoff, as a path below the start folder; null when there is none. */
  readonly handoff: string | null
  /** Whether the built-in framework's DONE.md marker is there; null for a role on another framework (D-17). */
  readonly doneMarker: boolean | null
}

/** The end of a handoff's file name. */
const HANDOFF_SUFFIX = '.md'

/** The report's line when the built-in DONE.md marker is there, and when it is not (D-17). */
const DONE_MARKER_LINES = Object.freeze({ present: 'DONE.md: present', absent: 'DONE.md: not written yet' })

/**
 * The newest handoff a role's handoff folder lists: the name of its newest regular `.md` file, never a link, by
 * modification time (a tie by name); null when there is none.
 */
export function newestHandoff(entries: readonly PortEntry[]): string | null {
  const handoffs = entries.filter(entry => isRegularFile(entry) && entry.name.endsWith(HANDOFF_SUFFIX))

  return newestFirst(handoffs)[0]?.name ?? null
}

/**
 * The role's newest handoff under the folder its session started in, where autopilot keeps handoffs, as a path below
 * that folder: `thoughts/shared/handoffs/<id>/<name>` (newestHandoff). Null when the folder is not known (a here start
 * with no beat) or cannot be listed, or holds no handoff.
 */
export async function handoffOf(io: InitIo, folder: string | null, id: string): Promise<string | null> {
  if (folder === null) return null
  const handoffs = handoffFolderOf(id)
  const entries = await io.list(`${trimSlash(folder)}/${handoffs}`)
  if (entries === null) return null
  const name = newestHandoff(entries)

  return name === null ? null : `${handoffs}/${name}`
}

/** Whether the built-in done marker of the role, `<root>/.cadre/<id>/.runtime/DONE.md`, is a file (D-17). */
export async function hasDoneMarker(io: InitIo, root: string, id: string): Promise<boolean> {
  const stat = await io.stat(`${trimSlash(root)}/.cadre/${id}/.runtime/DONE.md`)

  return stat !== null && stat.kind === 'file'
}

/** The report's session line: the session and how it was found, or that none was found under the role's name. */
function sessionLine(report: StatusReport): string {
  const { id, sessionId, foundBy } = report
  if (sessionId === null || foundBy === null) return `session: none found for ${sessionName(id)}`
  const how = foundBy === 'title' ? `its name ${sessionName(id)}` : 'its fleet beat'

  return `session: ${sessionId} (found by ${how})`
}

/** The report's DONE.md line for a role on the built-in framework; none for a role on another framework (D-17). */
function doneMarkerLines(doneMarker: boolean | null): string[] {
  if (doneMarker === null) return []

  return [doneMarker ? DONE_MARKER_LINES.present : DONE_MARKER_LINES.absent]
}

/**
 * The `/cadre status` reply (D-111): what was asked for, the state, the session and how it was found, autopilot's last
 * log line, and the latest handoff, one per line, then, for a role on the built-in framework, whether its DONE.md
 * marker is there (D-17). The handoff name comes from a listing, so it is shown cleaned.
 */
export function statusReportText(report: StatusReport): string {
  return [
    `cadre status ${report.id}`,
    `state: ${report.state}`,
    sessionLine(report),
    `autopilot: ${report.lastLog ?? NO_LOG_LINE}`,
    `latest handoff: ${report.handoff === null ? 'none yet' : reportText(report.handoff)}`,
    ...doneMarkerLines(report.doneMarker),
  ].join('\n')
}
