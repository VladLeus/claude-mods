import assert from 'node:assert/strict'
import { appendFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { HarnessError } from '../../lib/errors.ts'
import { hashFile } from '../../lib/hash.ts'
import { rowTest } from '../../lib/row.ts'
import { capture, killServer, socketName, startServer } from '../../lib/tmux.ts'
import { CONFLICT_QUESTION, GSD_REINIT_KEEP_MINE_SCRIPT } from '../fixtures/answers.ts'
import { APPLIED_REPLY, assertHaikuRoles, cadreTui, driveDialogs, liveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const INIT_COMMAND = '/cadre init'
const SIZING_FILE = join('.cadre', 'sizing.md')
const EDIT_LINE = '\nEdited by hand for the e2e re-init check.\n'
const CONFLICT_WORDS: readonly string[] = ['Keep mine', 'Take new']
const BESIDE_SUFFIX = '.cadre-new'
const GIT_DIR = '.git'

async function besideCopies(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { recursive: true }).catch((): string[] => [])

  return entries.filter(path => path.endsWith(BESIDE_SUFFIX) && path.split('/')[0] !== GIT_DIR)
}

rowTest(rowEntry('03.2#15c'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  const sizing = join(copy.repo, SIZING_FILE)
  const before = await hashFile(sizing).catch(() => null)
  if (before === null) throw new HarnessError('03.2#15c: the gsd fixture has no .cadre/sizing.md')
  await appendFile(sizing, EDIT_LINE)
  const edited = await hashFile(sizing)

  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  const pane = await cadreTui(server, copy, INIT_COMMAND)
  const log = await driveDialogs(pane, GSD_REINIT_KEEP_MINE_SCRIPT, APPLIED_REPLY)
  const history = await capture(pane, { history: true })
  const reply = history.slice(Math.max(0, history.lastIndexOf(`❯ ${INIT_COMMAND}`)))
  ctx.evidence('the reply of the second /cadre init', reply)
  await assertHaikuRoles(copy)

  await ctx.check('the edited .cadre/sizing.md is byte-identical after the re-init and Confirm', async () => {
    assert.equal(await hashFile(sizing), edited, 'the sha256 of .cadre/sizing.md changed')
  })
  await ctx.check('the re-init asks no Keep mine / Take new question', () => {
    assert.ok(!log.asked.includes(CONFLICT_QUESTION), 'a conflict question was asked')
    const found = CONFLICT_WORDS.filter(word => history.includes(word))
    assert.deepEqual(found, [], `the session shows: ${found.join(', ')}`)
  })
  await ctx.check(`the re-init writes no ${BESIDE_SUFFIX} copy`, async () => {
    const copies = await besideCopies(copy.repo)
    assert.deepEqual(copies, [], `found: ${copies.join(', ')}`)
  })
})
