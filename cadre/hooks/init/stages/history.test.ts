import { describe, expect, test } from 'claude-code/testing'

import type { PortEntry } from '../../../types'
import { proposeRoles } from '../../roles/propose'
import type { HistoryScan } from '../../scan/history'
import {
  DEFAULT_LOCATIONS,
  EMPTY_FACTS,
  emptySetupScan,
  entry,
  memIo,
  memWorld,
  repoScan,
  stateAt,
} from '../../testkit'
import type { MemWorld } from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import type { Draft } from '../draft'
import { historyHints } from '../flow'
import { nextStage } from '../machine'
import type { Answer } from '../state'
import {
  HISTORY_DISMISSED_REASON,
  HISTORY_OPTIONS,
  historyLines,
  historyQuestion,
  historyStage,
  historyStep,
  NO_HISTORY_NOTE,
  UNLISTED_HISTORY_NOTE,
} from './history'

/** The session folder of the fixture repo /repo for the fixture user /home/u. */
const DIR = '/home/u/.claude/projects/-repo'

/** The refusal on top of the history question when it is asked again after the answer `maybe` (D-136). */
const MAYBE_REFUSAL = `'maybe' isn't one of: "No, skip it", "Yes, scan names and counts".`

/** The context line init gives the history question on a repo where the scan found nothing (D-136). */
const SCAN_CONTEXT = 'Scan: stack none; frontend none; backend none; tests none; E2E none.'

/** The history question for `total` sessions as historyStep asks it: SCAN_CONTEXT on its second line (D-136). */
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

describe('consent declines first (G-02-11)', () => {
  test('the history question lists No, skip it first, so a quick Submit declines; the labels are unchanged', () => {
    expect(HISTORY_OPTIONS[0]).toBe('No, skip it')
    expect([...HISTORY_OPTIONS].sort()).toEqual(['No, skip it', 'Yes, scan names and counts'])
  })

  test('option 0 of the history question declines and reads no transcript (T-02-51)', async () => {
    const [first = ''] = HISTORY_OPTIONS
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), [first])
    expect(await historyStep(run.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)).toEqual({ kind: 'accepted', value: 'skipped' })
    expect(run.asked).toEqual([historyAsked(1)])
    expect([run.reads, run.shown, run.logged]).toEqual([[], [], []])
  })

  test('option 1 of the history question consents and reads the transcript', async () => {
    const [, second = ''] = HISTORY_OPTIONS
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), [second])
    const result = await historyStep(run.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)
    expect([result.kind, result.kind === 'accepted' && result.value !== 'skipped']).toEqual(['accepted', true])
    expect(run.reads).toEqual([`${DIR}/a.jsonl`])
  })
})

describe('refusal re-ask (G-02-6b)', () => {
  test('an answer the history question cannot read is asked again with why on top, then counts', async () => {
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), ['maybe', 'No, skip it'])
    expect(await historyStep(run.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)).toEqual({ kind: 'accepted', value: 'skipped' })
    expect(run.asked).toEqual([historyAsked(1), `${MAYBE_REFUSAL}\n${historyAsked(1)}`])
    expect([run.reads, run.logged]).toEqual([[], []])
  })

  test('three answers it cannot read cancel with no usable answer; no transcript is read (A1, D-136)', async () => {
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), ['maybe', 'maybe', 'maybe', 'Yes, scan names and counts'])
    const exhausted = { kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON }
    expect(await historyStep(run.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)).toEqual(exhausted)
    expect(run.asked).toHaveLength(3)
    expect([run.reads, run.shown, run.logged]).toEqual([[], [], []])
  })

  test('Esc after a refused answer still cancels with the dismissed reason of the history question', async () => {
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), ['maybe'])
    const dismissed = { kind: 'cancelled', reason: HISTORY_DISMISSED_REASON }
    expect(await historyStep(run.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)).toEqual(dismissed)
    expect(run.asked).toHaveLength(2)
    expect(run.reads).toEqual([])
  })
})

/**
 * What the history step reads today when CLAUDE_CONFIG_DIR is relative or inside the repo (A8): the value is the user
 * folder as given, so the session folder below it is listed and its transcripts are read there, with no warning. D-238
 * makes such a value warn and fall back to ~/.claude in one behaviour commit, which changes these specs.
 */
describe('safety net: unsafe CLAUDE_CONFIG_DIR today (A8, D-238 later)', () => {
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

  test('a relative value: the session folder below it is listed and read as given, with no warning', async () => {
    const dir = '.claude-alt/projects/-repo'
    const world = memWorld({ dirs: { [dir]: [transcript('a.jsonl', 1)] }, files: { [`${dir}/a.jsonl`]: EXAMPLE } })
    const run = memIo(world, ['Yes, scan names and counts'])
    const result = await historyStep(run.io, { ...DEFAULT_LOCATIONS, configDir: '.claude-alt' }, SCAN_CONTEXT)
    expect([run.listed, run.reads, run.asked, run.logged]).toEqual([[dir], [`${dir}/a.jsonl`], [historyAsked(1)], []])
    expect(result).toEqual({ kind: 'accepted', value: scanned })
  })

  test('an inside-repo value: the session folder below it is listed and read as given, with no warning', async () => {
    const dir = '/repo/.claude-alt/projects/-repo'
    const world = memWorld({ dirs: { [dir]: [transcript('a.jsonl', 1)] }, files: { [`${dir}/a.jsonl`]: EXAMPLE } })
    const run = memIo(world, ['Yes, scan names and counts'])
    const result = await historyStep(run.io, { ...DEFAULT_LOCATIONS, configDir: '/repo/.claude-alt' }, SCAN_CONTEXT)
    expect([run.listed, run.reads, run.asked, run.logged]).toEqual([[dir], [`${dir}/a.jsonl`], [historyAsked(1)], []])
    expect(result).toEqual({ kind: 'accepted', value: scanned })
  })
})

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
    const state = historyStage.enter(stateAt('history', HISTORY_DRAFT))
    expect(state.effect).toEqual({ kind: 'io', call: { id: 'list-sessions', dir: DIR } })
    expect(state.openQuestion).toBeNull()
    const asking = nextStage(state, listed(ONE_SESSION))
    const ask = { question: historyAsked(1), spec: { options: HISTORY_OPTIONS, header: 'History' } }
    expect(asking.effect).toEqual({ kind: 'ask', ...ask })
    expect(asking.openQuestion).toEqual(ask)
  })

  test('with no user folder, no transcript or a folder it cannot list, it logs why and asks nothing', () => {
    const noUser = { ...HISTORY_DRAFT, locations: { ...DEFAULT_LOCATIONS, home: null } }
    const skipped = historyStage.enter(stateAt('history', noUser))
    expect([skipped.sub, skipped.outputs, skipped.draft.hints]).toEqual([
      { kind: 'done' },
      [{ kind: 'log', text: NO_HISTORY_NOTE }],
      new Map(),
    ])
    const state = historyStage.enter(stateAt('history', HISTORY_DRAFT))
    const cases: readonly (readonly [readonly PortEntry[] | null, string])[] = [
      [null, UNLISTED_HISTORY_NOTE],
      [[], NO_HISTORY_NOTE],
    ]
    for (const [sessions, note] of cases) {
      const next = nextStage(state, listed(sessions))
      expect([next.stage, next.outputs, next.draft.hints]).toEqual(['team', [{ kind: 'log', text: note }], new Map()])
    }
  })

  test('Yes scans the listed sessions as an io effect, shows the history block and keeps the names as hints', () => {
    const asking = nextStage(historyStage.enter(stateAt('history', HISTORY_DRAFT)), listed(ONE_SESSION))
    const scanning = nextStage(asking, { kind: 'answer', text: 'Yes, scan names and counts' })
    expect(scanning.effect).toEqual({ kind: 'io', call: { id: 'scan-history', dir: DIR, sessions: ONE_SESSION } })
    const done = nextStage(scanning, { kind: 'io', result: { id: 'scan-history', result: EXAMPLE_SCAN } })
    expect(done.stage).toBe('team')
    expect(done.outputs).toEqual([{ kind: 'show', block: { key: 'history', lines: historyLines(EXAMPLE_SCAN) } }])
    expect(done.draft.hints).toEqual(historyHints(EXAMPLE_SCAN))
  })
})
