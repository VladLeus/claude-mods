/**
 * The inbox_send input check, a layer 7 module: the message kinds and states, the caps of an inbox line, and the
 * parse of the model's tool input into a message cadre can stamp.
 */
import type { InboxState, MessageKind, RoleContext, TeamView } from '../../types'

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

export function parseSendInput(_event: unknown, _ctx: RoleContext, _team: TeamView): SendInput {
  return { kind: 'error', message: '' }
}
