import { describe, expect, test } from 'claude-code/testing'

import type { HostRun, InitLocations, LaunchStart, PortEntry } from '../types'
import { cadreJsonText, roleJsonText } from './generate'
import { autopilotLogPath, autopilotStatusPath } from './scan'
import {
  BEAT_MAX_BYTES,
  beatSessionOf,
  MAX_TRANSCRIPTS,
  runStatus,
  startFolderOf,
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

/** What a status world adds to the applied repo: its launch start, its locations, and more folders and files. */
type StatusInput = {
  readonly start?: LaunchStart
  readonly locations?: InitLocations
  readonly dirs?: Readonly<Record<string, readonly PortEntry[]>>
  readonly files?: Readonly<Record<string, string>>
}

/**
 * A git repo at /repo after an init of BE alone on the built-in default (D-111): cadre.json with `start` (git root by
 * default) and BE's role.json, plus the folders and files `input` adds. A dir start's folder is there as a folder.
 */
function statusWorld(input: StatusInput = {}): MemWorld {
  const start = input.start ?? { kind: 'git-root' }
  const state = cadreJsonText({
    schema: 1,
    cadreVersion: '0.2.0',
    framework: 'none',
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
      '/repo/.cadre/be/role.json': roleJsonText(templateRole('be')),
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
