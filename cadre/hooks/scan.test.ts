import { describe, expect, test } from 'claude-code/testing'

import type { InitIo, PortEntry, PortRead, RepoScan, ScanFinding, ScanKind } from '../types'
import { MAX_READ_BYTES } from './facts'
import {
  AUTOPILOT_FRESH_MS,
  autopilotReply,
  autopilotRunState,
  autopilotStatusPath,
  MARKER_ROWS,
  MAX_SCAN_DEPTH,
  MAX_SCAN_ENTRIES,
  readRepoFile,
  scanRepo,
  SKIP_DIRS,
  SOURCE_EXTENSIONS,
} from './scan'
import type { MarkerRow } from './scan'
import { leaks, memIo, memWorld, SECRET_FIXTURES } from './testkit'
import type { MemWorld } from './testkit'

const NOW = 1_000_000

/** The read of a status file that holds this value as JSON. */
function statusOf(value: unknown): PortRead {
  return { state: 'text', text: JSON.stringify(value) }
}

/** The read of a status file that holds exactly this text. */
function rawStatus(text: string): PortRead {
  return { state: 'text', text }
}

/** The status path of session s1 under /home/u; the test fails when there is none, so it never passes without one. */
function s1Path(): string {
  const path = autopilotStatusPath('/home/u', 's1')
  if (path === null) throw new Error('no status path for session s1')

  return path
}

describe('autopilot guard', () => {
  test('a status file is fresh for 60 seconds, twice the 30 second heartbeat autopilot writes', () => {
    expect(AUTOPILOT_FRESH_MS).toBe(60_000)
  })

  test('isOn true with a beat inside the window is an active run, in any phase', () => {
    const phases = ['running', 'wrapping', 'restarting', 'resuming', 'waiting', 'final', 'paused', 'awaiting']
    for (const phase of phases) {
      expect(autopilotRunState(statusOf({ isOn: true, phase, beat: NOW }), NOW)).toBe('active')
    }
    expect(autopilotRunState(statusOf({ isOn: true, beat: NOW - 1 }), NOW)).toBe('active')
  })

  test('a beat exactly 60 seconds old is active and one millisecond older is no run', () => {
    expect(autopilotRunState(statusOf({ isOn: true, beat: NOW - 60_000 }), NOW)).toBe('active')
    expect(autopilotRunState(statusOf({ isOn: true, beat: NOW - 60_001 }), NOW)).toBe('none')
  })

  test('a beat in the future counts by its absolute difference to now', () => {
    expect(autopilotRunState(statusOf({ isOn: true, beat: NOW + 30_000 }), NOW)).toBe('active')
    expect(autopilotRunState(statusOf({ isOn: true, beat: NOW + 60_000 }), NOW)).toBe('active')
    expect(autopilotRunState(statusOf({ isOn: true, beat: NOW + 60_001 }), NOW)).toBe('none')
  })

  test('a stale beat is a dead session, so no run', () => {
    expect(autopilotRunState(statusOf({ isOn: true, phase: 'running', beat: NOW - 10 * 60_000 }), NOW)).toBe('none')
  })

  test('isOn false is no run, whatever else the file holds', () => {
    expect(autopilotRunState(statusOf({ isOn: false }), NOW)).toBe('none')
    expect(autopilotRunState(statusOf({ isOn: false, phase: 'paused', beat: 'junk' }), NOW)).toBe('none')
  })

  test('an absent file is no run', () => {
    expect(autopilotRunState({ state: 'absent' }, NOW)).toBe('none')
  })

  test('an unreadable file is unknown, never no run', () => {
    expect(autopilotRunState({ state: 'unknown' }, NOW)).toBe('unknown')
  })

  test('a file over the read cap is unknown', () => {
    expect(autopilotRunState({ state: 'too-large', bytes: MAX_READ_BYTES + 1 }, NOW)).toBe('unknown')
  })

  test('text that is not JSON is unknown', () => {
    for (const text of ['', ' ', '{', 'not json', '{"isOn":true', "{'isOn':true}"]) {
      expect(autopilotRunState(rawStatus(text), NOW)).toBe('unknown')
    }
  })

  test('JSON that is not an object is unknown', () => {
    for (const text of ['null', '[]', '1', '"x"', 'true', '[{"isOn":true,"beat":1000000}]']) {
      expect(autopilotRunState(rawStatus(text), NOW)).toBe('unknown')
    }
  })

  test('an isOn that is not a boolean is unknown', () => {
    for (const value of [{}, { isOn: 'true' }, { isOn: 1 }, { isOn: null }, { isOn: [] }, { beat: NOW }]) {
      expect(autopilotRunState(statusOf(value), NOW)).toBe('unknown')
    }
  })

  test('isOn true with a beat that is missing or not a finite number is unknown', () => {
    const beats = [undefined, null, '1000000', {}, [], true]
    for (const beat of beats) {
      const value = beat === undefined ? { isOn: true } : { isOn: true, beat }
      expect(autopilotRunState(statusOf(value), NOW)).toBe('unknown')
    }
    expect(autopilotRunState(rawStatus('{"isOn":true,"beat":1e999}'), NOW)).toBe('unknown')
    expect(autopilotRunState(rawStatus('{"isOn":true,"beat":-1e999}'), NOW)).toBe('unknown')
  })

  test('a clock that is not a finite number cannot judge a beat, so a run that says it is on is unknown', () => {
    const on = statusOf({ isOn: true, beat: NOW })
    expect(autopilotRunState(on, Number.NaN)).toBe('unknown')
    expect(autopilotRunState(on, Number.POSITIVE_INFINITY)).toBe('unknown')
    expect(autopilotRunState({ state: 'absent' }, Number.NaN)).toBe('none')
  })

  test('the status file of a session is under the home folder, named by the session id', () => {
    expect(autopilotStatusPath('/home/u', 's1')).toBe('/home/u/.claude/autopilot/s1.json')
    expect(autopilotStatusPath('/home/u', 'a-b_C9')).toBe('/home/u/.claude/autopilot/a-b_C9.json')
  })

  test('a session id outside 1 to 128 letters, digits, underscores and dashes gives no path', () => {
    const longest = 'a'.repeat(128)
    expect(autopilotStatusPath('/home/u', longest)).toBe(`/home/u/.claude/autopilot/${longest}.json`)
    for (const id of ['', '../x', 'a/b', 'a b', 'a.b', 'a\nb', 'x\u202Ey', 'a'.repeat(129)]) {
      expect(autopilotStatusPath('/home/u', id)).toBeNull()
    }
  })

  test('a home folder that is not an absolute path gives no path, so the guard cannot look at the wrong file', () => {
    expect(autopilotStatusPath('', 's1')).toBeNull()
    expect(autopilotStatusPath('home/u', 's1')).toBeNull()
  })

  test('the session status file read through the port is an active run', async () => {
    const files = { '/home/u/.claude/autopilot/s1.json': '{"isOn":true,"phase":"paused","beat":1000000}' }
    const run = memIo(memWorld({ files }), [])
    const path = s1Path()

    expect(autopilotRunState(await run.io.read(path, MAX_READ_BYTES), NOW)).toBe('active')
    expect(run.reads).toEqual(['/home/u/.claude/autopilot/s1.json'])
  })

  test('through the port a missing file is no run and a file that cannot be read is unknown', async () => {
    const path = s1Path()
    const missing = memIo(memWorld({}), [])
    expect(autopilotRunState(await missing.io.read(path, MAX_READ_BYTES), NOW)).toBe('none')
    const unreadable = memIo(memWorld({ unknownPaths: [path] }), [])
    expect(autopilotRunState(await unreadable.io.read(path, MAX_READ_BYTES), NOW)).toBe('unknown')
    const huge = memIo(memWorld({ files: { [path]: 'x'.repeat(MAX_READ_BYTES + 1) } }), [])
    expect(autopilotRunState(await huge.io.read(path, MAX_READ_BYTES), NOW)).toBe('unknown')
  })

  test('an active run is refused with the init wording and the unknown state with the regen wording', () => {
    expect(autopilotReply('active', 'init')).toBe(
      'cadre init does not run inside an active autopilot run in this session. ' +
        'Stop it with /autopilot stop, or run /cadre init in another session.',
    )
    expect(autopilotReply('unknown', 'regen')).toBe(
      "cadre regen can't tell whether autopilot is running in this session " +
        '(its status file could not be read), so it stopped.',
    )
  })

  test('each reply names its own command', () => {
    expect(autopilotReply('active', 'regen')).toContain('cadre regen does not run inside an active autopilot run')
    expect(autopilotReply('active', 'regen')).toContain('or run /cadre regen in another session.')
    expect(autopilotReply('unknown', 'init')).toContain("cadre init can't tell whether autopilot is running")
  })

  test('no run gives no reply', () => {
    expect(autopilotReply('none', 'init')).toBeNull()
    expect(autopilotReply('none', 'regen')).toBeNull()
  })
})

/** A listing entry: a file unless told otherwise. */
function entry(name: string, kind: PortEntry['kind'] = 'file'): PortEntry {
  return { name, kind, size: 0, mtimeMs: 0, isLink: false }
}

/** A symbolic link as the host lists it: kind other, isLink true. */
function link(name: string): PortEntry {
  return { name, kind: 'other', size: 0, mtimeMs: 0, isLink: true }
}

/** `count` plain files named f0000.txt, f0001.txt and so on; none is a marker or a source file. */
function plainFiles(count: number): PortEntry[] {
  return Array.from({ length: count }, (_, index) => entry(`f${String(index).padStart(4, '0')}.txt`))
}

/** The scan of the repo /repo whose folders, files and links are in memory. */
async function scanOf(over: Partial<MemWorld>): Promise<RepoScan> {
  return scanRepo(memIo(memWorld(over), []).io, '/repo')
}

/** A port over the world that also records every folder listed; `reads` is every path read. */
function spiedIo(world: MemWorld): { readonly io: InitIo; readonly listed: string[]; readonly reads: string[] } {
  const run = memIo(world, [])
  const listed: string[] = []
  const io: InitIo = {
    ...run.io,
    list: async path => {
      listed.push(path)

      return run.io.list(path)
    },
  }

  return { io, listed, reads: run.reads }
}

/** The finding of a kind and label, or undefined. */
function findingOf(scan: RepoScan, kind: ScanKind, label: string): ScanFinding | undefined {
  return scan.findings.find(finding => finding.kind === kind && finding.label === label)
}

/** A package.json text with these runtime dependencies. */
function packageOf(dependencies: Readonly<Record<string, string>>): string {
  return JSON.stringify({ name: 'x', dependencies })
}

describe('scanRepo', () => {
  test('react, express, a source, its test and a Playwright config show each with its path', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('package.json'), entry('playwright.config.ts'), entry('src', 'dir')],
        '/repo/src': [entry('a.test.ts'), entry('a.ts')],
      },
      files: { '/repo/package.json': packageOf({ react: '^18.0.0', express: '^4.0.0' }) },
    })

    expect(scan.findings).toEqual([
      { kind: 'be', label: 'express', evidence: 'package.json' },
      { kind: 'e2e', label: 'Playwright config', evidence: 'playwright.config.ts' },
      { kind: 'fe', label: 'react', evidence: 'package.json' },
      { kind: 'lang', label: 'JavaScript/TypeScript (package.json)', evidence: 'package.json' },
      { kind: 'test', label: 'JS/TS test files', evidence: 'src/a.test.ts' },
    ])
    expect(scan.languages).toEqual(['TypeScript'])
    expect(scan.codeDirs).toEqual(['src'])
    expect(scan.hasSource).toBe(true)
    expect(scan.isTruncated).toBe(false)
    expect(scan.warnings).toEqual([])
  })

  test("this repo's shape, test files under cadre/hooks and no jest or vitest config, still shows tests", async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('README.md'), entry('cadre', 'dir'), entry('docs', 'dir'), entry('package.json')],
        '/repo/cadre': [entry('hooks', 'dir'), entry('tsconfig.strict.json')],
        '/repo/cadre/hooks': [entry('facts.test.ts'), entry('facts.ts'), entry('scan.test.ts'), entry('scan.ts')],
        '/repo/docs': [entry('guide.md')],
      },
      files: { '/repo/package.json': '{"devDependencies":{"typescript":"7.0.2"}}' },
    })

    expect(scan.findings.filter(finding => finding.kind === 'test')).toEqual([
      { kind: 'test', label: 'JS/TS test files', evidence: 'cadre/hooks/facts.test.ts' },
    ])
    expect(scan.languages).toEqual(['TypeScript'])
    expect(scan.codeDirs).toEqual(['cadre'])
    expect(scan.hasSource).toBe(true)
  })

  test('an empty repo gives no findings, no source and no warnings', async () => {
    const scan = await scanOf({ dirs: { '/repo': [] } })

    expect(scan.findings).toEqual([])
    expect(scan.languages).toEqual([])
    expect(scan.codeDirs).toEqual([])
    expect(scan.hasSource).toBe(false)
    expect(scan.isTruncated).toBe(false)
    expect(scan.warnings).toEqual([])
  })

  test('with no .cadre folder the scan shows an absent cadre state', async () => {
    const scan = await scanOf({ dirs: { '/repo': [entry('a.ts')] } })

    expect(scan.cadre).toEqual({
      dir: 'absent',
      manifest: null,
      manifestState: 'absent',
      state: null,
      stateState: 'absent',
    })
  })

  test('a root with a trailing slash is scanned like the root without one', async () => {
    const world = memWorld({ dirs: { '/repo': [entry('src', 'dir')], '/repo/src': [entry('a.test.ts')] } })
    const scan = await scanRepo(memIo(world, []).io, '/repo/')

    expect(findingOf(scan, 'test', 'JS/TS test files')).toEqual({
      kind: 'test',
      label: 'JS/TS test files',
      evidence: 'src/a.test.ts',
    })
    expect(scan.warnings).toEqual([])
  })

  test('folders at depth 0 to 2 are listed and one at depth 3 is not, so a file has at most 3 segments', async () => {
    const run = spiedIo(
      memWorld({
        dirs: {
          '/repo': [entry('a', 'dir')],
          '/repo/a': [entry('b', 'dir'), entry('one.ts')],
          '/repo/a/b': [entry('c', 'dir'), entry('three.test.ts')],
          '/repo/a/b/c': [entry('four.spec.ts')],
        },
      }),
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(run.listed).toEqual(['/repo', '/repo/a', '/repo/a/b'])
    expect(findingOf(scan, 'test', 'JS/TS test files')).toEqual({
      kind: 'test',
      label: 'JS/TS test files',
      evidence: 'a/b/three.test.ts',
    })
    expect(scan.isTruncated).toBe(true)
  })

  test('the skip folders are never listed, at the root or deeper', async () => {
    const dirs: Record<string, readonly PortEntry[]> = {
      '/repo': [entry('src', 'dir'), ...SKIP_DIRS.map(name => entry(name, 'dir'))],
      '/repo/src': [entry('a.ts'), ...SKIP_DIRS.map(name => entry(name, 'dir'))],
    }
    for (const name of SKIP_DIRS) {
      dirs[`/repo/${name}`] = [entry('x.test.ts'), entry('playwright.config.ts')]
      dirs[`/repo/src/${name}`] = [entry('y.test.ts')]
    }
    const run = spiedIo(memWorld({ dirs }))
    const scan = await scanRepo(run.io, '/repo')

    expect(run.listed).toEqual(['/repo', '/repo/src'])
    expect(scan.findings).toEqual([])
    expect(scan.isTruncated).toBe(false)
  })

  test('a link is never walked into, whether the host calls it other or dir', async () => {
    const alias: PortEntry = { ...entry('alias', 'dir'), isLink: true }
    const run = spiedIo(
      memWorld({
        dirs: {
          '/repo': [alias, link('linked'), entry('real', 'dir')],
          '/repo/alias': [entry('a.test.ts')],
          '/repo/linked': [entry('b.test.ts')],
          '/repo/real': [entry('c.ts')],
        },
      }),
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(run.listed).toEqual(['/repo', '/repo/real'])
    expect(findingOf(scan, 'test', 'JS/TS test files')).toBeUndefined()
    expect(scan.codeDirs).toEqual(['real'])
  })

  test('a skipped folder or a link at the depth cap is not a truncation', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('a', 'dir')],
        '/repo/a': [entry('b', 'dir')],
        '/repo/a/b': [entry('node_modules', 'dir'), link('ln'), entry('x.ts')],
      },
    })

    expect(scan.isTruncated).toBe(false)
    expect(scan.languages).toEqual(['TypeScript'])
  })

  test('the walk stops at 2000 entries and says so', async () => {
    const scan = await scanOf({ dirs: { '/repo': [...plainFiles(MAX_SCAN_ENTRIES), entry('zz.test.ts')] } })

    expect(scan.isTruncated).toBe(true)
    expect(findingOf(scan, 'test', 'JS/TS test files')).toBeUndefined()
  })

  test('exactly 2000 entries is not a truncation', async () => {
    const scan = await scanOf({ dirs: { '/repo': [...plainFiles(MAX_SCAN_ENTRIES - 1), entry('zz.test.ts')] } })

    expect(scan.isTruncated).toBe(false)
    expect(findingOf(scan, 'test', 'JS/TS test files')).toEqual({
      kind: 'test',
      label: 'JS/TS test files',
      evidence: 'zz.test.ts',
    })
  })

  test('the 2000 entries are counted across every folder walked', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('a', 'dir'), ...plainFiles(1000)],
        '/repo/a': [...plainFiles(1000), entry('zz.test.ts')],
      },
    })

    expect(scan.isTruncated).toBe(true)
    expect(findingOf(scan, 'test', 'JS/TS test files')).toBeUndefined()
  })

  test('a package.json that links out of the repo is not read and gives a could not read warning', async () => {
    const run = memIo(
      memWorld({
        dirs: { '/repo': [link('package.json')] },
        files: { '/repo/package.json': packageOf({ react: '1' }) },
        realPaths: { '/repo/package.json': '/elsewhere/package.json' },
      }),
      [],
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(run.reads).toEqual([])
    expect(scan.warnings).toEqual(['could not read package.json (treated as unknown)'])
    expect(scan.findings).toEqual([])
  })

  test('a package.json listed as a file that resolves outside the repo is not read either', async () => {
    const outside: PortEntry = { ...entry('package.json'), isLink: true }
    const run = memIo(
      memWorld({
        dirs: { '/repo': [outside] },
        files: { '/repo/package.json': packageOf({ react: '1' }) },
        realPaths: { '/repo/package.json': '/elsewhere/package.json' },
      }),
      [],
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(run.reads).toEqual([])
    expect(scan.warnings).toEqual(['could not read package.json (treated as unknown)'])
    expect(findingOf(scan, 'fe', 'react')).toBeUndefined()
  })

  test('a package.json that links to a file inside the repo is read', async () => {
    const scan = await scanOf({
      dirs: { '/repo': [link('package.json')] },
      files: { '/repo/package.json': packageOf({ react: '1' }) },
      realPaths: { '/repo/package.json': '/repo/config/pkg.json' },
    })

    expect(findingOf(scan, 'fe', 'react')).toEqual({ kind: 'fe', label: 'react', evidence: 'package.json' })
    expect(scan.warnings).toEqual([])
  })

  test('a package.json with bad JSON adds a could not parse warning and keeps its file marker', async () => {
    const scan = await scanOf({
      dirs: { '/repo': [entry('package.json')] },
      files: { '/repo/package.json': '{ not json' },
    })

    expect(scan.warnings).toEqual(['could not parse package.json as JSON (treated as unknown)'])
    expect(scan.findings).toEqual([
      { kind: 'lang', label: 'JavaScript/TypeScript (package.json)', evidence: 'package.json' },
    ])
  })

  test('a package.json that is JSON but not an object adds the same warning', async () => {
    for (const text of ['[]', 'null', '"x"', '1']) {
      const scan = await scanOf({ dirs: { '/repo': [entry('package.json')] }, files: { '/repo/package.json': text } })
      expect(scan.warnings).toEqual(['could not parse package.json as JSON (treated as unknown)'])
    }
  })

  test('a package.json over the read cap or that cannot be read gives the could not read warning', async () => {
    const huge = await scanOf({
      dirs: { '/repo': [entry('package.json')] },
      files: { '/repo/package.json': 'x'.repeat(MAX_READ_BYTES + 1) },
    })
    const unreadable = await scanOf({
      dirs: { '/repo': [entry('package.json')] },
      unknownPaths: ['/repo/package.json'],
    })

    expect(huge.warnings).toEqual(['could not read package.json (treated as unknown)'])
    expect(unreadable.warnings).toEqual(['could not read package.json (treated as unknown)'])
  })

  test('a package.json in the root or one folder down is read and one two folders down is not', async () => {
    const run = spiedIo(
      memWorld({
        dirs: {
          '/repo': [entry('package.json'), entry('packages', 'dir'), entry('web', 'dir')],
          '/repo/packages': [entry('app', 'dir')],
          '/repo/packages/app': [entry('package.json')],
          '/repo/web': [entry('package.json')],
        },
        files: {
          '/repo/package.json': packageOf({}),
          '/repo/packages/app/package.json': packageOf({ react: '18' }),
          '/repo/web/package.json': packageOf({ vue: '3' }),
        },
      }),
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(run.reads).toEqual(['/repo/package.json', '/repo/web/package.json'])
    expect(findingOf(scan, 'fe', 'vue')).toEqual({ kind: 'fe', label: 'vue', evidence: 'web/package.json' })
    expect(findingOf(scan, 'fe', 'react')).toBeUndefined()
  })

  test('dependencies, devDependencies and peerDependencies count by name; values are never kept', async () => {
    const scan = await scanOf({
      dirs: { '/repo': [entry('package.json')] },
      files: {
        '/repo/package.json': JSON.stringify({
          dependencies: { express: SECRET_FIXTURES[3] },
          devDependencies: { vitest: '^1.0.0', React: '1.0.0' },
          peerDependencies: { react: '^18.0.0' },
          optionalDependencies: { svelte: '1.0.0' },
        }),
      },
    })

    expect(findingOf(scan, 'be', 'express')).toEqual({ kind: 'be', label: 'express', evidence: 'package.json' })
    expect(findingOf(scan, 'test', 'vitest')).toEqual({ kind: 'test', label: 'vitest', evidence: 'package.json' })
    expect(findingOf(scan, 'fe', 'react')).toEqual({ kind: 'fe', label: 'react', evidence: 'package.json' })
    expect(findingOf(scan, 'fe', 'svelte')).toBeUndefined()
    expect(findingOf(scan, 'fe', 'React')).toBeUndefined()
    expect(leaks(JSON.stringify(scan), SECRET_FIXTURES)).toEqual([])
  })

  test('a dependency group that is not an object adds nothing and no warning', async () => {
    const scan = await scanOf({
      dirs: { '/repo': [entry('package.json')] },
      files: { '/repo/package.json': '{"dependencies":["react"],"devDependencies":"vitest","peerDependencies":null}' },
    })

    expect(scan.findings).toEqual([
      { kind: 'lang', label: 'JavaScript/TypeScript (package.json)', evidence: 'package.json' },
    ])
    expect(scan.warnings).toEqual([])
  })

  test('a root listing that fails gives a warning, no findings and no source', async () => {
    for (const over of [{ dirs: {} }, { unknownPaths: ['/repo'] }]) {
      const scan = await scanOf(over)

      expect(scan.warnings).toEqual(['could not list the repo root (treated as unknown)'])
      expect(scan.findings).toEqual([])
      expect(scan.hasSource).toBe(false)
      expect(scan.languages).toEqual([])
      expect(scan.isTruncated).toBe(false)
    }
  })

  test('a folder whose listing fails gives a warning naming it and the walk goes on', async () => {
    const scan = await scanOf({
      dirs: { '/repo': [entry('gone', 'dir'), entry('src', 'dir')], '/repo/src': [entry('a.ts')] },
    })

    expect(scan.warnings).toEqual(['could not list gone (treated as unknown)'])
    expect(scan.languages).toEqual(['TypeScript'])
  })

  test('an entry name that clean would change is skipped with a warning and gives no finding', async () => {
    const hostile = `a${String.fromCharCode(0x202e)}b.test.ts`
    const tooLong = `${'a'.repeat(256)}.test.ts`
    const scan = await scanOf({ dirs: { '/repo': [entry(hostile), entry(tooLong), entry('ok.spec.ts')] } })

    expect(findingOf(scan, 'test', 'JS/TS test files')).toEqual({
      kind: 'test',
      label: 'JS/TS test files',
      evidence: 'ok.spec.ts',
    })
    expect(scan.warnings).toHaveLength(2)
    expect(scan.warnings).toContain('ignored repo entry "ab.test.ts": its name has hidden characters or is too long')
    expect(scan.warnings.filter(warning => warning.startsWith('ignored repo entry "aaaa'))).toHaveLength(1)
  })

  test('an empty name, dot and dot-dot are never walked', async () => {
    const run = spiedIo(
      memWorld({
        dirs: {
          '/repo': [entry('', 'dir'), entry('.', 'dir'), entry('..', 'dir'), entry('real', 'dir')],
          '/repo/': [entry('leak.test.ts')],
          '/repo/.': [entry('leak.test.ts')],
          '/repo/..': [entry('leak.test.ts')],
          '/repo/real': [],
        },
      }),
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(run.listed).toEqual(['/repo', '/repo/real'])
    expect(scan.findings).toEqual([])
    expect(scan.warnings).toEqual([])
  })

  test('a finding found twice keeps the first path in breadth-first order, each listing sorted by name', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('c', 'dir'), entry('b', 'dir'), entry('a', 'dir')],
        '/repo/a': [entry('inner', 'dir')],
        '/repo/a/inner': [entry('deep.test.ts')],
        '/repo/b': [entry('y.test.ts'), entry('x.test.ts')],
        '/repo/c': [entry('z.test.ts')],
      },
    })

    expect(scan.findings.filter(finding => finding.kind === 'test')).toEqual([
      { kind: 'test', label: 'JS/TS test files', evidence: 'b/x.test.ts' },
    ])
  })

  test('findings are sorted by kind, then by label', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [
          entry('.rspec'),
          entry('Cargo.toml'),
          entry('Gemfile'),
          entry('conftest.py'),
          entry('cypress', 'dir'),
          entry('cypress.config.ts'),
          entry('go.mod'),
          entry('jest.config.js'),
          entry('playwright.config.ts'),
          entry('pyproject.toml'),
          entry('pytest.ini'),
          entry('vitest.config.ts'),
        ],
        '/repo/cypress': [],
      },
    })

    expect(scan.findings.map(finding => `${finding.kind}: ${finding.label}`)).toEqual([
      'e2e: Cypress config',
      'e2e: Cypress folder',
      'e2e: Playwright config',
      'lang: Go (go.mod)',
      'lang: Python (pyproject.toml)',
      'lang: Ruby (Gemfile)',
      'lang: Rust (Cargo.toml)',
      'test: Jest config',
      'test: RSpec config',
      'test: Vitest config',
      'test: pytest config',
      'test: pytest conftest',
    ])
  })

  test('the test file patterns of every language give a test finding with their own label', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('a_test.go'), entry('b_spec.rb'), entry('c.spec.tsx'), entry('test_d.py')],
      },
    })

    expect(scan.findings.map(finding => `${finding.kind}: ${finding.label} <- ${finding.evidence}`)).toEqual([
      'test: Go test files <- a_test.go',
      'test: JS/TS test files <- c.spec.tsx',
      'test: RSpec spec files <- b_spec.rb',
      'test: pytest test files <- test_d.py',
    ])
  })

  test('a folder named like a file marker, and a file named like a folder marker, are no markers', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('Gemfile', 'dir'), entry('cypress'), entry('package.json', 'dir')],
        '/repo/Gemfile': [],
        '/repo/package.json': [],
      },
    })

    expect(scan.findings).toEqual([])
    expect(scan.warnings).toEqual([])
  })

  test('the languages come from the source extensions, each once, sorted', async () => {
    const names = ['a.ts', 'a.tsx', 'b.js', 'b.jsx', 'b.mjs', 'b.cjs', 'c.py', 'd.rb', 'e.go', 'f.rs']
    const more = ['g.java', 'h.kt', 'i.swift', 'j.php', 'k.cs', 'notes.md', 'data.json', 'Makefile']
    const scan = await scanOf({ dirs: { '/repo': [...names, ...more].map(name => entry(name)) } })

    expect(scan.languages).toEqual([
      'C#',
      'Go',
      'Java',
      'JavaScript',
      'Kotlin',
      'PHP',
      'Python',
      'Ruby',
      'Rust',
      'Swift',
      'TypeScript',
    ])
    expect(scan.hasSource).toBe(true)
    expect(scan.codeDirs).toEqual([])
  })

  test('the code folders are the top-level folders that hold source files, sorted', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [
          entry('app', 'dir'),
          entry('docs', 'dir'),
          entry('lib', 'dir'),
          entry('main.go'),
          entry('src', 'dir'),
        ],
        '/repo/app': [entry('models', 'dir')],
        '/repo/app/models': [entry('user.rb')],
        '/repo/docs': [entry('readme.md')],
        '/repo/lib': [entry('tool.py')],
        '/repo/src': [entry('x.ts')],
      },
    })

    expect(scan.codeDirs).toEqual(['app', 'lib', 'src'])
    expect(scan.languages).toEqual(['Go', 'Python', 'Ruby', 'TypeScript'])
  })

  test('an extension that is a name on the object prototype is not a source language', async () => {
    const names = ['a.constructor', 'b.toString', 'c.__proto__', 'd.hasOwnProperty', 'e.valueOf']
    const scan = await scanOf({ dirs: { '/repo': names.map(name => entry(name)) } })

    expect(scan.languages).toEqual([])
    expect(scan.hasSource).toBe(false)
  })

  test('a dotfile or a name with no dot is not a source file, whatever it is called', async () => {
    const names = ['go', 'ts', 'py', '.ts', '.py', '.go']
    const scan = await scanOf({ dirs: { '/repo': names.map(name => entry(name)) } })

    expect(scan.languages).toEqual([])
    expect(scan.hasSource).toBe(false)
  })

  test('the scan asks nothing, logs nothing and sends nothing to the model', async () => {
    const run = memIo(
      memWorld({ dirs: { '/repo': [entry('src', 'dir')], '/repo/src': [entry('a.ts')] } }),
      [],
    )
    await scanRepo(run.io, '/repo')

    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([])
    expect(run.prompts).toEqual([])
  })
})

describe('MARKER_ROWS', () => {
  /** The row of a kind and label, or undefined. */
  function rowOf(kind: ScanKind, label: string): MarkerRow | undefined {
    return MARKER_ROWS.find(row => row.kind === kind && row.label === label)
  }

  /** Whether a row matches a file name, false for a row that matches something else. */
  function matchesFile(row: MarkerRow | undefined, name: string): boolean {
    return row !== undefined && 'file' in row.match && row.match.file.test(name)
  }

  test('the table, every row and every match are frozen', () => {
    expect(Object.isFrozen(MARKER_ROWS)).toBe(true)
    expect(MARKER_ROWS.every(row => Object.isFrozen(row))).toBe(true)
    expect(MARKER_ROWS.every(row => Object.isFrozen(row.match))).toBe(true)
  })

  test('each kind and label is in the table once', () => {
    const keys = MARKER_ROWS.map(row => `${row.kind}: ${row.label}`)

    expect(new Set(keys).size).toBe(keys.length)
  })

  test('the dependency rows map each framework to its kind, labelled by its package name', () => {
    const deps: readonly (readonly [ScanKind, string])[] = [
      ['fe', 'react'],
      ['fe', 'vue'],
      ['fe', 'next'],
      ['fe', 'svelte'],
      ['fe', '@angular/core'],
      ['be', 'express'],
      ['be', '@nestjs/core'],
      ['be', 'fastify'],
      ['be', 'koa'],
      ['be', 'hono'],
      ['test', 'jest'],
      ['test', 'vitest'],
      ['test', 'mocha'],
      ['e2e', '@playwright/test'],
      ['e2e', 'cypress'],
    ]
    for (const [kind, dep] of deps) {
      const row = rowOf(kind, dep)
      expect(row !== undefined && 'dep' in row.match && row.match.dep === dep).toBe(true)
    }
  })

  test('the marker file rows name their language, test config or E2E config', () => {
    const files: readonly (readonly [ScanKind, string, string])[] = [
      ['lang', 'Ruby (Gemfile)', 'Gemfile'],
      ['lang', 'Go (go.mod)', 'go.mod'],
      ['lang', 'Python (pyproject.toml)', 'pyproject.toml'],
      ['lang', 'Rust (Cargo.toml)', 'Cargo.toml'],
      ['lang', 'JavaScript/TypeScript (package.json)', 'package.json'],
      ['test', 'Jest config', 'jest.config.ts'],
      ['test', 'Vitest config', 'vitest.config.mjs'],
      ['test', 'RSpec config', '.rspec'],
      ['test', 'pytest config', 'pytest.ini'],
      ['test', 'pytest conftest', 'conftest.py'],
      ['e2e', 'Playwright config', 'playwright.config.ts'],
      ['e2e', 'Cypress config', 'cypress.config.js'],
    ]
    for (const [kind, label, name] of files) {
      expect(matchesFile(rowOf(kind, label), name)).toBe(true)
    }
  })

  test('a marker file row matches the whole name, not a longer or a prefixed one', () => {
    expect(matchesFile(rowOf('lang', 'Ruby (Gemfile)'), 'Gemfile.lock')).toBe(false)
    expect(matchesFile(rowOf('lang', 'Ruby (Gemfile)'), 'xGemfile')).toBe(false)
    expect(matchesFile(rowOf('lang', 'Go (go.mod)'), 'go.mod.bak')).toBe(false)
    expect(matchesFile(rowOf('test', 'pytest config'), 'pytest.ini.bak')).toBe(false)
    expect(matchesFile(rowOf('test', 'Jest config'), 'myjest.config.js')).toBe(false)
    expect(matchesFile(rowOf('e2e', 'Playwright config'), 'playwright.configure.ts')).toBe(false)
  })

  test('the test file rows match the name patterns of each language', () => {
    const js = rowOf('test', 'JS/TS test files')
    const matching = ['a.test.ts', 'a.spec.js', 'a.test.tsx', 'a.spec.jsx', 'a.test.mjs', 'a.test.cjs', 'a.test.cts']
    for (const name of matching) {
      expect(matchesFile(js, name)).toBe(true)
    }
    for (const name of ['attest.ts', 'a.test.json', 'a.test.ts.map', 'test.ts', 'a.tests.ts']) {
      expect(matchesFile(js, name)).toBe(false)
    }
    expect(matchesFile(rowOf('test', 'Go test files'), 'a_test.go')).toBe(true)
    expect(matchesFile(rowOf('test', 'Go test files'), 'a_test.gox')).toBe(false)
    expect(matchesFile(rowOf('test', 'RSpec spec files'), 'a_spec.rb')).toBe(true)
    expect(matchesFile(rowOf('test', 'RSpec spec files'), 'a_spec.rbi')).toBe(false)
    expect(matchesFile(rowOf('test', 'pytest test files'), 'test_a.py')).toBe(true)
    expect(matchesFile(rowOf('test', 'pytest test files'), 'test_.py')).toBe(false)
    expect(matchesFile(rowOf('test', 'pytest test files'), 'a_test.py')).toBe(false)
  })

  test('the cypress folder is an E2E marker by its exact name', () => {
    const row = rowOf('e2e', 'Cypress folder')

    expect(row !== undefined && 'dir' in row.match && row.match.dir === 'cypress').toBe(true)
  })
})

describe('scan tables', () => {
  test('the walk is limited to depth 3 and 2000 entries', () => {
    expect(MAX_SCAN_DEPTH).toBe(3)
    expect(MAX_SCAN_ENTRIES).toBe(2000)
  })

  test('SKIP_DIRS lists the folders the walk never lists, and is frozen', () => {
    expect(SKIP_DIRS).toEqual([
      '.git',
      'node_modules',
      'vendor',
      'dist',
      'build',
      'target',
      '.venv',
      'venv',
      '__pycache__',
      'coverage',
      '.cadre',
      '.planning',
      '.claude',
      'thoughts',
    ])
    expect(Object.isFrozen(SKIP_DIRS)).toBe(true)
  })

  test('SOURCE_EXTENSIONS names the language of each source extension, and is frozen', () => {
    expect(SOURCE_EXTENSIONS).toEqual({
      ts: 'TypeScript',
      tsx: 'TypeScript',
      js: 'JavaScript',
      jsx: 'JavaScript',
      mjs: 'JavaScript',
      cjs: 'JavaScript',
      py: 'Python',
      rb: 'Ruby',
      go: 'Go',
      rs: 'Rust',
      java: 'Java',
      kt: 'Kotlin',
      swift: 'Swift',
      php: 'PHP',
      cs: 'C#',
    })
    expect(Object.isFrozen(SOURCE_EXTENSIONS)).toBe(true)
  })
})

describe('readRepoFile', () => {
  test('reads a regular file whose real path is inside the root', async () => {
    const run = memIo(memWorld({ files: { '/repo/package.json': '{"a":1}' } }), [])

    const read = await readRepoFile(run.io, '/repo', 'package.json', MAX_READ_BYTES)

    expect(read).toEqual({ state: 'text', text: '{"a":1}' })
    expect(run.reads).toEqual(['/repo/package.json'])
  })

  test('a nested path is read below the root, and a root with a trailing slash works the same', async () => {
    const run = memIo(memWorld({ files: { '/repo/web/package.json': '{}' } }), [])

    const plain = await readRepoFile(run.io, '/repo', 'web/package.json', MAX_READ_BYTES)
    const slashed = await readRepoFile(run.io, '/repo/', 'web/package.json', MAX_READ_BYTES)

    expect(plain).toEqual({ state: 'text', text: '{}' })
    expect(slashed).toEqual({ state: 'text', text: '{}' })
  })

  test('a real path outside the root is unknown and the file is never read', async () => {
    const run = memIo(
      memWorld({
        files: { '/repo/package.json': '{"secret":true}' },
        realPaths: { '/repo/package.json': '/etc/package.json' },
      }),
      [],
    )

    expect(await readRepoFile(run.io, '/repo', 'package.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
    expect(run.reads).toEqual([])
  })

  test('a real path in a sibling folder whose name starts like the root is outside it', async () => {
    const run = memIo(
      memWorld({ files: { '/repo/a.json': '{}' }, realPaths: { '/repo/a.json': '/repo-other/a.json' } }),
      [],
    )

    expect(await readRepoFile(run.io, '/repo', 'a.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
    expect(run.reads).toEqual([])
  })

  test('a link whose real path is inside the root is read', async () => {
    const run = memIo(
      memWorld({ files: { '/repo/a.json': '{}' }, realPaths: { '/repo/a.json': '/repo/config/real.json' } }),
      [],
    )

    expect(await readRepoFile(run.io, '/repo', 'a.json', MAX_READ_BYTES)).toEqual({ state: 'text', text: '{}' })
  })

  test('a real path that is the root itself is not a file inside it', async () => {
    const run = memIo(memWorld({ files: { '/repo/a.json': '{}' }, realPaths: { '/repo/a.json': '/repo' } }), [])

    expect(await readRepoFile(run.io, '/repo', 'a.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
    expect(run.reads).toEqual([])
  })

  test('a folder where a file is expected is unknown and never read', async () => {
    const run = memIo(memWorld({ dirs: { '/repo/package.json': [] } }), [])

    expect(await readRepoFile(run.io, '/repo', 'package.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
    expect(run.reads).toEqual([])
  })

  test('a stat that gives no real path is unknown and the file is never read', async () => {
    const run = memIo(memWorld({ files: { '/repo/a.json': '{}' } }), [])
    const io: InitIo = { ...run.io, stat: async () => ({ kind: 'file', size: 2, isLink: false }) }

    expect(await readRepoFile(io, '/repo', 'a.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
    expect(run.reads).toEqual([])
  })

  test('a path with no stat falls back to the port read, so a missing file stays absent', async () => {
    const run = memIo(memWorld({}), [])

    expect(await readRepoFile(run.io, '/repo', 'missing.json', MAX_READ_BYTES)).toEqual({ state: 'absent' })
    expect(run.reads).toEqual(['/repo/missing.json'])
  })

  test('a path that cannot be stat or read is unknown, never absent', async () => {
    const run = memIo(memWorld({ unknownPaths: ['/repo/a.json'] }), [])

    expect(await readRepoFile(run.io, '/repo', 'a.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
  })

  test('a file over the cap comes back too-large with its UTF-8 size', async () => {
    const run = memIo(memWorld({ files: { '/repo/a.json': 'abcdefghijk' } }), [])

    expect(await readRepoFile(run.io, '/repo', 'a.json', 10)).toEqual({ state: 'too-large', bytes: 11 })
  })
})
