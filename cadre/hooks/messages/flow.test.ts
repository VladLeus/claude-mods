import { describe, expect, test } from 'claude-code/testing'

import type { InboxEntry, RoleContext, SessionLink, TeamView, ToolOutcome } from '../../types'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { hostWorld, memHost, memIo, memWorld } from '../testkit'
import type { HostRunRule, MemHost, MemWorld } from '../testkit'
import { publishSession, roleContextOf, runInboxMark, runInboxRead, runInboxSend } from './flow'
import { parseInboxLine, recordLine, sessionRecordText } from './record'
import { INBOX_LINE_MAX_BYTES } from './send'

const BE: RoleContext = { id: 'be', root: '/repo' }
const TEAM: TeamView = { ids: ['pm', 'tl', 'be'], parents: { pm: null, tl: 'pm', be: 'tl' } }
const TL_RUNTIME = '/repo/.cadre/tl/.runtime'
const TL_INBOX = `${TL_RUNTIME}/inbox.jsonl`
const TL_SESSION = `${TL_RUNTIME}/session.json`
const TL_FILES: Readonly<Record<string, string>> = { [TL_SESSION]: sessionRecordText('s-tl') }
const BE_RUNTIME = '/repo/.cadre/be/.runtime'
const BE_SESSION = `${BE_RUNTIME}/session.json`
const BE_INBOX = `${BE_RUNTIME}/inbox.jsonl`
const PM_RUNTIME = '/repo/.cadre/pm/.runtime'
const PM_INBOX = `${PM_RUNTIME}/inbox.jsonl`
const NOTE = { tool: 'mcp__cadre__inbox_send', to: 'tl', kind: 'note', subject: 'Hi', body: 'Hello' }
const TEE = ['/usr/bin/tee', '-a', TL_INBOX]
const BE_TEE = ['/usr/bin/tee', '-a', BE_INBOX]
const PM_TEE = ['/usr/bin/tee', '-a', PM_INBOX]

/** A character of four UTF-8 bytes. */
const WIDE = '\u{1F600}'

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

/** What a send runs with besides its world and its event: the team view, the live answer and the host's runs. */
type SendOver = {
  readonly team?: TeamView | null
  readonly isDelivered?: boolean
  readonly runs?: readonly HostRunRule[]
}

/** What a mark runs with besides its event: the marking role, its world, the team view and the host's runs. */
type MarkOver = {
  readonly ctx?: RoleContext
  readonly world?: MemWorld
  readonly team?: TeamView | null
  readonly runs?: readonly HostRunRule[]
}

/** A world where tl was started and published its session id, with the clock at 1000. */
function tlWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ now: 1000, dirs: { [TL_RUNTIME]: [] }, files: TL_FILES, ...over })
}

/** runInboxSend from be over `world`, with a link that answers `isDelivered` and records each send. */
async function sendFrom(world: MemWorld, event: unknown, over: SendOver = {}): Promise<SendRun> {
  const { team = TEAM, isDelivered = true, runs = [] } = over
  const host = memHost(hostWorld({ runs }))
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

/** The stdin of the second host run, '' when there was none. */
function secondStdin(host: MemHost): string {
  return host.calls[1]?.options.stdin ?? ''
}

/** The argv of every append a host ran with tee. */
function teeRuns(host: MemHost): (readonly string[])[] {
  return host.calls.map(call => call.argv).filter(argv => argv[0] === '/usr/bin/tee')
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

    expect(host.calls.map(call => call.argv)).toEqual([TEE])
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
    const { outcome, host, sends } = await sendFrom(tlWorld(), NOTE, { team: null })

    expect(outcome).toEqual({ kind: 'deny', text: PROMPTS.inboxNoTeam })
    expect(host.calls).toEqual([])
    expect(sends).toEqual([])
  })

  test('an entry over the line cap in UTF-8 bytes is refused before any run', async () => {
    const { outcome, host } = await sendFrom(tlWorld(), { ...NOTE, body: WIDE.repeat(2000) })

    expect(outcome).toEqual({ kind: 'deny', text: fill(PROMPTS.inboxLineTooLarge, { max: INBOX_LINE_MAX_BYTES }) })
    expect(teeRuns(host)).toEqual([])
  })

  test('a receiver whose runtime folder is not there is refused, naming /cadre start for it', async () => {
    const { outcome, host, sends } = await sendFrom(tlWorld({ dirs: {} }), NOTE)

    expect(outcome).toEqual({ kind: 'deny', text: fill(PROMPTS.inboxNotStarted, { to: 'tl' }) })
    expect(outcome.text).toContain('/cadre start tl')
    expect(teeRuns(host)).toEqual([])
    expect(sends).toEqual([])
  })

  test('a runtime folder that is a link or a file, or an inbox that is a link or a folder, is refused', async () => {
    const worlds = [
      tlWorld({ realPaths: { [TL_RUNTIME]: '/elsewhere/.runtime' } }),
      tlWorld({ dirs: {}, files: { ...TL_FILES, [TL_RUNTIME]: 'a file' } }),
      tlWorld({ files: { ...TL_FILES, [TL_INBOX]: '' }, realPaths: { [TL_INBOX]: '/elsewhere/inbox.jsonl' } }),
      tlWorld({ dirs: { [TL_RUNTIME]: [], [TL_INBOX]: [] } }),
    ]
    for (const world of worlds) {
      const { outcome, host } = await sendFrom(world, NOTE)

      expect(outcome).toEqual({ kind: 'deny', text: fill(PROMPTS.inboxUnsafe, { to: 'tl' }) })
      expect(teeRuns(host)).toEqual([])
    }
  })

  test('with no published session id, an unreadable one or a live send that fails, the entry stands', async () => {
    const runs = [
      await sendFrom(tlWorld({ files: {} }), NOTE),
      await sendFrom(tlWorld({ files: { [TL_SESSION]: 'not json' } }), NOTE),
      await sendFrom(tlWorld(), NOTE, { isDelivered: false }),
    ]
    for (const { outcome, host } of runs) {
      const id = parseInboxLine(firstStdin(host))?.id ?? ''

      expect(teeRuns(host)).toEqual([TEE])
      expect(outcome).toEqual({ kind: 'result', text: fill(PROMPTS.inboxSentUndelivered, { id, to: 'tl' }) })
      expect(outcome.text).toContain('.cadre/tl/.runtime/inbox.jsonl')
    }
    expect(runs.map(run => run.sends.map(send => send.runsBefore))).toEqual([[], [], [1]])
  })

  test('an append that exits non-zero or cannot run is refused and nothing is sent', async () => {
    for (const result of [{ exitCode: 1, stdout: '', stderr: '' }, null]) {
      const { outcome, sends } = await sendFrom(tlWorld(), NOTE, { runs: [{ argv: TEE, result }] })

      expect(outcome).toEqual({ kind: 'deny', text: fill(PROMPTS.inboxAppendFailed, { to: 'tl' }) })
      expect(sends).toEqual([])
    }
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

  test('it refuses with no write when the runtime folder or session.json is a link out of its place', async () => {
    const worlds = [
      memWorld({ dirs: { [BE_RUNTIME]: [] }, realPaths: { [BE_RUNTIME]: '/elsewhere/.runtime' } }),
      memWorld({ files: { [BE_SESSION]: sessionRecordText('s-be') }, realPaths: { [BE_SESSION]: '/x/session.json' } }),
    ]
    for (const world of worlds) {
      const host = memHost(hostWorld({}))

      expect(await publishSession(memIo(world, {}).io, host.io, BE, 's-be')).toBe('refused')
      expect(host.writes).toEqual([])
    }
  })
})

describe('runInboxRead', () => {
  const ticket: InboxEntry = {
    v: 1,
    type: 'entry',
    id: 'tl-1000-0123abcd',
    at: 1000,
    from: 'tl',
    to: 'be',
    kind: 'ticket',
    subject: 'Do it',
    body: 'Now',
  }

  test('it reads only the inbox of its own role and shows it folded', async () => {
    const run = memIo(memWorld({ files: { [BE_INBOX]: recordLine(ticket), [TL_INBOX]: recordLine(ticket) } }), {})
    const outcome = await runInboxRead(run.io, BE, {})

    expect(run.reads).toEqual([BE_INBOX])
    expect(outcome).toEqual({ kind: 'result', text: 'tl-1000-0123abcd [unread] ticket from tl: Do it\n  Now' })
  })

  test('an absent inbox reads as empty; an all that is not true or false is refused', async () => {
    const io = memIo(memWorld({}), {}).io

    expect(await runInboxRead(io, BE, {})).toEqual({ kind: 'result', text: PROMPTS.inboxEmpty })
    expect(await runInboxRead(io, BE, { all: 'yes' })).toEqual({ kind: 'deny', text: PROMPTS.inboxAllNotBoolean })
  })

  test('an inbox that cannot be read as text is refused', async () => {
    const io = memIo(memWorld({ unknownPaths: [BE_INBOX] }), {}).io

    expect(await runInboxRead(io, BE, {})).toEqual({ kind: 'deny', text: fill(PROMPTS.inboxUnreadable, { id: 'be' }) })
  })
})

describe('runInboxMark', () => {
  const TL: RoleContext = { id: 'tl', root: '/repo' }
  const fromBe: InboxEntry = {
    v: 1,
    type: 'entry',
    id: 'be-1000-0123abcd',
    at: 1000,
    from: 'be',
    to: 'tl',
    kind: 'report',
    subject: 'Done',
    body: 'Merged',
  }
  const inbox = { [TL_INBOX]: recordLine(fromBe) }
  const REJECT = { id: fromBe.id, state: 'rejected', note: 'Not ours' }

  /** tl's inbox holding the entry from be, with be started and its session id published, the clock at 2000. */
  const beStarted = memWorld({
    now: 2000,
    dirs: { [TL_RUNTIME]: [], [BE_RUNTIME]: [] },
    files: { ...inbox, [BE_SESSION]: sessionRecordText('s-be') },
  })

  /**
   * runInboxMark with a link that records each send. Unless `over` says else, as tl over tl's inbox holding the entry
   * from be, with the clock at 2000.
   */
  async function markAs(event: unknown, over: MarkOver = {}): Promise<SendRun> {
    const { ctx = TL, team = TEAM, runs = [] } = over
    const world = over.world ?? memWorld({ now: 2000, dirs: { [TL_RUNTIME]: [] }, files: inbox })
    const host = memHost(hostWorld({ runs }))
    const sends: Sent[] = []
    const link: SessionLink = {
      send: async (sessionId, text) => {
        sends.push({ sessionId, text, runsBefore: host.calls.length })

        return true
      },
    }
    const outcome = await runInboxMark(memIo(world, {}).io, host.io, link, ctx, team, event)

    return { outcome, host, sends }
  }

  test('tl marks the entry done: one mark stamped by tl appended to its own inbox, which then reads done', async () => {
    const { outcome, host } = await markAs({ id: fromBe.id, state: 'done', note: 'merged', by: 'pm' })
    const stdin = firstStdin(host)
    const after = memIo(memWorld({ files: { [TL_INBOX]: `${recordLine(fromBe)}${stdin}` } }), {})

    expect(host.calls.map(call => call.argv)).toEqual([TEE])
    expect(parseInboxLine(stdin)).toEqual({
      v: 1,
      type: 'mark',
      id: fromBe.id,
      at: 2000,
      by: 'tl',
      state: 'done',
      note: 'merged',
    })
    expect(outcome).toEqual({ kind: 'result', text: fill(PROMPTS.inboxMarked, { id: fromBe.id, state: 'done' }) })
    expect((await runInboxRead(after.io, TL, { all: true })).text).toContain(`${fromBe.id} [done]`)
  })

  test('an unknown id, a bad state, a missing note or a missing waitsFor is refused with no run', async () => {
    const events = [
      { id: 'pm-1000-0123abcd', state: 'read' },
      { id: fromBe.id, state: 'unread' },
      { id: fromBe.id, state: 'ping' },
      { id: fromBe.id, state: 'done' },
      { id: fromBe.id, state: 'awaiting' },
    ]
    for (const event of events) {
      const { outcome, host } = await markAs(event)

      expect([outcome.kind, host.calls.length]).toEqual(['deny', 0])
    }
    expect((await markAs(events[0])).outcome).toEqual({ kind: 'deny', text: PROMPTS.inboxMarkUnknownId })
  })

  test('tl rejects the entry of its child be: the mark, then a note to be replying to it, then the wake', async () => {
    const { outcome, host, sends } = await markAs(REJECT, { world: beStarted })
    const forward = parseInboxLine(secondStdin(host))
    const forwardId = forward?.id ?? ''

    expect(host.calls.map(call => call.argv)).toEqual([TEE, BE_TEE])
    expect(parseInboxLine(firstStdin(host))).toMatchObject({ by: 'tl', state: 'rejected', note: 'Not ours' })
    expect(forward).toEqual({
      v: 1,
      type: 'entry',
      id: forwardId,
      at: 2000,
      from: 'tl',
      to: 'be',
      kind: 'note',
      subject: 'rejected: Done',
      body: 'Not ours',
      replyTo: fromBe.id,
    })
    expect(forwardId).toMatch(/^tl-2000-[0-9a-f]{8}$/)
    expect(sends.map(send => [send.sessionId, send.runsBefore])).toEqual([['s-be', 2]])
    expect(sends[0]?.text ?? '').toContain(forwardId)
    const forwarded = fill(PROMPTS.inboxSent, { id: forwardId, to: 'be' })
    expect(outcome).toEqual({
      kind: 'result',
      text: fill(PROMPTS.inboxMarkedRejected, { id: fromBe.id, forward: forwarded }),
    })
  })

  test("pm rejects an entry from be: the note goes to be's parent tl", async () => {
    const PM: RoleContext = { id: 'pm', root: '/repo' }
    const toPm: InboxEntry = { ...fromBe, to: 'pm' }
    const world = memWorld({
      now: 2000,
      dirs: { [PM_RUNTIME]: [], [TL_RUNTIME]: [] },
      files: { [PM_INBOX]: recordLine(toPm), ...TL_FILES },
    })
    const { host, sends } = await markAs({ ...REJECT, id: toPm.id }, { ctx: PM, world })

    expect(teeRuns(host)).toEqual([PM_TEE, TEE])
    expect(parseInboxLine(secondStdin(host))).toMatchObject({ from: 'pm', to: 'tl', kind: 'note', replyTo: toPm.id })
    expect(sends.map(send => send.sessionId)).toEqual(['s-tl'])
  })

  test('a sender with no parent, or one the team does not know, gets the note itself', async () => {
    for (const from of ['pm', 'constructor']) {
      const runtime = `/repo/.cadre/${from}/.runtime`
      const entry: InboxEntry = { ...fromBe, id: `${from}-1000-0123abcd`, from }
      const files = { [TL_INBOX]: recordLine(entry) }
      const world = memWorld({ now: 2000, dirs: { [TL_RUNTIME]: [], [runtime]: [] }, files })
      const { host } = await markAs({ ...REJECT, id: entry.id }, { world })

      expect(teeRuns(host)).toEqual([TEE, ['/usr/bin/tee', '-a', `${runtime}/inbox.jsonl`]])
    }
  })

  test('a rejected entry from cadre is only marked: one append, no note and no wake', async () => {
    const fromCadre: InboxEntry = { ...fromBe, id: 'cadre-1000-0123abcd', from: 'cadre' }
    const world = memWorld({ now: 2000, dirs: { [TL_RUNTIME]: [] }, files: { [TL_INBOX]: recordLine(fromCadre) } })
    const { outcome, host, sends } = await markAs({ ...REJECT, id: fromCadre.id }, { world })

    expect(teeRuns(host)).toEqual([TEE])
    expect(sends).toEqual([])
    expect(outcome).toEqual({
      kind: 'result',
      text: fill(PROMPTS.inboxMarked, { id: fromCadre.id, state: 'rejected' }),
    })
  })

  test('a note whose append fails leaves the mark standing, and the result says the note was not added', async () => {
    const runs = [{ argv: BE_TEE, result: { exitCode: 1, stdout: '', stderr: '' } }]
    const { outcome, host, sends } = await markAs(REJECT, { world: beStarted, runs })
    const notAdded = fill(PROMPTS.inboxAppendFailed, { to: 'be' })

    expect(teeRuns(host)).toEqual([TEE, BE_TEE])
    expect(parseInboxLine(firstStdin(host))).toMatchObject({ type: 'mark', state: 'rejected' })
    expect(sends).toEqual([])
    expect(outcome).toEqual({
      kind: 'result',
      text: fill(PROMPTS.inboxMarkedRejected, { id: fromBe.id, forward: notAdded }),
    })
  })

  test("with no team view a rejection of a role's entry is refused before anything runs", async () => {
    const { outcome, host } = await markAs(REJECT, { world: beStarted, team: null })

    expect(outcome).toEqual({ kind: 'deny', text: PROMPTS.inboxMarkNoTeam })
    expect(host.calls).toEqual([])
  })
})
