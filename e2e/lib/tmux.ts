import { randomBytes } from 'node:crypto'
import { lstat, readdir, rm } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChildEnv } from './env.ts'
import { HarnessError } from './errors.ts'
import { pollUntil } from './poll.ts'
import { run } from './proc.ts'
import type { Env, RunResult } from './proc.ts'
import { RUN_ID_RE, scratchRoot } from './scratch.ts'
import { shellQuote } from './shims.ts'

export const WAIT_MS = 60_000
export const POLL_MS = 200
export const IDLE_MS = 1_500
export const PANE_COLUMNS = 200
export const PANE_ROWS = 50
export const HISTORY_LIMIT = 50_000

const ESCAPE_TIME_MS = 10
const TMUX_CALL_MS = 10_000
const SESSION = 'e2e'
const SOCKET_RE = /^[A-Za-z0-9_-]+$/
const RUN_PREFIX_RE = /^e2e-[0-9a-f]{4}-$/
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const OPTION_NAME_RE = /^[a-z][a-z0-9-]*$/
const PANE_ID_RE = /^%[0-9]+$/
const SENTINEL_RE = /__E2E_DONE__ ([0-9]+)/g
const NBSP_RE = /\u00a0/g
const STALE_SOCKET_RE = /no server running|error connecting/

export type Server = {
  readonly socket: string
  readonly env: ChildEnv
  readonly session: string
  readonly cwd: string
}

export type Pane = {
  readonly server: Server
  readonly id: string
}

export type Matcher = string | RegExp | ((screen: string) => boolean)

export type PaneState = {
  readonly dead: boolean
  readonly status: number | null
}

export type WindowInfo = {
  readonly name: string
  readonly pane: string
  readonly dead: boolean
  readonly cwd: string
}

export type CaptureOptions = {
  readonly history?: boolean
}

export type SweepOptions = {
  readonly env: ChildEnv
  readonly cwd: string
  readonly host?: boolean
}

type Client = {
  readonly socket: string
  readonly env: ChildEnv
  readonly cwd: string
  readonly host?: boolean
}

export function runSocketPrefix(run: string): string {
  if (!RUN_ID_RE.test(run)) throw new HarnessError(`not a run id: ${run}`)

  return `e2e-${run.slice(-4)}-`
}

export function socketName(env: Env = process.env): string {
  return `${runSocketPrefix(basename(scratchRoot(env)))}${randomBytes(3).toString('hex')}`
}

function socketDir(): string {
  const uid = process.getuid?.()
  if (uid === undefined) throw new HarnessError('tmux sockets need a POSIX user id')

  return join('/tmp', `tmux-${uid}`)
}

async function tmuxRun(client: Client, args: readonly string[]): Promise<RunResult> {
  const argv = ['tmux', '-L', client.socket, '-f', '/dev/null', '-u', ...args]

  return run(argv, { cwd: client.cwd, env: client.env, timeoutMs: TMUX_CALL_MS, host: client.host ?? false })
}

async function tmux(client: Client, args: readonly string[]): Promise<string> {
  const result = await tmuxRun(client, args)
  if (result.code === 0) return result.stdout

  throw new HarnessError(`tmux ${args[0] ?? ''} exited ${result.code}: ${result.stderr.trim()}`)
}

export async function startServer(socket: string, env: ChildEnv): Promise<Server> {
  if (!SOCKET_RE.test(socket)) throw new HarnessError(`not a tmux socket name: ${socket}`)
  const server = { socket, env, session: SESSION, cwd: scratchRoot() }
  // The options go before new-session so the first pane already has them (history-limit applies to new panes only).
  await tmux(server, [
    'start-server', ';',
    'set-option', '-g', 'history-limit', String(HISTORY_LIMIT), ';',
    'set-option', '-g', 'status', 'off', ';',
    'set-option', '-g', 'remain-on-exit', 'on', ';',
    'set-option', '-g', 'escape-time', String(ESCAPE_TIME_MS), ';',
    'new-session', '-d', '-s', SESSION, '-x', String(PANE_COLUMNS), '-y', String(PANE_ROWS), '-c', server.cwd,
    '/bin/sh', '-i',
  ])

  return server
}

function paneOf(server: Server, output: string): Pane {
  const id = output.trim()
  if (!PANE_ID_RE.test(id)) throw new HarnessError(`tmux gave no pane id: ${id}`)

  return { server, id }
}

// tmux expands formats in a start folder (`#P` is a pane index), so each `#` of the path is doubled to keep it literal.
function literalFolder(cwd: string): string {
  return cwd.replaceAll('#', '##')
}

export async function newWindow(server: Server, name: string, cwd: string, argv: readonly string[]): Promise<Pane> {
  if (argv.length === 0) throw new HarnessError('newWindow needs a command')
  if (!isAbsolute(cwd)) throw new HarnessError('newWindow needs an absolute folder')
  // tmux runs a lone argument through the default shell, which can read the user's rc files; sh -c execs it as is.
  const command = argv.length === 1 ? ['/bin/sh', '-c', 'exec "$0"', ...argv] : argv
  const target = `${server.session}:`
  const folder = literalFolder(cwd)
  const args = ['new-window', '-d', '-P', '-F', '#{pane_id}', '-n', name, '-c', folder, '-t', target, '--', ...command]

  return paneOf(server, await tmux(server, args))
}

export async function sendText(pane: Pane, text: string): Promise<void> {
  await tmux(pane.server, ['send-keys', '-t', pane.id, '-l', '--', text])
}

export async function sendKeys(pane: Pane, ...keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return

  await tmux(pane.server, ['send-keys', '-t', pane.id, ...keys])
}

export function normaliseScreen(raw: string): string {
  const lines = raw.replace(NBSP_RE, ' ').split('\n').map(line => line.trimEnd())
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  return lines.join('\n')
}

export async function capture(pane: Pane, opts: CaptureOptions = {}): Promise<string> {
  const range = opts.history === true ? ['-S', '-'] : []

  return normaliseScreen(await tmux(pane.server, ['capture-pane', '-p', '-J', ...range, '-t', pane.id]))
}

export async function paneState(pane: Pane): Promise<PaneState> {
  const out = await tmux(pane.server, ['display-message', '-p', '-t', pane.id, '#{pane_dead} #{pane_dead_status}'])
  const [dead = '', status = ''] = out.trim().split(' ')
  const code = Number(status)

  return { dead: dead === '1', status: status !== '' && Number.isInteger(code) ? code : null }
}

export function matches(matcher: Matcher, screen: string): boolean {
  if (typeof matcher === 'string') return screen.includes(matcher)
  if (matcher instanceof RegExp) return new RegExp(matcher.source, matcher.flags.replace('g', '')).test(screen)

  return matcher(screen)
}

function labelOf(matcher: Matcher): string {
  if (typeof matcher === 'string') return JSON.stringify(matcher)
  if (matcher instanceof RegExp) return String(matcher)

  return 'a screen condition'
}

async function deadNote(pane: Pane, error: unknown): Promise<never> {
  const state = await paneState(pane).catch(() => null)
  if (!(error instanceof HarnessError) || !state?.dead) throw error

  throw new HarnessError(`${error.message}\n(the pane is dead, exit status ${state.status ?? 'unknown'})`)
}

async function isPaneDead(pane: Pane): Promise<boolean> {
  return (await paneState(pane)).dead
}

export async function waitFor(
  pane: Pane,
  matcher: Matcher,
  timeoutMs: number = WAIT_MS,
  label: string = labelOf(matcher),
  captureOpts: CaptureOptions = {},
): Promise<string> {
  const opts = { timeoutMs, intervalMs: POLL_MS, now: Date.now, sleep: delay, isDead: () => isPaneDead(pane), label }
  try {
    return await pollUntil(() => capture(pane, captureOpts), screen => matches(matcher, screen), opts)
  } catch (error) {
    return deadNote(pane, error)
  }
}

export async function waitSteady(
  pane: Pane,
  view: (screen: string) => string,
  label: string,
  quietMs: number = IDLE_MS,
  timeoutMs: number = WAIT_MS,
): Promise<string> {
  let previous: string | null = null
  let stableSince = 0
  const isQuiet = (screen: string): boolean => {
    const now = Date.now()
    const shown = view(screen)
    if (shown !== previous) {
      previous = shown
      stableSince = now
      return false
    }
    return now - stableSince >= quietMs
  }
  const opts = { timeoutMs, intervalMs: POLL_MS, now: Date.now, sleep: delay, isDead: () => isPaneDead(pane), label }
  try {
    return await pollUntil(() => capture(pane), isQuiet, opts)
  } catch (error) {
    return deadNote(pane, error)
  }
}

export async function waitIdle(pane: Pane, quietMs: number = IDLE_MS, timeoutMs: number = WAIT_MS): Promise<string> {
  return waitSteady(pane, screen => screen, `the screen to stay unchanged for ${quietMs} ms`, quietMs, timeoutMs)
}

export async function waitDead(pane: Pane, timeoutMs: number = WAIT_MS): Promise<number | null> {
  const opts = { timeoutMs, intervalMs: POLL_MS, now: Date.now, sleep: delay, label: 'the pane to exit' }
  const state = await pollUntil(() => paneState(pane), item => item.dead, opts)

  return state.status
}

export async function listWindows(server: Server): Promise<readonly WindowInfo[]> {
  const format = '#{window_name}\t#{pane_id}\t#{pane_dead}\t#{pane_current_path}'
  const out = await tmux(server, ['list-windows', '-t', `${server.session}:`, '-F', format])

  return out.split('\n').filter(line => line.length > 0).map(line => {
    const [name = '', pane = '', dead = '', cwd = ''] = line.split('\t')
    return { name, pane, dead: dead === '1', cwd }
  })
}

export async function paneCwd(pane: Pane): Promise<string> {
  return (await tmux(pane.server, ['display-message', '-p', '-t', pane.id, '#{pane_current_path}'])).trim()
}

// The command the pane was started with, as tmux prints it: each argv item, quoted when it needs it.
export async function paneCommand(pane: Pane): Promise<string> {
  return (await tmux(pane.server, ['display-message', '-p', '-t', pane.id, '#{pane_start_command}'])).trim()
}

export async function setEnv(server: Server, name: string, value: string): Promise<void> {
  if (!ENV_NAME_RE.test(name)) throw new HarnessError(`not an env name: ${name}`)

  await tmux(server, ['set-environment', '-t', server.session, name, value])
}

export async function setOption(server: Server, name: string, value: string): Promise<void> {
  if (!OPTION_NAME_RE.test(name)) throw new HarnessError(`not a tmux option name: ${name}`)

  await tmux(server, ['set-option', '-g', name, value])
}

async function removeSocket(name: string): Promise<void> {
  const path = join(socketDir(), name)
  const stats = await lstat(path).catch(() => null)
  if (!stats) return
  if (!stats.isSocket()) throw new HarnessError(`refusing to remove ${name}: not a tmux socket`)

  await rm(path)
}

// kill-server leaves the socket file behind, so the file is removed once no server answers on it.
async function killSocket(client: Client): Promise<void> {
  const result = await tmuxRun(client, ['kill-server'])
  if (result.code !== 0 && !STALE_SOCKET_RE.test(result.stderr)) {
    throw new HarnessError(`tmux kill-server exited ${result.code}: ${result.stderr.trim()}`)
  }

  await removeSocket(client.socket)
}

export async function killServer(server: Server): Promise<void> {
  await killSocket(server)
}

export async function sweepServers(prefix: string, opts: SweepOptions): Promise<readonly string[]> {
  if (!RUN_PREFIX_RE.test(prefix)) throw new HarnessError(`not a run socket prefix: ${prefix}`)
  const names = (await readdir(socketDir()).catch(() => [])).filter(name => name.startsWith(prefix)).sort()
  const failures: string[] = []
  for (const name of names.filter(item => SOCKET_RE.test(item))) {
    const client = { socket: name, env: opts.env, cwd: opts.cwd, host: opts.host ?? false }
    await killSocket(client).catch((error: unknown) => {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  if (failures.length > 0) throw new HarnessError(`tmux servers not swept: ${failures.join('; ')}`)

  return names
}

function sentinels(text: string): readonly number[] {
  return [...text.matchAll(SENTINEL_RE)].map(match => Number(match[1]))
}

export async function runInPane(pane: Pane, argv: readonly string[], timeoutMs: number = WAIT_MS): Promise<number> {
  if (argv.length === 0) throw new HarnessError('runInPane needs a command')
  const before = sentinels(await capture(pane, { history: true })).length
  await sendText(pane, `${argv.map(shellQuote).join(' ')}; printf '__E2E_%s__ %s\\n' DONE "$?"`)
  await sendKeys(pane, 'Enter')
  const label = `${argv[0]} to finish in the pane`
  const opts = { timeoutMs, intervalMs: POLL_MS, now: Date.now, sleep: delay, isDead: () => isPaneDead(pane), label }
  const done = await pollUntil(() => capture(pane, { history: true }), text => sentinels(text).length > before, opts)
  const code = sentinels(done)[before]
  if (code === undefined) throw new HarnessError(`${label}: no exit code`)

  return code
}
