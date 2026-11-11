import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { configDir, idleTui, startTui } from '../../lib/claude.ts'
import { liveEnv } from '../../lib/env.ts'
import { copyTree, fixtureDir } from '../../lib/fixture.ts'
import { rowTest } from '../../lib/row.ts'
import { killServer, sendKeys, sendText, socketName, startServer, waitDead } from '../../lib/tmux.ts'
import { rowEntry } from '../rows.ts'

const PROMPT = 'Reply with OK'
const EXIT_COMMAND = '/exit'

function encodedPath(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

rowTest(rowEntry('03#33'), async ctx => {
  const repo = join(ctx.scratch, 'repo')
  await copyTree(fixtureDir('bare'), repo)
  const server = await startServer(socketName(), liveEnv())
  ctx.after(() => killServer(server))
  const id = randomUUID()
  const pane = await startTui(server, repo, ['--session-id', id])
  await sendText(pane, PROMPT)
  await sendKeys(pane, 'Enter')
  ctx.screen('after the prompt', await idleTui(pane))

  await ctx.check('the transcript of the given session id exists', () => {
    const transcript = join(configDir(), 'projects', encodedPath(realpathSync(repo)), `${id}.jsonl`)
    assert.ok(existsSync(transcript), 'no <e2e dir>/projects/<encoded cwd>/<session id>.jsonl')
  })

  await sendText(pane, EXIT_COMMAND)
  await sendKeys(pane, 'Enter')
  await waitDead(pane)
})
