/**
 * The inbox_send input check, a layer 7 module: the message kinds and states, the caps of an inbox line, and the
 * parse of the model's tool input into a message cadre can stamp. Only the keys it names are read, so a sender or any
 * other key the model adds is never used.
 */
import type { InboxState, MessageKind, RoleContext, TeamView } from '../../types'
import { isObject } from '../core/json'
import { clean, reportText } from '../core/text'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'

export const MESSAGE_KINDS: readonly MessageKind[] = Object.freeze([
  'ticket',
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

export const NOTE_MAX_CHARS = 300

/** An inbox entry id: the sender, the time in epoch ms and the first 8 hex of the content's SHA-256. */
export const ENTRY_ID_PATTERN = /^[a-z0-9-]{1,64}-\d{1,16}-[0-9a-f]{8}$/

/** A send the model asked for, checked, or why it is refused. */
export type SendInput =
  | {
      readonly kind: 'ok'
      readonly to: string
      readonly kindName: MessageKind
      readonly subject: string
      readonly body: string
      readonly replyTo: string | null
    }
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

/** A body with LF line breaks, its tabs kept and every other control or invisible character removed; never cut. */
function bodyText(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').replace(BODY_DROPPED, '') : ''
}

/**
 * The inbox_send input as a message to stamp, checked in the order to, kind, subject, body, replyTo. The subject is
 * cut to its cap; a body over its cap is refused, never cut.
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
  const subject = subjectText(fields.subject)
  if (subject === '') return sendError(PROMPTS.inboxSubjectEmpty)
  const body = bodyText(fields.body)
  if (body.trim() === '') return sendError(PROMPTS.inboxBodyEmpty)
  if (Array.from(body).length > BODY_MAX_CHARS) {
    return sendError(fill(PROMPTS.inboxBodyTooLong, { max: BODY_MAX_CHARS }))
  }
  if (replyTo === undefined) return { kind: 'ok', to, kindName, subject, body, replyTo: null }
  if (typeof replyTo !== 'string' || !ENTRY_ID_PATTERN.test(replyTo)) return sendError(PROMPTS.inboxReplyToBad)

  return { kind: 'ok', to, kindName, subject, body, replyTo }
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

export function parseMarkInput(_event: unknown): MarkInput {
  return { kind: 'error', message: '' }
}
