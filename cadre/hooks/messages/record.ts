/**
 * The inbox record, a layer 7 module: where a role's inbox.jsonl and session.json lie in its inbox folder under the
 * user config dir, the one-line JSON of an entry or a mark, its fail-closed parse, and the session record a role
 * publishes so other roles can wake it.
 */
import type {
  InboxEntry,
  InboxEntryFields,
  InboxEvent,
  InboxItem,
  InboxMark,
  InboxState,
  SizeClass,
  SizeVector,
  TaskUse,
} from '../../types'
import { sha256Hex } from '../core/hash'
import { isObject, parseJsonValue } from '../core/json'
import { isRoleId } from '../core/role-id'
import { clean, isChangedByClean, reportText, utf8Bytes } from '../core/text'
import { CONTRACTS } from '../locales/contracts'
import { IDLE_INBOX_WAIT, inboxHiddenOf, PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { INBOX_LOG_FILE, inboxDirOf, isSafeRelativePath, SESSION_FILE } from '../paths'
import {
  bodyShown,
  CHANGES_MAX_CHARS,
  ENTRY_ID_PATTERN,
  INBOX_LINE_MAX_BYTES,
  kindFieldsOf,
  markStateOf,
  MESSAGE_KINDS,
  NOTE_MAX_CHARS,
  REPORT_FORM_MAX_CHARS,
  SIZE_PINS,
  SPEC_PATH_MAX_CHARS,
  VERIFICATION_MAX_CHARS,
} from './send'
import { parseScore, SP_METHOD, SP_PLAN_DIR } from './sizing'

/** How many hex characters of the content's SHA-256 an entry id keeps. */
const ENTRY_ID_HASH_CHARS = 8

/** The longest session id a session record may hold. */
const SESSION_ID_MAX_CHARS = 128

/** How many of its largest fields a line refusal names. */
const LINE_PARTS_SHOWN = 3

export function inboxLogPath(home: string, id: string): string {
  return `${inboxDirOf(home, id)}/${INBOX_LOG_FILE}`
}

export function sessionFilePath(home: string, id: string): string {
  return `${inboxDirOf(home, id)}/${SESSION_FILE}`
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

function orderedVector(vector: SizeVector): SizeVector {
  const { scope, complexity, risk, effort } = vector

  return { scope, complexity, risk, effort }
}

function orderedUse(use: TaskUse): TaskUse {
  const { framework, gsdPath } = use

  return gsdPath === undefined ? { framework } : { framework, gsdPath }
}

/** The kind fields and stamps of an entry in the record's fixed order, each nested object in its own fixed order. */
function orderedFields(entry: InboxEntry): InboxEntryFields {
  const { ticketKey, scores, pin, reportForm, vector, use, specPath, outcome, changes, verification } = entry
  const { reason, frameworkUsed, docPaths, openQuestions, mode, tickets, size, large, pinned, planPath, method } = entry

  return {
    ...(ticketKey === undefined ? {} : { ticketKey }),
    ...(scores === undefined ? {} : { scores: { scope: scores.scope, risk: scores.risk } }),
    ...(pin === undefined ? {} : { pin }),
    ...(reportForm === undefined ? {} : { reportForm }),
    ...(vector === undefined ? {} : { vector: orderedVector(vector) }),
    ...(use === undefined ? {} : { use: orderedUse(use) }),
    ...(specPath === undefined ? {} : { specPath }),
    ...(outcome === undefined ? {} : { outcome }),
    ...(changes === undefined ? {} : { changes }),
    ...(verification === undefined ? {} : { verification }),
    ...(reason === undefined ? {} : { reason }),
    ...(frameworkUsed === undefined ? {} : { frameworkUsed }),
    ...(docPaths === undefined ? {} : { docPaths }),
    ...(openQuestions === undefined ? {} : { openQuestions }),
    ...(mode === undefined ? {} : { mode }),
    ...(tickets === undefined ? {} : { tickets }),
    ...(size === undefined ? {} : { size }),
    ...(large === undefined ? {} : { large }),
    ...(pinned === undefined ? {} : { pinned }),
    ...(planPath === undefined ? {} : { planPath }),
    ...(method === undefined ? {} : { method }),
  }
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

  return {
    v,
    type,
    id,
    at,
    from,
    to,
    kind,
    subject,
    body,
    ...(replyTo === undefined ? {} : { replyTo }),
    ...orderedFields(event),
  }
}

/** One inbox.jsonl line: the event as JSON with no spaces, then a newline. */
export function recordLine(event: InboxEvent): string {
  return `${JSON.stringify(orderedEvent(event))}\n`
}

/**
 * Why the record line of an entry is not appended: its size in bytes against the line cap and its largest fields by
 * the bytes of their JSON, ties in record order; null within the cap.
 */
export function lineRefusal(entry: InboxEntry, line: string): string | null {
  const size = utf8Bytes(line)
  if (size <= INBOX_LINE_MAX_BYTES) return null
  const parts = Object.entries(orderedEvent(entry))
    .map(([field, value]) => ({ field, bytes: utf8Bytes(JSON.stringify(value)) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, LINE_PARTS_SHOWN)
    .map(part => fill(PROMPTS.inboxLinePart, part))

  return fill(PROMPTS.inboxLineTooLarge, { size, max: INBOX_LINE_MAX_BYTES, parts: parts.join(', ') })
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

/** The size stamps of a stored entry: both absent, or a size that is a score and a large that is true or false. */
function sizeStampsOf(value: Readonly<Record<string, unknown>>): InboxEntryFields | null {
  const { size, large } = value
  if (size === undefined && large === undefined) return {}
  const score = parseScore(size)
  if (score === null || typeof large !== 'boolean') return null

  return { size: score, large }
}

/** The pin stamp of a stored entry: absent, or a pin. */
function pinStampOf(value: Readonly<Record<string, unknown>>): InboxEntryFields | null {
  const { pinned } = value
  if (pinned === undefined) return {}
  const pin = SIZE_PINS.find(known => known === pinned)

  return pin === undefined ? null : { pinned: pin }
}

/** The plan stamps of a stored entry: both absent, or a plan file under the superpowers plan folder and the method. */
function planStampsOf(value: Readonly<Record<string, unknown>>): InboxEntryFields | null {
  const { planPath, method } = value
  if (planPath === undefined && method === undefined) return {}
  if (typeof planPath !== 'string' || !planPath.startsWith(`${SP_PLAN_DIR}/`)) return null
  if (!isSafeRelativePath(planPath) || method !== SP_METHOD) return null

  return { planPath, method }
}

/**
 * An entry as stored: every kind field it holds valid for its kind (an entry from before a field existed lacks it),
 * and its stamps valid; null for anything else.
 */
function entryOf(value: Readonly<Record<string, unknown>>): InboxEntry | null {
  const { id, at, from, to, kind, subject, body, replyTo } = value
  if (!isEntryId(id) || !isEpochMs(at) || !isRole(to)) return null
  if (from !== CONTRACTS.cadreSender && !isRole(from)) return null
  const kindName = MESSAGE_KINDS.find(known => known === kind)
  if (kindName === undefined || typeof subject !== 'string' || typeof body !== 'string') return null
  if (replyTo !== undefined && !isEntryId(replyTo)) return null
  const fields = kindFieldsOf(kindName, value)
  const sized = sizeStampsOf(value)
  const pinned = pinStampOf(value)
  const planned = planStampsOf(value)
  if (fields.kind === 'error' || sized === null || pinned === null || planned === null) return null
  const entry: InboxEntry = { v: 1, type: CONTRACTS.inboxEntryType, id, at, from, to, kind: kindName, subject, body }

  return { ...entry, ...(replyTo === undefined ? {} : { replyTo }), ...fields.fields, ...sized, ...pinned, ...planned }
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
  | { readonly kind: 'ok'; readonly all: boolean; readonly id: string | null }
  | { readonly kind: 'error'; readonly message: string }

/** What inbox_read takes from the model. */
export function inboxReadSchema(): Readonly<Record<string, unknown>> {
  return { type: 'object', properties: { all: { type: 'boolean' }, id: { type: 'string' } } }
}

/** The inbox_read input: `all` is false and `id` null when absent; an `id` must be an entry id. */
export function parseReadInput(event: unknown): ReadInput {
  const all = isObject(event) ? event.all : undefined
  const id = isObject(event) ? event.id : undefined
  if (all !== undefined && typeof all !== 'boolean') return { kind: 'error', message: PROMPTS.inboxAllNotBoolean }
  if (id !== undefined && !isEntryId(id)) return { kind: 'error', message: PROMPTS.inboxReadIdBad }

  return { kind: 'ok', all: all === true, id: isEntryId(id) ? id : null }
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

/** What the tickets of a key in an inbox say about the pin a task inherits. */
export type TicketPin = SizeClass | 'unpinned' | 'no-ticket'

/**
 * The pin of the last ticket of the key that carries one; unpinned when none does, no-ticket when no ticket has the
 * key.
 */
export function ticketPinOf(events: readonly InboxEvent[], ticketKey: string): TicketPin {
  const tickets = events.filter(isEntry).filter(entry => entry.kind === 'ticket' && entry.ticketKey === ticketKey)
  if (tickets.length === 0) return 'no-ticket'

  return tickets.findLast(ticket => ticket.pin !== undefined)?.pin ?? 'unpinned'
}

/** The states inbox_read leaves out unless it is asked for all items. */
export const CLOSED_STATES: readonly InboxState[] = Object.freeze(['done', 'rejected'])

/** A field's value as the view shows it; undefined when the entry does not hold the field. */
function shownOf<T>(value: T | undefined, show: (held: T) => string): string | undefined {
  return value === undefined ? undefined : show(value)
}

/** A list's items cleaned and joined, or the none word for an empty list. */
function listShown(items: readonly string[], separator: string): string {
  return items.length === 0 ? PROMPTS.inboxItemNone : items.map(item => reportText(item)).join(separator)
}

/** The four scores, with the size and its class when the entry holds the size stamps, and the pin that set it. */
function vectorShown(entry: InboxEntry, vector: SizeVector): string {
  const shown = fill(PROMPTS.inboxItemVector, vector)
  const { size, large, pinned } = entry
  if (size === undefined || large === undefined) return shown
  const sizeClass = large ? 'large' : 'small'
  if (pinned !== undefined) return fill(PROMPTS.inboxItemSizedPinned, { vector: shown, sizeClass, size })

  return fill(PROMPTS.inboxItemSized, { vector: shown, size, sizeClass })
}

function useShown(use: TaskUse): string {
  return use.gsdPath === undefined ? reportText(use.framework) : fill(PROMPTS.inboxItemUseGsd, { gsdPath: use.gsdPath })
}

/**
 * One line per kind field and stamp the entry holds, in the record's order, each value cleaned. A text whose cap is
 * over the report cap is shown whole up to its own cap, as the send kept it.
 */
function fieldLines(entry: InboxEntry): string[] {
  const shown: readonly (readonly [string, string | undefined])[] = [
    ['ticketKey', shownOf(entry.ticketKey, reportText)],
    ['scores', shownOf(entry.scores, scores => fill(PROMPTS.inboxItemScores, scores))],
    ['pin', shownOf(entry.pin, reportText)],
    ['reportForm', shownOf(entry.reportForm, text => clean(text, REPORT_FORM_MAX_CHARS))],
    ['vector', shownOf(entry.vector, vector => vectorShown(entry, vector))],
    ['use', shownOf(entry.use, useShown)],
    ['specPath', shownOf(entry.specPath, path => clean(path, SPEC_PATH_MAX_CHARS))],
    ['planPath', shownOf(entry.planPath, reportText)],
    ['method', shownOf(entry.method, method => fill(PROMPTS.inboxItemMethod, { method: reportText(method) }))],
    ['outcome', shownOf(entry.outcome, reportText)],
    ['changes', shownOf(entry.changes, text => clean(text, CHANGES_MAX_CHARS))],
    ['verification', shownOf(entry.verification, text => clean(text, VERIFICATION_MAX_CHARS))],
    ['reason', shownOf(entry.reason, reportText)],
    ['frameworkUsed', shownOf(entry.frameworkUsed, reportText)],
    ['docPaths', shownOf(entry.docPaths, paths => listShown(paths, ', '))],
    ['openQuestions', shownOf(entry.openQuestions, questions => listShown(questions, '; '))],
    ['mode', shownOf(entry.mode, reportText)],
    ['tickets', shownOf(entry.tickets, keys => listShown(keys, ', '))],
  ]

  return shown.flatMap(([field, value]) =>
    value === undefined ? [] : [fill(PROMPTS.inboxItemField, { field, value })],
  )
}

function headOf(item: InboxItem): string {
  const { id, kind, from, subject } = item.entry

  return fill(PROMPTS.inboxItemHead, { id, state: item.state, kind, from, subject: reportText(subject) })
}

/** The note, cut only over the mark's cap, and the reply of an item, each when it holds one. */
function markParts(item: InboxItem): string[] {
  const note = item.note === null ? [] : [fill(PROMPTS.inboxItemNote, { note: clean(item.note, NOTE_MAX_CHARS) })]
  const reply = item.reply === null ? [] : [fill(PROMPTS.inboxItemReply, { reply: item.reply })]

  return [...note, ...reply]
}

function headLine(item: InboxItem): string {
  return [headOf(item), ...markParts(item)].join('; ')
}

/** One item in full: its head, its body lines indented two spaces, a line per kind field, then its note and reply. */
function itemLines(item: InboxItem): string[] {
  const bodyLines = bodyShown(item.entry.body)
    .split('\n')
    .map(line => `  ${line}`)

  return [headOf(item), ...bodyLines, ...fieldLines(item.entry), ...markParts(item)]
}

/**
 * The inbox_read view, items apart by a blank line: an unread item in full, any other as its head line. Unless `all`,
 * the items marked done or rejected are left out and a last line counts them; with none left, the idle wait follows.
 */
export function inboxReadText(items: readonly InboxItem[], all: boolean): string {
  if (items.length === 0) return PROMPTS.inboxEmpty
  const shown = all ? items : items.filter(item => !CLOSED_STATES.includes(item.state))
  const hidden = items.length - shown.length
  const last = hidden === 0 ? [] : [fill(inboxHiddenOf(hidden), { count: hidden })]
  if (shown.length === 0) return [...last, IDLE_INBOX_WAIT].join('\n\n')
  const blocks = shown.map(item => (item.state === 'unread' ? itemLines(item).join('\n') : headLine(item)))

  return [...blocks, ...last].join('\n\n')
}

/** The entry with this id in full, whatever its state; null when no item of the inbox has it. */
export function inboxEntryText(items: readonly InboxItem[], id: string): string | null {
  const item = items.find(held => held.entry.id === id)

  return item === undefined ? null : itemLines(item).join('\n')
}
