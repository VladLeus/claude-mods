import assert from 'node:assert/strict'
import { scratchEnv } from '../../lib/env.ts'
import { run } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import { rowEntry } from '../rows.ts'

const GIT_VERSION_RE = /^git version ([0-9]+)[.]([0-9]+)/
const GIT_MS = 30_000
const MIN_MAJOR = 2
const MIN_MINOR = 31

rowTest(rowEntry('03#68', 'a'), async ctx => {
  const env = await scratchEnv(ctx.scratch)
  const result = await run(['git', '--version'], { cwd: ctx.scratch, env, timeoutMs: GIT_MS })
  ctx.evidence('git --version', `exit ${result.code}\n${result.stdout}${result.stderr}`)

  await ctx.check('git is 2.31 or newer', () => {
    const match = GIT_VERSION_RE.exec(result.stdout)
    assert.ok(match, `no git version in: ${result.stdout.trim()}`)
    const major = Number(match[1])
    const minor = Number(match[2])
    const isNewEnough = major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR)
    assert.ok(isNewEnough, `git ${major}.${minor} is older than ${MIN_MAJOR}.${MIN_MINOR}`)
  })
})
