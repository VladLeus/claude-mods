/**
 * The inbox flows of a role session, a layer 7 module: the role context read from the runtime env, the session id a
 * role publishes, inbox_send and inbox_read, all through the InitIo and HostIo ports. An inbox is only ever appended,
 * and the durable entry is always written before the live wake.
 */
import type {
  HostIo,
  InboxEntry,
  InitIo,
  PortStat,
  RoleContext,
  SessionLink,
  TeamView,
  ToolOutcome,
} from '../../types'
import { isRoleId } from '../core/role-id'
import { utf8Bytes } from '../core/text'
import { CONTRACTS } from '../locales/contracts'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { isDirInsideRoot, isFileInsideRoot, parentOf, resolveSegments, roleJsonPath } from '../paths'
import {
  entryIdOf,
  foldInbox,
  inboxLogPath,
  inboxReadText,
  parseInbox,
  parseReadInput,
  parseSessionRecord,
  recordLine,
  sessionFilePath,
  sessionRecordText,
} from './record'
import { INBOX_APPEND_TIMEOUT_MS, INBOX_LINE_MAX_BYTES, INBOX_READ_MAX_BYTES, parseSendInput } from './send'
import { wakeText } from './wake'

/** The most bytes of a session.json that are read. */
const SESSION_READ_MAX_BYTES = 4096

function deny(text: string): ToolOutcome {
  return { kind: 'deny', text }
}

/** The role and the root a session runs as: a role id and an absolute, normalised root; null for anything else. */
export function roleContextOf(role: unknown, root: unknown): RoleContext | null {
  if (typeof role !== 'string' || !isRoleId(role)) return null
  if (typeof root !== 'string' || root === '/' || !root.startsWith('/')) return null
  if (resolveSegments(root) !== root) return null

  return { id: role, root }
}

/** Whether the context names a role of the repo: its role.json is a regular file inside the root. */
export async function isRoleSession(io: InitIo, ctx: RoleContext): Promise<boolean> {
  return isFileInsideRoot(await io.stat(`${ctx.root}/${roleJsonPath(ctx.id)}`), ctx.root)
}

async function publishedId(io: InitIo, path: string): Promise<string | null> {
  const read = await io.read(path, SESSION_READ_MAX_BYTES)

  return read.state === 'text' ? parseSessionRecord(read.text) : null
}

/** Whether a stat shows a file or folder inside the root that is no link and lands on its own path. */
function isInPlace(stat: PortStat | null, path: string, root: string, kind: 'file' | 'dir'): boolean {
  if (stat === null || stat.isLink || stat.realPath !== path) return false

  return kind === 'dir' ? isDirInsideRoot(stat, root) : isFileInsideRoot(stat, root)
}

/** Whether a runtime file and its folder are each absent or in place, so a write to the file stays where it is. */
async function isRuntimeFileSafe(io: InitIo, root: string, path: string): Promise<boolean> {
  const folder = parentOf(path)
  const folderStat = await io.stat(folder)
  if (folderStat !== null && !isInPlace(folderStat, folder, root, 'dir')) return false
  const fileStat = await io.stat(path)

  return fileStat === null || isInPlace(fileStat, path, root, 'file')
}

/** Writes the role's session.json with this session id, unless it already holds it or is not in place. */
export async function publishSession(
  io: InitIo,
  host: HostIo,
  ctx: RoleContext,
  sessionId: string,
): Promise<'written' | 'kept' | 'refused'> {
  const path = sessionFilePath(ctx.root, ctx.id)
  if (!(await isRuntimeFileSafe(io, ctx.root, path))) return 'refused'
  if ((await publishedId(io, path)) === sessionId) return 'kept'

  return (await host.write(path, sessionRecordText(sessionId))) ? 'written' : 'refused'
}

/**
 * Why the receiver's inbox may not be appended to, or null: its runtime folder must be there, as a folder in place,
 * which /cadre start renders, and the inbox in it absent or a file in place.
 */
async function receiverRefusal(io: InitIo, root: string, to: string): Promise<string | null> {
  const inbox = inboxLogPath(root, to)
  const folder = parentOf(inbox)
  const folderStat = await io.stat(folder)
  if (folderStat === null) return fill(PROMPTS.inboxNotStarted, { to })
  if (!isInPlace(folderStat, folder, root, 'dir')) return fill(PROMPTS.inboxUnsafe, { to })
  const inboxStat = await io.stat(inbox)
  if (inboxStat !== null && !isInPlace(inboxStat, inbox, root, 'file')) return fill(PROMPTS.inboxUnsafe, { to })

  return null
}

async function appendLine(host: HostIo, path: string, line: string): Promise<boolean> {
  const run = await host.run(['/usr/bin/tee', '-a', path], { stdin: line, timeoutMs: INBOX_APPEND_TIMEOUT_MS })

  return run !== null && run.exitCode === 0
}

/**
 * Appends the entry to its receiver's inbox, then wakes the receiver by the session id it published. A line over its
 * cap or an inbox out of place is refused before anything runs.
 */
async function deliver(
  io: InitIo,
  host: HostIo,
  link: SessionLink,
  root: string,
  entry: InboxEntry,
): Promise<ToolOutcome> {
  const { id, to } = entry
  const line = recordLine(entry)
  if (utf8Bytes(line) > INBOX_LINE_MAX_BYTES) {
    return deny(fill(PROMPTS.inboxLineTooLarge, { max: INBOX_LINE_MAX_BYTES }))
  }
  const refusal = await receiverRefusal(io, root, to)
  if (refusal !== null) return deny(refusal)
  if (!(await appendLine(host, inboxLogPath(root, to), line))) return deny(fill(PROMPTS.inboxAppendFailed, { to }))
  const sessionId = await publishedId(io, sessionFilePath(root, to))
  const isDelivered = sessionId !== null && (await link.send(sessionId, wakeText(entry)))

  return { kind: 'result', text: fill(isDelivered ? PROMPTS.inboxSent : PROMPTS.inboxSentUndelivered, { id, to }) }
}

/** inbox_send: one entry from the session's own role, stamped with the clock, appended and then announced live. */
export async function runInboxSend(
  io: InitIo,
  host: HostIo,
  link: SessionLink,
  ctx: RoleContext,
  team: TeamView | null,
  event: unknown,
): Promise<ToolOutcome> {
  if (team === null) return deny(PROMPTS.inboxNoTeam)
  const input = parseSendInput(event, ctx, team)
  if (input.kind === 'error') return deny(input.message)
  const at = await io.now()
  if (at === null) return deny(PROMPTS.inboxNoClock)
  const { to, kindName, subject, body, replyTo } = input
  const id = await entryIdOf(ctx.id, at, [to, kindName, subject, body].join('\n'))
  const entry: InboxEntry = {
    v: 1,
    type: CONTRACTS.inboxEntryType,
    id,
    at,
    from: ctx.id,
    to,
    kind: kindName,
    subject,
    body,
    ...(replyTo === null ? {} : { replyTo }),
  }

  return deliver(io, host, link, ctx.root, entry)
}

/** inbox_read: the session's own inbox, folded; an absent inbox reads as empty. */
export async function runInboxRead(io: InitIo, ctx: RoleContext, event: unknown): Promise<ToolOutcome> {
  const input = parseReadInput(event)
  if (input.kind === 'error') return deny(input.message)
  const read = await io.read(inboxLogPath(ctx.root, ctx.id), INBOX_READ_MAX_BYTES)
  if (read.state !== 'text' && read.state !== 'absent') return deny(fill(PROMPTS.inboxUnreadable, { id: ctx.id }))
  const events = read.state === 'text' ? parseInbox(read.text) : []

  return { kind: 'result', text: inboxReadText(foldInbox(events), input.all) }
}

export async function runInboxMark(
  _io: InitIo,
  _host: HostIo,
  _link: SessionLink,
  _ctx: RoleContext,
  _team: TeamView | null,
  _event: unknown,
): Promise<ToolOutcome> {
  return { kind: 'deny', text: '' }
}
