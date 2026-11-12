import assert from 'node:assert/strict'
import { join } from 'node:path'
import { rowTest } from '../../lib/row.ts'
import { cadrePrint, liveRepo, noteReply, pastedText, printedCommand, replyOf } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
// Written with escapes so the folder stays in the composed form whatever an editor does to the file.
const NFC_FOLDER = 'r\u00e9po-\u00e9'

const entry = rowEntry('03#72')

rowTest(entry, async ctx => {
  for (const part of entry.partial ?? []) ctx.skipPart(part.part, part.reason)
  const copy = await liveRepo(ctx, 'gsd', { path: join(NFC_FOLDER, 'repo') })
  const reply = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be in a repo whose path holds é', reply)
  const printed = printedCommand(replyOf(reply), ROLE)

  await ctx.check('the reply prints the launcher command with the é path', () => {
    assert.ok(printed !== null, 'the reply prints no launcher command')
    assert.ok(printed.includes(NFC_FOLDER), 'the printed command does not hold the é folder')
  })
  await ctx.check('pbpaste prints the command unchanged', async () => {
    assert.ok(printed !== null, 'there is no printed command to compare')
    const pasted = await pastedText()
    const isSame = Buffer.from(pasted, 'utf8').equals(Buffer.from(printed, 'utf8'))
    assert.ok(isSame, `pbpaste gave ${pasted.length} characters, not the ${printed.length} printed`)
  })
})
