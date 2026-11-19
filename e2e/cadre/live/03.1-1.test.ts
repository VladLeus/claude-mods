import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import type { Json } from '../../lib/summary.ts'
import { capture, killServer, listWindows, paneCommand, paneCwd, socketName, startServer } from '../../lib/tmux.ts'
import type { Server } from '../../lib/tmux.ts'
import { EPIC_KEY, gitOk, openEpic, printEpic, roleIdsOf, roleLine } from '../lib/epic.ts'
import { cadrePrint, liveRepo, noteReply, printedCommand, replyOf } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const SECOND_KEY = 'PROJ-2'
const SECOND_TITLE = 'Add more'
const SHELL_COMMAND = '/bin/sh -c'
const COMMAND_SHOWN_CHARS = 40
const CADRE_FOLDER = '.cadre'
const BIN_FOLDER = '.cadre/bin'
const NEW_COPY_SUFFIX = '.cadre-new'
const FILE_PLAN_HEADER = 'File plan:'
const EXPECTED_PLAN_VERB = 'change'
const EXPECTED_WARNING =
  '.cadre/bin/<id> is not the launcher this cadre writes today (written by an older cadre or for another setup): ' +
  'run /cadre regen <id> to update it'
const EXPECTED_NO_WARNING = '.cadre/bin/<id> is not the launcher this cadre writes today'
const EXPECTED_NO_NOT_OPENED =
  'not opened: the epic branch holds a launcher .cadre/bin/<id> older than the epic kickoff'

type WindowSeen = {
  readonly command: string
  readonly folder: string
}

function filled(text: string, id: string): string {
  return text.replaceAll('<id>', id)
}

// The verb of the file plan line that names `path`, such as `change` or `conflict`; null when no line under the
// `File plan:` header names it.
function planVerb(reply: string, path: string): string | null {
  const lines = reply.split('\n')
  const header = lines.findIndex(line => line.trim() === FILE_PLAN_HEADER)
  if (header === -1) return null
  for (const line of lines.slice(header + 1)) {
    const [verb, named] = line.trim().split(/\s+/)
    if (verb !== undefined && named === path) return verb
  }

  return null
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
    const launcher = `${BIN_FOLDER}/${id}`
    const newLauncher = `${launcher}${NEW_COPY_SUFFIX}`
    const before = await cadrePrint(copy, `start ${id}`)
    noteReply(ctx, `start ${id} before the regen`, before)
    await ctx.check(`before the regen, start ${id} warns that its launcher is not the one cadre writes today`, () => {
      const warning = filled(EXPECTED_WARNING, id)
      assert.ok(replyOf(before).includes(warning), `the reply does not hold: ${warning}`)
    })

    const regen = await cadrePrint(copy, `regen ${id}`)
    noteReply(ctx, `regen ${id}`, regen)
    await ctx.check(`regen ${id} rewrites ${launcher} in place`, () => {
      const verb = planVerb(replyOf(regen), launcher)
      assert.equal(verb, EXPECTED_PLAN_VERB, `the file plan line of ${launcher} reads ${verb ?? 'nothing'}`)
    })
    await ctx.check(`regen ${id} plans and writes no ${newLauncher}`, () => {
      assert.ok(!replyOf(regen).includes(newLauncher), `the reply names ${newLauncher}`)
      assert.ok(!existsSync(join(copy.repo, newLauncher)), `${newLauncher} is on disk`)
    })

    const after = await cadrePrint(copy, `start ${id}`)
    noteReply(ctx, `start ${id} after the regen`, after)
    await ctx.check(`after the regen, start ${id} prints its launcher command`, () => {
      assert.ok(printedCommand(replyOf(after), id) !== null, `the reply prints no ${id} launcher command`)
    })
    const noWarning = `after the regen, start ${id} no longer warns that its launcher is not the one cadre writes today`
    await ctx.check(noWarning, () => {
      const warning = filled(EXPECTED_NO_WARNING, id)
      assert.ok(!replyOf(after).includes(warning), `the reply holds: ${warning}`)
    })
  }

  // A new epic worktree is made from HEAD, so the regenerated team is committed first.
  await gitOk(copy, ['add', '-A', '--', CADRE_FOLDER])
  await gitOk(copy, ['commit', '-q', '--allow-empty', '-m', 'regen'])
  const status = await gitOk(copy, ['status', '--porcelain'])
  ctx.evidence('git status --porcelain after the regen commit', status || 'clean')
  const committed = await gitOk(copy, ['show', '--stat', '--format=', 'HEAD'])
  ctx.evidence('the regen commit', committed || 'empty')

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
