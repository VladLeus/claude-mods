/**
 * The inbox record, a layer 7 module: where a role's inbox.jsonl and session.json lie, the one-line JSON of an
 * entry or a mark, its fail-closed parse, and the session record a role publishes.
 */
import type { InboxEvent } from '../../types'

export function inboxLogPath(_root: string, _id: string): string {
  return ''
}

export function sessionFilePath(_root: string, _id: string): string {
  return ''
}

export function sessionRecordText(_sessionId: string): string {
  return ''
}

export function parseSessionRecord(_text: string): string | null {
  return null
}

export async function entryIdOf(_from: string, _at: number, _content: string): Promise<string> {
  return ''
}

export function recordLine(_event: InboxEvent): string {
  return ''
}

export function parseInboxLine(_text: string): InboxEvent | null {
  return null
}
