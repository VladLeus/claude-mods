/**
 * The session discovery of /cadre status (D-131), a layer 10 module: the session id changes on every autopilot
 * restart, so a role's session is found by its name `cadre-<id>`: first by the custom title of the newest transcripts
 * of its start folder under the user folder, grepped with `/usr/bin/grep` through the HostIo port (titledSession), else
 * by the newest agent-fleet beat with that name whose cwd lies in the repo (beatSessionOf); sessionOf tries both. It
 * reads through the InitIo port and runs only that grep; it imports core, paths and scan, and the rest of status/ and
 * epic read it.
 */
import type { HostIo, InitIo, InitLocations, LaunchStart, PortEntry } from '../../types'
import { isObject, parseJsonValue } from '../core/json'
import { compareText } from '../core/text'
import { mangledProjectDir, trimSlash, userDirOf } from '../paths'
import { autopilotStatusPath } from '../scan/autopilot'

/** The most transcripts of the start folder the title search greps: the newest ones (D-131). */
export const MAX_TRANSCRIPTS = 20

/** The most UTF-8 bytes of one fleet beat status reads, the size agent-fleet caps its own beats at. */
export const BEAT_MAX_BYTES = 64 * 1024

/** The most fleet beats the beat fallback reads: the newest ones (D-131). */
const MAX_BEATS = 50

/** How long one title grep of a transcript may run, in milliseconds. */
const TITLE_GREP_TIMEOUT_MS = 5_000

/** The end of a transcript's file name: `<session id>.jsonl`. */
const TRANSCRIPT_SUFFIX = '.jsonl'

/** The end of a fleet beat's file name. */
const BEAT_SUFFIX = '.json'

/** The name a role's launcher gives its session, and the title its transcript carries: `cadre-<id>`. */
export function sessionName(id: string): string {
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
export function isRegularFile(entry: PortEntry): boolean {
  return entry.kind === 'file' && !entry.isLink
}

/** The entries newest first by modification time, a tie by name, as a new array. */
export function newestFirst(entries: readonly PortEntry[]): PortEntry[] {
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
async function titledSession(
  io: InitIo,
  host: Pick<HostIo, 'run'>,
  folder: string | null,
  id: string,
): Promise<string | null> {
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
 * Whether an absolute path is one of the roots or below one, trailing slashes aside, on a path-component boundary, so
 * `/repo2` is not below `/repo`; a path with a `.` or `..` component never is, since it could lead anywhere.
 */
function isInsideRoots(path: string, roots: readonly string[]): boolean {
  if (path.split('/').some(part => part === '.' || part === '..')) return false
  const folder = trimSlash(path)

  return roots.some(root => {
    const top = trimSlash(root)

    return folder === top || folder.startsWith(`${top}/`)
  })
}

/**
 * Whether a beat's cwd is where the role's session starts: the start folder when it is known (trailing slashes
 * aside), else, for a here start, the repo, a root of `roots` or a folder below one (isInsideRoots, #63 A2), as a
 * here launcher refuses to run outside its repo.
 */
function isStartCwd(cwd: string, startFolder: string | null, roots: readonly string[]): boolean {
  if (startFolder !== null) return trimSlash(cwd) === trimSlash(startFolder)

  return isInsideRoots(cwd, roots)
}

/**
 * One parsed fleet beat as a role's session, or null when it is not one: a JSON object whose name is the session name,
 * whose id is a plain session id, whose cwd is an absolute path where the session starts (isStartCwd), and whose
 * beatAt is a finite number. Every other field is ignored.
 */
function beatOf(
  value: unknown,
  name: string,
  startFolder: string | null,
  roots: readonly string[],
): BeatSession | null {
  if (!isObject(value) || value.name !== name) return null
  const { id, cwd, beatAt } = value
  if (typeof id !== 'string' || !isPlainSessionId(id)) return null
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) return null
  if (!isStartCwd(cwd, startFolder, roots)) return null
  if (typeof beatAt !== 'number' || !Number.isFinite(beatAt)) return null

  return { sessionId: id, cwd, beatAt }
}

/**
 * The role's session from the fleet beats (D-131), for when no transcript names it: of the beats beatOf takes for the
 * session name `cadre-<id>` and the start folder, the one with the newest beatAt (the first of a tie), as its id and
 * its cwd. For a here start (`startFolder` null) a beat is matched by its name and a cwd at or below one of `roots`
 * (the repo root and the root as given, #63 A2), and that cwd tells the folder its session started in; `roots` is not
 * read for another start. Null when no beat is the role's.
 */
export function beatSessionOf(
  values: readonly unknown[],
  id: string,
  startFolder: string | null,
  roots: readonly string[],
): { readonly sessionId: string; readonly cwd: string } | null {
  let newest: BeatSession | null = null
  for (const value of values) {
    const beat = beatOf(value, sessionName(id), startFolder, roots)
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
export type FoundSession = {
  readonly sessionId: string
  readonly foundBy: 'title' | 'beat'
  readonly folder: string | null
}

/**
 * The role's session (D-131): first the title search over the start folder's transcripts under the user folder
 * (titledSession); else the fleet beats under HOME as given, as autopilot and agent-fleet name their folders from it
 * (beatSessionOf). A here start has no known folder, so it has no title search, and its beat, whose cwd must be in the
 * repo (the root or the root as given), tells the folder its session started in. Null when neither finds the session,
 * and with no absolute HOME as given no beat is read.
 */
export async function sessionOf(
  io: InitIo,
  host: Pick<HostIo, 'run'>,
  input: { readonly locations: InitLocations; readonly id: string; readonly startFolder: string | null },
): Promise<FoundSession | null> {
  const { locations, id, startFolder } = input
  // The status reply has no warning lines, so an ignored CLAUDE_CONFIG_DIR only falls back here (D-238).
  const userDir = userDirOf(locations, [locations.root], [])
  const titled = await titledSession(io, host, transcriptFolderOf(userDir, startFolder), id)
  if (titled !== null) return { sessionId: titled, foundBy: 'title', folder: startFolder }
  const home = locations.givenHome
  if (home === null || !home.startsWith('/')) return null
  const roots = [locations.root, locations.givenRoot]
  const beat = beatSessionOf(await beatValues(io, home), id, startFolder, roots)
  if (beat === null) return null

  return { sessionId: beat.sessionId, foundBy: 'beat', folder: startFolder ?? beat.cwd }
}
