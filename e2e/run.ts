import { randomBytes } from 'node:crypto'
import { constants as fsConstants, existsSync, realpathSync } from 'node:fs'
import { access, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { e2eConfigDir, e2eConfigPath, writeFilterFile } from './lib/auth.ts'
import { cassetteState, cassetteTargetOf, parseRecordMode, planText } from './lib/cassette.ts'
import type { CassetteInputs, CassetteMode, CassettePlan } from './lib/cassette.ts'
import { authPreflight, authStatus } from './lib/claude.ts'
import type { PreflightStage } from './lib/claude.ts'
import { otherEntryChanges, restoreState, snapshotState } from './lib/config-state.ts'
import type { TopEntry } from './lib/config-state.ts'
import { hostUser, isRealConfig, liveEnv, SYSTEM_PATH, writeClaudeFence } from './lib/env.ts'
import type { ChildEnv, HostUser } from './lib/env.ts'
import { HarnessError, LeakError } from './lib/errors.ts'
import { filterContext, filterText, isRecord, isStringList, leakCheck } from './lib/filter.ts'
import type { FilterContext } from './lib/filter.ts'
import { fixtureDir, variantClosure } from './lib/fixture.ts'
import type { BuildContext, Builder } from './lib/fixture.ts'
import { compareGuard, fenceRefusals, fleetBeats, globalAwayActive, guardSnapshot } from './lib/guard.ts'
import { keychainDigest, needlesOf, projectTranscripts, removeSessionFiles, testSessionIds } from './lib/guard.ts'
import type { GuardResult, GuardSnapshot, KeychainDigest, Needles, Removal } from './lib/guard.ts'
import { run, spawn } from './lib/proc.ts'
import type { Env } from './lib/proc.ts'
import { roleWaves } from './lib/schedule.ts'
import { isUnder, makeRunRoot, pruneRuns, removeTree, scratchBase } from './lib/scratch.ts'
import { publishSummary, ROW_KINDS, rowFileName, SIDECAR_SCHEMA, summaryText, TIERS } from './lib/summary.ts'
import { parseSidecar, writeRowResult, writeSummary } from './lib/summary.ts'
import type { FixtureStatus, RowKind, Sidecar, SuiteVersion, Tier } from './lib/summary.ts'
import { runSocketPrefix, sweepServers } from './lib/tmux.ts'

const E2E_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_DIR = dirname(E2E_DIR)
const MIN_NODE_MAJOR = 24
const CLAUDE_VERSION_MS = 30_000
const LIVE_CONCURRENCY = 2
const SESSION_SETTLE_MS = 5_000
const KEYCHAIN_LIST_MS = 30_000
const BASELINE_PLUGINS = ['cadre', 'autopilot', 'agent-fleet'] as const
const LOCK_PID_FILE = 'pid'
const GUARD_PENDING = 'the guard check runs after the session cleanup'
const POSITIVE_WHOLE_RE = /^[1-9][0-9]*$/
const CLIPBOARD_MS = 10_000
const BUILT = 'built'
const KEYCHAIN_LIST_ARGV = ['/usr/bin/security', 'dump-keychain'] as const

const OPTIONS = {
  tier: { type: 'string' },
  rows: { type: 'string' },
  build: { type: 'string' },
  publish: { type: 'string' },
  'allow-product-fail': { type: 'boolean' },
  'leak-check': { type: 'string' },
  'generic-only': { type: 'boolean' },
} as const

type LeakCheckCli = {
  readonly mode: 'leak-check'
  readonly files: readonly string[]
  readonly genericOnly: boolean
}

type RunCli = {
  readonly mode: 'run'
  readonly tier: Tier
  readonly rows: readonly string[] | null
  readonly build: readonly string[]
  readonly publish: string | null
  readonly allowProductFail: boolean
}

type Entry = {
  readonly suite: string
  readonly id: string
  readonly half: string
  readonly title: string
  readonly tier: Tier
  readonly kind: RowKind
  readonly file: string
  readonly fixture: readonly string[]
  readonly clipboard: boolean
  readonly exclusive: boolean
  readonly roleSession: string | null
  readonly cassette: CassetteInputs | null
}

type Suite = {
  readonly name: string
  readonly entries: readonly Entry[]
}

type Selection = {
  readonly entries: readonly Entry[]
  readonly notes: readonly string[]
  readonly unknown: readonly string[]
}

type RunInfo = {
  readonly tier: Tier
  readonly id: string
  readonly scratch: string
  readonly resultsDir: string
}

type LiveVars = {
  readonly e2eDir: string
  readonly filterFile: string
  readonly claude: string
}

type VariantMap = ReadonlyMap<string, Builder>

type Plans = ReadonlyMap<Entry, CassettePlan>

type LiveSetup = {
  readonly cli: RunCli
  readonly suites: readonly Suite[]
  readonly selection: Selection
  readonly claudeBin: string
  readonly e2eDir: string
  readonly host: HostUser
  readonly needles: Needles
  readonly concurrency: number
  readonly mode: CassetteMode
  readonly variants: VariantMap
}

type WorkLog = {
  readonly fixtures: FixtureStatus[]
  readonly guard: string[]
  windows: number
  failed: boolean
  stopped: string | null
}

type WindowResult = {
  readonly ran: boolean
  readonly error: string | null
}

type LiveResult = {
  readonly code: number
  readonly rows: readonly Sidecar[]
  readonly identities: readonly string[]
  readonly filterFile: string | null
  readonly clipboard: string | null
  readonly log: WorkLog
}

type LiveDone = {
  readonly before: GuardSnapshot
  readonly start: Removal
  readonly claude: string
  readonly result: LiveResult
}

type SessionPass = {
  readonly ids: readonly string[]
  readonly removal: Removal
}

type SessionCleanup = {
  readonly removed: number
  readonly failures: readonly string[]
  readonly recorded: ReadonlySet<string>
}

function emptyLog(): WorkLog {
  return { fixtures: [], guard: [], windows: 0, failed: false, stopped: null }
}

function emptyLive(log: WorkLog): LiveResult {
  return { code: 1, rows: [], identities: [], filterFile: null, clipboard: null, log }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function refuse(message: string): number {
  process.stderr.write(`e2e: ${message}\n`)

  return 2
}

function listOf(value: string | undefined): readonly string[] {
  return (value ?? '').split(',').map(item => item.trim()).filter(item => item.length > 0)
}

function parseFlags(argv: readonly string[]) {
  return parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false }).values
}

function parseCli(argv: readonly string[]): LeakCheckCli | RunCli | string {
  let flags: ReturnType<typeof parseFlags>
  try {
    flags = parseFlags(argv)
  } catch (error) {
    return messageOf(error)
  }
  if (flags['leak-check'] !== undefined) {
    const runFlag = flags.tier ?? flags.rows ?? flags.build ?? flags.publish
    if (runFlag !== undefined || flags['allow-product-fail']) return '--leak-check takes no tier and no run flag'
    const files = listOf(flags['leak-check'])
    if (files.length === 0) return '--leak-check needs at least one file'

    return { mode: 'leak-check', files, genericOnly: flags['generic-only'] === true }
  }
  if (flags['generic-only']) return '--generic-only goes with --leak-check'
  const tier = TIERS.find(item => item === flags.tier)
  if (!tier) return '--tier offline|live is required'
  const build = listOf(flags.build)
  if (tier === 'offline' && build.length > 0) return '--build is for the live tier only'

  return {
    mode: 'run',
    tier,
    rows: flags.rows === undefined ? null : listOf(flags.rows),
    build,
    publish: flags.publish ?? null,
    allowProductFail: flags['allow-product-fail'] === true,
  }
}

async function statusIdentities(claudeBin: string, root: string): Promise<readonly string[] | string> {
  const cwd = join(root, 'cwd')
  await mkdir(cwd)
  const status = await authStatus(cwd, liveEnv({ claudeBin }), claudeBin)

  return typeof status === 'string' ? status : status.identityValues
}

async function rebuildIdentities(): Promise<readonly string[] | string> {
  const claudeBin = await resolveOnPath('claude', process.env.PATH ?? '')
  if (!claudeBin) return 'claude is not on PATH'
  let e2eDir: string
  try {
    e2eDir = e2eConfigDir()
  } catch (error) {
    return messageOf(error)
  }
  const base = scratchBase()
  const root = await makeRunRoot(base, `leak-${randomBytes(2).toString('hex')}`)
  process.env.E2E_SCRATCH = root
  process.env.E2E_CONFIG_DIR = e2eDir
  try {
    return await statusIdentities(claudeBin, root)
  } catch (error) {
    return messageOf(error)
  } finally {
    await removeTree(root, base)
  }
}

async function leakCheckFiles(cli: LeakCheckCli): Promise<number> {
  const identities = cli.genericOnly ? [] : await rebuildIdentities()
  if (typeof identities === 'string') {
    process.stderr.write(`leak-check: identity values unavailable: ${identities}\n`)
    return 2
  }
  if (!cli.genericOnly) process.stdout.write(`leak-check: ${identities.length} identity value(s) rebuilt\n`)
  const ctx = filterContext(process.env, { identities })
  let code = 0
  for (const file of cli.files) {
    const text = await readFile(file, 'utf8').catch(() => null)
    if (text === null) {
      process.stderr.write(`leak-check: ${file}: cannot read\n`)
      code = 1
      continue
    }
    try {
      leakCheck(text, ctx)
    } catch (error) {
      if (!(error instanceof LeakError)) throw error
      process.stderr.write(`leak-check: ${file}: ${error.message}\n`)
      code = 1
    }
  }
  if (code === 0) process.stdout.write(`leak-check: ${cli.files.length} file(s) clean\n`)

  return code
}

function halfOf(value: unknown): string | null {
  if (value === undefined) return ''
  if (value === 'a' || value === 'b') return value

  return null
}

function cassetteInputsOf(value: unknown): CassetteInputs | null {
  if (!isRecord(value) || !isStringList(value.inputs)) return null
  const { inputs, ttlDays } = value
  if (ttlDays === undefined) return { inputs }
  if (typeof ttlDays !== 'number' || !Number.isFinite(ttlDays) || ttlDays <= 0) return null

  return { inputs, ttlDays }
}

function parseEntry(value: unknown, suite: string): Entry | null {
  if (!isRecord(value)) return null
  const { id, half, title, tier, kind, file, fixture, clipboard, exclusive, roleSession, cassette } = value
  if (typeof id !== 'string' || typeof title !== 'string' || typeof file !== 'string') return null
  const entryTier = TIERS.find(item => item === tier)
  const entryKind = ROW_KINDS.find(item => item === kind)
  const entryHalf = halfOf(half)
  if (!entryTier || !entryKind || entryHalf === null || !isStringList(fixture)) return null
  if (clipboard !== undefined && typeof clipboard !== 'boolean') return null
  if (exclusive !== undefined && typeof exclusive !== 'boolean') return null
  if (roleSession !== undefined && (typeof roleSession !== 'string' || roleSession === '')) return null
  const cassetteInputs = cassette === undefined ? null : cassetteInputsOf(cassette)
  if (cassette !== undefined && cassetteInputs === null) return null

  return {
    suite,
    id,
    half: entryHalf,
    title,
    tier: entryTier,
    kind: entryKind,
    file: relative(REPO_DIR, join(E2E_DIR, suite, file)),
    fixture,
    clipboard: clipboard === true,
    exclusive: exclusive === true,
    roleSession: typeof roleSession === 'string' ? roleSession : null,
    cassette: cassetteInputs,
  }
}

function registryEntries(module: unknown, suite: string): readonly Entry[] {
  const rows: unknown = isRecord(module) ? module.ROWS : undefined
  if (!Array.isArray(rows)) throw new HarnessError(`e2e/${suite}/rows.ts exports no ROWS list`)

  return rows.map((row: unknown, index) => {
    const entry = parseEntry(row, suite)
    if (!entry) throw new HarnessError(`e2e/${suite}/rows.ts: entry ${index} is malformed`)

    return entry
  })
}

async function suiteDirs(): Promise<readonly string[]> {
  const entries = await readdir(E2E_DIR, { withFileTypes: true })

  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
}

async function loadSuites(): Promise<readonly Suite[]> {
  const suites: Suite[] = []
  for (const name of await suiteDirs()) {
    const registry = join(E2E_DIR, name, 'rows.ts')
    if (!existsSync(registry)) continue
    const module: unknown = await import(pathToFileURL(registry).href)
    suites.push({ name, entries: registryEntries(module, name) })
  }

  return suites
}

function parseBuilder(value: unknown): Builder | null {
  if (!isRecord(value) || !isStringList(value.from)) return null
  const { build, exclusive } = value
  if (typeof build !== 'function') return null
  if (exclusive !== undefined && typeof exclusive !== 'boolean') return null

  return {
    from: value.from,
    exclusive: exclusive === true,
    build: async (ctx: BuildContext) => {
      await build(ctx)
    },
  }
}

async function loadVariants(suites: readonly Suite[]): Promise<VariantMap> {
  const variants = new Map<string, Builder>()
  for (const suite of suites) {
    const index = join(E2E_DIR, suite.name, 'fixtures', 'index.ts')
    if (!existsSync(index)) continue
    const module: unknown = await import(pathToFileURL(index).href)
    const map: unknown = isRecord(module) ? module.VARIANTS : undefined
    if (!isRecord(map)) throw new HarnessError(`e2e/${suite.name}/fixtures/index.ts exports no VARIANTS map`)
    for (const [name, value] of Object.entries(map)) {
      const builder = parseBuilder(value)
      if (!builder) throw new HarnessError(`e2e/${suite.name}/fixtures/index.ts: the variant ${name} is malformed`)
      if (variants.has(name)) throw new HarnessError(`the fixture variant ${name} is defined by two suites`)
      variants.set(name, builder)
    }
  }

  return variants
}

function closureOf(names: readonly string[], variants: VariantMap): readonly string[] {
  return variantClosure(names, name => variants.get(name)?.from)
}

function matches(entry: Entry, token: string): boolean {
  return token === entry.id || token === `${entry.id}${entry.half}`
}

function selectEntries(suites: readonly Suite[], tier: Tier, rows: readonly string[] | null): Selection {
  const all = suites.flatMap(suite => suite.entries)
  const tokens = rows ?? []
  const unknown = tokens.filter(token => !all.some(entry => matches(entry, token)))
  const picked = (entry: Entry): boolean => rows === null || tokens.some(token => matches(entry, token))
  const inTier = all.filter(entry => entry.tier === tier && picked(entry))
  const otherTier = tokens.filter(token => !unknown.includes(token) && !inTier.some(entry => matches(entry, token)))
  const written = inTier.filter(entry => existsSync(join(REPO_DIR, entry.file)))
  const notes = [
    ...otherTier.map(token => `${token}: not in the ${tier} tier`),
    ...inTier.filter(entry => !written.includes(entry)).map(entry => `${entry.id}${entry.half}: not written`),
  ]

  return { entries: written, notes, unknown }
}

function makeRunId(now: number, hex: string): string {
  const at = new Date(now)
  const two = (value: number): string => String(value).padStart(2, '0')
  const date = `${two(at.getUTCFullYear() % 100)}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}`
  const time = `${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}`

  return `${date}-${time}-${hex}`
}

async function resolveOnPath(name: string, pathValue: string): Promise<string | null> {
  for (const dir of pathValue.split(delimiter)) {
    if (!isAbsolute(dir)) continue
    const candidate = join(dir, name)
    const usable = await access(candidate, fsConstants.X_OK).then(() => stat(candidate)).then(
      stats => stats.isFile(),
      () => false,
    )
    if (usable) return candidate
  }

  return null
}

async function claudeVersion(bin: string, scratch: string): Promise<string> {
  const home = join(scratch, 'claude-version')
  await mkdir(home, { recursive: true })
  const env = { PATH: [dirname(bin), dirname(process.execPath), SYSTEM_PATH].join(':'), HOME: home }
  const result = await run([bin, '--version'], { cwd: home, env, timeoutMs: CLAUDE_VERSION_MS }).catch(() => null)
  const line = result?.code === 0 ? result.stdout.trim().split('\n')[0] : undefined

  return line || 'absent (claude --version failed)'
}

async function pluginVersion(suite: string): Promise<string> {
  const text = await readFile(join(REPO_DIR, suite, '.claude-plugin', 'plugin.json'), 'utf8').catch(() => null)
  if (text === null) return 'unknown'
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) && typeof value.version === 'string' ? value.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

async function suiteVersions(suites: readonly Suite[]): Promise<readonly SuiteVersion[]> {
  return Promise.all(suites.map(async suite => ({ name: suite.name, version: await pluginVersion(suite.name) })))
}

async function unitSpecFiles(): Promise<readonly string[]> {
  const libDir = join(E2E_DIR, 'lib')
  const lib = (await readdir(libDir)).filter(name => name.endsWith('.test.ts')).sort().map(name => join(libDir, name))
  const registries = (await suiteDirs()).map(name => join(E2E_DIR, name, 'rows.test.ts')).filter(existsSync)

  return [...lib, ...registries].map(path => relative(REPO_DIR, path))
}

function childEnv(info: RunInfo, claudeBin: string | null, live: LiveVars | null): Env {
  return {
    ...process.env,
    E2E_RUN: info.id,
    E2E_RUN_DIR: info.resultsDir,
    E2E_SCRATCH: info.scratch,
    E2E_FIXTURES: join(info.scratch, 'fixtures'),
    E2E_TIER: info.tier,
    E2E_CLAUDE_BIN: claudeBin ?? undefined,
    E2E_CONFIG_DIR: live?.e2eDir,
    E2E_FILTER_FILE: live?.filterFile,
    E2E_CLAUDE_VERSION: live?.claude,
  }
}

async function nodeTest(files: readonly string[], concurrency: number, env: Env): Promise<number> {
  const argv = [
    process.execPath,
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--test',
    '--test-reporter=spec',
    `--test-concurrency=${concurrency}`,
    ...files,
  ]
  const result = await spawn(argv, { cwd: REPO_DIR, env, inherit: true, host: true }).done

  return result.code
}

function missingSidecar(entry: Entry): Sidecar {
  return {
    schema: SIDECAR_SCHEMA,
    id: entry.id,
    half: entry.half,
    title: entry.title,
    tier: entry.tier,
    kind: entry.kind,
    verdict: 'error',
    reason: 'no result: the test file did not report this row (it crashed, did not load or was cut short)',
    checks: [],
    observations: [],
    evidence: [],
    screens: [],
    notAutomated: [],
    cassette: 'none',
    durationMs: 0,
  }
}

function brokenSidecar(name: string, tier: Tier): Sidecar {
  return {
    schema: SIDECAR_SCHEMA,
    id: name,
    half: '',
    title: 'unreadable result',
    tier,
    kind: 'pass',
    verdict: 'error',
    reason: 'the row result file is not a valid sidecar',
    checks: [],
    observations: [],
    evidence: [],
    screens: [],
    notAutomated: [],
    cassette: 'none',
    durationMs: 0,
  }
}

async function collectRows(
  dir: string,
  selected: readonly Entry[],
  tier: Tier,
  ctx: FilterContext,
): Promise<readonly Sidecar[]> {
  const rows: Sidecar[] = []
  for (const name of (await readdir(dir)).filter(item => item.endsWith('.json')).sort()) {
    const row = parseSidecar(await readFile(join(dir, name), 'utf8'))
    rows.push(row ?? brokenSidecar(name.slice(0, -'.json'.length), tier))
  }
  for (const entry of selected) {
    const name = rowFileName(entry.id, entry.half)
    if (rows.some(row => rowFileName(row.id, row.half) === name)) continue
    const missing = missingSidecar(entry)
    await writeRowResult(dir, missing, ctx)
    rows.push(missing)
  }

  return rows
}

async function writeRunSummary(path: string, text: string, ctx: FilterContext): Promise<boolean> {
  try {
    await writeSummary(path, text, ctx)
    return true
  } catch (error) {
    if (!(error instanceof LeakError)) throw error
    process.stderr.write(`e2e: SUMMARY.md not written: ${error.message}\n`)
    return false
  }
}

async function publishRunSummary(src: string, dir: string, name: string, ctx: FilterContext): Promise<boolean> {
  const isDir = await stat(dir).then(stats => stats.isDirectory(), () => false)
  if (!isDir) {
    process.stderr.write('e2e: --publish needs an existing folder\n')
    return false
  }
  try {
    await publishSummary(src, dir, name, ctx)
    process.stdout.write(`e2e: published ${name}\n`)
    return true
  } catch (error) {
    if (!(error instanceof LeakError)) throw error
    process.stderr.write(`e2e: the published summary was not written: ${error.message}\n`)
    return false
  }
}

function verdictExit(rows: readonly Sidecar[], allowProductFail: boolean): number {
  if (rows.some(row => row.verdict === 'error')) return 1
  if (!allowProductFail && rows.some(row => row.verdict === 'fail')) return 1

  return 0
}

function filesOf(entries: readonly Entry[]): readonly string[] {
  return [...new Set(entries.map(entry => entry.file))]
}

function summaryPathOf(info: RunInfo): string {
  return join(info.resultsDir, 'SUMMARY.md')
}

async function publishIfAsked(
  cli: RunCli,
  suites: readonly Suite[],
  info: RunInfo,
  ctx: FilterContext,
): Promise<boolean> {
  if (cli.publish === null) return true
  const name = `${suites.map(suite => suite.name).join('-')}-E2E-SUMMARY-${info.id}.md`

  return publishRunSummary(summaryPathOf(info), cli.publish, name, ctx)
}

async function runOffline(cli: RunCli, suites: readonly Suite[], selection: Selection, info: RunInfo): Promise<number> {
  const claudeBin = await resolveOnPath('claude', process.env.PATH ?? '')
  const claude = claudeBin ? await claudeVersion(claudeBin, info.scratch) : 'absent'
  const env = childEnv(info, claudeBin, null)
  const concurrency = Math.max(1, availableParallelism() - 1)
  const unitFiles = await unitSpecFiles()
  const unitCode = unitFiles.length > 0 ? await nodeTest(unitFiles, concurrency, env) : 0
  const rowFiles = filesOf(selection.entries)
  if (rowFiles.length > 0) await nodeTest(rowFiles, concurrency, env)

  const ctx = filterContext(process.env)
  const rows = await collectRows(info.resultsDir, selection.entries, info.tier, ctx)
  const versions = await suiteVersions(suites)
  const text = summaryText({ run: info.id, tier: info.tier, claude, versions, rows })
  const written = await writeRunSummary(summaryPathOf(info), text, ctx)
  const published = !written || await publishIfAsked(cli, suites, info, ctx)
  if (unitCode !== 0 || !written || !published) return 1

  return verdictExit(rows, cli.allowProductFail)
}

async function startRun(tier: Tier, selection: Selection): Promise<RunInfo> {
  const now = Date.now()
  const id = makeRunId(now, randomBytes(2).toString('hex'))
  const base = scratchBase()
  for (const warning of await pruneRuns(base, now)) process.stderr.write(`e2e: ${warning}\n`)
  const scratch = await makeRunRoot(base, id)
  process.env.E2E_SCRATCH = scratch
  process.env.E2E_FIXTURES = join(scratch, 'fixtures')
  const resultsDir = join(E2E_DIR, 'results', id)
  await mkdir(resultsDir, { recursive: true })
  process.stdout.write(`e2e: run ${id}, tier ${tier}\n`)
  for (const note of selection.notes) process.stdout.write(`e2e: ${note}\n`)

  return { tier, id, scratch, resultsDir }
}

function printRunLine(id: string, code: number): void {
  process.stdout.write(`e2e: run ${id} exit ${code} summary e2e/results/${id}/SUMMARY.md\n`)
}

function say(text: string, ctx: FilterContext, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`e2e: ${filterText(text, ctx)}\n`)
}

function liveFilter(identities: readonly string[]): FilterContext {
  return filterContext(process.env, { identities })
}

function liveConcurrency(value: string | undefined): number | null {
  if (value === undefined || value === '') return LIVE_CONCURRENCY

  return POSITIVE_WHOLE_RE.test(value) ? Number(value) : null
}

function e2eDirReason(dir: string, host: HostUser): string | null {
  if (isRealConfig(dir, host, process.env)) return 'the e2e config dir is the real config dir or lies under it'
  const repo = realpathSync(REPO_DIR)
  if (dir === repo || isUnder(dir, repo)) return 'the e2e config dir is inside the repo'

  return null
}

function errorCode(error: unknown): unknown {
  return isRecord(error) ? error.code : undefined
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) === 'EPERM'
  }
}

async function lockPid(lock: string): Promise<number> {
  return Number((await readFile(join(lock, LOCK_PID_FILE), 'utf8').catch(() => '')).trim())
}

async function makeLock(lock: string): Promise<boolean> {
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return false
    throw error
  }
  await writeFile(join(lock, LOCK_PID_FILE), `${process.pid}\n`)

  return true
}

async function takeLock(lock: string): Promise<boolean> {
  if (await makeLock(lock)) return true
  if (isAlive(await lockPid(lock))) return false
  const stats = await lstat(lock).catch(() => null)
  if (stats?.isSymbolicLink()) throw new HarnessError(`the run lock is a symlink: ${lock}`)
  await rm(lock, { recursive: true, force: true })

  return makeLock(lock)
}

async function releaseLock(lock: string): Promise<void> {
  if (await lockPid(lock) !== process.pid) return

  await rm(lock, { recursive: true, force: true })
}

async function isGlobalAway(home: string, now: number): Promise<boolean> {
  const text = await readFile(join(home, '.claude', 'autopilot', 'status', 'global.json'), 'utf8').catch(() => '')

  return globalAwayActive(text, now)
}

async function keychainState(host: HostUser): Promise<KeychainDigest | null | undefined> {
  if (process.platform !== 'darwin') return undefined
  const env = { PATH: SYSTEM_PATH, HOME: host.home, USER: host.user }
  const opts = { cwd: REPO_DIR, env, timeoutMs: KEYCHAIN_LIST_MS, host: true }
  const result = await run(KEYCHAIN_LIST_ARGV, opts).catch(() => null)

  return result?.code === 0 ? keychainDigest(result.stdout) : null
}

function keychainNote(digest: KeychainDigest | null | undefined): string {
  if (digest === undefined) return 'no keychain listing off macOS'
  if (digest === null) return 'keychain listing unavailable'

  return `keychain: ${digest.count} Claude Code items`
}

async function removeLeftovers(setup: LiveSetup): Promise<Removal> {
  const transcripts = await projectTranscripts(setup.e2eDir)
  const ids = testSessionIds(transcripts, await fleetBeats(setup.host.home), scratchBase(), setup.e2eDir)
  const removal = await removeSessionFiles(setup.host.home, ids)
  process.stdout.write(`e2e: removed ${removal.removed} leftover files of earlier test sessions\n`)

  return removal
}

async function removeRunSessions(setup: LiveSetup, before: GuardSnapshot): Promise<SessionPass> {
  const existed = new Set(before.sessionFiles)
  const beats = (await fleetBeats(setup.host.home)).filter(beat => !existed.has(`fleet/${beat.id}.json`))
  const ids = testSessionIds(await projectTranscripts(setup.e2eDir), beats, scratchBase(), setup.e2eDir)

  return { ids, removal: await removeSessionFiles(setup.host.home, ids) }
}

async function cleanupSessions(setup: LiveSetup, before: GuardSnapshot): Promise<SessionCleanup> {
  const first = await removeRunSessions(setup, before)
  // A session that dies with its tmux server can still write one last beat after the first pass.
  await delay(SESSION_SETTLE_MS)
  const second = await removeRunSessions(setup, before)

  return {
    removed: first.removal.removed + second.removal.removed,
    failures: [...new Set([...first.removal.failures, ...second.removal.failures])],
    recorded: new Set([...first.ids, ...second.ids]),
  }
}

async function checkGuard(
  setup: LiveSetup,
  info: RunInfo,
  before: GuardSnapshot,
  recorded: ReadonlySet<string>,
): Promise<GuardResult> {
  const after = await guardSnapshot(setup.host.home, setup.needles, await keychainState(setup.host))
  const beats = await fleetBeats(setup.host.home)
  const beatCwds = new Map(beats.flatMap(beat => (beat.cwd === null ? [] : [[beat.id, beat.cwd] as const])))
  const refusals = await fenceRefusals(info.scratch)

  return compareGuard(before, after, { needles: setup.needles, refusals, recorded, beatCwds })
}

function guardItems(notRemoved: readonly string[], cleanup: SessionCleanup, guard: GuardResult): readonly string[] {
  return [
    ...guard.failures.map(line => `failure: ${line}`),
    ...notRemoved.map(rel => `session files not removed: ${rel}`),
    `removed ${cleanup.removed} files of ${cleanup.recorded.size} test sessions`,
    ...guard.warnings.map(line => `warning: ${line}`),
  ]
}

function preflightLines(stage: PreflightStage, reason: string): readonly string[] {
  if (stage === 'plugins') return [`e2e dir plugin baseline failed: ${reason}`]

  return [reason, `log in again: CLAUDE_CONFIG_DIR=${e2eConfigPath()} claude auth login`]
}

function clipboardEnv(host: HostUser): ChildEnv {
  return { PATH: SYSTEM_PATH, HOME: host.home, USER: host.user, LANG: 'en_US.UTF-8' }
}

async function saveClipboard(host: HostUser, ctx: FilterContext): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  const opts = { cwd: REPO_DIR, env: clipboardEnv(host), timeoutMs: CLIPBOARD_MS, host: true }
  const result = await run(['/usr/bin/pbpaste'], opts).catch(() => null)
  if (result?.code === 0) return result.stdout
  say('the clipboard was not saved, so it is not restored after the run', ctx, process.stderr)

  return null
}

async function restoreClipboard(text: string | null, host: HostUser, ctx: FilterContext): Promise<void> {
  if (text === null) return
  const opts = { cwd: REPO_DIR, env: clipboardEnv(host), input: text, timeoutMs: CLIPBOARD_MS, host: true }
  const result = await run(['/usr/bin/pbcopy'], opts).catch(() => null)
  if (result?.code === 0) return

  say('the clipboard was not restored', ctx, process.stderr)
}

async function sweepTmux(info: RunInfo, ctx: FilterContext): Promise<void> {
  const opts = { env: { PATH: SYSTEM_PATH }, cwd: REPO_DIR, host: true }
  try {
    const swept = await sweepServers(runSocketPrefix(info.id), opts)
    say(`removed ${swept.length} tmux server sockets of this run`, ctx)
  } catch (error) {
    say(messageOf(error), ctx, process.stderr)
  }
}

async function writeNotRun(
  info: RunInfo,
  entries: readonly Entry[],
  reason: string,
  ctx: FilterContext,
): Promise<void> {
  for (const entry of entries) {
    const row = { ...missingSidecar(entry), reason: `not run: ${reason}` }
    try {
      await writeRowResult(info.resultsDir, row, ctx)
    } catch (error) {
      if (!(error instanceof LeakError)) throw error
      await writeRowResult(info.resultsDir, { ...row, reason: 'not run: the reason failed the leak check' }, ctx)
    }
  }
}

async function exclusiveWindow(
  setup: LiveSetup,
  info: RunInfo,
  name: string,
  body: () => Promise<string | null>,
  log: WorkLog,
  ctx: FilterContext,
): Promise<WindowResult> {
  log.windows += 1
  const snapshot = join(info.scratch, 'state', String(log.windows))
  let before: readonly TopEntry[]
  try {
    before = await snapshotState(setup.e2eDir, snapshot)
  } catch (error) {
    return { ran: false, error: `the e2e dir state snapshot before ${name} failed: ${messageOf(error)}` }
  }
  const error = await body().catch(messageOf)
  try {
    const after = await restoreState(setup.e2eDir, snapshot)
    log.guard.push(`e2e dir state restored after ${name}`)
    for (const entry of otherEntryChanges(before, after)) {
      log.guard.push(`e2e dir entry ${entry} changed in the exclusive window`)
    }
    return { ran: true, error }
  } catch (restoreError) {
    const line = `e2e dir state not restored after ${name}: ${messageOf(restoreError)}`
    say(line, ctx, process.stderr)
    log.guard.push(line)
    log.stopped = line
    log.failed = true
    return { ran: true, error: error ?? line }
  }
}

async function attemptBuild(variant: string, builder: Builder): Promise<string | null> {
  try {
    const repo = fixtureDir(variant)
    await mkdir(dirname(repo), { recursive: true })
    await builder.build({ variant, dir: dirname(repo), repo })
    return existsSync(repo) ? null : 'the builder made no repo'
  } catch (error) {
    return messageOf(error)
  }
}

async function fixtureStatus(
  setup: LiveSetup,
  info: RunInfo,
  variant: string,
  failed: ReadonlySet<string>,
  log: WorkLog,
  ctx: FilterContext,
): Promise<string> {
  if (log.stopped !== null) return `error: not built: ${log.stopped}`
  const builder = setup.variants.get(variant)
  if (!builder) return 'error: no builder'
  const broken = builder.from.find(name => failed.has(name))
  if (broken !== undefined) return `error: ${broken} failed`
  say(`building the fixture ${variant}`, ctx)
  const build = (): Promise<string | null> => attemptBuild(variant, builder)
  const outcome = builder.exclusive === true
    ? await exclusiveWindow(setup, info, variant, build, log, ctx)
    : { ran: true, error: await build() }

  return outcome.error === null ? BUILT : `error: ${outcome.error}`
}

async function buildFixtures(
  setup: LiveSetup,
  info: RunInfo,
  variants: readonly string[],
  log: WorkLog,
  ctx: FilterContext,
): Promise<ReadonlySet<string>> {
  const failed = new Set<string>()
  for (const variant of variants) {
    const status = await fixtureStatus(setup, info, variant, failed, log, ctx)
    log.fixtures.push({ variant, status })
    say(`fixture ${variant}: ${status}`, ctx)
    if (status === BUILT) continue
    failed.add(variant)
    log.failed = true
  }

  return failed
}

function isLiveEntry(entry: Entry, plans: Plans): boolean {
  const plan = plans.get(entry)

  return plan === undefined || plan.action === 'record'
}

async function cassettePlans(setup: LiveSetup, claude: string, ctx: FilterContext): Promise<Plans> {
  const plans = new Map<Entry, CassettePlan>()
  const now = Date.now()
  for (const entry of setup.selection.entries) {
    if (entry.cassette === null) continue
    const row = { id: entry.id, half: entry.half, cassette: entry.cassette }
    const target = cassetteTargetOf(E2E_DIR, entry.suite, join(REPO_DIR, entry.file), row)
    const plan = await cassetteState(target, { claude, mode: setup.mode, now })
    plans.set(entry, plan)
    say(`cassette ${rowFileName(entry.id, entry.half)}: ${planText(plan)}`, ctx)
  }

  return plans
}

function fixturesToBuild(setup: LiveSetup, plans: Plans): readonly string[] {
  const live = setup.selection.entries.filter(entry => isLiveEntry(entry, plans))

  return closureOf([...live.flatMap(entry => entry.fixture), ...setup.cli.build], setup.variants)
}

function blockedReason(
  entry: Entry,
  setup: LiveSetup,
  failed: ReadonlySet<string>,
  plans: Plans,
  log: WorkLog,
): string | null {
  if (log.stopped !== null) return log.stopped
  if (!isLiveEntry(entry, plans)) return null
  const variant = closureOf(entry.fixture, setup.variants).find(name => failed.has(name))

  return variant === undefined ? null : `the fixture ${variant} failed`
}

async function runnableEntries(
  setup: LiveSetup,
  info: RunInfo,
  failed: ReadonlySet<string>,
  plans: Plans,
  log: WorkLog,
  ctx: FilterContext,
): Promise<readonly Entry[]> {
  const runnable: Entry[] = []
  for (const entry of setup.selection.entries) {
    const reason = blockedReason(entry, setup, failed, plans, log)
    if (reason === null) runnable.push(entry)
    else await writeNotRun(info, [entry], reason, ctx)
  }

  return runnable
}

async function spawnRows(
  setup: LiveSetup,
  info: RunInfo,
  live: LiveVars,
  runnable: readonly Entry[],
  log: WorkLog,
  ctx: FilterContext,
): Promise<void> {
  const env = childEnv(info, setup.claudeBin, live)
  const parallel = runnable.filter(entry => !entry.exclusive && !entry.clipboard)
  const clipboard = filesOf(runnable.filter(entry => !entry.exclusive && entry.clipboard))
  for (const files of roleWaves(parallel)) await nodeTest(files, setup.concurrency, env)
  if (clipboard.length > 0) await nodeTest(clipboard, 1, env)
  for (const file of filesOf(runnable.filter(entry => entry.exclusive))) {
    const entries = runnable.filter(entry => entry.file === file)
    if (log.stopped !== null) {
      await writeNotRun(info, entries, log.stopped, ctx)
      continue
    }
    const body = async (): Promise<null> => {
      await nodeTest([file], 1, env)
      return null
    }
    const outcome = await exclusiveWindow(setup, info, file, body, log, ctx)
    if (!outcome.ran) await writeNotRun(info, entries, outcome.error ?? 'the exclusive window did not open', ctx)
  }
}

async function liveWork(
  setup: LiveSetup,
  info: RunInfo,
  live: LiveVars,
  log: WorkLog,
  ctx: FilterContext,
): Promise<readonly Sidecar[]> {
  const plans = await cassettePlans(setup, live.claude, ctx)
  const failed = await buildFixtures(setup, info, fixturesToBuild(setup, plans), log, ctx)
  const runnable = await runnableEntries(setup, info, failed, plans, log, ctx)
  await spawnRows(setup, info, live, runnable, log, ctx)

  return collectRows(info.resultsDir, setup.selection.entries, 'live', ctx)
}

async function liveBody(setup: LiveSetup, info: RunInfo, log: WorkLog, claude: string): Promise<LiveResult> {
  await writeClaudeFence(info.scratch, setup.claudeBin, setup.e2eDir)
  const cwd = join(info.scratch, 'preflight')
  await mkdir(cwd)
  const plugins = BASELINE_PLUGINS
  const preflight = await authPreflight({ cwd, marketplaceRoot: REPO_DIR, plugins, now: Date.now() })
  const { identities } = preflight
  const ctx = liveFilter(identities)
  if (!preflight.ok) {
    for (const line of preflightLines(preflight.stage, preflight.reason)) say(line, ctx, process.stderr)
    return { ...emptyLive(log), code: 2, identities }
  }
  say(`preflight passed, plugin baseline ${preflight.plugins}`, ctx)
  const filterFile = await writeFilterFile(info.scratch, identities)
  const clipboard = await saveClipboard(setup.host, ctx)
  try {
    const rows = await liveWork(setup, info, { e2eDir: setup.e2eDir, filterFile, claude }, log, ctx)
    const code = Math.max(verdictExit(rows, setup.cli.allowProductFail), log.failed ? 1 : 0)
    return { code, rows, identities, filterFile, clipboard, log }
  } catch (error) {
    say(messageOf(error), ctx, process.stderr)
    const rows = await collectRows(info.resultsDir, setup.selection.entries, 'live', ctx).catch(() => [])
    return { code: 1, rows, identities, filterFile, clipboard, log }
  }
}

async function removeFilterFile(path: string | null, scratch: string): Promise<boolean> {
  if (path === null) return true

  return removeTree(path, scratch).then(() => true, () => false)
}

function liveExit(code: number, notRemoved: readonly string[], guard: GuardResult, isWritten: boolean): number {
  if (guard.failures.length > 0) return 3
  if (code === 2) return 2
  if (notRemoved.length > 0 || !isWritten) return 1

  return code
}

async function finishLive(setup: LiveSetup, info: RunInfo, lock: string, done: LiveDone): Promise<number> {
  const { result } = done
  const { log } = result
  const ctx = liveFilter(result.identities)
  const versions = await suiteVersions(setup.suites)
  const summary = (guard: readonly string[]): string => summaryText({
    run: info.id,
    tier: 'live',
    claude: done.claude,
    versions,
    rows: result.rows,
    fixtures: log.fixtures,
    guard: [...log.guard, ...guard],
  })
  await writeRunSummary(summaryPathOf(info), summary([GUARD_PENDING]), ctx).catch(() => false)
  await sweepTmux(info, ctx)
  await restoreClipboard(result.clipboard, setup.host, ctx)
  const isFilterRemoved = await removeFilterFile(result.filterFile, info.scratch)
  const cleanup = await cleanupSessions(setup, done.before)
  await releaseLock(lock)
  const guard = await checkGuard(setup, info, done.before, cleanup.recorded)
  const notRemoved = [...new Set([...done.start.failures, ...cleanup.failures])]
  const items = [
    ...(isFilterRemoved ? [] : ['the filter values file was not removed']),
    ...guardItems(notRemoved, cleanup, guard),
  ]
  for (const item of items) say(item, ctx)
  const written = await writeRunSummary(summaryPathOf(info), summary(items), ctx)
  const published = !written || await publishIfAsked(setup.cli, setup.suites, info, ctx)

  return liveExit(result.code, notRemoved, guard, isFilterRemoved && written && published)
}

async function runLocked(setup: LiveSetup, lock: string): Promise<number> {
  if (await isGlobalAway(setup.host.home, Date.now())) {
    return refuse('global away is on: run /back --global, or wait until it ends')
  }
  const start = await removeLeftovers(setup)
  const before = await guardSnapshot(setup.host.home, setup.needles, await keychainState(setup.host))
  process.stdout.write(`e2e: guard snapshot taken (${keychainNote(before.keychain)})\n`)
  const info = await startRun('live', setup.selection)
  const claude = await claudeVersion(setup.claudeBin, info.scratch)
  const log = emptyLog()
  let result = emptyLive(log)
  try {
    result = await liveBody(setup, info, log, claude)
  } catch (error) {
    say(messageOf(error), filterContext(process.env), process.stderr)
  }
  const code = await finishLive(setup, info, lock, { before, start, claude, result })
  printRunLine(info.id, code)

  return code
}

async function variantsOf(cli: RunCli, suites: readonly Suite[], selection: Selection): Promise<VariantMap | string> {
  try {
    const variants = await loadVariants(suites)
    closureOf([...selection.entries.flatMap(entry => entry.fixture), ...cli.build], variants)

    return variants
  } catch (error) {
    return messageOf(error)
  }
}

async function runLive(cli: RunCli, suites: readonly Suite[], selection: Selection): Promise<number> {
  const concurrency = liveConcurrency(process.env.E2E_CONCURRENCY)
  if (concurrency === null) return refuse('E2E_CONCURRENCY must be a positive whole number')
  const mode = parseRecordMode(process.env.E2E_RECORD)
  if (mode === null) return refuse('E2E_RECORD must be once, none or all')
  if (!await resolveOnPath('tmux', SYSTEM_PATH)) return refuse(`tmux is not in ${SYSTEM_PATH}`)
  const claudeBin = await resolveOnPath('claude', process.env.PATH ?? '')
  if (!claudeBin) return refuse('claude is not on PATH')
  const host = hostUser()
  let e2eDir: string
  try {
    e2eDir = e2eConfigDir()
  } catch (error) {
    return refuse(messageOf(error))
  }
  const why = e2eDirReason(e2eDir, host)
  if (why) return refuse(why)
  const variants = await variantsOf(cli, suites, selection)
  if (typeof variants === 'string') return refuse(variants)
  process.env.E2E_CONFIG_DIR = e2eDir
  process.env.E2E_CLAUDE_BIN = claudeBin
  const lock = `${e2eDir}.lock`
  if (!await takeLock(lock)) return refuse(`another live run holds ${lock}`)
  const needles = needlesOf(scratchBase(), e2eDir)
  const setup = { cli, suites, selection, claudeBin, e2eDir, host, needles, concurrency, mode, variants }
  try {
    return await runLocked(setup, lock)
  } finally {
    await releaseLock(lock)
  }
}

async function runTier(cli: RunCli): Promise<number> {
  const suites = await loadSuites()
  const rows = cli.rows ?? (cli.build.length > 0 ? [] : null)
  const selection = selectEntries(suites, cli.tier, rows)
  if (selection.unknown.length > 0) return refuse(`unknown row id: ${selection.unknown.join(', ')}`)
  if (cli.tier === 'live') return runLive(cli, suites, selection)
  const info = await startRun(cli.tier, selection)

  let code = 1
  try {
    code = await runOffline(cli, suites, selection, info)
  } catch (error) {
    process.stderr.write(`e2e: ${messageOf(error)}\n`)
  }
  printRunLine(info.id, code)

  return code
}

async function main(argv: readonly string[]): Promise<number> {
  const major = Number(process.versions.node.split('.')[0])
  if (major < MIN_NODE_MAJOR) return refuse(`needs Node ${MIN_NODE_MAJOR} or newer, this is ${process.version}`)
  const cli = parseCli(argv)
  if (typeof cli === 'string') return refuse(cli)
  if (cli.mode === 'leak-check') return leakCheckFiles(cli)
  if (cli.tier === 'live' && process.env.CI !== undefined) return refuse('the live tier does not run in CI (CI is set)')

  return runTier(cli)
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  process.exitCode = refuse(messageOf(error))
}
