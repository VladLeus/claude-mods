/**
 * The inbox record, a layer 7 module: where a role's inbox.jsonl and session.json lie, the one-line JSON of an entry
 * or a mark, its fail-closed parse, and the session record a role publishes so other roles can wake it.
 */
import type { InboxEntry, InboxEvent, InboxItem, InboxMark, InboxState } from '../../types'
import { sha256Hex } from '../core/hash'
import { isObject, parseJsonValue } from '../core/json'
import { isRoleId } from '../core/role-id'
import { clean, isChangedByClean, reportText } from '../core/text'
import { CONTRACTS } from '../locales/contracts'
import { inboxHiddenOf, PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { INBOX_LOG_FILE, runtimeFileOf, SESSION_FILE } from '../paths'
import { bodyShown, ENTRY_ID_PATTERN, markStateOf, MESSAGE_KINDS, NOTE_MAX_CHARS } from './send'

/** How many hex characters of the content's SHA-256 an entry id keeps. */
const ENTRY_ID_HASH_CHARS = 8

/** The longest session id a session record may hold. */
const SESSION_ID_MAX_CHARS = 128

export function inboxLogPath(root: string, id: string): string {
  return runtimeFileOf(root, id, INBOX_LOG_FILE)
}

export function sessionFilePath(root: string, id: string): string {
  return runtimeFileOf(root, id, SESSION_FILE)
}

export function sessionRecordText(sessionId: string): string {
  return `${JSON.stringify({ sessionId, v: 1 })}\n`
}

/** The session id a session record names; null for any other text. */
export function parseSessionRecord(text: string): string | null {
  const value = parseJsonValue(text)?.value
  if (!isObject(value) || value.v !== 1) return null
  const { sessionId } = value
  if (typeof sessionId !== 'string' || sessionId === '') return null

  return isChangedByClean(sessionId, SESSION_ID_MAX_CHARS) ? null : sessionId
}

/** `<from>-<at>-<hash>`: two entries of one sender in the same millisecond differ by their content's hash. */
export async function entryIdOf(from: string, at: number, content: string): Promise<string> {
  const hash = await sha256Hex(content)

  return `${from}-${at}-${hash.slice(0, ENTRY_ID_HASH_CHARS)}`
}

/** The event with its keys in the record's fixed order and no other key. */
function orderedEvent(event: InboxEvent): InboxEvent {
  if (event.type === CONTRACTS.inboxMarkType) {
    const { v, type, id, at, by, state, note, waitsFor } = event

    return {
      v,
      type,
      id,
      at,
      by,
      state,
      ...(note === undefined ? {} : { note }),
      ...(waitsFor === undefined ? {} : { waitsFor }),
    }
  }
  const { v, type, id, at, from, to, kind, subject, body, replyTo } = event

  return { v, type, id, at, from, to, kind, subject, body, ...(replyTo === undefined ? {} : { replyTo }) }
}

/** One inbox.jsonl line: the event as JSON with no spaces, then a newline. */
export function recordLine(event: InboxEvent): string {
  return `${JSON.stringify(orderedEvent(event))}\n`
}

function isEntryId(value: unknown): value is string {
  return typeof value === 'string' && ENTRY_ID_PATTERN.test(value)
}

function isEpochMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRole(value: unknown): value is string {
  return typeof value === 'string' && isRoleId(value)
}

function entryOf(value: Readonly<Record<string, unknown>>): InboxEntry | null {
  const { id, at, from, to, kind, subject, body, replyTo } = value
  if (!isEntryId(id) || !isEpochMs(at) || !isRole(to)) return null
  if (from !== CONTRACTS.cadreSender && !isRole(from)) return null
  const kindName = MESSAGE_KINDS.find(known => known === kind)
  if (kindName === undefined || typeof subject !== 'string' || typeof body !== 'string') return null
  if (replyTo !== undefined && !isEntryId(replyTo)) return null
  const entry: InboxEntry = { v: 1, type: CONTRACTS.inboxEntryType, id, at, from, to, kind: kindName, subject, body }

  return replyTo === undefined ? entry : { ...entry, replyTo }
}

function markOf(value: Readonly<Record<string, unknown>>): InboxMark | null {
  const { id, at, by, state, note, waitsFor } = value
  if (!isEntryId(id) || !isEpochMs(at) || !isRole(by)) return null
  const marked = markStateOf(state)
  if (marked === null) return null
  if (note !== undefined && typeof note !== 'string') return null
  if (waitsFor !== undefined && !isEntryId(waitsFor)) return null

  return {
    v: 1,
    type: CONTRACTS.inboxMarkType,
    id,
    at,
    by,
    state: marked,
    ...(note === undefined ? {} : { note }),
    ...(waitsFor === undefined ? {} : { waitsFor }),
  }
}

/** One inbox.jsonl line read back; null for anything cadre would not have written. */
export function parseInboxLine(text: string): InboxEvent | null {
  const value = parseJsonValue(text)?.value
  if (!isObject(value) || value.v !== 1) return null
  if (value.type === CONTRACTS.inboxEntryType) return entryOf(value)
  if (value.type === CONTRACTS.inboxMarkType) return markOf(value)

  return null
}

/** The inbox_read input, or why it is refused. */
export type ReadInput =
  | { readonly kind: 'ok'; readonly all: boolean }
  | { readonly kind: 'error'; readonly message: string }

/** The inbox_read input: `all` also lists the items marked done or rejected; false when absent. */
export function parseReadInput(event: unknown): ReadInput {
  const all = isObject(event) ? event.all : undefined
  if (all === undefined) return { kind: 'ok', all: false }
  if (typeof all !== 'boolean') return { kind: 'error', message: PROMPTS.inboxAllNotBoolean }

  return { kind: 'ok', all }
}

/** Every inbox.jsonl line that parses, in file order; any other line is skipped on its own. */
export function parseInbox(text: string): InboxEvent[] {
  return text.split('\n').flatMap(line => {
    const event = line.trim() === '' ? null : parseInboxLine(line)

    return event === null ? [] : [event]
  })
}

function isEntry(event: InboxEvent): event is InboxEntry {
  return event.type === CONTRACTS.inboxEntryType
}

function isMark(event: InboxEvent): event is InboxMark {
  return event.type === CONTRACTS.inboxMarkType
}

/** The last mark on the entry by its receiver, the inbox's owner, and where it lies; null when it has none. */
function lastOwnerMark(
  events: readonly InboxEvent[],
  entry: InboxEntry,
): { readonly mark: InboxMark; readonly index: number } | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || !isMark(event)) continue
    if (event.id === entry.id && event.by === entry.to) return { mark: event, index }
  }

  return null
}

/** For an awaiting mark, the first later entry that replies to what it waits for; null otherwise. */
function replyOf(
  events: readonly InboxEvent[],
  found: { readonly mark: InboxMark; readonly index: number },
): string | null {
  const { waitsFor, state } = found.mark
  if (state !== 'awaiting' || waitsFor === undefined) return null
  const reply = events.slice(found.index + 1).find(event => isEntry(event) && event.replyTo === waitsFor)

  return reply === undefined ? null : reply.id
}

/**
 * Each entry in file order with what the last mark on it by its owner, in file order, says (unread when it has none),
 * and for an awaiting entry the reply that came after the mark.
 */
export function foldInbox(events: readonly InboxEvent[]): InboxItem[] {
  return events.filter(isEntry).map(entry => {
    const found = lastOwnerMark(events, entry)
    const mark = found?.mark

    return {
      entry,
      state: mark?.state ?? 'unread',
      note: mark?.note ?? null,
      waitsFor: mark?.waitsFor ?? null,
      reply: found === null ? null : replyOf(events, found),
      markedAt: mark?.at ?? null,
    }
  })
}

/** The states inbox_read leaves out unless it is asked for all items. */
export const CLOSED_STATES: readonly InboxState[] = Object.freeze(['done', 'rejected'])

/**
 * One item as inbox_read shows it: its head, its body lines whole and indented two spaces, then its note and reply.
 * The body is cleaned as the send keeps it, and the note is cut only over the mark's cap.
 */
function itemLines(item: InboxItem): string[] {
  const { id, kind, from, subject, body } = item.entry
  const head = fill(PROMPTS.inboxItemHead, { id, state: item.state, kind, from, subject: reportText(subject) })
  const note = item.note === null ? [] : [fill(PROMPTS.inboxItemNote, { note: clean(item.note, NOTE_MAX_CHARS) })]
  const reply = item.reply === null ? [] : [fill(PROMPTS.inboxItemReply, { reply: item.reply })]

  return [head, ...bodyShown(body).split('\n').map(line => `  ${line}`), ...note, ...reply]
}

/**
 * The inbox_read view: one block per item, blocks apart by a blank line. Unless `all`, the items marked done or
 * rejected are left out and a last line counts them.
 */
export function inboxReadText(items: readonly InboxItem[], all: boolean): string {
  if (items.length === 0) return PROMPTS.inboxEmpty
  const shown = all ? items : items.filter(item => !CLOSED_STATES.includes(item.state))
  const hidden = items.length - shown.length
  const last = hidden === 0 ? [] : [fill(inboxHiddenOf(hidden), { count: hidden })]

  return [...shown.map(item => itemLines(item).join('\n')), ...last].join('\n\n')
}
