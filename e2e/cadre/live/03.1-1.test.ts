import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { HarnessError } from '../../lib/errors.ts'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import { capture, killServer, listWindows, paneCommand, paneCwd, socketName, startServer } from '../../lib/tmux.ts'
import type { Server } from '../../lib/tmux.ts'
import { EPIC_KEY, epicBranchesOf, gitRun, openEpic, printEpic, roleIdsOf, roleLine } from '../lib/epic.ts'
import { cadrePrint, liveRepo, noteReply, replyOf } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const SECOND_KEY = 'PROJ-2'
const SECOND_TITLE = 'Add more'
const SHELL_COMMAND = '/bin/sh -c'
const COMMAND_SHOWN_CHARS = 40
const BIN_FOLDER = '.cadre/bin'
const MANIFEST_FILE = '.cadre/manifest.json'
const EXPECTED_LAUNCHER_WARNING_HEAD = 'is not the launcher this cadre writes today'
// The words of the UAT's commit advice that the stop reply holds, cleaned of the code marks.
const EXPECTED_ADVICE: readonly string[] = ['commits .cadre/', `${BIN_FOLDER}/`, MANIFEST_FILE, 'made from HEAD']

type WindowSeen = {
  readonly command: string
  readonly folder: string
}

function expectedWarning(id: string): string {
  return [
    `${BIN_FOLDER}/${id} ${EXPECTED_LAUNCHER_WARNING_HEAD}`,
    '(written by an older cadre or for another setup):',
    `run /cadre regen ${id} to update it`,
  ].join(' ')
}

function expectedNotOpened(id: string): string {
  return [
    `not opened: the epic branch holds a launcher ${BIN_FOLDER}/${id} older than the epic kickoff.`,
    `Commit the regenerated ${BIN_FOLDER}/${id} and ${MANIFEST_FILE} to the branch`,
    'and run /cadre epic with the same key again.',
  ].join(' ')
}

async function commitRegen(copy: LiveRepo): Promise<void> {
  const steps = [['add', BIN_FOLDER, MANIFEST_FILE], ['commit', '-q', '--allow-empty', '-m', 'regen']]
  for (const args of steps) {
    const result = await gitRun(copy, args)
    if (result.code === 0) continue

    throw new HarnessError(`03.1#1: git ${args[0]} exited ${result.code}: ${result.stderr.trim()}`)
  }
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

  const before = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, `start ${ROLE} before the regen`, before)
  await ctx.check(`before the regen, start ${ROLE} warns that its launcher is not the one cadre writes today`, () => {
    assert.ok(replyOf(before).includes(expectedWarning(ROLE)), `the reply does not hold: ${expectedWarning(ROLE)}`)
  })

  const stopped = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'epic before the regen', stopped.result)
  ctx.observe('stopAdviceText', stopped.reply, 'the whole reply of epic before the regen')
  await ctx.check('before the regen, epic stops with the regen line of every role', () => {
    const missing = ids.filter(id => !stopped.reply.includes(`/cadre regen ${id}`))
    assert.deepEqual(missing, [], `the reply holds no /cadre regen line for ${missing.join(', ')}`)
  })
  await ctx.check('the stop reply says to commit the regenerated launchers and the manifest', () => {
    const missing = EXPECTED_ADVICE.filter(phrase => !stopped.reply.includes(phrase))
    assert.deepEqual(missing, [], `the reply does not hold: ${missing.join(' | ')}`)
  })
  await ctx.check('before the regen, epic creates nothing: no worktree and no epic branch', async () => {
    assert.ok(!existsSync(stopped.worktree), 'the epic worktree exists')
    assert.deepEqual(await epicBranchesOf(copy), [], 'an epic branch exists')
  })

  for (const id of ids) noteReply(ctx, `regen ${id}`, await cadrePrint(copy, `regen ${id}`))
  const after = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, `start ${ROLE} after the regen`, after)
  await ctx.check(`after the regen, start ${ROLE} no longer warns`, () => {
    assert.ok(!replyOf(after).includes(EXPECTED_LAUNCHER_WARNING_HEAD), 'the reply still warns about the launcher')
  })

  const created = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'epic after the regen, before the commit', created.result)
  await ctx.check('after the regen and before the commit, epic creates the worktree', () => {
    assert.ok(existsSync(created.worktree), 'the epic worktree is not there')
  })
  for (const id of ids) {
    await ctx.check(`the line of ${id} reads not opened, with the commit advice`, () => {
      const line = roleLine(created.reply, id)
      assert.equal(line, expectedNotOpened(id), `the line of ${id} is ${line === null ? 'missing' : `"${line}"`}`)
    })
  }
  const lines = ids.map(id => roleLine(created.reply, id) ?? '')
  const namesBoth = ids.every((id, at) => {
    const line = lines[at] ?? ''
    return line.includes(`${BIN_FOLDER}/${id}`) && line.includes(MANIFEST_FILE)
  })
  ctx.observe('notOpenedAdviceNamesBothPaths', namesBoth, lines.map(line => line || 'no line').join('\n'))

  await commitRegen(copy)

  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  const opened = await openEpic(server, copy, SECOND_KEY, { title: SECOND_TITLE, terminal: 'tmux' })
  const seen = await readWindows(ctx, server, ids)
  await killServer(server)
  ctx.screen('the root session after the new epic', opened.screen)
  const replyLines = ids.map(id => `${id}: ${roleLine(opened.screen, id) ?? 'none'}`)
  ctx.evidence('the reply line of each role', replyLines.join('\n'))

  const worktree = await realpath(opened.worktree).catch(() => opened.worktree)
  for (const id of ids) {
    const window = seen.get(id)
    await ctx.check(`after the commit, a new epic opens the window cadre-${id}`, () => {
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
