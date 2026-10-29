/**
 * The autopilot files of /cadre status (D-111), a layer 10 module: where a role's autopilot run stands (StatusState),
 * read only from autopilot's status file and log of the role's session under HOME as given (runOf), never from what a
 * model says, and for /cadre epic done the state of each role of an epic worktree (roleRunState, D-171). It reads
 * autopilot's files by their on-disk format and never imports autopilot. It reads through the InitIo port, and
 * roleRunState runs only the title grep of sessionOf; it imports core, scan and status/session-find, and status/run,
 * status/report and epic read it.
 */
import type { HostIo, InitIo, InitLocations, LaunchStart, PortRead } from '../../types'
import { clean } from '../core/text'
import { autopilotLogPath, autopilotRunState, autopilotStatusPath } from '../scan/autopilot'
import type { RunState } from '../scan/autopilot'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { sessionOf, startFolderOf } from './session-find'

/**
 * Where a role's autopilot run stands, read from disk (D-111): `done` when autopilot's log ended the session's last run
 * (the lines after its last `started: ` line) with `finished (done)`; `running` while its status file is on with a
 * fresh beat; `stopped` when that run ended for another reason, was stopped by the person, or is off without an end
 * line; `not started` when no session is found, or the session has neither a status file nor a log; `unknown` when
 * the status file cannot be read, when the log of a run that is not active cannot be read or is over LOG_MAX_BYTES,
 * and when there is no absolute HOME as given or no plain session id to name autopilot's files by.
 */
export type StatusState = 'done' | 'running' | 'not started' | 'stopped' | 'unknown'

/** The most UTF-8 bytes of an autopilot log status reads. */
export const LOG_MAX_BYTES = 4 * 1024 * 1024

/** The most code points of autopilot's last log line the report shows (T-03-35). */
const LOG_SHOWN_CHARS = 160

/** The start of the text of the log line autopilot writes when a run ends: `finished (<reason>): ...`. */
const FINISHED_TEXT = 'finished ('

/** The start of that text when the run ended done, after AUTOPILOT_DONE and the final handoff. */
const FINISHED_DONE_TEXT = 'finished (done)'

/** The start of the text of the log line autopilot writes when `/autopilot` starts a run: `started: ...`. */
const STARTED_TEXT = 'started: '

/** The text of the log line autopilot writes when the person stops the run with `/autopilot stop`. */
const STOPPED_TEXT = 'stopped by the person'

/**
 * One autopilot log line: its stamp, one word, then two spaces and the text, as autopilot's log writes it. The text
 * takes any character, a line or paragraph separator included, so one line is always one record.
 */
const LOG_LINE = /^(\S+) {2}(.*)$/s

/** What the report says in place of autopilot's last log line when the log gave none. */
export const NO_LOG_LINE = 'no log line'

/** The texts of an autopilot log's lines, in order, after their stamps; a line not `<stamp>  <text>` has none. */
function logTexts(log: string): string[] {
  return log.split('\n').flatMap(line => {
    const text = LOG_LINE.exec(line)?.[2]

    return text === undefined ? [] : [text]
  })
}

/**
 * How autopilot's log says the session's last run ended (D-111, T-03-33, #63 A1). Only the lines after the last one
 * whose text starts `started: ` count (all of them when there is none, as in a session resumed after a restart), so an
 * earlier run's `finished (done)` never makes a later run done. Of those, the last whose text starts `finished (` or
 * is `stopped by the person` decides: `done` for `finished (done)`, `stopped` for any other reason or a stop by the
 * person; `none` when no line does. Autopilot flattens line breaks, so one line is one record, and only the start of a
 * text counts: a `finished (done)` or `started: ` inside a text never does.
 */
export function runOutcomeOf(log: string): 'done' | 'stopped' | 'none' {
  const texts = logTexts(log)
  const lastRun = texts.slice(texts.findLastIndex(text => text.startsWith(STARTED_TEXT)) + 1)
  const ended = lastRun.filter(text => text.startsWith(FINISHED_TEXT) || text.startsWith(STOPPED_TEXT)).at(-1)
  if (ended === undefined) return 'none'

  return ended.startsWith(FINISHED_DONE_TEXT) ? 'done' : 'stopped'
}

/**
 * Autopilot's last log line as the report shows it (T-03-35): its text after the stamp, cleaned as reportText cleans
 * and capped at LOG_SHOWN_CHARS code points; null when the log has no line.
 */
export function lastLogText(log: string): string | null {
  const last = logTexts(log).at(-1)

  return last === undefined ? null : clean(last, LOG_SHOWN_CHARS)
}

/**
 * The state of a found session's run (D-111), from what its files say, never from a model: an active run (a status
 * file that is on with a fresh beat) is `running` and an unknown one `unknown`; a run that is off is `done` or
 * `stopped` as its log says the last run ended (runOutcomeOf); with no end line it is `not started` when there is
 * neither a status file nor a log line, else `stopped`.
 */
export function statusStateOf(input: {
  readonly runState: RunState
  readonly outcome: 'done' | 'stopped' | 'none'
  readonly hasStatusFile: boolean
  readonly hasLog: boolean
}): StatusState {
  if (input.runState === 'active') return 'running'
  if (input.runState === 'unknown') return 'unknown'
  if (input.outcome === 'done') return 'done'
  if (input.outcome === 'stopped') return 'stopped'
  if (!input.hasStatusFile && !input.hasLog) return 'not started'

  return 'stopped'
}

/** What status read of a found session's run: its state and autopilot's last log line. */
type RunRead = {
  readonly state: StatusState
  readonly lastLog: string | null
}

/** Whether a read failed or went over its cap, so what the file says cannot be told: never the same as absent. */
function isUnreadable(read: PortRead): boolean {
  return read.state === 'unknown' || read.state === 'too-large'
}

/**
 * A found session's run (D-111): its status file, read at most MAX_READ_BYTES, judged by autopilotRunState at the
 * host's clock (no clock is not a finite number, so a file that is on is unknown), and its log, read at most
 * LOG_MAX_BYTES, then statusStateOf. A log that cannot be read or is over the cap leaves a run that is not active
 * unknown, since how it ended cannot be told (fail closed). With no usable status or log path (no HOME, or an id
 * autopilot would not name a file with) nothing is read and the run is unknown (D-42).
 */
export async function runOf(io: InitIo, home: string | null, sessionId: string): Promise<RunRead> {
  const statusPath = home === null ? null : autopilotStatusPath(home, sessionId)
  const logPath = home === null ? null : autopilotLogPath(home, sessionId)
  if (statusPath === null || logPath === null) return { state: 'unknown', lastLog: null }
  const status = await io.read(statusPath, MAX_READ_BYTES)
  const runState = autopilotRunState(status, (await io.now()) ?? Number.NaN)
  const log = await io.read(logPath, LOG_MAX_BYTES)
  if (isUnreadable(log) && runState !== 'active') return { state: 'unknown', lastLog: null }
  const text = log.state === 'text' ? log.text : ''
  const hasStatusFile = status.state !== 'absent'
  const state = statusStateOf({ runState, outcome: runOutcomeOf(text), hasStatusFile, hasLog: text !== '' })

  return { state, lastLog: lastLogText(text) }
}

/** The run of a role whose session was not found: not started, with no log line (D-111). */
export const NO_SESSION_RUN: RunRead = Object.freeze({ state: 'not started', lastLog: null })

/**
 * The state /cadre status would report for the role `id` in the checkout `locations` names (D-111, D-171): its session
 * is looked for (sessionOf) from the start folder of `launchStart` below that checkout's root (startFolderOf), and its
 * run is read from autopilot's files under HOME as given (runOf); not started when no session is found. /cadre epic
 * done asks it for each role of the team in the epic's worktree.
 */
export async function roleRunState(
  io: InitIo,
  host: Pick<HostIo, 'run'>,
  input: { readonly locations: InitLocations; readonly id: string; readonly launchStart: LaunchStart },
): Promise<StatusState> {
  const { locations, id } = input
  const startFolder = startFolderOf(locations.root, input.launchStart)
  const found = await sessionOf(io, host, { locations, id, startFolder })
  if (found === null) return NO_SESSION_RUN.state

  return (await runOf(io, locations.givenHome, found.sessionId)).state
}
