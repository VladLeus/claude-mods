import { describe, expect, test } from 'claude-code/testing'

import type { RepoScan } from '../../../types'
import { proposeRoles } from '../../roles/propose'
import { scanRepo } from '../../scan/repo'
import { BIDI_OVERRIDE, emptySetupScan, entry, memIo, memWorld, repoScan } from '../../testkit'
import { scanContextLine, scanSummaryLines, truncatedLine } from './scan'

/** The middle of the partial line for deeper folders listed only in part (D-137). */
const IN_PART = 'listed only in part (the first 200 entries each)'

/** How the partial line names a walk that stopped at its overall safety cap (D-137). */
const SAFETY_CAP = 'the scan stopped at the 20,000-entry safety cap'

describe('scanSummaryLines', () => {
  test('an empty repo and setup are summed up with none and zero for every part', () => {
    expect(scanSummaryLines(repoScan(), emptySetupScan())).toEqual([
      'Repo scan (read-only):',
      '  stack: none; frontend: none; backend: none',
      '  tests: none; E2E: none',
      '  existing .cadre/: none',
      'User setup (names only):',
      '  plugins: 0',
      '  skills: 0; agents: 0; MCP servers: none',
      '  global ~/.claude/CLAUDE.md: no; memories: 0; CLAUDE.md files: none',
    ])
  })

  test('the repo part names the languages and the finding labels of each kind, in scan order', () => {
    const repo = repoScan({
      languages: ['JavaScript', 'TypeScript'],
      findings: [
        { kind: 'be', label: 'express', evidence: 'package.json' },
        { kind: 'e2e', label: 'Playwright config', evidence: 'playwright.config.ts' },
        { kind: 'fe', label: 'next', evidence: 'package.json' },
        { kind: 'fe', label: 'react', evidence: 'package.json' },
        { kind: 'lang', label: 'JavaScript/TypeScript (package.json)', evidence: 'package.json' },
        { kind: 'test', label: 'JS/TS test files', evidence: 'src/a.test.ts' },
        { kind: 'test', label: 'vitest', evidence: 'package.json' },
      ],
      hasSource: true,
    })
    const lines = scanSummaryLines(repo, emptySetupScan())
    expect(lines[1]).toBe('  stack: JavaScript, TypeScript; frontend: next, react; backend: express')
    expect(lines[2]).toBe('  tests: JS/TS test files, vitest; E2E: Playwright config')
  })

  test("a repo with gem 'rails' in its root Gemfile shows backend: rails and keeps BE (G-02-1c)", async () => {
    const world = memWorld({
      dirs: {
        '/repo': [entry('.rspec'), entry('Gemfile'), entry('app', 'dir'), entry('package.json')],
        '/repo/app': [entry('models', 'dir')],
        '/repo/app/models': [entry('user.rb')],
      },
      files: {
        '/repo/Gemfile': "source 'https://rubygems.org'\n\ngem 'rails', '8.1.3.1'\n",
        '/repo/package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      },
    })
    const repo = await scanRepo(memIo(world, []).io, '/repo')
    const proposal = proposeRoles(repo)

    expect(scanSummaryLines(repo, emptySetupScan())[1]).toBe('  stack: Ruby; frontend: react; backend: rails')
    expect(proposal.roles.map(role => role.id)).toContain('be')
    expect(proposal.changes.filter(change => change.roleId === 'be')).toEqual([])
  })

  test('an existing .cadre/ is shown with its state and the state of its manifest', () => {
    const cadre = (dir: 'present' | 'unknown', manifestState: 'present' | 'absent' | 'unknown'): RepoScan['cadre'] => ({
      dir,
      manifest: null,
      manifestState,
      state: null,
      stateState: 'absent',
    })
    const shown = (dir: 'present' | 'unknown', manifestState: 'present' | 'absent' | 'unknown'): string | undefined =>
      scanSummaryLines(repoScan({ cadre: cadre(dir, manifestState) }), emptySetupScan())[3]
    expect(shown('present', 'present')).toBe('  existing .cadre/: present (manifest present)')
    expect(shown('present', 'absent')).toBe('  existing .cadre/: present (manifest absent)')
    expect(shown('unknown', 'unknown')).toBe('  existing .cadre/: unknown (manifest unknown)')
  })

  test('a scan that listed a deeper folder only in part says so after the .cadre/ line (G-02-1e)', () => {
    const lines = scanSummaryLines(repoScan({ cappedFolders: ['app/views'] }), emptySetupScan())
    expect(lines[4]).toBe(`  partial: 1 deeper folder ${IN_PART}; may be incomplete: stack, tests, E2E`)
    expect(lines[5]).toBe('User setup (names only):')
    expect(scanSummaryLines(repoScan(), emptySetupScan())).toHaveLength(8)
  })

  test('a scan stopped at the safety cap that also capped folders shows the safety line, then the folder line', () => {
    const repo = repoScan({ cappedFolders: ['a/b', 'c/d'], isOverallCapped: true })
    const lines = scanSummaryLines(repo, emptySetupScan())
    expect(lines.slice(4, 7)).toEqual([
      `  partial: ${SAFETY_CAP}; may be incomplete: stack, tests, E2E`,
      `  partial: 2 deeper folders ${IN_PART}; may be incomplete: stack, tests, E2E`,
      'User setup (names only):',
    ])
  })

  test('the setup part counts plugins, skills, agents and memories and names MCP servers and CLAUDE.md files', () => {
    const plugins = ['a@m', 'b@m', 'c@m', 'd@m', 'e@m', 'f@m', 'g@m', 'h@m', 'i@m', 'j@m']
    const setup = emptySetupScan({
      plugins,
      skills: [
        { name: 'security-review', plugin: null },
        { name: 'rescue', plugin: 'codex' },
        { name: 'setup', plugin: 'codex' },
      ],
      mcp: [
        { name: 'jira', source: 'project' },
        { name: 'sentry', source: 'session' },
      ],
      agents: ['planner', 'reviewer'],
      claudeMd: ['~/work/CLAUDE.md', '<repo>/CLAUDE.md'],
      hasGlobalClaudeMd: true,
      memoryFiles: ['a.md', 'b.md', 'c.md'],
    })
    expect(scanSummaryLines(repoScan(), setup).slice(5)).toEqual([
      '  plugins: 10 (a@m, b@m, c@m, d@m, e@m, f@m, g@m, h@m, i@m, j@m)',
      '  skills: 3; agents: 2; MCP servers: jira, sentry',
      '  global ~/.claude/CLAUDE.md: yes; memories: 3; CLAUDE.md files: ~/work/CLAUDE.md, <repo>/CLAUDE.md',
    ])
  })

  test('long setup lists keep their counts first and show 12 names, then count the rest (B2)', () => {
    const names = (prefix: string, count: number): string[] =>
      Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`)
    const plugins = names('plugin-', 30).map(name => `${name}@claude-plugins-official`)
    const servers = names('server-', 20)
    const claudeMd = names('<repo>/pkg', 15).map(name => `${name}/CLAUDE.md`)
    const setup = emptySetupScan({
      plugins,
      mcp: servers.map(name => ({ name, source: 'session' })),
      claudeMd,
      hasGlobalClaudeMd: true,
      memoryFiles: ['a.md'],
    })
    const first12 = (list: readonly string[]): string => list.slice(0, 12).join(', ')
    expect(scanSummaryLines(repoScan(), setup).slice(5)).toEqual([
      `  plugins: 30 (${first12(plugins)}, +18 more)`,
      `  skills: 0; agents: 0; MCP servers: ${first12(servers)}, +8 more`,
      `  global ~/.claude/CLAUDE.md: yes; memories: 1; CLAUDE.md files: ${first12(claudeMd)}, +3 more`,
    ])
  })

  test('a long or hidden-character name in a setup list is cleaned and capped, and the counts stay in front', () => {
    const long = `a${BIDI_OVERRIDE}b${'x'.repeat(300)}`
    const setup = emptySetupScan({ plugins: [long], mcp: [{ name: long, source: 'session' }], claudeMd: [long] })
    const shownName = `ab${'x'.repeat(107)}…`
    expect(scanSummaryLines(repoScan(), setup).slice(5)).toEqual([
      `  plugins: 1 (${shownName})`,
      `  skills: 0; agents: 0; MCP servers: ${shownName}`,
      `  global ~/.claude/CLAUDE.md: no; memories: 0; CLAUDE.md files: ${shownName}`,
    ])
  })
})

/** A repo scan with every fact found: a language, a test finding and an E2E finding; `over` changes the rest. */
function foundAll(over: Partial<RepoScan>): RepoScan {
  return repoScan({
    languages: ['Ruby'],
    findings: [
      { kind: 'e2e', label: 'Rails system specs', evidence: 'spec/system' },
      { kind: 'test', label: 'RSpec config', evidence: '.rspec' },
    ],
    hasSource: true,
    ...over,
  })
}

describe('truncatedLine (G-02-1e)', () => {
  test('nothing capped gives no line', () => {
    expect(truncatedLine(repoScan())).toBeNull()
    expect(truncatedLine(repoScan({ languages: ['Ruby'], hasSource: true }))).toBeNull()
  })

  test('one deeper folder listed only in part names the facts it found nothing for: folder for 1', () => {
    expect(truncatedLine(repoScan({ cappedFolders: ['app/views'] }))).toBe(
      `  partial: 1 deeper folder ${IN_PART}; may be incomplete: stack, tests, E2E`,
    )
  })

  test('several deeper folders say folders, and only the facts not found may be incomplete', () => {
    const repo = foundAll({ findings: [{ kind: 'test', label: 'RSpec config', evidence: '.rspec' }] })
    const capped = { ...repo, cappedFolders: ['app/models', 'app/views', 'spec/models'] }
    expect(truncatedLine(capped)).toBe(`  partial: 3 deeper folders ${IN_PART}; may be incomplete: E2E`)
  })

  test('with stack, tests and E2E all found the line says so', () => {
    expect(truncatedLine(foundAll({ cappedFolders: ['app/views', 'spec/system'] }))).toBe(
      `  partial: 2 deeper folders ${IN_PART}; stack, tests and E2E were all found`,
    )
  })

  test('a stop at the safety cap is named in place of the folder wording, with the same facts rule', () => {
    expect(truncatedLine(repoScan({ isOverallCapped: true }))).toBe(
      `  partial: ${SAFETY_CAP}; may be incomplete: stack, tests, E2E`,
    )
  })

  test('a stop at the safety cap with every fact found says the scan stopped early, never all found (N7)', () => {
    expect(truncatedLine(foundAll({ isOverallCapped: true }))).toBe(
      '  partial: the scan stopped at the 20,000-entry safety cap; ' +
        'the scan stopped early; stack, tests and E2E may be incomplete',
    )
  })

  test('with the safety cap and a capped folder, both partial lines end with the stopped-early tail (N7)', () => {
    const repo = foundAll({ cappedFolders: ['a/b'], isOverallCapped: true })
    const partial = scanSummaryLines(repo, emptySetupScan()).filter(line => line.startsWith('  partial: '))
    expect(partial).toEqual([
      `  partial: ${SAFETY_CAP}; the scan stopped early; stack, tests and E2E may be incomplete`,
      `  partial: 1 deeper folder ${IN_PART}; the scan stopped early; stack, tests and E2E may be incomplete`,
    ])
  })

  test('with the safety cap reached and folders capped, truncatedLine gives the safety line first', () => {
    const repo = repoScan({ cappedFolders: ['a/b'], isOverallCapped: true })
    expect(truncatedLine(repo)).toBe(`  partial: ${SAFETY_CAP}; may be incomplete: stack, tests, E2E`)
  })

  test('a real walk over 20,000 entries gives the safety-cap line', async () => {
    const files = Array.from({ length: 20_001 }, (_, at) => entry(`f${String(at).padStart(5, '0')}.txt`))
    const repo = await scanRepo(memIo(memWorld({ dirs: { '/repo': files } }), []).io, '/repo')
    expect(truncatedLine(repo)).toBe(`  partial: ${SAFETY_CAP}; may be incomplete: stack, tests, E2E`)
  })
})

describe('question context lines (G-02-1)', () => {
  test('scanContextLine names the stack and each kind of finding, or none', () => {
    const repo = repoScan({
      languages: ['JavaScript', 'TypeScript'],
      findings: [
        { kind: 'be', label: 'express', evidence: 'package.json' },
        { kind: 'e2e', label: 'Playwright config', evidence: 'playwright.config.ts' },
        { kind: 'fe', label: 'next', evidence: 'package.json' },
        { kind: 'fe', label: 'react', evidence: 'package.json' },
        { kind: 'test', label: 'vitest', evidence: 'package.json' },
      ],
      hasSource: true,
    })
    expect(scanContextLine(repo)).toBe(
      'Scan: stack JavaScript, TypeScript; frontend next, react; backend express; tests vitest; E2E Playwright config.',
    )
    expect(scanContextLine(repoScan())).toBe('Scan: stack none; frontend none; backend none; tests none; E2E none.')
  })
})
