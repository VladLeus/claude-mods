/**
 * The inbox record, a layer 7 module: where a role's inbox.jsonl and session.json lie, the one-line JSON of an entry
 * or a mark, its fail-closed parse, and the session record a role publishes so other roles can wake it.
 */
import type { InboxEntry, InboxEvent, InboxMark, InboxState } from '../../types'
import { sha256Hex } from '../core/hash'
import { isObject, parseJsonValue } from '../core/json'
import { isRoleId } from '../core/role-id'
import { isChangedByClean } from '../core/text'
import { CONTRACTS } from '../locales/contracts'
import { INBOX_LOG_FILE, SESSION_FILE } from '../paths'
import { ENTRY_ID_PATTERN, INBOX_STATES, MESSAGE_KINDS } from './send'

/** How many hex characters of the content's SHA-256 an entry id keeps. */
const ENTRY_ID_HASH_CHARS = 8

/** The longest session id a session record may hold. */
const SESSION_ID_MAX_CHARS = 128

function runtimeFilePath(root: string, id: string, file: string): string {
  return `${root}/.cadre/${id}/.runtime/${file}`
}

export function inboxLogPath(root: string, id: string): string {
  return runtimeFilePath(root, id, INBOX_LOG_FILE)
}

export function sessionFilePath(root: string, id: string): string {
  return runtimeFilePath(root, id, SESSION_FILE)
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

function markStateOf(value: unknown): Exclude<InboxState, 'unread'> | null {
  for (const state of INBOX_STATES) {
    if (state !== 'unread' && state === value) return state
  }

  return null
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
