import { describe, expect, test } from 'claude-code/testing'

import type { PortEntry } from '../types'
import { HISTORY_DISMISSED_REASON, HISTORY_OPTIONS, historyQuestion, historyStep } from './history'
import type { HistoryScan } from './scan/history'
import { DEFAULT_LOCATIONS, entry, memIo, memWorld } from './testkit'
import type { MemWorld } from './testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from './ui/ask'

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
