import { describe, expect, test } from 'claude-code/testing'

import type { PortEntry } from '../../types'
import { mangledProjectDir } from '../paths'
import { DEFAULT_LOCATIONS, entry, entryAt, hostWorld, memHost, memIo, memWorld } from '../testkit'
import type { HostRunRule } from '../testkit'
import {
  beatSessionOf,
  cwdGrepArgv,
  MAX_TRANSCRIPTS,
  sessionOf,
  titleGrepArgv,
  transcriptCandidates,
} from './session-find'
import type { FoundSession } from './session-find'

/** A fleet beat of agent-fleet's on-disk shape, for the session `id`; `over` changes the fields it names. */
function beat(id: string, over: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { id, name: 'cadre-be', cwd: '/repo', beatAt: 500, isEnded: false, ...over }
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
    expect(beatSessionOf(values, 'be', '/repo', ['/repo'])).toEqual({ sessionId: 's-new', cwd: '/repo' })
    expect(beatSessionOf([], 'be', '/repo', ['/repo'])).toBeNull()
    expect(beatSessionOf([beat('s-pm', { name: 'cadre-pm' })], 'be', '/repo', ['/repo'])).toBeNull()
  })
})

describe('the shortened transcript folder', () => {
  const projects = '/home/u/.claude/projects'
  const startFolder = `/repo/${'w'.repeat(103)}/${Array.from({ length: 5 }, (_, at) => `${at}`.repeat(50)).join('/')}`
  const shortened = `${mangledProjectDir(startFolder).slice(0, 200)}-x1y2z3`
  const titleRow = `${JSON.stringify({ type: 'custom-title', customTitle: 'cadre-be', sessionId: 'x' })}\n`
  const TITLED = { exitCode: 0, stdout: titleRow, stderr: '' }
  const HELD = { exitCode: 0, stdout: '', stderr: '' }
  const NOT_HELD = { exitCode: 1, stdout: '', stderr: '' }

  /** The folder name the engine gives a start folder whose encoded name is over 200 characters. */
  function shortenedOf(folder: string, suffix: string): string {
    return `${mangledProjectDir(folder).slice(0, 200)}-${suffix}`
  }

  /** sessionOf of be in `startFolder` over these listings and grep rules, with the greps it ran. */
  async function found(
    start: string,
    dirs: Readonly<Record<string, readonly PortEntry[]>>,
    runs: readonly HostRunRule[],
  ): Promise<{ readonly session: FoundSession | null; readonly greps: readonly (readonly string[])[] }> {
    const host = memHost(hostWorld({ runs }))
    const session = await sessionOf(memIo(memWorld({ dirs }), {}).io, host.io, {
      locations: DEFAULT_LOCATIONS,
      id: 'be',
      startFolder: start,
    })

    return { session, greps: host.calls.map(call => call.argv) }
  }

  test('sessionOf greps the one shortened folder whose transcript holds the start folder', async () => {
    const folder = `${projects}/${shortened}`
    const dirs = { [projects]: [entry(shortened, 'dir')], [folder]: [entryAt('s9.jsonl', 'file', 5)] }
    const runs = [
      { argv: cwdGrepArgv(`${folder}/s9.jsonl`, startFolder), result: HELD },
      { argv: titleGrepArgv(`${folder}/s9.jsonl`), result: TITLED },
    ]
    const { session } = await found(startFolder, dirs, runs)

    expect(session).toEqual({ sessionId: 's9', foundBy: 'title', folder: startFolder })
    expect(cwdGrepArgv('/p/s.jsonl', '/a/b')).toEqual([
      '/usr/bin/grep',
      '-F',
      '-q',
      '-m',
      '1',
      '-e',
      '"cwd":"/a/b"',
      '--',
      '/p/s.jsonl',
    ])
  })

  test('an epic worktree whose root shares the prefix does not follow the main checkout\'s folder', async () => {
    const root = `/repo/${'w'.repeat(250)}`
    const worktree = `${root}/.claude/worktrees/proj-1`
    const main = `${projects}/${shortenedOf(root, 'm1')}`
    const dirs = { [projects]: [entry(shortenedOf(root, 'm1'), 'dir')], [main]: [entryAt('s1.jsonl', 'file', 5)] }
    const runs = [
      { argv: cwdGrepArgv(`${main}/s1.jsonl`, worktree), result: NOT_HELD },
      { argv: titleGrepArgv(`${main}/s1.jsonl`), result: TITLED },
    ]
    const { session, greps } = await found(worktree, dirs, runs)

    expect(mangledProjectDir(worktree).slice(0, 200)).toBe(mangledProjectDir(root).slice(0, 200))
    expect([session, greps]).toEqual([null, [cwdGrepArgv(`${main}/s1.jsonl`, worktree)]])
  })

  test('PROJ-1 does not follow PROJ-2\'s folder when only PROJ-2 has run', async () => {
    const root = `/${'w'.repeat(183)}`
    const proj1 = `${root}/.claude/worktrees/PROJ-1`
    const proj2 = `${root}/.claude/worktrees/PROJ-2`
    const folder = `${projects}/${shortenedOf(proj2, 'h2')}`
    const dirs = { [projects]: [entry(shortenedOf(proj2, 'h2'), 'dir')], [folder]: [entryAt('s2.jsonl', 'file', 5)] }
    const runs = [
      { argv: cwdGrepArgv(`${folder}/s2.jsonl`, proj1), result: NOT_HELD },
      { argv: titleGrepArgv(`${folder}/s2.jsonl`), result: TITLED },
    ]
    const { session } = await found(proj1, dirs, runs)

    expect(mangledProjectDir(root).length).toBe(184)
    expect(session).toBeNull()
  })

  test('of two candidates the one whose transcript holds the start folder is followed', async () => {
    const [a, b] = [`${projects}/${shortenedOf(startFolder, 'a1')}`, `${projects}/${shortenedOf(startFolder, 'b2')}`]
    const dirs = {
      [projects]: [entry(shortenedOf(startFolder, 'a1'), 'dir'), entry(shortenedOf(startFolder, 'b2'), 'dir')],
      [a]: [entryAt('sa.jsonl', 'file', 5)],
      [b]: [entryAt('sb.jsonl', 'file', 5)],
    }
    const runs = [
      { argv: cwdGrepArgv(`${a}/sa.jsonl`, startFolder), result: NOT_HELD },
      { argv: titleGrepArgv(`${a}/sa.jsonl`), result: TITLED },
      { argv: cwdGrepArgv(`${b}/sb.jsonl`, startFolder), result: HELD },
      { argv: titleGrepArgv(`${b}/sb.jsonl`), result: TITLED },
    ]
    const { session } = await found(startFolder, dirs, runs)

    expect(session).toEqual({ sessionId: 'sb', foundBy: 'title', folder: startFolder })
  })

  test('a start folder of 200 characters or fewer runs no cwd grep', async () => {
    const folder = `${projects}/-repo`
    const dirs = { [folder]: [entryAt('s9.jsonl', 'file', 5)] }
    const runs = [{ argv: titleGrepArgv(`${folder}/s9.jsonl`), result: TITLED }]
    const { session, greps } = await found('/repo', dirs, runs)

    expect([session?.sessionId, greps]).toEqual(['s9', [titleGrepArgv(`${folder}/s9.jsonl`)]])
  })
})
