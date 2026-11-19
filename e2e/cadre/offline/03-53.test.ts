import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { offlinePath } from '../../lib/env.ts'
import { rowTest } from '../../lib/row.ts'
import { versionShim } from '../../lib/shims.ts'
import { miniWorld, runLauncher } from '../lib/world.ts'
import type { LaunchResult } from '../lib/world.ts'
import { rowEntry } from '../rows.ts'

const EXPECTED_OUTSIDE = 'cadre: run .cadre/bin/be from a folder of its repo'
const CURRENT_CLAUDE = '2.1.322'

function resultText(result: LaunchResult): string {
  const exit = result.code === null ? 'running when claude was reached, stopped by the harness' : `exit ${result.code}`
  const calls = result.calls.map(call => `claude call: ${call.argv.join(' ')}`)

  return [exit, `stderr:\n${result.stderr}`, ...calls].join('\n')
}

rowTest(rowEntry('03#53'), async ctx => {
  const world = await miniWorld(join(ctx.scratch, 'world'), { kind: 'here' })
  const bin = join(ctx.scratch, 'bin')
  const log = join(ctx.scratch, 'claude.log')
  await versionShim(bin, CURRENT_CLAUDE, log)
  const outside = join(ctx.scratch, 'outside')
  await mkdir(outside)
  const env = { ...world.env, PATH: offlinePath(bin) }
  const result = await runLauncher(world.launcher, { cwd: outside, env, log })
  ctx.evidence('launcher run from a folder outside the repo', resultText(result))

  await ctx.check('refuses with the line the UAT quotes', () => {
    const lines = result.stderr.split('\n')
    assert.ok(lines.includes(EXPECTED_OUTSIDE), `stderr does not hold the line: ${EXPECTED_OUTSIDE}`)
  })
  await ctx.check('exits non-zero', () => {
    assert.ok(result.code !== null && result.code !== 0, `the launcher ended with ${result.code}`)
  })
  await ctx.check('starts no session: the claude shim logged no call', () => {
    assert.equal(result.calls.length, 0, 'the launcher reached claude')
  })
})
