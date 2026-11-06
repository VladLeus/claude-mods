/**
 * The history scan, a layer 3 module: this repo's session transcripts, newest first and at most HISTORY_MAX_SESSIONS
 * of them, and the command and skill names they use with their counts, matched line by line and never parsed as JSON
 * (SCAN-03, D-59). It lists and reads through the init port and keeps names and numbers only. It imports core, paths,
 * the port reads and the types, so the history step and the skill questions read the scan here.
 */
import type { InitIo, PortEntry } from '../../types'
import { asciiLower, compareText } from '../core/text'
import { projectFolderOf } from '../paths'
import { listingState } from './port-read'

/** The most sessions the history scan reads: the newest by modification time (D-59). */
export const HISTORY_MAX_SESSIONS = 50

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
export type NameCount = HistoryScan['counts'][number]

/** The extension of a session transcript file. */
const SESSION_EXTENSION = '.jsonl'

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
export function busiestFirst(a: NameCount, b: NameCount): number {
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
