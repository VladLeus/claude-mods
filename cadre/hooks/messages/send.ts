/**
 * The inbox_send input check, a layer 7 module: the message kinds and states, the caps of an inbox line, and the
 * parse of the model's tool input into a message cadre can stamp. Only the keys it names are read, so a sender or any
 * other key the model adds is never used.
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
import { isFrameworkId } from '../core/framework-id'
import { isObject } from '../core/json'
import { clean, reportText } from '../core/text'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { isSafeRelativePath } from '../paths'
import { GSD_PATHS, parseVector } from './sizing'

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

function fieldsError(message: string): KindFields {
  return { kind: 'error', message }
}

function fieldMissing(kind: MessageKind, field: string): KindFields {
  return fieldsError(fill(PROMPTS.inboxFieldMissing, { kind, field }))
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

/** The fields of a task: its ticket key, the full vector and what to run it on are needed, a spec path may follow. */
function taskFields(fields: Readonly<Record<string, unknown>>): KindFields {
  const { ticketKey, specPath } = fields
  if (ticketKey === undefined) return fieldMissing('task', 'ticketKey')
  if (!isTicketKey(ticketKey)) return fieldsError(fill(PROMPTS.inboxTicketKeyBad, { max: TICKET_KEY_MAX_CHARS }))
  if (fields.vector === undefined) return fieldMissing('task', 'vector')
  const vector = parseVector(fields.vector)
  if (vector === null) return fieldsError(PROMPTS.inboxVectorBad)
  if (fields.use === undefined) return fieldMissing('task', 'use')
  const use = parseUse(fields.use)
  if (use === null) return fieldsError(PROMPTS.inboxUseBad)
  if (specPath === undefined) return { kind: 'ok', fields: { ticketKey, vector, use } }
  if (typeof specPath !== 'string' || !isSafeRelativePath(specPath)) return fieldsError(PROMPTS.inboxSpecPathBad)

  return { kind: 'ok', fields: { ticketKey, vector, use, specPath } }
}

/** The fields the kind takes, read from the model's input or a stored line; a kind with no fields has none. */
export function parseKindFields(kind: MessageKind, fields: Readonly<Record<string, unknown>>): KindFields {
  if (kind === 'task') return taskFields(fields)

  return { kind: 'ok', fields: {} }
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
  const read = parseKindFields(kindName, fields)
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
  const note = typeof fields.note === 'string' ? clean(fields.note.replace(LINE_BREAK, ' '), Infinity).trim() : ''
  if (Array.from(note).length > NOTE_MAX_CHARS) {
    return markError(fill(PROMPTS.inboxMarkNoteTooLong, { max: NOTE_MAX_CHARS }))
  }
  if (state !== 'awaiting' && note === '') return markError(fill(PROMPTS.inboxMarkNoteNeeded, { state }))
  if (state !== 'awaiting') return { kind: 'ok', id, state, note, waitsFor: null }
  if (typeof waitsFor !== 'string' || !ENTRY_ID_PATTERN.test(waitsFor)) return markError(PROMPTS.inboxMarkWaitsFor)

  return { kind: 'ok', id, state, note: note === '' ? null : note, waitsFor }
}
