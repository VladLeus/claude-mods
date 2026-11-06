/**
 * The inbox flows of a role session, a layer 7 module: the role context read from the runtime env, the session id a
 * role publishes, and inbox_send, all through the InitIo and HostIo ports. An inbox is only ever appended, and the
 * durable entry is always written before the live wake.
 */
import type { HostIo, InboxEntry, InitIo, RoleContext, SessionLink, TeamView, ToolOutcome } from '../../types'
import { isRoleId } from '../core/role-id'
import { CONTRACTS } from '../locales/contracts'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { isFileInsideRoot, resolveSegments, roleJsonPath } from '../paths'
import {
  entryIdOf,
  inboxLogPath,
  parseSessionRecord,
  recordLine,
  sessionFilePath,
  sessionRecordText,
} from './record'
import { INBOX_APPEND_TIMEOUT_MS, parseSendInput } from './send'
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

/** Writes the role's session.json with this session id, unless it already holds it. */
export async function publishSession(
  io: InitIo,
  host: HostIo,
  ctx: RoleContext,
  sessionId: string,
): Promise<'written' | 'kept' | 'refused'> {
  const path = sessionFilePath(ctx.root, ctx.id)
  if ((await publishedId(io, path)) === sessionId) return 'kept'

  return (await host.write(path, sessionRecordText(sessionId))) ? 'written' : 'refused'
}

async function appendLine(host: HostIo, path: string, line: string): Promise<boolean> {
  const run = await host.run(['/usr/bin/tee', '-a', path], { stdin: line, timeoutMs: INBOX_APPEND_TIMEOUT_MS })

  return run !== null && run.exitCode === 0
}

/** Appends the entry to its receiver's inbox, then wakes the receiver by the session id it published. */
async function deliver(
  io: InitIo,
  host: HostIo,
  link: SessionLink,
  root: string,
  entry: InboxEntry,
): Promise<ToolOutcome> {
  const { id, to } = entry
  if (!(await appendLine(host, inboxLogPath(root, to), recordLine(entry)))) {
    return deny(fill(PROMPTS.inboxAppendFailed, { to }))
  }
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
