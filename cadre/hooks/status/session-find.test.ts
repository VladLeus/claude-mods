import { describe, expect, test } from 'claude-code/testing'

import { mangledProjectDir } from '../paths'
import { DEFAULT_LOCATIONS, entry, entryAt, hostWorld, memHost, memIo, memWorld } from '../testkit'
import { beatSessionOf, MAX_TRANSCRIPTS, sessionOf, titleGrepArgv, transcriptCandidates } from './session-find'

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

  test('sessionOf greps the transcripts of the one shortened folder under projects/', async () => {
    const folder = `${projects}/${shortened}`
    const dirs = { [projects]: [entry(shortened, 'dir')], [folder]: [entryAt('s9.jsonl', 'file', 5)] }
    const run = memIo(memWorld({ dirs }), {})
    const result = { exitCode: 0, stdout: titleRow, stderr: '' }
    const host = memHost(hostWorld({ runs: [{ argv: titleGrepArgv(`${folder}/s9.jsonl`), result }] }))

    const found = await sessionOf(run.io, host.io, { locations: DEFAULT_LOCATIONS, id: 'be', startFolder })

    expect(found).toEqual({ sessionId: 's9', foundBy: 'title', folder: startFolder })
  })
})
