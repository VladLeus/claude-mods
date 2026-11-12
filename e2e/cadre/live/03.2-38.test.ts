import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { scratchEnv } from '../../lib/env.ts'
import type { ChildEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { hashTree, sha256 } from '../../lib/hash.ts'
import { run } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import { parseShimLog } from '../../lib/shims.ts'
import { capture, killServer, socketName, startServer } from '../../lib/tmux.ts'
import {
  FRAMEWORK_SET_QUESTION,
  FRAMEWORKS_KEEP_GSD_DRY_SCRIPT,
  REFRAME_REVIEW_QUESTION,
} from '../fixtures/answers.ts'
import { assertHaikuRoles, cadreTui, driveDialogs, liveRepo } from '../lib/session.ts'
import { npxShim } from '../lib/shims.ts'
import { rowEntry } from '../rows.ts'

const DRY_RUN_COMMAND = '/cadre frameworks --dry-run'
const DRY_RUN_NOTE_RE = /Dry run: nothing was written\./
const GIT_DIR = '.git'
const GIT_MS = 30_000

async function gitStatus(repo: string, env: ChildEnv): Promise<string> {
  const result = await run(['git', 'status', '--porcelain'], { cwd: repo, env, timeoutMs: GIT_MS })
  if (result.code !== 0) throw new HarnessError(`git status exited ${result.code}: ${result.stderr.trim()}`)

  return result.stdout
}

// Every path outside .git/ with its kind, mode, size, mtime and content: git and claude refresh the index on their own.
async function worktreeHash(repo: string): Promise<string> {
  const names = (await readdir(repo)).filter(name => name !== GIT_DIR).sort()
  const lines: string[] = []
  for (const name of names) lines.push(`${name}\t${await hashTree(join(repo, name))}`)

  return sha256(lines.join('\n'))
}

rowTest(rowEntry('03.2#38'), async ctx => {
  const shims = join(ctx.scratch, 'shims')
  const log = join(ctx.scratch, 'npx.log')
  await npxShim(shims, 'noop', log)
  const copy = await liveRepo(ctx, 'gsd', { shimDir: shims })
  const gitEnv = await scratchEnv(join(ctx.scratch, 'git-env'))
  const statusBefore = await gitStatus(copy.repo, gitEnv)
  const treeBefore = await worktreeHash(copy.repo)

  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  const pane = await cadreTui(server, copy, DRY_RUN_COMMAND)
  const dialogs = await driveDialogs(pane, FRAMEWORKS_KEEP_GSD_DRY_SCRIPT, DRY_RUN_NOTE_RE)
  const history = await capture(pane, { history: true })
  const reply = history.slice(Math.max(0, history.lastIndexOf(`❯ ${DRY_RUN_COMMAND}`)))
  ctx.evidence('the reply of /cadre frameworks --dry-run', reply)
  ctx.evidence('the questions asked', dialogs.asked.join('\n'))
  await assertHaikuRoles(copy)

  await ctx.check('it asks the framework questions and shows the review', () => {
    assert.ok(dialogs.asked.includes(FRAMEWORK_SET_QUESTION), 'the set question was not asked')
    assert.ok(dialogs.asked.includes(REFRAME_REVIEW_QUESTION), 'the review was not shown')
  })
  await ctx.check('after Confirm nothing is written: git status --porcelain is unchanged', async () => {
    assert.equal(await gitStatus(copy.repo, gitEnv), statusBefore)
  })
  await ctx.check('after Confirm nothing is written: the tree hash with mtimes is unchanged', async () => {
    assert.equal(await worktreeHash(copy.repo), treeBefore, 'a file outside .git/ changed')
  })
  await ctx.check('after Confirm nothing is run: the npx shim log is empty', async () => {
    const calls = parseShimLog(await readFile(log, 'utf8').catch(() => '')).filter(call => call.name === 'npx')
    assert.equal(calls.length, 0, `the npx shim was called ${calls.length} times`)
  })
})
