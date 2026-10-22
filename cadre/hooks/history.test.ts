import { describe, expect, test } from 'claude-code/testing'

import type { PortEntry } from '../types'
import { NO_USABLE_ANSWER_REASON, PANE_TITLES, withContext } from './ask'
import { HISTORY_MAX_SESSIONS } from './assign'
import {
  countNames,
  HISTORY_DISMISSED_REASON,
  HISTORY_MAX_FILE_BYTES,
  HISTORY_MAX_TOTAL_BYTES,
  HISTORY_NAME_PATTERN,
  HISTORY_OPTIONS,
  historyDir,
  historyLines,
  historyQuestion,
  historyStep,
  listSessions,
  NO_HISTORY_NOTE,
  scanHistory,
  UNLISTED_HISTORY_NOTE,
} from './history'
import type { HistoryScan } from './history'
import { DEFAULT_LOCATIONS, entry, leaks, memIo, memWorld } from './testkit'
import type { MemWorld } from './testkit'

/** The session folder of the fixture repo /repo for the fixture user /home/u. */
const DIR = '/home/u/.claude/projects/-repo'

/** The heading every history block starts with. */
const HEADING = 'Session history (names and counts only):'

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

/** A scan that read no session and found no name; `over` changes the fields it names. */
function scanOf(over: Partial<HistoryScan> = {}): HistoryScan {
  return { counts: [], scanned: 0, total: 0, skippedLarge: 0, skippedUnknown: 0, isPartial: false, ...over }
}

/** The counts of a transcript as a plain object, so a test compares them whatever their order. */
function countsOf(text: string): Record<string, number> {
  return Object.fromEntries(countNames(text))
}

/**
 * One Skill tool call as Claude Code 2.1.303 writes it: one assistant line that holds the input twice, once in the
 * tool_use block and once in `wireToolInputs` under the call's id (WR-01).
 */
function skillCallLine(skill: string, id: string): string {
  const input = `{"skill":"${skill}","args":"--fast"}`

  return (
    `{"message":{"role":"assistant","content":[{"type":"tool_use","id":"${id}","name":"Skill","input":${input},` +
    `"caller":{"type":"direct"}}]},"wireToolInputs":{"${id}":${input}},"type":"assistant"}`
  )
}

describe('history scan', () => {
  test('historyDir is the projects folder of the mangled repo path under the user folder', () => {
    expect(historyDir('/home/u/.claude', '/repo')).toBe('/home/u/.claude/projects/-repo')
    expect(historyDir('/cfg', '/Users/v/code/claude-mods')).toBe('/cfg/projects/-Users-v-code-claude-mods')
  })

  test('the caps are 50 sessions, 4 MiB a file and 64 MiB in all; a kept name is lowercase ASCII', () => {
    expect(HISTORY_MAX_SESSIONS).toBe(50)
    expect(HISTORY_MAX_FILE_BYTES).toBe(4 * 1024 * 1024)
    expect(HISTORY_MAX_TOTAL_BYTES).toBe(64 * 1024 * 1024)
    expect(HISTORY_NAME_PATTERN.source).toBe('^[a-z0-9][a-z0-9:_.@-]{0,99}$')
  })

  test('the question names the session count, and the 50 read only above 50; answers fixed, No first (IN-03)', () => {
    expect(historyQuestion(12)).toBe(
      "Scan this repo's session history (12 sessions) for frequently used commands and skills? " +
        'Only names and counts are kept.',
    )
    expect(historyQuestion(51)).toBe(
      "Scan this repo's session history (51 sessions; the newest 50 are read) for frequently used commands and " +
        'skills? Only names and counts are kept.',
    )
    expect(historyQuestion(50)).not.toContain('newest')
    expect(HISTORY_OPTIONS).toEqual(['No, skip it', 'Yes, scan names and counts'])
    expect(Object.isFrozen(HISTORY_OPTIONS)).toBe(true)
    expect(HISTORY_DISMISSED_REASON).toBe('The session history question was dismissed or not answered.')
    expect(NO_HISTORY_NOTE).toBe('No session history for this repo.')
    expect(UNLISTED_HISTORY_NOTE).toBe("Could not list this repo's session history, so it was not scanned.")
  })

  test('listSessions keeps .jsonl files newest first, ties by name; never a folder, link or other name', async () => {
    const entries = [
      transcript('old.jsonl', 1),
      transcript('new.jsonl', 3),
      transcript('b-mid.jsonl', 2),
      transcript('a-mid.jsonl', 2),
      { ...entry('folder.jsonl', 'dir'), mtimeMs: 9 },
      { ...entry('link.jsonl', 'other', true), mtimeMs: 9 },
      transcript('notes.txt', 9),
      transcript('a.jsonl.bak', 9),
    ]
    const listed = await listSessions(memIo(memWorld({ dirs: { [DIR]: entries } }), {}).io, DIR)
    expect(listed).toEqual({
      sessions: [
        transcript('new.jsonl', 3),
        transcript('a-mid.jsonl', 2),
        transcript('b-mid.jsonl', 2),
        transcript('old.jsonl', 1),
      ],
      total: 4,
    })
  })

  test('listSessions keeps the newest 50 and counts every session', async () => {
    const many = Array.from({ length: 60 }, (_, at) => transcript(`s${String(at).padStart(2, '0')}.jsonl`, at))
    const listed = await listSessions(memIo(memWorld({ dirs: { [DIR]: many } }), {}).io, DIR)
    expect(listed?.total).toBe(60)
    expect(listed?.sessions.map(session => session.name)).toEqual(
      many
        .slice(10)
        .reverse()
        .map(session => session.name),
    )
  })

  test('listSessions gives null for a folder it cannot list, and no sessions for one that is not there', async () => {
    expect(await listSessions(memIo(memWorld({ unknownPaths: [DIR] }), {}).io, DIR)).toBeNull()
    expect(await listSessions(memIo(memWorld({}), {}).io, DIR)).toEqual({ sessions: [], total: 0 })
  })

  test('countNames keeps the slash commands and Skill calls of the example with counts, and nothing else', () => {
    expect(countsOf(EXAMPLE)).toEqual({ 'gsd-plan-phase': 1, 'superpowers:brainstorming': 1, cadre: 1 })
  })

  test('a name is matched as ASCII after lowercasing; any other character drops it; each exact name counts', () => {
    const text = [
      '<command-name>/GSD-Plan-Phase</command-name>',
      '<command-name>/gsd-plan-phase</command-name><command-name>/gsd-plan</command-name>',
      '<command-name>/caf\u00e9</command-name>',
      '<command-name>/\u212Aelvin</command-name>',
      '<command-name>//twice</command-name>',
      '<command-name>/-dash-first</command-name>',
      '<command-name></command-name>',
      `<command-name>/${'a'.repeat(100)}</command-name>`,
      `<command-name>/${'b'.repeat(101)}</command-name>`,
    ]
      .map(commandLine)
      .join('\n')
    expect(countsOf(text)).toEqual({ 'gsd-plan-phase': 2, 'gsd-plan': 1, ['a'.repeat(100)]: 1 })
  })

  test('a skill counts only on a line with a Skill tool call; quoted text in a message never counts', () => {
    const text = [
      '{"type":"tool_use","name":"Skill","input":{"skill":"codex:rescue"}}',
      '{"type":"tool_use","name":"Read","input":{"skill":"not-a-skill"}}',
      '{"type":"user","message":{"content":"say \\"name\\":\\"Skill\\" and \\"skill\\":\\"quoted\\""}}',
      '{"name":"Skill","input":{"skill":"codex:rescue"}},{"name":"Skill","input":{"skill":"Codex:Setup"}}',
    ].join('\n')
    expect(countsOf(text)).toEqual({ 'codex:rescue': 2, 'codex:setup': 1 })
  })

  test('a skill name with a dot and an at sign counts (IN-01)', () => {
    expect(countsOf(skillCallLine('plugin@market:skill.v2', 'toolu_01'))).toEqual({ 'plugin@market:skill.v2': 1 })
  })

  test("a command counts only from the person's own command line, never from a tool result or another line", () => {
    const marker = '<command-name>/gsd-quick</command-name>'
    const text = [
      commandLine(marker),
      commandLine(`<command-message>gsd-quick is running</command-message>\\n${marker}`),
      `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"${marker}"}]}}`,
      `{"type":"assistant","message":{"role":"assistant","content":"${marker}"}}`,
      '{"type":"system","subtype":"local_command","content":"<command-name>/autopilot</command-name>"}',
      commandLine(`see ${marker}`),
    ].join('\n')
    expect(countsOf(text)).toEqual({ 'gsd-quick': 2 })
  })

  test('a Skill call counts once when its line holds the name in input and in wireToolInputs (WR-01)', () => {
    expect(countsOf(skillCallLine('gsd-quick', 'toolu_01'))).toEqual({ 'gsd-quick': 1 })
  })

  test('two Skill call lines of one skill count 2, one for each line (WR-01)', () => {
    const text = [skillCallLine('gsd-quick', 'toolu_01'), skillCallLine('gsd-quick', 'toolu_02')].join('\n')
    expect(countsOf(text)).toEqual({ 'gsd-quick': 2 })
  })

  test('scanHistory counts the readable sessions and skips one over 4 MiB, with its note (Pitfall 9)', async () => {
    const cadre = commandLine('<command-name>/cadre</command-name>')
    const world = historyWorld({ 'a.jsonl': cadre, 'big.jsonl': 'x'.repeat(5 * 1024 * 1024), 'c.jsonl': cadre })
    const run = memIo(world, {})
    const listed = await listSessions(run.io, DIR)
    const scan = await scanHistory(run.io, DIR, listed?.sessions ?? [])
    expect(scan).toEqual({
      counts: [{ name: 'cadre', count: 2 }],
      scanned: 2,
      total: 3,
      skippedLarge: 1,
      skippedUnknown: 0,
      isPartial: false,
    })
    expect(historyLines(scan)).toContain('skipped 1 of 3 sessions over 4 MiB (the heaviest sessions are not counted)')
  })

  test('past 64 MiB in all the scan stops and is partial; the oldest sessions are not read (Pitfall 5)', async () => {
    const names = Array.from({ length: 17 }, (_, at) => `s${String(at).padStart(2, '0')}.jsonl`)
    const sessions = names.map((name, at) => transcript(name, 100 - at, HISTORY_MAX_FILE_BYTES))
    const cadre = commandLine('<command-name>/cadre</command-name>')
    const files = Object.fromEntries(names.map(name => [`${DIR}/${name}`, cadre]))
    const run = memIo(memWorld({ files }), {})
    const scan = await scanHistory(run.io, DIR, sessions)
    expect([scan.scanned, scan.total, scan.isPartial]).toEqual([16, 17, true])
    expect(scan.counts).toEqual([{ name: 'cadre', count: 16 }])
    expect(run.reads).toEqual(names.slice(0, 16).map(name => `${DIR}/${name}`))
    expect(historyLines(scan)).toContain(
      'partial: stopped at 64 MiB in total, 1 of 17 sessions not read (the oldest sessions are not counted)',
    )
    const whole = await scanHistory(memIo(memWorld({ files }), {}).io, DIR, sessions.slice(0, 16))
    expect([whole.scanned, whole.isPartial]).toEqual([16, false])
  })

  test('a session that cannot be read, or is gone, is skipped and counted, and the note says so', async () => {
    const cadre = '<command-name>/cadre</command-name>'
    const world = historyWorld({ 'a.jsonl': cadre, 'b.jsonl': cadre }, { unknownPaths: [`${DIR}/b.jsonl`] })
    const listing = [...(world.dirs[DIR] ?? []), transcript('gone.jsonl', 0)]
    const run = memIo({ ...world, dirs: { [DIR]: listing } }, {})
    const scan = await scanHistory(run.io, DIR, listing)
    expect([scan.scanned, scan.skippedUnknown, scan.skippedLarge, scan.isPartial]).toEqual([1, 2, 0, false])
    expect(historyLines(scan)).toContain('skipped 2 of 3 sessions that could not be read')
  })

  test('historyLines: the heading, then at most 15 names busiest first with ties by name', () => {
    const counts = Array.from({ length: 20 }, (_, at) => ({
      name: `n${String(at).padStart(2, '0')}`,
      count: (at % 4) + 1,
    }))
    const lines = historyLines(scanOf({ counts, total: 3, scanned: 3 }))
    expect(lines[0]).toBe(HEADING)
    expect(lines.slice(1)).toEqual([
      '  n03  4',
      '  n07  4',
      '  n11  4',
      '  n15  4',
      '  n19  4',
      '  n02  3',
      '  n06  3',
      '  n10  3',
      '  n14  3',
      '  n18  3',
      '  n01  2',
      '  n05  2',
      '  n09  2',
      '  n13  2',
      '  n17  2',
    ])
  })

  test('historyLines puts the notes after the names: over 4 MiB, could not be read, then partial', () => {
    const scan = scanOf({
      counts: [{ name: 'cadre', count: 1 }],
      total: 20,
      scanned: 10,
      skippedLarge: 2,
      skippedUnknown: 1,
      isPartial: true,
    })
    expect(historyLines(scan)).toEqual([
      HEADING,
      '  cadre  1',
      'skipped 2 of 20 sessions over 4 MiB (the heaviest sessions are not counted)',
      'skipped 1 of 20 sessions that could not be read',
      'partial: stopped at 64 MiB in total, 7 of 20 sessions not read (the oldest sessions are not counted)',
    ])
  })

  test('a scan that found no name shows none under the heading', () => {
    expect(historyLines(scanOf({ total: 2, scanned: 2 }))).toEqual([HEADING, '  none'])
  })

  test('a count of 1 is singular in the question and in the notes', () => {
    expect(historyQuestion(1)).toBe(
      "Scan this repo's session history (1 session) for frequently used commands and skills? " +
        'Only names and counts are kept.',
    )
    expect(historyLines(scanOf({ total: 1, skippedLarge: 1 }))).toEqual([
      HEADING,
      '  none',
      'skipped 1 of 1 session over 4 MiB (the heaviest sessions are not counted)',
    ])
    expect(historyLines(scanOf({ total: 1, skippedUnknown: 1 })).at(-1)).toBe(
      'skipped 1 of 1 session that could not be read',
    )
  })

  test('the history block at its largest is 15 names and 3 notes, in under 2000 characters', () => {
    const counts = Array.from({ length: 30 }, (_, at) => ({
      name: `${String.fromCharCode(97 + (at % 26))}${String(at).padStart(2, '0')}${'z'.repeat(61)}`,
      count: 999_999_999,
    }))
    const scan = scanOf({ counts, total: 50, scanned: 10, skippedLarge: 20, skippedUnknown: 19, isPartial: true })
    expect(counts.every(count => HISTORY_NAME_PATTERN.test(count.name))).toBe(true)
    const lines = historyLines(scan)
    expect(lines).toHaveLength(1 + 15 + 3)
    expect(lines.join('\n').length <= 2000).toBe(true)
  })

  test('historyStep: with no session folder, or no .jsonl in it, it logs the note and asks nothing', async () => {
    const empty = memWorld({ dirs: { [DIR]: [entry('notes.txt'), entry('sub', 'dir')] } })
    for (const world of [memWorld({}), empty]) {
      const run = memIo(world, ['Yes, scan names and counts'])
      expect(await historyStep(run.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)).toEqual({ kind: 'accepted', value: 'skipped' })
      expect(run.asked).toEqual([])
      expect(run.logged).toEqual([NO_HISTORY_NOTE])
      expect(run.reads.filter(path => path.endsWith('.jsonl'))).toEqual([])
    }
  })

  test('historyStep: a session folder it cannot list gets its own note; nothing is asked or read (Q3)', async () => {
    const run = memIo(memWorld({ unknownPaths: [DIR] }), ['Yes, scan names and counts'])
    expect(await historyStep(run.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)).toEqual({ kind: 'accepted', value: 'skipped' })
    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([UNLISTED_HISTORY_NOTE])
    expect(run.reads.filter(path => path.endsWith('.jsonl'))).toEqual([])
  })

  test('historyStep: with sessions it asks first, and No, skip it reads no transcript and shows nothing', async () => {
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE, 'b.jsonl': EXAMPLE }), ['No, skip it'])
    expect(await historyStep(run.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)).toEqual({ kind: 'accepted', value: 'skipped' })
    expect(run.asked).toEqual([historyAsked(2)])
    expect(run.specs).toEqual([{ options: HISTORY_OPTIONS, header: 'History' }])
    expect(run.reads).toEqual([])
    expect(run.logged).toEqual([])
    expect(run.shown).toEqual([])
  })

  test('historyStep: Yes, scan names and counts reads the sessions newest first and shows the lines once', async () => {
    const world = historyWorld({ 'a.jsonl': EXAMPLE, 'b.jsonl': commandLine('<command-name>/cadre</command-name>') })
    const run = memIo(world, ['Yes, scan names and counts'])
    const scan = scanOf({
      counts: [
        { name: 'cadre', count: 2 },
        { name: 'gsd-plan-phase', count: 1 },
        { name: 'superpowers:brainstorming', count: 1 },
      ],
      scanned: 2,
      total: 2,
    })
    expect(await historyStep(run.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)).toEqual({ kind: 'accepted', value: scan })
    expect(run.reads).toEqual([`${DIR}/a.jsonl`, `${DIR}/b.jsonl`])
    expect(run.shown.map(block => block.lines)).toEqual([historyLines(scan)])
    expect(run.logged).toEqual([])
    expect(historyLines(scan)).toEqual([
      HEADING,
      '  cadre  2',
      '  gsd-plan-phase  1',
      '  superpowers:brainstorming  1',
    ])
  })

  test('historyStep: a Yes run shows one Session history block in the pane and logs no block (D-133)', async () => {
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), ['Yes, scan names and counts'])
    const result = await historyStep(run.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)
    const scan = result.kind === 'accepted' && result.value !== 'skipped' ? result.value : scanOf()
    expect(run.shown).toEqual([{ key: 'history', title: PANE_TITLES.history, lines: historyLines(scan) }])
    expect(PANE_TITLES.history).toBe('Session history')
    expect(run.logged.filter(text => text.includes('\n'))).toEqual([])
  })

  test('historyStep: a typed yes counts in any case; an unknown answer is asked again, three asks in all', async () => {
    const typed = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), [' YES, scan names and counts '])
    const result = await historyStep(typed.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)
    expect(result.kind).toBe('accepted')
    expect(result.kind === 'accepted' ? result.value : 'skipped').not.toBe('skipped')
    const unread = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), ['maybe', 'maybe', 'maybe'])
    expect(await historyStep(unread.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)).toEqual({
      kind: 'cancelled',
      reason: NO_USABLE_ANSWER_REASON,
    })
    const again = `${MAYBE_REFUSAL}\n${historyAsked(1)}`
    expect(unread.asked).toEqual([historyAsked(1), again, again])
    expect(unread.reads).toEqual([])
  })

  test('historyStep: a dismissed question cancels with its reason, and nothing is read or logged (A1)', async () => {
    const run = memIo(historyWorld({ 'a.jsonl': EXAMPLE }), [])
    expect(await historyStep(run.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)).toEqual({
      kind: 'cancelled',
      reason: HISTORY_DISMISSED_REASON,
    })
    expect(run.asked).toEqual([historyAsked(1)])
    expect(run.reads).toEqual([])
    expect(run.logged).toEqual([])
  })

  test('historyStep: the user folder is CLAUDE_CONFIG_DIR when set; with no user folder there is none', async () => {
    const cfg = '/cfg/projects/-repo'
    const world = memWorld({ dirs: { [cfg]: [transcript('a.jsonl', 1)] }, files: { [`${cfg}/a.jsonl`]: EXAMPLE } })
    const run = memIo(world, ['No, skip it'])
    await historyStep(run.io, { ...DEFAULT_LOCATIONS, configDir: '/cfg' }, SCAN_CONTEXT)
    expect(run.listed).toEqual([cfg])
    expect(run.asked).toEqual([historyAsked(1)])
    const none = memIo(memWorld({}), [])
    const homeless = { ...DEFAULT_LOCATIONS, home: null, givenHome: null }
    expect(await historyStep(none.io, homeless, SCAN_CONTEXT)).toEqual({ kind: 'accepted', value: 'skipped' })
    expect(none.listed).toEqual([])
    expect(none.logged).toEqual([NO_HISTORY_NOTE])
  })

  test('historyStep: the session folder is the one of the repo root as resolved', async () => {
    const locations = { ...DEFAULT_LOCATIONS, root: '/real/repo', givenRoot: '/link/repo' }
    const run = memIo(memWorld({}), [])
    await historyStep(run.io, locations, SCAN_CONTEXT)
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
    const run = memIo(world, ['Yes, scan names and counts'])
    const result = await historyStep(run.io, DEFAULT_LOCATIONS, SCAN_CONTEXT)
    const pane = run.shown.flatMap(block => [block.title, ...block.lines]).join('\n')
    expect(pane).toContain('  gsd-plan-phase  1')
    expect(pane).toContain('  codex:rescue  1')
    const shown = [JSON.stringify(result), ...run.logged, pane].join('\n')
    expect(leaks(shown, ['SENTINEL_SECRET_VALUE', '/home/u'])).toEqual([])
  })
})

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
