/** The live wake line of an inbox entry, a layer 7 module. */
import type { InboxEntry } from '../../types'
import { asciiLine, ROLE_LINE_MAX } from '../generate/kickoff'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'

/**
 * One line of printable ASCII that names the new entry and ends telling the role to read it with inbox_read. The
 * subject is cut first, so the end of the line is never cut off.
 */
export function wakeText(entry: InboxEntry): string {
  const sentence = (subject: string): string =>
    fill(PROMPTS.inboxWake, { kind: entry.kind, id: entry.id, from: entry.from, subject })
  const room = ROLE_LINE_MAX - sentence('').length

  return asciiLine(sentence(asciiLine(entry.subject, room)), ROLE_LINE_MAX)
}
