import { describe, expect, test } from 'claude-code/testing'

import type { InitIo } from '../../types'
import { memIo, memWorld } from '../testkit'
import type { MemWorld } from '../testkit'
import { findGitTop } from './checkout'

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
