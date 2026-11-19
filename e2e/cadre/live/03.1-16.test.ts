import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { HarnessError } from '../../lib/errors.ts'
import { hashFile } from '../../lib/hash.ts'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import {
  commitInWorktree,
  epicBranchesOf,
  epicBranchOf,
  epicDone,
  gitOk,
  kindOf,
  printEpic,
  roleIdsOf,
  worktreesOf,
} from '../lib/epic.ts'
import { liveRepo, noteReply, replyOf } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const KEY = 'PROJ-1'
const IGNORED = 'node_modules/\nthoughts/\n'
const NODE_FILE = 'node_modules/x/index.js'
const THOUGHTS_FILE = 'thoughts/shared/note.md'
const MAIN_ONLY_WORKTREE = 1

type Variant = {
  readonly name: string
  readonly key: string
  // Brings the work of the epic branch into main the way a pull request merged elsewhere would.
  readonly merge: (copy: LiveRepo, branch: string, scratch: string) => Promise<void>
}

async function squashMerge(copy: LiveRepo, branch: string): Promise<void> {
  await gitOk(copy, ['merge', '--squash', branch])
  await gitOk(copy, ['commit', '-q', '-m', 'squash the epic'])
}

// main moves on first, as it does while a pull request waits, so the picked commit is a new one and not the branch tip.
async function rebaseMerge(copy: LiveRepo, branch: string): Promise<void> {
  await gitOk(copy, ['commit', '-q', '--allow-empty', '-m', 'main moves on'])
  await gitOk(copy, ['cherry-pick', branch])
}

// A local bare repo stands for the remote; the merge is made in a second clone and pushed there, never into main.
async function remoteMerge(copy: LiveRepo, branch: string, scratch: string): Promise<void> {
  const remote = join(scratch, 'remote.git')
  const other = join(scratch, 'other')
  await gitOk(copy, ['init', '-q', '--bare', '-b', 'main', remote])
  await gitOk(copy, ['remote', 'add', 'origin', remote])
  await gitOk(copy, ['push', '-q', 'origin', 'main', branch])
  await gitOk(copy, ['clone', '-q', remote, other])
  await gitOk(copy, ['-C', other, 'merge', '--no-ff', '-m', 'merge on the remote', `origin/${branch}`])
  await gitOk(copy, ['-C', other, 'push', '-q', 'origin', 'main'])
  await gitOk(copy, ['fetch', '-q', 'origin'])
}

const VARIANTS: readonly Variant[] = [
  { name: 'squash', key: 'PROJ-2', merge: squashMerge },
  { name: 'rebase', key: 'PROJ-3', merge: rebaseMerge },
  { name: 'remote', key: 'PROJ-4', merge: remoteMerge },
]

// The ignored names go into the repo's own exclude file, so each is ignored as it is in a real clone.
async function seedMain(copy: LiveRepo): Promise<void> {
  await mkdir(join(copy.repo, '.git', 'info'), { recursive: true })
  await appendFile(join(copy.repo, '.git', 'info', 'exclude'), IGNORED)
  for (const path of [NODE_FILE, THOUGHTS_FILE]) {
    await mkdir(dirname(join(copy.repo, path)), { recursive: true })
    await writeFile(join(copy.repo, path), `${path}\n`)
  }
}

async function mergedHalf(ctx: RowContext): Promise<void> {
  const copy = await liveRepo(ctx, 'gsd', { path: 'definitions/repo' })
  await seedMain(copy)
  const nodeFile = join(copy.repo, NODE_FILE)
  const thoughtsFile = join(copy.repo, THOUGHTS_FILE)
  const hashes = [await hashFile(nodeFile), await hashFile(thoughtsFile)]

  const epic = await printEpic(copy, KEY)
  noteReply(ctx, 'merged: epic', epic.result)
  await commitInWorktree(copy, epic.worktree, 'feature.txt', 'work of the epic\n')
  await gitOk(copy, ['merge', '--no-ff', '-m', 'merge the epic', epicBranchOf(KEY)])
  const done = await epicDone(copy, KEY, true)
  noteReply(ctx, 'merged: epic done', done)

  await ctx.check('merged: epic done removes the worktree', async () => {
    assert.ok(!existsSync(epic.worktree), 'the worktree folder is still there')
    assert.equal((await worktreesOf(copy)).length, MAIN_ONLY_WORKTREE, 'git still lists the worktree')
  })
  await ctx.check('merged: node_modules and thoughts of main are intact', async () => {
    const now = await Promise.all([nodeFile, thoughtsFile].map(path => hashFile(path).catch(() => null)))
    assert.equal(now[0], hashes[0], `${NODE_FILE} of main changed or is gone`)
    assert.equal(now[1], hashes[1], `${THOUGHTS_FILE} of main changed or is gone`)
  })
  await ctx.check('merged: the epic branch still exists', async () => {
    assert.ok((await epicBranchesOf(copy)).includes(epicBranchOf(KEY)), 'the epic branch is gone')
  })
}

// The worktree's real folder of launcher links becomes one link to main's folder, as a person could make it.
async function linkBinToMain(worktree: string, main: string): Promise<void> {
  const bin = join(worktree, '.cadre', 'bin')
  if (await kindOf(bin) !== 'dir') throw new HarnessError('03.1#16: .cadre/bin in the worktree is not a real folder')
  await rm(bin, { recursive: true })
  await symlink(join(main, '.cadre', 'bin'), bin)
}

async function ignoreAllHalf(ctx: RowContext): Promise<void> {
  const copy = await liveRepo(ctx, 'gsd-ignoreall', { path: 'ignore-all/repo' })
  const launchers = await Promise.all((await roleIdsOf(copy)).map(async id => {
    const path = join(copy.repo, '.cadre', 'bin', id)

    return { id, path, hash: await hashFile(path) }
  }))

  const epic = await printEpic(copy, KEY)
  noteReply(ctx, 'ignore-all: epic', epic.result)
  await commitInWorktree(copy, epic.worktree, 'feature.txt', 'work of the epic\n')
  await gitOk(copy, ['merge', '--no-ff', '-m', 'merge the epic', epicBranchOf(KEY)])
  await linkBinToMain(epic.worktree, copy.repo)
  const done = await epicDone(copy, KEY, true)
  noteReply(ctx, 'ignore-all: epic done', done)

  await ctx.check('ignore-all: epic done removes the worktree', () => {
    assert.ok(!existsSync(epic.worktree), 'the worktree folder is still there')
  })
  for (const launcher of launchers) {
    await ctx.check(`ignore-all: .cadre/bin/${launcher.id} of main is still there`, async () => {
      const now = await hashFile(launcher.path).catch(() => null)
      assert.equal(now, launcher.hash, `.cadre/bin/${launcher.id} of main changed or is gone`)
    })
  }
}

async function observeMerge(ctx: RowContext, copy: LiveRepo, variant: Variant): Promise<void> {
  const epic = await printEpic(copy, variant.key)
  noteReply(ctx, `${variant.name}: epic`, epic.result)
  await commitInWorktree(copy, epic.worktree, `${variant.name}.txt`, `work of the ${variant.name} epic\n`)
  await variant.merge(copy, epicBranchOf(variant.key), ctx.scratch)
  const done = await epicDone(copy, variant.key, true)
  noteReply(ctx, `${variant.name}: epic done`, done)
  const isMerged = !existsSync(epic.worktree)
  ctx.observe(`${variant.name}MergeReadsMerged`, isMerged, replyOf(done))
}

async function observedHalf(ctx: RowContext): Promise<void> {
  const copy = await liveRepo(ctx, 'gsd', { path: 'observed/repo' })
  for (const variant of VARIANTS) await observeMerge(ctx, copy, variant)
}

rowTest(rowEntry('03.1#16'), async ctx => {
  await mergedHalf(ctx)
  await ignoreAllHalf(ctx)
  await observedHalf(ctx)
})
