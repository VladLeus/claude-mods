import assert from 'node:assert/strict'
import { join } from 'node:path'
import { scratchEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { run } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import { cadrePrint, liveRepo, noteReply, replyOf, statusLine, writeHandoff } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const LATEST_LABEL = 'latest handoff'
const EXPECTED_HANDOFF_FOLDER = `thoughts/shared/handoffs/${ROLE}`
// The older file sorts first by name, so a status that ignores modification times names it.
const OLDER = 'handoff-a.md'
const NEWER = 'handoff-b.md'
const OLDER_STAMP = '202601011200'
const NEWER_STAMP = '202601011201'
const TOUCH_MS = 10_000

const entry = rowEntry('03#75')

rowTest(entry, async ctx => {
  for (const part of entry.partial ?? []) ctx.skipPart(part.part, part.reason)
  const copy = await liveRepo(ctx, 'gsd')
  const env = await scratchEnv(join(ctx.scratch, 'env'))
  for (const [name, stamp] of [[OLDER, OLDER_STAMP], [NEWER, NEWER_STAMP]] as const) {
    const path = await writeHandoff(copy.repo, ROLE, name)
    const touched = await run(['touch', '-t', stamp, path], { cwd: copy.repo, env, timeoutMs: TOUCH_MS })
    if (touched.code !== 0) throw new HarnessError(`touch -t exited ${touched.code}: ${touched.stderr.trim()}`)
  }
  ctx.evidence('the seeded handoffs', `${OLDER} at ${OLDER_STAMP}, ${NEWER} at ${NEWER_STAMP} (touch -t, local time)`)

  const printed = await cadrePrint(copy, `status ${ROLE}`)
  noteReply(ctx, `status ${ROLE}`, printed)
  const reply = replyOf(printed)
  const latest = statusLine(reply, LATEST_LABEL)

  await ctx.check('the reply names the newer handoff by modification time', () => {
    const shown = latest === null ? `no "${LATEST_LABEL}" line` : `"${LATEST_LABEL}: ${latest}"`
    assert.equal(latest, `${EXPECTED_HANDOFF_FOLDER}/${NEWER}`, `the reply holds ${shown}`)
  })
  await ctx.check('the reply does not name the older handoff', () => {
    assert.ok(!reply.includes(OLDER), `the reply names ${OLDER}`)
  })
})
