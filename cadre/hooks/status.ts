/**
 * `/cadre status <id>` (D-111, D-131, LNCH-06): whether a role's autopilot run is done, running or not started, read
 * only from files on disk, never from what a model says, so the end-to-end check has a done signal it can trust (SC3).
 * The session id changes on every autopilot restart, so the role's session is found by its name `cadre-<id>`; then
 * that session's autopilot status file and log are read and reported.
 *
 * It reads autopilot's and agent-fleet's files by their on-disk format and never imports either mod. It runs in the
 * root session or in `claude -p`, asks nothing, writes nothing, and runs only `/usr/bin/grep` over a transcript.
 */
import type { HostIo, InitIo, LaunchStart, PortEntry } from '../types'
import { clean, isObject, MAX_READ_BYTES, parseJsonValue, trimSlash } from './facts'
import { readTeam, repoGuard } from './init'
import { reportText } from './render'
import { autopilotRunState, autopilotStatusPath } from './scan'
import { mangledProjectDir, userDirOf } from './setup'

/**
 * Where a role's autopilot run stands, read from disk (D-111): `done` when autopilot's log ended the run with
 * `finished (done)`; `running` while its status file is on with a fresh beat; `stopped` when the run ended for another
 * reason or is off without a finished line; `not started` when no session is found, or the session has neither a
 * status file nor a log; `unknown` when the status file cannot be read.
 */
export type StatusState = 'done' | 'running' | 'not started' | 'stopped' | 'unknown'

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

/** The most UTF-8 bytes of an autopilot log status reads. */
export const LOG_MAX_BYTES = 4 * 1024 * 1024

/** How long one title grep of a transcript may run, in milliseconds. */
const TITLE_GREP_TIMEOUT_MS = 5_000

/** The most code points of autopilot's last log line the report shows (T-03-35). */
const LOG_SHOWN_CHARS = 160

/** The end of a transcript's file name: `<session id>.jsonl`. */
const TRANSCRIPT_SUFFIX = '.jsonl'

/** The end of an autopilot status file's name: `<session id>.json`; the log beside it ends `.log`. */
const STATUS_SUFFIX = '.json'

/** The start of the text of the log line autopilot writes when a run ends: `finished (<reason>): ...`. */
const FINISHED_TEXT = 'finished ('

/** The start of that text when the run ended done, after AUTOPILOT_DONE and the final handoff. */
const FINISHED_DONE_TEXT = 'finished (done)'

/** One autopilot log line: its stamp, one word, then two spaces and the text, as autopilot's log writes it. */
const LOG_LINE = /^(\S+) {2}(.*)$/

/** What the report says in place of autopilot's last log line when the log gave none. */
const NO_LOG_LINE = 'no log line'

/** The name a role's launcher gives its session, and the title its transcript carries: `cadre-<id>`. */
function sessionName(id: string): string {
  return `cadre-${id}`
}

/**
 * The folder a role's session starts in (D-113), where its transcripts and handoffs are kept: the root for a git-root
 * start, the stored folder below the root for a dir start; null for a here start, which starts wherever the launcher
 * is run.
 */
export function startFolderOf(root: string, start: LaunchStart): string | null {
  if (start.kind === 'here') return null
  if (start.kind === 'git-root') return trimSlash(root)

  return `${trimSlash(root)}/${start.path}`
}

/**
 * The argv that prints the custom-title rows of a transcript (D-131): `/usr/bin/grep -E` for the lines that open as
 * such a row, with the path after `--`, so a path can never be read as an option. It runs with no shell.
 */
export function titleGrepArgv(path: string): readonly string[] {
  return Object.freeze(['/usr/bin/grep', '-E', '^\\{"type":"custom-title"', '--', path])
}

/**
 * A session's title from the grep output of its transcript: the customTitle of the last line that parses as a JSON
 * object with type `custom-title` and a non-empty string customTitle, since the last title row names the session; null
 * when no line does.
 */
export function customTitleOf(output: string): string | null {
  let title: string | null = null
  for (const line of output.split('\n')) {
    const row = parseJsonValue(line)?.value
    if (!isObject(row)) continue
    const { type, customTitle } = row
    if (type !== 'custom-title' || typeof customTitle !== 'string' || customTitle === '') continue
    title = customTitle
  }

  return title
}

/**
 * The folder Claude Code keeps a start folder's transcripts in: `<userDir>/projects/<the start folder mangled>`
 * (mangledProjectDir). Null for a here start, whose folder is not known, and when there is no absolute user folder.
 */
function transcriptFolderOf(userDir: string | null, startFolder: string | null): string | null {
  if (startFolder === null || userDir === null || !userDir.startsWith('/')) return null

  return `${trimSlash(userDir)}/projects/${mangledProjectDir(startFolder)}`
}

/** The transcripts a listing names: the regular files whose name ends `.jsonl`, in the listing's order. */
function transcriptNames(entries: readonly PortEntry[]): string[] {
  return entries
    .filter(entry => entry.kind === 'file' && entry.name.endsWith(TRANSCRIPT_SUFFIX))
    .map(entry => entry.name)
}

/**
 * The session the title search finds in a transcripts folder (D-131): the id of the first transcript whose title grep
 * exits 0 and gives `cadre-<id>`; a grep the host rejects, or that exits non-zero, gives no title. Null when the folder
 * is not known or cannot be listed, or no transcript has the title.
 */
async function titledSession(io: InitIo, host: HostIo, folder: string | null, id: string): Promise<string | null> {
  if (folder === null) return null
  const entries = await io.list(folder)
  if (entries === null) return null
  for (const name of transcriptNames(entries)) {
    const run = await host.run(titleGrepArgv(`${folder}/${name}`), { timeoutMs: TITLE_GREP_TIMEOUT_MS })
    if (run === null || run.exitCode !== 0) continue
    if (customTitleOf(run.stdout) === sessionName(id)) return name.slice(0, -TRANSCRIPT_SUFFIX.length)
  }

  return null
}

/** The texts of an autopilot log's lines, in order, after their stamps; a line not `<stamp>  <text>` has none. */
function logTexts(log: string): string[] {
  return log.split('\n').flatMap(line => {
    const text = LOG_LINE.exec(line)?.[2]

    return text === undefined ? [] : [text]
  })
}

/**
 * How autopilot's log says the run ended (D-111, T-03-33): the last line whose text after the stamp starts `finished (`
 * decides, `done` for `finished (done)` and `stopped` for any other reason; `none` when no line does. Autopilot
 * flattens line breaks, so one line is one record, and only the start of a text counts: a `finished (done)` inside a
 * text never does.
 */
export function runOutcomeOf(log: string): 'done' | 'stopped' | 'none' {
  const finished = logTexts(log)
    .filter(text => text.startsWith(FINISHED_TEXT))
    .at(-1)
  if (finished === undefined) return 'none'

  return finished.startsWith(FINISHED_DONE_TEXT) ? 'done' : 'stopped'
}

/**
 * Autopilot's last log line as the report shows it (T-03-35): its text after the stamp, cleaned as reportText cleans
 * and capped at LOG_SHOWN_CHARS code points; null when the log has no line.
 */
export function lastLogText(log: string): string | null {
  const last = logTexts(log).at(-1)

  return last === undefined ? null : clean(last, LOG_SHOWN_CHARS)
}

/** What status read of a found session's run: its state and autopilot's last log line. */
type RunRead = {
  readonly state: StatusState
  readonly lastLog: string | null
}

/** The path of a session's autopilot log, beside its status file: `<id>.log` for `<id>.json`. */
function logPathOf(statusPath: string): string {
  return `${statusPath.slice(0, -STATUS_SUFFIX.length)}.log`
}

/**
 * A found session's run (D-111): its status file judged by autopilotRunState at the host's clock (no clock is not a
 * finite number, so a file that is on is unknown), and its log, at most LOG_MAX_BYTES. The run is done when it is off
 * and the log's last finished line is `finished (done)`; any other run is reported unknown. With no usable status
 * path (no HOME, or an id autopilot would not name a file with) nothing is read and the run is unknown (D-42).
 */
async function runOf(io: InitIo, home: string | null, sessionId: string): Promise<RunRead> {
  const statusPath = home === null ? null : autopilotStatusPath(home, sessionId)
  if (statusPath === null) return { state: 'unknown', lastLog: null }
  const runState = autopilotRunState(await io.read(statusPath, MAX_READ_BYTES), (await io.now()) ?? Number.NaN)
  const log = await io.read(logPathOf(statusPath), LOG_MAX_BYTES)
  const text = log.state === 'text' ? log.text : ''
  const isDone = runState === 'none' && runOutcomeOf(text) === 'done'

  return { state: isDone ? 'done' : 'unknown', lastLog: lastLogText(text) }
}

/** The report's session line: the session and how it was found, or that none was found under the role's name. */
function sessionLine(report: StatusReport): string {
  const { id, sessionId, foundBy } = report
  if (sessionId === null || foundBy === null) return `session: none found for ${sessionName(id)}`
  const how = foundBy === 'title' ? `its name ${sessionName(id)}` : 'its fleet beat'

  return `session: ${sessionId} (found by ${how})`
}

/**
 * The `/cadre status` reply (D-111): what was asked for, the state, the session and how it was found, autopilot's last
 * log line, and the latest handoff, one per line. The handoff name comes from a listing, so it is shown cleaned.
 */
export function statusReportText(report: StatusReport): string {
  return [
    `cadre status ${report.id}`,
    `state: ${report.state}`,
    sessionLine(report),
    `autopilot: ${report.lastLog ?? NO_LOG_LINE}`,
    `latest handoff: ${report.handoff === null ? 'none yet' : reportText(report.handoff)}`,
  ].join('\n')
}

/**
 * `/cadre status <id>` (D-111, D-131), in the root session or in `claude -p`. It refuses with the shared replies only:
 * repoGuard's, worded for status, then readTeam's (no `.cadre/cadre.json`, an id cadre.json does not list, a role.json
 * that is not valid). Then it looks for the role's session by its name: among the transcripts of the start folder
 * under `<userDir>/projects/`, the first whose title grep (titleGrepArgv, run through the host) gives `cadre-<id>`.
 * With no session the run is not started; else the run is read from the session's autopilot status file and log
 * (runOf). It asks nothing and writes nothing.
 */
export async function runStatus(io: InitIo, host: HostIo, options: { readonly id: string }): Promise<string> {
  const { id } = options
  const guard = await repoGuard(io, 'status')
  if (guard.kind === 'refuse') return guard.text
  const { locations } = guard
  const team = await readTeam(io, locations.root, 'status', id)
  if (team.kind === 'refuse') return team.text

  const startFolder = startFolderOf(locations.root, team.value.state.launchStart)
  const sessionId = await titledSession(io, host, transcriptFolderOf(userDirOf(locations), startFolder), id)
  const report = { id, handoff: null, doneMarker: null }
  if (sessionId === null) {
    return statusReportText({ ...report, state: 'not started', sessionId: null, foundBy: null, lastLog: null })
  }
  const run = await runOf(io, locations.givenHome, sessionId)

  return statusReportText({ ...report, state: run.state, sessionId, foundBy: 'title', lastLog: run.lastLog })
}
