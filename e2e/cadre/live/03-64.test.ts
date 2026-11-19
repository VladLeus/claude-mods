import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { passTrust } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { pollUntil } from '../../lib/poll.ts'
import { rowTest } from '../../lib/row.ts'
import { capture, IDLE_MS, killServer, newWindow, POLL_MS, socketName, startServer, WAIT_MS } from '../../lib/tmux.ts'
import {
  cadrePrint,
  firstLineOf,
  liveRepo,
  noteReply,
  printedCommand,
  replyOf,
  sessionStartRuns,
  writeSessionStartHook,
} from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const LAUNCHER = '.cadre/bin/be'
const WINDOW = 'cadre-be'

// The first SessionStart line of the role session; the count as it stands when none came in time.
async function firstSessionStart(log: string): Promise<number> {
  const label = 'the SessionStart hook line'
  const opts = { timeoutMs: WAIT_MS, intervalMs: POLL_MS, now: Date.now, sleep: delay, label }
  try {
    return await pollUntil(() => sessionStartRuns(log), runs => runs > 0, opts)
  } catch (error) {
    if (error instanceof HarnessError) return sessionStartRuns(log)
    throw error
  }
}

rowTest(rowEntry('03#64'), async ctx => {
  const log = join(ctx.scratch, 'hook.log')
  const copy = await liveRepo(ctx, 'gsd')
  await writeSessionStartHook(copy.repo, log)
  const started = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be', started)
  if (printedCommand(replyOf(started), ROLE) === null) {
    throw new HarnessError(`03#64: the start did not render: ${firstLineOf(replyOf(started))}`)
  }
  // The start's own session loads the project settings too, so its line is cleared before the role session starts.
  await rm(log, { force: true })

  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  const pane = await newWindow(server, WINDOW, copy.repo, [join(copy.repo, LAUNCHER)])
  await passTrust(server, WINDOW)
  const first = await firstSessionStart(log)
  ctx.screen('the role window once the hook line came in', await capture(pane))
  await killServer(server)
  await delay(IDLE_MS)

  const runs = await sessionStartRuns(log)
  ctx.evidence('the SessionStart lines', `${first} when the first came in, ${runs} after ${IDLE_MS} ms`)
  await ctx.check('the project hook ran exactly once at the git-root start', () => {
    assert.equal(runs, 1, `the SessionStart hook ran ${runs} times`)
  })
})
