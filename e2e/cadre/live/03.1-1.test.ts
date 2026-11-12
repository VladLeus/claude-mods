import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import type { Json } from '../../lib/summary.ts'
import { capture, killServer, listWindows, paneCommand, paneCwd, socketName, startServer } from '../../lib/tmux.ts'
import type { Server } from '../../lib/tmux.ts'
import { EPIC_KEY, openEpic, printEpic, roleIdsOf, roleLine } from '../lib/epic.ts'
import { cadrePrint, liveRepo, noteReply, printedCommand, replyOf } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const SECOND_KEY = 'PROJ-2'
const SECOND_TITLE = 'Add more'
const SHELL_COMMAND = '/bin/sh -c'
const COMMAND_SHOWN_CHARS = 40
const BIN_FOLDER = '.cadre/bin'
const EXPECTED_NO_WARNING = '.cadre/bin/<id> is not the launcher this cadre writes today'
const EXPECTED_NO_NOT_OPENED =
  'not opened: the epic branch holds a launcher .cadre/bin/<id> older than the epic kickoff'

type WindowSeen = {
  readonly command: string
  readonly folder: string
}

function filled(text: string, id: string): string {
  return text.replace('<id>', id)
}

// Each window the epic opened is read the moment it is listed, so the role session in it has done nothing yet.
async function readWindows(
  ctx: RowContext,
  server: Server,
  ids: readonly string[],
): Promise<ReadonlyMap<string, WindowSeen>> {
  const seen = new Map<string, WindowSeen>()
  for (const window of await listWindows(server)) {
    const id = ids.find(item => window.name === `cadre-${item}`)
    if (id === undefined) continue
    const pane = { server, id: window.pane }
    seen.set(id, { command: await paneCommand(pane), folder: await paneCwd(pane) })
    ctx.screen(`the window ${window.name}`, await capture(pane))
  }

  return seen
}

const entry = rowEntry('03.1#1')

rowTest(entry, async ctx => {
  for (const part of entry.partial ?? []) ctx.skipPart(part.part, part.reason)
  const copy = await liveRepo(ctx, 'v050')
  const ids = await roleIdsOf(copy)

  for (const id of ids) {
    const started = await cadrePrint(copy, `start ${id}`)
    noteReply(ctx, `start ${id}`, started)
    await ctx.check(`start ${id} prints its launcher command`, () => {
      assert.ok(printedCommand(replyOf(started), id) !== null, `the reply prints no ${id} launcher command`)
    })
    await ctx.check(`start ${id} gives no warning that its launcher is not the one cadre writes today`, () => {
      const warning = filled(EXPECTED_NO_WARNING, id)
      assert.ok(!replyOf(started).includes(warning), `the reply holds: ${warning}`)
    })
  }

  const created = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'epic', created.result)
  await ctx.check('epic creates the worktree without stopping', () => {
    assert.ok(existsSync(created.worktree), 'the epic worktree is not there')
  })
  for (const id of ids) {
    await ctx.check(`no role line of ${id} reads not opened for a launcher older than the epic kickoff`, () => {
      const line = filled(EXPECTED_NO_NOT_OPENED, id)
      assert.ok(!created.reply.includes(line), `the reply holds: ${line}`)
    })
  }
  // A second epic stops the same way, and waiting for its reply would end the row in error.
  if (!existsSync(created.worktree)) return

  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  const opened = await openEpic(server, copy, SECOND_KEY, { title: SECOND_TITLE, terminal: 'tmux' })
  const seen = await readWindows(ctx, server, ids)
  await killServer(server)
  ctx.screen('the root session after the new epic', opened.screen)
  const replyLines: Record<string, Json> = {}
  for (const id of ids) replyLines[id] = roleLine(opened.screen, id)
  ctx.observe('roleReplyLines', replyLines, 'the line of each role in the reply of the tmux epic, null for none')

  const worktree = await realpath(opened.worktree).catch(() => opened.worktree)
  for (const id of ids) {
    const window = seen.get(id)
    await ctx.check(`a new epic opens the window cadre-${id}`, () => {
      assert.ok(window !== undefined, `no window named cadre-${id} is open`)
    })
    if (window === undefined) continue
    await ctx.check(`the window cadre-${id} runs its launcher in the worktree through ${SHELL_COMMAND}`, () => {
      const launcher = join(opened.worktree, BIN_FOLDER, id)
      const start = window.command.slice(0, COMMAND_SHOWN_CHARS)
      assert.ok(window.command.startsWith(`${SHELL_COMMAND} `), `the window command starts with ${start}`)
      assert.ok(window.command.includes(launcher), 'the window command does not hold the launcher of the worktree')
    })
    await ctx.check(`the window cadre-${id} opens in the worktree`, () => {
      assert.equal(window.folder, worktree, `the window opened in ${window.folder}`)
    })
  }
})
