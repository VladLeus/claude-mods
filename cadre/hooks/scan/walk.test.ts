import { describe, expect, test } from 'claude-code/testing'

import type { PortEntry, RepoScan, ScanFinding } from '../../types'
import { entry, findingOf, memIo, memWorld } from '../testkit'
import type { MemWorld } from '../testkit'
import { SOURCE_EXTENSIONS } from './markers'
import { scanRepo, undecidedFacts } from './repo'
import { MAX_FOLDER_ENTRIES, MAX_SCAN_DEPTH, MAX_SCAN_ENTRIES, SKIP_DIRS } from './walk'

/** `count` plain files named f0000.txt, f0001.txt and so on; none is a marker or a source file. */
function plainFiles(count: number): PortEntry[] {
  return Array.from({ length: count }, (_, index) => entry(`f${String(index).padStart(4, '0')}.txt`))
}

/** The scan of the repo /repo whose folders, files and links are in memory. */
async function scanOf(over: Partial<MemWorld>): Promise<RepoScan> {
  return scanRepo(memIo(memWorld(over), []).io, '/repo')
}

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
