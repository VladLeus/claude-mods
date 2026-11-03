import { describe, expect, test } from 'claude-code/testing'

import type { InitIo, InitLocations, PortEntry } from '../../../types'
import { PANE_LIST_WORDS } from '../../locales/t'
import { proposeRoles } from '../../roles/propose'
import { listSessions, scanHistory } from '../../scan/history'
import type { HistoryScan } from '../../scan/history'
import {
  DEFAULT_LOCATIONS,
  drivenWith,
  EMPTY_FACTS,
  emptySetupScan,
  entry,
  leaks,
  memIo,
  memWorld,
  repoScan,
  stateAt,
} from '../../testkit'
import type { MemWorld } from '../../testkit'
import { NO_USABLE_ANSWER_REASON, PANE_TITLES, withContext } from '../../ui/ask'
import { scanSummaryLines } from '../../ui/blocks/scan'
import type { Draft } from '../draft'
import { nextStage } from '../machine'
import { cancelledReply } from '../replies'
import type { Answer, InitState, IoCall, IoResult } from '../state'
import {
  HISTORY_DISMISSED_REASON,
  HISTORY_OPTIONS,
  historyHints,
  historyLines,
  historyQuestion,
  historyStage,
  NO_HISTORY_NOTE,
  UNLISTED_HISTORY_NOTE,
} from './history'

/** The session folder of the fixture repo /repo for the fixture user /home/u. */
const DIR = '/home/u/.claude/projects/-repo'

/** The refusal on top of the history question when it is asked again after the answer `maybe` (D-136). */
const MAYBE_REFUSAL = `'maybe' isn't one of: "No, skip it", "Yes, scan names and counts".`

/** The context line init gives the history question on a repo where the scan found nothing (D-136). */
const SCAN_CONTEXT = 'Scan: stack none; frontend none; backend none; tests none; E2E none.'

/** The history question for `total` sessions as historyStage asks it: SCAN_CONTEXT on its second line (D-136). */
function historyAsked(total: number): string {
  return withContext(historyQuestion(total), SCAN_CONTEXT)
}

/**
 * A transcript line that is the person's own slash command, as Claude Code writes it (IN-04): a user message whose
 * string content is `content`.
 */
function commandLine(content: string): string {
  return `{"type":"user","message":{"role":"user","content":"${content}"}}`
}

/** The transcript of the plan's example: two kept commands, one Skill call and a command name that is dropped. */
const EXAMPLE = [
  commandLine('<command-name>/gsd-plan-phase</command-name>'),
  '{"type":"tool_use","name":"Skill","input":{"skill":"superpowers:brainstorming"}}',
  commandLine('<command-name>cadre</command-name>'),
  commandLine('<command-name>/Bad Name!</command-name>'),
].join('\n')

/** A session transcript as the host lists it: a regular `.jsonl` file with this mtime and listed size. */
function transcript(name: string, mtimeMs: number, size = 0): PortEntry {
  return { ...entry(name), mtimeMs, size }
}

/**
 * A world whose session folder lists these transcripts, the first one newest, with each text under the folder. `over`
 * changes the fields it names.
 */
function historyWorld(texts: Readonly<Record<string, string>>, over: Partial<MemWorld> = {}): MemWorld {
  const names = Object.keys(texts)
  const files = Object.entries(texts).map(([name, text]) => [`${DIR}/${name}`, text])

  return memWorld({
    dirs: { [DIR]: names.map((name, at) => transcript(name, names.length - at)) },
    files: Object.fromEntries(files),
    ...over,
  })
}

/** The heading every history block starts with. */
const HEADING = 'Session history (names and counts only):'

/** A scan that read no session and found no name; `over` changes the fields it names. */
function scanOf(over: Partial<HistoryScan> = {}): HistoryScan {
  return { counts: [], scanned: 0, total: 0, skippedLarge: 0, skippedUnknown: 0, isPartial: false, ...over }
}

/**
 * What the history stage is entered with: the fixture session, a scan that found nothing (SCAN_CONTEXT) and the parts
 * of the base the role steps after it read.
 */
const HISTORY_DRAFT: Partial<Draft> = {
  locations: DEFAULT_LOCATIONS,
  gathered: { facts: { facts: EMPTY_FACTS, gsdUserDir: null }, repo: repoScan(), setup: emptySetupScan() },
  readUserMcp: false,
  installed: ['none'],
  choice: { kind: 'none' },
  proposal: proposeRoles(repoScan()),
}

/** The history stage entered for a session at `locations`: its listing of the session folder out. */
function historyAt(locations: InitLocations = DEFAULT_LOCATIONS): InitState {
  return historyStage.enter(stateAt('history', { ...HISTORY_DRAFT, locations }))
}

/**
 * The history question's own context (D-236): the scan block of an empty repo and setup, with no warning; a pane
 * surface asks the question for `total` sessions with its first line in place of SCAN_CONTEXT (D-255).
 */
function scanAskContext(total: number): unknown {
  const lines = scanSummaryLines(repoScan(), emptySetupScan(), '/repo', PANE_LIST_WORDS)
  const pane = { asked: historyAsked(total), text: withContext(historyQuestion(total), lines[0] ?? '') }

  return { title: 'Scan', lines, kind: 'scan', pane }
}

/** The history stage's host operations as init/run performs them, through `io` (listSessions, scanHistory). */
function historyCalls(io: InitIo): (call: IoCall) => Promise<IoResult> {
  return async call => {
    if (call.id === 'list-sessions') return { id: 'list-sessions', result: await listSessions(io, call.dir) }
    if (call.id !== 'scan-history') throw new Error(`the history stage does not set ${call.id}`)

    return { id: 'scan-history', result: await scanHistory(io, call.dir, call.sessions) }
  }
}

describe('consent declines first (G-02-11)', () => {
  test('the history question lists No, skip it first, so a quick Submit declines; the labels are unchanged', () => {
    expect(HISTORY_OPTIONS[0]).toBe('No, skip it')
    expect([...HISTORY_OPTIONS].sort()).toEqual(['No, skip it', 'Yes, scan names and counts'])
  })

  test('option 0 of the history question declines and reads no transcript (T-02-51)', async () => {
    const [first = ''] = HISTORY_OPTIONS
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), [])
    const drive = await drivenWith(historyAt(), [first], historyCalls(run.io))
    expect(drive.state.draft.hints).toEqual(new Map())
    expect(drive.asked).toEqual([historyAsked(1)])
    expect([run.reads, drive.outputs]).toEqual([[], []])
  })

  test('option 1 of the history question consents and reads the transcript', async () => {
    const [, second = ''] = HISTORY_OPTIONS
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), [])
    const drive = await drivenWith(historyAt(), [second], historyCalls(run.io))
    expect(drive.state.draft.hints?.size).toBeGreaterThan(0)
    expect(run.reads).toEqual([`${DIR}/a.jsonl`])
  })
})

describe('refusal re-ask (G-02-6b)', () => {
  test('an answer the history question cannot read is asked again with why on top, then counts', async () => {
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), [])
    const drive = await drivenWith(historyAt(), ['maybe', 'No, skip it'], historyCalls(run.io))
    expect(drive.state.draft.hints).toEqual(new Map())
    expect(drive.asked).toEqual([historyAsked(1), `${MAYBE_REFUSAL}\n${historyAsked(1)}`])
    expect([run.reads, drive.outputs]).toEqual([[], []])
  })

  test('three answers it cannot read cancel with no usable answer; no transcript is read (A1, D-136)', async () => {
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), [])
    const answers = ['maybe', 'maybe', 'maybe', 'Yes, scan names and counts']
    const drive = await drivenWith(historyAt(), answers, historyCalls(run.io))
    expect(drive.state.effect).toEqual({ kind: 'end', reply: cancelledReply(NO_USABLE_ANSWER_REASON) })
    expect(drive.asked).toHaveLength(3)
    expect([run.reads, drive.outputs]).toEqual([[], [{ kind: 'log', text: NO_USABLE_ANSWER_REASON }]])
  })

  test('Esc after a refused answer still cancels with the dismissed reason of the history question', async () => {
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), [])
    const drive = await drivenWith(historyAt(), ['maybe'], historyCalls(run.io))
    expect(drive.state.effect).toEqual({ kind: 'end', reply: cancelledReply(HISTORY_DISMISSED_REASON) })
    expect(drive.asked).toHaveLength(2)
    expect(run.reads).toEqual([])
  })
})

/**
 * What the history step reads when CLAUDE_CONFIG_DIR is relative or inside the repo (D-238): the value is ignored, so
 * the session folder below <home>/.claude is listed and read. The stage logs no warning of its own: the scan warnings
 * before it already name the ignored value.
 */
describe('unsafe CLAUDE_CONFIG_DIR (D-238)', () => {
  /** The scan of one EXAMPLE transcript: its three kept names, once each. */
  const scanned: HistoryScan = {
    counts: [
      { name: 'cadre', count: 1 },
      { name: 'gsd-plan-phase', count: 1 },
      { name: 'superpowers:brainstorming', count: 1 },
    ],
    scanned: 1,
    total: 1,
    skippedLarge: 0,
    skippedUnknown: 0,
    isPartial: false,
  }

  test('a relative value: the session folder below <home>/.claude is listed and read', async () => {
    const dir = DIR
    const world = memWorld({ dirs: { [dir]: [transcript('a.jsonl', 1)] }, files: { [`${dir}/a.jsonl`]: EXAMPLE } })
    const run = memIo(world, [])
    const at = historyAt({ ...DEFAULT_LOCATIONS, configDir: '.claude-alt' })
    const drive = await drivenWith(at, ['Yes, scan names and counts'], historyCalls(run.io))
    const logged = drive.outputs.filter(output => output.kind === 'log')
    expect([run.listed, run.reads, drive.asked, logged]).toEqual([[dir], [`${dir}/a.jsonl`], [historyAsked(1)], []])
    expect(drive.state.draft.hints).toEqual(historyHints(scanned))
  })

  test('an inside-repo value: the session folder below <home>/.claude is listed and read', async () => {
    const dir = DIR
    const world = memWorld({ dirs: { [dir]: [transcript('a.jsonl', 1)] }, files: { [`${dir}/a.jsonl`]: EXAMPLE } })
    const run = memIo(world, [])
    const at = historyAt({ ...DEFAULT_LOCATIONS, configDir: '/repo/.claude-alt' })
    const drive = await drivenWith(at, ['Yes, scan names and counts'], historyCalls(run.io))
    const logged = drive.outputs.filter(output => output.kind === 'log')
    expect([run.listed, run.reads, drive.asked, logged]).toEqual([[dir], [`${dir}/a.jsonl`], [historyAsked(1)], []])
    expect(drive.state.draft.hints).toEqual(historyHints(scanned))
  })
})

describe('history scan', () => {
  test('historyStage: with no session folder, or no .jsonl in it, it logs the note and asks nothing', async () => {
    const empty = memWorld({ dirs: { [DIR]: [entry('notes.txt'), entry('sub', 'dir')] } })
    for (const world of [memWorld({}), empty]) {
      const run = memIo(world, [])
      const drive = await drivenWith(historyAt(), ['Yes, scan names and counts'], historyCalls(run.io))
      expect(drive.state.draft.hints).toEqual(new Map())
      expect(drive.asked).toEqual([])
      expect(drive.outputs).toEqual([{ kind: 'log', text: NO_HISTORY_NOTE }])
      expect(run.reads.filter(path => path.endsWith('.jsonl'))).toEqual([])
    }
  })

  test('historyStage: a session folder it cannot list gets its own note; nothing is asked or read (Q3)', async () => {
    const run = memIo(memWorld({ unknownPaths: [DIR] }), [])
    const drive = await drivenWith(historyAt(), ['Yes, scan names and counts'], historyCalls(run.io))
    expect(drive.state.draft.hints).toEqual(new Map())
    expect(drive.asked).toEqual([])
    expect(drive.outputs).toEqual([{ kind: 'log', text: UNLISTED_HISTORY_NOTE }])
    expect(run.reads.filter(path => path.endsWith('.jsonl'))).toEqual([])
  })

  test('historyStage: with sessions it asks first, and No, skip it reads no transcript and shows nothing', async () => {
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE, 'b.jsonl': EXAMPLE }), [])
    const drive = await drivenWith(historyAt(), ['No, skip it'], historyCalls(run.io))
    expect(drive.state.draft.hints).toEqual(new Map())
    expect(drive.asked).toEqual([historyAsked(2)])
    expect(drive.specs).toEqual([{ options: HISTORY_OPTIONS, header: 'History', context: scanAskContext(2) }])
    expect(run.reads).toEqual([])
    expect(drive.outputs).toEqual([])
  })

  test('historyStage: Yes, scan names and counts reads the sessions newest first, shows the lines once', async () => {
    const world = historyWorld({ 'a.jsonl': EXAMPLE, 'b.jsonl': commandLine('<command-name>/cadre</command-name>') })
    const run = memIo(world, [])
    const scan = scanOf({
      counts: [
        { name: 'cadre', count: 2 },
        { name: 'gsd-plan-phase', count: 1 },
        { name: 'superpowers:brainstorming', count: 1 },
      ],
      scanned: 2,
      total: 2,
    })
    const drive = await drivenWith(historyAt(), ['Yes, scan names and counts'], historyCalls(run.io))
    expect(drive.state.draft.hints).toEqual(historyHints(scan))
    expect(run.reads).toEqual([`${DIR}/a.jsonl`, `${DIR}/b.jsonl`])
    expect(drive.outputs).toEqual([{ kind: 'show', block: { key: 'history', lines: historyLines(scan) } }])
    expect(historyLines(scan)).toEqual([
      HEADING,
      '  cadre  2',
      '  gsd-plan-phase  1',
      '  superpowers:brainstorming  1',
    ])
  })

  test('historyStage: a Yes run shows one Session history block in the pane and logs no block (D-133)', async () => {
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), [])
    const drive = await drivenWith(historyAt(), ['Yes, scan names and counts'], historyCalls(run.io))
    const scan = await scanHistory(memIo(historyWorld({ 'a.jsonl': EXAMPLE }), []).io, DIR, [transcript('a.jsonl', 1)])
    expect(drive.outputs).toEqual([{ kind: 'show', block: { key: 'history', lines: historyLines(scan) } }])
    expect(PANE_TITLES.history).toBe('Session history')
    expect(drive.outputs.filter(output => output.kind === 'log' && output.text.includes('\n'))).toEqual([])
  })

  test('historyStage: a typed yes counts in any case; an unknown answer is asked again, 3 asks in all', async () => {
    const typed = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), [])
    const yes = await drivenWith(historyAt(), [' YES, scan names and counts '], historyCalls(typed.io))
    expect(yes.state.stage).toBe('roles')
    expect(yes.state.draft.hints?.size).toBeGreaterThan(0)
    const unread = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), [])
    const drive = await drivenWith(historyAt(), ['maybe', 'maybe', 'maybe'], historyCalls(unread.io))
    expect(drive.state.effect).toEqual({ kind: 'end', reply: cancelledReply(NO_USABLE_ANSWER_REASON) })
    const again = `${MAYBE_REFUSAL}\n${historyAsked(1)}`
    expect(drive.asked).toEqual([historyAsked(1), again, again])
    expect(unread.reads).toEqual([])
  })

  test('historyStage: a dismissed question cancels with its reason, and nothing is read or logged (A1)', async () => {
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), [])
    const drive = await drivenWith(historyAt(), [], historyCalls(run.io))
    expect(drive.state.effect).toEqual({ kind: 'end', reply: cancelledReply(HISTORY_DISMISSED_REASON) })
    expect(drive.asked).toEqual([historyAsked(1)])
    expect(run.reads).toEqual([])
    expect(drive.outputs).toEqual([{ kind: 'log', text: HISTORY_DISMISSED_REASON }])
  })

  test('historyStage: the user folder is CLAUDE_CONFIG_DIR when set; with no user folder there is none', async () => {
    const cfg = '/cfg/projects/-repo'
    const world = memWorld({ dirs: { [cfg]: [transcript('a.jsonl', 1)] }, files: { [`${cfg}/a.jsonl`]: EXAMPLE } })
    const run = memIo(world, [])
    const at = historyAt({ ...DEFAULT_LOCATIONS, configDir: '/cfg' })
    const drive = await drivenWith(at, ['No, skip it'], historyCalls(run.io))
    expect(run.listed).toEqual([cfg])
    expect(drive.asked).toEqual([historyAsked(1)])
    const none = memIo(memWorld({}), [])
    const homeless = { ...DEFAULT_LOCATIONS, home: null, givenHome: null }
    const skipped = await drivenWith(historyAt(homeless), [], historyCalls(none.io))
    expect(skipped.state.draft.hints).toEqual(new Map())
    expect(none.listed).toEqual([])
    expect(skipped.outputs).toEqual([{ kind: 'log', text: NO_HISTORY_NOTE }])
  })

  test('historyStage: the session folder is the one of the repo root as resolved', async () => {
    const locations = { ...DEFAULT_LOCATIONS, root: '/real/repo', givenRoot: '/link/repo' }
    const run = memIo(memWorld({}), [])
    await drivenWith(historyAt(locations), [], historyCalls(run.io))
    expect(run.listed).toEqual(['/home/u/.claude/projects/-real-repo'])
  })

  test('no transcript text, path, argument or file name reaches the scan, log or pane (SCAN-03, T-02-41)', async () => {
    const transcriptText = [
      commandLine(
        '<command-name>/gsd-plan-phase</command-name><command-args>SENTINEL_SECRET_VALUE /home/u/x</command-args>',
      ),
      '{"type":"user","message":{"content":"my key is SENTINEL_SECRET_VALUE in /home/u/.env"}}',
      '{"type":"tool_use","name":"Skill","input":{"skill":"codex:rescue","args":"SENTINEL_SECRET_VALUE /home/u"}}',
    ].join('\n')
    const world = historyWorld({ 'SENTINEL_SECRET_VALUE.jsonl': transcriptText })
    const held = JSON.stringify([world.dirs, world.files])
    expect(leaks(held, ['SENTINEL_SECRET_VALUE', '/home/u'])).toEqual(['SENTINEL_SECRET_VALUE', '/home/u'])
    const run = memIo(world, [])
    const drive = await drivenWith(historyAt(), ['Yes, scan names and counts'], historyCalls(run.io))
    const blocks = drive.outputs.flatMap(output => (output.kind === 'show' ? [output.block] : []))
    const pane = blocks.flatMap(block => [PANE_TITLES[block.key], ...block.lines]).join('\n')
    expect(pane).toContain('  gsd-plan-phase  1')
    expect(pane).toContain('  codex:rescue  1')
    const logged = drive.outputs.flatMap(output => (output.kind === 'log' ? [output.text] : []))
    const hints = Array.from(drive.state.draft.hints ?? new Map<string, number>())
    const shown = [JSON.stringify(hints), ...logged, pane].join('\n')
    expect(leaks(shown, ['SENTINEL_SECRET_VALUE', '/home/u'])).toEqual([])
  })
})

/** The listing of the fixture session folder with one transcript, as the list-sessions io call gives it. */
const ONE_SESSION: readonly PortEntry[] = [transcript('a.jsonl', 1)]

/** The answer to the list-sessions io call: these sessions, or null when the folder cannot be listed. */
function listed(sessions: readonly PortEntry[] | null): Answer {
  const result = sessions === null ? null : { sessions, total: sessions.length }

  return { kind: 'io', result: { id: 'list-sessions', result } }
}

/** The scan of one EXAMPLE transcript, as the scan-history io call gives it. */
const EXAMPLE_SCAN: HistoryScan = {
  counts: [
    { name: 'cadre', count: 1 },
    { name: 'gsd-plan-phase', count: 1 },
    { name: 'superpowers:brainstorming', count: 1 },
  ],
  scanned: 1,
  total: 1,
  skippedLarge: 0,
  skippedUnknown: 0,
  isPartial: false,
}

describe('the history stage (D-230)', () => {
  test('historyStage lists the session folder as an io effect, then asks with the scan context line', () => {
    const state = historyAt()
    expect(state.effect).toEqual({ kind: 'io', call: { id: 'list-sessions', dir: DIR } })
    expect(state.openQuestion).toBeNull()
    const asking = nextStage(state, listed(ONE_SESSION))
    const spec = { options: HISTORY_OPTIONS, header: 'History', context: scanAskContext(1) }
    const ask = { question: historyAsked(1), spec }
    expect(asking.effect).toEqual({ kind: 'ask', ...ask })
    expect(asking.openQuestion).toEqual(ask)
  })

  test('the history question carries the scan summary with the scan warnings as its own context (D-236)', () => {
    const repo = repoScan({ warnings: ['could not list src'] })
    const gathered = { facts: { facts: EMPTY_FACTS, gsdUserDir: null }, repo, setup: emptySetupScan() }
    const state = historyStage.enter(stateAt('history', { ...HISTORY_DRAFT, gathered }))
    const lines = [...scanSummaryLines(repo, emptySetupScan(), '/repo', PANE_LIST_WORDS), 'warning: could not list src']
    const asking = nextStage(state, listed(ONE_SESSION))
    const pane = { asked: historyAsked(1), text: withContext(historyQuestion(1), lines[0] ?? '') }
    expect(asking.openQuestion?.spec.context).toEqual({ title: 'Scan', lines, kind: 'scan', pane })
  })

  test('with no user folder, no transcript or a folder it cannot list, it logs why and asks nothing', () => {
    const skipped = historyAt({ ...DEFAULT_LOCATIONS, home: null })
    expect([skipped.sub, skipped.outputs, skipped.draft.hints]).toEqual([
      { kind: 'done' },
      [{ kind: 'log', text: NO_HISTORY_NOTE }],
      new Map(),
    ])
    const state = historyAt()
    const cases: readonly (readonly [readonly PortEntry[] | null, string])[] = [
      [null, UNLISTED_HISTORY_NOTE],
      [[], NO_HISTORY_NOTE],
    ]
    for (const [sessions, note] of cases) {
      const next = nextStage(state, listed(sessions))
      expect([next.stage, next.outputs[0], next.draft.hints]).toEqual(['roles', { kind: 'log', text: note }, new Map()])
    }
  })

  test('Yes scans the listed sessions as an io effect, shows the history block and keeps the names as hints', () => {
    const asking = nextStage(historyAt(), listed(ONE_SESSION))
    const scanning = nextStage(asking, { kind: 'answer', text: 'Yes, scan names and counts' })
    expect(scanning.effect).toEqual({ kind: 'io', call: { id: 'scan-history', dir: DIR, sessions: ONE_SESSION } })
    const done = nextStage(scanning, { kind: 'io', result: { id: 'scan-history', result: EXAMPLE_SCAN } })
    expect(done.stage).toBe('roles')
    expect(done.outputs[0]).toEqual({ kind: 'show', block: { key: 'history', lines: historyLines(EXAMPLE_SCAN) } })
    expect(done.draft.hints).toEqual(historyHints(EXAMPLE_SCAN))
  })
})
