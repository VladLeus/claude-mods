import assert from 'node:assert/strict'
import { appendFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { hashFile } from '../../lib/hash.ts'
import { rowTest } from '../../lib/row.ts'
import { EPIC_KEY, kindOf, lsLong, printEpic } from '../lib/epic.ts'
import { liveRepo, noteReply } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ENV_FILES: readonly string[] = ['.env', '.env.local']
const LINKED: readonly string[] = ['node_modules', 'thoughts', '.claude/notes.md']
const IGNORED = '.env*\nnode_modules/\nthoughts/\n'
const ENV_TEXT = 'E2E_FLAG=1\n'
const EDITED_TEXT = 'E2E_EDITED=1\n'
const SEEDED: Readonly<Record<string, string>> = {
  '.env': ENV_TEXT,
  '.env.local': ENV_TEXT,
  'node_modules/x/index.js': 'module.exports = 1\n',
  'thoughts/shared/note.md': '# note\n',
  '.claude/notes.md': '# notes\n',
}

// The ignored names go into the repo's own exclude file, so each is ignored as it is in a real clone.
async function seedMain(copy: LiveRepo): Promise<void> {
  await mkdir(join(copy.repo, '.git', 'info'), { recursive: true })
  await appendFile(join(copy.repo, '.git', 'info', 'exclude'), IGNORED)
  for (const [path, text] of Object.entries(SEEDED)) {
    await mkdir(dirname(join(copy.repo, path)), { recursive: true })
    await writeFile(join(copy.repo, path), text)
  }
}

async function kindsIn(folder: string): Promise<readonly string[]> {
  const names = (await readdir(folder).catch((): string[] => [])).sort()

  return Promise.all(names.map(async name => `${name}: ${await kindOf(join(folder, name))}`))
}

rowTest(rowEntry('03.1#3'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  await seedMain(copy)
  const mainEnv = join(copy.repo, '.env')
  const before = await hashFile(mainEnv)

  const epic = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'epic', epic.result)
  const claude = join(epic.worktree, '.claude')
  ctx.evidence('ls -la of the worktree', await lsLong(copy, epic.worktree))
  ctx.evidence('ls -la of the worktree .claude', await lsLong(copy, claude))
  ctx.observe('worktreeEntryKinds', [...await kindsIn(epic.worktree)], 'the kind of each entry of the worktree')
  ctx.observe('worktreeClaudeEntryKinds', [...await kindsIn(claude)], 'the kind of each entry of .claude in it')

  for (const name of ENV_FILES) {
    await ctx.check(`${name} is a regular file in the worktree`, async () => {
      const kind = await kindOf(join(epic.worktree, name))
      assert.equal(kind, 'file', `${name} is ${kind} in the worktree`)
    })
  }
  for (const path of LINKED) {
    await ctx.check(`${path} is a link in the worktree`, async () => {
      const kind = await kindOf(join(epic.worktree, path))
      assert.equal(kind, 'link', `${path} is ${kind} in the worktree`)
    })
  }
  await ctx.check('.claude/worktrees is not linked into the worktree', async () => {
    const kind = await kindOf(join(claude, 'worktrees'))
    assert.equal(kind, 'absent', `.claude/worktrees is ${kind} in the worktree`)
  })
  await ctx.check('an edit of the worktree .env leaves main .env unchanged', async () => {
    const worktreeEnv = join(epic.worktree, '.env')
    assert.equal(await hashFile(worktreeEnv), before, 'the worktree .env is not a copy of the .env of main')
    await appendFile(worktreeEnv, EDITED_TEXT)
    assert.notEqual(await hashFile(worktreeEnv), before, 'the edit did not change the worktree .env')
    assert.equal(await hashFile(mainEnv), before, 'the .env of main changed with the edit')
  })
})
