import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { rowTest } from '../../lib/row.ts'
import { EPIC_KEY, epicBranchesOf, printEpic, roleIdsOf, worktreesOf } from '../lib/epic.ts'
import { liveRepo, noteReply } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const LINKED_RE = /Linked ([0-9]+), copied [0-9]+\./
const LINK_WARNING = 'out of the worktree: a folder above it there is a link'
const MAIN_AND_EPIC_WORKTREES = 2

// Every symlink of the worktree outside .git, as a path below it; a link is listed and never followed.
async function linksOf(root: string, dir: string = root): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const found: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) found.push(relative(root, path))
    if (entry.isDirectory() && entry.name !== '.git') found.push(...await linksOf(root, path))
  }

  return found.sort()
}

async function kickoffTimes(worktree: string, ids: readonly string[]): Promise<ReadonlyMap<string, number | null>> {
  const times = new Map<string, number | null>()
  for (const id of ids) {
    const stats = await stat(join(worktree, '.cadre', id, '.runtime', 'kickoff.txt')).catch(() => null)
    times.set(id, stats === null ? null : stats.mtimeMs)
  }

  return times
}

function linkedCount(reply: string): number | null {
  const count = LINKED_RE.exec(reply)?.[1]

  return count === undefined ? null : Number(count)
}

rowTest(rowEntry('03.1#13'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  const ids = await roleIdsOf(copy)

  const first = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'the first epic', first.result)
  const worktrees = await worktreesOf(copy)
  const branches = await epicBranchesOf(copy)
  const firstLinks = await linksOf(first.worktree)
  const firstKickoffs = await kickoffTimes(first.worktree, ids)

  const second = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'the second epic', second.result)
  const secondLinks = await linksOf(second.worktree)
  const secondKickoffs = await kickoffTimes(second.worktree, ids)

  ctx.observe('firstEpicLinked', linkedCount(first.reply), 'the Linked count of the first reply')
  ctx.observe('secondEpicLinked', linkedCount(second.reply), 'the Linked count of the second reply')
  ctx.observe('linksAfterTheFirstEpic', [...firstLinks], 'the symlinks of the worktree outside .git')
  ctx.observe('linksAfterTheSecondEpic', [...secondLinks], 'the symlinks of the worktree outside .git')

  await ctx.check('the first epic makes the worktree on one new epic branch', () => {
    assert.ok(existsSync(first.worktree), 'the epic worktree is not there')
    assert.equal(worktrees.length, MAIN_AND_EPIC_WORKTREES, `git lists ${worktrees.length} worktrees`)
    assert.equal(branches.length, 1, `git lists ${branches.length} epic branches`)
  })
  await ctx.check('the second epic reuses the worktree: the same worktrees and no new branch', async () => {
    assert.deepEqual(await worktreesOf(copy), worktrees, 'the worktrees changed')
    assert.deepEqual(await epicBranchesOf(copy), branches, 'the epic branches changed')
  })
  await ctx.check('the second epic links only what was missing', () => {
    const added = secondLinks.filter(link => !firstLinks.includes(link))
    const lost = firstLinks.filter(link => !secondLinks.includes(link))
    const linked = linkedCount(second.reply)
    assert.deepEqual(lost, [], `links of the first epic are gone: ${lost.join(', ')}`)
    assert.equal(linked, added.length, `the reply says Linked ${linked ?? 'nothing'}, ${added.length} links are new`)
  })
  for (const id of ids) {
    await ctx.check(`the second epic rewrites the kickoff of ${id}`, () => {
      const before = firstKickoffs.get(id)
      const after = secondKickoffs.get(id)
      const isRewritten = typeof before === 'number' && typeof after === 'number' && after > before
      assert.ok(isRewritten, `kickoff.txt of ${id}: first run ${String(before)}, second run ${String(after)}`)
    })
  }
  await ctx.check('the second epic warns of nothing below a link', () => {
    const warned = second.reply.split('\n').filter(line => line.includes(LINK_WARNING))
    assert.deepEqual(warned, [], 'the reply warns of a path below a link')
  })
})
