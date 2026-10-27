import { describe, expect, test } from 'claude-code/testing'

import type { RepoScan, ScanFinding, ScanKind } from '../../types'
import { entry, link, memIo, memWorld } from '../testkit'
import type { MemWorld } from '../testkit'
import { MARKER_ROWS } from './markers'
import type { MarkerRow } from './markers'
import { scanRepo } from './repo'

/** The scan of the repo /repo whose folders, files and links are in memory. */
async function scanOf(over: Partial<MemWorld>): Promise<RepoScan> {
  return scanRepo(memIo(memWorld(over), []).io, '/repo')
}

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

/** The findings of one kind, in scan order. */
function findingsOfKind(scan: RepoScan, kind: ScanKind): ScanFinding[] {
  return scan.findings.filter(finding => finding.kind === kind)
}

/** The scan of a repo whose root holds only this one file, with this text. */
async function scanOfFile(name: string, text: string): Promise<RepoScan> {
  return scanOf({ dirs: { '/repo': [entry(name)] }, files: { [`/repo/${name}`]: text } })
}

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
