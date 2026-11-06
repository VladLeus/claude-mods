/**
 * The inbox_send input check, a layer 7 module: the message kinds and states, the caps of an inbox line, and the
 * parse of the model's tool input into a message cadre can stamp. Only the keys it names are read, so a sender or any
 * other key the model adds is never used.
 */
import type { InboxState, MessageKind, RoleContext, TeamView } from '../../types'
import { isObject } from '../core/json'
import { reportText } from '../core/text'
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

function sendError(message: string): SendInput {
  return { kind: 'error', message }
}

/** The inbox_send input as a message to stamp: a team role to send to, a known kind, a subject and a body. */
export function parseSendInput(event: unknown, ctx: RoleContext, team: TeamView): SendInput {
  const fields: Readonly<Record<string, unknown>> = isObject(event) ? event : {}
  const { to, kind, subject, body, replyTo } = fields
  if (typeof to !== 'string' || !team.ids.includes(to)) {
    return sendError(fill(PROMPTS.inboxToNotTeam, { ids: reportText(team.ids.join(', ')) }))
  }
  const kindName = MESSAGE_KINDS.find(known => known === kind)
  if (kindName === undefined) return sendError(fill(PROMPTS.inboxKindUnknown, { kinds: MESSAGE_KINDS.join(', ') }))
  if (typeof subject !== 'string' || subject === '') return sendError(PROMPTS.inboxSubjectEmpty)
  if (typeof body !== 'string' || body === '') return sendError(PROMPTS.inboxBodyEmpty)

  return { kind: 'ok', to, kindName, subject, body, replyTo: typeof replyTo === 'string' ? replyTo : null }
}
