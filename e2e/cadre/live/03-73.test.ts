import assert from 'node:assert/strict'
import { basename, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { startTui, submitTui } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { pollUntil } from '../../lib/poll.ts'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import {
  capture,
  killServer,
  listWindows,
  paneCommand,
  paneCwd,
  POLL_MS,
  setOption,
  socketName,
  startServer,
  WAIT_MS,
} from '../../lib/tmux.ts'
import type { Pane, Server, WindowInfo } from '../../lib/tmux.ts'
import { liveRepo, nonPosixShell, systemTool } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const LAUNCHER = '.cadre/bin/be'
const ROOT_FOLDER = 'C#Projects'
const EXPECTED_WINDOW = 'cadre-be'
const EXPECTED_SHELL_COMMAND = '/bin/sh -c'
const NO_NON_POSIX_SHELL = 'no non-POSIX shell: fish, /bin/tcsh and /bin/csh absent'
const COMMAND_SHOWN_CHARS = 40

type Half = {
  readonly key: string
  readonly prefix: string
  readonly path: string
  readonly shell: string | null
}

type WindowSeen = {
  readonly command: string
  readonly folder: string
}

const entry = rowEntry('03#73')

function pollOptions(label: string) {
  return { timeoutMs: WAIT_MS, intervalMs: POLL_MS, now: Date.now, sleep: delay, label }
}

// The window once it is listed; null when none of that name shows within WAIT_MS.
async function waitForWindow(server: Server): Promise<WindowInfo | null> {
  const listed = (windows: readonly WindowInfo[]): boolean => windows.some(item => item.name === EXPECTED_WINDOW)
  try {
    const windows = await pollUntil(() => listWindows(server), listed, pollOptions(`the window ${EXPECTED_WINDOW}`))

    return windows.find(item => item.name === EXPECTED_WINDOW) ?? null
  } catch (error) {
    if (error instanceof HarnessError) return null
    throw error
  }
}

// The window is read the moment it is listed and its server ended right after, so the role session the launcher starts
// in it has no time to do anything.
async function readWindow(ctx: RowContext, prefix: string, pane: Pane): Promise<WindowSeen> {
  const command = await paneCommand(pane)
  const folder = await paneCwd(pane)
  ctx.screen(`${prefix} the window`, await capture(pane))

  return { command, folder }
}

async function checkWindow(ctx: RowContext, half: Half): Promise<void> {
  const { key, prefix } = half
  const copy = await liveRepo(ctx, 'gsd', { path: half.path })
  const launcher = join(copy.repo, LAUNCHER)
  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  if (half.shell !== null) await setOption(server, 'default-shell', half.shell)
  const root = await startTui(server, copy.repo, [])
  await submitTui(root, `/cadre start ${ROLE} --terminal=tmux`)
  const opened = await waitForWindow(server)
  const seen = opened === null ? null : await readWindow(ctx, prefix, { server, id: opened.pane })
  ctx.screen(`${prefix} the root session after the command`, await capture(root))
  await killServer(server)

  const tmuxPath = await systemTool('tmux')
  const through = `cadre runs the bare name tmux; the first tmux in the system folders of the live PATH is ${tmuxPath}`
  ctx.observe(`${key}TmuxFoundThroughPath`, seen !== null, through)
  await ctx.check(`${prefix} /cadre start --terminal=tmux opens the window ${EXPECTED_WINDOW}`, () => {
    assert.ok(seen !== null, `no window named ${EXPECTED_WINDOW} opened within ${WAIT_MS} ms`)
  })
  if (seen === null) return

  ctx.evidence(`${prefix} the window command as tmux prints it`, seen.command)
  await ctx.check(`${prefix} the window command runs through ${EXPECTED_SHELL_COMMAND} as separate argv items`, () => {
    const start = seen.command.slice(0, COMMAND_SHOWN_CHARS)
    assert.ok(seen.command.startsWith(`${EXPECTED_SHELL_COMMAND} `), `the window command starts with ${start}`)
    assert.ok(seen.command.includes(launcher), 'the window command does not hold the launcher path')
  })
  ctx.observe(`${key}TmuxExpandsFormatsInC`, seen.folder !== copy.repo, `the window's folder is ${seen.folder}`)
  await ctx.check(`${prefix} the window opens in the ${ROOT_FOLDER} folder`, () => {
    assert.equal(seen.folder, copy.repo, `the window opened in ${seen.folder}, not in the repo folder ${copy.repo}`)
  })
}

rowTest(entry, async ctx => {
  for (const part of entry.partial ?? []) ctx.skipPart(part.part, part.reason)
  await checkWindow(ctx, { key: 'posix', prefix: 'posix:', path: join(ROOT_FOLDER, 'repo'), shell: null })
  const shell = await nonPosixShell()
  if (shell === null) {
    ctx.skipPart('the non-POSIX half', NO_NON_POSIX_SHELL)
    return
  }

  ctx.observe('nonPosixDefaultShell', shell, 'the default-shell of the tmux server of the second half')
  const path = join('nonposix', ROOT_FOLDER, 'repo')
  await checkWindow(ctx, { key: 'nonPosix', prefix: `non-posix (${basename(shell)}):`, path, shell })
})
