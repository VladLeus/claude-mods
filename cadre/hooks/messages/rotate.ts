/**
 * The rotation of a large inbox, a layer 7 module: whether /cadre start moves an inbox aside, where it moves it, and
 * the fresh entry from cadre appended in its place, which lists the open entries of the archive.
 */
import type { InboxEntry, InboxRotation, PortStat } from '../../types'
import { CONTRACTS } from '../locales/contracts'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { inboxArchiveFile, runtimeFileOf } from '../paths'
import { CLOSED_STATES, entryIdOf, foldInbox, parseInbox, recordLine } from './record'
import { INBOX_ROTATE_BYTES } from './send'

/** The most open ids the fresh entry lists; it counts the rest. */
const ROTATED_IDS_SHOWN = 40

/** Whether an inbox stat is a regular file, not a link, over INBOX_ROTATE_BYTES. */
export function isInboxOverRotation(stat: PortStat | null): boolean {
  return stat !== null && stat.kind === 'file' && !stat.isLink && stat.size > INBOX_ROTATE_BYTES
}

/** The ids of the entries of an inbox text that are not marked done or rejected, in file order. */
function openIdsOf(text: string): string[] {
  return foldInbox(parseInbox(text))
    .filter(item => !CLOSED_STATES.includes(item.state))
    .map(item => item.entry.id)
}

/** The open ids as the fresh entry lists them: none, or the first ROTATED_IDS_SHOWN and a count of the rest. */
function openIdsText(ids: readonly string[]): string {
  if (ids.length === 0) return PROMPTS.inboxRotatedNone
  const shown = ids.slice(0, ROTATED_IDS_SHOWN).join(', ')
  if (ids.length <= ROTATED_IDS_SHOWN) return shown

  return fill(PROMPTS.inboxRotatedMore, { ids: shown, count: ids.length - ROTATED_IDS_SHOWN })
}

/**
 * Where the inbox of role `id` moves when /cadre start rotates it at `at`, and the record line of the fresh entry from
 * cadre appended in its place. The entry lists the open entries of `text`, the inbox as read; with `text` null it says
 * they could not be listed.
 */
export async function inboxRotationOf(
  root: string,
  id: string,
  text: string | null,
  at: number,
): Promise<InboxRotation> {
  const archive = inboxArchiveFile(at)
  const max = INBOX_ROTATE_BYTES / 1024
  const body =
    text === null
      ? fill(PROMPTS.inboxRotatedUnlisted, { max, archive })
      : fill(PROMPTS.inboxRotatedBody, { max, archive, ids: openIdsText(openIdsOf(text)) })
  const subject = PROMPTS.inboxRotatedSubject
  const entry: InboxEntry = {
    v: 1,
    type: CONTRACTS.inboxEntryType,
    id: await entryIdOf(CONTRACTS.cadreSender, at, [id, 'note', subject, body].join('\n')),
    at,
    from: CONTRACTS.cadreSender,
    to: id,
    kind: 'note',
    subject,
    body,
  }

  return { archive: runtimeFileOf(root, id, archive), text: recordLine(entry) }
}
