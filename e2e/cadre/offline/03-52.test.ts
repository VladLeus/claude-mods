import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { scratchEnv } from '../../lib/env.ts'
import { run } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import { rowEntry } from '../rows.ts'

const VERSION_LINE_RE = /^[0-9]+[.][0-9]+[.][0-9]+/
const VERSION_MS = 30_000

const entry = rowEntry('03#52')

rowTest(entry, async ctx => {
  for (const part of entry.partial ?? []) ctx.skipPart(part.part, part.reason)
  const bin = process.env.E2E_CLAUDE_BIN
  if (!bin) {
    ctx.skip('no claude on PATH')
    return
  }

  const env = await scratchEnv(ctx.scratch, dirname(bin))
  const result = await run([bin, '--version'], { cwd: ctx.scratch, env, timeoutMs: VERSION_MS })
  ctx.evidence('claude --version', `exit ${result.code}\nstdout:\n${result.stdout}stderr:\n${result.stderr}`)

  await ctx.check('exactly one stdout line starts with N.N.N', () => {
    const lines = result.stdout.split('\n').filter(line => VERSION_LINE_RE.test(line))
    assert.equal(lines.length, 1, `${lines.length} stdout lines start with N.N.N`)
  })
})
