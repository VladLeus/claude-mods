import { readdir, stat } from 'node:fs/promises'
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
import { capture, paneState, POLL_MS, sendKeys, sendText, WAIT_MS } from '../../lib/tmux.ts'
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
const NO_DIALOG_ROUTE = 'epicDone: only the print route is built; the row that answers the consent question types it'
const NO_COMMON_DIR = 'git rev-parse --git-common-dir gave no absolute path'

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

export async function epicDone(copy: LiveRepo, key: string, viaPrint: boolean): Promise<RunResult> {
  if (!viaPrint) throw new HarnessError(NO_DIALOG_ROUTE)

  return cadrePrint(copy, `epic done ${key}`)
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
