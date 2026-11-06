import { describe, expect, test } from 'claude-code/testing'

import type { RoleContext, SessionLink, TeamView, ToolOutcome } from '../../types'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { hostWorld, memHost, memIo, memWorld } from '../testkit'
import type { MemHost, MemWorld } from '../testkit'
import { publishSession, roleContextOf, runInboxSend } from './flow'
import { parseInboxLine, sessionRecordText } from './record'

const BE: RoleContext = { id: 'be', root: '/repo' }
const TEAM: TeamView = { ids: ['pm', 'tl', 'be'], parents: { pm: null, tl: 'pm', be: 'tl' } }
const TL_RUNTIME = '/repo/.cadre/tl/.runtime'
const TL_INBOX = `${TL_RUNTIME}/inbox.jsonl`
const BE_SESSION = '/repo/.cadre/be/.runtime/session.json'
const NOTE = { tool: 'mcp__cadre__inbox_send', to: 'tl', kind: 'note', subject: 'Hi', body: 'Hello' }

/** One live send the link was asked for, and how many host runs had been recorded before it. */
type Sent = {
  readonly sessionId: string
  readonly text: string
  readonly runsBefore: number
}

/** A send's outcome, its host and the live sends it made. */
type SendRun = {
  readonly outcome: ToolOutcome
  readonly host: MemHost
  readonly sends: Sent[]
}

/** A world where tl was started and published its session id, with the clock at 1000. */
function tlWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({
    now: 1000,
    dirs: { [TL_RUNTIME]: [] },
    files: { [`${TL_RUNTIME}/session.json`]: sessionRecordText('s-tl') },
    ...over,
  })
}

/** runInboxSend from be over `world`, with a link that answers `isDelivered` and records each send. */
async function sendFrom(
  world: MemWorld,
  event: unknown,
  team: TeamView | null = TEAM,
  isDelivered = true,
): Promise<SendRun> {
  const host = memHost(hostWorld({}))
  const sends: Sent[] = []
  const link: SessionLink = {
    send: async (sessionId, text) => {
      sends.push({ sessionId, text, runsBefore: host.calls.length })

      return isDelivered
    },
  }
  const outcome = await runInboxSend(memIo(world, {}).io, host.io, link, BE, team, event)

  return { outcome, host, sends }
}

/** The stdin of the first host run, '' when there was none. */
function firstStdin(host: MemHost): string {
  return host.calls[0]?.options.stdin ?? ''
}

describe('roleContextOf', () => {
  test('a role id and an absolute root give the context; anything else gives null', () => {
    expect(roleContextOf('be', '/repo')).toEqual({ id: 'be', root: '/repo' })
    const refused: readonly (readonly [unknown, unknown])[] = [
      ['BE!', '/repo'],
      ['', '/repo'],
      [undefined, '/repo'],
      ['be', 'repo'],
      ['be', '/repo/'],
      ['be', '/a/../b'],
    ]
    expect(refused.map(([role, root]) => roleContextOf(role, root))).toEqual(refused.map(() => null))
  })
})

describe('runInboxSend', () => {
  test('be sends tl a note: one stamped line appended with tee, then one live wake by session id', async () => {
    const { outcome, host, sends } = await sendFrom(tlWorld(), NOTE)
    const stdin = firstStdin(host)
    const entry = parseInboxLine(stdin)
    const id = entry?.id ?? ''

    expect(host.calls.map(call => call.argv)).toEqual([['/usr/bin/tee', '-a', TL_INBOX]])
    expect(stdin.indexOf('\n')).toBe(stdin.length - 1)
    expect(entry).toMatchObject({ type: 'entry', from: 'be', to: 'tl', at: 1000, kind: 'note', subject: 'Hi' })
    expect(id).toMatch(/^be-1000-[0-9a-f]{8}$/)
    expect(sends.map(send => send.sessionId)).toEqual(['s-tl'])
    expect(sends[0]?.text ?? '').toContain(id)
    expect(sends.map(send => send.runsBefore)).toEqual([1])
    expect(outcome).toEqual({ kind: 'result', text: fill(PROMPTS.inboxSent, { id, to: 'tl' }) })
  })

  test('a from key in the input is ignored: the entry carries the role of the session', async () => {
    const { host, sends } = await sendFrom(tlWorld(), { ...NOTE, from: 'pm' })

    expect(parseInboxLine(firstStdin(host))).toMatchObject({ from: 'be' })
    expect(sends.map(send => send.runsBefore)).toEqual([1])
  })

  test('with no team view the send is refused and nothing runs', async () => {
    const { outcome, host, sends } = await sendFrom(tlWorld(), NOTE, null)

    expect(outcome).toEqual({ kind: 'deny', text: PROMPTS.inboxNoTeam })
    expect(host.calls).toEqual([])
    expect(sends).toEqual([])
  })
})

describe('publishSession', () => {
  test('it writes the session id, and writes nothing when the file already holds it', async () => {
    const fresh = memHost(hostWorld({}))
    const kept = memHost(hostWorld({}))
    const published = memWorld({ files: { [BE_SESSION]: sessionRecordText('s-be') } })

    expect(await publishSession(memIo(memWorld({}), {}).io, fresh.io, BE, 's-be')).toBe('written')
    expect(fresh.writes).toEqual([{ path: BE_SESSION, text: sessionRecordText('s-be'), isWritten: true }])
    expect(await publishSession(memIo(published, {}).io, kept.io, BE, 's-be')).toBe('kept')
    expect(kept.writes).toEqual([])
  })
})
