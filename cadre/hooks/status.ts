/**
 * `/cadre status <id>` (D-111, D-131, LNCH-06): whether a role's autopilot run is done, running, stopped, not started
 * or unknown, read only from files on disk, never from what a model says, so the end-to-end check has a done signal it
 * can trust (SC3).
 * The session id changes on every autopilot restart, so the role's session is found by its name `cadre-<id>`; then
 * that session's autopilot status file and log are read and reported, with the role's newest handoff and, for a role
 * on the built-in framework, whether its DONE.md marker is there (D-17).
 *
 * It reads autopilot's and agent-fleet's files by their on-disk format and never imports either mod. It runs in the
 * root session or in `claude -p`, asks nothing, writes nothing, and runs only the git checkout probe and
 * `/usr/bin/grep` over a transcript.
 */
import type { HostIo, InitIo, PortEntry } from '../types'
import { reportText } from './core/text'
import { GIT_TIMEOUT_MS } from './git/argv'
import { CHECKOUT_ARGV, checkoutOf } from './git/checkout'
import { repoGuard } from './guards/repo'
import { handoffFolderOf, trimSlash } from './paths'
import { NO_LOG_LINE, NO_SESSION_RUN, runOf } from './status/autopilot-files'
import type { StatusState } from './status/autopilot-files'
import { isRegularFile, newestFirst, sessionName, sessionOf, startFolderOf } from './status/session-find'
import { readTeam, regenBadRole, resolvedFramework } from './team'

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
async function handoffOf(io: InitIo, folder: string | null, id: string): Promise<string | null> {
  if (folder === null) return null
  const handoffs = handoffFolderOf(id)
  const entries = await io.list(`${trimSlash(folder)}/${handoffs}`)
  if (entries === null) return null
  const name = newestHandoff(entries)

  return name === null ? null : `${handoffs}/${name}`
}

/** Whether the built-in done marker of the role, `<root>/.cadre/<id>/.runtime/DONE.md`, is a file (D-17). */
async function hasDoneMarker(io: InitIo, root: string, id: string): Promise<boolean> {
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

/**
 * `/cadre status <id>` (D-111, D-131), in the root session or in `claude -p`. It refuses with the shared replies only:
 * repoGuard's, worded for status, then readTeam's (no `.cadre/cadre.json`, an id cadre.json does not list, a role.json
 * that is not valid). Then it looks for the role's session by its name (sessionOf): the newest of the start folder's
 * transcripts under `<userDir>/projects/` whose title grep (titleGrepArgv, run through the host) gives `cadre-<id>`,
 * else its fleet beat. With no session the run is not started; else its state comes from the session's autopilot
 * status file and log (runOf, statusStateOf). The report adds the newest handoff under the folder the session started
 * in, or the start folder when no session was found (handoffOf), and, for a role whose framework (its own, else
 * cadre.json's) is the built-in one, whether its DONE.md marker is there (D-17). In a linked worktree, where
 * CHECKOUT_ARGV and checkoutOf name the main checkout, the team is read from the main checkout, so status works there
 * under every git policy, while the session, its run, its handoff and its DONE.md stay the worktree's own (D-151). It
 * asks nothing and writes nothing: it is given only the host's run, for the checkout probe and the title grep, so it
 * cannot write (T-03-01, #63 A3).
 */
export async function runStatus(
  io: InitIo,
  host: Pick<HostIo, 'run'>,
  options: { readonly id: string },
): Promise<string> {
  const { id } = options
  const guard = await repoGuard(io, 'status')
  if (guard.kind === 'refuse') return guard.text
  const { locations } = guard
  const checkout = checkoutOf(await host.run(CHECKOUT_ARGV(locations.root), { timeoutMs: GIT_TIMEOUT_MS }))
  const teamRoot = checkout.kind === 'linked' && checkout.main !== null ? checkout.main : locations.root
  const team = await readTeam(io, teamRoot, 'status', id)
  if (team.kind === 'refuse') return team.text
  const { state, roles } = team.value
  const role = roles.find(candidate => candidate.id === id)
  // Fail closed: readTeam read every role cadre.json lists, the one asked for included, so it is always there.
  if (role === undefined) return regenBadRole(id)

  const startFolder = startFolderOf(locations.root, state.launchStart)
  const found = await sessionOf(io, host, { locations, id, startFolder })
  const run = found === null ? NO_SESSION_RUN : await runOf(io, locations.givenHome, found.sessionId)
  const isBuiltin = resolvedFramework(role, state.framework) === 'none'

  return statusReportText({
    id,
    state: run.state,
    sessionId: found?.sessionId ?? null,
    foundBy: found?.foundBy ?? null,
    lastLog: run.lastLog,
    handoff: await handoffOf(io, found === null ? startFolder : found.folder, id),
    doneMarker: isBuiltin ? await hasDoneMarker(io, locations.root, id) : null,
  })
}
