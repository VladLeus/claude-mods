import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
  answer,
  answerOther,
  dismiss,
  idleTui,
  isAppDialog,
  isDialogScreen,
  printMode,
  startTuiUntil,
  TUI_READY,
  waitTui,
} from '../../lib/claude.ts'
import { liveEnv, scratchEnv } from '../../lib/env.ts'
import type { ChildEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { copyTree, fixtureDir } from '../../lib/fixture.ts'
import type { BuildContext } from '../../lib/fixture.ts'
import { run } from '../../lib/proc.ts'
import type { RunResult } from '../../lib/proc.ts'
import type { RowContext } from '../../lib/row.ts'
import { importSource } from '../../lib/source.ts'
import { killServer, matches, sendKeys, sendText, socketName, startServer, waitDead, WAIT_MS } from '../../lib/tmux.ts'
import type { Matcher, Pane, Server } from '../../lib/tmux.ts'
import type { DialogAnswer, DialogEntry } from '../fixtures/answers.ts'

export const INIT_BUILD_MS = 900_000

const DIALOG_WAIT_MS = 2 * WAIT_MS
const PROMPT_SETTLE_MS = 5_000
const STUCK_MS = 8_000
const GIT_MS = 30_000
const EXIT_COMMAND = '/exit'
const WHITESPACE_RE = /\s+/g
const HEADER_RE = /^ *☐ /gm
const HAIKU = 'haiku'
const MEDIUM = 'medium'

export const APPLIED_REPLY = /Applied: wrote [0-9]+ files? \([0-9]+ executable\)/

export type LiveRepo = {
  readonly repo: string
  readonly env: ChildEnv
}

export type LiveRepoOptions = {
  readonly path?: string
  readonly shimDir?: string
}

export type DialogLog = {
  readonly screens: readonly string[]
  readonly asked: readonly string[]
  readonly final: string
}

function squashed(text: string): string {
  return text.replace(WHITESPACE_RE, ' ')
}

export async function liveRepo(ctx: RowContext, variant: string, opts: LiveRepoOptions = {}): Promise<LiveRepo> {
  const path = opts.path ?? 'repo'
  if (isAbsolute(path) || path.split('/').includes('..')) {
    throw new HarnessError(`liveRepo: the path must stay inside the row scratch: ${path}`)
  }
  const repo = join(ctx.scratch, path)
  await copyTree(fixtureDir(variant), repo)

  return { repo, env: liveEnv({ shimDir: opts.shimDir }) }
}

export async function cadrePrint(copy: LiveRepo, args: string, env?: ChildEnv): Promise<RunResult> {
  return printMode(copy.repo, [`/cadre ${args}`], env ?? copy.env)
}

// The command is the first prompt of the session, so it runs as soon as the folder is trusted.
export async function cadreTui(server: Server, copy: LiveRepo, firstCommand: string): Promise<Pane> {
  const until = (screen: string): boolean => TUI_READY.test(screen) || isAppDialog(screen)

  return startTuiUntil(server, copy.repo, ['--', firstCommand], until)
}

async function respond(pane: Pane, given: DialogAnswer): Promise<void> {
  if (given === 'dismiss') {
    await dismiss(pane)
    return
  }
  if (typeof given === 'string') {
    await answer(pane, given)
    return
  }

  await answerOther(pane, given.other)
}

// The dialog is drawn under its `☐ <header>` line, below the transcript that still holds the answered questions.
function activeText(screen: string): string {
  const header = [...screen.matchAll(HEADER_RE)].at(-1)

  return header === undefined ? screen : screen.slice(header.index)
}

function entryOn(screen: string, script: readonly DialogEntry[], from: number): number {
  const text = squashed(activeText(screen))

  return script.findIndex((entry, index) => index >= from && text.includes(squashed(entry.question)))
}

function budgetLeft(deadline: number, screen: string): number {
  const left = deadline - Date.now()
  if (left > 0) return Math.min(left, DIALOG_WAIT_MS)

  throw new HarnessError(`the dialogs did not finish in time; the last screen:\n${screen}`)
}

function isTimeout(error: unknown): boolean {
  return error instanceof HarnessError && /^[^\n]*timed out after/.test(error.message)
}

// The screen once it stayed unchanged; null when it kept changing for the whole wait (a long step shows a spinner).
async function stable(pane: Pane, quietMs: number | undefined, timeoutMs: number): Promise<string | null> {
  try {
    return await idleTui(pane, quietMs, timeoutMs)
  } catch (error) {
    if (isTimeout(error)) return null
    throw error
  }
}

async function changes(pane: Pane, screen: string): Promise<boolean> {
  try {
    await waitTui(pane, current => current !== screen, STUCK_MS, 'the screen to change')
    return true
  } catch (error) {
    if (isTimeout(error)) return false
    throw error
  }
}

// Answers each dialog with the next script entry whose question is on screen, until `done` shows or, once every
// entry is used, the prompt is back and stays. A screen no entry answers fails with it once it stops changing.
export async function driveDialogs(
  pane: Pane,
  script: readonly DialogEntry[],
  done: Matcher,
  budgetMs: number = INIT_BUILD_MS,
): Promise<DialogLog> {
  const deadline = Date.now() + budgetMs
  const screens: string[] = []
  const asked: string[] = []
  let next = 0
  let last = ''
  for (;;) {
    const screen = await stable(pane, undefined, budgetLeft(deadline, last))
    if (screen === null) continue
    last = screen
    if (isDialogScreen(screen)) {
      const at = entryOn(screen, script, next)
      const entry = script[at]
      if (entry === undefined) {
        if (await changes(pane, screen)) continue
        throw new HarnessError(`no answer for the dialog on the screen:\n${screen}`)
      }
      screens.push(screen)
      asked.push(entry.question)
      if (entry.repeat !== true) next = at + 1
      await respond(pane, entry.answer)
      continue
    }
    if (matches(done, screen)) return { screens, asked, final: screen }
    if (!TUI_READY.test(screen)) continue
    if (next < script.length) {
      if (await changes(pane, screen)) continue
      throw new HarnessError(`the prompt is back with dialogs left to answer:\n${screen}`)
    }
    const quiet = await stable(pane, PROMPT_SETTLE_MS, budgetLeft(deadline, last))
    if (quiet !== null && TUI_READY.test(quiet)) return { screens, asked, final: quiet }
  }
}

export async function assertHaikuRoles(copy: LiveRepo): Promise<void> {
  const cadre = join(copy.repo, '.cadre')
  const entries = await readdir(cadre, { withFileTypes: true }).catch(() => null)
  if (entries === null) throw new HarnessError('assertHaikuRoles: the copy has no .cadre/ folder')
  let roles = 0
  for (const entry of entries.filter(item => item.isDirectory())) {
    const text = await readFile(join(cadre, entry.name, 'role.json'), 'utf8').catch(() => null)
    if (text === null) continue
    let value: unknown = null
    try {
      value = JSON.parse(text)
    } catch {
      throw new HarnessError(`assertHaikuRoles: .cadre/${entry.name}/role.json is not valid JSON`)
    }
    const model = isRecord(value) ? value.model : undefined
    const effort = isRecord(value) ? value.effort : undefined
    if (model !== HAIKU || effort !== MEDIUM) {
      throw new HarnessError(`assertHaikuRoles: the role ${entry.name} runs ${String(model)} at ${String(effort)}`)
    }
    roles += 1
  }
  if (roles === 0) throw new HarnessError('assertHaikuRoles: the copy has no .cadre/*/role.json')
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function inboxRootKeyOf(): Promise<(root: string, rootHash: string) => unknown> {
  const paths = await importSource('cadre/hooks/paths.ts')
  const value = isRecord(paths) ? paths.inboxRootKey : undefined
  if (typeof value !== 'function') throw new HarnessError('cadre seam changed: inboxRootKey')

  return (root, rootHash) => value(root, rootHash)
}

// An inbox home is keyed by the hash of the repo root, as given or as resolved.
export async function inboxDirOf(config: string, copy: LiveRepo, id: string): Promise<string> {
  const keyOf = await inboxRootKeyOf()
  const roots = [...new Set([copy.repo, await realpath(copy.repo)])]
  const tree = join(config, 'cadre', 'inboxes')
  for (const root of roots) {
    const key = keyOf(root, sha256Hex(root))
    if (typeof key !== 'string') throw new HarnessError('cadre seam changed: inboxRootKey')
    const dir = join(tree, key, id)
    if (existsSync(dir)) return dir
  }
  const present = await readdir(tree).catch((): string[] => [])

  throw new HarnessError(`no inbox folder for ${id}: the inbox tree holds ${present.join(', ') || 'no folders'}`)
}

async function commitAll(repo: string, env: ChildEnv): Promise<void> {
  for (const args of [['add', '-A'], ['commit', '-q', '-m', 'team']]) {
    const result = await run(['git', ...args], { cwd: repo, env, timeoutMs: GIT_MS })
    if (result.code !== 0) throw new HarnessError(`git ${args[0]} exited ${result.code}: ${result.stderr.trim()}`)
  }
}

// Builds a fixture by driving the real /cadre init in a TUI on a copy of `from`, then commits the team.
export async function buildByInit(ctx: BuildContext, from: string, script: readonly DialogEntry[]): Promise<void> {
  await copyTree(fixtureDir(from), ctx.repo)
  const copy: LiveRepo = { repo: ctx.repo, env: liveEnv() }
  const server = await startServer(socketName(), copy.env)
  try {
    const pane = await cadreTui(server, copy, '/cadre init')
    await driveDialogs(pane, script, APPLIED_REPLY)
    await sendText(pane, EXIT_COMMAND)
    await sendKeys(pane, 'Enter')
    await waitDead(pane)
  } finally {
    await killServer(server)
  }
  await assertHaikuRoles(copy)
  await commitAll(ctx.repo, await scratchEnv(join(ctx.dir, 'env')))
}
