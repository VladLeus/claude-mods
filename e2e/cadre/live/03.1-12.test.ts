import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { rowTest } from '../../lib/row.ts'
import { commonDir, EPIC_KEY, gitRun, printEpic } from '../lib/epic.ts'
import { liveRepo, noteReply } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const EXPECTED_FILES: readonly string[] = ['cadre-links.exclude', 'config.worktree', 'cadre-epic.json']
const EXPECTED_WORKTREE_CONFIG = 'true'

rowTest(rowEntry('03.1#12'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  const epic = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'epic', epic.result)

  const admin = join(await commonDir(copy), 'worktrees')
  const folders = await readdir(admin).catch((): string[] => [])
  ctx.observe('worktreeAdminFolders', folders, 'the folders of <common dir>/worktrees')
  await ctx.check('<common dir>/worktrees holds one folder, the epic worktree', () => {
    assert.equal(folders.length, 1, `it holds ${folders.length} folders: ${folders.join(', ')}`)
  })
  const folder = folders[0] ?? ''
  for (const file of EXPECTED_FILES) {
    await ctx.check(`<common dir>/worktrees/<n>/${file} exists`, () => {
      assert.ok(folder !== '' && existsSync(join(admin, folder, file)), `${file} is not in the folder of the worktree`)
    })
  }

  const config = await gitRun(copy, ['config', 'extensions.worktreeConfig'])
  await ctx.check('git config extensions.worktreeConfig prints true', () => {
    const printed = config.stdout.trim()
    assert.equal(printed, EXPECTED_WORKTREE_CONFIG, `it printed "${printed}" with exit ${config.code}`)
  })
})
