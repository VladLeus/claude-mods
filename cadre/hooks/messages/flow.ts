/**
 * The inbox flows of a role session, a layer 7 module: the role context read from the runtime env, the session id a
 * role publishes, and inbox_send, all through the InitIo and HostIo ports.
 */
import type { HostIo, InitIo, RoleContext, SessionLink, TeamView, ToolOutcome } from '../../types'

export function roleContextOf(_role: unknown, _root: unknown): RoleContext | null {
  return null
}

export async function isRoleSession(_io: InitIo, _ctx: RoleContext): Promise<boolean> {
  return false
}

export async function publishSession(
  _io: InitIo,
  _host: HostIo,
  _ctx: RoleContext,
  _sessionId: string,
): Promise<'written' | 'kept' | 'refused'> {
  return 'refused'
}

export async function runInboxSend(
  _io: InitIo,
  _host: HostIo,
  _link: SessionLink,
  _ctx: RoleContext,
  _team: TeamView | null,
  _event: unknown,
): Promise<ToolOutcome> {
  return { kind: 'deny', text: '' }
}
