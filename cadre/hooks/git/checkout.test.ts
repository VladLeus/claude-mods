import { describe, expect, test } from 'claude-code/testing'

import type { HostRun, InitIo } from '../../types'
import { memIo, memWorld } from '../testkit'
import type { MemWorld } from '../testkit'
import { checkoutOf, epicWorktreeMain, findGitTop } from './checkout'

describe('findGitTop', () => {
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
})

describe('where /cadre epic runs and what it needs (D-161, D-165)', () => {
  test('checkoutOf reads the main checkout and a linked worktree from git; anything else is unknown', () => {
    const run = (exitCode: number, stdout: string): HostRun => ({ exitCode, stdout, stderr: '' })

    expect(checkoutOf(run(0, '/repo/.git\n/repo/.git\n'))).toEqual({ kind: 'main' })
    expect(checkoutOf(run(0, '/repo/.git/worktrees/x\n/repo/.git\n'))).toEqual({ kind: 'linked', main: '/repo' })
    expect(checkoutOf(null)).toEqual({ kind: 'unknown' })
    expect(checkoutOf(run(128, '/repo/.git\n/repo/.git\n'))).toEqual({ kind: 'unknown' })
    expect(checkoutOf(run(0, '/repo/.git\n'))).toEqual({ kind: 'unknown' })
  })
})

describe('epicWorktreeMain', () => {
  const ROOT = '/m/.claude/worktrees/k'
  const GIT_FILE = `${ROOT}/.git`
  const GIT_LINE = 'gitdir: /m/.git/worktrees/k\n'
  const RECORD = '/m/.git/worktrees/k/cadre-epic.json'
  /** An epic worktree of the main checkout /m: its .git file names its git dir, which holds the epic record. */
  const EPIC_FILES = { [GIT_FILE]: GIT_LINE, [RECORD]: '{}' }

  async function mainOf(world: MemWorld): Promise<string | null> {
    return epicWorktreeMain(memIo(world, []).io, ROOT)
  }

  test('a .git file naming a worktree git dir that holds the epic record gives the main checkout', async () => {
    const run = memIo(memWorld({ files: EPIC_FILES }), [])
    expect(await epicWorktreeMain(run.io, ROOT)).toBe('/m')
    expect([run.reads, run.asked]).toEqual([[GIT_FILE], []])
  })

  test('with the epic record absent, a link or a folder it is no epic worktree', async () => {
    const absent = memWorld({ files: { [GIT_FILE]: GIT_LINE } })
    const link = memWorld({ files: EPIC_FILES, realPaths: { [RECORD]: '/elsewhere/cadre-epic.json' } })
    const folder = memWorld({ files: { [GIT_FILE]: GIT_LINE }, dirs: { [RECORD]: [] } })
    expect([await mainOf(absent), await mainOf(link), await mainOf(folder)]).toEqual([null, null, null])
  })

  test('a .git folder, as the main checkout has, or a .git link is no epic worktree', async () => {
    const main = memWorld({ files: { [RECORD]: '{}' }, dirs: { [GIT_FILE]: [] } })
    const link = memWorld({ files: EPIC_FILES, realPaths: { [GIT_FILE]: '/elsewhere/.git' } })
    expect([await mainOf(main), await mainOf(link)]).toEqual([null, null])
  })

  test('a relative gitdir is resolved against the root', async () => {
    const files = { ...EPIC_FILES, [GIT_FILE]: 'gitdir: ../../../.git/worktrees/k\n' }
    expect(await mainOf(memWorld({ files }))).toBe('/m')
  })

  test('a text that is not one gitdir line, or a gitdir with no /.git/worktrees/ segment, gives null', async () => {
    for (const text of [`${GIT_LINE}${GIT_LINE}`, 'git dir /m/.git/worktrees/k\n', '', 'gitdir: \n']) {
      expect(await mainOf(memWorld({ files: { ...EPIC_FILES, [GIT_FILE]: text } }))).toBeNull()
    }
    const outside = { [GIT_FILE]: 'gitdir: /m/gits/k\n', '/m/gits/k/cadre-epic.json': '{}' }
    expect(await mainOf(memWorld({ files: outside }))).toBeNull()
  })
})
