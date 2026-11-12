import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { configDir } from '../../lib/claude.ts'
import { fenceBin } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { rowTest } from '../../lib/row.ts'
import { logShim, parseShimLog } from '../../lib/shims.ts'
import type { ShimCall } from '../../lib/shims.ts'
import { cadrePrint, liveRepo, noteReply, printedCommand, replyOf, systemTool } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const SHOWN_CALLS = 40
const NO_CLAUDE_CALL = 'no cadre-spawned claude call logged'
const WRONG_CONFIG_DIR = 'cadre-spawned claude without the e2e config dir'

function callsText(calls: readonly ShimCall[]): string {
  const lines = calls.slice(0, SHOWN_CALLS).map(call => `${call.name} ${call.argv.join(' ')} (cwd ${call.cwd})`)
  const more = calls.length - SHOWN_CALLS

  return [...lines, ...(more > 0 ? [`... and ${more} more calls`] : [])].join('\n')
}

rowTest(rowEntry('03#67'), async ctx => {
  const shimDir = join(ctx.scratch, 'shims')
  const log = join(ctx.scratch, 'calls.log')
  const copy = await liveRepo(ctx, 'gsd', { shimDir })
  await logShim(shimDir, 'claude', fenceBin(), log, ['CLAUDECODE', 'CLAUDE_CONFIG_DIR'])
  await logShim(shimDir, 'git', await systemTool('git'), log)

  const reply = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be with logging shims for claude and git', reply)
  const calls = parseShimLog(await readFile(log, 'utf8').catch(() => ''))
  ctx.evidence('the calls the shims logged', callsText(calls))

  await ctx.check('start passes', () => {
    assert.ok(printedCommand(replyOf(reply), ROLE) !== null, 'the reply prints no launcher command')
  })
  const liveHome = copy.env.HOME
  if (!liveHome) throw new HarnessError('the live env has no HOME')
  const home = await realpath(liveHome)
  await ctx.check('claude --version is run by its bare name from the home folder', () => {
    const found = calls.some(call => call.name === 'claude' && call.argv[0] === '--version' && call.cwd === home)
    assert.ok(found, 'no logged claude --version call has the home folder as its cwd')
  })
  await ctx.check('git is run by its bare name', () => {
    assert.ok(calls.some(call => call.name === 'git'), 'no git call was logged')
  })

  const claudeCalls = calls.filter(call => call.name === 'claude')
  if (claudeCalls.length === 0) throw new HarnessError(NO_CLAUDE_CALL)
  const e2eDir = configDir()
  if (!claudeCalls.every(call => call.env.CLAUDE_CONFIG_DIR === e2eDir)) throw new HarnessError(WRONG_CONFIG_DIR)
  const evidence = 'every logged claude call carries the e2e config dir'
  ctx.observe('claudeCallsWithTheE2eConfigDir', claudeCalls.length, evidence)
})
