/**
 * `/cadre status <id>` (D-111, D-131, LNCH-06): whether a role's autopilot run is done, running or not started, read
 * only from files on disk, never from what a model says, so the end-to-end check has a done signal it can trust (SC3).
 * The session id changes on every autopilot restart, so the role's session is found by its name `cadre-<id>`; then
 * that session's autopilot status file and log are read and reported, with the role's newest handoff and, for a role
 * on the built-in framework, whether its DONE.md marker is there (D-17).
 *
 * It reads autopilot's and agent-fleet's files by their on-disk format and never imports either mod. It runs in the
 * root session or in `claude -p`, asks nothing, writes nothing, and runs only `/usr/bin/grep` over a transcript.
 */
import type { HostIo, InitIo, InitLocations, LaunchStart, PortEntry, PortRead } from '../types'
import { clean, compareText, isObject, MAX_READ_BYTES, parseJsonValue, trimSlash } from './facts'
import { readTeam, regenBadRole, repoGuard, resolvedFramework } from './init'
import { reportText } from './render'
import { autopilotLogPath, autopilotRunState, autopilotStatusPath } from './scan'
import type { RunState } from './scan'
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

/** The most transcripts of the start folder the title search greps: the newest ones (D-131). */
export const MAX_TRANSCRIPTS = 20

/** The most UTF-8 bytes of an autopilot log status reads. */
export const LOG_MAX_BYTES = 4 * 1024 * 1024

/** The most UTF-8 bytes of one fleet beat status reads, the size agent-fleet caps its own beats at. */
export const BEAT_MAX_BYTES = 64 * 1024

/** The most fleet beats the beat fallback reads: the newest ones (D-131). */
const MAX_BEATS = 50

/** How long one title grep of a transcript may run, in milliseconds. */
const TITLE_GREP_TIMEOUT_MS = 5_000

/** The most code points of autopilot's last log line the report shows (T-03-35). */
const LOG_SHOWN_CHARS = 160

/** The end of a transcript's file name: `<session id>.jsonl`. */
const TRANSCRIPT_SUFFIX = '.jsonl'

/** The end of a fleet beat's file name. */
const BEAT_SUFFIX = '.json'

/** The end of a handoff's file name. */
const HANDOFF_SUFFIX = '.md'

/** The start of the text of the log line autopilot writes when a run ends: `finished (<reason>): ...`. */
const FINISHED_TEXT = 'finished ('

/** The start of that text when the run ended done, after AUTOPILOT_DONE and the final handoff. */
const FINISHED_DONE_TEXT = 'finished (done)'

/**
 * One autopilot log line: its stamp, one word, then two spaces and the text, as autopilot's log writes it. The text
 * takes any character, a line or paragraph separator included, so one line is always one record.
 */
const LOG_LINE = /^(\S+) {2}(.*)$/s

/** What the report says in place of autopilot's last log line when the log gave none. */
const NO_LOG_LINE = 'no log line'

/** The report's line when the built-in DONE.md marker is there, and when it is not (D-17). */
const DONE_MARKER_LINES = Object.freeze({ present: 'DONE.md: present', absent: 'DONE.md: not written yet' })

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

/**
 * Whether a text is a plain session id, the only kind autopilot names its files with: one autopilotStatusPath takes,
 * so the one pattern scan.ts keeps decides, and a transcript or beat that names anything else is never followed
 * (T-03-34).
 */
function isPlainSessionId(text: string): boolean {
  return autopilotStatusPath('/', text) !== null
}

/** Whether a listing entry is a regular file, not a link: the only kind of transcript, beat or handoff status uses. */
function isRegularFile(entry: PortEntry): boolean {
  return entry.kind === 'file' && !entry.isLink
}

/** The entries newest first by modification time, a tie by name, as a new array. */
function newestFirst(entries: readonly PortEntry[]): PortEntry[] {
  return [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs || compareText(a.name, b.name))
}

/** Whether a file name is a transcript's: a plain session id, then `.jsonl`. */
function isTranscriptName(name: string): boolean {
  return name.endsWith(TRANSCRIPT_SUFFIX) && isPlainSessionId(name.slice(0, -TRANSCRIPT_SUFFIX.length))
}

/**
 * The transcripts the title search greps (D-131): the names of the regular files, never links, named by a plain
 * session id and `.jsonl`, newest first by modification time, at most MAX_TRANSCRIPTS of them.
 */
export function transcriptCandidates(entries: readonly PortEntry[]): string[] {
  const transcripts = entries.filter(entry => isRegularFile(entry) && isTranscriptName(entry.name))

  return newestFirst(transcripts)
    .slice(0, MAX_TRANSCRIPTS)
    .map(entry => entry.name)
}

/**
 * The session the title search finds in a transcripts folder (D-131): the id of the first transcript, newest first
 * (transcriptCandidates), whose title grep exits 0 and gives `cadre-<id>`; a grep the host rejects, or that exits
 * non-zero, gives no title. Null when the folder is not known or cannot be listed, or no transcript has the title.
 */
async function titledSession(io: InitIo, host: HostIo, folder: string | null, id: string): Promise<string | null> {
  if (folder === null) return null
  const entries = await io.list(folder)
  if (entries === null) return null
  for (const name of transcriptCandidates(entries)) {
    const run = await host.run(titleGrepArgv(`${folder}/${name}`), { timeoutMs: TITLE_GREP_TIMEOUT_MS })
    if (run === null || run.exitCode !== 0) continue
    if (customTitleOf(run.stdout) === sessionName(id)) return name.slice(0, -TRANSCRIPT_SUFFIX.length)
  }

  return null
}

/** A fleet beat that is a role's session: the session's id and folder, and when it last beat. */
type BeatSession = {
  readonly sessionId: string
  readonly cwd: string
  readonly beatAt: number
}

/**
 * One parsed fleet beat as a role's session, or null when it is not one: a JSON object whose name is the session name,
 * whose id is a plain session id, whose cwd is an absolute path and, when the start folder is known, that folder
 * (trailing slashes aside), and whose beatAt is a finite number. Every other field is ignored.
 */
function beatOf(value: unknown, name: string, startFolder: string | null): BeatSession | null {
  if (!isObject(value) || value.name !== name) return null
  const { id, cwd, beatAt } = value
  if (typeof id !== 'string' || !isPlainSessionId(id)) return null
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) return null
  if (startFolder !== null && trimSlash(cwd) !== trimSlash(startFolder)) return null
  if (typeof beatAt !== 'number' || !Number.isFinite(beatAt)) return null

  return { sessionId: id, cwd, beatAt }
}

/**
 * The role's session from the fleet beats (D-131), for when no transcript names it: of the beats beatOf takes for the
 * session name `cadre-<id>` and the start folder, the one with the newest beatAt (the first of a tie), as its id and
 * its cwd. For a here start (`startFolder` null) a beat is matched by its name alone, and its cwd tells the folder its
 * session started in. Null when no beat is the role's.
 */
export function beatSessionOf(
  values: readonly unknown[],
  id: string,
  startFolder: string | null,
): { readonly sessionId: string; readonly cwd: string } | null {
  let newest: BeatSession | null = null
  for (const value of values) {
    const beat = beatOf(value, sessionName(id), startFolder)
    if (beat === null) continue
    if (newest !== null && beat.beatAt <= newest.beatAt) continue
    newest = beat
  }

  return newest === null ? null : { sessionId: newest.sessionId, cwd: newest.cwd }
}

/**
 * The parsed fleet beats under a home folder (D-131): the newest MAX_BEATS regular `.json` files, never links, of
 * `<home>/.claude/fleet`, each read at most BEAT_MAX_BYTES; a beat that cannot be read or is not JSON is skipped.
 * Empty when the folder cannot be listed.
 */
async function beatValues(io: InitIo, home: string): Promise<unknown[]> {
  const folder = `${trimSlash(home)}/.claude/fleet`
  const entries = await io.list(folder)
  if (entries === null) return []
  const beats = entries.filter(entry => isRegularFile(entry) && entry.name.endsWith(BEAT_SUFFIX))
  const values: unknown[] = []
  for (const entry of newestFirst(beats).slice(0, MAX_BEATS)) {
    const read = await io.read(`${folder}/${entry.name}`, BEAT_MAX_BYTES)
    if (read.state !== 'text') continue
    const parsed = parseJsonValue(read.text)
    if (parsed === null) continue
    values.push(parsed.value)
  }

  return values
}

/** The session the search found: its id, how it was found, and the folder it started in (null when not known). */
type FoundSession = {
  readonly sessionId: string
  readonly foundBy: 'title' | 'beat'
  readonly folder: string | null
}

/**
 * The role's session (D-131): first the title search over the start folder's transcripts under the user folder
 * (titledSession); else the fleet beats under HOME as given, as autopilot and agent-fleet name their folders from it
 * (beatSessionOf). A here start has no known folder, so it has no title search, and its beat's cwd is the folder its
 * session started in. Null when neither finds the session, and with no absolute HOME as given no beat is read.
 */
async function sessionOf(
  io: InitIo,
  host: HostIo,
  input: { readonly locations: InitLocations; readonly id: string; readonly startFolder: string | null },
): Promise<FoundSession | null> {
  const { locations, id, startFolder } = input
  const titled = await titledSession(io, host, transcriptFolderOf(userDirOf(locations), startFolder), id)
  if (titled !== null) return { sessionId: titled, foundBy: 'title', folder: startFolder }
  const home = locations.givenHome
  if (home === null || !home.startsWith('/')) return null
  const beat = beatSessionOf(await beatValues(io, home), id, startFolder)
  if (beat === null) return null

  return { sessionId: beat.sessionId, foundBy: 'beat', folder: startFolder ?? beat.cwd }
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

/**
 * The state of a found session's run (D-111), from what its files say, never from a model: an active run (a status
 * file that is on with a fresh beat) is `running` and an unknown one `unknown`; a run that is off is `done` or
 * `stopped` as its log's last finished line says (runOutcomeOf); with no finished line it is `not started` when there
 * is neither a status file nor a log line, else `stopped`.
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
async function runOf(io: InitIo, home: string | null, sessionId: string): Promise<RunRead> {
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
  const handoffs = `thoughts/shared/handoffs/${id}`
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

/** The run of a role whose session was not found: not started, with no log line (D-111). */
const NO_SESSION_RUN: RunRead = Object.freeze({ state: 'not started', lastLog: null })

/**
 * `/cadre status <id>` (D-111, D-131), in the root session or in `claude -p`. It refuses with the shared replies only:
 * repoGuard's, worded for status, then readTeam's (no `.cadre/cadre.json`, an id cadre.json does not list, a role.json
 * that is not valid). Then it looks for the role's session by its name (sessionOf): the newest of the start folder's
 * transcripts under `<userDir>/projects/` whose title grep (titleGrepArgv, run through the host) gives `cadre-<id>`,
 * else its fleet beat. With no session the run is not started; else its state comes from the session's autopilot
 * status file and log (runOf, statusStateOf). The report adds the newest handoff under the folder the session started
 * in, or the start folder when no session was found (handoffOf), and, for a role whose framework (its own, else
 * cadre.json's) is the built-in one, whether its DONE.md marker is there (D-17). It asks nothing and writes nothing.
 */
export async function runStatus(io: InitIo, host: HostIo, options: { readonly id: string }): Promise<string> {
  const { id } = options
  const guard = await repoGuard(io, 'status')
  if (guard.kind === 'refuse') return guard.text
  const { locations } = guard
  const team = await readTeam(io, locations.root, 'status', id)
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
