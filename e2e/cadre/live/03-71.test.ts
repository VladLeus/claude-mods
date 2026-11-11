import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HarnessError } from '../../lib/errors.ts'
import { rowTest } from '../../lib/row.ts'
import { cadrePrint, liveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const EXPECTED_ABSENT_WARNING = 'could not read local settings (treated as unknown)'
const LAUNCHER_COMMAND = '.cadre/bin/be'
const LOCAL_SETTINGS = join('.claude', 'settings.local.json')

rowTest(rowEntry('03#71'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  if (existsSync(join(copy.repo, LOCAL_SETTINGS))) {
    throw new HarnessError('the gsd copy holds .claude/settings.local.json: the row needs a repo without it')
  }
  const reply = await cadrePrint(copy, 'start be')
  ctx.evidence('cadre start be, stdout', reply.stdout)
  ctx.evidence('cadre start be, stderr and exit code', `exit ${reply.code}\n${reply.stderr}`)

  await ctx.check('the reply holds no local settings warning', () => {
    assert.ok(!reply.stdout.includes(EXPECTED_ABSENT_WARNING), `the reply holds: ${EXPECTED_ABSENT_WARNING}`)
  })
  await ctx.check('the reply shows the launcher command', () => {
    assert.ok(reply.stdout.includes(LAUNCHER_COMMAND), `the reply does not show ${LAUNCHER_COMMAND}`)
  })
})
