import assert from 'node:assert/strict'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { answer, idleTui, isDialogScreen, waitTui } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { rowTest } from '../../lib/row.ts'
import { capture, killServer, socketName, startServer, WAIT_MS } from '../../lib/tmux.ts'
import { CONFLICT_QUESTION, GSD_SCRIPT } from '../fixtures/answers.ts'
import { APPLIED_REPLY, assertHaikuRoles, cadreTui, driveDialogs, liveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const INIT_COMMAND = '/cadre init'
const ROLE_FILE = join('.cadre', 'be', 'ROLE.md')
const ADDED_LINES = 200
const ADDED_PREFIX = 'e2e hand-added line'
const KEEP_MINE = 'Keep mine'
const TAKE_NEW = 'Take new'
const NEXT_PAGE = 'Next page'
const PAGE_RE = /page ([0-9]+) of ([0-9]+)/g
const DIFF_ROW_RE = new RegExp(`[+-] ${ADDED_PREFIX} [0-9]{3}`)
const MAX_PAGES = 60
const WHITESPACE_RE = /\s+/g

type Page = {
  readonly page: number
  readonly count: number
}

function squashed(text: string): string {
  return text.replace(WHITESPACE_RE, ' ')
}

function addedLines(): string {
  return Array.from({ length: ADDED_LINES }, (_, at) => `${ADDED_PREFIX} ${String(at + 1).padStart(3, '0')}\n`)
    .join('')
}

function isConflictScreen(screen: string): boolean {
  return isDialogScreen(screen) && squashed(screen).includes(CONFLICT_QUESTION)
}

// The last page marker on screen is the open question's; a question that is not paged reads as page 1 of 1.
function pageOf(screen: string): Page {
  const found = [...screen.matchAll(PAGE_RE)].at(-1)
  if (found === undefined) return { page: 1, count: 1 }

  return { page: Number(found[1]), count: Number(found[2]) }
}

rowTest(rowEntry('03.2#31'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  const role = join(copy.repo, ROLE_FILE)
  const original = await readFile(role, 'utf8').catch(() => null)
  if (original === null) throw new HarnessError('03.2#31: the gsd fixture has no .cadre/be/ROLE.md')
  await appendFile(role, addedLines())

  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  const pane = await cadreTui(server, copy, INIT_COMMAND)
  let screen = (await driveDialogs(pane, GSD_SCRIPT, APPLIED_REPLY, { stopAt: CONFLICT_QUESTION })).final
  let at = pageOf(screen)
  ctx.observe('conflictPages', at.count, 'the page count of the Keep mine / Take new question')
  await ctx.check('the Keep mine / Take new question is asked a page at a time', () => {
    assert.ok(at.count > 1, 'the question over the long hand-edited ROLE.md is not paged')
  })

  for (let seen = 1; ; seen += 1) {
    if (seen > MAX_PAGES) throw new HarnessError(`the conflict question has more than ${MAX_PAGES} pages`)
    const page = at
    const shown = screen
    ctx.screen(`the conflict question, page ${page.page} of ${page.count}`, shown)
    await ctx.check(`page ${page.page} of ${page.count} names ${KEEP_MINE} and ${TAKE_NEW}`, () => {
      assert.ok(shown.includes(KEEP_MINE) && shown.includes(TAKE_NEW), `the page lacks ${KEEP_MINE} or ${TAKE_NEW}`)
    })
    await ctx.check(`page ${page.page} of ${page.count} shows diff lines`, () => {
      assert.match(shown, DIFF_ROW_RE, 'no diff line of the hand-added lines is on the page')
    })
    if (page.page >= page.count) break
    const next = page.page + 1
    await answer(pane, NEXT_PAGE)
    const isNext = (current: string): boolean => isConflictScreen(current) && pageOf(current).page === next
    await waitTui(pane, isNext, WAIT_MS, `page ${next} of the conflict question`)
    screen = await idleTui(pane)
    at = pageOf(screen)
  }

  await answer(pane, TAKE_NEW)
  await driveDialogs(pane, [], APPLIED_REPLY)
  const history = await capture(pane, { history: true })
  const reply = history.slice(Math.max(0, history.lastIndexOf(`❯ ${INIT_COMMAND}`)))
  ctx.evidence('the reply of the second /cadre init', reply)
  await assertHaikuRoles(copy)

  await ctx.check('Take new is applied: ROLE.md no longer holds the hand-added lines', async () => {
    const text = await readFile(role, 'utf8')
    assert.ok(!text.includes(ADDED_PREFIX), 'ROLE.md still holds the hand-added lines')
  })
})
