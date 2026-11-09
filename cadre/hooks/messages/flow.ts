/**
 * The inbox flows of a role session, a layer 7 module: the role context read from the runtime env, the session id a
 * role publishes, inbox_send and inbox_read, all through the InitIo and HostIo ports. An inbox is only ever appended,
 * and the durable entry is always written before the live wake.
 */
import type {
  HostIo,
  InboxEntry,
  InboxEntryFields,
  InboxEvent,
  InboxMark,
  InitIo,
  MessageKind,
  PortStat,
  RoleContext,
  SessionLink,
  TeamView,
  ToolOutcome,
} from '../../types'
import { isRoleId } from '../core/role-id'
import { clean, utf8Bytes } from '../core/text'
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
import {
  INBOX_APPEND_TIMEOUT_MS,
  INBOX_LINE_MAX_BYTES,
  INBOX_READ_MAX_BYTES,
  parseMarkInput,
  parseSendInput,
  SUBJECT_MAX_CHARS,
} from './send'
import { isLarge, modesOffered, sizeOf, sizeText } from './sizing'
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

/**
 * Whether a write to a runtime file stays where it is: 'unsafe' when its folder or the file is there but out of place,
 * else 'no-folder' when the folder is absent, else 'ok'.
 */
async function runtimeFileCheck(io: InitIo, root: string, path: string): Promise<'ok' | 'no-folder' | 'unsafe'> {
  const folder = parentOf(path)
  const folderStat = await io.stat(folder)
  if (folderStat !== null && !isInPlace(folderStat, folder, root, 'dir')) return 'unsafe'
  const fileStat = await io.stat(path)
  if (fileStat !== null && !isInPlace(fileStat, path, root, 'file')) return 'unsafe'

  return folderStat === null ? 'no-folder' : 'ok'
}

/** Writes the role's session.json with this session id, unless it already holds it or is not in place. */
export async function publishSession(
  io: InitIo,
  host: HostIo,
  ctx: RoleContext,
  sessionId: string,
): Promise<'written' | 'kept' | 'refused'> {
  const path = sessionFilePath(ctx.root, ctx.id)
  if ((await runtimeFileCheck(io, ctx.root, path)) === 'unsafe') return 'refused'
  if ((await publishedId(io, path)) === sessionId) return 'kept'

  return (await host.write(path, sessionRecordText(sessionId))) ? 'written' : 'refused'
}

/**
 * Why the receiver's inbox may not be appended to, or null: its runtime folder must be there, as a folder in place,
 * which /cadre start renders, and the inbox in it absent or a file in place.
 */
async function receiverRefusal(io: InitIo, root: string, to: string): Promise<string | null> {
  const check = await runtimeFileCheck(io, root, inboxLogPath(root, to))
  if (check === 'no-folder') return fill(PROMPTS.inboxNotStarted, { to })
  if (check === 'unsafe') return fill(PROMPTS.inboxUnsafe, { to })

  return null
}

/** The events of the session's own inbox, none when it is absent; null when it cannot be read as text. */
async function readOwnInbox(io: InitIo, ctx: RoleContext): Promise<InboxEvent[] | null> {
  const read = await io.read(inboxLogPath(ctx.root, ctx.id), INBOX_READ_MAX_BYTES)
  if (read.state === 'absent') return []

  return read.state === 'text' ? parseInbox(read.text) : null
}

/** Appends a record line after a newline, so a torn last line in the file never runs into the next record. */
async function appendLine(host: HostIo, path: string, line: string): Promise<boolean> {
  const run = await host.run(['/usr/bin/tee', '-a', path], { stdin: `\n${line}`, timeoutMs: INBOX_APPEND_TIMEOUT_MS })

  return run !== null && run.exitCode === 0
}

/** What a role sends: the receiver, the kind, the subject and body, the entry it replies to and the kind fields. */
type Message = {
  readonly to: string
  readonly kindName: MessageKind
  readonly subject: string
  readonly body: string
  readonly replyTo: string | null
  readonly fields: InboxEntryFields
}

/**
 * Stamps the message as an entry from the session's role, appends it to its receiver's inbox, then wakes the receiver
 * by the session id it published. A line over its cap or an inbox out of place is refused before anything runs.
 */
async function deliver(
  io: InitIo,
  host: HostIo,
  link: SessionLink,
  ctx: RoleContext,
  at: number,
  message: Message,
): Promise<ToolOutcome> {
  const { to, kindName, subject, body, replyTo, fields } = message
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
    ...fields,
  }
  const line = recordLine(entry)
  if (utf8Bytes(line) > INBOX_LINE_MAX_BYTES) {
    return deny(fill(PROMPTS.inboxLineTooLarge, { max: INBOX_LINE_MAX_BYTES }))
  }
  const refusal = await receiverRefusal(io, ctx.root, to)
  if (refusal !== null) return deny(refusal)
  if (!(await appendLine(host, inboxLogPath(ctx.root, to), line))) return deny(fill(PROMPTS.inboxAppendFailed, { to }))
  const sessionId = await publishedId(io, sessionFilePath(ctx.root, to))
  const isDelivered = sessionId !== null && (await link.send(sessionId, wakeText(entry)))

  return { kind: 'result', text: fill(isDelivered ? PROMPTS.inboxSent : PROMPTS.inboxSentUndelivered, { id, to }) }
}

/** The kind fields with cadre's stamps: an entry with a vector gets its size and class at the team's threshold. */
function stampedFields(fields: InboxEntryFields, team: TeamView): InboxEntryFields {
  const { vector } = fields
  if (vector === undefined) return fields

  return { ...fields, size: sizeOf(vector), large: isLarge(vector, team.sizing.threshold) }
}

/**
 * inbox_send: one entry from the session's own role, stamped with the clock, appended and then announced live. A sent
 * vector's result ends with its size and the pick in each mode the repo offers.
 */
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
  const fields = stampedFields(input.fields, team)
  const outcome = await deliver(io, host, link, ctx, at, { ...input, fields })
  const { vector } = fields
  if (outcome.kind === 'deny' || vector === undefined) return outcome

  return { kind: 'result', text: `${outcome.text} ${sizeText(vector, team.sizing, modesOffered(team.frameworks))}` }
}

/** inbox_read: the session's own inbox, folded; an absent inbox reads as empty. */
export async function runInboxRead(io: InitIo, ctx: RoleContext, event: unknown): Promise<ToolOutcome> {
  const input = parseReadInput(event)
  if (input.kind === 'error') return deny(input.message)
  const events = await readOwnInbox(io, ctx)
  if (events === null) return deny(fill(PROMPTS.inboxUnreadable, { id: ctx.id }))

  return { kind: 'result', text: inboxReadText(foldInbox(events), input.all) }
}

/** Where a rejection goes: the sender's parent, or the sender itself when it has none or the parent is the marker. */
function rejectionTarget(team: TeamView, from: string, marker: string): string {
  const parent = Object.hasOwn(team.parents, from) ? team.parents[from] : null

  return parent === undefined || parent === null || parent === marker ? from : parent
}

/**
 * inbox_mark: one mark stamped with the session's own role and the clock, appended to its own inbox only. A rejection
 * of a role's entry then goes up as a note that replies to it; the mark stands whatever becomes of the note.
 */
export async function runInboxMark(
  io: InitIo,
  host: HostIo,
  link: SessionLink,
  ctx: RoleContext,
  team: TeamView | null,
  event: unknown,
): Promise<ToolOutcome> {
  const input = parseMarkInput(event)
  if (input.kind === 'error') return deny(input.message)
  const events = await readOwnInbox(io, ctx)
  if (events === null) return deny(fill(PROMPTS.inboxUnreadable, { id: ctx.id }))
  const entry = events.find(
    (held): held is InboxEntry => held.type === CONTRACTS.inboxEntryType && held.id === input.id && held.to === ctx.id,
  )
  if (entry === undefined) return deny(PROMPTS.inboxMarkUnknownId)
  const { id, state, note, waitsFor } = input
  const reason = state === 'rejected' && entry.from !== CONTRACTS.cadreSender ? note : null
  if (reason !== null && team === null) return deny(PROMPTS.inboxMarkNoTeam)
  const at = await io.now()
  if (at === null) return deny(PROMPTS.inboxMarkFailed)
  const mark: InboxMark = {
    v: 1,
    type: CONTRACTS.inboxMarkType,
    id,
    at,
    by: ctx.id,
    state,
    ...(note === null ? {} : { note }),
    ...(waitsFor === null ? {} : { waitsFor }),
  }
  const refusal = await receiverRefusal(io, ctx.root, ctx.id)
  if (refusal !== null) return deny(refusal)
  if (!(await appendLine(host, inboxLogPath(ctx.root, ctx.id), recordLine(mark)))) return deny(PROMPTS.inboxMarkFailed)
  if (reason === null || team === null) return { kind: 'result', text: fill(PROMPTS.inboxMarked, { id, state }) }
  const to = rejectionTarget(team, entry.from, ctx.id)
  const subject = clean(fill(PROMPTS.inboxRejectSubject, { subject: entry.subject }), SUBJECT_MAX_CHARS)
  const forward = await deliver(io, host, link, ctx, at, {
    to,
    kindName: 'note',
    subject,
    body: reason,
    replyTo: id,
    fields: {},
  })

  return { kind: 'result', text: fill(PROMPTS.inboxMarkedRejected, { id, forward: forward.text }) }
}
