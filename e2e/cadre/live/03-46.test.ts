import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { appendFile, chmod, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { rowTest } from '../../lib/row.ts'
import { cadrePrint, firstLineOf, liveRepo, noteReply, pastedText, printedCommand, replyOf } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'tl'
const LAUNCHER = '.cadre/bin/tl'
const REGEN_COMMAND = '/cadre regen tl'
const EXPECTED_CHANGED = 'changed outside cadre'
const EXPECTED_WAYS: Readonly<Record<string, readonly string[]>> = {
  'restore the launcher': ['restore it'],
  '/cadre init with Take new': ['/cadre init', 'Take new'],
  '/cadre regen, the .cadre-new move and chmod 755': [REGEN_COMMAND, '.cadre-new', 'chmod 755'],
}
const HAND_EDIT = '# edited by hand\n'
const LAUNCHER_MODE = 0o755

rowTest(rowEntry('03#46'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  const launcher = join(copy.repo, LAUNCHER)

  const first = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start tl', first)
  const printed = printedCommand(replyOf(first), ROLE)
  await ctx.check('the reply prints the launcher command', () => {
    assert.ok(printed !== null, `the reply prints no ${LAUNCHER} command`)
  })
  await ctx.check('pbpaste equals the printed command', async () => {
    assert.ok(printed !== null, 'there is no printed command to compare')
    const pasted = await pastedText()
    assert.ok(pasted === printed, `pbpaste gave ${pasted.length} characters, not the ${printed.length} printed`)
  })

  await appendFile(launcher, HAND_EDIT)
  const refused = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start tl after a hand edit of the launcher', refused)
  const refusal = replyOf(refused)
  await ctx.check('start refuses with the changed-outside-cadre text', () => {
    assert.ok(refusal.includes(EXPECTED_CHANGED), `the reply does not hold: ${EXPECTED_CHANGED}`)
  })
  for (const [way, phrases] of Object.entries(EXPECTED_WAYS)) {
    await ctx.check(`the refusal names the way: ${way}`, () => {
      for (const phrase of phrases) assert.ok(refusal.includes(phrase), `the reply does not hold: ${phrase}`)
    })
  }
  await ctx.check('the refusal names the second regen', () => {
    const times = refusal.split(REGEN_COMMAND).length - 1
    assert.ok(times >= 2, `the reply holds ${REGEN_COMMAND} ${times} times, not twice`)
  })

  const regen = await cadrePrint(copy, `regen ${ROLE}`)
  noteReply(ctx, 'regen tl', regen)
  const fresh = `${launcher}.cadre-new`
  await ctx.check('regen writes the new launcher beside the changed one as .cadre-new', () => {
    assert.ok(existsSync(fresh), `${LAUNCHER}.cadre-new is not there`)
  })
  if (!existsSync(fresh)) return

  await rename(fresh, launcher)
  await chmod(launcher, LAUNCHER_MODE)
  const again = await cadrePrint(copy, `regen ${ROLE}`)
  noteReply(ctx, 'regen tl a second time', again)
  const after = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start tl after the regen way', after)
  const reply = replyOf(after)
  const passes = printedCommand(reply, ROLE) !== null && !reply.includes(EXPECTED_CHANGED)
  ctx.observe('startPassesAfterRegenWay', passes, passes ? 'start printed the launcher command' : firstLineOf(reply))
})
