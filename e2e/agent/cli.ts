import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { cadrePrint, firstLineOf, inboxDirOf, printedCommand, replyOf, runProbe } from '../cadre/lib/session.ts'
import { agentSidecar, filterLines, HISTORY_LINES_DEFAULT, HISTORY_LINES_MAX, parseCommand } from '../lib/agent.ts'
import { parseGuardSnapshot, parseRunState, parseWsState, RESULT_MAX_BYTES, ROOT_ROLE } from '../lib/agent.ts'
import { afterEcho, tokenHash, tokenRefusal, windowNameFor, withLastSent, withWindow, wsIdOf } from '../lib/agent.ts'
import { answerRefusal, claimRefusal, claimsTaken, keysRefusal, SAFE_KEYS, sendRefusal } from '../lib/agent.ts'
import { cadreRefusal, exclusiveRefusal, GIT_READS, isWsId, runRefusal, seedRefusal } from '../lib/agent.ts'
import { WAIT_MAX_S, WAIT_TIMEOUT_DEFAULT_S } from '../lib/agent.ts'
import type { AgentCommand, Location, RunState, WsState } from '../lib/agent.ts'
import { e2eConfigDir, e2eConfigPath, writeFilterFile } from '../lib/auth.ts'
import { answer, answerOther, authPreflight, idleTui, isDialogScreen, passTrust, startTui } from '../lib/claude.ts'
import { submitTui } from '../lib/claude.ts'
import type { PreflightStage } from '../lib/claude.ts'
import { otherEntryChanges, restoreState, snapshotState } from '../lib/config-state.ts'
import { hostUser, liveEnv, SYSTEM_PATH, writeClaudeFence } from '../lib/env.ts'
import type { ChildEnv } from '../lib/env.ts'
import { HarnessError, LeakError } from '../lib/errors.ts'
import { filterContext, isRecord } from '../lib/filter.ts'
import type { FilterContext } from '../lib/filter.ts'
import { copyTree, fixtureDir } from '../lib/fixture.ts'
import { guardSnapshot, needlesOf } from '../lib/guard.ts'
import type { GuardResult } from '../lib/guard.ts'
import { checkGuard, claudeVersion, cleanupSessions, e2eDirReason, guardItems, isGlobalAway } from '../lib/live.ts'
import { keychainState, releaseLock, removeLeftovers, resolveOnPath, takeLock } from '../lib/live.ts'
import type { LiveScope } from '../lib/live.ts'
import { pollUntil } from '../lib/poll.ts'
import { run as runProcess } from '../lib/proc.ts'
import type { RunResult } from '../lib/proc.ts'
import { isUnder, makeRunRoot, PRUNE_AGE_MS, removeTree, RUN_ID_RE, scratchBase, scratchRoot } from '../lib/scratch.ts'
import { parseSidecar, rowFileName, SIDECAR_SCHEMA, summaryText, writeRowResult, writeSummary } from '../lib/summary.ts'
import type { Note, Sidecar, SuiteVersion } from '../lib/summary.ts'
import { capture, killServer, listWindows, newWindow, runSocketPrefix, socketName, startServer } from '../lib/tmux.ts'
import { matches, paneState, sendKeys, sweepServers, waitDead, waitFor } from '../lib/tmux.ts'
import type { Pane, Server, WindowInfo } from '../lib/tmux.ts'
import { SEEDS } from './seeds.ts'

const CLI_PATH = fileURLToPath(import.meta.url)
const REPO_DIR = dirname(dirname(dirname(CLI_PATH)))
const RESULTS_DIR = join(REPO_DIR, 'e2e', 'results')
const MIN_NODE_MAJOR = 24
const BASELINE_PLUGINS = ['cadre', 'autopilot', 'agent-fleet'] as const
const POINTER_FILE = 'agent-run.json'
const TMUX_SESSION = 'e2e'
const TOKEN_BYTES = 32
const HOLDER_WAIT_MS = 10_000
const LOCK_WAIT_MS = 10_000
const WAIT_TICK_MS = 200
const HOLD_TICK_MS = 60_000
const CLAIM_RETRY_MS = 5_000
const STOP_EXIT_MS = 30_000
const STOP_KILL_MS = 10_000
const SCREEN_LINES = 60
const REFUSED = 2
const FAILED = 1
const GUARD_FAILED = 3
const NOT_FINISHED = 'not finished: the agent did not call finish'
const NO_ECHO_LINE = 'no echo of the last sent text on the screen: matched against every line'
const CLAIMS_LOCK = 'claims.lock'
const EXCLUSIVE_DIR = 'exclusive'
const EXCLUSIVE_HOLDER_FILE = 'ws'
const UNKNOWN_HOLDER = 'unknown'
// Sessions that die with their tmux server can still write the e2e dir for a moment.
const EXCLUSIVE_SETTLE_MS = 5_000
const RUN_MS = 60_000
const READ_MAX_BYTES = 200_000
const PROJECTS_DIR = 'projects'
const NON_ALPHANUMERIC_RE = /[^A-Za-z0-9]/g

type Command<V extends AgentCommand['verb']> = Extract<AgentCommand, { readonly verb: V }>

type WsCommand = Exclude<AgentCommand, Command<'begin' | 'hold' | 'end' | 'fixture' | 'help'>>

type WsWindow = WsState['windows'][number]

type Target = {
  readonly pane: Pane
  readonly kind: WsWindow['kind']
}

type Holder = {
  readonly pid: number
  readonly ok: boolean
}

type BeginSetup = {
  readonly run: string
  readonly root: string
  readonly fixtures: string
  readonly claudeBin: string
  readonly scope: LiveScope
  readonly token: string
  readonly holderPid: number
}

type Restore =
  | { readonly ok: true; readonly changes: readonly string[] }
  | { readonly ok: false; readonly reason: string }

type WindowRestore = {
  readonly ok: boolean
  readonly lines: readonly string[]
}

type LocationBase = {
  readonly root: string
  readonly rest: string
}

let identities: readonly string[] = []
let uuids = new Map<string, number>()

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function outputContext(): FilterContext {
  const ctx = filterContext({ ...process.env, E2E_SCRATCH: scratchBase() }, { identities })

  return { ...ctx, uuids }
}

function say(text: string, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${filterLines(text, outputContext())}\n`)
}

function refuse(message: string): number {
  say(`agent: ${message}`, process.stderr)

  return REFUSED
}

function fail(message: string): number {
  say(`agent: ${message}`, process.stderr)

  return FAILED
}

async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8').catch(() => null)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Written through a rename, so a parallel CLI call never reads a half-written state file.
async function writeJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, path)
}

function pointerPath(): string {
  return join(scratchBase(), POINTER_FILE)
}

function agentDir(root: string): string {
  return join(root, 'agent')
}

function runFile(root: string): string {
  return join(agentDir(root), 'run.json')
}

function wsDir(root: string, id: string): string {
  return join(root, 'ws', id)
}

function wsFile(root: string, id: string): string {
  return join(wsDir(root, id), 'state.json')
}

function resultsDirOf(run: string): string {
  return join(RESULTS_DIR, run)
}

function exclusiveDir(root: string): string {
  return join(agentDir(root), EXCLUSIVE_DIR)
}

function snapshotDir(root: string, id: string): string {
  return join(agentDir(root), 'state', id)
}

function repoOf(run: RunState, ws: WsState): string {
  return join(wsDir(run.root, ws.id), 'repo')
}

function copyOf(run: RunState, ws: WsState, wt: string | null): string | null {
  if (wt === null) return repoOf(run, ws)
  const tree = join(repoOf(run, ws), '.claude', 'worktrees', wt)

  return existsSync(tree) ? tree : null
}

function launcherOf(copy: string, role: string): string {
  return join(copy, '.cadre', 'bin', role)
}

function makeRunId(now: number, hex: string): string {
  const at = new Date(now)
  const two = (value: number): string => String(value).padStart(2, '0')
  const date = `${two(at.getUTCFullYear() % 100)}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}`
  const time = `${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}`

  return `${date}-${time}-${hex}`
}

function preflightLines(stage: PreflightStage, reason: string): readonly string[] {
  if (stage === 'plugins') return [`e2e dir plugin baseline failed: ${reason}`]

  return [reason, `log in again: CLAUDE_CONFIG_DIR=${e2eConfigPath()} claude auth login`]
}

function scopeOf(e2eDir: string): LiveScope {
  return { host: hostUser(), e2eDir, needles: needlesOf(scratchBase(), e2eDir) }
}

function lastLines(text: string, count: number): string {
  return text.split('\n').slice(-count).join('\n')
}

function useRun(state: RunState): void {
  process.env.E2E_SCRATCH = state.root
  process.env.E2E_FIXTURES = join(state.fixtures, 'fixtures')
  process.env.E2E_CONFIG_DIR = state.e2eDir
  process.env.E2E_CLAUDE_BIN = state.claudeBin
  process.env.E2E_FILTER_FILE = state.filterFile
  process.env.E2E_RUN = state.run
  process.env.E2E_TIER = 'live'
}

async function activeRun(): Promise<string | null> {
  const value = await readJson(pointerPath())
  if (!isRecord(value) || typeof value.run !== 'string' || !RUN_ID_RE.test(value.run)) return null

  return value.run
}

async function loadRun(): Promise<RunState | string> {
  const run = await activeRun()
  if (run === null) return 'no agent run: run begin first'
  const state = parseRunState(await readJson(runFile(join(scratchBase(), run))))
  if (!state || state.run !== run) return `the agent run ${run} has no readable state`
  useRun(state)

  return state
}

async function loadLiveWs(run: RunState, id: string): Promise<WsState | string> {
  const ws = parseWsState(await readJson(wsFile(run.root, id)))
  if (!ws || ws.id !== id) return `no workspace ${id} in this agent run`
  if (ws.status !== 'live') return `the workspace ${id} is finished`
  uuids = new Map(ws.uuids)

  return ws
}

async function saveWs(run: RunState, ws: WsState): Promise<void> {
  await writeJson(wsFile(run.root, ws.id), ws)
}

async function saveUuids(run: RunState, id: string): Promise<void> {
  const current = parseWsState(await readJson(wsFile(run.root, id)))
  if (!current) return

  await saveWs(run, { ...current, uuids: [...uuids.entries()] })
}

async function workspaces(run: RunState): Promise<readonly WsState[]> {
  const names = await readdir(join(run.root, 'ws')).catch(() => [])
  const states = await Promise.all(names.map(async name => parseWsState(await readJson(wsFile(run.root, name)))))

  return states.filter(state => state !== null)
}

function serverOf(ws: WsState): Server {
  return { socket: ws.socket, env: liveEnv(), session: TMUX_SESSION, cwd: scratchRoot() }
}

async function isServerUp(server: Server): Promise<boolean> {
  return listWindows(server).then(() => true, () => false)
}

async function windowOf(server: Server, window: string): Promise<WindowInfo | null> {
  return (await listWindows(server).catch(() => [])).find(item => item.name === window) ?? null
}

async function paneOf(server: Server, window: string): Promise<Pane | null> {
  const found = await windowOf(server, window)

  return found ? { server, id: found.pane } : null
}

// The server's first window is a plain shell, so input goes only to a window this workspace started or trusted.
async function inputTarget(ws: WsState, window: string): Promise<Target | string> {
  const recorded = ws.windows.find(item => item.name === window)
  if (!recorded) return `${window} is not a window this workspace started or trusted: run windows, then trust it`
  const pane = await paneOf(serverOf(ws), window)
  if (!pane) return `no window ${window} in ${ws.id}`

  return { pane, kind: recorded.kind }
}

function stopHolder(pid: number | undefined): void {
  if (pid === undefined) return
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ESRCH') throw error
  }
}

function spawnHolder(run: string, root: string, token: string): number | undefined {
  const env = { ...process.env, E2E_AGENT_TOKEN: token }
  const child = spawn(process.execPath, [CLI_PATH, 'hold', run], { cwd: root, env, detached: true, stdio: 'ignore' })
  // A holder that cannot start writes no holder.json, so begin refuses once the wait runs out.
  child.on('error', () => {})
  child.unref()

  return child.pid
}

function holderOf(value: unknown): Holder | null {
  if (!isRecord(value) || typeof value.pid !== 'number' || typeof value.ok !== 'boolean') return null

  return { pid: value.pid, ok: value.ok }
}

async function waitHolder(root: string): Promise<Holder | null> {
  const opts = { timeoutMs: HOLDER_WAIT_MS, intervalMs: WAIT_TICK_MS, now: Date.now, sleep: delay, label: 'the holder' }
  const read = async (): Promise<Holder | null> => holderOf(await readJson(join(agentDir(root), 'holder.json')))

  return pollUntil(read, holder => holder !== null, opts).catch(() => null)
}

async function waitLockGone(lock: string): Promise<boolean> {
  const opts = { timeoutMs: LOCK_WAIT_MS, intervalMs: WAIT_TICK_MS, now: Date.now, sleep: delay, label: 'the lock' }

  return pollUntil(async () => existsSync(lock), held => !held, opts).then(() => true, () => false)
}

async function stayAlive(ms: number): Promise<void> {
  const until = Date.now() + ms
  await new Promise<void>(resolve => {
    const timer = setInterval(() => {
      if (Date.now() < until) return
      clearInterval(timer)
      resolve()
    }, HOLD_TICK_MS)
    process.once('SIGTERM', () => {
      clearInterval(timer)
      resolve()
    })
  })
}

function helpText(): string {
  return `fixture <variant> --row <row> [--exclusive]: copy a built fixture into a new workspace and print its id (--exclusive: alone, and finish restores the e2e dir)
claim <ws> <role...> [--wait <s>]: claim roles for this workspace before starting them (--wait retries every ${CLAIM_RETRY_MS / 1000} s, at most ${WAIT_MAX_S})
start <ws> root|<role> [--cwd <folder>] [--wt <worktree>] [--raw]: open the root window or a claimed role window (--raw starts the launcher without /cadre start)
windows <ws>: list the windows, live or dead, with their folder
trust <ws> <window>: pass the trust screens of a window cadre opened and take it into the workspace
send <ws> <window> <text>: type one line into a window and submit it (a root window takes slash commands only)
keys <ws> <window> <key...>: press keys in a window: ${SAFE_KEYS.join(', ')}
answer <ws> <window> <label>: pick the option with this label in the question on the screen
other <ws> <window> <text>: answer the question on the screen with typed text
capture <ws> <window> [--history] [--lines <n>]: print the last lines of a window (${HISTORY_LINES_DEFAULT} by default, at most ${HISTORY_LINES_MAX})
wait <ws> <window> <regex> [--timeout <s>]: wait until the screen matches, ^ and $ at each line; after a send only the lines below its echo count (${WAIT_TIMEOUT_DEFAULT_S} s by default, at most ${WAIT_MAX_S})
idle <ws> <window>: wait until the screen stops changing and print it
stop <ws> <window>: exit the session in a window and print its exit status
cadre <ws> <args...> [--wt <worktree>]: run /cadre <args> in print mode in the copy and print the reply (opens no epic)
probe <ws> <role> [--wt <worktree>]: run the role launcher with --probe in the copy and print its output
run <ws> [--wt <worktree>] git <subcommand> [args...]: run read-only git in the copy: ${GIT_READS.join(', ')}, worktree list, config --get|--get-all|--list
files <ws> <location>: list a folder at repo/<path>, inbox[:<worktree>]/<role>/<path> or projects/[<folder>/<path>]
read <ws> <location>: print a file of at most ${READ_MAX_BYTES} bytes, at the locations files takes
seed <ws> <name> [<role>]: write a fixed seed: ${[...SEEDS.keys()].join(', ')} (user-claude-md needs an exclusive workspace, bypass a role)
finish <ws>: read the result JSON on stdin, write the row and close the workspace
help: print this list`
}

function help(): number {
  say(helpText())

  return 0
}

async function openRun(setup: BeginSetup): Promise<number> {
  const { run, root, scope, claudeBin } = setup
  if (await isGlobalAway(scope.host.home, Date.now())) {
    return refuse('global away is on: run /back --global, or wait until it ends')
  }
  const leftovers = await removeLeftovers(scope)
  say(`removed ${leftovers.removed} leftover files of earlier test sessions`)
  const before = await guardSnapshot(scope.host.home, scope.needles, await keychainState(scope.host, REPO_DIR))
  await writeJson(join(agentDir(root), 'guard-before.json'), before)
  await writeClaudeFence(root, claudeBin, scope.e2eDir)
  const cwd = join(root, 'preflight')
  await mkdir(cwd)
  const preflight = await authPreflight({ cwd, marketplaceRoot: REPO_DIR, plugins: BASELINE_PLUGINS, now: Date.now() })
  identities = preflight.identities
  if (!preflight.ok) {
    for (const line of preflightLines(preflight.stage, preflight.reason)) say(`agent: ${line}`, process.stderr)
    return REFUSED
  }
  const filterFile = await writeFilterFile(root, preflight.identities)
  process.env.E2E_FILTER_FILE = filterFile
  const claude = await claudeVersion(claudeBin, root)
  await mkdir(resultsDirOf(run), { recursive: true })
  const state: RunState = {
    run,
    root,
    e2eDir: scope.e2eDir,
    claudeBin,
    claude,
    fixtures: setup.fixtures,
    filterFile,
    startedAt: Date.now(),
    holderPid: setup.holderPid,
    tokenHash: tokenHash(setup.token),
  }
  await writeJson(runFile(root), state)
  await writeJson(pointerPath(), { run })
  say(`agent run ${run} ready, claude ${claude}`)
  say(`orchestrator token ${setup.token}`)

  return 0
}

async function begin(cmd: Command<'begin'>): Promise<number> {
  if (existsSync(pointerPath())) return refuse('an agent run is active')
  if (process.env.CI !== undefined) return refuse('the agent UAT does not run in CI (CI is set)')
  const major = Number(process.versions.node.split('.')[0])
  if (major < MIN_NODE_MAJOR) return refuse(`needs Node ${MIN_NODE_MAJOR} or newer, this is ${process.version}`)
  if (!await resolveOnPath('tmux', SYSTEM_PATH)) return refuse(`tmux is not in ${SYSTEM_PATH}`)
  const claudeBin = await resolveOnPath('claude', process.env.PATH ?? '')
  if (!claudeBin) return refuse('claude is not on PATH')
  let e2eDir: string
  try {
    e2eDir = e2eConfigDir()
  } catch (error) {
    return refuse(messageOf(error))
  }
  const scope = scopeOf(e2eDir)
  const why = e2eDirReason(e2eDir, scope.host, REPO_DIR)
  if (why) return refuse(why)
  const fixtures = join(scratchBase(), cmd.fixtures)
  if (!existsSync(join(fixtures, 'fixtures'))) return refuse(`the run ${cmd.fixtures} has no fixtures folder`)

  const run = makeRunId(Date.now(), randomBytes(2).toString('hex'))
  const root = await makeRunRoot(scratchBase(), run)
  process.env.E2E_SCRATCH = root
  process.env.E2E_FIXTURES = join(fixtures, 'fixtures')
  process.env.E2E_CONFIG_DIR = e2eDir
  process.env.E2E_CLAUDE_BIN = claudeBin
  process.env.E2E_TIER = 'live'
  await mkdir(agentDir(root), { mode: 0o700 })
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  const spawned = spawnHolder(run, root, token)
  const holder = await waitHolder(root)
  if (!holder) stopHolder(spawned)
  if (!holder?.ok) return refuse('another live run holds the e2e dir lock')
  try {
    const code = await openRun({ run, root, fixtures, claudeBin, scope, token, holderPid: holder.pid })
    if (code !== 0) stopHolder(holder.pid)
    return code
  } catch (error) {
    stopHolder(holder.pid)
    throw error
  }
}

async function hold(cmd: Command<'hold'>): Promise<number> {
  const token = process.env.E2E_AGENT_TOKEN
  if (!token) return refuse('hold needs the orchestrator token in E2E_AGENT_TOKEN')
  const root = join(scratchBase(), cmd.run)
  if (!existsSync(agentDir(root))) return refuse(`no agent run ${cmd.run}`)
  if (existsSync(runFile(root))) {
    const why = tokenRefusal(token, parseRunState(await readJson(runFile(root)))?.tokenHash)
    if (why) return refuse(why)
  }
  const lock = `${e2eConfigDir()}.lock`
  const ok = await takeLock(lock)
  await writeJson(join(agentDir(root), 'holder.json'), { pid: process.pid, ok })
  if (!ok) return refuse('another live run holds the e2e dir lock')
  await stayAlive(PRUNE_AGE_MS)
  await releaseLock(lock)

  return 0
}

function errorRow(id: string, title: string, reason: string, durationMs: number): Sidecar {
  return {
    schema: SIDECAR_SCHEMA,
    id,
    half: '',
    title,
    tier: 'live',
    kind: 'pass',
    verdict: 'error',
    reason,
    checks: [],
    observations: [],
    evidence: [],
    screens: [],
    notAutomated: [],
    cassette: 'agent',
    durationMs,
  }
}

async function collectRows(dir: string): Promise<readonly Sidecar[]> {
  const rows: Sidecar[] = []
  for (const name of (await readdir(dir)).filter(item => item.endsWith('.json')).sort()) {
    const row = parseSidecar(await readFile(join(dir, name), 'utf8'))
    const id = name.slice(0, -'.json'.length)
    rows.push(row ?? errorRow(id, 'unreadable result', 'the row result file is not a valid sidecar', 0))
  }

  return rows
}

async function pluginVersion(name: string): Promise<string> {
  const value = await readJson(join(REPO_DIR, name, '.claude-plugin', 'plugin.json'))

  return isRecord(value) && typeof value.version === 'string' ? value.version : 'unknown'
}

async function pluginVersions(): Promise<readonly SuiteVersion[]> {
  return Promise.all(BASELINE_PLUGINS.map(async name => ({ name, version: await pluginVersion(name) })))
}

async function sweepRun(run: RunState): Promise<void> {
  const opts = { env: { PATH: SYSTEM_PATH }, cwd: REPO_DIR, host: true }
  try {
    const swept = await sweepServers(runSocketPrefix(run.run), opts)
    say(`removed ${swept.length} tmux server sockets of this run`)
  } catch (error) {
    say(`agent: ${messageOf(error)}`, process.stderr)
  }
}

async function writeRunSummary(path: string, text: string): Promise<boolean> {
  try {
    await writeSummary(path, text, outputContext())
    return true
  } catch (error) {
    if (!(error instanceof LeakError)) throw error
    say(`agent: SUMMARY.md not written: ${error.message}`, process.stderr)
    return false
  }
}

function endExit(guard: GuardResult, notRemoved: readonly string[], isComplete: boolean): number {
  if (guard.failures.length > 0) return GUARD_FAILED
  if (notRemoved.length > 0 || !isComplete) return FAILED

  return 0
}

async function restoreWindow(run: RunState, ws: WsState | null): Promise<Restore> {
  if (!ws?.snapshot) return { ok: false, reason: 'the workspace holds no snapshot of the e2e dir' }
  await delay(EXCLUSIVE_SETTLE_MS)
  try {
    const after = await restoreState(run.e2eDir, snapshotDir(run.root, ws.id))
    return { ok: true, changes: otherEntryChanges(ws.snapshot, after) }
  } catch (error) {
    return { ok: false, reason: messageOf(error) }
  }
}

async function exclusiveHolder(root: string): Promise<string | null> {
  if (!existsSync(exclusiveDir(root))) return null
  const id = await readFile(join(exclusiveDir(root), EXCLUSIVE_HOLDER_FILE), 'utf8').catch(() => '')

  return isWsId(id.trim()) ? id.trim() : UNKNOWN_HOLDER
}

async function restoreOpenWindow(run: RunState): Promise<WindowRestore> {
  const holder = await exclusiveHolder(run.root)
  if (holder === null) return { ok: true, lines: [] }
  const restore = await restoreWindow(run, parseWsState(await readJson(wsFile(run.root, holder))))
  if (!restore.ok) return { ok: false, lines: [`e2e dir state not restored after ${holder}: ${restore.reason}`] }
  await removeTree(exclusiveDir(run.root), run.root)
  const changed = restore.changes.map(name => `e2e dir entry ${name} changed in the exclusive window`)

  return { ok: true, lines: [`e2e dir state restored after ${holder}`, ...changed] }
}

async function end(cmd: Command<'end'>, run: RunState): Promise<number> {
  const why = tokenRefusal(cmd.token, run.tokenHash)
  if (why) return refuse(why)
  const before = parseGuardSnapshot(await readJson(join(agentDir(run.root), 'guard-before.json')))
  if (!before) return fail('the guard snapshot taken at begin is unreadable')
  const results = resultsDirOf(run.run)
  await mkdir(results, { recursive: true })
  for (const ws of (await workspaces(run)).filter(item => item.status === 'live')) {
    const row = errorRow(ws.row, `workspace ${ws.id}`, NOT_FINISHED, Date.now() - ws.startedAt)
    await writeRowResult(results, row, outputContext())
  }
  await sweepRun(run)
  const window = await restoreOpenWindow(run)
  const scope = scopeOf(run.e2eDir)
  const cleanup = await cleanupSessions(scope, before)
  stopHolder(run.holderPid)
  if (!await waitLockGone(`${run.e2eDir}.lock`)) say('agent: the e2e dir lock is still held', process.stderr)
  const guard = await checkGuard(scope, run.root, before, cleanup.recorded, REPO_DIR)
  const items = [...window.lines, ...guardItems(cleanup.failures, cleanup, guard)]
  for (const item of items) say(item)
  const versions = await pluginVersions()
  const rows = await collectRows(results)
  const text = summaryText({ run: run.run, tier: 'live', claude: run.claude, versions, rows, guard: items })
  const isWritten = await writeRunSummary(join(results, 'SUMMARY.md'), text)
  const isFilterRemoved = await removeTree(run.filterFile, run.root).then(() => true, () => false)
  if (!isFilterRemoved) say('agent: the filter values file was not removed', process.stderr)
  await rm(pointerPath(), { force: true })
  const code = endExit(guard, cleanup.failures, isWritten && window.ok)
  say(`agent run ${run.run} exit ${code} summary e2e/results/${run.run}/SUMMARY.md`)

  return code
}

// The mkdir is the lock: only one exclusive workspace takes the folder, which then names it.
async function takeExclusive(root: string, id: string): Promise<boolean> {
  try {
    await mkdir(exclusiveDir(root))
  } catch (error) {
    if (isRecord(error) && error.code === 'EEXIST') return false
    throw error
  }
  await writeFile(join(exclusiveDir(root), EXCLUSIVE_HOLDER_FILE), `${id}\n`, { mode: 0o600 })

  return true
}

async function openWorkspace(run: RunState, cmd: Command<'fixture'>, id: string, source: string): Promise<void> {
  const dir = wsDir(run.root, id)
  await mkdir(dirname(dir), { recursive: true, mode: 0o700 })
  await mkdir(dir)
  await copyTree(source, join(dir, 'repo'))
  const snapshot = cmd.exclusive ? await snapshotState(run.e2eDir, snapshotDir(run.root, id)) : null
  const ws: WsState = {
    id,
    row: cmd.row,
    variant: cmd.variant,
    exclusive: cmd.exclusive,
    socket: socketName(),
    startedAt: Date.now(),
    status: 'live',
    windows: [],
    claims: [],
    uuids: [],
    ...(snapshot === null ? {} : { snapshot }),
  }
  await saveWs(run, ws)
}

async function fixture(cmd: Command<'fixture'>, run: RunState): Promise<number> {
  const source = fixtureDir(cmd.variant)
  if (!existsSync(source)) return refuse(`the fixture ${cmd.variant} is not built in run ${basename(run.fixtures)}`)
  const id = wsIdOf(cmd.row, randomBytes(2).toString('hex'))
  if (id === null) return refuse(`not a row id: ${cmd.row}`)
  const why = exclusiveRefusal(id, await workspaces(run), await exclusiveHolder(run.root), cmd.exclusive)
  if (why) return refuse(why)
  if (cmd.exclusive && !await takeExclusive(run.root, id)) return refuse('another exclusive workspace is opening')
  try {
    await openWorkspace(run, cmd, id, source)
  } catch (error) {
    if (cmd.exclusive) await removeTree(exclusiveDir(run.root), run.root)
    throw error
  }
  say(`ws ${id}`)

  return 0
}

async function takeClaimsLock(lock: string): Promise<boolean> {
  const until = Date.now() + LOCK_WAIT_MS
  while (!await takeLock(lock)) {
    if (Date.now() >= until) return false
    await delay(WAIT_TICK_MS)
  }

  return true
}

async function tryClaim(run: RunState, ws: WsState, roles: readonly string[]): Promise<readonly string[]> {
  const lock = join(agentDir(run.root), CLAIMS_LOCK)
  if (!await takeClaimsLock(lock)) throw new HarnessError(`the claims lock stayed held for ${LOCK_WAIT_MS} ms`)
  try {
    const taken = claimsTaken(await workspaces(run))
    const busy = roles.flatMap(role => claimRefusal(role, ws.id, taken) ?? [])
    if (busy.length > 0) return busy
    await saveWs(run, { ...ws, claims: [...new Set([...ws.claims, ...roles])] })
    return []
  } finally {
    await releaseLock(lock)
  }
}

async function claim(cmd: Command<'claim'>, run: RunState, ws: WsState): Promise<number> {
  const deadline = Date.now() + cmd.waitMs
  for (;;) {
    const busy = await tryClaim(run, ws, cmd.roles)
    if (busy.length === 0) {
      say(`claimed ${cmd.roles.join(' ')}`)
      return 0
    }
    const left = deadline - Date.now()
    if (left <= 0) {
      say(busy.join('\n'))
      return FAILED
    }
    await delay(Math.min(CLAIM_RETRY_MS, left))
  }
}

async function launchRefusal(copy: string, role: string, raw: boolean, env: ChildEnv): Promise<string | null> {
  if (raw) return existsSync(launcherOf(copy, role)) ? null : `the copy has no launcher for ${role}`
  const reply = replyOf(await cadrePrint({ repo: copy, env }, `start ${role}`))
  if (printedCommand(reply, role) !== null) return null

  return `/cadre start ${role} printed no launcher command: ${firstLineOf(reply)}`
}

async function openWindow(server: Server, name: string, cwd: string, launcher: string | null): Promise<void> {
  if (launcher === null) {
    await startTui(server, cwd, [])
    return
  }
  await newWindow(server, name, cwd, [launcher])
  await passTrust(server, name)
}

async function start(cmd: Command<'start'>, run: RunState, ws: WsState): Promise<number> {
  const copy = copyOf(run, ws, cmd.wt)
  if (copy === null) return refuse(`no worktree ${cmd.wt} in ${ws.id}`)
  const cwd = cmd.cwd === null ? copy : join(copy, cmd.cwd)
  if (cmd.cwd !== null && !existsSync(cwd)) return refuse(`no folder ${cmd.cwd} in the copy`)
  const isRoot = cmd.role === ROOT_ROLE
  if (isRoot && ws.windows.some(item => item.kind === 'root')) return refuse(`${ws.id} has a root window already`)
  if (!isRoot && !ws.claims.includes(cmd.role)) return refuse(`claim ${cmd.role} first: claim ${ws.id} ${cmd.role}`)
  const server = serverOf(ws)
  const refusal = isRoot ? null : await launchRefusal(copy, cmd.role, cmd.raw, server.env)
  if (refusal) return refuse(refusal)
  if (ws.windows.length === 0 && !await isServerUp(server)) await startServer(ws.socket, server.env)
  const name = windowNameFor(cmd.role, (await listWindows(server)).map(item => item.name))
  if (name === null) return refuse(`no free window name for ${cmd.role}`)
  await saveWs(run, withWindow(ws, { name, kind: isRoot ? 'root' : 'role' }))
  try {
    await openWindow(server, name, cwd, isRoot ? null : launcherOf(copy, cmd.role))
  } catch (error) {
    return fail(`${name} is recorded but did not start: ${messageOf(error)}; capture it, then stop it`)
  }
  say(`window ${name}`)

  return 0
}

async function captureWindow(cmd: Command<'capture'>, ws: WsState): Promise<number> {
  const pane = await paneOf(serverOf(ws), cmd.window)
  if (!pane) return refuse(`no window ${cmd.window} in ${ws.id}`)
  say(lastLines(await capture(pane, { history: cmd.history }), cmd.lines))

  return 0
}

function placeOf(cwd: string, dir: string): string {
  return isUnder(cwd, dir) ? relative(dir, cwd) : cwd
}

async function showWindows(run: RunState, ws: WsState): Promise<number> {
  const dir = wsDir(run.root, ws.id)
  const windows = await listWindows(serverOf(ws)).catch(() => [])
  const lines = windows.map(item => `${item.name} ${item.dead ? 'dead' : 'live'} ${placeOf(item.cwd, dir)}`)
  say(lines.length > 0 ? lines.join('\n') : 'no windows')

  return 0
}

async function trust(cmd: Command<'trust'>, run: RunState, ws: WsState): Promise<number> {
  const server = serverOf(ws)
  if (!await isServerUp(server)) return refuse(`${ws.id} has no windows yet: run start first`)
  await passTrust(server, cmd.window)
  await saveWs(run, withWindow(ws, { name: cmd.window, kind: 'role' }))
  say(`trusted ${cmd.window}`)

  return 0
}

async function send(cmd: Command<'send'>, run: RunState, ws: WsState): Promise<number> {
  const target = await inputTarget(ws, cmd.window)
  if (typeof target === 'string') return refuse(target)
  const why = sendRefusal(cmd.text, { exclusive: ws.exclusive, root: target.kind === 'root' })
  if (why) return refuse(why)
  await saveWs(run, withLastSent(ws, cmd.window, cmd.text))
  await submitTui(target.pane, cmd.text)
  say(`sent to ${cmd.window}`)

  return 0
}

async function pressKeys(cmd: Command<'keys'>, ws: WsState): Promise<number> {
  const why = keysRefusal(cmd.keys)
  if (why) return refuse(why)
  const target = await inputTarget(ws, cmd.window)
  if (typeof target === 'string') return refuse(target)
  await sendKeys(target.pane, ...cmd.keys)
  say(`pressed ${cmd.keys.join(' ')} in ${cmd.window}`)

  return 0
}

async function answerWindow(cmd: Command<'answer'>, ws: WsState): Promise<number> {
  const why = answerRefusal(cmd.label, ws.exclusive)
  if (why) return refuse(why)
  const target = await inputTarget(ws, cmd.window)
  if (typeof target === 'string') return refuse(target)
  await answer(target.pane, cmd.label)
  say(`answered ${cmd.label}`)

  return 0
}

// With no question on the screen, answerOther would type n and the text into the input box and submit them.
async function answerOtherWindow(cmd: Command<'other'>, ws: WsState): Promise<number> {
  const target = await inputTarget(ws, cmd.window)
  if (typeof target === 'string') return refuse(target)
  if (!isDialogScreen(await idleTui(target.pane))) return refuse(`no question is showing in ${cmd.window}`)
  await answerOther(target.pane, cmd.text)
  say('answered with the typed text')

  return 0
}

async function waitWindow(cmd: Command<'wait'>, ws: WsState): Promise<number> {
  const server = serverOf(ws)
  const pane = await paneOf(server, cmd.window)
  if (!pane) return refuse(`no window ${cmd.window} in ${ws.id}`)
  const sent = ws.windows.find(item => item.name === cmd.window)?.lastSent
  const isMatch = (shown: string): boolean => matches(cmd.pattern, afterEcho(shown, sent).text)
  const screen = await waitFor(pane, isMatch, cmd.timeoutMs, String(cmd.pattern)).catch((error: unknown) => {
    if (error instanceof HarnessError) return null
    throw error
  })
  if (screen !== null) {
    const isEchoMissing = afterEcho(screen, sent).echo === 'missing'
    say(isEchoMissing ? `matched\n${NO_ECHO_LINE}\n${screen}` : `matched\n${screen}`)
    return 0
  }
  const isExited = (await windowOf(server, cmd.window))?.dead === true
  const last = await capture(pane).catch(() => '')
  say(`${isExited ? 'exited' : 'timeout'}\n${lastLines(last, SCREEN_LINES)}`)

  return FAILED
}

async function idleWindow(cmd: Command<'idle'>, ws: WsState): Promise<number> {
  const pane = await paneOf(serverOf(ws), cmd.window)
  if (!pane) return refuse(`no window ${cmd.window} in ${ws.id}`)
  say(await idleTui(pane))

  return 0
}

async function exitsWithin(pane: Pane, timeoutMs: number): Promise<boolean> {
  return waitDead(pane, timeoutMs).then(() => true, () => false)
}

async function stopSession(pane: Pane): Promise<void> {
  const isSubmitted = await submitTui(pane, '/exit').then(() => true, () => false)
  if (isSubmitted && await exitsWithin(pane, STOP_EXIT_MS)) return
  await sendKeys(pane, 'C-c', 'C-c')
  await exitsWithin(pane, STOP_KILL_MS)
}

async function stopWindow(cmd: Command<'stop'>, ws: WsState): Promise<number> {
  const target = await inputTarget(ws, cmd.window)
  if (typeof target === 'string') return refuse(target)
  if (!(await paneState(target.pane)).dead) await stopSession(target.pane)
  const state = await paneState(target.pane)
  if (!state.dead) return fail(`${cmd.window} still runs after /exit and two C-c`)
  say(`${cmd.window} exited with status ${state.status ?? 'unknown'}`)

  return 0
}

function resultText(stdout: string, result: RunResult): string {
  const stderr = result.stderr.trimEnd()
  const parts = [stdout.trimEnd(), stderr === '' ? '' : `stderr:\n${stderr}`, `exit ${result.code}`]

  return parts.filter(part => part !== '').join('\n')
}

async function cadreCommand(cmd: Command<'cadre'>, run: RunState, ws: WsState): Promise<number> {
  const why = cadreRefusal(cmd.args)
  if (why) return refuse(why)
  const copy = copyOf(run, ws, cmd.wt)
  if (copy === null) return refuse(`no worktree ${cmd.wt} in ${ws.id}`)
  const result = await cadrePrint({ repo: copy, env: liveEnv() }, cmd.args.join(' '))
  say(resultText(replyOf(result), result))

  return 0
}

async function probe(cmd: Command<'probe'>, run: RunState, ws: WsState): Promise<number> {
  const copy = copyOf(run, ws, cmd.wt)
  if (copy === null) return refuse(`no worktree ${cmd.wt} in ${ws.id}`)
  if (!existsSync(launcherOf(copy, cmd.role))) return refuse(`the copy has no launcher for ${cmd.role}`)
  const result = await runProbe({ repo: copy, env: liveEnv() }, cmd.role)
  say(resultText(result.stdout, result))

  return 0
}

async function runInCopy(cmd: Command<'run'>, run: RunState, ws: WsState): Promise<number> {
  const why = runRefusal(cmd.argv)
  if (why) return refuse(why)
  const copy = copyOf(run, ws, cmd.wt)
  if (copy === null) return refuse(`no worktree ${cmd.wt} in ${ws.id}`)
  const result = await runProcess(cmd.argv, { cwd: copy, env: liveEnv(), timeoutMs: RUN_MS })
  say(resultText(result.stdout, result))

  return 0
}

// The e2e dir's project folders of sessions started in this workspace, named by what follows this prefix.
async function projectsPrefix(run: RunState, ws: WsState): Promise<string> {
  return `${(await realpath(wsDir(run.root, ws.id))).replace(NON_ALPHANUMERIC_RE, '-')}-`
}

async function locationBase(run: RunState, ws: WsState, location: Location): Promise<LocationBase | string> {
  if (location.root === 'repo') return { root: repoOf(run, ws), rest: location.path }
  if (location.root === 'projects') {
    const [entry = '', ...rest] = location.path.split('/')
    const root = join(run.e2eDir, PROJECTS_DIR, `${await projectsPrefix(run, ws)}${entry}`)
    return { root, rest: rest.join('/') }
  }
  const copy = copyOf(run, ws, location.worktree)
  if (copy === null) return `no worktree ${location.worktree} in ${ws.id}`
  if (location.role === null) return 'an inbox location names a role'

  return { root: await inboxDirOf(run.e2eDir, { repo: copy, env: liveEnv() }, location.role), rest: location.path }
}

// Both ends are resolved, so a symlink cannot lead out of the root.
async function locate(run: RunState, ws: WsState, location: Location): Promise<{ readonly path: string } | string> {
  const base = await locationBase(run, ws, location)
  if (typeof base === 'string') return base
  const root = await realpath(base.root).catch(() => null)
  const path = root === null ? null : await realpath(join(root, base.rest)).catch(() => null)
  if (root === null || path === null) throw new HarnessError('no such file or folder')
  if (path !== root && !isUnder(path, root)) return 'the location leads out of its root through a symlink'

  return { path }
}

function kindOf(stats: Stats): string {
  if (stats.isSymbolicLink()) return 'link'
  if (stats.isDirectory()) return 'dir'
  if (stats.isFile()) return 'file'

  return 'other'
}

async function entryLines(dir: string, names: readonly string[], shown: (name: string) => string): Promise<string> {
  const lines: string[] = []
  for (const name of [...names].sort()) {
    const stats = await lstat(join(dir, name)).catch(() => null)
    if (stats) lines.push(`${shown(name)} ${kindOf(stats)} ${stats.size}`)
  }

  return lines.length > 0 ? lines.join('\n') : 'no entries'
}

async function listProjects(run: RunState, ws: WsState): Promise<number> {
  const dir = join(run.e2eDir, PROJECTS_DIR)
  const prefix = await projectsPrefix(run, ws)
  const names = (await readdir(dir).catch((): string[] => [])).filter(name => name.startsWith(prefix))
  say(await entryLines(dir, names, name => name.slice(prefix.length)))

  return 0
}

async function listFiles(cmd: Command<'files'>, run: RunState, ws: WsState): Promise<number> {
  if (cmd.location.root === 'projects' && cmd.location.path === '') return listProjects(run, ws)
  const found = await locate(run, ws, cmd.location)
  if (typeof found === 'string') return refuse(found)
  if (!(await stat(found.path)).isDirectory()) return refuse('that is a file: use read')
  say(await entryLines(found.path, await readdir(found.path), name => name))

  return 0
}

async function readLocation(cmd: Command<'read'>, run: RunState, ws: WsState): Promise<number> {
  if (cmd.location.root === 'projects' && cmd.location.path === '') return refuse('projects/ holds folders: use files')
  const found = await locate(run, ws, cmd.location)
  if (typeof found === 'string') return refuse(found)
  const stats = await stat(found.path)
  if (stats.isDirectory()) return refuse('that is a folder: use files')
  if (!stats.isFile()) return refuse('that is not a regular file')
  if (stats.size > READ_MAX_BYTES) return refuse(`the file is over ${READ_MAX_BYTES} bytes`)
  say(await readFile(found.path, 'utf8'))

  return 0
}

async function seed(cmd: Command<'seed'>, run: RunState, ws: WsState): Promise<number> {
  const plant = SEEDS.get(cmd.name)
  if (!plant) return refuse(`unknown seed ${cmd.name}: use ${[...SEEDS.keys()].join(', ')}`)
  const why = seedRefusal(cmd.name, ws.exclusive)
  if (why) return refuse(why)
  const target = { repo: repoOf(run, ws), e2eDir: run.e2eDir, ...(cmd.role === null ? {} : { role: cmd.role }) }
  let summary: string
  try {
    summary = await plant(target)
  } catch (error) {
    if (!(error instanceof HarnessError)) throw error
    return refuse(error.message)
  }
  say(summary)

  return 0
}

async function readStdin(): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > RESULT_MAX_BYTES) return null
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

async function screensOf(server: Server): Promise<readonly Note[]> {
  const screens: Note[] = []
  for (const window of await listWindows(server).catch(() => [])) {
    const text = await capture({ server, id: window.pane }, { history: true }).catch(() => '')
    screens.push({ label: window.name, text: filterLines(lastLines(text, SCREEN_LINES), outputContext()) })
  }

  return screens
}

async function finish(run: RunState, ws: WsState): Promise<number> {
  if (process.stdin.isTTY) return refuse('finish reads the result JSON on stdin')
  const text = await readStdin()
  if (text === null) return refuse(`the result is over ${RESULT_MAX_BYTES} bytes`)
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch (error) {
    return refuse(`the result is not valid JSON: ${messageOf(error)}`)
  }
  const server = serverOf(ws)
  const screens = await screensOf(server)
  const row = agentSidecar(input, { row: ws.row, durationMs: Date.now() - ws.startedAt, screens })
  if (typeof row === 'string') return refuse(row)
  await killServer(server)
  const restore = ws.exclusive ? await restoreWindow(run, ws) : null
  await writeRowResult(resultsDirOf(run.run), restoredRow(row, restore), outputContext())
  await saveWs(run, { ...ws, status: 'finished', claims: [] })
  say(`wrote ${rowFileName(row.id, row.half)}`)
  if (restore === null) return 0
  if (!restore.ok) return fail(`e2e dir state not restored: ${restore.reason}`)
  await removeTree(exclusiveDir(run.root), run.root)

  return 0
}

function restoredRow(row: Sidecar, restore: Restore | null): Sidecar {
  if (restore === null) return row
  if (!restore.ok) return { ...row, verdict: 'error', reason: `e2e dir state not restored: ${restore.reason}` }
  const lines = ['e2e dir state restored', ...restore.changes.map(name => `e2e dir entry ${name} changed`)]

  return { ...row, evidence: [...row.evidence, { label: 'e2e dir state', text: lines.join('\n') }] }
}

async function runWsVerb(cmd: WsCommand, run: RunState, ws: WsState): Promise<number> {
  if (cmd.verb === 'claim') return claim(cmd, run, ws)
  if (cmd.verb === 'start') return start(cmd, run, ws)
  if (cmd.verb === 'windows') return showWindows(run, ws)
  if (cmd.verb === 'trust') return trust(cmd, run, ws)
  if (cmd.verb === 'send') return send(cmd, run, ws)
  if (cmd.verb === 'keys') return pressKeys(cmd, ws)
  if (cmd.verb === 'answer') return answerWindow(cmd, ws)
  if (cmd.verb === 'other') return answerOtherWindow(cmd, ws)
  if (cmd.verb === 'capture') return captureWindow(cmd, ws)
  if (cmd.verb === 'wait') return waitWindow(cmd, ws)
  if (cmd.verb === 'idle') return idleWindow(cmd, ws)
  if (cmd.verb === 'stop') return stopWindow(cmd, ws)
  if (cmd.verb === 'cadre') return cadreCommand(cmd, run, ws)
  if (cmd.verb === 'probe') return probe(cmd, run, ws)
  if (cmd.verb === 'run') return runInCopy(cmd, run, ws)
  if (cmd.verb === 'files') return listFiles(cmd, run, ws)
  if (cmd.verb === 'read') return readLocation(cmd, run, ws)
  if (cmd.verb === 'seed') return seed(cmd, run, ws)

  return finish(run, ws)
}

async function wsVerb(cmd: WsCommand, run: RunState): Promise<number> {
  const ws = await loadLiveWs(run, cmd.ws)
  if (typeof ws === 'string') return refuse(ws)
  try {
    return await runWsVerb(cmd, run, ws)
  } finally {
    await saveUuids(run, ws.id)
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const cmd = parseCommand(argv)
  if (typeof cmd === 'string') return refuse(cmd)
  if (cmd.verb === 'help') return help()
  if (cmd.verb === 'begin') return begin(cmd)
  if (cmd.verb === 'hold') return hold(cmd)
  const run = await loadRun()
  if (typeof run === 'string') return refuse(run)
  if (cmd.verb === 'end') return end(cmd, run)
  if (cmd.verb === 'fixture') return fixture(cmd, run)

  return wsVerb(cmd, run)
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  process.exitCode = fail(messageOf(error))
}
