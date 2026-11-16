/**
 * The inbox flows of a role session, a layer 7 module: the role context read from the runtime env, the inbox home the
 * session works out in the user config folder, the session id a role publishes, inbox_send, inbox_read and
 * inbox_mark, all through the InitIo and HostIo ports. An inbox is only ever appended, and the durable entry is always
 * written before the live wake.
 */
import type {
  HostIo,
  InboxEntry,
  InboxEntryFields,
  InboxEvent,
  InboxMark,
  InitIo,
  InitLocations,
  MessageKind,
  RoleContext,
  RoleSession,
  SessionLink,
  SizeClass,
  TeamView,
  ToolOutcome,
} from '../../types'
import { sha256Hex } from '../core/hash'
import { isRoleId } from '../core/role-id'
import { clean } from '../core/text'
import { CONTRACTS } from '../locales/contracts'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import {
  inboxHomeOf,
  isFileInsideRoot,
  parentOf,
  relativeTo,
  resolveSegments,
  roleJsonPath,
  userDirOf,
} from '../paths'
import {
  entryIdOf,
  foldInbox,
  inboxEntryText,
  inboxLogPath,
  inboxReadText,
  lineRefusal,
  parseInbox,
  parseReadInput,
  parseSessionRecord,
  recordLine,
  sessionFilePath,
  sessionRecordText,
  ticketPinOf,
} from './record'
import {
  INBOX_APPEND_TIMEOUT_MS,
  INBOX_READ_MAX_BYTES,
  parseMarkInput,
  parseSendInput,
  SUBJECT_MAX_CHARS,
} from './send'
import { modesOffered, sizeClassOf, sizeText, SP_METHOD, SP_PLAN_DIR } from './sizing'
import type { SizeVerdict } from './sizing'
import { wakeText } from './wake'

/** The most bytes of a session.json that are read. */
const SESSION_READ_MAX_BYTES = 4096

function deny(text: string): ToolOutcome {
  return { kind: 'deny', text }
}

/** Whether a value is an absolute, normalised path other than `/`. */
function isRootPath(value: unknown): value is string {
  return typeof value === 'string' && value !== '/' && value.startsWith('/') && resolveSegments(value) === value
}

/**
 * The role, the root and the main checkout a session runs as: a role id, an absolute, normalised root and, when the
 * env names one, a main checkout checked the same way; null for anything else, a malformed main checkout included.
 */
export function roleContextOf(role: unknown, root: unknown, main?: unknown): RoleContext | null {
  if (typeof role !== 'string' || !isRoleId(role)) return null
  if (!isRootPath(root)) return null
  if (main === undefined || main === null || main === '') return { id: role, root }
  if (!isRootPath(main)) return null

  return { id: role, root, main }
}

/** The root a session reads its role and team from: the main checkout of a linked worktree, else its own root. */
export function teamRootOf(ctx: RoleContext): string {
  return ctx.main ?? ctx.root
}

/**
 * Whether the context names a role of the repo: its role.json is a regular file inside the team root, so a session in
 * a linked worktree reads it from the main checkout while its own files stay under its root.
 */
export async function isRoleSession(io: InitIo, ctx: RoleContext): Promise<boolean> {
  const teamRoot = teamRootOf(ctx)

  return isFileInsideRoot(await io.stat(`${teamRoot}/${roleJsonPath(ctx.id)}`), teamRoot)
}

/** A user folder inside the repo is never used, since a role may write there. */
export async function roleSessionOf(
  ctx: RoleContext,
  locations: Pick<InitLocations, 'home' | 'configDir'>,
): Promise<RoleSession | null> {
  const roots = [ctx.root, ...(ctx.main === undefined ? [] : [ctx.main])]
  const userDir = userDirOf(locations, roots, [])
  if (userDir === null) return null
  if (roots.some(root => relativeTo(userDir, root) !== null)) return null

  return { ...ctx, inboxHome: inboxHomeOf(userDir, ctx.root, await sha256Hex(ctx.root)) }
}

async function publishedId(io: InitIo, path: string): Promise<string | null> {
  const read = await io.read(path, SESSION_READ_MAX_BYTES)

  return read.state === 'text' ? parseSessionRecord(read.text) : null
}

/**
 * Whether a file of a role's inbox folder may be written: 'no-folder' when the folder is absent, 'unsafe' when the
 * folder or the file is a link or of another kind, else 'ok'.
 */
async function inboxFileCheck(io: InitIo, path: string): Promise<'ok' | 'no-folder' | 'unsafe'> {
  const folder = await io.stat(parentOf(path))
  if (folder === null) return 'no-folder'
  if (folder.isLink || folder.kind !== 'dir') return 'unsafe'
  const file = await io.stat(path)
  if (file !== null && (file.isLink || file.kind !== 'file')) return 'unsafe'

  return 'ok'
}

/** Writes the role's session.json with this session id, unless it already holds it or its inbox folder is not safe. */
export async function publishSession(
  io: InitIo,
  host: HostIo,
  session: RoleSession,
  sessionId: string,
): Promise<'written' | 'kept' | 'refused'> {
  const path = sessionFilePath(session.inboxHome, session.id)
  if ((await inboxFileCheck(io, path)) !== 'ok') return 'refused'
  if ((await publishedId(io, path)) === sessionId) return 'kept'

  return (await host.write(path, sessionRecordText(sessionId))) ? 'written' : 'refused'
}

/** Why the session's own inbox may not be read or appended to, or null when its folder and file are safe. */
async function ownInboxRefusal(io: InitIo, session: RoleSession): Promise<string | null> {
  const check = await inboxFileCheck(io, inboxLogPath(session.inboxHome, session.id))
  if (check === 'no-folder') return fill(PROMPTS.inboxOwnMissing, { id: session.id })
  if (check === 'unsafe') return fill(PROMPTS.inboxOwnUnsafe, { id: session.id })

  return null
}

/**
 * Why the receiver's inbox may not be appended to, or null: its inbox folder must be there, which /cadre start
 * renders, and the inbox in it absent or a file.
 */
async function receiverRefusal(io: InitIo, home: string, to: string): Promise<string | null> {
  const check = await inboxFileCheck(io, inboxLogPath(home, to))
  if (check === 'no-folder') return fill(PROMPTS.inboxNotStarted, { to })
  if (check === 'unsafe') return fill(PROMPTS.inboxUnsafe, { to })

  return null
}

/** The events of the session's own inbox, none when it is absent; null when it cannot be read as text. */
async function readOwnInbox(io: InitIo, session: RoleSession): Promise<InboxEvent[] | null> {
  const read = await io.read(inboxLogPath(session.inboxHome, session.id), INBOX_READ_MAX_BYTES)
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
  session: RoleSession,
  at: number,
  message: Message,
): Promise<ToolOutcome> {
  const { to, kindName, subject, body, replyTo, fields } = message
  const id = await entryIdOf(session.id, at, [to, kindName, subject, body].join('\n'))
  const entry: InboxEntry = {
    v: 1,
    type: CONTRACTS.inboxEntryType,
    id,
    at,
    from: session.id,
    to,
    kind: kindName,
    subject,
    body,
    ...(replyTo === null ? {} : { replyTo }),
    ...fields,
  }
  const line = recordLine(entry)
  const refusal = lineRefusal(entry, line)
  if (refusal !== null) return deny(refusal)
  const receiver = await receiverRefusal(io, session.inboxHome, to)
  if (receiver !== null) return deny(receiver)
  const appended = await appendLine(host, inboxLogPath(session.inboxHome, to), line)
  if (!appended) return deny(fill(PROMPTS.inboxAppendFailed, { to }))
  const sessionId = await publishedId(io, sessionFilePath(session.inboxHome, to))
  const isDelivered = sessionId !== null && (await link.send(sessionId, wakeText(entry)))

  return { kind: 'result', text: fill(isDelivered ? PROMPTS.inboxSent : PROMPTS.inboxSentUndelivered, { id, to }) }
}

/**
 * The pin a task inherits: that of the last ticket of its key in the sender's own inbox; null for any other kind or
 * when the inbox cannot be read.
 */
async function taskPinOf(
  io: InitIo,
  session: RoleSession,
  kindName: MessageKind,
  fields: InboxEntryFields,
): Promise<SizeClass | null> {
  const { ticketKey } = fields
  if (kindName !== 'task' || ticketKey === undefined) return null
  const events = await readOwnInbox(io, session)

  return events === null ? null : ticketPinOf(events, ticketKey)
}

/** A verdict's stamps; none without a computed size, since a stored entry holds the size and the class together. */
function sizeStamps(verdict: SizeVerdict | null): InboxEntryFields {
  if (verdict === null || verdict.size === null) return {}
  const { size, large, pinned } = verdict

  return pinned === null ? { size, large } : { size, large, pinned }
}

/**
 * The kind fields with cadre's stamps: a task gets its size and its class from the pin it inherits, else from its
 * vector at the team's threshold, and a superpowers task the plan file of its receiver and ticket and the one method a
 * worker executes it with.
 */
function stampedFields(
  kindName: MessageKind,
  fields: InboxEntryFields,
  to: string,
  team: TeamView,
  pin: SizeClass | null,
): InboxEntryFields {
  const { vector, use, ticketKey } = fields
  const verdict = kindName === 'task' ? sizeClassOf(vector ?? null, team.sizing.threshold, pin) : null
  const sized = { ...fields, ...sizeStamps(verdict) }
  if (use?.framework !== 'superpowers' || ticketKey === undefined) return sized

  return { ...sized, planPath: `${SP_PLAN_DIR}/${to}-${ticketKey}.md`, method: SP_METHOD }
}

/** The verdict a send result ends with: a task's, and a ticket's when it is pinned; null for any other kind. */
function resultVerdictOf(
  kindName: MessageKind,
  fields: InboxEntryFields,
  threshold: number,
  pin: SizeClass | null,
): SizeVerdict | null {
  if (kindName === 'task') return sizeClassOf(fields.vector ?? null, threshold, pin)
  if (kindName === 'ticket') return sizeClassOf(null, threshold, fields.pin ?? null)

  return null
}

/**
 * inbox_send: one entry from the session's own role, stamped with the clock, appended and then announced live. A
 * session whose own inbox folder is absent or unsafe is refused before anything runs; the result of a task or a
 * pinned ticket ends with its size class and the pick in each mode the repo offers.
 */
export async function runInboxSend(
  io: InitIo,
  host: HostIo,
  link: SessionLink,
  session: RoleSession,
  team: TeamView | null,
  event: unknown,
): Promise<ToolOutcome> {
  if (team === null) return deny(PROMPTS.inboxNoTeam)
  const input = parseSendInput(event, session, team)
  if (input.kind === 'error') return deny(input.message)
  const own = await ownInboxRefusal(io, session)
  if (own !== null) return deny(own)
  const pin = await taskPinOf(io, session, input.kindName, input.fields)
  const at = await io.now()
  if (at === null) return deny(PROMPTS.inboxNoClock)
  const fields = stampedFields(input.kindName, input.fields, input.to, team, pin)
  const outcome = await deliver(io, host, link, session, at, { ...input, fields })
  const verdict = resultVerdictOf(input.kindName, input.fields, team.sizing.threshold, pin)
  if (outcome.kind === 'deny' || verdict === null) return outcome

  return { kind: 'result', text: `${outcome.text} ${sizeText(verdict, team.sizing, modesOffered(team.frameworks))}` }
}

/**
 * inbox_read: the session's own inbox folded, or with an id the one entry of it the id names; an absent inbox in its
 * present, safe folder reads as empty.
 */
export async function runInboxRead(io: InitIo, session: RoleSession, event: unknown): Promise<ToolOutcome> {
  const input = parseReadInput(event)
  if (input.kind === 'error') return deny(input.message)
  const own = await ownInboxRefusal(io, session)
  if (own !== null) return deny(own)
  const events = await readOwnInbox(io, session)
  if (events === null) return deny(PROMPTS.inboxUnreadable)
  const items = foldInbox(events)
  if (input.id === null) return { kind: 'result', text: inboxReadText(items, input.all) }
  const text = inboxEntryText(items, input.id)

  return text === null ? deny(PROMPTS.inboxReadUnknownId) : { kind: 'result', text }
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
  session: RoleSession,
  team: TeamView | null,
  event: unknown,
): Promise<ToolOutcome> {
  const input = parseMarkInput(event)
  if (input.kind === 'error') return deny(input.message)
  const own = await ownInboxRefusal(io, session)
  if (own !== null) return deny(own)
  const events = await readOwnInbox(io, session)
  if (events === null) return deny(PROMPTS.inboxUnreadable)
  const entry = events.find(
    (held): held is InboxEntry =>
      held.type === CONTRACTS.inboxEntryType && held.id === input.id && held.to === session.id,
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
    by: session.id,
    state,
    ...(note === null ? {} : { note }),
    ...(waitsFor === null ? {} : { waitsFor }),
  }
  const refusal = await receiverRefusal(io, session.inboxHome, session.id)
  if (refusal !== null) return deny(refusal)
  const marked = await appendLine(host, inboxLogPath(session.inboxHome, session.id), recordLine(mark))
  if (!marked) return deny(PROMPTS.inboxMarkFailed)
  if (reason === null || team === null) return { kind: 'result', text: fill(PROMPTS.inboxMarked, { id, state }) }
  const to = rejectionTarget(team, entry.from, session.id)
  const subject = clean(fill(PROMPTS.inboxRejectSubject, { subject: entry.subject }), SUBJECT_MAX_CHARS)
  const forward = await deliver(io, host, link, session, at, {
    to,
    kindName: 'note',
    subject,
    body: reason,
    replyTo: id,
    fields: {},
  })

  return { kind: 'result', text: fill(PROMPTS.inboxMarkedRejected, { id, forward: forward.text }) }
}
