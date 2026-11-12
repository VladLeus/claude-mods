import { createHash } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { access, lstat, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  answer,
  answerOther,
  configDir,
  dismiss,
  idleTui,
  isAppDialog,
  isDialogScreen,
  printMode,
  startTuiUntil,
  TUI_READY,
  waitTui,
} from '../../lib/claude.ts'
import { liveEnv, scratchEnv, SYSTEM_PATH } from '../../lib/env.ts'
import type { ChildEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { copyTree, fixtureDir } from '../../lib/fixture.ts'
import type { BuildContext } from '../../lib/fixture.ts'
import { pollUntil } from '../../lib/poll.ts'
import { run } from '../../lib/proc.ts'
import type { RunResult } from '../../lib/proc.ts'
import type { RowContext } from '../../lib/row.ts'
import { removeTree, scratchRoot } from '../../lib/scratch.ts'
import { shellQuote } from '../../lib/shims.ts'
import { importSource } from '../../lib/source.ts'
import { killServer, matches, sendKeys, sendText, socketName, startServer, waitDead, WAIT_MS } from '../../lib/tmux.ts'
import type { Matcher, Pane, Server } from '../../lib/tmux.ts'
import type { DialogAnswer, DialogEntry } from '../fixtures/answers.ts'

export const INIT_BUILD_MS = 900_000

const DIALOG_WAIT_MS = 2 * WAIT_MS
const PROBE_MS = 300_000
const PROMPT_SETTLE_MS = 5_000
const STUCK_MS = 8_000
const GIT_MS = 30_000
const EXIT_COMMAND = '/exit'
const WHITESPACE_RE = /\s+/g
const HEADER_RE = /^ *☐ /gm
const HAIKU = 'haiku'
const MEDIUM = 'medium'
const REPLY_PREFIX = 'cadre: '
const CLIPBOARD_MS = 10_000
const CLIPBOARD_LANG = 'en_US.UTF-8'
const SESSION_START = 'SessionStart'
const STATUS_POLL_MS = 3_000
const TRANSCRIPT_POLL_MS = 1_000
const ROLE_NAME_POLL_MS = 1_000
const ROLE_NAME_WAIT_MS = 480_000
const HANDOFF_ROOT = 'thoughts/shared/handoffs'
const TITLE_ROW_START = '{"type":"custom-title"'
const LONG_FOLDER_NAME_CHARS = 200
const NON_ALPHANUMERIC_RE = /[^A-Za-z0-9]/g
const FALLBACK_SHELLS: readonly string[] = ['/bin/tcsh', '/bin/csh']

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

// Print mode shows a slash command's reply behind the command's name.
export function replyOf(result: RunResult): string {
  const text = result.stdout.startsWith(REPLY_PREFIX) ? result.stdout.slice(REPLY_PREFIX.length) : result.stdout

  return text.trimEnd()
}

export function firstLineOf(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

// The launcher command a start reply prints: the line that is the launcher's path, bare or in single quotes.
export function printedCommand(reply: string, id: string): string | null {
  const path = `/.cadre/bin/${id}`
  const isCommand = (line: string): boolean =>
    (line.startsWith('/') && line.endsWith(path)) || (line.startsWith(`'/`) && line.endsWith(`${path}'`))

  return reply.split('\n').map(line => line.trim()).find(isCommand) ?? null
}

export function noteReply(ctx: RowContext, label: string, result: RunResult): void {
  ctx.evidence(`${label}, stdout`, result.stdout)
  ctx.evidence(`${label}, stderr and exit code`, `exit ${result.code}\n${result.stderr}`)
}

// The text clipboard, read with a UTF-8 locale so a non-ASCII path comes back as it was copied.
export async function pastedText(): Promise<string> {
  const env = { PATH: SYSTEM_PATH, HOME: join(scratchRoot(), 'home'), LANG: CLIPBOARD_LANG }
  const result = await run(['/usr/bin/pbpaste'], { cwd: scratchRoot(), env, timeoutMs: CLIPBOARD_MS })
  if (result.code !== 0) throw new HarnessError(`pbpaste exited ${result.code}: ${result.stderr.trim()}`)

  return result.stdout
}

async function isExecutableFile(path: string): Promise<boolean> {
  const stats = await stat(path).catch(() => null)
  if (!stats?.isFile()) return false

  return access(path, constants.X_OK).then(() => true, () => false)
}

// The absolute path of a tool in the system folders, which a shim execs so it never hands a call on to itself.
export async function systemTool(name: string): Promise<string> {
  for (const dir of SYSTEM_PATH.split(':')) {
    const path = join(dir, name)
    if (await isExecutableFile(path)) return path
  }

  throw new HarnessError(`no ${name} in ${SYSTEM_PATH}`)
}

// A tmux default-shell that is not POSIX: fish from the system folders, else tcsh, else csh; null when none is there.
export async function nonPosixShell(): Promise<string | null> {
  const fish = await systemTool('fish').catch(() => null)
  if (fish !== null) return fish
  for (const path of FALLBACK_SHELLS) {
    if (await isExecutableFile(path)) return path
  }

  return null
}

// The launcher with --probe, run from the git root in the live env so its claude calls pass the claude fence.
export async function runProbe(copy: LiveRepo, id: string, env: ChildEnv = copy.env): Promise<RunResult> {
  return run([join(copy.repo, '.cadre', 'bin', id), '--probe'], { cwd: copy.repo, env, timeoutMs: PROBE_MS })
}

// A project hook that appends one `SessionStart` line to `logFile` each time a session of the repo starts.
export async function writeSessionStartHook(repo: string, logFile: string): Promise<void> {
  const command = `/bin/sh -c ${shellQuote(`echo ${SESSION_START} >> ${shellQuote(logFile)}`)}`
  const settings = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command }] }] } }
  await mkdir(join(repo, '.claude'), { recursive: true })
  await writeFile(join(repo, '.claude', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`)
}

// How many times the hook of writeSessionStartHook ran.
export async function sessionStartRuns(logFile: string): Promise<number> {
  const text = await readFile(logFile, 'utf8').catch(() => '')

  return text.split('\n').filter(line => line === SESSION_START).length
}

// The text after `<label>: ` on the first line of a reply that starts with it.
export function statusLine(reply: string, label: string): string | null {
  const prefix = `${label}: `
  const line = reply.split('\n').find(item => item.startsWith(prefix))

  return line === undefined ? null : line.slice(prefix.length)
}

// `/cadre status <id>` until `until` holds for its reply, else the last result once `timeoutMs` has passed. Each call
// is a print-mode run that makes no model turn.
export async function statusUntil(
  copy: LiveRepo,
  id: string,
  until: (reply: string) => boolean,
  timeoutMs: number,
): Promise<RunResult> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await cadrePrint(copy, `status ${id}`)
    if (until(replyOf(result)) || Date.now() >= deadline) return result
    await delay(STATUS_POLL_MS)
  }
}

// A handoff file where autopilot keeps them: `<folder>/thoughts/shared/handoffs/<id>/<name>`.
export async function writeHandoff(folder: string, id: string, name: string): Promise<string> {
  const dir = join(folder, HANDOFF_ROOT, id)
  await mkdir(dir, { recursive: true })
  const path = join(dir, name)
  await writeFile(path, `# Handoff ${name}\n`)

  return path
}

function hasTitleRow(text: string, title: string): boolean {
  return text.split('\n').some(line => {
    if (!line.startsWith(TITLE_ROW_START)) return false
    try {
      const row: unknown = JSON.parse(line)

      return isRecord(row) && row.customTitle === title
    } catch {
      return false
    }
  })
}

function folderNameOf(path: string): string {
  return path.replace(NON_ALPHANUMERIC_RE, '-')
}

async function hasTitledTranscript(folder: string, title: string): Promise<boolean> {
  const files = (await readdir(folder).catch((): string[] => [])).filter(name => name.endsWith('.jsonl'))
  for (const file of files) {
    if (hasTitleRow(await readFile(join(folder, file), 'utf8').catch(() => ''), title)) return true
  }

  return false
}

// The engine gives a session whose name a live session of the same config dir already has a random suffix (`cadre-be`
// becomes `cadre-be-swirling-gray`), and status finds a role session by its exact name. Rows that start a role session
// therefore take turns per role id: the lock is a folder of the run's scratch root, released when the row ends, after
// the cleanups registered later (the tmux server with the session) have run.
export async function holdRoleName(ctx: RowContext, id: string): Promise<void> {
  const lock = join(scratchRoot(), 'role-names', id)
  await mkdir(dirname(lock), { recursive: true })
  const deadline = Date.now() + ROLE_NAME_WAIT_MS
  for (;;) {
    try {
      await mkdir(lock)
      break
    } catch (error) {
      if (!isRecord(error) || error.code !== 'EEXIST') throw error
    }
    if (Date.now() >= deadline) {
      throw new HarnessError(`another row kept the role name cadre-${id} for ${ROLE_NAME_WAIT_MS} ms`)
    }
    await delay(ROLE_NAME_POLL_MS)
  }
  ctx.after(() => removeTree(lock, scratchRoot()))
}

// The folder of the e2e dir's projects/ that holds a transcript of the role session started in `startFolder`, once one
// carries the title `cadre-<id>`; null when none does within `timeoutMs`. The engine shortens a folder name over 200
// characters but keeps its start, so such a name is matched by the encoded `row` scratch folder, unique to the row.
export async function waitForRoleTranscript(
  startFolder: string,
  id: string,
  row: string,
  timeoutMs: number,
): Promise<string | null> {
  const projects = join(configDir(), 'projects')
  const name = folderNameOf(await realpath(startFolder))
  const rowName = folderNameOf(await realpath(row))
  const isStartFolder = (folder: string): boolean => {
    if (name.length <= LONG_FOLDER_NAME_CHARS) return folder === name

    return folder.startsWith(rowName)
  }
  const find = async (): Promise<string | null> => {
    for (const folder of (await readdir(projects).catch((): string[] => [])).filter(isStartFolder)) {
      if (await hasTitledTranscript(join(projects, folder), `cadre-${id}`)) return folder
    }

    return null
  }
  const label = `the transcript of cadre-${id}`
  const opts = { timeoutMs, intervalMs: TRANSCRIPT_POLL_MS, now: Date.now, sleep: delay, label }
  try {
    return await pollUntil(find, folder => folder !== null, opts)
  } catch (error) {
    if (error instanceof HarnessError) return null
    throw error
  }
}

// The line of a GSD identity module that proves an install, and a `config-set <dotted.key> <value>` on
// ./.planning/config.json: the one command cadre runs through a proven user-level GSD.
const GSD_STUB_IDENTITY = 'const packageName = "@opengsd/gsd-core";\nmodule.exports = { packageName };\n'
const GSD_STUB_TOOLS = String.raw`'use strict'
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const [command, key, value] = process.argv.slice(2)
const fail = message => {
  process.stderr.write('gsd-tools stub: ' + message + '\n')
  process.exit(2)
}
if (command !== 'config-set' || !key || value === undefined) fail('only config-set <key> <value> is supported')
const parts = key.split('.')
if (parts.some(part => part === '' || part === '__proto__' || part === 'constructor' || part === 'prototype')) {
  fail('not a plain key: ' + key)
}
const file = join(process.cwd(), '.planning', 'config.json')
let config = null
try {
  config = JSON.parse(readFileSync(file, 'utf8'))
} catch {
  fail('.planning/config.json is not readable JSON')
}
if (config === null || typeof config !== 'object' || Array.isArray(config)) {
  fail('.planning/config.json is not an object')
}
let parsed = value
try {
  parsed = JSON.parse(value)
} catch {
  parsed = value
}
let target = config
for (const part of parts.slice(0, -1)) {
  const next = target[part]
  if (next === null || typeof next !== 'object' || Array.isArray(next)) target[part] = {}
  target = target[part]
}
target[parts[parts.length - 1]] = parsed
writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
`
const GSD_STUB_DIR = 'gsd-core'
const GSD_STUB_FILES: readonly (readonly [string, string])[] = [
  ['VERSION', '0.0.0-e2e-stub\n'],
  ['bin/lib/package-identity.cjs', GSD_STUB_IDENTITY],
  ['bin/gsd-tools.cjs', GSD_STUB_TOOLS],
]

async function removeStubGsd(dir: string): Promise<void> {
  const stats = await lstat(dir).catch(() => null)
  if (stats === null) return
  if (!stats.isDirectory()) throw new HarnessError(`refusing to remove ${GSD_STUB_DIR}: it is not a folder`)

  await rm(dir, { recursive: true, force: true })
}

// A minimal user-level GSD in the e2e dir, enough for cadre to prove it and run an accepted config hunk through it.
// The folder is created, never replaced, and removed when the row ends; run it only in an exclusive window.
export async function stageStubGsd(ctx: RowContext): Promise<string> {
  const base = configDir()
  if (!isAbsolute(base)) throw new HarnessError('stageStubGsd: the e2e config dir is not an absolute path')
  const dir = join(base, GSD_STUB_DIR)
  try {
    await mkdir(dir)
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined
    const reason = code === 'EEXIST' ? 'it is already there and not replaced' : `error ${String(code)}`
    throw new HarnessError(`could not stage ${GSD_STUB_DIR} in the e2e config dir: ${reason}`)
  }
  ctx.after(() => removeStubGsd(dir))
  for (const [name, text] of GSD_STUB_FILES) {
    await mkdir(dirname(join(dir, name)), { recursive: true })
    await writeFile(join(dir, name), text)
  }

  return dir
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
