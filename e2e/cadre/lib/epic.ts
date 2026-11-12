import { lstat, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  answer,
  answerOther,
  dismiss,
  idleTui,
  isAppDialog,
  isDialogScreen,
  startTui,
  waitTui,
} from '../../lib/claude.ts'
import { scratchEnv } from '../../lib/env.ts'
import type { ChildEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { pollUntil } from '../../lib/poll.ts'
import { run } from '../../lib/proc.ts'
import type { RunResult } from '../../lib/proc.ts'
import {
  capture,
  listWindows,
  paneCommand,
  paneCwd,
  paneState,
  POLL_MS,
  sendKeys,
  sendText,
  WAIT_MS,
} from '../../lib/tmux.ts'
import type { Pane, Server } from '../../lib/tmux.ts'
import type { DialogAnswer } from '../fixtures/answers.ts'
import { cadrePrint, replyOf } from './session.ts'
import type { LiveRepo } from './session.ts'

export const EPIC_KEY = 'PROJ-1'
export const EPIC_TITLE = 'Add retry'

// cadre reads this as a terminal it does not know: the epic opens no role and each role's line is its launcher command.
const NO_TERMINAL = '--terminal=none'
const WORKTREES_DIR = '.claude/worktrees'
const GIT_MS = 30_000
const EPIC_REPLY_MS = 180_000
const ALL_ROLES = 'All'
const SLUG_MAX = 48
const LINKED_LINE_RE = /Linked [0-9]+, copied [0-9]+\./
const LEADING_MARK_RE = /^[^\p{L}\p{N}]+/u
const WORKTREE_PREFIX = 'worktree '
const NO_DIALOG_ROUTE = 'epicDone: only the print route is built; askEpicDone types the route that answers the question'
const NO_COMMON_DIR = 'git rev-parse --git-common-dir gave no absolute path'
const FORCE_FLAG = '--force'
const PROMPT_MARK = '❯ '
const REPLY_MARK = 'cadre: '

export type EpicOptions = {
  readonly title?: string
  // Open the roles in tmux windows; absent, no role opens.
  readonly terminal?: 'tmux'
  readonly pick?: DialogAnswer
  readonly pane?: Pane
}

export type EpicOpened = {
  readonly pane: Pane
  readonly dialog: string
  // The pane's whole history once the epic answered.
  readonly screen: string
  readonly worktree: string
}

export type EpicPrinted = {
  readonly result: RunResult
  readonly reply: string
  readonly worktree: string
}

export type PathKind = 'file' | 'dir' | 'link' | 'other' | 'absent'

export type WindowSeen = {
  readonly command: string
  readonly folder: string
  readonly screen: string
}

export type CommandSeen = {
  readonly pane: Pane
  readonly command: string
  // The question on screen once it settled; null when the command replied without asking one.
  readonly dialog: string | null
  // The pane's history after the typed line.
  readonly reply: string
}

// The slug cadre gives an epic: the key and the title words, lowercased, each run of other characters one dash.
export function epicSlug(key: string, title: string): string {
  const slug = `${key} ${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug.length <= SLUG_MAX) return slug
  const cut = slug.slice(0, SLUG_MAX)
  const at = cut.lastIndexOf('-')

  return (at === -1 ? cut : cut.slice(0, at)).replace(/-+$/, '')
}

export function epicWorktree(copy: LiveRepo, key: string, title: string = EPIC_TITLE): string {
  return join(copy.repo, WORKTREES_DIR, epicSlug(key, title))
}

export function epicBranchOf(key: string, title: string = EPIC_TITLE): string {
  return `epic/${epicSlug(key, title)}`
}

// What a path is, never following a link.
export async function kindOf(path: string): Promise<PathKind> {
  const stats = await lstat(path).catch(() => null)
  if (stats === null) return 'absent'
  if (stats.isSymbolicLink()) return 'link'
  if (stats.isDirectory()) return 'dir'

  return stats.isFile() ? 'file' : 'other'
}

async function isFile(path: string): Promise<boolean> {
  const stats = await stat(path).catch(() => null)

  return stats !== null && stats.isFile()
}

// A role is a folder of .cadre/ that holds a role.json.
export async function roleIdsOf(copy: LiveRepo): Promise<readonly string[]> {
  const cadre = join(copy.repo, '.cadre')
  const entries = await readdir(cadre, { withFileTypes: true }).catch(() => null)
  if (entries === null) throw new HarnessError('roleIdsOf: the copy has no .cadre/ folder')
  const ids: string[] = []
  for (const entry of entries.filter(item => item.isDirectory())) {
    if (await isFile(join(cadre, entry.name, 'role.json'))) ids.push(entry.name)
  }
  if (ids.length === 0) throw new HarnessError('roleIdsOf: the copy has no .cadre/*/role.json')

  return ids.sort()
}

// What a reply says after `<id>: ` on the line that starts with it, behind any mark the screen draws before a line.
export function roleLine(text: string, id: string): string | null {
  const prefix = `${id}: `
  for (const line of text.split('\n')) {
    const bare = line.replace(LEADING_MARK_RE, '')
    if (bare.startsWith(prefix)) return bare.slice(prefix.length).trimEnd()
  }

  return null
}

export function roleLineIds(text: string, ids: readonly string[]): readonly string[] {
  return ids.filter(id => roleLine(text, id) !== null)
}

async function gitEnvOf(copy: LiveRepo): Promise<ChildEnv> {
  return scratchEnv(join(dirname(copy.repo), 'env'))
}

// git in the copy, with a scratch HOME and git config: it starts no claude.
export async function gitRun(copy: LiveRepo, args: readonly string[]): Promise<RunResult> {
  return run(['git', ...args], { cwd: copy.repo, env: await gitEnvOf(copy), timeoutMs: GIT_MS })
}

// git in the copy for a step the row needs to have worked: a failure is a harness fault.
export async function gitOk(copy: LiveRepo, args: readonly string[]): Promise<string> {
  const result = await gitRun(copy, args)
  if (result.code !== 0) throw new HarnessError(`git ${args.join(' ')} exited ${result.code}: ${result.stderr.trim()}`)

  return result.stdout.trim()
}

async function gitLines(copy: LiveRepo, args: readonly string[]): Promise<readonly string[]> {
  const result = await gitRun(copy, args)
  if (result.code !== 0) throw new HarnessError(`git ${args[0] ?? ''} exited ${result.code}: ${result.stderr.trim()}`)

  return result.stdout.split('\n').filter(line => line !== '')
}

export async function commonDir(copy: LiveRepo): Promise<string> {
  const [dir] = await gitLines(copy, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (dir === undefined || !isAbsolute(dir)) throw new HarnessError(NO_COMMON_DIR)

  return dir
}

// The folders of the repo's worktrees, the main checkout first.
export async function worktreesOf(copy: LiveRepo): Promise<readonly string[]> {
  const lines = await gitLines(copy, ['worktree', 'list', '--porcelain'])

  return lines.filter(line => line.startsWith(WORKTREE_PREFIX)).map(line => line.slice(WORKTREE_PREFIX.length))
}

export async function epicBranchesOf(copy: LiveRepo): Promise<readonly string[]> {
  return gitLines(copy, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/epic/'])
}

// The epic made in print mode, where cadre asks no question and picks every role.
export async function printEpic(copy: LiveRepo, key: string, title: string = EPIC_TITLE): Promise<EpicPrinted> {
  const result = await cadrePrint(copy, `epic ${key} ${title} ${NO_TERMINAL}`)

  return { result, reply: replyOf(result), worktree: epicWorktree(copy, key, title) }
}

// `/cadre epic done` in print mode, where it asks nothing: with `force` it can only refuse, as no dialog is there.
export async function epicDone(
  copy: LiveRepo,
  key: string,
  viaPrint: boolean,
  force: boolean = false,
): Promise<RunResult> {
  if (!viaPrint) throw new HarnessError(NO_DIALOG_ROUTE)

  return cadrePrint(copy, `epic done ${key}${force ? ` ${FORCE_FLAG}` : ''}`)
}

function linkedLines(text: string): number {
  return text.split('\n').filter(line => LINKED_LINE_RE.test(line)).length
}

async function answerRoles(pane: Pane, pick: DialogAnswer): Promise<void> {
  if (pick === 'dismiss') return dismiss(pane)
  if (typeof pick === 'string') return answer(pane, pick)

  return answerOther(pane, pick.other)
}

// The reply of a created or reused epic holds one `Linked <n>, copied <m>.` line, near its top: the visible screen can
// lose it to a long reply, so the history is read, and a line that an earlier epic of the session left does not count.
async function replied(pane: Pane, before: number): Promise<string> {
  const opts = {
    timeoutMs: EPIC_REPLY_MS,
    intervalMs: POLL_MS,
    now: Date.now,
    sleep: delay,
    isDead: async () => (await paneState(pane)).dead,
    label: 'the reply of /cadre epic',
  }
  await pollUntil(() => capture(pane, { history: true }), text => linkedLines(text) > before, opts)
  await idleTui(pane)

  return capture(pane, { history: true })
}

async function dismissed(pane: Pane): Promise<string> {
  await waitTui(pane, screen => !isDialogScreen(screen), WAIT_MS, 'the Epic roles question to close')
  await idleTui(pane)

  return capture(pane, { history: true })
}

// `/cadre epic <key> <title>` typed into a root session on the server, which asks the `Epic roles` question.
export async function openEpic(
  server: Server,
  copy: LiveRepo,
  key: string,
  opts: EpicOptions = {},
): Promise<EpicOpened> {
  const title = opts.title ?? EPIC_TITLE
  const terminal = opts.terminal === undefined ? NO_TERMINAL : `--terminal=${opts.terminal}`
  const pick = opts.pick ?? ALL_ROLES
  const pane = opts.pane ?? await startTui(server, copy.repo, [])
  const before = linkedLines(await capture(pane, { history: true }))
  await sendText(pane, `/cadre epic ${key} ${title} ${terminal}`)
  await sendKeys(pane, 'Enter')
  await waitTui(pane, isAppDialog, WAIT_MS, 'the Epic roles question')
  const dialog = await idleTui(pane)
  await answerRoles(pane, pick)
  const screen = pick === 'dismiss' ? await dismissed(pane) : await replied(pane, before)

  return { pane, dialog, screen, worktree: epicWorktree(copy, key, title) }
}

// A new file committed on the branch checked out in the worktree.
export async function commitInWorktree(copy: LiveRepo, worktree: string, name: string, text: string): Promise<void> {
  await writeFile(join(worktree, name), text)
  await gitOk(copy, ['-C', worktree, 'add', '--', name])
  await gitOk(copy, ['-C', worktree, 'commit', '-q', '-m', `add ${name}`])
}

// `ls -la` of a folder, as the sweep reads it; a folder that is not there gives the failure as the text.
export async function lsLong(copy: LiveRepo, path: string): Promise<string> {
  const result = await run(['/bin/ls', '-la', path], { cwd: copy.repo, env: await gitEnvOf(copy), timeoutMs: GIT_MS })

  return result.code === 0 ? result.stdout : `ls -la exited ${result.code}: ${result.stderr.trim()}`
}

// Each window a role was opened in, named `cadre-<id>`, read the moment it is listed: its command, folder and screen.
export async function readWindows(server: Server, ids: readonly string[]): Promise<ReadonlyMap<string, WindowSeen>> {
  const seen = new Map<string, WindowSeen>()
  for (const window of await listWindows(server)) {
    const id = ids.find(item => window.name === `cadre-${item}`)
    if (id === undefined) continue
    const pane = { server, id: window.pane }
    seen.set(id, { command: await paneCommand(pane), folder: await paneCwd(pane), screen: await capture(pane) })
  }

  return seen
}

// True once nothing is at `path`; false when something still is after `timeoutMs`.
export async function waitGone(path: string, timeoutMs: number = WAIT_MS): Promise<boolean> {
  const opts = { timeoutMs, intervalMs: POLL_MS, now: Date.now, sleep: delay, label: 'the path to be removed' }
  try {
    await pollUntil(() => kindOf(path), kind => kind === 'absent', opts)

    return true
  } catch (error) {
    if (error instanceof HarnessError) return false
    throw error
  }
}

// The history after the last typed line of `command`; null while that line is not in it.
function afterEcho(history: string, command: string): string | null {
  const at = history.lastIndexOf(`${PROMPT_MARK}${command}`)
  if (at === -1) return null
  const rest = history.slice(at)
  const end = rest.indexOf('\n')

  return end === -1 ? '' : rest.slice(end + 1)
}

function hasReply(history: string, command: string): boolean {
  return afterEcho(history, command)?.includes(REPLY_MARK) ?? false
}

// A slash command typed into a root session either asks a question or replies, and the reply starts with `cadre: `.
export async function typeCommand(pane: Pane, command: string): Promise<CommandSeen> {
  await sendText(pane, command)
  await sendKeys(pane, 'Enter')
  const opts = {
    timeoutMs: WAIT_MS,
    intervalMs: POLL_MS,
    now: Date.now,
    sleep: delay,
    isDead: async () => (await paneState(pane)).dead,
    label: `the question or the reply of ${command}`,
  }
  const read = async () => ({ screen: await capture(pane), history: await capture(pane, { history: true }) })
  await pollUntil(read, now => isAppDialog(now.screen) || hasReply(now.history, command), opts)
  // A line printed above a question can show first, so what the settled screen holds decides.
  const screen = await idleTui(pane)
  const reply = afterEcho(await capture(pane, { history: true }), command) ?? ''

  return { pane, command, dialog: isAppDialog(screen) ? screen : null, reply }
}

// `/cadre epic done <key> --force` typed into a root session of the main checkout, which asks the consent question.
export async function askEpicDone(
  server: Server,
  copy: LiveRepo,
  key: string,
  pane?: Pane,
): Promise<CommandSeen> {
  const session = pane ?? await startTui(server, copy.repo, [])

  return typeCommand(session, `/cadre epic done ${key} ${FORCE_FLAG}`)
}

// The consent question answered by `label`: the reply once the question closed and the session settled.
export async function answerEpicDone(asked: CommandSeen, label: string): Promise<string> {
  await answer(asked.pane, label)
  await waitTui(asked.pane, screen => !isDialogScreen(screen), WAIT_MS, 'the Epic done question to close')
  await idleTui(asked.pane)

  return afterEcho(await capture(asked.pane, { history: true }), asked.command) ?? ''
}
