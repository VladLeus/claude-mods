import assert from 'node:assert/strict'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { answer, dialogOptions, dialogText, idleTui, isDialogScreen, squashed, waitTui } from '../../lib/claude.ts'
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
const PREVIOUS_PAGE = 'Previous page'
const LAST_PAGE = 'Last page'
const EXPECTED_COUNTS = `${TAKE_NEW}: 0 lines added, ${ADDED_LINES} removed`
const COUNTS_RE = /Take new: [0-9]+ lines? added, [0-9]+ removed/
const DIFF_NUMBER_RE = new RegExp(`- ${ADDED_PREFIX} ([0-9]{3})`, 'g')
const MORE_ABOVE_RE = /\+[0-9]+ more above/
const MAX_PAGES = 60
const NAMED_LINES = 5

function addedLines(): string {
  return Array.from({ length: ADDED_LINES }, (_, at) => `${ADDED_PREFIX} ${String(at + 1).padStart(3, '0')}\n`)
    .join('')
}

function diffNumbers(dialog: string): readonly string[] {
  return [...new Set([...dialog.matchAll(DIFF_NUMBER_RE)].flatMap(found => found[1] ?? []))].sort()
}

function isConflictScreen(screen: string): boolean {
  return isDialogScreen(screen) && squashed(dialogText(screen)).includes(CONFLICT_QUESTION)
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
  const isPaged = dialogOptions(screen).includes(NEXT_PAGE)
  await ctx.check('the Keep mine / Take new question is asked a page at a time', () => {
    assert.ok(isPaged, 'the question over the long hand-edited ROLE.md shows no Next page option')
  })
  const question = squashed(dialogText(screen))
  await ctx.check(`the question names ${KEEP_MINE} and ${TAKE_NEW}`, () => {
    const lacks = `the question lacks ${KEEP_MINE} or ${TAKE_NEW}`
    assert.ok(question.includes(KEEP_MINE) && question.includes(TAKE_NEW), lacks)
  })
  await ctx.check(`page 1's counts line reads ${EXPECTED_COUNTS}`, () => {
    const counts = COUNTS_RE.exec(question)?.[0]
    assert.ok(counts !== undefined, 'page 1 shows no counts line')
    const cut = 'the diff holds more than the hand-added lines, so the diff row cap may have cut the last of them'
    assert.equal(counts, EXPECTED_COUNTS, `page 1 shows ${counts}: ${cut}`)
  })

  const firstPageOf = new Map<string, number>()
  const repeated: string[] = []
  let pages = 0
  for (let page = 1; ; page += 1) {
    if (page > MAX_PAGES) throw new HarnessError(`the conflict question has more than ${MAX_PAGES} pages`)
    pages = page
    const dialog = dialogText(screen)
    const options = dialogOptions(screen)
    const numbers = diffNumbers(dialog)
    const isLast = !options.includes(NEXT_PAGE)
    ctx.screen(`the conflict question, page ${page}`, screen)
    for (const line of numbers) {
      const first = firstPageOf.get(line)
      if (first !== undefined) {
        repeated.push(`${line} on page ${first} and again on page ${page}`)
        continue
      }
      firstPageOf.set(line, page)
    }
    const offered = isLast
      ? `${KEEP_MINE} and ${TAKE_NEW} as options`
      : `${NEXT_PAGE} and ${LAST_PAGE} as options, not ${KEEP_MINE} or ${TAKE_NEW}`
    await ctx.check(`page ${page} has ${offered}`, () => {
      const listed = `the options are: ${options.join(', ')}`
      if (isLast) {
        assert.ok(options.includes(KEEP_MINE) && options.includes(TAKE_NEW), listed)
        return
      }
      assert.ok(options.includes(NEXT_PAGE) && options.includes(LAST_PAGE), listed)
      assert.ok(!options.includes(KEEP_MINE) && !options.includes(TAKE_NEW), listed)
      if (page === 1) assert.ok(!options.includes(PREVIOUS_PAGE), listed)
    })
    await ctx.check(`page ${page} shows diff lines`, () => {
      assert.ok(numbers.length > 0, 'no diff line of the hand-added lines is on the page')
    })
    await ctx.check(`page ${page} cuts no line`, () => {
      assert.ok(!MORE_ABOVE_RE.test(dialog), 'the page shows a +N more above line')
    })
    if (isLast) break
    const shown = numbers.join(',')
    await answer(pane, NEXT_PAGE)
    const isNext = (current: string): boolean => {
      if (!isConflictScreen(current)) return false
      const next = diffNumbers(dialogText(current))

      return next.length > 0 && next.join(',') !== shown
    }
    await waitTui(pane, isNext, WAIT_MS, `page ${page + 1} of the conflict question`)
    screen = await idleTui(pane)
  }

  ctx.observe('conflictPages', pages, 'the pages walked by Next page; no marker is drawn on the TUI default')
  await ctx.check('every hand-added line is on exactly one page', () => {
    const missing = Array.from({ length: ADDED_LINES }, (_, at) => String(at + 1).padStart(3, '0'))
      .filter(line => !firstPageOf.has(line))
    assert.equal(missing.length, 0, `lines on no page: ${missing.slice(0, NAMED_LINES).join(', ')}`)
    assert.equal(repeated.length, 0, `lines on more than one page: ${repeated.slice(0, NAMED_LINES).join(', ')}`)
  })

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
