import assert from 'node:assert/strict'
import { readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { liveEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { hashTree } from '../../lib/hash.ts'
import { rowTest } from '../../lib/row.ts'
import { versionShim } from '../../lib/shims.ts'
import { killServer, socketName, startServer } from '../../lib/tmux.ts'
import { EPIC_KEY, kindOf, openEpic, printEpic, readWindows, roleIdsOf, roleLine } from '../lib/epic.ts'
import { cadrePrint, firstLineOf, liveRepo, noteReply, printedCommand, replyOf } from '../lib/session.ts'
import { runLauncher } from '../lib/world.ts'
import type { LaunchResult } from '../lib/world.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const SECOND_KEY = 'PROJ-2'
const SHIM_CLAUDE_VERSION = '2.1.322'
const SHELL_COMMAND = '/bin/sh -c'
const COMMAND_SHOWN_CHARS = 40
const NOT_OPENED = 'not opened'

// The three kinds of folder the worktree must hold for real, and what lies in them that is not a link.
async function layoutProblems(worktree: string, ids: readonly string[]): Promise<readonly string[]> {
  const folders = ['.cadre', '.cadre/bin', ...ids.map(id => `.cadre/${id}`)]
  const problems: string[] = []
  for (const folder of folders) {
    const kind = await kindOf(join(worktree, folder))
    if (kind !== 'dir') problems.push(`${folder} is ${kind}, not a real folder`)
  }
  for (const folder of folders) {
    for (const name of await readdir(join(worktree, folder)).catch((): string[] => [])) {
      const child = `${folder}/${name}`
      if (folders.includes(child) || child.endsWith('/.runtime')) continue
      const kind = await kindOf(join(worktree, child))
      if (kind !== 'link') problems.push(`${child} is ${kind}, not a link`)
    }
  }

  return problems
}

function resultText(result: LaunchResult): string {
  const exit = result.code === null ? 'running when claude was reached, stopped by the harness' : `exit ${result.code}`
  const calls = result.calls.map(call => `claude call in ${call.cwd}: ${call.argv.join(' ')}`)

  return [exit, `stderr:\n${result.stderr}`, ...calls].join('\n')
}

const entry = rowEntry('03.1#4')

rowTest(entry, async ctx => {
  for (const part of entry.partial ?? []) ctx.skipPart(part.part, part.reason)
  const shimDir = join(ctx.scratch, 'shim')
  const log = join(ctx.scratch, 'launcher.log')
  await versionShim(shimDir, SHIM_CLAUDE_VERSION, log)
  const copy = await liveRepo(ctx, 'gsd-ignoreall')
  const ids = await roleIdsOf(copy)
  const mainRuntime = join(copy.repo, '.cadre', ROLE, '.runtime')

  const started = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, `start ${ROLE} in main`, started)
  if (printedCommand(replyOf(started), ROLE) === null) {
    throw new HarnessError(`03.1#4: the start in main did not render: ${firstLineOf(replyOf(started))}`)
  }
  if (await kindOf(mainRuntime) !== 'dir') {
    throw new HarnessError(`03.1#4: the start rendered no .cadre/${ROLE}/.runtime/ in main`)
  }
  const treeBefore = await hashTree(mainRuntime)

  const epic = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'epic', epic.result)
  const layout = '.cadre, .cadre/bin and each .cadre/<id> are real folders and their other children links'
  await ctx.check(layout, async () => {
    const problems = await layoutProblems(epic.worktree, ids)
    assert.deepEqual(problems, [], problems.join('; '))
  })

  const worktreeLauncher = join(epic.worktree, '.cadre', 'bin', ROLE)
  await ctx.check(`.cadre/bin/${ROLE} in the worktree is a link to the launcher of main`, async () => {
    const kind = await kindOf(worktreeLauncher)
    assert.equal(kind, 'link', `.cadre/bin/${ROLE} is ${kind} in the worktree`)
    const target = await realpath(worktreeLauncher)
    assert.equal(target, await realpath(join(copy.repo, '.cadre', 'bin', ROLE)), 'the link does not lead to main')
  })

  const launched = await runLauncher(worktreeLauncher, { cwd: copy.repo, env: liveEnv({ shimDir }), log })
  ctx.evidence(`the launcher ${ROLE} run through the link`, resultText(launched))
  await ctx.check(`the role started from .cadre/bin/${ROLE} runs with its cwd in the worktree`, async () => {
    const call = launched.calls[0]
    assert.ok(call !== undefined, `the launcher never reached claude: ${firstLineOf(launched.stderr)}`)
    assert.equal(await realpath(call.cwd), await realpath(epic.worktree), 'claude was started in another folder')
  })
  await ctx.check(`main .cadre/${ROLE}/.runtime/ is untouched`, async () => {
    assert.equal(await hashTree(mainRuntime), treeBefore, 'the listing of the folder changed')
  })

  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  const opened = await openEpic(server, copy, SECOND_KEY, { terminal: 'tmux' })
  const seen = await readWindows(server, ids)
  await killServer(server)
  ctx.screen('the root session after the new epic', opened.screen)
  const lines = ids.map(id => `${id}: ${roleLine(opened.screen, id) ?? 'none'}`)
  ctx.evidence('the reply line of each role', lines.join('\n'))

  const worktree = await realpath(opened.worktree).catch(() => opened.worktree)
  for (const id of ids) {
    const line = roleLine(opened.screen, id)
    await ctx.check(`the epic opens ${id}: its line does not read ${NOT_OPENED}`, () => {
      assert.ok(line !== null, `the reply has no line for ${id}`)
      assert.ok(!line.includes(NOT_OPENED), `the line of ${id} reads: ${line}`)
    })
    const window = seen.get(id)
    await ctx.check(`the window cadre-${id} is open`, () => {
      assert.ok(window !== undefined, `no window named cadre-${id} is open`)
    })
    if (window === undefined) continue
    await ctx.check(`the window cadre-${id} runs the launcher of the worktree through ${SHELL_COMMAND}`, () => {
      const start = window.command.slice(0, COMMAND_SHOWN_CHARS)
      assert.ok(window.command.startsWith(`${SHELL_COMMAND} `), `the window command starts with ${start}`)
      const launcher = join(opened.worktree, '.cadre', 'bin', id)
      assert.ok(window.command.includes(launcher), 'the window command holds no launcher of the worktree')
    })
    await ctx.check(`the window cadre-${id} opens in the worktree`, () => {
      assert.equal(window.folder, worktree, `the window opened in ${window.folder}`)
    })
  }
})
