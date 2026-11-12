import assert from 'node:assert/strict'
import { chmod, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { scratchEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { rowTest } from '../../lib/row.ts'
import { versionShim } from '../../lib/shims.ts'
import { cadrePrint, firstLineOf, liveRepo, noteReply, printedCommand, replyOf } from '../lib/session.ts'
import { runLauncher } from '../lib/world.ts'
import type { LaunchResult } from '../lib/world.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const LAUNCHER = '.cadre/bin/be'
const STALE_FOLDER = '.cadre/be/.runtime/instructions/global'
const STALE_LINK = '00-stale'
const STALE_TARGET = 'README.md'
const CURRENT_CLAUDE = '2.1.322'
const EXPECTED_RENDER_STOP = 'cadre start could not render .cadre/be/.runtime/ ('
const EXPECTED_NOT_RENDERED =
  'cadre: .cadre/be/.runtime/ is not rendered: run /cadre start be in the root session of the repo'
const READ_ONLY_MODE = 0o555
const RESTORED_MODE = 0o755

function resultText(result: LaunchResult): string {
  const exit = result.code === null ? 'running when claude was reached, stopped by the harness' : `exit ${result.code}`
  const calls = result.calls.map(call => `claude call: ${call.argv.join(' ')}`)

  return [exit, `stderr:\n${result.stderr}`, ...calls].join('\n')
}

rowTest(rowEntry('03#66'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  const first = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be, the first render', first)
  if (printedCommand(replyOf(first), ROLE) === null) {
    throw new HarnessError(`03#66: the first start did not render: ${firstLineOf(replyOf(first))}`)
  }

  // The render removes a link an earlier render left in this folder, so a read-only folder stops it after the stamp.
  const folder = join(copy.repo, STALE_FOLDER)
  await mkdir(folder, { recursive: true })
  await symlink(join(copy.repo, STALE_TARGET), join(folder, STALE_LINK))
  ctx.after(() => chmod(folder, RESTORED_MODE))
  await chmod(folder, READ_ONLY_MODE)
  const stopped = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be after the stop was made', stopped)
  const reply = replyOf(stopped)
  ctx.observe(
    'howTheStopWasMade',
    `a stale link in ${STALE_FOLDER} that the render must remove, the folder at mode 555`,
    firstLineOf(reply),
  )
  await ctx.check('the reply starts with the render stop text', () => {
    assert.ok(reply.startsWith(EXPECTED_RENDER_STOP), `the reply does not start with: ${EXPECTED_RENDER_STOP}`)
  })

  const bin = join(ctx.scratch, 'bin')
  const log = join(ctx.scratch, 'claude.log')
  await versionShim(bin, CURRENT_CLAUDE, log)
  const env = await scratchEnv(join(ctx.scratch, 'launch'), bin)
  const launched = await runLauncher(join(copy.repo, LAUNCHER), { cwd: copy.repo, env, log })
  ctx.evidence('the launcher after the stopped render', resultText(launched))
  await ctx.check('the launcher refuses with the not-rendered line', () => {
    const lines = launched.stderr.split('\n')
    assert.ok(lines.includes(EXPECTED_NOT_RENDERED), `stderr does not hold: ${EXPECTED_NOT_RENDERED}`)
  })
  await ctx.check('the launcher exits non-zero and starts no session', () => {
    assert.ok(launched.code !== null && launched.code !== 0, `the launcher ended with ${launched.code}`)
    assert.equal(launched.calls.length, 0, 'the launcher reached claude')
  })
})
