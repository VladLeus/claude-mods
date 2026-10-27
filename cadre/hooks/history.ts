import type { InitIo, InitLocations, PortEntry } from '../types'
import { ASK_HEADERS, askChoice, NO_USABLE_ANSWER_REASON, quotedLabels, showBlock, withContext } from './ask'
import type { StepResult } from './ask'
import { HISTORY_MAX_SESSIONS } from './assign'
import { labelled } from './core/labelled'
import type { Labelled } from './core/labelled'
import { asciiLower, compareText } from './core/text'
import { projectFolderOf, userDirOf } from './paths'
import { listingState } from './scan/port-read'

/**
 * The most bytes of one session transcript the scan reads, the host's own read cap. A bigger session is skipped and
 * counted, so the reply says that the heaviest sessions are not counted (D-59, Pitfall 9).
 */
export const HISTORY_MAX_FILE_BYTES = 4 * 1024 * 1024

/**
 * The most bytes the scan reads in all, so it stays within the hook's time budget: once the sessions read reach it, the
 * scan reads no more and is partial (Pitfall 5).
 */
export const HISTORY_MAX_TOTAL_BYTES = 64 * 1024 * 1024

/**
 * A command or skill name the scan keeps, once a leading `/` is gone and A-Z is lowercased: 1 to 100 ASCII lowercase
 * letters, digits, `:`, `_`, `.`, `@` and `-`, starting with a letter or a digit, as NAME_PATTERN takes after ASCII
 * lowercasing (IN-01). Any other name is dropped (SCAN-03).
 */
export const HISTORY_NAME_PATTERN = /^[a-z0-9][a-z0-9:_.@-]{0,99}$/

/**
 * What a history scan found (SCAN-03): each command and skill name with its count, busiest first and then by name, and
 * of the `total` sessions it was given, how many it read (`scanned`), skipped as over 4 MiB (`skippedLarge`) or as
 * unreadable (`skippedUnknown`), and whether it stopped at the 64 MiB total with sessions left (`isPartial`). It holds
 * names and numbers only, never transcript text, a path or an argument.
 */
export type HistoryScan = {
  readonly counts: readonly { readonly name: string; readonly count: number }[]
  readonly scanned: number
  readonly total: number
  readonly skippedLarge: number
  readonly skippedUnknown: number
  readonly isPartial: boolean
}

/** One name and how often the sessions used it. */
type NameCount = HistoryScan['counts'][number]

/** The line init prints when this repo has no session history: no session folder, or no transcript in it (SCAN-03). */
export const NO_HISTORY_NOTE = 'No session history for this repo.'

/** The line init prints when the session folder cannot be listed: unknown is never taken as no history. */
export const UNLISTED_HISTORY_NOTE = "Could not list this repo's session history, so it was not scanned."

/** Why init cancels when the history question is dismissed or not answered (A1, D-45). */
export const HISTORY_DISMISSED_REASON = 'The session history question was dismissed or not answered.'

/** The extension of a session transcript file. */
const SESSION_EXTENSION = '.jsonl'

/** Bytes in one MiB, to word the caps in the notes. */
const MIB = 1024 * 1024

/** The heading of the history block. */
const HISTORY_HEADING = 'Session history (names and counts only):'

/** The most names the history block lists. */
const MAX_HISTORY_ROWS = 15

/** A slash command in a transcript line: `<command-name>/name</command-name>`, sometimes without the `/`. */
const COMMAND_MARKER = /<command-name>([^<]*)<\/command-name>/g

/**
 * A transcript line that is the person's own slash command (IN-04): a user message whose string content starts with a
 * command marker; the planning-time check of real transcripts found the marker also in tool results, assistant lines
 * and local-command system lines, which are not counted.
 */
const USER_COMMAND_LINE = /"role":"user","content":"<command-(?:message|name)>/

/** The mark of a Skill tool call; the line that holds it names the skill as `"skill":"<name>"`. */
const SKILL_CALL = '"name":"Skill"'

/** The skill a Skill tool call names, on the line that holds SKILL_CALL. */
const SKILL_NAME = /"skill":"([^"\\]*)"/g

/** The folder that holds this repo's session transcripts: `projects/<mangled repo path>` in the user folder (D-59). */
export function historyDir(userDir: string, root: string): string {
  return projectFolderOf(userDir, root)
}

/** Whether a listing entry is a session transcript: a regular `.jsonl` file, not a link. */
function isSession(entry: PortEntry): boolean {
  return entry.kind === 'file' && !entry.isLink && entry.name.endsWith(SESSION_EXTENSION)
}

/** Newest first by modification time, then by name, so the order is the same on every host. */
function newestFirst(a: PortEntry, b: PortEntry): number {
  return b.mtimeMs - a.mtimeMs || compareText(a.name, b.name)
}

/**
 * This repo's session transcripts (D-59): the regular `.jsonl` files of the folder, newest first, at most
 * HISTORY_MAX_SESSIONS of them, with the number of all of them. A folder, a link or another name is not a session. A
 * folder that is not there has no sessions, and one that cannot be listed gives null (listingState), because unknown
 * is not absent. Only the listing is read, never a transcript.
 */
export async function listSessions(
  io: InitIo,
  dir: string,
): Promise<{ readonly sessions: readonly PortEntry[]; readonly total: number } | null> {
  const listing = await listingState(io, dir)
  if (listing.state === 'unknown') return null
  const files = listing.state === 'present' ? listing.entries.filter(isSession) : []

  return { sessions: files.sort(newestFirst).slice(0, HISTORY_MAX_SESSIONS), total: files.length }
}

/**
 * A marker value as a kept name: A-Z lowercased by asciiLower, the rule the skill hints look a name up with, then kept
 * only when it fits HISTORY_NAME_PATTERN; else null.
 */
function keptName(value: string): string | null {
  const name = asciiLower(value)

  return HISTORY_NAME_PATTERN.test(name) ? name : null
}

/**
 * The slash commands of one transcript line, each without its leading `/`: none unless the line is the person's own
 * command (USER_COMMAND_LINE) and holds no tool result (IN-04).
 */
function commandNames(line: string): string[] {
  if (!USER_COMMAND_LINE.test(line) || line.includes('"tool_result"')) return []

  return Array.from(line.matchAll(COMMAND_MARKER), match => (match[1] ?? '').replace(/^\//, ''))
}

/**
 * The skills of one transcript line when it holds a Skill tool call, each name once: the host writes the input of one
 * call twice on its line, in the tool_use block and in `wireToolInputs` (WR-01). None otherwise.
 */
function skillNames(line: string): string[] {
  if (!line.includes(SKILL_CALL)) return []

  return Array.from(new Set(Array.from(line.matchAll(SKILL_NAME), match => match[1] ?? '')))
}

/**
 * The command and skill names of one transcript, with how often each is used (SCAN-03): a slash command from each
 * `<command-name>` marker of a line that is the person's own command (commandNames, IN-04: a user message whose
 * content starts with a command marker; not a tool result, an assistant line or a local-command system line), without
 * its leading `/`, and a skill from each `"skill":"<name>"` on a line that holds a Skill tool call (`"name":"Skill"`),
 * each skill name once per line, since one call writes its input twice on its line (WR-01). The text is scanned line
 * by line with these patterns and never parsed as JSON (Pitfall 5). A name is
 * lowercased in ASCII and kept only when it then fits HISTORY_NAME_PATTERN, so a name with any other character is
 * dropped, and each exact name counts apart. Nothing else of the text is kept.
 */
export function countNames(text: string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const line of text.split('\n')) {
    for (const value of [...commandNames(line), ...skillNames(line)]) {
      const name = keptName(value)
      if (name === null) continue
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }

  return counts
}

/** Busiest first, then by name in code unit order. */
function busiestFirst(a: NameCount, b: NameCount): number {
  return b.count - a.count || compareText(a.name, b.name)
}

/**
 * Reads the sessions listSessions gave, in that order, through the port and keeps only what countNames finds, with
 * the counts of each name summed (SCAN-03, D-59). A session over HISTORY_MAX_FILE_BYTES is skipped and counted
 * (`skippedLarge`, Pitfall 9), and so is one that cannot be read or is gone (`skippedUnknown`). The total counts the
 * listed size of each session read; once it reaches HISTORY_MAX_TOTAL_BYTES the scan reads no more, and it is partial
 * when sessions are left (Pitfall 5). No text, path or file name is kept.
 */
export async function scanHistory(io: InitIo, dir: string, sessions: readonly PortEntry[]): Promise<HistoryScan> {
  const counts = new Map<string, number>()
  let bytes = 0
  let scanned = 0
  let skippedLarge = 0
  let skippedUnknown = 0
  for (const session of sessions) {
    if (bytes >= HISTORY_MAX_TOTAL_BYTES) break
    const read = await io.read(`${dir}/${session.name}`, HISTORY_MAX_FILE_BYTES)
    if (read.state === 'too-large') {
      skippedLarge += 1
      continue
    }
    if (read.state !== 'text') {
      skippedUnknown += 1
      continue
    }
    bytes += session.size
    scanned += 1
    for (const [name, count] of countNames(read.text)) counts.set(name, (counts.get(name) ?? 0) + count)
  }
  const attempted = scanned + skippedLarge + skippedUnknown

  return {
    counts: Array.from(counts, ([name, count]) => ({ name, count })).sort(busiestFirst),
    scanned,
    total: sessions.length,
    skippedLarge,
    skippedUnknown,
    isPartial: attempted < sessions.length,
  }
}

/** A session count as text: `1 session`, else `<n> sessions`. */
function sessionsText(count: number): string {
  return `${count} ${count === 1 ? 'session' : 'sessions'}`
}

/**
 * The history consent question (SCAN-03, D-59): how many sessions this repo has, asked before any is read, and that
 * only the newest HISTORY_MAX_SESSIONS are read when there are more (IN-03).
 */
export function historyQuestion(total: number): string {
  const newest = total > HISTORY_MAX_SESSIONS ? `; the newest ${HISTORY_MAX_SESSIONS} are read` : ''

  return (
    `Scan this repo's session history (${sessionsText(total)}${newest}) ` +
    'for frequently used commands and skills? Only names and counts are kept.'
  )
}

/** Each history answer with what it allows, the declining one first: only the yes reads a transcript (D-59). */
const HISTORY_CONSENTS: readonly Labelled<boolean>[] = Object.freeze([
  { label: 'No, skip it', value: false },
  { label: 'Yes, scan names and counts', value: true },
])

/**
 * The answers to the history question. The declining answer is first because the engine dialog starts with its first
 * option focused (pre-checked on desktop), so a quick Submit declines (D-58, D-59 as amended by D-134).
 */
export const HISTORY_OPTIONS: readonly string[] = Object.freeze(HISTORY_CONSENTS.map(consent => consent.label))

/** Whether an answer allows the scan, matched trimmed and in any case; null when it names neither answer. */
function parseHistoryConsent(answer: string): boolean | null {
  return labelled(HISTORY_CONSENTS, answer)
}

/**
 * The notes of a scan, after its names, each only when it applies: the sessions over 4 MiB, those that could not be
 * read, then the stop at the 64 MiB total with the sessions it left unread.
 */
function noteLines(scan: HistoryScan): string[] {
  const of = sessionsText(scan.total)
  const unread = scan.total - scan.scanned - scan.skippedLarge - scan.skippedUnknown
  const large = `skipped ${scan.skippedLarge} of ${of} over ${HISTORY_MAX_FILE_BYTES / MIB} MiB`
  const partial = `partial: stopped at ${HISTORY_MAX_TOTAL_BYTES / MIB} MiB in total, ${unread} of ${of} not read`

  return [
    ...(scan.skippedLarge > 0 ? [`${large} (the heaviest sessions are not counted)`] : []),
    ...(scan.skippedUnknown > 0 ? [`skipped ${scan.skippedUnknown} of ${of} that could not be read`] : []),
    ...(scan.isPartial ? [`${partial} (the oldest sessions are not counted)`] : []),
  ]
}

/**
 * The history block init shows in the side pane after a scan (SCAN-03, D-133): the heading, then at most
 * MAX_HISTORY_ROWS names as `  <name>  <count>`, busiest first and then by name, or `  none` when no name was found,
 * then the notes (noteLines). A scan from scanHistory holds only names that fit HISTORY_NAME_PATTERN, so no transcript
 * text can reach a line.
 */
export function historyLines(scan: HistoryScan): string[] {
  const rows = [...scan.counts]
    .sort(busiestFirst)
    .slice(0, MAX_HISTORY_ROWS)
    .map(entry => `  ${entry.name}  ${entry.count}`)

  return [HISTORY_HEADING, ...(rows.length === 0 ? ['  none'] : rows), ...noteLines(scan)]
}

/** Logs a note and gives the skipped result: nothing was asked and no transcript was read. */
function skippedWith(io: InitIo, note: string): StepResult<'skipped'> {
  io.log(note)

  return { kind: 'accepted', value: 'skipped' }
}

/**
 * The history step (SCAN-03, D-59), which init runs once, after the scan summary. It lists this repo's session folder
 * in the user folder (historyDir, from the repo root as resolved) and reads nothing else before the person answers.
 * With no folder or no transcript it logs NO_HISTORY_NOTE, and with a folder it cannot list UNLISTED_HISTORY_NOTE;
 * either way it asks nothing and the scan is skipped. Otherwise it asks historyQuestion with the session count, and
 * `context`, the line of what the repo scan found (scanContextLine), on its second line (G-02-1, D-136):
 * `No, skip it` skips the scan and reads no transcript, and `Yes, scan names and counts` runs scanHistory over the
 * newest sessions and shows historyLines as the side pane's Session history block, each line cleaned as a report cell
 * (D-133). Any other answer is asked again with why on top. A dismissal is cancelled with
 * HISTORY_DISMISSED_REASON and MAX_ASKS answers that name neither with NO_USABLE_ANSWER_REASON, which init prints (A1,
 * D-45). It runs no process, and no other step needs its result: the counts are only hints for the skill questions.
 */
export async function historyStep(
  io: InitIo,
  locations: InitLocations,
  context: string,
): Promise<StepResult<HistoryScan | 'skipped'>> {
  const userDir = userDirOf(locations)
  if (userDir === null) return skippedWith(io, NO_HISTORY_NOTE)
  const dir = historyDir(userDir, locations.root)
  const listed = await listSessions(io, dir)
  if (listed === null) return skippedWith(io, UNLISTED_HISTORY_NOTE)
  if (listed.total === 0) return skippedWith(io, NO_HISTORY_NOTE)
  const ask = {
    question: withContext(historyQuestion(listed.total), context),
    spec: { options: HISTORY_OPTIONS, header: ASK_HEADERS.history },
    parse: parseHistoryConsent,
    accepts: quotedLabels(HISTORY_OPTIONS),
  }
  const answer = await askChoice(io, ask)
  if (answer.kind === 'dismissed') return { kind: 'cancelled', reason: HISTORY_DISMISSED_REASON }
  if (answer.kind === 'exhausted') return { kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON }
  if (!answer.value) return { kind: 'accepted', value: 'skipped' }
  const scan = await scanHistory(io, dir, listed.sessions)
  await showBlock(io, 'history', historyLines(scan))

  return { kind: 'accepted', value: scan }
}
