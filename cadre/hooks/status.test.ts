import { describe, expect, test } from 'claude-code/testing'

import type { FrameworkId, HostRun, InitLocations, LaunchStart, PortEntry, RoleSpec } from '../types'
import { cadreJsonText, roleJsonText } from './generate'
import { autopilotLogPath, autopilotStatusPath } from './scan'
import type { RunState } from './scan'
import {
  BEAT_MAX_BYTES,
  beatSessionOf,
  lastLogText,
  LOG_MAX_BYTES,
  MAX_TRANSCRIPTS,
  newestHandoff,
  runOutcomeOf,
  runStatus,
  startFolderOf,
  statusStateOf,
  titleGrepArgv,
  transcriptCandidates,
} from './status'
import { DEFAULT_LOCATIONS, entryAt, hostWorld, memHost, memIo, memWorld, templateRole } from './testkit'
import type { HostRunRule, HostWrite, MemWorld } from './testkit'

/** The git root's transcripts folder under the fixture user folder (D-131). */
const TRANSCRIPTS = '/home/u/.claude/projects/-repo'

/** The fleet folder of the fixture home, where agent-fleet keeps one beat per session. */
const FLEET = '/home/u/.claude/fleet'

/** The autopilot folder of the fixture home, with each session's status file and log. */
const AUTOPILOT = '/home/u/.claude/autopilot'

/** An autopilot log whose run ended done: the final handoff request, then the finished line (D-111). */
const DONE_LOG =
  '2026-10-20T01:00:00.000Z  final handoff requested (done)\n' +
  '2026-10-20T01:01:00.000Z  finished (done): handed back to the person\n'

/** The grep output of a transcript whose session is named `title`: its custom-title row. */
function titleRow(title: string): string {
  return `${JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: 'x' })}\n`
}

/** A fake host rule that answers the title grep of the transcript at `path` with `result`. */
function grepRule(path: string, result: HostRun | null): HostRunRule {
  return { argv: titleGrepArgv(path), result }
}

/** A title grep of the transcript at `path` that exits 0 with the custom-title row of `title`. */
function titled(path: string, title: string): HostRunRule {
  return grepRule(path, { exitCode: 0, stdout: titleRow(title), stderr: '' })
}

/** A fleet beat of agent-fleet's on-disk shape, for the session `id`; `over` changes the fields it names. */
function beat(id: string, over: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { id, name: 'cadre-be', cwd: '/repo', beatAt: 500, isEnded: false, ...over }
}

/** The status file and log of a session whose run ended done, under the fixture home. */
function doneFiles(sessionId: string): Record<string, string> {
  return { [`${AUTOPILOT}/${sessionId}.json`]: '{"isOn":false}', [`${AUTOPILOT}/${sessionId}.log`]: DONE_LOG }
}

/**
 * What a status world adds to the applied repo: its launch start, the repo default framework, BE's role, its
 * locations, and more folders and files.
 */
type StatusInput = {
  readonly start?: LaunchStart
  readonly framework?: FrameworkId | null
  readonly role?: RoleSpec
  readonly locations?: InitLocations
  readonly dirs?: Readonly<Record<string, readonly PortEntry[]>>
  readonly files?: Readonly<Record<string, string>>
}

/**
 * A git repo at /repo after an init of BE alone (D-111): cadre.json with `start` (git root by default) and `framework`
 * (the built-in default unless told), BE's role.json from `role` (the template BE by default), plus the folders and
 * files `input` adds. A dir start's folder is there as a folder.
 */
function statusWorld(input: StatusInput = {}): MemWorld {
  const start = input.start ?? { kind: 'git-root' }
  const state = cadreJsonText({
    schema: 1,
    cadreVersion: '0.2.0',
    framework: input.framework === undefined ? 'none' : input.framework,
    gitPolicy: 'definitions',
    roles: ['be'],
    launchStart: start,
    readUserMcp: false,
  })
  const startDir = start.kind === 'dir' ? { [`/repo/${start.path}`]: [] } : {}

  return memWorld({
    locations: input.locations ?? DEFAULT_LOCATIONS,
    dirs: { '/repo/.git': [], ...startDir, ...input.dirs },
    files: {
      '/repo/.cadre/cadre.json': state,
      '/repo/.cadre/be/role.json': roleJsonText(input.role ?? templateRole('be')),
      ...input.files,
    },
  })
}

/** What runStatus of BE replied, the paths it grepped in order, and what the ports were asked. */
type StatusRun = {
  readonly lines: readonly string[]
  readonly greps: readonly string[]
  readonly listed: readonly string[]
  readonly reads: readonly string[]
  readonly writes: readonly HostWrite[]
}

/** runStatus of BE over `world`, with these run rules (any other argv exits 0 with no output). */
async function statusBe(world: MemWorld, runs: readonly HostRunRule[] = []): Promise<StatusRun> {
  const host = memHost(hostWorld({ runs }))
  const run = memIo(world, {})
  const reply = await runStatus(run.io, host.io, { id: 'be' })

  return {
    lines: reply.split('\n'),
    greps: host.calls.map(call => call.argv.at(-1) ?? ''),
    listed: run.listed,
    reads: run.reads,
    writes: host.writes,
  }
}

describe('status discovery (D-131)', () => {
  test('transcriptCandidates keeps regular .jsonl files named by a plain session id, newest first', () => {
    const entries = [
      entryAt('a.jsonl', 'file', 5),
      entryAt('b.jsonl', 'file', 9),
      entryAt('c.txt', 'file', 99),
      entryAt('d.jsonl', 'other', 50, true),
      entryAt('../e.jsonl', 'file', 1),
    ]
    expect(transcriptCandidates(entries)).toEqual(['b.jsonl', 'a.jsonl'])
  })

  test('a folder, a name with a space or a dot in its id, and a bare .jsonl are not transcripts', () => {
    const entries = [
      entryAt('f.jsonl', 'dir', 70),
      entryAt('g h.jsonl', 'file', 60),
      entryAt('i.j.jsonl', 'file', 50),
      entryAt('.jsonl', 'file', 40),
      entryAt('k.jsonl', 'file', 30),
    ]
    expect(transcriptCandidates(entries)).toEqual(['k.jsonl'])
  })

  test('at most MAX_TRANSCRIPTS (20) transcripts are searched: the newest ones', () => {
    expect(MAX_TRANSCRIPTS).toBe(20)
    const entries = Array.from({ length: 25 }, (_, at) => entryAt(`s${at}.jsonl`, 'file', at))
    expect(transcriptCandidates(entries)).toEqual(Array.from({ length: 20 }, (_, at) => `s${24 - at}.jsonl`))
  })

  test('the newest transcript is grepped first, and the first titled cadre-be is the session', async () => {
    const world = statusWorld({
      dirs: {
        [TRANSCRIPTS]: [
          entryAt('s-old.jsonl', 'file', 5),
          entryAt('s-be.jsonl', 'file', 10),
          entryAt('s-bad.jsonl', 'file', 20),
          entryAt('s-gone.jsonl', 'file', 30),
          entryAt('s-pm.jsonl', 'file', 40),
        ],
      },
      files: { ...doneFiles('s-be'), ...doneFiles('s-old') },
    })
    // A newer session titled cadre-pm, a grep the host refuses and one that exits 2 each give no title.
    const status = await statusBe(world, [
      titled(`${TRANSCRIPTS}/s-pm.jsonl`, 'cadre-pm'),
      grepRule(`${TRANSCRIPTS}/s-gone.jsonl`, null),
      grepRule(`${TRANSCRIPTS}/s-bad.jsonl`, { exitCode: 2, stdout: titleRow('cadre-be'), stderr: 'grep: error' }),
      titled(`${TRANSCRIPTS}/s-be.jsonl`, 'cadre-be'),
      titled(`${TRANSCRIPTS}/s-old.jsonl`, 'cadre-be'),
    ])
    const names = ['s-pm', 's-gone', 's-bad', 's-be'].map(name => `${TRANSCRIPTS}/${name}.jsonl`)
    expect(status.greps).toEqual(names)
    expect(status.lines.slice(1, 3)).toEqual(['state: done', 'session: s-be (found by its name cadre-be)'])
  })

  test('a dir start searches the transcripts of its own folder under the user folder (RESEARCH 1.5)', async () => {
    const folder = '/home/u/.claude/projects/-repo-apps-web'
    const world = statusWorld({
      start: { kind: 'dir', path: 'apps/web' },
      dirs: { [folder]: [entryAt('s9.jsonl', 'file', 5)] },
      files: doneFiles('s9'),
    })
    const status = await statusBe(world, [titled(`${folder}/s9.jsonl`, 'cadre-be')])
    expect(startFolderOf('/repo', { kind: 'dir', path: 'apps/web' })).toBe('/repo/apps/web')
    expect(status.listed).toContain(folder)
    expect(status.listed).not.toContain(TRANSCRIPTS)
    expect(status.greps).toEqual([`${folder}/s9.jsonl`])
    expect(status.lines[2]).toBe('session: s9 (found by its name cadre-be)')
  })

  test('beatSessionOf takes the newest beat named cadre-be in the start folder, skipping every other beat', () => {
    const values = [
      beat('s-old', { beatAt: 100 }),
      beat('s-new', { beatAt: 300 }),
      beat('s-mid', { beatAt: 200 }),
      beat('s-elsewhere', { beatAt: 900, cwd: '/elsewhere' }),
      beat('../s-up', { beatAt: 900 }),
      beat('s-text', { beatAt: '900' }),
      beat('s-forever', { beatAt: Number.POSITIVE_INFINITY }),
      beat('s-pm', { beatAt: 900, name: 'cadre-pm' }),
      beat('s-unnamed', { beatAt: 900, name: null }),
      null,
      'cadre-be',
      [beat('s-array', { beatAt: 900 })],
    ]
    expect(beatSessionOf(values, 'be', '/repo')).toEqual({ sessionId: 's-new', cwd: '/repo' })
    expect(beatSessionOf([], 'be', '/repo')).toBeNull()
    expect(beatSessionOf([beat('s-pm', { name: 'cadre-pm' })], 'be', '/repo')).toBeNull()
  })

  test('with no titled transcript, the newest fleet beat named cadre-be is the session, read capped', async () => {
    const big = beat('s-big', { beatAt: 900, padding: 'x'.repeat(BEAT_MAX_BYTES) })
    const world = statusWorld({
      dirs: {
        [TRANSCRIPTS]: [entryAt('s-pm.jsonl', 'file', 9)],
        [FLEET]: [
          entryAt('s-big.json', 'file', 90),
          entryAt('s-beat.json', 'file', 50),
          entryAt('s-older.json', 'file', 40),
          entryAt('notes.txt', 'file', 99),
        ],
      },
      files: {
        [`${FLEET}/s-big.json`]: JSON.stringify(big),
        [`${FLEET}/s-beat.json`]: JSON.stringify(beat('s-beat', { beatAt: 500 })),
        [`${FLEET}/s-older.json`]: JSON.stringify(beat('s-older', { beatAt: 400 })),
        [`${FLEET}/notes.txt`]: JSON.stringify(beat('s-notes', { beatAt: 999 })),
        ...doneFiles('s-beat'),
      },
    })
    const status = await statusBe(world, [titled(`${TRANSCRIPTS}/s-pm.jsonl`, 'cadre-pm')])
    expect(BEAT_MAX_BYTES).toBe(64 * 1024)
    expect(status.lines.slice(1, 3)).toEqual(['state: done', 'session: s-beat (found by its fleet beat)'])
    expect(status.reads).not.toContain(`${FLEET}/notes.txt`)
  })

  test('only the newest 50 .json beats are read', async () => {
    const names = Array.from({ length: 51 }, (_, at) => `s-${at}`)
    // Only the beat of `match` is named cadre-be; s-0 is the newest beat and s-50 the oldest.
    const fleet = (match: string): MemWorld =>
      statusWorld({
        dirs: { [FLEET]: names.map((name, at) => entryAt(`${name}.json`, 'file', 1000 - at)) },
        files: Object.fromEntries(
          names.map(name => {
            const text = JSON.stringify(beat(name, { name: name === match ? 'cadre-be' : 'x' }))

            return [`${FLEET}/${name}.json`, text]
          }),
        ),
      })
    const fiftieth = await statusBe(fleet('s-49'))
    const fiftyFirst = await statusBe(fleet('s-50'))
    expect(fiftieth.lines[2]).toBe('session: s-49 (found by its fleet beat)')
    expect(fiftyFirst.lines[2]).toBe('session: none found for cadre-be')
    expect(fiftyFirst.reads).not.toContain(`${FLEET}/s-50.json`)
  })

  test('a here start lists no transcript and matches the beat by its name alone, in any folder', async () => {
    const world = statusWorld({
      start: { kind: 'here' },
      dirs: {
        [TRANSCRIPTS]: [entryAt('s9.jsonl', 'file', 5)],
        [FLEET]: [entryAt('s-here.json', 'file', 5)],
      },
      files: {
        [`${FLEET}/s-here.json`]: JSON.stringify(beat('s-here', { cwd: '/repo/tools' })),
        ...doneFiles('s-here'),
      },
    })
    const status = await statusBe(world, [titled(`${TRANSCRIPTS}/s9.jsonl`, 'cadre-be')])
    expect(startFolderOf('/repo', { kind: 'here' })).toBeNull()
    expect(status.listed.filter(path => path.startsWith('/home/u/.claude/projects'))).toEqual([])
    expect(status.greps).toEqual([])
    expect(status.lines.slice(1, 3)).toEqual(['state: done', 'session: s-here (found by its fleet beat)'])
  })

  test('the transcripts are under the user folder, the fleet and autopilot files under HOME as given', async () => {
    // HOME resolves to /real/u and CLAUDE_CONFIG_DIR is /cfg, while HOME as given stays /home/u.
    const locations = { ...DEFAULT_LOCATIONS, home: '/real/u', configDir: '/cfg' }
    const world = statusWorld({
      locations,
      dirs: { '/cfg/projects/-repo': [entryAt('s-pm.jsonl', 'file', 5)], [FLEET]: [entryAt('s-b.json', 'file', 5)] },
      files: { [`${FLEET}/s-b.json`]: JSON.stringify(beat('s-b')), ...doneFiles('s-b') },
    })
    const status = await statusBe(world, [titled('/cfg/projects/-repo/s-pm.jsonl', 'cadre-pm')])
    expect(status.greps).toEqual(['/cfg/projects/-repo/s-pm.jsonl'])
    expect(status.listed).toContain(FLEET)
    expect(status.reads).toContain(`${AUTOPILOT}/s-b.json`)
    expect(status.reads).toContain(`${AUTOPILOT}/s-b.log`)
    expect(status.lines.slice(1, 3)).toEqual(['state: done', 'session: s-b (found by its fleet beat)'])
  })

  test('autopilotLogPath is the log beside the status file, and null wherever autopilotStatusPath is null', () => {
    expect(autopilotLogPath('/home/u', 's9')).toBe('/home/u/.claude/autopilot/s9.log')
    expect(autopilotLogPath('/home/u/', 's9')).toBe('/home/u/.claude/autopilot/s9.log')
    const refused: readonly (readonly [string, string])[] = [
      ['/home/u', '../x'],
      ['/home/u', 'a b'],
      ['/home/u', 'a.b'],
      ['/home/u', ''],
      ['home/u', 's9'],
    ]
    for (const [home, id] of refused) {
      expect(autopilotLogPath(home, id)).toBeNull()
      expect(autopilotStatusPath(home, id)).toBeNull()
    }
  })

  test('with no session found, the run is not started and the session line says so; nothing is written', async () => {
    const status = await statusBe(statusWorld())
    expect(status.lines.slice(0, 3)).toEqual([
      'cadre status be',
      'state: not started',
      'session: none found for cadre-be',
    ])
    expect(status.writes).toEqual([])
  })
})

/** The fixture clock, memWorld's `now`, in epoch milliseconds. */
const NOW = 1_000_000

/** An autopilot log of a run that has not ended: no finished line. */
const RUNNING_LOG = '2026-10-20T01:00:00.000Z  availability mode none -> asking\n'

/** An autopilot log of a done run that was revived, then ended for its time limit. */
const TIME_LOG =
  '2026-10-20T01:00:00.000Z  finished (done): handed back to the person\n' +
  '2026-10-20T01:05:00.000Z  revived after finishing (done) by extend: to 03:05\n' +
  '2026-10-20T02:00:00.000Z  finished (time): handed back to the person\n'

/** The rule that gives the transcript of s9 at the git root the title `cadre-be`. */
const S9_TITLED = titled(`${TRANSCRIPTS}/s9.jsonl`, 'cadre-be')

/**
 * A status world where the title search finds the session s9 at the git root (with S9_TITLED), with this status file
 * and log of s9 (null: not there), and what `input` adds.
 */
function s9World(status: string | null, log: string | null, input: StatusInput = {}): MemWorld {
  const statusFile = status === null ? {} : { [`${AUTOPILOT}/s9.json`]: status }
  const logFile = log === null ? {} : { [`${AUTOPILOT}/s9.log`]: log }

  return statusWorld({
    ...input,
    dirs: { [TRANSCRIPTS]: [entryAt('s9.jsonl', 'file', 5)], ...input.dirs },
    files: { ...statusFile, ...logFile, ...input.files },
  })
}

/** The state statusStateOf gives a run state and an outcome, with a status file and a log there unless told. */
function stateOf(
  runState: RunState,
  outcome: 'done' | 'stopped' | 'none',
  hasStatusFile = true,
  hasLog = true,
): string {
  return statusStateOf({ runState, outcome, hasStatusFile, hasLog })
}

/** A status file of a run that is on, with its beat `ago` milliseconds before the fixture clock. */
function onStatus(ago: number): string {
  return JSON.stringify({ isOn: true, phase: 'running', beat: NOW - ago })
}

describe('status states (D-111)', () => {
  test('statusStateOf: an active run is running, an unknown one unknown, an off one told by its finished line', () => {
    expect(stateOf('active', 'done')).toBe('running')
    expect(stateOf('active', 'none', false, false)).toBe('running')
    expect(stateOf('unknown', 'done')).toBe('unknown')
    expect(stateOf('none', 'done')).toBe('done')
    expect(stateOf('none', 'stopped')).toBe('stopped')
    expect(stateOf('none', 'none', false, false)).toBe('not started')
    expect(stateOf('none', 'none', true, false)).toBe('stopped')
    expect(stateOf('none', 'none', false, true)).toBe('stopped')
    expect(stateOf('none', 'none')).toBe('stopped')
  })

  test('a status file on with a fresh beat is running, whatever the log says', async () => {
    const status = await statusBe(s9World(onStatus(10_000), DONE_LOG), [S9_TITLED])
    expect(status.lines[1]).toBe('state: running')
  })

  test('a stale beat with a log that ends finished (time) is stopped, and the report shows that line', async () => {
    const status = await statusBe(s9World(onStatus(120_000), TIME_LOG), [S9_TITLED])
    expect(status.lines.slice(1, 4)).toEqual([
      'state: stopped',
      'session: s9 (found by its name cadre-be)',
      'autopilot: finished (time): handed back to the person',
    ])
  })

  test('a status file that is not JSON is unknown', async () => {
    const status = await statusBe(s9World('{', DONE_LOG), [S9_TITLED])
    expect(status.lines[1]).toBe('state: unknown')
  })

  test('an off run whose log cannot be read or is too large is unknown; an active one is running', async () => {
    expect(LOG_MAX_BYTES).toBe(4 * 1024 * 1024)
    const unreadable = (status: string): MemWorld => ({
      ...s9World(status, DONE_LOG),
      unknownPaths: [`${AUTOPILOT}/s9.log`],
    })
    const off = await statusBe(unreadable('{"isOn":false}'), [S9_TITLED])
    const large = await statusBe(s9World('{"isOn":false}', `${DONE_LOG}${'x'.repeat(LOG_MAX_BYTES)}\n`), [S9_TITLED])
    const active = await statusBe(unreadable(onStatus(0)), [S9_TITLED])
    const states = [off, large, active].map(status => status.lines[1])
    expect(states).toEqual(['state: unknown', 'state: unknown', 'state: running'])
  })

  test('a session with neither a status file nor a log is not started; with one of them it is stopped', async () => {
    const neither = await statusBe(s9World(null, null), [S9_TITLED])
    const emptyLog = await statusBe(s9World(null, ''), [S9_TITLED])
    const onlyStatus = await statusBe(s9World('{"isOn":false}', null), [S9_TITLED])
    const onlyLog = await statusBe(s9World(null, RUNNING_LOG), [S9_TITLED])
    expect([neither, emptyLog, onlyStatus, onlyLog].map(status => status.lines[1])).toEqual([
      'state: not started',
      'state: not started',
      'state: stopped',
      'state: stopped',
    ])
    expect(neither.lines[2]).toBe('session: s9 (found by its name cadre-be)')
  })

  test('a forged finished (done) inside a text, or on a line without its stamp, is not done (T-03-33)', async () => {
    const forged =
      '2026-10-20T01:00:00.000Z  the session reported its work complete: ok  finished (done): handed back\n' +
      'finished (done): handed back to the person\n' +
      '2026-10-20T01:01:00.000Z finished (done): one space after the stamp\n' +
      '2026-10-20T01:02:00.000Z   finished (done): three spaces after the stamp\n'
    expect(runOutcomeOf(forged)).toBe('none')
    const status = await statusBe(s9World('{"isOn":false}', forged), [S9_TITLED])
    expect(status.lines[1]).toBe('state: stopped')
  })

  test('the last finished line decides, and a line is one record whatever separator its text holds', () => {
    expect(runOutcomeOf(DONE_LOG)).toBe('done')
    expect(runOutcomeOf(TIME_LOG)).toBe('stopped')
    expect(runOutcomeOf(`${TIME_LOG}${DONE_LOG}`)).toBe('done')
    expect(runOutcomeOf(RUNNING_LOG)).toBe('none')
    expect(runOutcomeOf('')).toBe('none')
    expect(runOutcomeOf('2026-10-20T01:00:00.000Z  finished (done): handed\u2029back\n')).toBe('done')
  })

  test('newestHandoff takes the newest regular .md file, which the report shows below the start folder', async () => {
    const entries = [entryAt('2026-10-20_a.md', 'file', 5), entryAt('b.md', 'file', 9), entryAt('c.txt', 'file', 99)]
    expect(newestHandoff(entries)).toBe('b.md')
    const others = [entryAt('c.txt', 'file', 99), entryAt('d.md', 'other', 99, true), entryAt('e.md', 'dir', 98)]
    expect(newestHandoff(others)).toBeNull()
    const world = s9World('{"isOn":false}', DONE_LOG, { dirs: { '/repo/thoughts/shared/handoffs/be': entries } })
    const status = await statusBe(world, [S9_TITLED])
    expect(status.lines[4]).toBe('latest handoff: thoughts/shared/handoffs/be/b.md')
  })

  test("the handoffs are searched under the start folder: a dir start's folder, a here start's beat cwd", async () => {
    const transcripts = '/home/u/.claude/projects/-repo-apps-web'
    const dir = statusWorld({
      start: { kind: 'dir', path: 'apps/web' },
      dirs: {
        [transcripts]: [entryAt('s9.jsonl', 'file', 5)],
        '/repo/apps/web/thoughts/shared/handoffs/be': [entryAt('h.md', 'file', 5)],
      },
      files: doneFiles('s9'),
    })
    const here = statusWorld({
      start: { kind: 'here' },
      dirs: {
        [FLEET]: [entryAt('s-here.json', 'file', 5)],
        '/repo/tools/thoughts/shared/handoffs/be': [entryAt('h2.md', 'file', 5)],
      },
      files: {
        [`${FLEET}/s-here.json`]: JSON.stringify(beat('s-here', { cwd: '/repo/tools' })),
        ...doneFiles('s-here'),
      },
    })
    const fromDir = await statusBe(dir, [titled(`${transcripts}/s9.jsonl`, 'cadre-be')])
    const fromHere = await statusBe(here)
    expect(fromDir.listed).toContain('/repo/apps/web/thoughts/shared/handoffs/be')
    expect(fromDir.lines[4]).toBe('latest handoff: thoughts/shared/handoffs/be/h.md')
    expect(fromHere.listed).toContain('/repo/tools/thoughts/shared/handoffs/be')
    expect(fromHere.lines[4]).toBe('latest handoff: thoughts/shared/handoffs/be/h2.md')
  })

  test('a built-in role says whether its DONE.md is there; a GSD role has no such line (D-17)', async () => {
    const marker = { '/repo/.cadre/be/.runtime/DONE.md': 'what was done and how it was verified\n' }
    const doneWith = (input: StatusInput): Promise<StatusRun> =>
      statusBe(s9World('{"isOn":false}', DONE_LOG, input), [S9_TITLED])
    const present = await doneWith({ files: marker })
    const absent = await doneWith({})
    const folder = await doneWith({ dirs: { '/repo/.cadre/be/.runtime/DONE.md': [] } })
    const ownBuiltin = await doneWith({ framework: 'gsd', role: templateRole('be', { framework: 'none' }) })
    const gsdDefault = await doneWith({ framework: 'gsd', files: marker })
    const ownGsd = await doneWith({ role: templateRole('be', { framework: 'gsd' }), files: marker })
    expect(present.lines.at(-1)).toBe('DONE.md: present')
    expect([absent, folder, ownBuiltin].map(status => status.lines.at(-1))).toEqual([
      'DONE.md: not written yet',
      'DONE.md: not written yet',
      'DONE.md: not written yet',
    ])
    for (const status of [gsdDefault, ownGsd]) {
      expect(status.lines.filter(line => line.startsWith('DONE.md'))).toEqual([])
    }
  })

  test('lastLogText shows the last line after its stamp, cleaned and at most 160 characters (T-03-35)', () => {
    const long = `2026-10-20T01:00:00.000Z  the session reported its work complete: ${'x'.repeat(300)}\n`
    const shown = lastLogText(`${DONE_LOG}${long}`) ?? ''
    expect(Array.from(shown)).toHaveLength(160)
    expect(shown.startsWith('the session reported its work complete: xxx')).toBe(true)
    expect(shown.endsWith('\u2026')).toBe(true)
    expect(lastLogText('2026-10-20T01:00:00.000Z  a\u0007b\u202Ec\u2028d\n')).toBe('abcd')
    expect(lastLogText(DONE_LOG)).toBe('finished (done): handed back to the person')
    expect(lastLogText('')).toBeNull()
    expect(lastLogText('no stamp here\n')).toBeNull()
  })
})
