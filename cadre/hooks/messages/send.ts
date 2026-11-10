/**
 * The inbox_send input check, a layer 7 module: the message kinds and states, the caps of an inbox line and of the
 * kind fields, and the parse of the model's tool input into a message cadre can stamp. Only the keys it names are
 * read, so a sender, a stamp or any other key the model adds is never used.
 */
import type {
  GsdPath,
  InboxEntryFields,
  InboxState,
  MessageKind,
  ReportOutcome,
  RoleContext,
  SizeClass,
  TaskUse,
  TeamView,
} from '../../types'
import { FRAMEWORK_IDS, isFrameworkId } from '../core/framework-id'
import { isObject } from '../core/json'
import { clean, reportText } from '../core/text'
import { INBOX_ENTRY_FIELDS } from '../locales/contracts'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { isSafeRelativePath } from '../paths'
import { GSD_PATHS, parseProductScores, parseVector, PLANNING_MODES } from './sizing'

export const MESSAGE_KINDS: readonly MessageKind[] = Object.freeze([
  'ticket',
  'task',
  'report',
  'question',
  'answer',
  'epic-end',
  'note',
])

export const INBOX_STATES: readonly InboxState[] = Object.freeze([
  'unread',
  'read',
  'awaiting',
  'blocked',
  'rejected',
  'done',
])

export const SUBJECT_MAX_CHARS = 120
export const BODY_MAX_CHARS = 3000
export const INBOX_LINE_MAX_BYTES = 4000
export const INBOX_READ_MAX_BYTES = 1024 * 1024
export const INBOX_APPEND_TIMEOUT_MS = 10_000

/** /cadre start moves aside an inbox over this size, below INBOX_READ_MAX_BYTES, so its role can always read it. */
export const INBOX_ROTATE_BYTES = 768 * 1024

/** The most bytes of a large inbox /cadre start reads to list its open entries. */
export const INBOX_ROTATE_READ_MAX_BYTES = 8 * 1024 * 1024

export const NOTE_MAX_CHARS = 300

/** The kinds only the team's PM stand-in sends. */
const PM_KINDS: readonly MessageKind[] = Object.freeze(['ticket', 'epic-end'])

/** An inbox entry id: the sender, the time in epoch ms and the first 8 hex of the content's SHA-256. */
export const ENTRY_ID_PATTERN = /^[a-z0-9-]{1,64}-\d{1,16}-[0-9a-f]{8}$/

export const REPORT_OUTCOMES: readonly ReportOutcome[] = Object.freeze(['done', 'blocked', 'partial'])

/** The size classes a PM's pin on a ticket may name. */
export const SIZE_PINS: readonly SizeClass[] = Object.freeze(['small', 'large'])

export const TICKET_KEY_MAX_CHARS = 64

/** A ticket key: a letter or digit, then letters, digits, dots, dashes or underscores, so it is safe in a file name. */
export const TICKET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export const REPORT_FORM_MAX_CHARS = 500
export const CHANGES_MAX_CHARS = 1000
export const VERIFICATION_MAX_CHARS = 500
export const REASON_MAX_CHARS = 200
export const LIST_MAX_ITEMS = 10
export const LIST_ITEM_MAX_CHARS = 200

/** The most ticket keys a brief lists; the line cap is the real bound of a long list. */
export const TICKETS_MAX_ITEMS = 100

/** A GSD workstream of a role, as a report may list it among its documents. */
const WORKSTREAM_NAME = /^cadre-[a-z0-9-]{1,80}$/

/** The kind fields each kind takes, in the record's order; any other kind field on it is refused. */
const KIND_FIELDS: Readonly<Record<MessageKind, readonly string[]>> = Object.freeze({
  ticket: ['ticketKey', 'scores', 'pin', 'reportForm'],
  task: ['ticketKey', 'vector', 'use', 'specPath'],
  report: ['outcome', 'changes', 'verification', 'vector', 'reason', 'frameworkUsed', 'docPaths', 'openQuestions'],
  question: [],
  answer: [],
  'epic-end': [],
  note: ['mode', 'tickets'],
})

/** The kind fields a send of each kind must carry. */
const REQUIRED_FIELDS: Readonly<Record<MessageKind, readonly string[]>> = Object.freeze({
  ticket: ['ticketKey', 'scores'],
  task: ['ticketKey', 'vector', 'use'],
  report: ['outcome', 'changes', 'verification', 'vector', 'reason', 'frameworkUsed', 'docPaths', 'openQuestions'],
  question: [],
  answer: [],
  'epic-end': [],
  note: [],
})

/** A send the model asked for, checked, or why it is refused. */
export type SendInput =
  | {
      readonly kind: 'ok'
      readonly to: string
      readonly kindName: MessageKind
      readonly subject: string
      readonly body: string
      readonly replyTo: string | null
      readonly fields: InboxEntryFields
    }
  | { readonly kind: 'error'; readonly message: string }

/** The fields of a kind as the model gave them, checked, or why they are refused. */
export type KindFields =
  | { readonly kind: 'ok'; readonly fields: InboxEntryFields }
  | { readonly kind: 'error'; readonly message: string }

/** A line break as a model may send it: CR LF, CR or LF. */
const LINE_BREAK = /\r\n|\r|\n/g

/** What clean removes, less the line break and the tab a body keeps. */
const BODY_DROPPED = /(?![\n\t])[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu

function sendError(message: string): SendInput {
  return { kind: 'error', message }
}

/** A subject on one line: line breaks become a space, invisible characters go, and it is cut to its cap. */
function subjectText(raw: unknown): string {
  return typeof raw === 'string' ? clean(raw.replace(LINE_BREAK, ' '), SUBJECT_MAX_CHARS).trim() : ''
}

/** The body as the send keeps it: LF line breaks, tabs kept, every other control or invisible character removed. */
export function bodyShown(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(BODY_DROPPED, '')
}

/** The body of the input, never cut; '' when it is not text. */
function bodyText(raw: unknown): string {
  return typeof raw === 'string' ? bodyShown(raw) : ''
}

/** Text on one line: line breaks become a space and invisible characters go; '' when it is not text. */
function lineOf(raw: unknown): string {
  return typeof raw === 'string' ? clean(raw.replace(LINE_BREAK, ' '), Infinity).trim() : ''
}

function fieldsError(message: string): KindFields {
  return { kind: 'error', message }
}

function isTicketKey(value: unknown): value is string {
  return typeof value === 'string' && TICKET_KEY_PATTERN.test(value)
}

function isGsdPath(value: unknown): value is GsdPath {
  return GSD_PATHS.some(path => path === value)
}

/** The framework of a task and, only on gsd, its GSD path; null for anything else. */
function parseUse(value: unknown): TaskUse | null {
  if (!isObject(value)) return null
  const { framework, gsdPath } = value
  if (!isFrameworkId(framework)) return null
  if (gsdPath === undefined) return { framework }
  if (framework !== 'gsd' || !isGsdPath(gsdPath)) return null

  return { framework, gsdPath }
}

/** A list of at most `max` items, each kept by `itemOf`; null when it is no list, too long, or holds a refused item. */
function listOf(raw: unknown, max: number, itemOf: (item: unknown) => string | null): string[] | null {
  if (!Array.isArray(raw) || raw.length > max) return null
  const items: string[] = []
  for (const item of raw) {
    const kept = itemOf(item)
    if (kept === null) return null
    items.push(kept)
  }

  return items
}

function docPathOf(item: unknown): string | null {
  if (typeof item !== 'string' || Array.from(item).length > LIST_ITEM_MAX_CHARS) return null

  return isSafeRelativePath(item) || WORKSTREAM_NAME.test(item) ? item : null
}

function questionOf(item: unknown): string | null {
  const text = lineOf(item)

  return text !== '' && Array.from(text).length <= LIST_ITEM_MAX_CHARS ? text : null
}

function ticketKeyOf(item: unknown): string | null {
  return isTicketKey(item) ? item : null
}

/** One kind field as part of an entry: {} when it is absent, the field when it is valid, else its refusal. */
type FieldPart = InboxEntryFields | string

/** A text field kept whole on one line: refused when empty or over its cap, never cut. */
function textPart(raw: unknown, field: string, max: number, part: (text: string) => InboxEntryFields): FieldPart {
  if (raw === undefined) return {}
  const text = lineOf(raw)
  if (text === '') return fill(PROMPTS.inboxFieldEmpty, { field })
  if (Array.from(text).length > max) return fill(PROMPTS.inboxFieldTooLong, { field, max })

  return part(text)
}

function ticketKeyPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}

  return isTicketKey(raw) ? { ticketKey: raw } : fill(PROMPTS.inboxTicketKeyBad, { max: TICKET_KEY_MAX_CHARS })
}

function scoresPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const scores = parseProductScores(raw)

  return scores === null ? PROMPTS.inboxScoresBad : { scores }
}

function pinPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const pin = SIZE_PINS.find(known => known === raw)

  return pin === undefined ? fill(PROMPTS.inboxPinBad, { pins: SIZE_PINS.join(', ') }) : { pin }
}

function vectorPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const vector = parseVector(raw)

  return vector === null ? PROMPTS.inboxVectorBad : { vector }
}

function usePart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const use = parseUse(raw)

  return use === null ? PROMPTS.inboxUseBad : { use }
}

function specPathPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}

  return typeof raw === 'string' && isSafeRelativePath(raw) ? { specPath: raw } : PROMPTS.inboxSpecPathBad
}

function outcomePart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const outcome = REPORT_OUTCOMES.find(known => known === raw)

  return outcome === undefined ? fill(PROMPTS.inboxOutcomeBad, { outcomes: REPORT_OUTCOMES.join(', ') }) : { outcome }
}

function frameworkUsedPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  if (!isFrameworkId(raw)) return fill(PROMPTS.inboxFrameworkUsedBad, { frameworks: FRAMEWORK_IDS.join(', ') })

  return { frameworkUsed: raw }
}

function docPathsPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const docPaths = listOf(raw, LIST_MAX_ITEMS, docPathOf)
  if (docPaths === null) return fill(PROMPTS.inboxDocPathsBad, { max: LIST_MAX_ITEMS, chars: LIST_ITEM_MAX_CHARS })

  return { docPaths }
}

function openQuestionsPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const openQuestions = listOf(raw, LIST_MAX_ITEMS, questionOf)
  if (openQuestions === null) {
    return fill(PROMPTS.inboxOpenQuestionsBad, { max: LIST_MAX_ITEMS, chars: LIST_ITEM_MAX_CHARS })
  }

  return { openQuestions }
}

function modePart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const mode = PLANNING_MODES.find(known => known === raw)

  return mode === undefined ? fill(PROMPTS.inboxModeBad, { modes: PLANNING_MODES.join(', ') }) : { mode }
}

function ticketsPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const tickets = listOf(raw, TICKETS_MAX_ITEMS, ticketKeyOf)

  return tickets === null ? fill(PROMPTS.inboxTicketsBad, { max: TICKETS_MAX_ITEMS }) : { tickets }
}

/** The reader of each kind field by its record name. */
const FIELD_PARTS: Readonly<Record<string, (raw: unknown) => FieldPart>> = Object.freeze({
  ticketKey: ticketKeyPart,
  scores: scoresPart,
  pin: pinPart,
  reportForm: (raw: unknown) => textPart(raw, 'reportForm', REPORT_FORM_MAX_CHARS, reportForm => ({ reportForm })),
  vector: vectorPart,
  use: usePart,
  specPath: specPathPart,
  outcome: outcomePart,
  changes: (raw: unknown) => textPart(raw, 'changes', CHANGES_MAX_CHARS, changes => ({ changes })),
  verification: (raw: unknown) =>
    textPart(raw, 'verification', VERIFICATION_MAX_CHARS, verification => ({ verification })),
  reason: (raw: unknown) => textPart(raw, 'reason', REASON_MAX_CHARS, reason => ({ reason })),
  frameworkUsed: frameworkUsedPart,
  docPaths: docPathsPart,
  openQuestions: openQuestionsPart,
  mode: modePart,
  tickets: ticketsPart,
})

/**
 * The fields the kind takes, from a stored line or the model's input: each one present is checked, an absent one
 * stays absent, and a field of another kind is not read. The first bad field gives its refusal.
 */
export function kindFieldsOf(kind: MessageKind, fields: Readonly<Record<string, unknown>>): KindFields {
  let merged: InboxEntryFields = {}
  for (const field of KIND_FIELDS[kind]) {
    const part = FIELD_PARTS[field]?.(fields[field]) ?? {}
    if (typeof part === 'string') return fieldsError(part)
    merged = { ...merged, ...part }
  }

  return { kind: 'ok', fields: merged }
}

/** A brief's tickets go only with mode gsd-epic, and a gsd-epic brief lists at least one. */
function briefFields(fields: InboxEntryFields): KindFields {
  const { mode, tickets } = fields
  if (tickets !== undefined && mode !== 'gsd-epic') return fieldsError(PROMPTS.inboxTicketsNotEpic)
  if (mode === 'gsd-epic' && (tickets === undefined || tickets.length === 0)) {
    return fieldsError(PROMPTS.inboxEpicNeedsTickets)
  }

  return { kind: 'ok', fields }
}

/** The kind fields of a send: none of another kind, every one the kind needs, each valid, and a brief consistent. */
function sendFields(kind: MessageKind, fields: Readonly<Record<string, unknown>>): KindFields {
  const takes = KIND_FIELDS[kind]
  const foreign = INBOX_ENTRY_FIELDS.find(field => fields[field] !== undefined && !takes.includes(field))
  if (foreign !== undefined) return fieldsError(fill(PROMPTS.inboxFieldNotForKind, { field: foreign, kind }))
  const missing = REQUIRED_FIELDS[kind].filter(field => fields[field] === undefined)
  if (missing.length > 0) return fieldsError(fill(PROMPTS.inboxFieldMissing, { kind, fields: missing.join(', ') }))
  const read = kindFieldsOf(kind, fields)
  if (read.kind === 'error' || kind !== 'note') return read

  return briefFields(read.fields)
}

/**
 * The inbox_send input as a message to stamp, checked in the order to, kind (ticket and epic-end only from the PM
 * stand-in), subject, body, the fields of the kind, replyTo. The subject is cut to its cap; a body over its cap is
 * refused, never cut.
 */
export function parseSendInput(event: unknown, ctx: RoleContext, team: TeamView): SendInput {
  const fields: Readonly<Record<string, unknown>> = isObject(event) ? event : {}
  const { to, kind, replyTo } = fields
  if (to === undefined) return sendError(PROMPTS.inboxToMissing)
  if (typeof to !== 'string') return sendError(PROMPTS.inboxToNotText)
  if (!team.ids.includes(to)) return sendError(fill(PROMPTS.inboxToNotTeam, { ids: reportText(team.ids.join(', ')) }))
  if (to === ctx.id) return sendError(PROMPTS.inboxToSelf)
  const kindName = MESSAGE_KINDS.find(known => known === kind)
  if (kindName === undefined) return sendError(fill(PROMPTS.inboxKindUnknown, { kinds: MESSAGE_KINDS.join(', ') }))
  const { pm } = team
  if (PM_KINDS.includes(kindName) && pm === null) return sendError(fill(PROMPTS.inboxKindNoPm, { kind: kindName }))
  if (PM_KINDS.includes(kindName) && pm !== null && pm !== ctx.id) {
    return sendError(fill(PROMPTS.inboxKindPmOnly, { kind: kindName, pm }))
  }
  const subject = subjectText(fields.subject)
  if (subject === '') return sendError(PROMPTS.inboxSubjectEmpty)
  const body = bodyText(fields.body)
  if (body.trim() === '') return sendError(PROMPTS.inboxBodyEmpty)
  if (Array.from(body).length > BODY_MAX_CHARS) {
    return sendError(fill(PROMPTS.inboxBodyTooLong, { max: BODY_MAX_CHARS }))
  }
  const read = sendFields(kindName, fields)
  if (read.kind === 'error') return read
  if (replyTo === undefined) return { kind: 'ok', to, kindName, subject, body, replyTo: null, fields: read.fields }
  if (typeof replyTo !== 'string' || !ENTRY_ID_PATTERN.test(replyTo)) return sendError(PROMPTS.inboxReplyToBad)

  return { kind: 'ok', to, kindName, subject, body, replyTo, fields: read.fields }
}

/** A mark the model asked for, checked, or why it is refused. */
export type MarkInput =
  | {
      readonly kind: 'ok'
      readonly id: string
      readonly state: Exclude<InboxState, 'unread'>
      readonly note: string | null
      readonly waitsFor: string | null
    }
  | { readonly kind: 'error'; readonly message: string }

/** The state a mark may set: any state but unread; null for anything else. */
export function markStateOf(value: unknown): Exclude<InboxState, 'unread'> | null {
  for (const state of INBOX_STATES) {
    if (state !== 'unread' && state === value) return state
  }

  return null
}

function markError(message: string): MarkInput {
  return { kind: 'error', message }
}

/**
 * The inbox_mark input: an id, a state other than unread, a note on one line (required for blocked, rejected and
 * done, refused over its cap) and, for awaiting, the id of the entry it waits for. Read takes neither.
 */
export function parseMarkInput(event: unknown): MarkInput {
  const fields: Readonly<Record<string, unknown>> = isObject(event) ? event : {}
  const { id, waitsFor } = fields
  if (typeof id !== 'string') return markError(PROMPTS.inboxMarkUnknownId)
  const state = markStateOf(fields.state)
  const states = INBOX_STATES.filter(known => known !== 'unread').join(', ')
  if (state === null) return markError(fill(PROMPTS.inboxMarkState, { states }))
  if (state === 'read') return { kind: 'ok', id, state, note: null, waitsFor: null }
  const note = lineOf(fields.note)
  if (Array.from(note).length > NOTE_MAX_CHARS) {
    return markError(fill(PROMPTS.inboxMarkNoteTooLong, { max: NOTE_MAX_CHARS }))
  }
  if (state !== 'awaiting' && note === '') return markError(fill(PROMPTS.inboxMarkNoteNeeded, { state }))
  if (state !== 'awaiting') return { kind: 'ok', id, state, note, waitsFor: null }
  if (typeof waitsFor !== 'string' || !ENTRY_ID_PATTERN.test(waitsFor)) return markError(PROMPTS.inboxMarkWaitsFor)

  return { kind: 'ok', id, state, note: note === '' ? null : note, waitsFor }
}
