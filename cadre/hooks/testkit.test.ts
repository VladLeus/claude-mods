import { describe, expect, test } from 'claude-code/testing'

import type { AskSpec, TemplateRoleId } from '../types'
import { ROLE_TEMPLATE, roleFromTemplate } from './roles'
import {
  ABSOLUTE_PATH_MARKERS,
  BIDI_OVERRIDE,
  DEFAULT_LOCATIONS,
  EMPTY_FACTS,
  emptySetupScan,
  entry,
  FRAMEWORKS,
  INIT_ANSWERS,
  leaks,
  link,
  memIo,
  memWorld,
  SECRET_FIXTURES,
  session,
  skillRef,
  templateRole,
  ZERO_WIDTH_SPACE,
} from './testkit'

const SPEC: AskSpec = { options: ['one', 'two'] }

/** The message a promise rejects with, or null when it resolves. */
async function rejection(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise

    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'not an Error'
  }
}

describe('testkit', () => {
  test('memWorld with no override is an interactive session at /repo with nothing readable', () => {
    const world = memWorld({})
    expect(world.interactive).toBe(true)
    expect(world.locations).toEqual(DEFAULT_LOCATIONS)
    expect(world.facts).toEqual({ facts: EMPTY_FACTS, gsdUserDir: null })
    expect(world.sessionId).toBe('s1')
    expect(world.now).toBe(1_000_000)
    expect(world.cadreVersion).toBe('0.2.0')
    expect(world.files).toEqual({})
    expect(world.dirs).toEqual({})
    expect(world.unknownPaths).toEqual([])
    expect(world.realPaths).toEqual({})
    expect(world.ancestors).toEqual([])
    expect(world.settings).toEqual({ user: {}, project: {}, local: {} })
    expect(world.commands).toEqual([])
    expect(world.tools).toEqual([])
    expect(world.replies).toEqual([])
  })

  test('memWorld keeps an override and leaves every other field at its default', () => {
    const world = memWorld({ interactive: false, sessionId: null, files: { '/repo/a.txt': 'abc' } })
    expect(world.interactive).toBe(false)
    expect(world.sessionId).toBeNull()
    expect(world.files).toEqual({ '/repo/a.txt': 'abc' })
    expect(world.now).toBe(1_000_000)
    expect(world.cadreVersion).toBe('0.2.0')
  })

  test('DEFAULT_LOCATIONS is the /repo session of a user whose home is /home/u, with no warnings', () => {
    expect(DEFAULT_LOCATIONS).toEqual({
      root: '/repo',
      givenRoot: '/repo',
      home: '/home/u',
      givenHome: '/home/u',
      configDir: null,
      warnings: [],
    })
  })

  test('EMPTY_FACTS has every list empty', () => {
    expect(EMPTY_FACTS).toEqual({
      repoEntries: [],
      docsEntries: [],
      enabledPlugins: [],
      hookScripts: [],
      superpowersVersions: [],
      gsd: [],
      warnings: [],
    })
  })

  test('an array of answers is given in order, then the dialog is dismissed, and every ask is recorded', async () => {
    const run = memIo(memWorld({}), ['a', 'b'])
    expect(await run.io.ask('one?', SPEC)).toBe('a')
    expect(await run.io.ask('two?', SPEC)).toBe('b')
    expect(await rejection(run.io.ask('three?', SPEC))).toBe('dismissed')
    expect(run.asked).toEqual(['one?', 'two?', 'three?'])
    expect(run.specs).toEqual([SPEC, SPEC, SPEC])
  })

  test('with no answers at all the first ask is already dismissed', async () => {
    const run = memIo(memWorld({}), [])
    expect(await rejection(run.io.ask('one?', SPEC))).toBe('dismissed')
    expect(run.asked).toEqual(['one?'])
  })

  test('a record of answers gives the value of the longest key the question starts with', async () => {
    const run = memIo(memWorld({}), { Git: 'x', 'Git policy': 'y' })
    expect(await run.io.ask('Git policy for .cadre/?', SPEC)).toBe('y')
    expect(await run.io.ask('Git remote?', SPEC)).toBe('x')
    expect(run.asked).toEqual(['Git policy for .cadre/?', 'Git remote?'])
  })

  test('a record of answers dismisses a question no key starts, and answers a repeated question again', async () => {
    const run = memIo(memWorld({}), { Git: 'x' })
    expect(await rejection(run.io.ask('Other?', SPEC))).toBe('dismissed')
    expect(await run.io.ask('Git?', SPEC)).toBe('x')
    expect(await run.io.ask('Git?', SPEC)).toBe('x')
    expect(run.asked).toEqual(['Other?', 'Git?', 'Git?'])
  })

  test('read gives the text of a listed file, unknown for an unknown path and absent for any other path', async () => {
    const world = memWorld({ files: { '/repo/a.txt': 'abc' }, unknownPaths: ['/repo/u.txt'] })
    const run = memIo(world, [])
    expect(await run.io.read('/repo/a.txt', 100)).toEqual({ state: 'text', text: 'abc' })
    expect(await run.io.read('/repo/u.txt', 100)).toEqual({ state: 'unknown' })
    expect(await run.io.read('/repo/none.txt', 100)).toEqual({ state: 'absent' })
  })

  test('read of a file longer than maxBytes is too-large with its length, and at the limit it is text', async () => {
    const run = memIo(memWorld({ files: { '/repo/a.txt': 'abcd' } }), [])
    expect(await run.io.read('/repo/a.txt', 3)).toEqual({ state: 'too-large', bytes: 4 })
    expect(await run.io.read('/repo/a.txt', 4)).toEqual({ state: 'text', text: 'abcd' })
  })

  test('a path that is both listed and unknown reads as unknown, and every read is recorded', async () => {
    const run = memIo(memWorld({ files: { '/repo/a.txt': 'abc' }, unknownPaths: ['/repo/a.txt'] }), [])
    expect(await run.io.read('/repo/a.txt', 100)).toEqual({ state: 'unknown' })
    await run.io.read('/repo/b.txt', 100)
    expect(run.reads).toEqual(['/repo/a.txt', '/repo/b.txt'])
  })

  test('stat of a file gives kind file, its length as size and its real path', async () => {
    const files = { '/repo/a.txt': 'abc', '/repo/l.txt': 'ab' }
    const run = memIo(memWorld({ files, realPaths: { '/repo/l.txt': '/data/l.txt' } }), [])
    expect(await run.io.stat('/repo/a.txt')).toEqual({ kind: 'file', size: 3, isLink: false, realPath: '/repo/a.txt' })
    expect(await run.io.stat('/repo/l.txt')).toEqual({ kind: 'file', size: 2, isLink: true, realPath: '/data/l.txt' })
  })

  test('a path whose real path is itself is not a link, even when realPaths names it', async () => {
    const run = memIo(memWorld({ files: { '/repo/a.txt': 'abc' }, realPaths: { '/repo/a.txt': '/repo/a.txt' } }), [])
    expect(await run.io.stat('/repo/a.txt')).toEqual({ kind: 'file', size: 3, isLink: false, realPath: '/repo/a.txt' })
  })

  test('sizes are UTF-8 bytes: a non-ASCII text is sized by stat and read by its bytes', async () => {
    const run = memIo(memWorld({ files: { '/repo/a.txt': '€€' } }), [])
    expect(await run.io.stat('/repo/a.txt')).toEqual({ kind: 'file', size: 6, isLink: false, realPath: '/repo/a.txt' })
    expect(await run.io.read('/repo/a.txt', 5)).toEqual({ state: 'too-large', bytes: 6 })
    expect(await run.io.read('/repo/a.txt', 6)).toEqual({ state: 'text', text: '€€' })
  })

  test('read of a listed folder is unknown, as the real port never reads a non-file', async () => {
    const run = memIo(memWorld({ dirs: { '/repo/src': [entry('a.ts')] } }), [])
    expect(await run.io.read('/repo/src', 100)).toEqual({ state: 'unknown' })
  })

  test('stat of a listed folder gives kind dir, and of a missing or unknown path gives null', async () => {
    const world = memWorld({ dirs: { '/repo/src': [entry('a.ts')] }, unknownPaths: ['/repo/u'] })
    const run = memIo(world, [])
    expect(await run.io.stat('/repo/src')).toEqual({ kind: 'dir', size: 0, isLink: false, realPath: '/repo/src' })
    expect(await run.io.stat('/repo/none')).toBeNull()
    expect(await run.io.stat('/repo/u')).toBeNull()
  })

  test('list gives the listing of a folder in dirs, and null for a folder not listed or unknown', async () => {
    const listing = [entry('a.ts'), entry('docs', 'dir')]
    const run = memIo(memWorld({ dirs: { '/repo': listing, '/repo/u': listing }, unknownPaths: ['/repo/u'] }), [])
    expect(await run.io.list('/repo')).toEqual(listing)
    expect(await run.io.list('/repo/none')).toBeNull()
    expect(await run.io.list('/repo/u')).toBeNull()
    expect(run.listed).toEqual(['/repo', '/repo/none', '/repo/u'])
  })

  test('entry builds a plain file unless told otherwise, and link a symbolic link', () => {
    expect(entry('a.ts')).toEqual({ name: 'a.ts', kind: 'file', size: 0, mtimeMs: 0, isLink: false })
    expect(entry('src', 'dir', true)).toEqual({ name: 'src', kind: 'dir', size: 0, mtimeMs: 0, isLink: true })
    expect(link('alias')).toEqual({ name: 'alias', kind: 'other', size: 0, mtimeMs: 0, isLink: true })
  })

  test('the hostile-text constants are the bidi override and the zero-width space', () => {
    expect(BIDI_OVERRIDE.codePointAt(0)).toBe(0x202e)
    expect(ZERO_WIDTH_SPACE.codePointAt(0)).toBe(0x200b)
    expect([BIDI_OVERRIDE.length, ZERO_WIDTH_SPACE.length]).toEqual([1, 1])
  })

  test('settings gives the world value of a source, and null for a source the world does not have', async () => {
    const world = memWorld({ settings: { user: { autoCompactWindow: 800000 }, project: {} } })
    const run = memIo(world, [])
    expect(await run.io.settings('user')).toEqual({ autoCompactWindow: 800000 })
    expect(await run.io.settings('project')).toEqual({})
    expect(await run.io.settings('local')).toBeNull()
  })

  test('complete answers the replies in order, then null, and records each system and prompt', async () => {
    const run = memIo(memWorld({ replies: ['first', null, 'third'] }), [])
    expect(await run.io.complete('p1', 's1')).toBe('first')
    expect(await run.io.complete('p2', 's2')).toBeNull()
    expect(await run.io.complete('p3', 's3')).toBe('third')
    expect(await run.io.complete('p4', 's4')).toBeNull()
    expect(run.prompts).toEqual(['s1\n---\np1', 's2\n---\np2', 's3\n---\np3', 's4\n---\np4'])
  })

  test('log records each line', () => {
    const run = memIo(memWorld({}), [])
    run.io.log('first')
    run.io.log('second')
    expect(run.logged).toEqual(['first', 'second'])
  })

  test('the other members give the values of the world', async () => {
    const facts = { facts: EMPTY_FACTS, gsdUserDir: '/home/u/.claude/gsd-core' }
    const world = memWorld({
      interactive: null,
      locations: null,
      facts,
      sessionId: null,
      now: null,
      cadreVersion: '1.2.3',
      ancestors: [{ dir: '/repo', name: 'CLAUDE.md', content: 'x' }],
      commands: [{ name: 'a' }],
      tools: [{ name: 'b' }],
    })
    const run = memIo(world, [])
    expect(await run.io.isInteractive()).toBeNull()
    expect(await run.io.locations()).toBeNull()
    expect(await run.io.facts(DEFAULT_LOCATIONS)).toEqual(facts)
    expect(await run.io.sessionId()).toBeNull()
    expect(await run.io.now()).toBeNull()
    expect(await run.io.cadreVersion()).toBe('1.2.3')
    expect(await run.io.ancestors(['CLAUDE.md'])).toEqual([{ dir: '/repo', name: 'CLAUDE.md', content: 'x' }])
    expect(await run.io.commands()).toEqual([{ name: 'a' }])
    expect(await run.io.tools()).toEqual([{ name: 'b' }])
  })

  test('leaks returns the needles found in the text, in needle order', () => {
    expect(leaks('a sk-FAKE-SECRET-0123456789 b', SECRET_FIXTURES)).toEqual(['sk-FAKE-SECRET-0123456789'])
    expect(leaks('SENTINEL_SECRET_VALUE then Bearer FAKE-TOKEN-0123', SECRET_FIXTURES)).toEqual([
      'Bearer FAKE-TOKEN-0123',
      'SENTINEL_SECRET_VALUE',
    ])
  })

  test('leaks of clean text, or of no needles, is empty', () => {
    expect(leaks('clean', SECRET_FIXTURES)).toEqual([])
    expect(leaks('sk-FAKE-SECRET-0123456789', [])).toEqual([])
  })

  test('the secret fixtures and the absolute path markers are frozen', () => {
    expect(Object.isFrozen(SECRET_FIXTURES)).toBe(true)
    expect(Object.isFrozen(ABSOLUTE_PATH_MARKERS)).toBe(true)
  })

  test('the fixtures hold the secrets and the absolute paths the property tests scan for', () => {
    expect(SECRET_FIXTURES).toEqual([
      'sk-FAKE-SECRET-0123456789',
      'Bearer FAKE-TOKEN-0123',
      'ghp_FAKEFAKEFAKEFAKEFAKE',
      'SENTINEL_SECRET_VALUE',
    ])
    expect(ABSOLUTE_PATH_MARKERS).toEqual(['/Users/', '/home/', '/private/'])
  })
})

/** Whether calling `run` throws. */
function throws(run: () => unknown): boolean {
  try {
    run()
  } catch {
    return true
  }

  return false
}

describe('shared fixtures', () => {
  test('templateRole is the template role as init builds it, and over changes the fields it names', () => {
    const row = ROLE_TEMPLATE.find(candidate => candidate.id === 'pm')
    if (row === undefined) throw new Error('no template row pm')
    expect(templateRole('pm')).toEqual(roleFromTemplate(row))
    expect(templateRole('be', { hasBash: false }).hasBash).toBe(false)
    expect(templateRole('be', { hasBash: false }).id).toBe('be')
  })

  test('templateRole refuses an id that is no template role', () => {
    const unknownId: TemplateRoleId = JSON.parse('"nobody"')
    expect(throws(() => templateRole(unknownId))).toBe(true)
    expect(throws(() => templateRole('qa'))).toBe(false)
  })

  test('emptySetupScan has every list empty and every flag false, and over changes the fields it names', () => {
    expect(emptySetupScan()).toEqual({
      plugins: [],
      skills: [],
      mcp: [],
      isMcpPartial: false,
      agents: [],
      claudeMd: [],
      hasGlobalClaudeMd: false,
      memoryFiles: [],
      settingsKeys: [],
      hooks: [],
      carry: { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] },
      warnings: [],
    })
    expect(emptySetupScan({ plugins: ['a@m'] }).plugins).toEqual(['a@m'])
    expect(emptySetupScan({ plugins: ['a@m'] }).skills).toEqual([])
  })

  test('FRAMEWORKS lists the three frameworks; session and skillRef build an MCP server and a skill', () => {
    expect(FRAMEWORKS).toEqual(['gsd', 'superpowers', 'none'])
    expect(session('x')).toEqual({ name: 'x', source: 'session' })
    expect(skillRef('s')).toEqual({ name: 's', plugin: null })
    expect(skillRef('rescue', 'codex')).toEqual({ name: 'rescue', plugin: 'codex' })
  })

  test('INIT_ANSWERS answers every question of a whole init run by prefix, and is frozen', () => {
    expect(INIT_ANSWERS).toEqual({
      'Read ~/.claude.json': 'No, skip it',
      'Use these roles?': 'Use these roles',
      'Which framework do the roles use': 'Same for all roles',
      'Framework for': 'GSD',
      'Autopilot duration': '4h',
      'Model and effort: same': 'Same for all roles',
      'Model and effort for': 'opus + medium',
      'Which roles get': 'None',
      'Which env variables': 'None',
      '.planning/config.json:': 'Accept',
      'Git policy': 'Commit definitions (default)',
      'Where should the role launchers start': 'Git root of this repo',
      'Review the plan': 'Confirm',
      "Scan this repo's session history": 'No, skip it',
    })
    expect(Object.keys(INIT_ANSWERS)).toHaveLength(14)
    expect(Object.isFrozen(INIT_ANSWERS)).toBe(true)
  })
})
