import { describe, expect, test } from 'claude-code/testing'

import type { PortEntry, RepoScan } from '../../types'
import {
  BE_FILE,
  BIDI_OVERRIDE,
  entry,
  findingOf,
  leaks,
  link,
  manifestText,
  memIo,
  memWorld,
  SECRET_FIXTURES,
  stateText,
} from '../testkit'
import type { MemWorld } from '../testkit'
import { MAX_READ_BYTES } from './facts/normalize'
import { scanRepo } from './repo'
import { SKIP_DIRS } from './walk'

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
