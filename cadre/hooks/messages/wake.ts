/** The live wake line of an inbox entry, a layer 7 module. */
import type { InboxEntry } from '../../types'
import { asSentence } from '../core/text'
import { ROLE_LINE_MAX } from '../generate/kickoff'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'

/** The ASCII a wake line writes for common punctuation outside ASCII. */
const ASCII_OF: Readonly<Record<string, string>> = {
  '–': '-',
  '—': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
}

/**
 * Text as one line of printable ASCII: whitespace runs become one space, the punctuation of ASCII_OF its ASCII form,
 * and any other character outside printable ASCII is dropped. Quotes stay, since the wake is a plain session message.
 * The line is cut to maxChars characters without a trailing space.
 */
function wakeLine(text: string, maxChars: number): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7e]/g, char => ASCII_OF[char] ?? '')
    .replace(/ +/g, ' ')
    .trim()
    .slice(0, Math.max(0, maxChars))
    .trimEnd()
}

/**
 * One line that names the new entry and ends telling the role to read it with inbox_read, and to execute it with its
 * method when the entry names one. The subject is cut first, with room for the period it may get, so the end of the
 * line is never cut.
 */
export function wakeText(entry: InboxEntry): string {
  const { kind, id, from, method } = entry
  const sentence = (subject: string): string =>
    method === undefined
      ? fill(PROMPTS.inboxWake, { kind, id, from, subject })
      : fill(PROMPTS.inboxWakeMethod, { kind, id, from, subject, method })
  const room = ROLE_LINE_MAX - sentence('').length - 1

  return wakeLine(sentence(asSentence(wakeLine(entry.subject, room))), ROLE_LINE_MAX)
}
