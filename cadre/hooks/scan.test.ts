import { describe, expect, test } from 'claude-code/testing'

import type { InitIo, PortEntry, PortRead, RepoScan, ScanFinding, ScanKind } from '../types'
import { MAX_READ_BYTES } from './facts'
import { isDirInsideRoot } from './paths'
import {
  AUTOPILOT_FRESH_MS,
  autopilotReply,
  autopilotRunState,
  autopilotStatusPath,
  cargoDeps,
  composerDeps,
  findGitTop,
  gemfileGems,
  gitRootRefusal,
  goModules,
  listingState,
  MANIFEST_FILES,
  MARKER_ROWS,
  MAX_FOLDER_ENTRIES,
  MAX_RULE_ENTRIES,
  MAX_RULE_LEVELS,
  MAX_SCAN_DEPTH,
  MAX_SCAN_ENTRIES,
  missingState,
  notGitRepoReply,
  parseCadreState,
  parseManifest,
  pyprojectDeps,
  readRepoFile,
  requirementsDeps,
  ruleFiles,
  RULES_FOLDER,
  scanRepo,
  SKIP_DIRS,
  SOURCE_EXTENSIONS,
  undecidedFacts,
} from './scan'
import type { MarkerRow, RuleWalk } from './scan'
import { BIDI_OVERRIDE, entry, leaks, link, memIo, memWorld, SECRET_FIXTURES } from './testkit'
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

  test('trailing slashes on the home folder are dropped, so the path never holds a double slash', () => {
    expect(autopilotStatusPath('/', 's1')).toBe('/.claude/autopilot/s1.json')
    expect(autopilotStatusPath('/home/u/', 's1')).toBe('/home/u/.claude/autopilot/s1.json')
    expect(autopilotStatusPath('/home/u//', 's1')).toBe('/home/u/.claude/autopilot/s1.json')
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

/** `count` plain files named f0000.txt, f0001.txt and so on; none is a marker or a source file. */
function plainFiles(count: number): PortEntry[] {
  return Array.from({ length: count }, (_, index) => entry(`f${String(index).padStart(4, '0')}.txt`))
}

/** The scan of the repo /repo whose folders, files and links are in memory. */
async function scanOf(over: Partial<MemWorld>): Promise<RepoScan> {
  return scanRepo(memIo(memWorld(over), []).io, '/repo')
}

/** The folders the walk listed: `/repo/.cadre` is listed by the `.cadre` read, not by the walk, so it is left out. */
function walkedFolders(listed: readonly string[]): string[] {
  return listed.filter(path => path !== '/repo/.cadre')
}

/** The files read: the zero-byte probe of a `/repo/.cadre` that cannot be listed reads nothing, so it is left out. */
function fileReads(reads: readonly string[]): string[] {
  return reads.filter(path => path !== '/repo/.cadre')
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
    expect(scan.cappedFolders.length > 0 || scan.isOverallCapped).toBe(false)
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
    expect(scan.cappedFolders.length > 0 || scan.isOverallCapped).toBe(false)
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

  test('folders at depth 0 to 2 are listed and one at depth 3 is not, which is no truncation', async () => {
    const run = memIo(
      memWorld({
        dirs: {
          '/repo': [entry('a', 'dir')],
          '/repo/a': [entry('b', 'dir'), entry('one.ts')],
          '/repo/a/b': [entry('c', 'dir'), entry('three.test.ts')],
          '/repo/a/b/c': [entry('four.spec.ts')],
        },
      }),
      [],
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(walkedFolders(run.listed)).toEqual(['/repo', '/repo/a', '/repo/a/b'])
    expect(findingOf(scan, 'test', 'JS/TS test files')).toEqual({
      kind: 'test',
      label: 'JS/TS test files',
      evidence: 'a/b/three.test.ts',
    })
    expect(scan.cappedFolders.length > 0 || scan.isOverallCapped).toBe(false)
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
    const run = memIo(memWorld({ dirs }), [])
    const scan = await scanRepo(run.io, '/repo')

    expect(walkedFolders(run.listed)).toEqual(['/repo', '/repo/src'])
    expect(scan.findings).toEqual([])
    expect(scan.cappedFolders.length > 0 || scan.isOverallCapped).toBe(false)
  })

  test('a link is never walked into, whether the host calls it other or dir', async () => {
    const alias: PortEntry = { ...entry('alias', 'dir'), isLink: true }
    const run = memIo(
      memWorld({
        dirs: {
          '/repo': [alias, link('linked'), entry('real', 'dir')],
          '/repo/alias': [entry('a.test.ts')],
          '/repo/linked': [entry('b.test.ts')],
          '/repo/real': [entry('c.ts')],
        },
      }),
      [],
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(walkedFolders(run.listed)).toEqual(['/repo', '/repo/real'])
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

    expect(scan.cappedFolders.length > 0 || scan.isOverallCapped).toBe(false)
    expect(scan.languages).toEqual(['TypeScript'])
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

    expect(fileReads(run.reads)).toEqual([])
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

    expect(fileReads(run.reads)).toEqual([])
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
    const run = memIo(
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
      [],
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(fileReads(run.reads)).toEqual(['/repo/package.json', '/repo/web/package.json'])
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
      expect(scan.cappedFolders.length > 0 || scan.isOverallCapped).toBe(false)
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
    const hostile = `a${BIDI_OVERRIDE}b.test.ts`
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
    const run = memIo(
      memWorld({
        dirs: {
          '/repo': [entry('', 'dir'), entry('.', 'dir'), entry('..', 'dir'), entry('real', 'dir')],
          '/repo/': [entry('leak.test.ts')],
          '/repo/.': [entry('leak.test.ts')],
          '/repo/..': [entry('leak.test.ts')],
          '/repo/real': [],
        },
      }),
      [],
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(walkedFolders(run.listed)).toEqual(['/repo', '/repo/real'])
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

/** A marker row's match as text, so two rows can be compared: what kind of match it is and what it matches. */
function matchText(match: MarkerRow['match']): string {
  if ('dep' in match) return `dep ${match.dep}`
  if ('file' in match) return `file ${match.file.source}`
  if ('dir' in match) return `dir ${match.dir}`
  if ('manifest' in match) return `manifest ${match.manifest} ${match.name}`

  return `path ${match.entry} ${match.path.source}`
}

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

  test('each row is in the table once, and only a fact found in two places shares a kind and label (D-137)', () => {
    const rows = MARKER_ROWS.map(row => `${row.kind}: ${row.label}: ${matchText(row.match)}`)
    const labels = MARKER_ROWS.map(row => `${row.kind}: ${row.label}`)
    const shared = [...new Set(labels.filter((label, at) => labels.indexOf(label) !== at))].sort()

    expect(new Set(rows).size).toBe(rows.length)
    expect(shared).toEqual(['be: django', 'be: fastapi', 'be: flask', 'be: rails', 'be: symfony'])
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
      expect(row?.match).toMatchObject({ dep })
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

    expect(row?.match).toMatchObject({ dir: 'cypress' })
  })
})

describe('scan tables', () => {
  test('the walk is limited to depth 3, 200 entries in a deeper folder and 20,000 entries in all', () => {
    expect(MAX_SCAN_DEPTH).toBe(3)
    expect(MAX_FOLDER_ENTRIES).toBe(200)
    expect(MAX_SCAN_ENTRIES).toBe(20_000)
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

/**
 * A trainual-like Rails repo (02-UAT test 1): a root Gemfile with gem 'rails', a package.json with react, an .rspec,
 * and Ruby code under app/.
 */
const RAILS_REPO: Partial<MemWorld> = {
  dirs: {
    '/repo': [entry('.rspec'), entry('Gemfile'), entry('app', 'dir'), entry('package.json')],
    '/repo/app': [entry('models', 'dir')],
    '/repo/app/models': [entry('user.rb')],
  },
  files: {
    '/repo/Gemfile': ["source 'https://rubygems.org'", '', "gem 'rails', '8.1.3.1'", "gem 'pg'"].join('\n'),
    '/repo/package.json': packageOf({ react: '^18.0.0' }),
  },
}

describe('root manifests (G-02-1c)', () => {
  test('MANIFEST_FILES names the one root file each manifest kind is read from, and is frozen (D-137)', () => {
    expect(MANIFEST_FILES).toEqual({
      gemfile: 'Gemfile',
      pyproject: 'pyproject.toml',
      requirements: 'requirements.txt',
      gomod: 'go.mod',
      cargo: 'Cargo.toml',
      composer: 'composer.json',
    })
    expect(Object.isFrozen(MANIFEST_FILES)).toBe(true)
  })

  test('gemfileGems gives the name of a gem line in single or double quotes, with or without a version', () => {
    expect(gemfileGems("gem 'rails', '~> 7.1'")).toEqual(['rails'])
    expect(gemfileGems('gem "rails"')).toEqual(['rails'])
    expect(gemfileGems("gem  'rails'\r")).toEqual(['rails'])
  })

  test('gemfileGems reads an indented gem line inside a group block', () => {
    const text = ["source 'https://rubygems.org'", 'group :development, :test do', "  gem 'rails'", 'end'].join('\n')

    expect(gemfileGems(text)).toEqual(['rails'])
  })

  test('gemfileGems skips a commented gem line and every line that is not a gem line', () => {
    expect(gemfileGems("# gem 'rails'")).toEqual([])
    expect(gemfileGems("  # gem 'rails'")).toEqual([])
    const others = ["source 'https://rubygems.org'", "ruby '3.3.0'", 'gemspec', "gems 'rails'", 'gem rails']
    expect(gemfileGems([...others, "gem 'a b'"].join('\n'))).toEqual([])
  })

  test('gemfileGems gives the names in file order, each once, and needs the same quote on both sides', () => {
    const text = ["gem 'pg'", 'gem "rails"', "gem 'pg', '1.5'", "gem 'selenium-webdriver'", `gem 'mixed"`].join('\n')

    expect(gemfileGems(text)).toEqual(['pg', 'rails', 'selenium-webdriver'])
  })

  test('the Gemfile rows find Rails, Sinatra and Hanami as the backend, each labelled by its gem', () => {
    const isGemfileRow = (row: MarkerRow): boolean => 'manifest' in row.match && row.match.manifest === 'gemfile'
    const rows = MARKER_ROWS.filter(row => row.kind === 'be' && isGemfileRow(row))

    expect(rows.map(row => [row.label, row.match])).toEqual([
      ['rails', { manifest: 'gemfile', name: 'rails' }],
      ['sinatra', { manifest: 'gemfile', name: 'sinatra' }],
      ['hanami', { manifest: 'gemfile', name: 'hanami' }],
    ])
  })

  test("a trainual-like repo, gem 'rails' in the root Gemfile beside react, scans as the backend rails", async () => {
    const scan = await scanOf(RAILS_REPO)

    expect(scan.findings).toEqual([
      { kind: 'be', label: 'rails', evidence: 'Gemfile' },
      { kind: 'fe', label: 'react', evidence: 'package.json' },
      { kind: 'lang', label: 'JavaScript/TypeScript (package.json)', evidence: 'package.json' },
      { kind: 'lang', label: 'Ruby (Gemfile)', evidence: 'Gemfile' },
      { kind: 'test', label: 'RSpec config', evidence: '.rspec' },
    ])
    expect(scan.warnings).toEqual([])
  })

  test('Sinatra and Hanami in the root Gemfile are backends too; a gem no row names adds nothing', async () => {
    const scan = await scanOf({
      dirs: { '/repo': [entry('Gemfile')] },
      files: { '/repo/Gemfile': ["gem 'sinatra'", 'gem "hanami", "~> 2.1"', "gem 'puma'"].join('\n') },
    })

    expect(scan.findings).toEqual([
      { kind: 'be', label: 'hanami', evidence: 'Gemfile' },
      { kind: 'be', label: 'sinatra', evidence: 'Gemfile' },
      { kind: 'lang', label: 'Ruby (Gemfile)', evidence: 'Gemfile' },
    ])
  })

  test('a commented gem rails gives no backend', async () => {
    const scan = await scanOf({ dirs: { '/repo': [entry('Gemfile')] }, files: { '/repo/Gemfile': "# gem 'rails'" } })

    expect(findingOf(scan, 'be', 'rails')).toBeUndefined()
    expect(scan.warnings).toEqual([])
  })

  test('the root Gemfile is read after the package.json files, and a Gemfile one folder down never', async () => {
    const run = memIo(
      memWorld({
        dirs: {
          '/repo': [entry('Gemfile'), entry('api', 'dir'), entry('package.json')],
          '/repo/api': [entry('Gemfile'), entry('package.json')],
        },
        files: {
          '/repo/Gemfile': "gem 'rails'",
          '/repo/api/Gemfile': "gem 'sinatra'",
          '/repo/api/package.json': packageOf({}),
          '/repo/package.json': packageOf({}),
        },
      }),
      [],
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(fileReads(run.reads)).toEqual(['/repo/package.json', '/repo/api/package.json', '/repo/Gemfile'])
    expect(findingOf(scan, 'be', 'rails')).toEqual({ kind: 'be', label: 'rails', evidence: 'Gemfile' })
    expect(findingOf(scan, 'be', 'sinatra')).toBeUndefined()
  })

  test('a folder named Gemfile is not read as a manifest', async () => {
    const run = memIo(memWorld({ dirs: { '/repo': [entry('Gemfile', 'dir')], '/repo/Gemfile': [] } }), [])
    const scan = await scanRepo(run.io, '/repo')

    expect(fileReads(run.reads)).toEqual([])
    expect(scan.warnings).toEqual([])
  })

  test('a Gemfile that links out of the repo is not read and gives a could not read warning (T-02-57)', async () => {
    const run = memIo(
      memWorld({
        dirs: { '/repo': [link('Gemfile')] },
        files: { '/repo/Gemfile': "gem 'rails'" },
        realPaths: { '/repo/Gemfile': '/elsewhere/Gemfile' },
      }),
      [],
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(fileReads(run.reads)).toEqual([])
    expect(scan.warnings).toEqual(['could not read Gemfile (treated as unknown)'])
    expect(scan.findings).toEqual([])
  })

  test('a Gemfile over the read cap, or one that cannot be read, gives the could not read warning', async () => {
    const huge = await scanOf({
      dirs: { '/repo': [entry('Gemfile')] },
      files: { '/repo/Gemfile': `gem 'rails'\n${'#'.repeat(MAX_READ_BYTES)}` },
    })
    const unreadable = await scanOf({ dirs: { '/repo': [entry('Gemfile')] }, unknownPaths: ['/repo/Gemfile'] })

    expect(huge.warnings).toEqual(['could not read Gemfile (treated as unknown)'])
    expect(findingOf(huge, 'be', 'rails')).toBeUndefined()
    expect(unreadable.warnings).toEqual(['could not read Gemfile (treated as unknown)'])
  })

  test('only the names of gems a row names are kept: no version, source or other Gemfile text (T-02-57)', async () => {
    const text = [
      `source 'https://${SECRET_FIXTURES[0]}@gems.example'`,
      `gem 'rails', '${SECRET_FIXTURES[1]}'`,
      `gem '${SECRET_FIXTURES[3]}'`,
      `gem 'private', git: 'https://${SECRET_FIXTURES[2]}@git.example/private.git'`,
    ].join('\n')
    const scan = await scanOf({ dirs: { '/repo': [entry('Gemfile')] }, files: { '/repo/Gemfile': text } })

    expect(findingOf(scan, 'be', 'rails')).toEqual({ kind: 'be', label: 'rails', evidence: 'Gemfile' })
    expect(leaks(JSON.stringify(scan), SECRET_FIXTURES)).toEqual([])
  })
})

/** The findings of one kind, in scan order. */
function findingsOfKind(scan: RepoScan, kind: ScanKind): ScanFinding[] {
  return scan.findings.filter(finding => finding.kind === kind)
}

/** The scan of a repo whose root holds only this one file, with this text. */
async function scanOfFile(name: string, text: string): Promise<RepoScan> {
  return scanOf({ dirs: { '/repo': [entry(name)] }, files: { [`/repo/${name}`]: text } })
}

describe('manifest parsers (G-02-1c)', () => {
  test('pyprojectDeps reads the [project] dependencies on one line: each name lowercased, with _ as -', () => {
    const text = ['[project]', 'name = "app"', 'dependencies = ["Django>=4.2", "fastapi[all]", "typing_extensions"]']

    expect(pyprojectDeps(text.join('\n'))).toEqual(['django', 'fastapi', 'typing-extensions'])
  })

  test('pyprojectDeps reads [project] dependencies over several lines, and skips a commented one', () => {
    const text = [
      '[project]',
      'dependencies = [',
      '  "flask>=3",  # the web app',
      "  'requests',",
      '  # "django",',
      ']',
      'version = "1.0"',
      'keywords = ["django"]',
    ].join('\n')

    expect(pyprojectDeps(text)).toEqual(['flask', 'requests'])
  })

  test('pyprojectDeps reads every key before = in [tool.poetry.dependencies], in file order and once each', () => {
    const text = [
      '[tool.poetry.dependencies]',
      'python = "^3.11"',
      'Django = "^4.2"',
      'fastapi = { version = "^0.110", extras = ["all"] }',
      '"flask" = "^3"',
      'django = "^4.2"',
      '# celery = "^5"',
    ].join('\n')

    expect(pyprojectDeps(text)).toEqual(['python', 'django', 'fastapi', 'flask'])
  })

  test('pyprojectDeps reads no other table: the build system, optional dependencies, poetry groups, tools', () => {
    const text = [
      '[build-system]',
      'requires = ["setuptools", "django"]',
      '[project.optional-dependencies]',
      'web = ["flask"]',
      '[tool.poetry.group.dev.dependencies]',
      'fastapi = "^0.110"',
      '[tool.ruff]',
      'dependencies = ["fastapi"]',
    ].join('\n')

    expect(pyprojectDeps(text)).toEqual([])
  })

  test('requirementsDeps gives the name of each requirement line, lowercased, with _ as -', () => {
    const text = ['Django==4.2.1', 'flask>=3 ; python_version >= "3.9"', 'fastapi[all]', 'typing_extensions', '', ' x']

    expect(requirementsDeps(text.join('\n'))).toEqual(['django', 'flask', 'fastapi', 'typing-extensions', 'x'])
  })

  test('requirementsDeps skips every line that starts with # or -, such as -r base.txt and # flask', () => {
    const skipped = ['-r base.txt', '# flask', '--index-url https://example.org/simple', '-e .', '  # django']

    expect(requirementsDeps([...skipped, 'Flask', 'flask'].join('\n'))).toEqual(['flask'])
  })

  test('goModules gives the module of a require line, with a trailing /v<digits> removed', () => {
    expect(goModules('require github.com/labstack/echo/v4 v4.11.0')).toEqual(['github.com/labstack/echo'])
    expect(goModules('require gopkg.in/yaml.v3 v3.0.1')).toEqual(['gopkg.in/yaml.v3'])
  })

  test('goModules reads every line of a require block; comments, replace and the module line give nothing', () => {
    const text = [
      'module example.com/app',
      '',
      'go 1.22',
      '',
      'require (',
      '  github.com/gin-gonic/gin v1.9.1',
      '  // github.com/go-chi/chi/v5 v5.0.10',
      '  github.com/gofiber/fiber/v2 v2.52.0 // indirect',
      ')',
      '',
      'replace github.com/go-chi/chi => ../chi',
      'require github.com/gin-gonic/gin v1.9.1',
    ].join('\n')

    expect(goModules(text)).toEqual(['github.com/gin-gonic/gin', 'github.com/gofiber/fiber'])
  })

  test('cargoDeps gives every key before = in [dependencies] and the name of every [dependencies.<name>] table', () => {
    const text = [
      '[package]',
      'name = "app"',
      '',
      '[dependencies]',
      'actix-web = "4"',
      'serde = { version = "1", features = ["derive"] }',
      '"axum" = "0.7"',
      'tokio.workspace = true',
      '# rocket = "0.5"',
      '',
      '[dependencies.rocket]',
      'version = "0.5"',
      '',
      '[dev-dependencies]',
      'mockall = "0.12"',
    ].join('\n')

    expect(cargoDeps(text)).toEqual(['actix-web', 'serde', 'axum', 'tokio', 'rocket'])
  })

  test('composerDeps gives the keys of require and require-dev, in file order and once each', () => {
    const text = JSON.stringify({
      name: 'acme/app',
      require: { php: '^8.2', 'laravel/framework': '^11.0' },
      'require-dev': { 'phpunit/phpunit': '^11.0', php: '^8.2' },
      suggest: { 'symfony/symfony': 'x' },
    })

    expect(composerDeps(text)).toEqual(['php', 'laravel/framework', 'phpunit/phpunit'])
  })

  test('composerDeps is null for a text that is not a JSON object, so the scan warns', () => {
    for (const text of ['{ not json', '[]', 'null', '"x"']) {
      expect(composerDeps(text)).toBeNull()
    }
  })

  test('the manifest rows map each framework of each root manifest to its backend label (D-137)', () => {
    const rows = MARKER_ROWS.filter(row => row.kind === 'be' && 'manifest' in row.match)

    expect(rows.map(row => `${row.label} <- ${matchText(row.match)}`)).toEqual([
      'rails <- manifest gemfile rails',
      'sinatra <- manifest gemfile sinatra',
      'hanami <- manifest gemfile hanami',
      'django <- manifest pyproject django',
      'flask <- manifest pyproject flask',
      'fastapi <- manifest pyproject fastapi',
      'django <- manifest requirements django',
      'flask <- manifest requirements flask',
      'fastapi <- manifest requirements fastapi',
      'gin <- manifest gomod github.com/gin-gonic/gin',
      'echo <- manifest gomod github.com/labstack/echo',
      'fiber <- manifest gomod github.com/gofiber/fiber',
      'chi <- manifest gomod github.com/go-chi/chi',
      'actix-web <- manifest cargo actix-web',
      'axum <- manifest cargo axum',
      'rocket <- manifest cargo rocket',
      'laravel/framework <- manifest composer laravel/framework',
      'symfony <- manifest composer symfony/framework-bundle',
      'symfony <- manifest composer symfony/symfony',
    ])
  })

  test('pyproject.toml finds Django, Flask and FastAPI, with the file as evidence', async () => {
    const scan = await scanOfFile('pyproject.toml', '[project]\ndependencies = ["Django>=5", "flask", "fastapi"]')

    expect(findingsOfKind(scan, 'be')).toEqual([
      { kind: 'be', label: 'django', evidence: 'pyproject.toml' },
      { kind: 'be', label: 'fastapi', evidence: 'pyproject.toml' },
      { kind: 'be', label: 'flask', evidence: 'pyproject.toml' },
    ])
    expect(scan.warnings).toEqual([])
  })

  test('requirements.txt finds Django, Flask and FastAPI, with the file as evidence', async () => {
    const scan = await scanOfFile('requirements.txt', 'Django==5.0\nFlask>=3\nfastapi[all]\n')

    expect(findingsOfKind(scan, 'be')).toEqual([
      { kind: 'be', label: 'django', evidence: 'requirements.txt' },
      { kind: 'be', label: 'fastapi', evidence: 'requirements.txt' },
      { kind: 'be', label: 'flask', evidence: 'requirements.txt' },
    ])
  })

  test('a requirements.txt line -r base.txt and a line # flask give nothing', async () => {
    const scan = await scanOfFile('requirements.txt', '-r base.txt\n# flask\n')

    expect(scan.findings).toEqual([])
    expect(scan.warnings).toEqual([])
  })

  test('go.mod finds gin, echo, fiber and chi, a major version suffix included', async () => {
    const lines = [
      'require (',
      '\tgithub.com/gin-gonic/gin v1.9.1',
      '\tgithub.com/gofiber/fiber/v2 v2.52.0',
      '\tgithub.com/go-chi/chi/v5 v5.0.10',
      ')',
    ]
    const scan = await scanOfFile('go.mod', [...lines, 'require github.com/labstack/echo/v4 v4.11.0'].join('\n'))

    expect(findingsOfKind(scan, 'be')).toEqual([
      { kind: 'be', label: 'chi', evidence: 'go.mod' },
      { kind: 'be', label: 'echo', evidence: 'go.mod' },
      { kind: 'be', label: 'fiber', evidence: 'go.mod' },
      { kind: 'be', label: 'gin', evidence: 'go.mod' },
    ])
  })

  test('go.mod with require github.com/labstack/echo/v4 v4.11.0 gives echo', async () => {
    const scan = await scanOfFile('go.mod', 'module example.com/app\n\nrequire github.com/labstack/echo/v4 v4.11.0\n')

    expect(findingsOfKind(scan, 'be')).toEqual([{ kind: 'be', label: 'echo', evidence: 'go.mod' }])
  })

  test('Cargo.toml finds actix-web, axum and rocket, with the file as evidence', async () => {
    const text = ['[dependencies]', 'actix-web = "4"', 'axum = "0.7"', '', '[dependencies.rocket]', 'version = "0.5"']
    const scan = await scanOfFile('Cargo.toml', text.join('\n'))

    expect(findingsOfKind(scan, 'be')).toEqual([
      { kind: 'be', label: 'actix-web', evidence: 'Cargo.toml' },
      { kind: 'be', label: 'axum', evidence: 'Cargo.toml' },
      { kind: 'be', label: 'rocket', evidence: 'Cargo.toml' },
    ])
  })

  test('composer.json finds laravel/framework, and symfony from either Symfony package', async () => {
    const laravel = await scanOfFile('composer.json', JSON.stringify({ require: { 'laravel/framework': '^11' } }))
    const bundle = await scanOfFile('composer.json', JSON.stringify({ require: { 'symfony/framework-bundle': '7' } }))
    const full = await scanOfFile('composer.json', JSON.stringify({ 'require-dev': { 'symfony/symfony': '7' } }))

    expect(findingsOfKind(laravel, 'be')).toEqual([
      { kind: 'be', label: 'laravel/framework', evidence: 'composer.json' },
    ])
    expect(findingsOfKind(bundle, 'be')).toEqual([{ kind: 'be', label: 'symfony', evidence: 'composer.json' }])
    expect(findingsOfKind(full, 'be')).toEqual([{ kind: 'be', label: 'symfony', evidence: 'composer.json' }])
  })

  test('a composer.json that is not JSON gives the could not parse warning and no finding', async () => {
    const scan = await scanOfFile('composer.json', '{ "require": ')

    expect(scan.warnings).toEqual(['could not parse composer.json as JSON (treated as unknown)'])
    expect(scan.findings).toEqual([])
  })

  test('config/application.rb alone proves Rails, with the file as evidence', async () => {
    const scan = await scanOf({
      dirs: { '/repo': [entry('config', 'dir')], '/repo/config': [entry('application.rb'), entry('routes.rb')] },
    })

    expect(findingsOfKind(scan, 'be')).toEqual([{ kind: 'be', label: 'rails', evidence: 'config/application.rb' }])
  })

  test('an application.rb anywhere else, or a link at config/application.rb, is no proof of Rails', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('application.rb'), entry('app', 'dir'), entry('config', 'dir')],
        '/repo/app': [entry('config', 'dir')],
        '/repo/app/config': [entry('application.rb')],
        '/repo/config': [{ ...entry('application.rb'), isLink: true }],
      },
    })

    expect(findingsOfKind(scan, 'be')).toEqual([])
  })

  test('every root manifest is read after the package.json files, one at a time, in MANIFEST_FILES order', async () => {
    const names = ['package.json', ...Object.values(MANIFEST_FILES)].sort()
    const files = Object.fromEntries(names.map(name => [`/repo/${name}`, '{}']))
    const run = memIo(memWorld({ dirs: { '/repo': names.map(name => entry(name)) }, files }), [])
    await scanRepo(run.io, '/repo')

    expect(fileReads(run.reads)).toEqual([
      '/repo/package.json',
      '/repo/Gemfile',
      '/repo/pyproject.toml',
      '/repo/requirements.txt',
      '/repo/go.mod',
      '/repo/Cargo.toml',
      '/repo/composer.json',
    ])
  })

  test('a manifest one folder down is never read', async () => {
    const names = Object.values(MANIFEST_FILES)
    const files = Object.fromEntries(names.map(name => [`/repo/api/${name}`, 'django\n']))
    const dirs = { '/repo': [entry('api', 'dir')], '/repo/api': names.map(name => entry(name)) }
    const run = memIo(memWorld({ dirs, files }), [])
    const scan = await scanRepo(run.io, '/repo')

    expect(fileReads(run.reads)).toEqual([])
    expect(findingsOfKind(scan, 'be')).toEqual([])
  })

  test('each root manifest that cannot be read gives its own could not read warning, never an absence', async () => {
    const names = Object.values(MANIFEST_FILES)
    const scan = await scanOf({
      dirs: { '/repo': names.map(name => entry(name)) },
      unknownPaths: names.map(name => `/repo/${name}`),
    })

    expect(scan.warnings).toEqual(names.map(name => `could not read ${name} (treated as unknown)`))
  })
})

describe('E2E markers (G-02-1d)', () => {
  test('the path rows match an entry of their kind by its whole repo-relative path (D-137)', () => {
    const rows = MARKER_ROWS.filter(row => 'path' in row.match)

    expect(rows.map(row => `${row.kind}: ${row.label} <- ${matchText(row.match)}`)).toEqual([
      'be: rails <- path file ^config\\/application\\.rb$',
      'e2e: Rails system specs <- path dir ^spec\\/system$',
      'e2e: Rails system tests <- path dir ^test\\/system$',
      'e2e: Cucumber features <- path file ^features\\/(?:[^/]+\\/)?[^/]+\\.feature$',
    ])
  })

  test('spec/system is the E2E setup Rails system specs, with the folder as evidence', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('spec', 'dir')],
        '/repo/spec': [entry('models', 'dir'), entry('system', 'dir')],
        '/repo/spec/models': [],
        '/repo/spec/system': [],
      },
    })

    expect(findingsOfKind(scan, 'e2e')).toEqual([{ kind: 'e2e', label: 'Rails system specs', evidence: 'spec/system' }])
  })

  test('a system folder elsewhere, a file at spec/system and a link at spec/system are no E2E setup', async () => {
    const elsewhere = await scanOf({
      dirs: {
        '/repo': [entry('app', 'dir'), entry('system', 'dir')],
        '/repo/app': [entry('system', 'dir')],
        '/repo/app/system': [],
        '/repo/system': [],
      },
    })
    const file = await scanOf({ dirs: { '/repo': [entry('spec', 'dir')], '/repo/spec': [entry('system')] } })
    const links = await scanOf({
      dirs: {
        '/repo': [entry('spec', 'dir'), entry('test', 'dir')],
        '/repo/spec': [link('system')],
        '/repo/test': [{ ...entry('system', 'dir'), isLink: true }],
      },
    })

    expect(findingsOfKind(elsewhere, 'e2e')).toEqual([])
    expect(findingsOfKind(file, 'e2e')).toEqual([])
    expect(findingsOfKind(links, 'e2e')).toEqual([])
  })

  test('test/system is the E2E setup Rails system tests', async () => {
    const scan = await scanOf({ dirs: { '/repo': [entry('test', 'dir')], '/repo/test': [entry('system', 'dir')] } })

    expect(findingsOfKind(scan, 'e2e')).toEqual([{ kind: 'e2e', label: 'Rails system tests', evidence: 'test/system' }])
  })

  test('a .feature file in features/, or one folder below it, is the E2E setup Cucumber features', async () => {
    const top = await scanOf({
      dirs: { '/repo': [entry('features', 'dir')], '/repo/features': [entry('login.feature')] },
    })
    const nested = await scanOf({
      dirs: {
        '/repo': [entry('features', 'dir')],
        '/repo/features': [entry('auth', 'dir')],
        '/repo/features/auth': [entry('login.feature')],
      },
    })

    expect(findingsOfKind(top, 'e2e')).toEqual([
      { kind: 'e2e', label: 'Cucumber features', evidence: 'features/login.feature' },
    ])
    expect(findingsOfKind(nested, 'e2e')).toEqual([
      { kind: 'e2e', label: 'Cucumber features', evidence: 'features/auth/login.feature' },
    ])
  })

  test('a features/ folder with only a .rb file is no E2E setup, and nor is a .feature file outside it', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('docs', 'dir'), entry('features', 'dir'), entry('login.feature')],
        '/repo/docs': [entry('login.feature')],
        '/repo/features': [entry('env.rb'), entry('step_definitions', 'dir')],
        '/repo/features/step_definitions': [entry('login_steps.rb')],
      },
    })

    expect(findingsOfKind(scan, 'e2e')).toEqual([])
  })

  test('a capybara, selenium-webdriver or cuprite gem in the root Gemfile is an E2E setup', async () => {
    const gems = ["  gem 'capybara', '~> 3.40'", "  gem 'selenium-webdriver'", '  gem "cuprite"']
    const scan = await scanOfFile('Gemfile', ['group :test do', ...gems, 'end'].join('\n'))

    expect(findingsOfKind(scan, 'e2e')).toEqual([
      { kind: 'e2e', label: 'capybara', evidence: 'Gemfile' },
      { kind: 'e2e', label: 'cuprite', evidence: 'Gemfile' },
      { kind: 'e2e', label: 'selenium-webdriver', evidence: 'Gemfile' },
    ])
  })
})

/** The JS/TS test files finding with this evidence. */
function jsTests(evidence: string): ScanFinding {
  return { kind: 'test', label: 'JS/TS test files', evidence }
}

/** `count` plain files named after `prefix`, such as zf0000.txt; none is a marker or a source file. */
function filesAfter(prefix: string, count: number): PortEntry[] {
  return plainFiles(count).map(file => entry(`${prefix}${file.name}`))
}

describe('per-folder cap (G-02-1e)', () => {
  test('a folder two levels down with 250 entries gives its first 200, in name order, and is recorded', async () => {
    const listing = [...plainFiles(199), entry('g.test.ts'), entry('h.go'), ...filesAfter('z', 49)]
    const scan = await scanOf({
      dirs: { '/repo': [entry('a', 'dir')], '/repo/a': [entry('b', 'dir')], '/repo/a/b': listing },
    })

    expect(listing).toHaveLength(250)
    expect(findingOf(scan, 'test', 'JS/TS test files')).toEqual(jsTests('a/b/g.test.ts'))
    expect(scan.languages).toEqual(['TypeScript'])
    expect(scan.cappedFolders).toEqual(['a/b'])
    expect(scan.isOverallCapped).toBe(false)
    expect(scan.cappedFolders.length > 0 || scan.isOverallCapped).toBe(true)
  })

  test('a folder two levels down with exactly 200 entries is listed in full and not recorded', async () => {
    const listing = [...plainFiles(199), entry('g.test.ts')]
    const scan = await scanOf({
      dirs: { '/repo': [entry('a', 'dir')], '/repo/a': [entry('b', 'dir')], '/repo/a/b': listing },
    })

    expect(findingOf(scan, 'test', 'JS/TS test files')).toEqual(jsTests('a/b/g.test.ts'))
    expect(scan.cappedFolders).toEqual([])
    expect(scan.cappedFolders.length > 0 || scan.isOverallCapped).toBe(false)
  })

  test('a marker in a later folder two levels down is still found after a huge one', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('a', 'dir'), entry('b', 'dir')],
        '/repo/a': [entry('huge', 'dir')],
        '/repo/a/huge': plainFiles(5000),
        '/repo/b': [entry('later', 'dir')],
        '/repo/b/later': [entry('found.test.ts')],
      },
    })

    expect(findingOf(scan, 'test', 'JS/TS test files')).toEqual(jsTests('b/later/found.test.ts'))
    expect(scan.cappedFolders).toEqual(['a/huge'])
    expect(scan.isOverallCapped).toBe(false)
  })

  test('the root and a first-level folder of 3000 entries are seen in full and are not capped', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [...plainFiles(500), entry('big', 'dir'), entry('root.spec.ts')],
        '/repo/big': [...plainFiles(2999), entry('zz.test.ts')],
      },
    })

    expect(findingOf(scan, 'test', 'JS/TS test files')).toEqual(jsTests('root.spec.ts'))
    expect(scan.codeDirs).toEqual(['big'])
    expect(scan.cappedFolders).toEqual([])
    expect(scan.cappedFolders.length > 0 || scan.isOverallCapped).toBe(false)
  })

  test('the deeper folders listed only in part are sorted, whatever order the walk met them in', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('a', 'dir'), entry('a-b', 'dir')],
        '/repo/a': [entry('y', 'dir')],
        '/repo/a-b': [entry('x', 'dir')],
        '/repo/a/y': plainFiles(201),
        '/repo/a-b/x': plainFiles(201),
      },
    })

    expect(scan.cappedFolders).toEqual(['a-b/x', 'a/y'])
  })

  test('a walk over 20,000 entries stops at the safety cap and records it', async () => {
    const scan = await scanOf({ dirs: { '/repo': [...plainFiles(MAX_SCAN_ENTRIES), entry('zz.test.ts')] } })

    expect(scan.isOverallCapped).toBe(true)
    expect(scan.cappedFolders.length > 0 || scan.isOverallCapped).toBe(true)
    expect(scan.cappedFolders).toEqual([])
    expect(findingOf(scan, 'test', 'JS/TS test files')).toBeUndefined()
  })

  test('exactly 20,000 entries is no stop at the safety cap', async () => {
    const scan = await scanOf({ dirs: { '/repo': [...plainFiles(MAX_SCAN_ENTRIES - 1), entry('zz.test.ts')] } })

    expect(scan.isOverallCapped).toBe(false)
    expect(scan.cappedFolders.length > 0 || scan.isOverallCapped).toBe(false)
    expect(findingOf(scan, 'test', 'JS/TS test files')).toEqual(jsTests('zz.test.ts'))
  })

  test('the safety cap counts the entries of every folder walked', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('a', 'dir'), ...plainFiles(10_000)],
        '/repo/a': [...plainFiles(10_000), entry('zz.test.ts')],
      },
    })

    expect(scan.isOverallCapped).toBe(true)
    expect(findingOf(scan, 'test', 'JS/TS test files')).toBeUndefined()
  })

  test('undecidedFacts is empty when nothing was capped, even when nothing was found', async () => {
    const scan = await scanOf({ dirs: { '/repo': [entry('notes.md')] } })

    expect(undecidedFacts(scan)).toEqual([])
  })

  test('undecidedFacts names stack, tests and E2E, in that order, when a capped scan found none of them', async () => {
    const scan = await scanOf({
      dirs: { '/repo': [entry('a', 'dir')], '/repo/a': [entry('b', 'dir')], '/repo/a/b': plainFiles(201) },
    })

    expect(undecidedFacts(scan)).toEqual(['stack', 'tests', 'E2E'])
  })

  test('undecidedFacts leaves out a fact a capped scan found', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('a', 'dir'), entry('main.go')],
        '/repo/a': [entry('b', 'dir')],
        '/repo/a/b': plainFiles(201),
      },
    })

    expect(undecidedFacts(scan)).toEqual(['tests', 'E2E'])
  })

  test('a capped walk on a repo with languages, tests and E2E found gives undecidedFacts []', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('app', 'dir'), entry('playwright.config.ts'), entry('spec', 'dir')],
        '/repo/app': [entry('models', 'dir'), entry('views', 'dir')],
        '/repo/app/models': [entry('user.rb')],
        '/repo/app/views': plainFiles(250),
        '/repo/spec': [entry('user_spec.rb')],
      },
    })

    expect(scan.cappedFolders).toEqual(['app/views'])
    expect(undecidedFacts(scan)).toEqual([])
  })

  test('undecidedFacts counts a stop at the safety cap as capped too, by the same rule', async () => {
    const scan = await scanOf({ dirs: { '/repo': [entry('main.go')] } })

    expect(undecidedFacts({ ...scan, isOverallCapped: true })).toEqual(['tests', 'E2E'])
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

  test('a path with no stat is probed with a zero-byte read and its text is never returned', async () => {
    const run = memIo(memWorld({ files: { '/repo/a.json': '{"secret":true}' } }), [])
    const caps: number[] = []
    const io: InitIo = {
      ...run.io,
      stat: async () => null,
      read: async (path, maxBytes) => {
        caps.push(maxBytes)

        return run.io.read(path, maxBytes)
      },
    }

    expect(await readRepoFile(io, '/repo', 'a.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
    expect(await readRepoFile(io, '/repo', 'missing.json', MAX_READ_BYTES)).toEqual({ state: 'absent' })
    expect(caps).toEqual([0, 0])
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

const SHA_A = 'a'.repeat(64)
const SHA_B = '0123456789abcdef'.repeat(4)
const BE_FILE = { path: '.cadre/be/role.json', sha256: SHA_A, mode: 'file' }
const BE_LAUNCHER = { path: '.cadre/bin/be', sha256: SHA_B, mode: 'exec' }
const BACKSLASH = String.fromCharCode(92)
const ELLIPSIS = String.fromCharCode(0x2026)

/** A manifest as JSON text with these file entries; `over` replaces or adds top-level fields. */
function manifestText(files: readonly unknown[], over: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({ schema: 1, cadreVersion: '0.2.0', files, ...over })
}

/** A `.cadre/cadre.json` as JSON text; `over` replaces or adds fields. */
function stateText(over: Readonly<Record<string, unknown>> = {}): string {
  const state = {
    schema: 1,
    cadreVersion: '0.2.0',
    framework: 'gsd',
    gitPolicy: 'definitions',
    roles: ['be'],
    launchStart: { kind: 'git-root' },
    readUserMcp: false,
  }

  return JSON.stringify({ ...state, ...over })
}

/** The rules folder of the fixture repo. */
const RULES_DIR = '/repo/.claude/rules'

/** The walk the instruction read uses: links are not taken, and a folder must lie inside the repo (02-GAPS-B2 M4). */
const READER_WALK: RuleWalk = { isTakenLink: false, isFolderUsable: stat => isDirInsideRoot(stat, '/repo') }

/** The walk the parts-flow excludes use: links are taken, and any folder with a stat is listed (02-GAPS-B2 M4). */
const EXCLUDES_WALK: RuleWalk = { isTakenLink: true, isFolderUsable: stat => stat !== null }

/** The rule files of a world as one walk gives them. */
async function rulesOfWorld(world: MemWorld, walk: RuleWalk): Promise<readonly string[] | null> {
  return ruleFiles(memIo(world, []).io, '/repo', walk)
}

describe('rule walk (02-GAPS-B2 M4)', () => {
  test('the walk is bounded: .claude/rules, at most 5 folder levels and 500 listed entries', () => {
    expect([RULES_FOLDER, MAX_RULE_LEVELS, MAX_RULE_ENTRIES]).toEqual(['.claude/rules', 5, 500])
  })

  test('the .md files of .claude/rules and its sub-folders, relative to it, in compareText order', async () => {
    const world = memWorld({
      dirs: {
        [RULES_DIR]: [entry('x', 'dir'), entry('a.md'), entry('frontend', 'dir'), entry('notes.txt')],
        [`${RULES_DIR}/frontend`]: [entry('react.md')],
        [`${RULES_DIR}/x`]: [entry('y', 'dir')],
        [`${RULES_DIR}/x/y`]: [entry('z.md')],
      },
    })

    for (const walk of [READER_WALK, EXCLUDES_WALK]) {
      expect(await rulesOfWorld(world, walk)).toEqual(['a.md', 'frontend/react.md', 'x/y/z.md'])
    }
  })

  test('a file 6 folder levels down is not given, and the 6th level is not listed', async () => {
    const world = memWorld({
      dirs: {
        [RULES_DIR]: [entry('a', 'dir')],
        [`${RULES_DIR}/a`]: [entry('b', 'dir')],
        [`${RULES_DIR}/a/b`]: [entry('c', 'dir')],
        [`${RULES_DIR}/a/b/c`]: [entry('d', 'dir')],
        [`${RULES_DIR}/a/b/c/d`]: [entry('ok.md'), entry('e', 'dir')],
        [`${RULES_DIR}/a/b/c/d/e`]: [entry('deep.md')],
      },
    })
    const run = memIo(world, [])

    expect(await ruleFiles(run.io, '/repo', READER_WALK)).toEqual(['a/b/c/d/ok.md'])
    expect(run.listed).not.toContain(`${RULES_DIR}/a/b/c/d/e`)
  })

  test('past 500 listed entries the walk stops', async () => {
    const names = Array.from({ length: 499 }, (_, at) => entry(`r${String(at).padStart(3, '0')}.md`))
    const dirs = { [RULES_DIR]: [...names, entry('sub', 'dir')], [`${RULES_DIR}/sub`]: [entry('late.md')] }
    const found = (await rulesOfWorld(memWorld({ dirs }), EXCLUDES_WALK)) ?? []

    expect(found).toHaveLength(499)
    expect(found).not.toContain('sub/late.md')
  })

  test('the reader takes no link and skips a sub-folder that leaves the repo; the excludes take both', async () => {
    const world = memWorld({
      dirs: {
        [RULES_DIR]: [entry('a.md'), link('linked.md'), link('shared'), entry('out', 'dir')],
        [`${RULES_DIR}/shared`]: [entry('team.md')],
        [`${RULES_DIR}/out`]: [entry('secret.md')],
      },
      realPaths: { [`${RULES_DIR}/shared`]: '/repo/shared', [`${RULES_DIR}/out`]: '/elsewhere/out' },
    })

    expect(await rulesOfWorld(world, READER_WALK)).toEqual(['a.md'])
    expect(await rulesOfWorld(world, EXCLUDES_WALK)).toEqual(['a.md', 'linked.md', 'out/secret.md', 'shared/team.md'])
  })

  test('a sub-folder with no stat or no listing is skipped; no top folder is none, an unknown one null', async () => {
    const world = memWorld({
      dirs: { [RULES_DIR]: [entry('a.md'), entry('broken', 'dir'), link('notes')], [`${RULES_DIR}/broken`]: [] },
      files: { [`${RULES_DIR}/notes`]: 'a file behind a link' },
      unknownPaths: [`${RULES_DIR}/broken`],
    })

    expect(await rulesOfWorld(world, EXCLUDES_WALK)).toEqual(['a.md'])
    expect(await rulesOfWorld(world, READER_WALK)).toEqual(['a.md'])
    expect(await rulesOfWorld(memWorld({}), READER_WALK)).toEqual([])
    expect(await rulesOfWorld(memWorld({ unknownPaths: [RULES_DIR] }), EXCLUDES_WALK)).toBeNull()
    const outside = memWorld({ dirs: { [RULES_DIR]: [entry('a.md')] }, realPaths: { [RULES_DIR]: '/elsewhere' } })
    expect(await rulesOfWorld(outside, READER_WALK)).toBeNull()
  })
})

describe('listingState', () => {
  test('a folder the port lists is present with its entries', async () => {
    const listing = [entry('a.ts'), entry('src', 'dir')]
    const run = memIo(memWorld({ dirs: { '/repo/x': listing } }), [])

    expect(await listingState(run.io, '/repo/x')).toEqual({ state: 'present', entries: listing })
    expect(run.reads).toEqual([])
  })

  test('a path that is not there is absent, told by a read probe that reads nothing', async () => {
    const run = memIo(memWorld({}), [])

    expect(await listingState(run.io, '/repo/x')).toEqual({ state: 'absent' })
    expect(run.reads).toEqual(['/repo/x'])
  })

  test('a path that cannot be listed but is there, or that fails, is unknown', async () => {
    const run = memIo(memWorld({ files: { '/repo/file': 'text' }, unknownPaths: ['/repo/u'] }), [])

    expect(await listingState(run.io, '/repo/file')).toEqual({ state: 'unknown' })
    expect(await listingState(run.io, '/repo/u')).toEqual({ state: 'unknown' })
  })
})

describe('parseManifest', () => {
  test('a valid manifest comes back with its files in order', () => {
    expect(parseManifest(manifestText([BE_FILE, BE_LAUNCHER]))).toEqual({
      schema: 1,
      cadreVersion: '0.2.0',
      files: [
        { path: '.cadre/be/role.json', sha256: SHA_A, mode: 'file' },
        { path: '.cadre/bin/be', sha256: SHA_B, mode: 'exec' },
      ],
    })
  })

  test('a manifest with no files, and a version of unknown, are valid', () => {
    expect(parseManifest(manifestText([]))).toEqual({ schema: 1, cadreVersion: '0.2.0', files: [] })
    expect(parseManifest(manifestText([], { cadreVersion: 'unknown' }))).toEqual({
      schema: 1,
      cadreVersion: 'unknown',
      files: [],
    })
  })

  test('fields the contract does not name are dropped', () => {
    const parsed = parseManifest(manifestText([{ ...BE_FILE, extra: 1 }], { note: 'x' }))

    expect(parsed).toEqual({ schema: 1, cadreVersion: '0.2.0', files: [BE_FILE] })
  })

  test('text that is not a JSON object is null', () => {
    for (const text of ['', '{', 'null', '[]', '"x"', '1', 'not json']) {
      expect(parseManifest(text)).toBeNull()
    }
  })

  test('a schema other than the number 1, or no schema, is null', () => {
    expect(parseManifest(manifestText([], { schema: 2 }))).toBeNull()
    expect(parseManifest(manifestText([], { schema: '1' }))).toBeNull()
    expect(parseManifest(JSON.stringify({ cadreVersion: '0.2.0', files: [] }))).toBeNull()
  })

  test('a cadre version that is not x.y.z or unknown is null', () => {
    for (const version of ['0.2', 'v0.2.0', '0.2.0.1', '', ' 0.2.0', 'latest', 1, null]) {
      expect(parseManifest(manifestText([], { cadreVersion: version }))).toBeNull()
    }
    expect(parseManifest(JSON.stringify({ schema: 1, files: [] }))).toBeNull()
  })

  test('files that are missing or not a list are null', () => {
    expect(parseManifest(JSON.stringify({ schema: 1, cadreVersion: '0.2.0' }))).toBeNull()
    expect(parseManifest(manifestText([], { files: 'x' }))).toBeNull()
    expect(parseManifest(manifestText([], { files: { a: 1 } }))).toBeNull()
  })

  test('an entry that is not an object is null', () => {
    for (const item of ['x', null, 5, [], [BE_FILE]]) {
      expect(parseManifest(manifestText([item]))).toBeNull()
    }
  })

  test('an entry with an unsafe path is null', () => {
    for (const path of ['', '/x', '../x', 'a/../b', './a', 'a//b', 'a/', 'a b', `a${BACKSLASH}b`, 5, null]) {
      expect(parseManifest(manifestText([{ ...BE_FILE, path }]))).toBeNull()
    }
  })

  test('an entry whose sha256 is not 64 lowercase hex characters is null', () => {
    const bad = ['g'.repeat(64), 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), '', ` ${'a'.repeat(63)}`, 1, null]
    for (const sha256 of bad) {
      expect(parseManifest(manifestText([{ ...BE_FILE, sha256 }]))).toBeNull()
    }
  })

  test('an entry whose mode is not file or exec is null', () => {
    for (const mode of ['x', 'File', 'executable', '', 0, null]) {
      expect(parseManifest(manifestText([{ ...BE_FILE, mode }]))).toBeNull()
    }
    expect(parseManifest(manifestText([{ path: BE_FILE.path, sha256: SHA_A }]))).toBeNull()
  })

  test('two entries with the same path are null, even with different hashes', () => {
    expect(parseManifest(manifestText([BE_FILE, BE_FILE]))).toBeNull()
    expect(parseManifest(manifestText([BE_FILE, { ...BE_FILE, sha256: SHA_B, mode: 'exec' }]))).toBeNull()
  })
})

describe('parseCadreState', () => {
  test('a valid state comes back as it is', () => {
    expect(parseCadreState(stateText({ roles: ['be', 'security'] }))).toEqual({
      schema: 1,
      cadreVersion: '0.2.0',
      framework: 'gsd',
      gitPolicy: 'definitions',
      roles: ['be', 'security'],
      launchStart: { kind: 'git-root' },
      readUserMcp: false,
    })
  })

  test('the consent answer for ~/.claude.json is read back, true or false (A1)', () => {
    for (const readUserMcp of [true, false]) {
      expect(parseCadreState(stateText({ readUserMcp }))?.readUserMcp).toBe(readUserMcp)
    }
  })

  test('a missing consent answer, or one that is not a boolean, makes the state null (A1)', () => {
    const withoutConsent = {
      schema: 1,
      cadreVersion: '0.2.0',
      framework: 'gsd',
      gitPolicy: 'definitions',
      roles: ['be'],
      launchStart: { kind: 'git-root' },
    }
    expect(parseCadreState(JSON.stringify(withoutConsent))).toBeNull()
    for (const readUserMcp of [null, 'true', 1, 0]) {
      expect(parseCadreState(stateText({ readUserMcp }))).toBeNull()
    }
  })

  test('the launch start is read back: the git root, the folder it is run from, or a folder in the repo (A2)', () => {
    const starts = [{ kind: 'git-root' }, { kind: 'here' }, { kind: 'dir', path: 'apps/web' }]
    expect(starts.map(launchStart => parseCadreState(stateText({ launchStart }))?.launchStart)).toEqual(starts)
  })

  test('a missing launch start or one of an unknown kind makes the state null (A2)', () => {
    const withoutStart = { schema: 1, cadreVersion: '0.2.0', framework: 'gsd', gitPolicy: 'definitions', roles: [] }
    expect(parseCadreState(JSON.stringify(withoutStart))).toBeNull()
    for (const launchStart of [null, 'git-root', {}, { kind: 'root' }, { kind: 'GIT-ROOT' }, [], 1]) {
      expect(parseCadreState(stateText({ launchStart }))).toBeNull()
    }
  })

  test('a dir launch start whose path isSafeRelativePath refuses, or is no string, makes the state null (A2)', () => {
    for (const path of ['../x', '/abs', 'a b', '${HOME}', '', 'a/../b', 'apps/', 5, null]) {
      expect(parseCadreState(stateText({ launchStart: { kind: 'dir', path } }))).toBeNull()
    }
    expect(parseCadreState(stateText({ launchStart: { kind: 'dir' } }))).toBeNull()
  })

  test('a field inside the launch start that the contract does not name is dropped (A2)', () => {
    const git = parseCadreState(stateText({ launchStart: { kind: 'git-root', path: 'x', extra: 1 } }))
    const dir = parseCadreState(stateText({ launchStart: { kind: 'dir', path: 'apps/web', extra: 1 } }))
    expect(git?.launchStart).toEqual({ kind: 'git-root' })
    expect(dir?.launchStart).toEqual({ kind: 'dir', path: 'apps/web' })
  })

  test('every framework, a null framework, every git policy and no roles are valid', () => {
    for (const framework of ['gsd', 'superpowers', 'none', null]) {
      expect(parseCadreState(stateText({ framework }))?.framework).toBe(framework)
    }
    for (const gitPolicy of ['all', 'definitions', 'ignore']) {
      expect(parseCadreState(stateText({ gitPolicy }))?.gitPolicy).toBe(gitPolicy)
    }
    expect(parseCadreState(stateText({ roles: [] }))?.roles).toEqual([])
    expect(parseCadreState(stateText({ cadreVersion: 'unknown' }))?.cadreVersion).toBe('unknown')
  })

  test('fields the contract does not name are dropped', () => {
    expect(parseCadreState(stateText({ extra: 1 }))).toEqual({
      schema: 1,
      cadreVersion: '0.2.0',
      framework: 'gsd',
      gitPolicy: 'definitions',
      roles: ['be'],
      launchStart: { kind: 'git-root' },
      readUserMcp: false,
    })
  })

  test('text that is not a JSON object is null', () => {
    for (const text of ['', '{', 'null', '[]', '"x"', 'not json']) {
      expect(parseCadreState(text)).toBeNull()
    }
  })

  test('a reserved role id (bin, all, none) makes the state null, as a role can never take one', () => {
    for (const reserved of ['bin', 'all', 'none']) {
      expect(parseCadreState(stateText({ roles: ['be', reserved] }))).toBeNull()
    }
  })

  test('a schema other than the number 1, or a bad cadre version, is null', () => {
    expect(parseCadreState(stateText({ schema: 2 }))).toBeNull()
    expect(parseCadreState(stateText({ schema: '1' }))).toBeNull()
    expect(parseCadreState(stateText({ cadreVersion: '0.2' }))).toBeNull()
    expect(parseCadreState(stateText({ cadreVersion: 2 }))).toBeNull()
  })

  test('a framework outside gsd, superpowers, none and null is null, and so is a missing one', () => {
    for (const framework of ['bmad', 'GSD', '', 1, [], {}]) {
      expect(parseCadreState(stateText({ framework }))).toBeNull()
    }
    const withoutFramework = { schema: 1, cadreVersion: '0.2.0', gitPolicy: 'definitions', roles: ['be'] }
    expect(parseCadreState(JSON.stringify(withoutFramework))).toBeNull()
  })

  test('a git policy outside all, definitions and ignore is null', () => {
    for (const gitPolicy of ['commit', 'ALL', '', null, 1]) {
      expect(parseCadreState(stateText({ gitPolicy }))).toBeNull()
    }
  })

  test('roles that are not a list of role ids are null', () => {
    expect(parseCadreState(stateText({ roles: 'be' }))).toBeNull()
    expect(parseCadreState(stateText({ roles: { be: true } }))).toBeNull()
    expect(parseCadreState(stateText({ roles: null }))).toBeNull()
  })

  test('a role id that fails the role id pattern is null', () => {
    const bad = ['Be', '1a', '-a', 'a_b', '', 'a'.repeat(25), '../x', 'a/b', 'a b', 5, null]
    for (const id of bad) {
      expect(parseCadreState(stateText({ roles: ['be', id] }))).toBeNull()
    }
    expect(parseCadreState(stateText({ roles: ['a'.repeat(24)] }))?.roles).toEqual(['a'.repeat(24)])
  })

  test('a role id listed twice is null', () => {
    expect(parseCadreState(stateText({ roles: ['be', 'fe', 'be'] }))).toBeNull()
  })
})

describe('existing .cadre', () => {
  const MANIFEST = manifestText([BE_FILE])
  const STATE = stateText()
  const PARSED_MANIFEST = { schema: 1, cadreVersion: '0.2.0', files: [BE_FILE] }
  const PARSED_STATE = {
    schema: 1,
    cadreVersion: '0.2.0',
    framework: 'gsd',
    gitPolicy: 'definitions',
    roles: ['be'],
    launchStart: { kind: 'git-root' },
    readUserMcp: false,
  }

  /** The scan of a repo whose `.cadre` holds these files; a name in `files` is listed. */
  function cadreScan(files: Readonly<Record<string, string>>, over: Partial<MemWorld> = {}): Promise<RepoScan> {
    const inCadre: Record<string, string> = {}
    for (const [name, text] of Object.entries(files)) inCadre[`/repo/.cadre/${name}`] = text

    return scanOf({
      dirs: { '/repo': [entry('.cadre', 'dir')], '/repo/.cadre': Object.keys(files).map(name => entry(name)) },
      files: inCadre,
      ...over,
    })
  }

  test('no .cadre folder gives an absent state and reads no .cadre file, only the zero-byte probe', async () => {
    const run = memIo(memWorld({ dirs: { '/repo': [entry('a.ts')] } }), [])
    const scan = await scanRepo(run.io, '/repo')

    expect(scan.cadre).toEqual({
      dir: 'absent',
      manifest: null,
      manifestState: 'absent',
      state: null,
      stateState: 'absent',
    })
    expect(run.reads).toEqual(['/repo/.cadre'])
    expect(scan.warnings).toEqual([])
  })

  test('a valid manifest.json is present with its parsed manifest', async () => {
    const scan = await cadreScan({ 'manifest.json': MANIFEST })

    expect(scan.cadre).toEqual({
      dir: 'present',
      manifest: PARSED_MANIFEST,
      manifestState: 'present',
      state: null,
      stateState: 'absent',
    })
    expect(scan.warnings).toEqual([])
  })

  test('a valid cadre.json is present with its parsed state', async () => {
    const scan = await cadreScan({ 'cadre.json': STATE })

    expect(scan.cadre).toEqual({
      dir: 'present',
      manifest: null,
      manifestState: 'absent',
      state: PARSED_STATE,
      stateState: 'present',
    })
    expect(scan.warnings).toEqual([])
  })

  test('both files are read when both are there', async () => {
    const scan = await cadreScan({ 'manifest.json': MANIFEST, 'cadre.json': STATE })

    expect(scan.cadre.manifestState).toBe('present')
    expect(scan.cadre.stateState).toBe('present')
    expect(scan.cadre.manifest).toEqual(PARSED_MANIFEST)
    expect(scan.cadre.state).toEqual(PARSED_STATE)
  })

  test('a .cadre folder with neither file is present with both absent', async () => {
    const scan = await cadreScan({})

    expect(scan.cadre).toEqual({
      dir: 'present',
      manifest: null,
      manifestState: 'absent',
      state: null,
      stateState: 'absent',
    })
  })

  test('a manifest.json that cannot be read is unknown with a could not read warning', async () => {
    const scan = await cadreScan({ 'manifest.json': MANIFEST }, { unknownPaths: ['/repo/.cadre/manifest.json'] })

    expect(scan.cadre.manifestState).toBe('unknown')
    expect(scan.cadre.manifest).toBeNull()
    expect(scan.warnings).toEqual(['could not read .cadre/manifest.json (treated as unknown)'])
  })

  test('a manifest.json over the read cap is unknown with a could not read warning', async () => {
    const scan = await cadreScan({ 'manifest.json': 'x'.repeat(MAX_READ_BYTES + 1) })

    expect(scan.cadre.manifestState).toBe('unknown')
    expect(scan.warnings).toEqual(['could not read .cadre/manifest.json (treated as unknown)'])
  })

  test('a manifest.json that is not a valid manifest is unknown with an ignored warning', async () => {
    for (const text of ['not json', manifestText([], { schema: 2 }), manifestText([BE_FILE, BE_FILE])]) {
      const scan = await cadreScan({ 'manifest.json': text })

      expect(scan.cadre.manifestState).toBe('unknown')
      expect(scan.cadre.manifest).toBeNull()
      expect(scan.warnings).toEqual([
        'ignored .cadre/manifest.json: not a valid cadre manifest (treated as unknown)',
      ])
    }
  })

  test('a cadre.json that cannot be read is unknown with a could not read warning', async () => {
    const scan = await cadreScan({ 'cadre.json': STATE }, { unknownPaths: ['/repo/.cadre/cadre.json'] })

    expect(scan.cadre.stateState).toBe('unknown')
    expect(scan.cadre.state).toBeNull()
    expect(scan.warnings).toEqual(['could not read .cadre/cadre.json (treated as unknown)'])
  })

  test('a cadre.json over the read cap is unknown with a could not read warning', async () => {
    const scan = await cadreScan({ 'cadre.json': 'x'.repeat(MAX_READ_BYTES + 1) })

    expect(scan.cadre.stateState).toBe('unknown')
    expect(scan.warnings).toEqual(['could not read .cadre/cadre.json (treated as unknown)'])
  })

  test('a cadre.json that is not a valid state is unknown with an ignored warning', async () => {
    for (const text of ['not json', stateText({ framework: 'bmad' }), stateText({ roles: ['Be'] })]) {
      const scan = await cadreScan({ 'cadre.json': text })

      expect(scan.cadre.stateState).toBe('unknown')
      expect(scan.cadre.state).toBeNull()
      expect(scan.warnings).toEqual(['ignored .cadre/cadre.json: not a valid cadre state (treated as unknown)'])
    }
  })

  test('one bad file does not hide the other', async () => {
    const scan = await cadreScan({ 'manifest.json': 'not json', 'cadre.json': STATE })

    expect(scan.cadre.manifestState).toBe('unknown')
    expect(scan.cadre.stateState).toBe('present')
    expect(scan.cadre.state).toEqual(PARSED_STATE)
  })

  test('a manifest.json that links out of the repo is never read and is unknown', async () => {
    const run = memIo(
      memWorld({
        dirs: { '/repo': [entry('.cadre', 'dir')], '/repo/.cadre': [link('manifest.json')] },
        files: { '/repo/.cadre/manifest.json': MANIFEST },
        realPaths: { '/repo/.cadre/manifest.json': '/elsewhere/manifest.json' },
      }),
      [],
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(run.reads).not.toContain('/repo/.cadre/manifest.json')
    expect(scan.cadre.manifestState).toBe('unknown')
    expect(scan.warnings).toEqual(['could not read .cadre/manifest.json (treated as unknown)'])
  })

  test('a .cadre whose stat and listing both fail is unknown with a warning, never absent', async () => {
    const run = memIo(memWorld({ dirs: { '/repo': [entry('.cadre', 'dir')] }, unknownPaths: ['/repo/.cadre'] }), [])
    const scan = await scanRepo(run.io, '/repo')

    expect(scan.cadre.dir).toBe('unknown')
    expect(scan.warnings).toEqual(['could not list .cadre (treated as unknown)'])
  })

  test('a .cadre that exists but cannot be listed is unknown with a warning', async () => {
    const scan = await scanOf({ dirs: { '/repo': [entry('.cadre')] }, files: { '/repo/.cadre': 'not a folder' } })

    expect(scan.cadre.dir).toBe('unknown')
    expect(scan.warnings).toEqual(['could not list .cadre (treated as unknown)'])
  })

  test('only .cadre itself is listed, and what is inside it adds no finding', async () => {
    const run = memIo(
      memWorld({
        dirs: {
          '/repo': [entry('.cadre', 'dir')],
          '/repo/.cadre': [entry('be', 'dir')],
          '/repo/.cadre/be': [entry('role.test.ts')],
        },
      }),
      [],
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(run.listed).toEqual(['/repo', '/repo/.cadre'])
    expect(scan.findings).toEqual([])
  })

  test('the .cadre warnings come after the walk and package.json warnings', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('.cadre', 'dir'), entry('gone', 'dir'), entry('package.json')],
        '/repo/.cadre': [entry('manifest.json')],
      },
      files: { '/repo/package.json': '{', '/repo/.cadre/manifest.json': 'not json' },
    })

    expect(scan.warnings).toEqual([
      'could not list gone (treated as unknown)',
      'could not parse package.json as JSON (treated as unknown)',
      'ignored .cadre/manifest.json: not a valid cadre manifest (treated as unknown)',
    ])
  })
})

describe('git top level', () => {
  /** A port over the world that also records every path it is asked to stat. */
  function statSpy(world: MemWorld): { readonly io: InitIo; readonly statted: string[] } {
    const run = memIo(world, [])
    const statted: string[] = []
    const io: InitIo = {
      ...run.io,
      stat: async path => {
        statted.push(path)

        return run.io.stat(path)
      },
    }

    return { io, statted }
  }

  test('a .git folder above the root gives that folder as the top level', async () => {
    const run = memIo(memWorld({ dirs: { '/repo/.git': [] } }), [])

    expect(await findGitTop(run.io, '/repo/sub')).toEqual({ state: 'found', top: '/repo' })
  })

  test('a .git file, as a linked worktree has, counts too', async () => {
    const run = memIo(memWorld({ files: { '/repo/.git': 'gitdir: /elsewhere/.git/worktrees/repo' } }), [])

    expect(await findGitTop(run.io, '/repo/sub')).toEqual({ state: 'found', top: '/repo' })
  })

  test('the root itself may be the top level', async () => {
    const run = memIo(memWorld({ dirs: { '/repo/.git': [] } }), [])

    expect(await findGitTop(run.io, '/repo')).toEqual({ state: 'found', top: '/repo' })
    expect(await findGitTop(run.io, '/repo/')).toEqual({ state: 'found', top: '/repo' })
  })

  test('the nearest .git wins, so a repo inside a repo has its own top level', async () => {
    const run = memIo(memWorld({ dirs: { '/repo/.git': [], '/repo/sub/.git': [] } }), [])

    expect(await findGitTop(run.io, '/repo/sub/deep')).toEqual({ state: 'found', top: '/repo/sub' })
  })

  test('a .git at the file system root is found as /', async () => {
    const run = memIo(memWorld({ dirs: { '/.git': [] } }), [])

    expect(await findGitTop(run.io, '/repo')).toEqual({ state: 'found', top: '/' })
  })

  test('with no .git on the way up the answer is none, after trying each folder up to /', async () => {
    const spy = statSpy(memWorld({}))

    expect(await findGitTop(spy.io, '/repo/sub')).toEqual({ state: 'none' })
    expect(spy.statted).toEqual(['/repo/sub/.git', '/repo/.git', '/.git'])
  })

  test('the walk uses stat only, never a read, a listing or a prompt', async () => {
    const run = memIo(memWorld({ dirs: { '/repo/.git': [] } }), [])
    await findGitTop(run.io, '/repo/sub')

    expect(run.reads).toEqual([])
    expect(run.asked).toEqual([])
  })

  test('a .git that cannot be stat is passed over and the walk goes on', async () => {
    const world = memWorld({ dirs: { '/repo/.git': [] }, unknownPaths: ['/repo/sub/.git'] })

    expect(await findGitTop(memIo(world, []).io, '/repo/sub')).toEqual({ state: 'found', top: '/repo' })
    expect(await findGitTop(memIo(memWorld({ unknownPaths: ['/repo/.git'] }), []).io, '/repo')).toEqual({
      state: 'none',
    })
  })

  test('a .git that is neither a file nor a folder does not count', async () => {
    const run = memIo(memWorld({}), [])
    const io: InitIo = { ...run.io, stat: async () => ({ kind: 'other', size: 0, isLink: true }) }

    expect(await findGitTop(io, '/repo')).toEqual({ state: 'none' })
  })

  test('a root that is not an absolute path has no top level and is not walked', async () => {
    const spy = statSpy(memWorld({ dirs: { '/repo/.git': [] } }))

    expect(await findGitTop(spy.io, 'repo/sub')).toEqual({ state: 'none' })
    expect(await findGitTop(spy.io, '')).toEqual({ state: 'none' })
    expect(spy.statted).toEqual([])
  })

  test('a root that is the top level has no refusal, with or without a trailing slash', () => {
    expect(gitRootRefusal('/repo', '/repo', 'init')).toBeNull()
    expect(gitRootRefusal('/repo/', '/repo', 'init')).toBeNull()
    expect(gitRootRefusal('/repo', '/repo/', 'init')).toBeNull()
    expect(gitRootRefusal('/repo//', '/repo/', 'regen')).toBeNull()
  })

  test('a root below the top level is refused with the top level named', () => {
    expect(gitRootRefusal('/repo/sub', '/repo', 'init')).toBe('run /cadre init from the repo root: /repo')
    expect(gitRootRefusal('/repo/sub', '/repo', 'regen')).toBe('run /cadre regen from the repo root: /repo')
    expect(gitRootRefusal('/repo-other', '/repo', 'init')).toBe('run /cadre init from the repo root: /repo')
  })

  test('the top level is shown cleaned and capped at 240 code points', () => {
    const hidden = gitRootRefusal('/x/sub', `/re${BIDI_OVERRIDE}po`, 'init')
    const long = gitRootRefusal('/x/sub', `/${'a'.repeat(300)}`, 'init')
    const prefix = 'run /cadre init from the repo root: '

    expect(hidden).toBe(`${prefix}/repo`)
    expect(long?.startsWith(prefix)).toBe(true)
    expect(Array.from(long?.slice(prefix.length) ?? '')).toHaveLength(240)
    expect(long?.endsWith(ELLIPSIS)).toBe(true)
  })

  test('no git repo above the root is refused with the locked wording', () => {
    expect(notGitRepoReply('init')).toBe('cadre init needs a git repo: run git init first')
    expect(notGitRepoReply('regen')).toBe('cadre regen needs a git repo: run git init first')
  })
})

describe('safety net: scan helpers (A8)', () => {
  test('missingState: absent only for a path not there; a failed, folder or file read is unknown', async () => {
    const files = { '/repo/a': 'text', '/repo/e': '' }
    const world = memWorld({ files, dirs: { '/repo/d': [] }, unknownPaths: ['/repo/b'] })
    const run = memIo(world, [])
    const caps: number[] = []
    const io: InitIo = {
      ...run.io,
      read: async (path, maxBytes) => {
        caps.push(maxBytes)

        return run.io.read(path, maxBytes)
      },
    }
    const states: string[] = []
    for (const path of ['/repo/x', '/repo/b', '/repo/d', '/repo/a', '/repo/e']) {
      states.push(await missingState(io, path))
    }
    expect(states).toEqual(['absent', 'unknown', 'unknown', 'unknown', 'unknown'])
    expect(caps).toEqual([0, 0, 0, 0, 0])
  })
})
