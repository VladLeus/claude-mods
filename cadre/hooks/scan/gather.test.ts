import { describe, expect, test } from 'claude-code/testing'

import type { HookScript, LaunchStart } from '../../types'
import {
  DEFAULT_LOCATIONS,
  EMPTY_FACTS,
  emptySetupScan,
  entry,
  gitWorld,
  memIo,
  repoScan,
  withStats,
} from '../testkit'
import { scanWarningLines } from '../ui/blocks/scan'
import { gatherScans, scanWarnings, withStartHooks } from './gather'
import type { Gathered } from './gather'
import { scanRepo } from './repo'
import { scanSetup } from './setup/setup'

describe('gatherScans', () => {
  /** A repo with a TypeScript test file and a session that has the sentry MCP server. */
  const scanned = gitWorld({
    dirs: { '/repo/.git': [], '/repo': [entry('src', 'dir')], '/repo/src': [entry('a.test.ts')] },
    tools: [{ name: 'mcp__sentry__issues', description: 'Sentry issues', mcp: true }],
    files: { '/home/u/.claude.json': '{"mcpServers":{"linear":{"command":"x"}}}' },
  })

  test('gatherScans gives the facts and the repo and setup scans of the session, as the scans give them', async () => {
    for (const isAllowed of [false, true]) {
      const gathered = await gatherScans(memIo(scanned, {}).io, DEFAULT_LOCATIONS, isAllowed)
      expect(gathered.facts).toEqual(scanned.facts)
      expect(gathered.repo).toEqual(await scanRepo(memIo(scanned, {}).io, '/repo'))
      const ctx = { root: '/repo', givenRoot: '/repo', home: '/home/u', configDir: null }
      expect(gathered.setup).toEqual(await scanSetup(memIo(scanned, {}).io, ctx, isAllowed))
      expect(gathered.repo.languages).toEqual(['TypeScript'])
    }
  })

  test('without consent gatherScans never reads ~/.claude.json', async () => {
    const run = memIo(scanned, {})
    const gathered = await gatherScans(run.io, DEFAULT_LOCATIONS, false)
    expect(run.reads).not.toContain('/home/u/.claude.json')
    expect(gathered.setup.mcp.map(server => server.name)).toEqual(['sentry'])
  })

  test('with consent gatherScans reads ~/.claude.json once and keeps its server names', async () => {
    const run = memIo(scanned, {})
    const gathered = await gatherScans(run.io, DEFAULT_LOCATIONS, true)
    expect(run.reads.filter(path => path === '/home/u/.claude.json')).toHaveLength(1)
    expect(gathered.setup.mcp.map(server => server.name)).toEqual(['linear', 'sentry'])
  })

  test('the setup scan looks for the project of the root as given as well as the root as resolved', async () => {
    const claudeJson = '{"projects":{"/link/repo":{"mcpServers":{"jira":{}}}}}'
    const world = gitWorld({ files: { '/home/u/.claude.json': claudeJson } })
    const locations = { ...DEFAULT_LOCATIONS, givenRoot: '/link/repo' }
    const gathered = await gatherScans(memIo(world, {}).io, locations, true)
    expect(gathered.setup.mcp.map(server => server.name)).toEqual(['jira'])
  })
})

/** What the scans of one run found, with these warnings in each of the three scans. */
function gatheredWith(facts: readonly string[], repo: readonly string[], setup: readonly string[]): Gathered {
  return {
    facts: { facts: { ...EMPTY_FACTS, warnings: facts }, gsdUserDir: null },
    repo: repoScan({ warnings: repo }),
    setup: emptySetupScan({ warnings: setup }),
  }
}

describe('scanWarnings', () => {
  test('the warnings of the locations, the facts, the repo scan and the setup scan, in that order', () => {
    const locations = { ...DEFAULT_LOCATIONS, warnings: ['root given through a link'] }
    const gathered = gatheredWith(['facts a', 'facts b'], ['repo a'], ['setup a'])
    expect(scanWarnings(locations, gathered)).toEqual([
      'root given through a link',
      'facts a',
      'facts b',
      'repo a',
      'setup a',
    ])
  })

  test('a warning given twice, in one list or in two, is listed once where it first comes', () => {
    const locations = { ...DEFAULT_LOCATIONS, warnings: ['same', 'loc'] }
    const gathered = gatheredWith(['facts', 'same'], ['repo', 'facts'], ['repo', 'setup', 'setup'])
    expect(scanWarnings(locations, gathered)).toEqual(['same', 'loc', 'facts', 'repo', 'setup'])
  })

  test('with no warning anywhere the list is empty, and so are its lines', () => {
    expect(scanWarnings(DEFAULT_LOCATIONS, gatheredWith([], [], []))).toEqual([])
    expect(scanWarningLines([])).toEqual([])
  })

  test('each warning is one line that starts with warning:', () => {
    expect(scanWarningLines(['a'])).toEqual(['warning: a'])
    expect(scanWarningLines(['a', 'b c'])).toEqual(['warning: a', 'warning: b c'])
  })

  test('a guard only in local settings adds no warning: launch renders it from every settings source (D-103)', () => {
    const gathered = { ...gatheredWith(['facts a'], [], []), setup: { ...guardFrom(['local']), warnings: ['setup a'] } }
    expect(scanWarnings(DEFAULT_LOCATIONS, gathered)).toEqual(['facts a', 'setup a'])
  })
})

/** A setup scan whose hooks register the GSD secret read guard once from each of these settings sources. */
function guardFrom(sources: readonly HookScript['source'][]): Gathered['setup'] {
  return emptySetupScan({
    hooks: sources.map(source => ({ script: 'gsd-secret-read-guard.js', event: 'PreToolUse', source })),
  })
}

describe('withStartHooks', () => {
  const guard = '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"node .claude/hooks/guard.sh"}]}]}}'
  const world = gitWorld({
    dirs: { '/repo/.git': [], '/repo/src': [entry('.claude', 'dir')], '/repo/src/.claude': [entry('settings.json')] },
    files: { '/repo/src/.claude/settings.json': guard },
  })

  test('a dir start reads <path>/.claude/settings.json of the root and sets its hooks as the start hooks', async () => {
    const run = memIo(world, {})
    const gathered = gatheredWith([], [], [])
    const started = await withStartHooks(run.io, gathered, '/repo', { kind: 'dir', path: 'src' })

    expect(run.reads).toEqual(['/repo/src/.claude/settings.json'])
    expect(started).toEqual({
      ...gathered,
      setup: { ...gathered.setup, startHooks: [{ script: 'guard.sh', event: 'PreToolUse', source: 'project' }] },
    })
  })

  test('a dir start with no settings file gets no start hook', async () => {
    const gathered = gatheredWith([], [], [])
    const started = await withStartHooks(memIo(gitWorld(), {}).io, gathered, '/repo', { kind: 'dir', path: 'src' })

    expect(started.setup.startHooks).toEqual([])
  })

  test('a git-root or here start has no start hooks and makes no port call', async () => {
    const gathered = { ...gatheredWith([], [], []), setup: emptySetupScan({ startHooks: [] }) }
    const starts: readonly LaunchStart[] = [{ kind: 'git-root' }, { kind: 'here' }]
    for (const start of starts) {
      const run = memIo(world, {})
      const stats = withStats(run)
      const started = await withStartHooks(stats.io, gathered, '/repo', start)

      expect([run.reads, stats.stats]).toEqual([[], []])
      expect(started.setup).toEqual(emptySetupScan())
      expect('startHooks' in started.setup).toBe(false)
    }
  })
})
