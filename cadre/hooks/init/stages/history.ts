/**
 * The history stage of init (SCAN-03, D-59, D-133, D-230), a layer 10 module: the consent question, asked before any
 * session transcript is read, with how many sessions this repo has and that only the newest are read
 * (historyQuestion), and historyStage, the pure stage that has this repo's session folder listed, asks, has the
 * history scan (scan/history) run only after a yes and shows the names and counts it found as the side pane's Session
 * history block (historyLines); and historyHints, the scan as hints for the skill questions. Pure: it gives states and
 * never performs an effect, imports core, paths, scan/gather, scan/history, ui and init/state, and never imports
 * init/machine or init/run.
 */
import type { InitLocations } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { t, tn } from '../../locales/t'
import { userDirOf } from '../../paths'
import {
  busiestFirst,
  HISTORY_MAX_FILE_BYTES,
  HISTORY_MAX_SESSIONS,
  HISTORY_MAX_TOTAL_BYTES,
  historyDir,
} from '../../scan/history'
import type { Gathered } from '../../scan/gather'
import type { HistoryScan } from '../../scan/history'
import { ASK_HEADERS, choiceAnswer, quotedLabels, withContext } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import { scanContext } from '../../ui/blocks/context'
import { scanContextLine } from '../../ui/blocks/scan'
import { stageCancelled, stageDone, stageFailed, withEffect, withOutputs } from '../state'
import type { Answer, InitState, SessionListing, StageDef } from '../state'

/** The line init prints when this repo has no session history: no session folder, or no transcript in it (SCAN-03). */
export const NO_HISTORY_NOTE = t('init.history.noHistoryNote')

/** The line init prints when the session folder cannot be listed: unknown is never taken as no history. */
export const UNLISTED_HISTORY_NOTE = t('init.history.unlistedHistoryNote')

/** Why init cancels when the history question is dismissed or not answered (A1, D-45). */
export const HISTORY_DISMISSED_REASON = t('init.history.historyDismissedReason')

/** Bytes in one MiB, to word the caps in the notes. */
const MIB = 1024 * 1024

/** The heading of the history block. */
const HISTORY_HEADING = t('init.history.historyHeading')

/** The most names the history block lists. */
const MAX_HISTORY_ROWS = 15

/**
 * The history consent question (SCAN-03, D-59): how many sessions this repo has, asked before any is read, and that
 * only the newest HISTORY_MAX_SESSIONS are read when there are more (IN-03).
 */
export function historyQuestion(total: number): string {
  const newest = total > HISTORY_MAX_SESSIONS ? t('init.history.newest', { count: HISTORY_MAX_SESSIONS }) : ''

  return tn('init.history.question', total, { count: total, newest })
}

/** Each history answer with what it allows, the declining one first: only the yes reads a transcript (D-59). */
const HISTORY_CONSENTS: readonly Labelled<boolean>[] = Object.freeze([
  { label: t('init.history.consentNo'), value: false },
  { label: t('init.history.consentYes'), value: true },
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
  const count = scan.total
  const unread = scan.total - scan.scanned - scan.skippedLarge - scan.skippedUnknown
  const large = tn('init.history.skippedLarge', count, {
    skipped: scan.skippedLarge,
    count,
    mib: HISTORY_MAX_FILE_BYTES / MIB,
  })
  const partial = tn('init.history.partial', count, { mib: HISTORY_MAX_TOTAL_BYTES / MIB, unread, count })
  const unknown = tn('init.history.skippedUnknown', count, { skipped: scan.skippedUnknown, count })

  return [
    ...(scan.skippedLarge > 0 ? [large] : []),
    ...(scan.skippedUnknown > 0 ? [unknown] : []),
    ...(scan.isPartial ? [partial] : []),
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

  return [HISTORY_HEADING, ...(rows.length === 0 ? [t('init.history.noneRow')] : rows), ...noteLines(scan)]
}

/**
 * The session folder of this repo in the user folder (historyDir), or null when no user folder is known. The user
 * folder follows userDirOf; an ignored CLAUDE_CONFIG_DIR is already named in the scan warnings before this stage.
 */
function historyDirOf(state: InitState): string | null {
  const { locations } = state.draft
  const userDir = locations === undefined ? null : userDirOf(locations, [locations.root], [])
  if (locations === undefined || userDir === null) return null

  return historyDir(userDir, locations.root)
}

/**
 * The history question as the stage asks it (SCAN-03, D-136): historyQuestion with the session count, and the line of
 * what the repo scan found on its second line (scanContextLine); the two answers with the History chip and the scan
 * block as its own context (scanContext, D-236), the answers its refusal lists, and the reason a dismissal cancels
 * with.
 */
function historyAsk(
  total: number,
  locations: InitLocations,
  gathered: Gathered,
): ChoiceAsk<boolean> & { readonly dismissedReason: string } {
  return {
    question: withContext(historyQuestion(total), scanContextLine(gathered.repo)),
    spec: { options: HISTORY_OPTIONS, header: ASK_HEADERS.history, context: scanContext(locations, gathered) },
    parse: parseHistoryConsent,
    accepts: quotedLabels(HISTORY_OPTIONS),
    dismissedReason: HISTORY_DISMISSED_REASON,
  }
}

/** The history scan as hints for the skill questions: each name with its count; none when the scan was skipped. */
export function historyHints(history: HistoryScan | 'skipped'): ReadonlyMap<string, number> {
  if (history === 'skipped') return new Map()

  return new Map(history.counts.map((entry): [string, number] => [entry.name, entry.count]))
}

/** The stage done with the hints of `history` (historyHints): none when the scan was skipped (D-59). */
function withHints(state: InitState, history: HistoryScan | 'skipped'): InitState {
  return stageDone({ ...state, draft: { ...state.draft, hints: historyHints(history) } })
}

/** The scan skipped with `note` logged as it is: nothing was asked and no transcript was read. */
function skippedWith(state: InitState, note: string): InitState {
  return withHints(withOutputs(state, [{ kind: 'log', text: note }]), 'skipped')
}

/** The history question asked with the session count and the scan's context line, asked `tries` times so far. */
function historyAsked(state: InitState, listing: SessionListing, question: string | null, tries: number): InitState {
  const { gathered, locations } = state.draft
  if (gathered === undefined || locations === undefined) return stageFailed(state)
  const ask = historyAsk(listing.total, locations, gathered)
  const sub: InitState['sub'] = { kind: 'history', tries, listing }

  return withEffect({ ...state, sub }, { kind: 'ask', question: question ?? ask.question, spec: ask.spec })
}

/**
 * After the session folder was listed: with a folder it cannot list UNLISTED_HISTORY_NOTE, and with no transcript
 * NO_HISTORY_NOTE, either way asking nothing; else the history question, the listed sessions kept for the scan.
 */
function afterListing(state: InitState, listing: SessionListing | null): InitState {
  if (listing === null) return skippedWith(state, UNLISTED_HISTORY_NOTE)
  if (listing.total === 0) return skippedWith(state, NO_HISTORY_NOTE)

  return historyAsked(state, listing, null, 1)
}

/**
 * The answer to the history question (choiceAnswer): `No, skip it` skips the scan and reads no transcript; `Yes, scan
 * names and counts` has the newest listed sessions scanned (the scan-history io effect); any other answer is asked
 * again with why on top. A dismissal cancels with HISTORY_DISMISSED_REASON and MAX_ASKS answers that name neither with
 * NO_USABLE_ANSWER_REASON (A1, D-45).
 */
function afterConsent(state: InitState, answer: string | null): InitState {
  const { gathered, locations } = state.draft
  const dir = historyDirOf(state)
  if (state.sub.kind !== 'history' || gathered === undefined || locations === undefined || dir === null) {
    return stageFailed(state)
  }
  const { listing } = state.sub
  const next = choiceAnswer(historyAsk(listing.total, locations, gathered), state.sub, answer)
  if (next.kind === 'again') return historyAsked(state, listing, next.question, next.sub.tries)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  if (!next.value) return withHints(state, 'skipped')

  return withEffect(state, { kind: 'io', call: { id: 'scan-history', dir, sessions: listing.sessions } })
}

/** After the scan: its names and counts shown as the Session history block (historyLines, D-133), kept as hints. */
function afterScan(state: InitState, scan: HistoryScan): InitState {
  return withHints(withOutputs(state, [{ kind: 'show', block: { key: 'history', lines: historyLines(scan) } }]), scan)
}

/** The answer to the effect the history stage has out: the listing, the history question, or the scan. */
function historyAnswer(state: InitState, answer: Answer): InitState {
  if (answer.kind === 'answer') return afterConsent(state, answer.text)
  if (answer.kind !== 'io') return stageFailed(state)
  const { result } = answer
  if (result.id === 'list-sessions') return afterListing(state, result.result)
  if (result.id === 'scan-history') return afterScan(state, result.result)

  return stageFailed(state)
}

/**
 * The history stage (SCAN-03, D-59, D-230), right after the scan summary. It has this repo's session folder in the
 * user folder listed (historyDir, from the repo root as resolved), and reads nothing else before the person answers:
 * with no user folder, no folder or no transcript it logs NO_HISTORY_NOTE, and with a folder it cannot list
 * UNLISTED_HISTORY_NOTE; either way it asks nothing and the scan is skipped. Otherwise it asks the history question
 * (afterListing, afterConsent), and only after a yes the scan runs over the newest sessions and its names and counts
 * show as the Session history block, each line cleaned as a report cell (D-133). No other stage needs the result: the
 * counts are only hints for the skill questions (historyHints).
 */
export const historyStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    if (state.draft.locations === undefined) return stageFailed(state)
    const dir = historyDirOf(state)
    if (dir === null) return skippedWith(state, NO_HISTORY_NOTE)

    return withEffect(state, { kind: 'io', call: { id: 'list-sessions', dir } })
  },
  answer: historyAnswer,
})
