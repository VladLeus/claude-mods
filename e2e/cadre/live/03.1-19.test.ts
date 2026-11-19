import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { rowTest } from '../../lib/row.ts'
import {
  EPIC_KEY,
  epicBranchesOf,
  epicBranchOf,
  epicDone,
  gitOk,
  printEpic,
  worktreesOf,
} from '../lib/epic.ts'
import { firstLineOf, liveRepo, noteReply, replyOf } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const EXPECTED_BRANCH = 'epic/proj-1-add-retry'
const KEPT_BRANCH_WORDS = 'back on the kept branch'
const MAIN_AND_EPIC_WORKTREES = 2
const REFLOG_ARGS = ['reflog', 'show', '--date=unix', '--format=%H %gd %gs'] as const

// Each entry of the branch's reflog, newest first, with its time stamp.
async function reflogOf(copy: LiveRepo, branch: string): Promise<readonly string[]> {
  const text = await gitOk(copy, [...REFLOG_ARGS, branch])

  return text.split('\n').filter(line => line !== '')
}

rowTest(rowEntry('03.1#19'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  const branch = epicBranchOf(EPIC_KEY)

  const first = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'the first epic', first.result)
  const tip = await gitOk(copy, ['rev-parse', branch])
  const reflog = await reflogOf(copy, branch)
  const done = await epicDone(copy, EPIC_KEY, true)
  noteReply(ctx, 'epic done', done)
  await ctx.check('epic done removes the worktree and keeps the branch', async () => {
    assert.ok(!existsSync(first.worktree), `the worktree folder is still there: ${firstLineOf(replyOf(done))}`)
    assert.ok((await epicBranchesOf(copy)).includes(branch), 'the epic branch is gone')
  })
  // Without a removed worktree the second epic only reuses it and the re-add is not exercised.
  if (existsSync(first.worktree)) return

  // main moves on, so a branch made again from HEAD could not pass for the kept one.
  await gitOk(copy, ['commit', '-q', '--allow-empty', '-m', 'main moves on'])
  const second = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'the second epic', second.result)
  ctx.observe('reAddReplyNamesTheKeptBranch', second.reply.includes(KEPT_BRANCH_WORDS), firstLineOf(second.reply))

  await ctx.check('the second epic adds the worktree back', async () => {
    const listed = (await worktreesOf(copy)).length
    assert.ok(existsSync(second.worktree), 'the worktree folder is not there')
    assert.equal(listed, MAIN_AND_EPIC_WORKTREES, `git lists ${listed} worktrees`)
  })
  await ctx.check(`the worktree is on ${EXPECTED_BRANCH}`, async () => {
    const head = await gitOk(copy, ['-C', second.worktree, 'rev-parse', '--abbrev-ref', 'HEAD'])
    assert.equal(head, EXPECTED_BRANCH, `the worktree is on ${head}`)
  })
  await ctx.check('the branch is at its old tip and no other epic branch was made', async () => {
    const head = await gitOk(copy, ['-C', second.worktree, 'rev-parse', 'HEAD'])
    assert.equal(head, tip, 'the worktree is not at the old tip')
    assert.equal(await gitOk(copy, ['rev-parse', branch]), tip, 'the branch is not at the old tip')
    assert.deepEqual(await epicBranchesOf(copy), [EXPECTED_BRANCH], 'the epic branches are not the kept one alone')
  })
  await ctx.check('the branch reflog is unchanged: its first entry is the same and none was added', async () => {
    const now = await reflogOf(copy, branch)
    assert.equal(now.at(-1), reflog.at(-1), 'the first entry of the reflog changed')
    assert.equal(now.length, reflog.length, `the reflog holds ${now.length} entries, it held ${reflog.length}`)
  })
})
