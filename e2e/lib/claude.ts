import { lstat, readFile, rm } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { expiresSoon, parseAuthStatus } from './auth.ts'
import type { AuthStatus } from './auth.ts'
import { liveEnv } from './env.ts'
import type { ChildEnv } from './env.ts'
import { HarnessError } from './errors.ts'
import { isRecord } from './filter.ts'
import { hashFolder } from './hash.ts'
import { run } from './proc.ts'
import type { Env, RunResult } from './proc.ts'
import { isUnder, scratchRoot } from './scratch.ts'

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
