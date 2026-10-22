import { describe, expect, test } from 'claude-code/testing'

import { epicAddFailedReply, epicBadKeyReply, runEpic } from './epic'
import { hostWorld, memHost, memIo, memWorld } from './testkit'
import type { HostCall, HostRunRule, HostWrite, MemWorld } from './testkit'

/** The worktree `/cadre epic PROJ-1 Add retry` makes in the fixture repo /repo (D-146). */
const WORKTREE = '/repo/.claude/worktrees/proj-1-add-retry'

/** The branch of that worktree (D-146). */
const BRANCH = 'epic/proj-1-add-retry'

/** The add of that worktree on a new branch from the current HEAD (D-147). */
const ADD_ARGV = ['git', '-C', '/repo', 'worktree', 'add', '-b', BRANCH, WORKTREE, 'HEAD']

/** A fake host rule that answers `argv` with this exit code and output; a null exit code is a run the host rejected. */
function rule(argv: readonly string[], exitCode: number | null, stdout = ''): HostRunRule {
  return { argv, result: exitCode === null ? null : { exitCode, stdout, stderr: '' } }
}

/** A git repo at /repo; `over` changes the fields it names. */
function gitWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ dirs: { '/repo/.git': [] }, ...over })
}

/** What runEpic replied, and every write and run the fake host was asked for, in call order. */
type EpicRun = {
  readonly reply: string
  readonly writes: readonly HostWrite[]
  readonly calls: readonly HostCall[]
}

/**
 * runEpic of `key` and `title` (PROJ-1 and Add retry by default) over `world`, with these run rules; any other argv
 * exits 0 with no output.
 */
async function epic(
  world: MemWorld,
  runs: readonly HostRunRule[],
  key = 'PROJ-1',
  title = 'Add retry',
): Promise<EpicRun> {
  const host = memHost(hostWorld({ runs }))
  const reply = await runEpic(memIo(world, {}).io, host.io, { key, title, terminal: 'auto' })

  return { reply, writes: host.writes, calls: host.calls }
}

/** The argv of every `git worktree add` the run asked for. */
function addRuns(run: EpicRun): (readonly string[])[] {
  return run.calls.map(call => call.argv).filter(argv => argv[3] === 'worktree' && argv[4] === 'add')
}

describe('runEpic', () => {
  test('PROJ-1 Add retry adds the worktree on a new epic branch from HEAD and names both (D-145, D-146)', async () => {
    const run = await epic(gitWorld(), [rule(ADD_ARGV, 0)])

    expect(addRuns(run)).toEqual([ADD_ARGV])
    expect(run.reply).toContain(WORKTREE)
    expect(run.reply).toContain(BRANCH)
  })

  test('a key that is not 1-32 letters, digits, - or _ refuses before anything runs (D-162)', async () => {
    const run = await epic(gitWorld(), [rule(ADD_ARGV, 0)], '../x')

    expect(run.reply).toBe(epicBadKeyReply('../x'))
    expect(run.calls).toEqual([])
  })

  test('an add that fails says the new branch may now exist and is kept, and deletes nothing (Pitfall 3)', async () => {
    const run = await epic(gitWorld(), [rule(ADD_ARGV, 128)])

    expect(run.reply).toBe(epicAddFailedReply(BRANCH, true))
    expect(run.reply).toContain(BRANCH)
    expect(run.calls.filter(call => call.argv[3] === 'branch')).toEqual([])
  })
})
