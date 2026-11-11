import { lstat, readFile, rm } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expiresSoon, parseAuthStatus } from './auth.ts'
import type { AuthStatus } from './auth.ts'
import { liveEnv } from './env.ts'
import type { ChildEnv } from './env.ts'
import { HarnessError } from './errors.ts'
import { isRecord } from './filter.ts'
import { hashFolder } from './hash.ts'
import { pollUntil } from './poll.ts'
import { run } from './proc.ts'
import type { Env, RunResult } from './proc.ts'
import { isUnder, scratchRoot } from './scratch.ts'
import { listWindows, matches, newWindow, POLL_MS, sendKeys, sendText, WAIT_MS, waitFor, waitIdle } from './tmux.ts'
import type { Matcher, Pane, Server } from './tmux.ts'

export type PluginBaseline = 'fresh' | 'fresh after a cache reset'
export type PreflightStage = 'login' | 'plugins'

export type PreflightOptions = {
  readonly cwd: string
  readonly marketplaceRoot: string
  readonly plugins: readonly string[]
  readonly now: number
}

export type Preflight =
  | {
    readonly ok: true
    readonly identities: readonly string[]
    readonly plugins: PluginBaseline
  }
  | {
    readonly ok: false
    readonly stage: PreflightStage
    readonly reason: string
    readonly identities: readonly string[]
  }

const AUTH_STATUS_MS = 30_000
const PRINT_MODE_MS = 300_000
const PLUGIN_COMMAND_MS = 60_000
const PREFLIGHT_PROMPT = 'Reply with OK'
const PREFLIGHT_PROMPT_MS = 120_000
const AUTH_LOST_RE = /authentication|\b401\b|oauth/i
const MARKETPLACE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const FRESHNESS_PLUGIN = 'cadre'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function claudeBin(env: Env = process.env): string {
  const bin = env.E2E_CLAUDE_BIN
  if (!bin) throw new HarnessError('E2E_CLAUDE_BIN is unset: run through npm run e2e:live')

  return bin
}

export function configDir(env: Env = process.env): string {
  const dir = env.E2E_CONFIG_DIR
  if (!dir) throw new HarnessError('E2E_CONFIG_DIR is unset: run through npm run e2e:live')

  return dir
}

export async function printMode(
  cwd: string,
  args: readonly string[],
  env: ChildEnv,
  timeoutMs: number = PRINT_MODE_MS,
): Promise<RunResult> {
  const result = await run([claudeBin(), '-p', ...args], { cwd, env, timeoutMs })
  if (result.code !== 0 && AUTH_LOST_RE.test(result.stderr)) throw new HarnessError('auth lost mid-run')

  return result
}

export async function authStatus(cwd: string, env: ChildEnv, bin: string = claudeBin()): Promise<AuthStatus | string> {
  const result = await run([bin, 'auth', 'status'], { cwd, env, timeoutMs: AUTH_STATUS_MS })
  const status = parseAuthStatus(result.stdout)
  if (status && !status.loggedIn) return `not logged in: ${env.CLAUDE_CONFIG_DIR ?? ''}`
  if (result.code !== 0) return `claude auth status exited ${result.code}`
  if (!status) return 'claude auth status printed no status'

  return status
}

async function marketplaceName(root: string): Promise<string> {
  const value = parseJson(await readFile(join(root, '.claude-plugin', 'marketplace.json'), 'utf8').catch(() => ''))
  const name = isRecord(value) ? value.name : undefined
  if (typeof name === 'string' && MARKETPLACE_NAME_RE.test(name)) return name

  throw new HarnessError('the marketplace root has no readable name in .claude-plugin/marketplace.json')
}

async function knownMarketplaces(dir: string): Promise<readonly string[]> {
  const value = parseJson(await readFile(join(dir, 'plugins', 'known_marketplaces.json'), 'utf8').catch(() => ''))

  return isRecord(value) ? Object.keys(value) : []
}

async function pluginCommand(args: readonly string[], cwd: string, env: ChildEnv): Promise<void> {
  const result = await run([claudeBin(), 'plugin', ...args], { cwd, env, timeoutMs: PLUGIN_COMMAND_MS })
  if (result.code === 0) return
  const detail = firstLine(result.stderr) || firstLine(result.stdout)

  throw new HarnessError(`claude plugin ${args.slice(0, 2).join(' ')} exited ${result.code}: ${detail}`)
}

async function installBaseline(
  dir: string,
  root: string,
  marketplace: string,
  names: readonly string[],
  cwd: string,
): Promise<void> {
  const env = liveEnv()
  for (const known of await knownMarketplaces(dir)) await pluginCommand(['marketplace', 'remove', known], cwd, env)
  await pluginCommand(['marketplace', 'add', root], cwd, env)
  for (const name of names) await pluginCommand(['install', `${name}@${marketplace}`, '--scope', 'user'], cwd, env)
}

function userInstallPath(value: unknown, key: string): string | null {
  if (!isRecord(value) || !isRecord(value.plugins)) return null
  const entries = value.plugins[key]
  if (!Array.isArray(entries)) return null
  const entry: unknown = entries.find(item => isRecord(item) && item.scope === 'user')
  if (!isRecord(entry) || typeof entry.installPath !== 'string') return null

  return isAbsolute(entry.installPath) ? entry.installPath : null
}

async function isFresh(dir: string, root: string, marketplace: string, names: readonly string[]): Promise<boolean> {
  if (!names.includes(FRESHNESS_PLUGIN)) return true
  const installed = parseJson(await readFile(join(dir, 'plugins', 'installed_plugins.json'), 'utf8').catch(() => ''))
  const installPath = userInstallPath(installed, `${FRESHNESS_PLUGIN}@${marketplace}`)
  if (!installPath) return false
  const hashes = await Promise.all([
    hashFolder(join(installPath, 'hooks')),
    hashFolder(join(root, FRESHNESS_PLUGIN, 'hooks')),
  ]).catch(() => null)

  return hashes !== null && hashes[0] === hashes[1]
}

async function removePluginCache(dir: string, marketplace: string): Promise<void> {
  const cacheRoot = join(dir, 'plugins', 'cache')
  const path = join(cacheRoot, marketplace)
  if (!isUnder(path, cacheRoot) || basename(path) !== marketplace) {
    throw new HarnessError('refusing to remove a plugin cache outside the e2e dir plugins/cache/')
  }
  const stats = await lstat(path).catch(() => null)
  if (!stats) return
  if (stats.isSymbolicLink()) throw new HarnessError('refusing to remove a plugin cache that is a symlink')

  await rm(path, { recursive: true, force: true })
}

export async function preparePlugins(
  marketplaceRoot: string,
  names: readonly string[],
  cwd: string = scratchRoot(),
): Promise<PluginBaseline> {
  const dir = configDir()
  const marketplace = await marketplaceName(marketplaceRoot)
  await installBaseline(dir, marketplaceRoot, marketplace, names, cwd)
  if (await isFresh(dir, marketplaceRoot, marketplace, names)) return 'fresh'
  // A reinstall can reuse a stale copy of the marketplace from the plugin cache.
  await removePluginCache(dir, marketplace)
  await installBaseline(dir, marketplaceRoot, marketplace, names, cwd)
  if (await isFresh(dir, marketplaceRoot, marketplace, names)) return 'fresh after a cache reset'

  throw new HarnessError(`the installed ${FRESHNESS_PLUGIN} hooks differ from the marketplace root after a cache reset`)
}

function failed(stage: PreflightStage, reason: string, identities: readonly string[]): Preflight {
  return { ok: false, stage, reason, identities }
}

export async function authPreflight(opts: PreflightOptions): Promise<Preflight> {
  const env = liveEnv()
  const status = await authStatus(opts.cwd, env).catch(messageOf)
  if (typeof status === 'string') return failed('login', status, [])
  const identities = status.identityValues
  if (expiresSoon(status.expiresAt, opts.now)) return failed('login', 'login expires soon', identities)
  let plugins: PluginBaseline
  try {
    plugins = await preparePlugins(opts.marketplaceRoot, opts.plugins, opts.cwd)
  } catch (error) {
    return failed('plugins', messageOf(error), identities)
  }
  const answer = await printMode(opts.cwd, [PREFLIGHT_PROMPT], env, PREFLIGHT_PROMPT_MS).catch(messageOf)
  if (typeof answer === 'string') return failed('login', `model call failed: ${answer}`, identities)
  if (answer.code !== 0) return failed('login', `model call failed: claude -p exited ${answer.code}`, identities)
  if (answer.stdout.trim() === '') return failed('login', 'model call failed: claude -p printed no answer', identities)

  return { ok: true, identities, plugins }
}

export type TuiStep = {
  readonly matcher: RegExp
  readonly label: string | null
}

// The empty input box between its two rules: claude takes typed prompts.
export const TUI_READY = /^─+\n❯\n─+$/m
// Dialogs before the ready prompt: first-run screens take Enter; folder trust starts on "No, exit", so pick by label.
export const TUI_TRUST: readonly TuiStep[] = [
  { matcher: /Choose the text style that looks best with your terminal/, label: null },
  { matcher: /Press Enter to continue/, label: null },
  { matcher: /Yes, I trust this folder/, label: 'Yes, I trust this folder' },
]
const TUI_LOGIN_RE = /Please run \/login|Select login method/
const CURSOR_RE = /^\s*❯ +/
const MARK_RE = /^✔ +/
const NUMBER_RE = /^[0-9]+\.\s+/
const OTHER_LABELS: readonly string[] = ['Other', 'Type something.']
const CURSOR_MS = 5_000
const TUI_ROUNDS = 8

type OptionLine = {
  readonly label: string
  readonly cursor: boolean
}

type Pick = (options: readonly OptionLine[]) => OptionLine | undefined

function isLoginPrompt(screen: string): boolean {
  return TUI_LOGIN_RE.test(screen)
}

function authChecked(screen: string): string {
  if (isLoginPrompt(screen)) throw new HarnessError('auth lost mid-run')

  return screen
}

export async function waitTui(
  pane: Pane,
  matcher: Matcher,
  timeoutMs: number = WAIT_MS,
  label?: string,
): Promise<string> {
  const either = (screen: string): boolean => isLoginPrompt(screen) || matches(matcher, screen)

  return authChecked(await waitFor(pane, either, timeoutMs, label))
}

export async function idleTui(pane: Pane, quietMs?: number, timeoutMs?: number): Promise<string> {
  return authChecked(await waitIdle(pane, quietMs, timeoutMs))
}

function textColumn(line: string): number {
  const cursor = CURSOR_RE.exec(line)
  const start = cursor ? cursor[0].length : line.length - line.trimStart().length
  const mark = MARK_RE.exec(line.slice(start))

  return start + (mark ? mark[0].length : 0)
}

function labelAt(line: string, column: number): string {
  return line.slice(column).replace(NUMBER_RE, '').trim()
}

function blockLines(lines: readonly string[], from: number, step: number, column: number): readonly string[] {
  const found: string[] = []
  for (let index = from + step; index >= 0 && index < lines.length; index += step) {
    const line = lines[index] ?? ''
    if (line.trim() === '') continue
    const at = textColumn(line)
    if (at < column) break
    if (at === column) found.push(line)
  }

  return found
}

function optionLines(screen: string): readonly OptionLine[] {
  const lines = screen.split('\n')
  const cursorAt = lines.findLastIndex(line => CURSOR_RE.test(line))
  const cursorLine = lines[cursorAt]
  if (cursorLine === undefined) return []
  const column = textColumn(cursorLine)
  const above = [...blockLines(lines, cursorAt, -1, column)].reverse()
  const below = blockLines(lines, cursorAt, 1, column)
  const option = (line: string, cursor: boolean): OptionLine => ({ label: labelAt(line, column), cursor })

  return [
    ...above.map(line => option(line, false)),
    option(cursorLine, true),
    ...below.map(line => option(line, false)),
  ]
}

function cursorLabel(screen: string): string | null {
  return optionLines(screen).find(option => option.cursor)?.label ?? null
}

async function select(pane: Pane, screen: string, pick: Pick, name: string): Promise<void> {
  const options = optionLines(screen)
  const target = pick(options)
  if (!target) throw new HarnessError(`no option ${name} on the screen:\n${screen}`)
  const steps = options.indexOf(target) - options.findIndex(option => option.cursor)
  await sendKeys(pane, ...Array.from({ length: Math.abs(steps) }, () => (steps > 0 ? 'Down' : 'Up')))
  await waitTui(pane, current => cursorLabel(current) === target.label, CURSOR_MS, `the cursor on ${name}`)
  await sendKeys(pane, 'Enter')
}

function labelPick(label: string): Pick {
  return options =>
    options.find(option => option.label === label) ?? options.find(option => option.label.startsWith(label))
}

// A dialog takes keys only once its screen has settled; keys sent while it still draws are lost.
export async function answer(pane: Pane, label: string): Promise<void> {
  await select(pane, await idleTui(pane), labelPick(label), JSON.stringify(label))
}

export async function answerOther(pane: Pane, text: string): Promise<void> {
  const pick: Pick = options => options.find(option => OTHER_LABELS.includes(option.label))
  await select(pane, await idleTui(pane), pick, 'Other')
  await sendText(pane, text)

  await sendKeys(pane, 'Enter')
}

export async function dismiss(pane: Pane): Promise<void> {
  await sendKeys(pane, 'Escape')
}

function stepOf(screen: string): TuiStep | undefined {
  return TUI_TRUST.find(step => step.matcher.test(screen))
}

async function passTrustIn(pane: Pane): Promise<string> {
  const known = (screen: string): boolean => TUI_READY.test(screen) || stepOf(screen) !== undefined
  const label = 'the ready prompt, the folder trust dialog or a first-run screen'
  for (let round = 0; round < TUI_ROUNDS; round += 1) {
    await waitTui(pane, known, WAIT_MS, label)
    const screen = await idleTui(pane)
    if (TUI_READY.test(screen)) return screen
    const step = stepOf(screen)
    if (!step) continue
    if (step.label === null) await sendKeys(pane, 'Enter')
    else await select(pane, screen, labelPick(step.label), JSON.stringify(step.label))
  }

  throw new HarnessError(`claude did not reach the ready prompt in ${TUI_ROUNDS} rounds`)
}

export async function startTui(server: Server, cwd: string, args: readonly string[]): Promise<Pane> {
  const pane = await newWindow(server, 'claude', cwd, [claudeBin(), ...args])
  await passTrustIn(pane)

  return pane
}

export async function passTrust(server: Server, window: string): Promise<Pane> {
  const opts = { timeoutMs: WAIT_MS, intervalMs: POLL_MS, now: Date.now, sleep: delay, label: `the window ${window}` }
  const windows = await pollUntil(() => listWindows(server), list => list.some(item => item.name === window), opts)
  const found = windows.find(item => item.name === window)
  if (!found) throw new HarnessError(`no tmux window named ${window}`)
  const pane = { server, id: found.pane }
  await passTrustIn(pane)

  return pane
}
