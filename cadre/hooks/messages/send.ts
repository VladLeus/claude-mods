/**
 * The inbox_send input check, a layer 7 module: the message kinds and states, the caps of an inbox line and of the
 * kind fields, the inbox_send schema and description built from them, and the parse of the model's tool input into a
 * message cadre can stamp. Only the keys it names are read, so a sender, a stamp or any other key the model adds is
 * never used.
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
import { GSD_PATHS, modesOffered, parseProductScores, parseVector, PLANNING_MODES } from './sizing'

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

/** The largest entry the field caps allow fits this line cap, which a spec pins. */
export const INBOX_LINE_MAX_BYTES = 32 * 1024

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
export const SPEC_PATH_MAX_CHARS = 200
export const LIST_MAX_ITEMS = 10
export const LIST_ITEM_MAX_CHARS = 200

/** The most ticket keys a brief lists. */
export const TICKETS_MAX_ITEMS = 100

/** The cap in characters of each text field, as the check holds it and the schema and the description state it. */
const TEXT_CAPS = Object.freeze({
  subject: SUBJECT_MAX_CHARS,
  body: BODY_MAX_CHARS,
  ticketKey: TICKET_KEY_MAX_CHARS,
  reportForm: REPORT_FORM_MAX_CHARS,
  specPath: SPEC_PATH_MAX_CHARS,
  changes: CHANGES_MAX_CHARS,
  verification: VERIFICATION_MAX_CHARS,
  reason: REASON_MAX_CHARS,
})

type ListField = 'docPaths' | 'openQuestions' | 'tickets'

/** The caps of one list: its most items and the most characters of each item. */
type ListCap = { readonly items: number; readonly chars: number }

const LIST_CAPS: Readonly<Record<ListField, ListCap>> = Object.freeze({
  docPaths: { items: LIST_MAX_ITEMS, chars: LIST_ITEM_MAX_CHARS },
  openQuestions: { items: LIST_MAX_ITEMS, chars: LIST_ITEM_MAX_CHARS },
  tickets: { items: TICKETS_MAX_ITEMS, chars: TICKET_KEY_MAX_CHARS },
})

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

/** The fields of a kind as the model gave them, checked, or every reason they are refused. */
export type KindFields =
  | { readonly kind: 'ok'; readonly fields: InboxEntryFields }
  | { readonly kind: 'error'; readonly messages: readonly string[] }

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

/** A list item as the send keeps it: the item when it is text, '' for anything else. */
function itemText(item: unknown): string {
  return typeof item === 'string' ? item : ''
}

function isDocPath(text: string): boolean {
  return isSafeRelativePath(text) || WORKSTREAM_NAME.test(text)
}

/** One kind field as part of an entry: {} when it is absent, the field when it is valid, else its refusals. */
type FieldPart = InboxEntryFields | readonly string[]

function isRefused(part: FieldPart): part is readonly string[] {
  return Array.isArray(part)
}

/** A text field kept whole on one line: refused when empty or over its cap, with its size, never cut. */
function textPart(raw: unknown, field: string, max: number, part: (text: string) => InboxEntryFields): FieldPart {
  if (raw === undefined) return {}
  const text = lineOf(raw)
  if (text === '') return [fill(PROMPTS.inboxFieldEmpty, { field })]
  const size = Array.from(text).length
  if (size > max) return [fill(PROMPTS.inboxFieldTooLong, { field, size, max })]

  return part(text)
}

function ticketKeyPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}

  return isTicketKey(raw) ? { ticketKey: raw } : [fill(PROMPTS.inboxTicketKeyBad, { max: TICKET_KEY_MAX_CHARS })]
}

function scoresPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const scores = parseProductScores(raw)

  return scores === null ? [PROMPTS.inboxScoresBad] : { scores }
}

function pinPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const pin = SIZE_PINS.find(known => known === raw)

  return pin === undefined ? [fill(PROMPTS.inboxPinBad, { pins: SIZE_PINS.join(', ') })] : { pin }
}

function vectorPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const vector = parseVector(raw)

  return vector === null ? [PROMPTS.inboxVectorBad] : { vector }
}

function usePart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const use = parseUse(raw)

  return use === null ? [PROMPTS.inboxUseBad] : { use }
}

function specPathPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const size = typeof raw === 'string' ? Array.from(raw).length : 0
  if (size > SPEC_PATH_MAX_CHARS) {
    return [fill(PROMPTS.inboxFieldTooLong, { field: 'specPath', size, max: SPEC_PATH_MAX_CHARS })]
  }

  return typeof raw === 'string' && isSafeRelativePath(raw) ? { specPath: raw } : [PROMPTS.inboxSpecPathBad]
}

function outcomePart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const outcome = REPORT_OUTCOMES.find(known => known === raw)
  if (outcome === undefined) return [fill(PROMPTS.inboxOutcomeBad, { outcomes: REPORT_OUTCOMES.join(', ') })]

  return { outcome }
}

function frameworkUsedPart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  if (!isFrameworkId(raw)) return [fill(PROMPTS.inboxFrameworkUsedBad, { frameworks: FRAMEWORK_IDS.join(', ') })]

  return { frameworkUsed: raw }
}

/** How a list reads: the text the send keeps of an item, whether a kept text is an item, and the list's fault text. */
type ListRule = {
  readonly textOf: (item: unknown) => string
  readonly isItem: (text: string) => boolean
  readonly bad: string
}

/**
 * A list kept item by item, or its problems in this order: more items than its cap, the items over its length cap by
 * position and size, and the fault text once for any other bad item of a valid length; a value that is no list gives
 * only the fault text.
 */
function listPart(
  raw: unknown,
  field: ListField,
  rule: ListRule,
  part: (items: string[]) => InboxEntryFields,
): FieldPart {
  if (raw === undefined) return {}
  if (!Array.isArray(raw)) return [rule.bad]
  const { items: max, chars } = LIST_CAPS[field]
  const items = raw.map(item => {
    const text = rule.textOf(item)

    return { text, size: Array.from(text).length }
  })
  const long = items.flatMap((item, index) => (item.size > chars ? [{ position: index + 1, size: item.size }] : []))
  const positions = long.map(over => over.position).join(', ')
  const sizes = long.map(over => over.size).join(', ')
  const problems = [
    raw.length > max ? fill(PROMPTS.inboxListTooMany, { field, count: raw.length, max }) : null,
    long.length === 0 ? null : fill(PROMPTS.inboxListItemsTooLong, { field, items: positions, sizes, chars }),
    items.some(item => item.size <= chars && !rule.isItem(item.text)) ? rule.bad : null,
  ].flatMap(problem => (problem === null ? [] : [problem]))

  return problems.length === 0 ? part(items.map(item => item.text)) : problems
}

function docPathsPart(raw: unknown): FieldPart {
  const { items, chars } = LIST_CAPS.docPaths
  const bad = fill(PROMPTS.inboxDocPathsBad, { max: items, chars })
  const rule: ListRule = { textOf: itemText, isItem: isDocPath, bad }

  return listPart(raw, 'docPaths', rule, docPaths => ({ docPaths }))
}

function openQuestionsPart(raw: unknown): FieldPart {
  const { items, chars } = LIST_CAPS.openQuestions
  const bad = fill(PROMPTS.inboxOpenQuestionsBad, { max: items, chars })
  const rule: ListRule = { textOf: lineOf, isItem: text => text !== '', bad }

  return listPart(raw, 'openQuestions', rule, openQuestions => ({ openQuestions }))
}

function modePart(raw: unknown): FieldPart {
  if (raw === undefined) return {}
  const mode = PLANNING_MODES.find(known => known === raw)

  return mode === undefined ? [fill(PROMPTS.inboxModeBad, { modes: PLANNING_MODES.join(', ') })] : { mode }
}

function ticketsPart(raw: unknown): FieldPart {
  const bad = fill(PROMPTS.inboxTicketsBad, { max: LIST_CAPS.tickets.items })
  const rule: ListRule = { textOf: itemText, isItem: isTicketKey, bad }

  return listPart(raw, 'tickets', rule, tickets => ({ tickets }))
}

/** The reader of each kind field by its record name. */
const FIELD_PARTS: Readonly<Record<string, (raw: unknown) => FieldPart>> = Object.freeze({
  ticketKey: ticketKeyPart,
  scores: scoresPart,
  pin: pinPart,
  reportForm: (raw: unknown) => textPart(raw, 'reportForm', TEXT_CAPS.reportForm, reportForm => ({ reportForm })),
  vector: vectorPart,
  use: usePart,
  specPath: specPathPart,
  outcome: outcomePart,
  changes: (raw: unknown) => textPart(raw, 'changes', TEXT_CAPS.changes, changes => ({ changes })),
  verification: (raw: unknown) =>
    textPart(raw, 'verification', TEXT_CAPS.verification, verification => ({ verification })),
  reason: (raw: unknown) => textPart(raw, 'reason', TEXT_CAPS.reason, reason => ({ reason })),
  frameworkUsed: frameworkUsedPart,
  docPaths: docPathsPart,
  openQuestions: openQuestionsPart,
  mode: modePart,
  tickets: ticketsPart,
})

/** The fields of a kind as checked: the valid ones and the refusals of the rest. */
type FieldsRead = { readonly fields: InboxEntryFields; readonly messages: readonly string[] }

function readKindFields(kind: MessageKind, fields: Readonly<Record<string, unknown>>): FieldsRead {
  let merged: InboxEntryFields = {}
  const messages: string[] = []
  for (const field of KIND_FIELDS[kind]) {
    const part = FIELD_PARTS[field]?.(fields[field]) ?? {}
    if (isRefused(part)) {
      messages.push(...part)
      continue
    }
    merged = { ...merged, ...part }
  }

  return { fields: merged, messages }
}

/**
 * The fields the kind takes, from a stored line or the model's input: each one present is checked, an absent one
 * stays absent and a field of another kind is not read; every bad field gives its refusals.
 */
export function kindFieldsOf(kind: MessageKind, fields: Readonly<Record<string, unknown>>): KindFields {
  const read = readKindFields(kind, fields)

  return read.messages.length === 0 ? { kind: 'ok', fields: read.fields } : { kind: 'error', messages: read.messages }
}

/** Why a brief is refused: its tickets go only with mode gsd-epic, and a gsd-epic brief lists at least one. */
function briefRefusal(fields: InboxEntryFields): string | null {
  const { mode, tickets } = fields
  if (tickets !== undefined && mode !== 'gsd-epic') return PROMPTS.inboxTicketsNotEpic
  if (mode === 'gsd-epic' && (tickets === undefined || tickets.length === 0)) return PROMPTS.inboxEpicNeedsTickets

  return null
}

/** Why a brief's mode is refused: the repo's frameworks do not offer it; null with no mode or an offered one. */
function modeRefusal(fields: InboxEntryFields, team: TeamView): string | null {
  const { mode } = fields
  if (mode === undefined) return null
  const offered = modesOffered(team.frameworks)
  if (offered.includes(mode)) return null

  return fill(PROMPTS.inboxModeNotOffered, {
    mode,
    modes: offered.length === 0 ? PROMPTS.inboxItemNone : offered.join(', '),
  })
}

/** Why a task's framework is refused: its receiver may not run it; null with no use or one the receiver may run. */
function useRefusal(fields: InboxEntryFields, to: string, team: TeamView): string | null {
  const { use } = fields
  if (use === undefined) return null
  const mayRun = team.mayRun[to] ?? []
  if (mayRun.includes(use.framework)) return null

  return fill(PROMPTS.inboxUseNotRun, {
    to,
    framework: use.framework,
    frameworks: mayRun.length === 0 ? PROMPTS.inboxItemNone : mayRun.join(', '),
  })
}

/**
 * The kind fields of a send with every refusal of them: each field of another kind, the missing ones, each bad one, a
 * brief that does not hold together, a mode the repo does not offer and a framework the receiver may not run.
 */
function sendFields(
  kind: MessageKind,
  fields: Readonly<Record<string, unknown>>,
  to: unknown,
  team: TeamView,
): FieldsRead {
  const takes = KIND_FIELDS[kind]
  const foreign = INBOX_ENTRY_FIELDS.filter(field => fields[field] !== undefined && !takes.includes(field))
  const missing = REQUIRED_FIELDS[kind].filter(field => fields[field] === undefined)
  const read = readKindFields(kind, fields)
  const messages = [
    ...foreign.map(field => fill(PROMPTS.inboxFieldNotForKind, { field, kind })),
    missing.length === 0 ? null : fill(PROMPTS.inboxFieldMissing, { kind, fields: missing.join(', ') }),
    ...read.messages,
    kind === 'note' && read.messages.length === 0 ? briefRefusal(read.fields) : null,
    modeRefusal(read.fields, team),
    typeof to === 'string' && team.ids.includes(to) ? useRefusal(read.fields, to, team) : null,
  ]

  return { fields: read.fields, messages: messages.flatMap(message => (message === null ? [] : [message])) }
}

/** Why `to` is refused: missing, not text, not a role of the team, or the sender's own role; null otherwise. */
function toRefusal(to: unknown, ctx: RoleContext, team: TeamView): string | null {
  if (to === undefined) return PROMPTS.inboxToMissing
  if (typeof to !== 'string') return PROMPTS.inboxToNotText
  if (!team.ids.includes(to)) return fill(PROMPTS.inboxToNotTeam, { ids: reportText(team.ids.join(', ')) })
  if (to === ctx.id) return PROMPTS.inboxToSelf

  return null
}

/** Why the kind is refused: unknown, or one only the PM stand-in sends, from another role; null otherwise. */
function kindRefusal(kind: MessageKind | undefined, ctx: RoleContext, team: TeamView): string | null {
  if (kind === undefined) return fill(PROMPTS.inboxKindUnknown, { kinds: MESSAGE_KINDS.join(', ') })
  if (!PM_KINDS.includes(kind)) return null
  const { pm } = team
  if (pm === null) return fill(PROMPTS.inboxKindNoPm, { kind })
  if (pm !== ctx.id) return fill(PROMPTS.inboxKindPmOnly, { kind, pm })

  return null
}

/** Why the body is refused: empty, or over its cap with its size, since a body is never cut; null otherwise. */
function bodyRefusal(body: string): string | null {
  if (body.trim() === '') return PROMPTS.inboxBodyEmpty
  const size = Array.from(body).length
  if (size > BODY_MAX_CHARS) return fill(PROMPTS.inboxBodyTooLong, { size, max: BODY_MAX_CHARS })

  return null
}

/** One problem as its own sentence; several as a counted head and one line each. */
function refusalText(problems: readonly string[]): string {
  const [only] = problems
  if (problems.length === 1 && only !== undefined) return only
  const lines = problems.map(problem => fill(PROMPTS.inboxProblemLine, { problem }))

  return [fill(PROMPTS.inboxProblemsHead, { count: problems.length }), ...lines].join('\n')
}

/**
 * The inbox_send input as a message to stamp, or one refusal that lists every problem of it: to, kind, subject, body,
 * the kind fields of a kind the role may send, then replyTo. The subject is cut to its cap.
 */
export function parseSendInput(event: unknown, ctx: RoleContext, team: TeamView): SendInput {
  const fields: Readonly<Record<string, unknown>> = isObject(event) ? event : {}
  const { to, kind, replyTo } = fields
  const kindName = MESSAGE_KINDS.find(known => known === kind)
  const kindProblem = kindRefusal(kindName, ctx, team)
  const subject = subjectText(fields.subject)
  const body = bodyText(fields.body)
  const read = kindName === undefined || kindProblem !== null ? null : sendFields(kindName, fields, to, team)
  const isReplyToBad = replyTo !== undefined && (typeof replyTo !== 'string' || !ENTRY_ID_PATTERN.test(replyTo))
  const problems = [
    toRefusal(to, ctx, team),
    kindProblem,
    subject === '' ? PROMPTS.inboxSubjectEmpty : null,
    bodyRefusal(body),
    ...(read?.messages ?? []),
    isReplyToBad ? PROMPTS.inboxReplyToBad : null,
  ].flatMap(problem => (problem === null ? [] : [problem]))
  // A bad to or kind is always among the problems; the checks after the count only narrow the types.
  if (problems.length > 0 || typeof to !== 'string' || kindName === undefined || read === null) {
    return sendError(refusalText(problems))
  }

  return {
    kind: 'ok',
    to,
    kindName,
    subject,
    body,
    replyTo: typeof replyTo === 'string' ? replyTo : null,
    fields: read.fields,
  }
}

const SCORE_SCHEMA = Object.freeze({ type: 'number' })

/** The inbox_send properties in their input order, before their caps and descriptions. */
const BASE_PROPERTIES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
  to: { type: 'string' },
  kind: { type: 'string', enum: [...MESSAGE_KINDS] },
  subject: { type: 'string' },
  body: { type: 'string' },
  replyTo: { type: 'string' },
  ticketKey: { type: 'string' },
  scores: { type: 'object', properties: { scope: SCORE_SCHEMA, risk: SCORE_SCHEMA } },
  pin: { type: 'string', enum: [...SIZE_PINS] },
  reportForm: { type: 'string' },
  vector: {
    type: 'object',
    properties: { scope: SCORE_SCHEMA, complexity: SCORE_SCHEMA, risk: SCORE_SCHEMA, effort: SCORE_SCHEMA },
  },
  use: {
    type: 'object',
    properties: {
      framework: { type: 'string', enum: [...FRAMEWORK_IDS] },
      gsdPath: { type: 'string', enum: [...GSD_PATHS] },
    },
  },
  specPath: { type: 'string' },
  outcome: { type: 'string', enum: [...REPORT_OUTCOMES] },
  changes: { type: 'string' },
  verification: { type: 'string' },
  reason: { type: 'string' },
  frameworkUsed: { type: 'string', enum: [...FRAMEWORK_IDS] },
  docPaths: { type: 'array' },
  openQuestions: { type: 'array' },
  mode: { type: 'string', enum: [...PLANNING_MODES] },
  tickets: { type: 'array' },
})

function textCapOf(field: string): number | undefined {
  return Object.entries(TEXT_CAPS).find(([name]) => name === field)?.[1]
}

function listCapOf(field: string): ListCap | undefined {
  return Object.entries(LIST_CAPS).find(([name]) => name === field)?.[1]
}

/**
 * The description of an inbox_send property: the kinds it goes on, the kinds that require it and its cap, as
 * KIND_FIELDS, REQUIRED_FIELDS and the caps say; '' when none applies.
 */
function propertyDescription(field: string): string {
  const takes = MESSAGE_KINDS.filter(kind => KIND_FIELDS[kind].includes(field))
  const needs = MESSAGE_KINDS.filter(kind => REQUIRED_FIELDS[kind].includes(field))
  const textCap = textCapOf(field)
  const listCap = listCapOf(field)

  return [
    ...(takes.length === 0 ? [] : [fill(PROMPTS.inboxPropertyKinds, { kinds: takes.join(', ') })]),
    ...(needs.length === 0 ? [] : [fill(PROMPTS.inboxPropertyRequired, { kinds: needs.join(', ') })]),
    ...(textCap === undefined ? [] : [fill(PROMPTS.inboxPropertyChars, { max: textCap })]),
    ...(listCap === undefined ? [] : [fill(PROMPTS.inboxPropertyList, { max: listCap.items, chars: listCap.chars })]),
  ].join(' ')
}

/** One inbox_send property with its cap and, when one applies, its description. */
function propertySchema(field: string, base: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const textCap = textCapOf(field)
  const listCap = listCapOf(field)
  const description = propertyDescription(field)

  return {
    ...base,
    ...(textCap === undefined ? {} : { maxLength: textCap }),
    ...(listCap === undefined ? {} : { maxItems: listCap.items, items: { type: 'string', maxLength: listCap.chars } }),
    ...(description === '' ? {} : { description }),
  }
}

/**
 * The inbox_send input schema: each property with its cap and the kinds it goes on, from the caps and the kind
 * tables. It stays one flat object, since the API refuses a schema that composes variants at its top level.
 */
export function inboxSendSchema(): Readonly<Record<string, unknown>> {
  const properties = Object.fromEntries(
    Object.entries(BASE_PROPERTIES).map(([field, base]) => [field, propertySchema(field, base)]),
  )

  return { type: 'object', properties, required: ['to', 'kind', 'subject', 'body'] }
}

/** The inbox_send description with every cap filled from its constant. */
export function inboxSendDescriptionText(): string {
  return fill(PROMPTS.inboxSendDescription, {
    subjectMax: SUBJECT_MAX_CHARS,
    bodyMax: BODY_MAX_CHARS,
    reportFormMax: REPORT_FORM_MAX_CHARS,
    changesMax: CHANGES_MAX_CHARS,
    verificationMax: VERIFICATION_MAX_CHARS,
    reasonMax: REASON_MAX_CHARS,
    specPathMax: SPEC_PATH_MAX_CHARS,
    ticketKeyMax: TICKET_KEY_MAX_CHARS,
    listMax: LIST_MAX_ITEMS,
    itemMax: LIST_ITEM_MAX_CHARS,
    ticketsMax: TICKETS_MAX_ITEMS,
  })
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
