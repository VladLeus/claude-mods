import { describe, expect, test } from 'claude-code/testing'

import type { InboxEntry, InboxMark, RoleSession, SessionLink, TeamView, ToolOutcome } from '../../types'
import { sha256Hex } from '../core/hash'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { inboxDirOf, inboxHomeOf } from '../paths'
import { hostWorld, memHost, memIo, memWorld } from '../testkit'
import type { HostRunRule, MemHost, MemWorld } from '../testkit'
import {
  isRoleSession,
  publishSession,
  roleContextOf,
  roleSessionOf,
  runInboxMark,
  runInboxRead,
  runInboxSend,
  teamRootOf,
} from './flow'
import { parseInbox, parseInboxLine, recordLine, sessionRecordText } from './record'
import {
  BODY_MAX_CHARS,
  CHANGES_MAX_CHARS,
  INBOX_READ_MAX_BYTES,
  LIST_ITEM_MAX_CHARS,
  LIST_MAX_ITEMS,
  REASON_MAX_CHARS,
  SUBJECT_MAX_CHARS,
  VERIFICATION_MAX_CHARS,
} from './send'

/** The inbox home of the root /repo in the user folder of HOME /home/u. */
const HOME = inboxHomeOf('/home/u/.claude', '/repo', await sha256Hex('/repo'))
const BE: RoleSession = { id: 'be', root: '/repo', inboxHome: HOME }
const TEAM: TeamView = {
  ids: ['pm', 'tl', 'be'],
  parents: { pm: null, tl: 'pm', be: 'tl' },
  pm: 'pm',
  sizing: { threshold: 0.5, mapping: { small: 'superpowers', large: 'gsd' }, rubric: '.cadre/sizing.md' },
  frameworks: ['gsd', 'superpowers'],
  mayRun: { pm: ['none'], tl: ['gsd', 'superpowers'], be: ['gsd', 'superpowers'] },
}
const TL_FOLDER = inboxDirOf(HOME, 'tl')
const TL_INBOX = `${TL_FOLDER}/inbox.jsonl`
const TL_SESSION = `${TL_FOLDER}/session.json`
const TL_FILES: Readonly<Record<string, string>> = { [TL_SESSION]: sessionRecordText('s-tl') }
const BE_FOLDER = inboxDirOf(HOME, 'be')
const BE_SESSION = `${BE_FOLDER}/session.json`
const BE_INBOX = `${BE_FOLDER}/inbox.jsonl`
const PM_FOLDER = inboxDirOf(HOME, 'pm')
const PM_INBOX = `${PM_FOLDER}/inbox.jsonl`
/** The inbox folders of pm, tl and be, as /cadre start renders them. */
const STARTED = { [PM_FOLDER]: [], [TL_FOLDER]: [], [BE_FOLDER]: [] }
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

/** A send's outcome, its host, the live sends it made and the paths it read. */
type SendRun = {
  readonly outcome: ToolOutcome
  readonly host: MemHost
  readonly sends: Sent[]
  readonly reads: readonly string[]
}

/** What a send runs with besides its world and its event: the sender, the team view, the live answer, the runs. */
type SendOver = {
  readonly ctx?: RoleSession
  readonly team?: TeamView | null
  readonly isDelivered?: boolean
  readonly runs?: readonly HostRunRule[]
}

/** What a mark runs with besides its event: the marking role, its world, the team view and the host's runs. */
type MarkOver = {
  readonly ctx?: RoleSession
  readonly world?: MemWorld
  readonly team?: TeamView | null
  readonly runs?: readonly HostRunRule[]
}

/** A world where pm, tl and be were started and tl published its session id, with the clock at 1000. */
function tlWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ now: 1000, dirs: STARTED, files: TL_FILES, ...over })
}

/** runInboxSend over `world`, from be unless `over` says else, with a link that answers `isDelivered`. */
async function sendFrom(world: MemWorld, event: unknown, over: SendOver = {}): Promise<SendRun> {
  const { ctx = BE, team = TEAM, isDelivered = true, runs = [] } = over
  const host = memHost(hostWorld({ runs }))
  const sends: Sent[] = []
  const link: SessionLink = {
    send: async (sessionId, text) => {
      sends.push({ sessionId, text, runsBefore: host.calls.length })

      return isDelivered
    },
  }
  const run = memIo(world, {})
  const outcome = await runInboxSend(run.io, host.io, link, ctx, team, event)

  return { outcome, host, sends, reads: run.reads }
}

/** The stdin of the first host run, '' when there was none. */
function firstStdin(host: MemHost): string {
  return host.calls[0]?.options.stdin ?? ''
}

/** The stdin of the second host run, '' when there was none. */
function secondStdin(host: MemHost): string {
  return host.calls[1]?.options.stdin ?? ''
}

/** The entry a record line holds; null for a mark or a line that does not parse. */
function entryLine(text: string): InboxEntry | null {
  const event = parseInboxLine(text)

  return event?.type === 'entry' ? event : null
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

  test('a main checkout that is an absolute root is kept; absent or empty gives none; anything else gives null', () => {
    expect(roleContextOf('be', '/wt', '/main')).toEqual({ id: 'be', root: '/wt', main: '/main' })
    expect(roleContextOf('be', '/wt', undefined)).toEqual({ id: 'be', root: '/wt' })
    expect(roleContextOf('be', '/wt', '')).toEqual({ id: 'be', root: '/wt' })
    const refused: readonly unknown[] = ['rel', '/', '/a/../b', 5]
    expect(refused.map(main => roleContextOf('be', '/wt', main))).toEqual(refused.map(() => null))
  })

  test('the team root is the main checkout when the context has one, else the root', () => {
    expect(teamRootOf({ id: 'be', root: '/wt', main: '/main' })).toBe('/main')
    expect(teamRootOf({ id: 'be', root: '/wt' })).toBe('/wt')
  })
})

describe('isRoleSession', () => {
  test('a role.json linked into the main checkout names a role only with that main checkout', async () => {
    const text = '{}'
    const world = memWorld({
      files: { '/wt/.cadre/be/role.json': text, '/main/.cadre/be/role.json': text },
      realPaths: { '/wt/.cadre/be/role.json': '/main/.cadre/be/role.json' },
    })
    const { io } = memIo(world, [])

    expect(await isRoleSession(io, { id: 'be', root: '/wt', main: '/main' })).toBe(true)
    expect(await isRoleSession(io, { id: 'be', root: '/wt' })).toBe(false)
  })
})

describe('roleSessionOf', () => {
  test('the inbox home is keyed on the root, in HOME/.claude or a safe CLAUDE_CONFIG_DIR outside it', async () => {
    const hash = await sha256Hex('/repo')
    const ctx = { id: 'be', root: '/repo' }

    expect(await roleSessionOf(ctx, { home: '/home/u', configDir: null })).toEqual({
      ...ctx,
      inboxHome: inboxHomeOf('/home/u/.claude', '/repo', hash),
    })
    expect(await roleSessionOf(ctx, { home: '/home/u', configDir: '/cfg' })).toEqual({
      ...ctx,
      inboxHome: inboxHomeOf('/cfg', '/repo', hash),
    })
  })

  test('a CLAUDE_CONFIG_DIR inside the root is not used: the inbox home falls back to HOME/.claude', async () => {
    const session = await roleSessionOf({ id: 'be', root: '/repo' }, { home: '/home/u', configDir: '/repo/cfg' })

    expect(session?.inboxHome).toBe(inboxHomeOf('/home/u/.claude', '/repo', await sha256Hex('/repo')))
  })

  test('no user folder, or a user folder inside the root or the main checkout, gives no session', async () => {
    const sessions = [
      await roleSessionOf({ id: 'be', root: '/repo' }, { home: null, configDir: null }),
      await roleSessionOf({ id: 'be', root: '/repo' }, { home: '/repo/u', configDir: null }),
      await roleSessionOf({ id: 'be', root: '/wt', main: '/m' }, { home: '/m/h', configDir: null }),
    ]

    expect(sessions).toEqual([null, null, null])
  })

  test('a worktree session is keyed on its own root, never on the main checkout', async () => {
    const session = await roleSessionOf({ id: 'be', root: '/wt', main: '/repo' }, { home: '/home/u', configDir: null })

    expect(session?.inboxHome).toBe(inboxHomeOf('/home/u/.claude', '/wt', await sha256Hex('/wt')))
    expect(session?.inboxHome).not.toBe(HOME)
  })
})

describe('runInboxSend', () => {
  test('be sends tl a note: one stamped line appended with tee, then one live wake by session id', async () => {
    const { outcome, host, sends, reads } = await sendFrom(tlWorld(), NOTE)
    const stdin = firstStdin(host)
    const entry = parseInboxLine(stdin)
    const id = entry?.id ?? ''

    expect(host.calls.map(call => call.argv)).toEqual([TEE])
    expect(reads).toEqual([TL_SESSION])
    expect([stdin.startsWith('\n'), stdin.endsWith('\n'), stdin.split('\n').length - 1]).toEqual([true, true, 2])
    expect(entry).toMatchObject({ type: 'entry', from: 'be', to: 'tl', at: 1000, kind: 'note', subject: 'Hi' })
    expect(id).toMatch(/^be-1000-[0-9a-f]{8}$/)
    expect(sends.map(send => send.sessionId)).toEqual(['s-tl'])
    expect(sends[0]?.text ?? '').toContain(id)
    expect(sends.map(send => send.runsBefore)).toEqual([1])
    expect(outcome).toEqual({ kind: 'result', text: fill(PROMPTS.inboxSent, { id, to: 'tl' }) })
  })

  test('a torn last line with no newline costs only itself: the next send still reads as its own entry', async () => {
    const earlier: InboxEntry = {
      v: 1,
      type: 'entry',
      id: 'pm-900-0123abcd',
      at: 900,
      from: 'pm',
      to: 'tl',
      kind: 'note',
      subject: 'Earlier',
      body: 'Torn',
    }
    const { host } = await sendFrom(tlWorld(), NOTE)
    const stdin = firstStdin(host)
    const sent = parseInboxLine(stdin)

    expect(sent).toMatchObject({ type: 'entry', from: 'be', to: 'tl' })
    expect(parseInbox(`${recordLine(earlier).slice(0, 30)}${stdin}`)).toEqual([sent])
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

  test('a report with every field at its cap in four-byte characters is stored and its receiver woken', async () => {
    const report = {
      to: 'tl',
      kind: 'report',
      subject: WIDE.repeat(SUBJECT_MAX_CHARS),
      body: WIDE.repeat(BODY_MAX_CHARS),
      outcome: 'done',
      changes: WIDE.repeat(CHANGES_MAX_CHARS),
      verification: WIDE.repeat(VERIFICATION_MAX_CHARS),
      vector: { scope: 0.4, complexity: 0.6, risk: 0.3, effort: 0.5 },
      reason: WIDE.repeat(REASON_MAX_CHARS),
      frameworkUsed: 'gsd',
      docPaths: Array.from({ length: LIST_MAX_ITEMS }, () => 'd'.repeat(LIST_ITEM_MAX_CHARS)),
      openQuestions: Array.from({ length: LIST_MAX_ITEMS }, () => WIDE.repeat(LIST_ITEM_MAX_CHARS)),
    }
    const { outcome, host, sends } = await sendFrom(tlWorld(), report)

    expect(outcome.kind).toBe('result')
    expect(teeRuns(host)).toEqual([TEE])
    expect(sends).toHaveLength(1)
  })

  test('a worktree session appends under the inbox home of its own root, never that of the main checkout', async () => {
    const wtHome = inboxHomeOf('/home/u/.claude', '/wt', await sha256Hex('/wt'))
    const session = await roleSessionOf({ id: 'be', root: '/wt', main: '/repo' }, { home: '/home/u', configDir: null })
    const world = memWorld({ now: 1000, dirs: { [inboxDirOf(wtHome, 'be')]: [], [inboxDirOf(wtHome, 'tl')]: [] } })
    const { outcome, host } = await sendFrom(world, NOTE, { ctx: session ?? BE })

    expect(outcome.kind).toBe('result')
    expect(teeRuns(host)).toEqual([['/usr/bin/tee', '-a', `${inboxDirOf(wtHome, 'tl')}/inbox.jsonl`]])
    expect(teeRuns(host).flat().filter(word => word.startsWith(HOME))).toEqual([])
  })

  test('a receiver whose inbox folder is not there is refused, naming /cadre start for it', async () => {
    const { outcome, host, sends } = await sendFrom(tlWorld({ dirs: { [BE_FOLDER]: [] } }), NOTE)

    expect(outcome).toEqual({ kind: 'deny', text: fill(PROMPTS.inboxNotStarted, { to: 'tl' }) })
    expect(outcome.text).toContain('/cadre start tl')
    expect(host.calls).toEqual([])
    expect(sends).toEqual([])
  })

  test('an inbox folder that is a link or a file, or an inbox that is a link or a folder, is refused', async () => {
    const worlds = [
      tlWorld({ realPaths: { [TL_FOLDER]: '/elsewhere/tl' } }),
      tlWorld({ dirs: { [BE_FOLDER]: [] }, files: { ...TL_FILES, [TL_FOLDER]: 'a file' } }),
      tlWorld({ files: { ...TL_FILES, [TL_INBOX]: '' }, realPaths: { [TL_INBOX]: '/elsewhere/inbox.jsonl' } }),
      tlWorld({ dirs: { ...STARTED, [TL_INBOX]: [] } }),
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
      expect(outcome.text).not.toContain('.cadre')
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

  test('a user config folder that is a link still takes the append and the wake', async () => {
    const { outcome, host, sends } = await sendFrom(tlWorld({ realPaths: { '/home/u/.claude': '/data/claude' } }), NOTE)

    expect(outcome.kind).toBe('result')
    expect(teeRuns(host)).toEqual([TEE])
    expect(sends.map(send => send.sessionId)).toEqual(['s-tl'])
  })

  test('a sender whose own inbox folder is absent or a link is refused, with no run and no wake', async () => {
    const absent = await sendFrom(tlWorld({ dirs: { [TL_FOLDER]: [] } }), NOTE)
    const linked = await sendFrom(tlWorld({ realPaths: { [BE_FOLDER]: '/elsewhere/be' } }), NOTE)

    expect([absent.outcome, linked.outcome]).toEqual([
      { kind: 'deny', text: fill(PROMPTS.inboxOwnMissing, { id: 'be' }) },
      { kind: 'deny', text: fill(PROMPTS.inboxOwnUnsafe, { id: 'be' }) },
    ])
    expect([absent.host.calls, linked.host.calls, absent.sends, linked.sends]).toEqual([[], [], [], []])
  })
})

describe('runInboxSend of a task', () => {
  const TL: RoleSession = { id: 'tl', root: '/repo', inboxHome: HOME }
  const VECTOR = { scope: 0.4, complexity: 0.6, risk: 0.3, effort: 0.5 }
  const TASK = {
    to: 'be',
    kind: 'task',
    subject: 'Add the endpoint',
    body: 'Add the endpoint',
    ticketKey: 'PROJ-2',
    vector: VECTOR,
    use: { framework: 'gsd', gsdPath: 'phase' },
  }

  const PM_TICKET: InboxEntry = {
    v: 1,
    type: 'entry',
    id: 'pm-900-0123abcd',
    at: 900,
    from: 'pm',
    to: 'tl',
    kind: 'ticket',
    subject: 'Add login',
    body: 'The acceptance criteria',
    ticketKey: 'PROJ-2',
    scores: { scope: 0.3, risk: 0.9 },
  }

  /** The no-ticket sentence of PROJ-2, spelled out so the specs pin its words. */
  const NO_TICKET = 'No ticket PROJ-2 is in your inbox, so no pin applies.'

  /** A world where pm, tl and be were started and be published its session id, with the clock at 1000. */
  function beWorld(): MemWorld {
    return memWorld({ now: 1000, dirs: STARTED, files: { [BE_SESSION]: sessionRecordText('s-be') } })
  }

  /** beWorld with these entries in tl's own inbox. */
  function tlInboxWorld(entries: readonly InboxEntry[]): MemWorld {
    const files = { [BE_SESSION]: sessionRecordText('s-be'), [TL_INBOX]: entries.map(recordLine).join('') }

    return memWorld({ now: 1000, dirs: STARTED, files })
  }

  test(
    'tl sends be a task whose ticket has no pin: the entry carries its vector with the size stamp; ' +
      'the result names the picks and no pin sentence',
    async () => {
      const { outcome, host } = await sendFrom(tlInboxWorld([PM_TICKET]), TASK, { ctx: TL })
      const entry = parseInboxLine(firstStdin(host))
      const id = entry?.id ?? ''

      expect(entry).toMatchObject({
        kind: 'task',
        from: 'tl',
        to: 'be',
        ticketKey: 'PROJ-2',
        vector: VECTOR,
        use: { framework: 'gsd', gsdPath: 'phase' },
        size: 0.6,
        large: true,
      })
      expect(teeRuns(host)).toEqual([BE_TEE])
      expect(outcome).toEqual({
        kind: 'result',
        text: [
          fill(PROMPTS.inboxSent, { id, to: 'be' }),
          fill(PROMPTS.inboxSize, { size: 0.6, sizeClass: 'large', threshold: 0.5 }),
          fill(PROMPTS.inboxSizePickGsd, { mode: 'gsd-epic', gsdPath: 'phase' }),
          fill(PROMPTS.inboxSizePickGsd, { mode: 'ticket', gsdPath: 'phase' }),
        ].join(' '),
      })
    },
  )

  test('the size is stamped from the threshold of the team view, and a small task maps to the small pick', async () => {
    const team: TeamView = { ...TEAM, sizing: { ...TEAM.sizing, threshold: 0.7 } }
    const { outcome, host } = await sendFrom(beWorld(), TASK, { ctx: TL, team })

    expect(parseInboxLine(firstStdin(host))).toMatchObject({ size: 0.6, large: false })
    expect(outcome.text).toContain(fill(PROMPTS.inboxSize, { size: 0.6, sizeClass: 'small', threshold: 0.7 }))
    expect(outcome.text).toContain(fill(PROMPTS.inboxSizePick, { mode: 'ticket', framework: 'superpowers' }))
  })

  test('a task without ticketKey, vector or use is refused, naming the field, and nothing runs', async () => {
    const fields = ['ticketKey', 'vector', 'use']
    for (const field of fields) {
      const { outcome, host, sends } = await sendFrom(beWorld(), { ...TASK, [field]: undefined }, { ctx: TL })

      expect(outcome).toEqual({ kind: 'deny', text: fill(PROMPTS.inboxFieldMissing, { kind: 'task', fields: field }) })
      expect([host.calls, sends]).toEqual([[], []])
    }
  })

  test("a task inherits the pin of PM's ticket with the same key: the class and the pick follow the pin", async () => {
    const world = tlInboxWorld([{ ...PM_TICKET, pin: 'small' }])
    const { outcome, host, reads } = await sendFrom(world, TASK, { ctx: TL })
    const entry = entryLine(firstStdin(host))
    const id = entry?.id ?? ''

    expect(entry).toMatchObject({ kind: 'task', ticketKey: 'PROJ-2', size: 0.6, large: false, pinned: 'small' })
    expect(outcome).toEqual({
      kind: 'result',
      text:
        `${fill(PROMPTS.inboxSent, { id, to: 'be' })} Size small (pinned; computed 0.6). ` +
        'In gsd-epic mode: gsd, GSD path quick. In ticket mode: superpowers.',
    })
    expect(reads).toContain(TL_INBOX)
  })

  test('the latest pinned PM ticket of the key wins over a later one without a pin', async () => {
    const team: TeamView = { ...TEAM, sizing: { ...TEAM.sizing, threshold: 0.7 } }
    const later: InboxEntry = { ...PM_TICKET, id: 'pm-950-0123abcd', at: 950 }
    const world = tlInboxWorld([{ ...PM_TICKET, pin: 'large' }, later])
    const { outcome, host, reads } = await sendFrom(world, TASK, { ctx: TL, team })
    const entry = entryLine(firstStdin(host))
    const id = entry?.id ?? ''

    expect(entry).toMatchObject({ size: 0.6, large: true, pinned: 'large' })
    expect(outcome).toEqual({
      kind: 'result',
      text: [
        fill(PROMPTS.inboxSent, { id, to: 'be' }),
        'Size large (pinned; computed 0.6).',
        fill(PROMPTS.inboxSizePickGsd, { mode: 'gsd-epic', gsdPath: 'phase' }),
        fill(PROMPTS.inboxSizePickGsd, { mode: 'ticket', gsdPath: 'phase' }),
      ].join(' '),
    })
    expect(reads).toContain(TL_INBOX)
  })

  test(
    "with no ticket of its key in tl's inbox the result says so and the task is sized from its vector: " +
      'no inbox, another key only, a key spelled differently',
    async () => {
      const team: TeamView = { ...TEAM, sizing: { ...TEAM.sizing, threshold: 0.7 } }
      const other: InboxEntry = { ...PM_TICKET, id: 'pm-980-0123abcd', at: 980, ticketKey: 'PROJ-3', pin: 'large' }
      const worlds = [
        beWorld(),
        tlInboxWorld([other]),
        tlInboxWorld([{ ...PM_TICKET, ticketKey: 'proj-2', pin: 'small' }]),
      ]
      for (const world of worlds) {
        const { outcome, host, reads } = await sendFrom(world, TASK, { ctx: TL, team })
        const stdin = firstStdin(host)
        const id = entryLine(stdin)?.id ?? ''

        expect(entryLine(stdin)).toMatchObject({ size: 0.6, large: false })
        expect(stdin).not.toContain('"pinned":')
        expect(outcome).toEqual({
          kind: 'result',
          text: [
            fill(PROMPTS.inboxSent, { id, to: 'be' }),
            NO_TICKET,
            fill(PROMPTS.inboxSize, { size: 0.6, sizeClass: 'small', threshold: 0.7 }),
            fill(PROMPTS.inboxSizePickGsd, { mode: 'gsd-epic', gsdPath: 'quick' }),
            fill(PROMPTS.inboxSizePick, { mode: 'ticket', framework: 'superpowers' }),
          ].join(' '),
        })
        expect(reads).toContain(TL_INBOX)
      }
    },
  )

  test('an undelivered task with no ticket of its key still says so', async () => {
    const { outcome, host } = await sendFrom(beWorld(), TASK, { ctx: TL, isDelivered: false })
    const id = entryLine(firstStdin(host))?.id ?? ''
    const head = `${fill(PROMPTS.inboxSentUndelivered, { id, to: 'be' })} ${NO_TICKET} `

    expect(outcome.text.slice(0, head.length)).toBe(head)
  })

  test(
    'a task over an own inbox that cannot be read inherits no pin and adds no sentence: it is sized from its vector',
    async () => {
      const files = {
        [BE_SESSION]: sessionRecordText('s-be'),
        [TL_INBOX]: recordLine({ ...PM_TICKET, pin: 'small' }) + '\n'.repeat(INBOX_READ_MAX_BYTES),
      }
      const world = memWorld({ now: 1000, dirs: STARTED, files })
      const { outcome, host, reads } = await sendFrom(world, TASK, { ctx: TL })
      const stdin = firstStdin(host)
      const id = entryLine(stdin)?.id ?? ''

      expect(entryLine(stdin)).toMatchObject({ kind: 'task', size: 0.6, large: true })
      expect(stdin).not.toContain('"pinned":')
      expect(reads).toContain(TL_INBOX)
      expect(outcome).toEqual({
        kind: 'result',
        text: [
          fill(PROMPTS.inboxSent, { id, to: 'be' }),
          fill(PROMPTS.inboxSize, { size: 0.6, sizeClass: 'large', threshold: 0.5 }),
          fill(PROMPTS.inboxSizePickGsd, { mode: 'gsd-epic', gsdPath: 'phase' }),
          fill(PROMPTS.inboxSizePickGsd, { mode: 'ticket', gsdPath: 'phase' }),
        ].join(' '),
      })
    },
  )
})

describe('runInboxSend of the ticket loop', () => {
  const PM: RoleSession = { id: 'pm', root: '/repo', inboxHome: HOME }
  const TL: RoleSession = { id: 'tl', root: '/repo', inboxHome: HOME }
  const VECTOR = { scope: 0.4, complexity: 0.6, risk: 0.3, effort: 0.5 }
  const TICKET = {
    to: 'tl',
    kind: 'ticket',
    subject: 'Add login',
    body: 'The acceptance criteria',
    ticketKey: 'PROJ-2',
    scores: { scope: 0.3, risk: 0.9 },
    pin: 'large',
    reportForm: 'Outcome first',
  }
  const TASK = {
    to: 'be',
    kind: 'task',
    subject: 'Add the endpoint',
    body: 'Add it',
    ticketKey: 'PROJ-2',
    vector: VECTOR,
    use: { framework: 'superpowers' },
  }
  const REPORT = {
    to: 'tl',
    kind: 'report',
    subject: 'PROJ-2 done',
    body: 'Done',
    outcome: 'done',
    changes: 'Added the endpoint',
    verification: 'The specs pass',
    vector: VECTOR,
    reason: 'A new endpoint',
    frameworkUsed: 'superpowers',
    docPaths: ['docs/superpowers/plans/be-PROJ-2.md'],
    openQuestions: [],
  }
  const BRIEF = {
    to: 'tl',
    kind: 'note',
    subject: 'Epic PROJ-1',
    body: 'The plan',
    mode: 'gsd-epic',
    tickets: ['PROJ-2', 'PROJ-3'],
  }

  /** A world where pm, tl and be were started and be published its session id, with the clock at 1000. */
  function beWorld(): MemWorld {
    return memWorld({ now: 1000, dirs: STARTED, files: { [BE_SESSION]: sessionRecordText('s-be') } })
  }

  /** The team view with the repo frameworks given. */
  function teamWith(frameworks: TeamView['frameworks']): TeamView {
    return { ...TEAM, frameworks, mayRun: { pm: ['none'], tl: frameworks, be: frameworks } }
  }

  test('pm sends tl a ticket: it carries its fields and no stamp; only a pinned one ends with its class', async () => {
    const { outcome, host } = await sendFrom(tlWorld(), TICKET, { ctx: PM })
    const stdin = firstStdin(host)
    const entry = entryLine(stdin)
    const unpinned = await sendFrom(tlWorld(), { ...TICKET, pin: undefined }, { ctx: PM })
    const unpinnedId = entryLine(firstStdin(unpinned.host))?.id ?? ''

    expect(entry).toMatchObject({
      kind: 'ticket',
      from: 'pm',
      ticketKey: 'PROJ-2',
      scores: { scope: 0.3, risk: 0.9 },
      pin: 'large',
      reportForm: 'Outcome first',
    })
    expect(['"size":', '"large":', '"pinned":'].filter(key => stdin.includes(key))).toEqual([])
    expect(outcome).toEqual({
      kind: 'result',
      text:
        `${fill(PROMPTS.inboxSent, { id: entry?.id ?? '', to: 'tl' })} Size large (pinned). ` +
        'In gsd-epic mode: gsd, GSD path phase. In ticket mode: gsd, GSD path phase.',
    })
    expect(unpinned.outcome).toEqual({ kind: 'result', text: fill(PROMPTS.inboxSent, { id: unpinnedId, to: 'tl' }) })
  })

  test('the same ticket key sent twice gives two entries with two ids; nothing is merged', async () => {
    const first = await sendFrom(tlWorld(), { ...TICKET, body: 'First version' }, { ctx: PM })
    const second = await sendFrom(tlWorld(), { ...TICKET, body: 'Second version' }, { ctx: PM })
    const entries = [entryLine(firstStdin(first.host)), entryLine(firstStdin(second.host))]

    expect(entries.map(entry => entry?.ticketKey)).toEqual(['PROJ-2', 'PROJ-2'])
    expect(entries[0]?.id).not.toBe(entries[1]?.id)
  })

  test('be reports to tl: the entry keeps its vector, with no size stamp and no size line', async () => {
    const { outcome, host } = await sendFrom(tlWorld(), REPORT)
    const stdin = firstStdin(host)
    const entry = entryLine(stdin)

    expect(entry).toMatchObject({
      kind: 'report',
      outcome: 'done',
      frameworkUsed: 'superpowers',
      openQuestions: [],
      vector: VECTOR,
    })
    expect(['"size":', '"large":', '"pinned":'].filter(key => stdin.includes(key))).toEqual([])
    expect(outcome).toEqual({ kind: 'result', text: fill(PROMPTS.inboxSent, { id: entry?.id ?? '', to: 'tl' }) })
  })

  test('a superpowers task gets the plan file of its receiver and ticket and the method, never its own', async () => {
    const { host } = await sendFrom(beWorld(), { ...TASK, planPath: 'mine.md', method: 'ask me' }, { ctx: TL })

    expect(parseInboxLine(firstStdin(host))).toMatchObject({
      planPath: 'docs/superpowers/plans/be-PROJ-2.md',
      method: 'superpowers:subagent-driven-development',
    })
  })

  test('a gsd task gets neither the plan file nor the method', async () => {
    const gsdTask = { ...TASK, use: { framework: 'gsd', gsdPath: 'quick' } }
    const entry = entryLine(firstStdin((await sendFrom(beWorld(), gsdTask, { ctx: TL })).host))

    expect(entry).toMatchObject({ use: { framework: 'gsd', gsdPath: 'quick' } })
    expect([entry?.planPath, entry?.method]).toEqual([undefined, undefined])
  })

  test('a task in a framework its receiver may not run is refused, naming the ones it may; nothing runs', async () => {
    const team: TeamView = {
      ...TEAM,
      ids: [...TEAM.ids, 'qa'],
      parents: { ...TEAM.parents, qa: 'tl' },
      frameworks: ['superpowers'],
      mayRun: { pm: ['none'], tl: ['superpowers'], be: ['superpowers'], qa: ['none'] },
    }
    const gsdTask = { ...TASK, use: { framework: 'gsd', gsdPath: 'quick' } }
    const gsdToBe = await sendFrom(beWorld(), gsdTask, { ctx: TL, team })
    const toQa = await sendFrom(beWorld(), { ...TASK, to: 'qa' }, { ctx: TL, team })
    const toBe = await sendFrom(beWorld(), TASK, { ctx: TL, team })

    expect([gsdToBe.outcome, toQa.outcome]).toEqual([
      { kind: 'deny', text: fill(PROMPTS.inboxUseNotRun, { to: 'be', framework: 'gsd', frameworks: 'superpowers' }) },
      { kind: 'deny', text: fill(PROMPTS.inboxUseNotRun, { to: 'qa', framework: 'superpowers', frameworks: 'none' }) },
    ])
    expect([gsdToBe.host.calls, toQa.host.calls, gsdToBe.sends, toQa.sends]).toEqual([[], [], [], []])
    expect(toBe.outcome.kind).toBe('result')
    expect(entryLine(firstStdin(toBe.host))).toMatchObject({
      to: 'be',
      use: { framework: 'superpowers' },
      planPath: 'docs/superpowers/plans/be-PROJ-2.md',
    })
  })

  test('a gsd-epic brief is sent with gsd and superpowers; with gsd alone or none it is refused, no run', async () => {
    const both = await sendFrom(tlWorld(), BRIEF, { ctx: PM })
    const gsdOnly = await sendFrom(tlWorld(), BRIEF, { ctx: PM, team: teamWith(['gsd']) })
    const none = await sendFrom(tlWorld(), BRIEF, { ctx: PM, team: teamWith([]) })

    expect(parseInboxLine(firstStdin(both.host))).toMatchObject({ mode: 'gsd-epic', tickets: ['PROJ-2', 'PROJ-3'] })
    expect([gsdOnly.outcome, none.outcome]).toEqual([
      { kind: 'deny', text: fill(PROMPTS.inboxModeNotOffered, { mode: 'gsd-epic', modes: 'ticket' }) },
      { kind: 'deny', text: fill(PROMPTS.inboxModeNotOffered, { mode: 'gsd-epic', modes: PROMPTS.inboxItemNone }) },
    ])
    expect([gsdOnly.host.calls, none.host.calls]).toEqual([[], []])
  })

  test('a ticket-mode brief is sent with one framework and refused with none', async () => {
    const brief = { ...BRIEF, mode: 'ticket', tickets: undefined }
    const gsdOnly = await sendFrom(tlWorld(), brief, { ctx: PM, team: teamWith(['gsd']) })
    const none = await sendFrom(tlWorld(), brief, { ctx: PM, team: teamWith([]) })

    expect(parseInboxLine(firstStdin(gsdOnly.host))).toMatchObject({ kind: 'note', mode: 'ticket' })
    expect(none.outcome).toEqual({
      kind: 'deny',
      text: fill(PROMPTS.inboxModeNotOffered, { mode: 'ticket', modes: PROMPTS.inboxItemNone }),
    })
  })

  test('a gsd-epic brief of 100 tickets of 64 characters is stored', async () => {
    const tickets = Array.from({ length: 100 }, (_, index) => `PROJ-${index}`.padEnd(64, 'x'))
    const { outcome, host } = await sendFrom(tlWorld(), { ...BRIEF, tickets }, { ctx: PM })

    expect(outcome.kind).toBe('result')
    expect(teeRuns(host)).toEqual([TEE])
    expect(entryLine(firstStdin(host))?.tickets).toEqual(tickets)
  })
})

describe('publishSession', () => {
  test('it writes the session id into its inbox folder, and nothing when the file already holds it', async () => {
    const fresh = memHost(hostWorld({}))
    const kept = memHost(hostWorld({}))
    const started = memWorld({ dirs: { [BE_FOLDER]: [] } })
    const published = memWorld({ dirs: { [BE_FOLDER]: [] }, files: { [BE_SESSION]: sessionRecordText('s-be') } })

    expect(await publishSession(memIo(started, {}).io, fresh.io, BE, 's-be')).toBe('written')
    expect(fresh.writes).toEqual([{ path: BE_SESSION, text: sessionRecordText('s-be'), isWritten: true }])
    expect(await publishSession(memIo(published, {}).io, kept.io, BE, 's-be')).toBe('kept')
    expect(kept.writes).toEqual([])
  })

  test('it refuses with no write when the inbox folder is absent or a link, or session.json is a link', async () => {
    const published = { [BE_SESSION]: sessionRecordText('s-be') }
    const worlds = [
      memWorld({}),
      memWorld({ dirs: { [BE_FOLDER]: [] }, realPaths: { [BE_FOLDER]: '/elsewhere/be' } }),
      memWorld({ dirs: { [BE_FOLDER]: [] }, files: published, realPaths: { [BE_SESSION]: '/x/session.json' } }),
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
    const files = { [BE_INBOX]: recordLine(ticket), [TL_INBOX]: recordLine(ticket) }
    const run = memIo(memWorld({ dirs: STARTED, files }), {})
    const outcome = await runInboxRead(run.io, BE, {})

    expect(run.reads).toEqual([BE_INBOX])
    expect(outcome).toEqual({ kind: 'result', text: 'tl-1000-0123abcd [unread] ticket from tl: Do it\n  Now' })
  })

  test('an absent inbox in a present folder reads as empty; an all that is not true or false is refused', async () => {
    const io = memIo(memWorld({ dirs: { [BE_FOLDER]: [] } }), {}).io

    expect(await runInboxRead(io, BE, {})).toEqual({ kind: 'result', text: PROMPTS.inboxEmpty })
    expect(await runInboxRead(io, BE, { all: 'yes' })).toEqual({ kind: 'deny', text: PROMPTS.inboxAllNotBoolean })
  })

  test('an inbox that cannot be read as text is refused, naming no path', async () => {
    const io = memIo(memWorld({ dirs: { [BE_FOLDER]: [] }, unknownPaths: [BE_INBOX] }), {}).io

    expect(await runInboxRead(io, BE, {})).toEqual({ kind: 'deny', text: PROMPTS.inboxUnreadable })
  })

  test('inbox_read with id prints that entry in full whatever its state; an unknown id is refused', async () => {
    const read: InboxMark = { v: 1, type: 'mark', id: ticket.id, at: 2000, by: 'be', state: 'read' }
    const files = { [BE_INBOX]: `${recordLine(ticket)}${recordLine(read)}` }
    const io = memIo(memWorld({ dirs: STARTED, files }), {}).io

    expect(await runInboxRead(io, BE, { id: 'tl-1000-0123abcd' })).toEqual({
      kind: 'result',
      text: 'tl-1000-0123abcd [read] ticket from tl: Do it\n  Now',
    })
    expect(await runInboxRead(io, BE, { id: 'tl-9-0123abcd' })).toEqual({
      kind: 'deny',
      text: 'id names no entry of your inbox: call inbox_read with no id for the ids.',
    })
    expect(await runInboxRead(io, BE, { id: 7 })).toEqual({
      kind: 'deny',
      text: 'id must be the id of an inbox entry, as inbox_read shows it.',
    })
  })
})

describe('runInboxMark', () => {
  const TL: RoleSession = { id: 'tl', root: '/repo', inboxHome: HOME }
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
    dirs: { [TL_FOLDER]: [], [BE_FOLDER]: [] },
    files: { ...inbox, [BE_SESSION]: sessionRecordText('s-be') },
  })

  /**
   * runInboxMark with a link that records each send. Unless `over` says else, as tl over tl's inbox holding the entry
   * from be, with the clock at 2000.
   */
  async function markAs(event: unknown, over: MarkOver = {}): Promise<SendRun> {
    const { ctx = TL, team = TEAM, runs = [] } = over
    const world = over.world ?? memWorld({ now: 2000, dirs: { [TL_FOLDER]: [] }, files: inbox })
    const host = memHost(hostWorld({ runs }))
    const sends: Sent[] = []
    const link: SessionLink = {
      send: async (sessionId, text) => {
        sends.push({ sessionId, text, runsBefore: host.calls.length })

        return true
      },
    }
    const run = memIo(world, {})
    const outcome = await runInboxMark(run.io, host.io, link, ctx, team, event)

    return { outcome, host, sends, reads: run.reads }
  }

  test('tl marks the entry done: one mark stamped by tl appended to its own inbox, which then reads done', async () => {
    const { outcome, host } = await markAs({ id: fromBe.id, state: 'done', note: 'merged', by: 'pm' })
    const stdin = firstStdin(host)
    const marked = { [TL_INBOX]: `${recordLine(fromBe)}${stdin}` }
    const after = memIo(memWorld({ dirs: { [TL_FOLDER]: [] }, files: marked }), {})

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
    const PM: RoleSession = { id: 'pm', root: '/repo', inboxHome: HOME }
    const toPm: InboxEntry = { ...fromBe, to: 'pm' }
    const world = memWorld({
      now: 2000,
      dirs: { [PM_FOLDER]: [], [TL_FOLDER]: [] },
      files: { [PM_INBOX]: recordLine(toPm), ...TL_FILES },
    })
    const { host, sends } = await markAs({ ...REJECT, id: toPm.id }, { ctx: PM, world })

    expect(teeRuns(host)).toEqual([PM_TEE, TEE])
    expect(parseInboxLine(secondStdin(host))).toMatchObject({ from: 'pm', to: 'tl', kind: 'note', replyTo: toPm.id })
    expect(sends.map(send => send.sessionId)).toEqual(['s-tl'])
  })

  test('a sender with no parent, or one the team does not know, gets the note itself', async () => {
    for (const from of ['pm', 'constructor']) {
      const folder = inboxDirOf(HOME, from)
      const entry: InboxEntry = { ...fromBe, id: `${from}-1000-0123abcd`, from }
      const files = { [TL_INBOX]: recordLine(entry) }
      const world = memWorld({ now: 2000, dirs: { [TL_FOLDER]: [], [folder]: [] }, files })
      const { host } = await markAs({ ...REJECT, id: entry.id }, { world })

      expect(teeRuns(host)).toEqual([TEE, ['/usr/bin/tee', '-a', `${folder}/inbox.jsonl`]])
    }
  })

  test('a rejected entry from cadre is only marked: one append, no note and no wake', async () => {
    const fromCadre: InboxEntry = { ...fromBe, id: 'cadre-1000-0123abcd', from: 'cadre' }
    const world = memWorld({ now: 2000, dirs: { [TL_FOLDER]: [] }, files: { [TL_INBOX]: recordLine(fromCadre) } })
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

describe('a role session whose own inbox folder is absent or unsafe', () => {
  const toBe: InboxEntry = {
    v: 1,
    type: 'entry',
    id: 'tl-1000-0123abcd',
    at: 1000,
    from: 'tl',
    to: 'be',
    kind: 'note',
    subject: 'Hi',
    body: 'Hello',
  }

  /** What inbox_read and then inbox_mark of be gave over one world: their outcomes, the paths read and the host. */
  type OwnRun = {
    readonly outcomes: readonly ToolOutcome[]
    readonly reads: readonly string[]
    readonly host: MemHost
  }

  /** inbox_read, then inbox_mark of toBe as read, both as be over `world` with the clock at 2000. */
  async function readAndMark(world: MemWorld): Promise<OwnRun> {
    const run = memIo(world, {})
    const host = memHost(hostWorld({}))
    const link: SessionLink = { send: async () => true }
    const read = await runInboxRead(run.io, BE, {})
    const mark = await runInboxMark(run.io, host.io, link, BE, TEAM, { id: toBe.id, state: 'read' })

    return { outcomes: [read, mark], reads: run.reads, host }
  }

  test('with no own folder, inbox_read and inbox_mark refuse naming /cadre start, with no run or write', async () => {
    const { outcomes, host } = await readAndMark(memWorld({ now: 2000 }))
    const missing = { kind: 'deny', text: fill(PROMPTS.inboxOwnMissing, { id: 'be' }) }

    expect(outcomes).toEqual([missing, missing])
    expect(outcomes[0]?.text).toContain('/cadre start be')
    expect([host.calls, host.writes]).toEqual([[], []])
  })

  test('with its folder a link, or its inbox a link or a folder, both refuse as unsafe and read nothing', async () => {
    const own = { [BE_INBOX]: recordLine(toBe) }
    const worlds = [
      memWorld({ now: 2000, dirs: { [BE_FOLDER]: [] }, files: own, realPaths: { [BE_FOLDER]: '/elsewhere/be' } }),
      memWorld({ now: 2000, dirs: { [BE_FOLDER]: [] }, files: own, realPaths: { [BE_INBOX]: '/elsewhere/inbox' } }),
      memWorld({ now: 2000, dirs: { [BE_FOLDER]: [], [BE_INBOX]: [] } }),
    ]
    for (const world of worlds) {
      const { outcomes, reads, host } = await readAndMark(world)
      const unsafe = { kind: 'deny', text: fill(PROMPTS.inboxOwnUnsafe, { id: 'be' }) }

      expect(outcomes).toEqual([unsafe, unsafe])
      expect([reads, host.calls, host.writes]).toEqual([[], [], []])
    }
  })
})
