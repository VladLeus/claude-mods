import type { InitIo, InitLocations } from '../types'
import { labelled } from './core/labelled'
import type { Labelled } from './core/labelled'
import { userDirOf } from './paths'
import {
  busiestFirst,
  HISTORY_MAX_FILE_BYTES,
  HISTORY_MAX_SESSIONS,
  HISTORY_MAX_TOTAL_BYTES,
  historyDir,
  listSessions,
  scanHistory,
} from './scan/history'
import type { HistoryScan } from './scan/history'
import { ASK_HEADERS, askChoice, NO_USABLE_ANSWER_REASON, quotedLabels, showBlock, withContext } from './ui/ask'
import type { StepResult } from './ui/ask'

/** The line init prints when this repo has no session history: no session folder, or no transcript in it (SCAN-03). */
export const NO_HISTORY_NOTE = 'No session history for this repo.'

/** The line init prints when the session folder cannot be listed: unknown is never taken as no history. */
export const UNLISTED_HISTORY_NOTE = "Could not list this repo's session history, so it was not scanned."

/** Why init cancels when the history question is dismissed or not answered (A1, D-45). */
export const HISTORY_DISMISSED_REASON = 'The session history question was dismissed or not answered.'

/** Bytes in one MiB, to word the caps in the notes. */
const MIB = 1024 * 1024

/** The heading of the history block. */
const HISTORY_HEADING = 'Session history (names and counts only):'

/** The most names the history block lists. */
const MAX_HISTORY_ROWS = 15

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
