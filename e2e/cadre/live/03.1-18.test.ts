import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { scratchEnv } from '../../lib/env.ts'
import type { ChildEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { run, spawn } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import { epicBranchesOf, epicBranchOf, epicDone, gitOk, printEpic, worktreesOf } from '../lib/epic.ts'
import { firstLineOf, liveRepo, noteReply, replyOf } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const KEYS = { dead: 'PROJ-1', live: 'PROJ-2', none: 'PROJ-3' } as const
const PS = '/bin/ps'
const TRUE = '/usr/bin/true'
const SLEEP = '/bin/sleep'
const SLEEP_S = 300
const PS_MS = 10_000
const PS_ALIVE = 0
const PS_ENDED = 1
const NO_PID_REASON = 'held by the e2e row'
const EXPECTED_NO_PROCESS = /names no process/
const LOCKED_PREFIX = 'locked'

type Refusal = {
  readonly name: string
  readonly key: string
  readonly worktree: string
  readonly lock: string
  readonly reason: RegExp
}

async function psExit(copy: LiveRepo, env: ChildEnv, args: readonly string[]): Promise<number> {
  const result = await run([PS, ...args], { cwd: copy.repo, env, timeoutMs: PS_MS })

  return result.code
}

// The lock reason git lists for a worktree: null when it is not locked, an empty text when it is locked with none.
async function lockReasonOf(copy: LiveRepo, worktree: string): Promise<string | null> {
  const paths = [worktree, await realpath(worktree).catch(() => worktree)]
  const listing = await gitOk(copy, ['worktree', 'list', '--porcelain'])
  for (const block of listing.split('\n\n')) {
    const lines = block.split('\n')
    if (!paths.some(path => lines[0] === `worktree ${path}`)) continue
    const locked = lines.find(line => line === LOCKED_PREFIX || line.startsWith(`${LOCKED_PREFIX} `))

    return locked === undefined ? null : locked.slice(LOCKED_PREFIX.length).trim()
  }

  return null
}

// A fresh epic, clean and merged with no role running, so only the lock rule can keep it, locked with `reason`.
async function lockedEpic(ctx: RowContext, copy: LiveRepo, key: string, reason: string): Promise<string> {
  const epic = await printEpic(copy, key)
  noteReply(ctx, `${key}: epic`, epic.result)
  await gitOk(copy, ['worktree', 'lock', '--reason', reason, epic.worktree])

  return epic.worktree
}

// epic done once, and what it left of the worktree, its branch and its lock.
async function refuses(ctx: RowContext, copy: LiveRepo, spec: Refusal): Promise<void> {
  const count = (await worktreesOf(copy)).length
  const done = await epicDone(copy, spec.key, true)
  noteReply(ctx, `${spec.name}: epic done`, done)
  await ctx.check(`${spec.name}: epic done refuses and names the lock`, () => {
    assert.match(replyOf(done), spec.reason, `the reply is: ${firstLineOf(replyOf(done))}`)
  })
  await ctx.check(`${spec.name}: epic done removes nothing and leaves the lock`, async () => {
    assert.ok(existsSync(spec.worktree), 'the worktree folder is gone')
    assert.equal((await worktreesOf(copy)).length, count, 'git lists another number of worktrees')
    assert.ok((await epicBranchesOf(copy)).includes(epicBranchOf(spec.key)), 'the epic branch is gone')
    assert.equal(await lockReasonOf(copy, spec.worktree), spec.lock, 'the lock is not the one that was set')
  })
}

// The pid of a process that has finished, which ps must read as ended before a lock names it.
async function endedPid(copy: LiveRepo, env: ChildEnv): Promise<number> {
  const child = spawn([TRUE], { cwd: copy.repo, env })
  await child.done
  const { pid } = child
  if (pid === undefined) throw new HarnessError('03.1#18: the finished process has no pid')
  if (await psExit(copy, env, ['-p', String(pid)]) !== PS_ENDED) {
    throw new HarnessError(`03.1#18: ps still sees the finished process ${pid}`)
  }

  return pid
}

async function deadCase(ctx: RowContext, copy: LiveRepo, env: ChildEnv): Promise<void> {
  const pid = await endedPid(copy, env)
  const worktree = await lockedEpic(ctx, copy, KEYS.dead, `pid ${pid}`)
  const count = (await worktreesOf(copy)).length
  const done = await epicDone(copy, KEYS.dead, true)
  noteReply(ctx, 'dead pid: epic done', done)
  await ctx.check('dead pid: epic done unlocks and removes the worktree', async () => {
    assert.ok(!existsSync(worktree), `the worktree folder is still there: ${firstLineOf(replyOf(done))}`)
    assert.equal((await worktreesOf(copy)).length, count - 1, 'git still lists the worktree')
  })
}

async function liveCase(ctx: RowContext, copy: LiveRepo, env: ChildEnv): Promise<void> {
  const sleeper = spawn([SLEEP, String(SLEEP_S)], { cwd: copy.repo, env })
  const ended = sleeper.done.catch(() => null)
  ctx.after(async () => {
    sleeper.kill()
    await ended
  })
  const { pid } = sleeper
  if (pid === undefined) throw new HarnessError('03.1#18: the sleep process has no pid')
  if (await psExit(copy, env, ['-p', String(pid)]) !== PS_ALIVE) {
    throw new HarnessError(`03.1#18: ps does not see the sleep process ${pid}`)
  }

  const lock = `pid ${pid}`
  const worktree = await lockedEpic(ctx, copy, KEYS.live, lock)
  const reason = new RegExp(`\\b${pid}\\b.*still runs`, 's')
  await refuses(ctx, copy, { name: 'live pid', key: KEYS.live, worktree, lock, reason })
}

async function noPidCase(ctx: RowContext, copy: LiveRepo): Promise<void> {
  const worktree = await lockedEpic(ctx, copy, KEYS.none, NO_PID_REASON)
  const spec = { name: 'no pid', key: KEYS.none, worktree, lock: NO_PID_REASON, reason: EXPECTED_NO_PROCESS }
  await refuses(ctx, copy, spec)
}

rowTest(rowEntry('03.1#18'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  const env = await scratchEnv(join(ctx.scratch, 'env'))

  await ctx.check('/bin/ps -p 1 exits 0', async () => {
    const result = await run([PS, '-p', '1'], { cwd: copy.repo, env, timeoutMs: PS_MS })
    ctx.evidence('/bin/ps -p 1', result.stdout)
    assert.equal(result.code, PS_ALIVE, `ps -p 1 exited ${result.code}: ${result.stderr.trim()}`)
  })
  await deadCase(ctx, copy, env)
  await liveCase(ctx, copy, env)
  await noPidCase(ctx, copy)
})
