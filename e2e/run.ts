import { randomBytes } from 'node:crypto'
import { constants as fsConstants, existsSync } from 'node:fs'
import { access, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { e2eConfigDir, parseAuthStatus } from './lib/auth.ts'
import { liveEnv, SYSTEM_PATH } from './lib/env.ts'
import { HarnessError, LeakError } from './lib/errors.ts'
import { filterContext, isRecord, isStringList, leakCheck } from './lib/filter.ts'
import type { FilterContext } from './lib/filter.ts'
import { run, spawn } from './lib/proc.ts'
import type { Env } from './lib/proc.ts'
import { makeRunRoot, pruneRuns, removeTree, scratchBase } from './lib/scratch.ts'
import { publishSummary, ROW_KINDS, rowFileName, SIDECAR_SCHEMA, summaryText, TIERS } from './lib/summary.ts'
import { parseSidecar, writeRowResult, writeSummary } from './lib/summary.ts'
import type { RowKind, Sidecar, SuiteVersion, Tier } from './lib/summary.ts'

const E2E_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_DIR = dirname(E2E_DIR)
const MIN_NODE_MAJOR = 24
const CLAUDE_VERSION_MS = 30_000
const AUTH_STATUS_MS = 30_000

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

async function statusIdentities(claudeBin: string, e2eDir: string, root: string): Promise<readonly string[] | string> {
  const cwd = join(root, 'cwd')
  await mkdir(cwd)
  const env = liveEnv({ claudeBin })
  const result = await run([claudeBin, 'auth', 'status'], { cwd, env, timeoutMs: AUTH_STATUS_MS })
  const status = parseAuthStatus(result.stdout)
  if (status && !status.loggedIn) return `not logged in: ${e2eDir}`
  if (result.code !== 0) return `claude auth status exited ${result.code}`
  if (!status) return 'claude auth status printed no status'

  return status.identityValues
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
    return await statusIdentities(claudeBin, e2eDir, root)
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

function parseEntry(value: unknown, suite: string): Entry | null {
  if (!isRecord(value)) return null
  const { id, half, title, tier, kind, file, fixture, clipboard } = value
  if (typeof id !== 'string' || typeof title !== 'string' || typeof file !== 'string') return null
  const entryTier = TIERS.find(item => item === tier)
  const entryKind = ROW_KINDS.find(item => item === kind)
  const entryHalf = halfOf(half)
  if (!entryTier || !entryKind || entryHalf === null || !isStringList(fixture)) return null
  if (clipboard !== undefined && typeof clipboard !== 'boolean') return null

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

function childEnv(tier: Tier, runId: string, scratch: string, resultsDir: string, claudeBin: string | null): Env {
  return {
    ...process.env,
    E2E_RUN: runId,
    E2E_RUN_DIR: resultsDir,
    E2E_SCRATCH: scratch,
    E2E_FIXTURES: join(scratch, 'fixtures'),
    E2E_TIER: tier,
    E2E_CLAUDE_BIN: claudeBin ?? undefined,
    E2E_AUTH_SEED: undefined,
    E2E_FILTER_FILE: undefined,
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

async function runSelected(
  cli: RunCli,
  suites: readonly Suite[],
  selection: Selection,
  runId: string,
  scratch: string,
): Promise<number> {
  const resultsDir = join(E2E_DIR, 'results', runId)
  const claudeBin = await resolveOnPath('claude', process.env.PATH ?? '')
  const claude = claudeBin ? await claudeVersion(claudeBin, scratch) : 'absent'
  const env = childEnv(cli.tier, runId, scratch, resultsDir, claudeBin)
  const concurrency = Math.max(1, availableParallelism() - 1)
  const unitFiles = cli.tier === 'offline' ? await unitSpecFiles() : []
  const unitCode = unitFiles.length > 0 ? await nodeTest(unitFiles, concurrency, env) : 0
  const rowFiles = [...new Set(selection.entries.map(entry => entry.file))]
  if (rowFiles.length > 0) await nodeTest(rowFiles, concurrency, env)

  const ctx = filterContext(process.env)
  const rows = await collectRows(resultsDir, selection.entries, cli.tier, ctx)
  const versions = await suiteVersions(suites)
  const summaryPath = join(resultsDir, 'SUMMARY.md')
  const text = summaryText({ run: runId, tier: cli.tier, claude, versions, rows })
  const written = await writeRunSummary(summaryPath, text, ctx)
  const publishName = `${suites.map(suite => suite.name).join('-')}-E2E-SUMMARY-${runId}.md`
  const published =
    !written || cli.publish === null || await publishRunSummary(summaryPath, cli.publish, publishName, ctx)
  if (unitCode !== 0 || !written || !published) return 1

  return verdictExit(rows, cli.allowProductFail)
}

async function runTier(cli: RunCli): Promise<number> {
  const suites = await loadSuites()
  const selection = selectEntries(suites, cli.tier, cli.rows)
  if (selection.unknown.length > 0) return refuse(`unknown row id: ${selection.unknown.join(', ')}`)
  const now = Date.now()
  const runId = makeRunId(now, randomBytes(2).toString('hex'))
  const base = scratchBase()
  for (const warning of await pruneRuns(base, now)) process.stderr.write(`e2e: ${warning}\n`)
  const scratch = await makeRunRoot(base, runId)
  process.env.E2E_SCRATCH = scratch
  await mkdir(join(E2E_DIR, 'results', runId), { recursive: true })
  process.stdout.write(`e2e: run ${runId}, tier ${cli.tier}\n`)
  for (const note of selection.notes) process.stdout.write(`e2e: ${note}\n`)

  let code = 1
  try {
    code = await runSelected(cli, suites, selection, runId, scratch)
  } catch (error) {
    process.stderr.write(`e2e: ${messageOf(error)}\n`)
  }
  process.stdout.write(`e2e: run ${runId} exit ${code} summary e2e/results/${runId}/SUMMARY.md\n`)

  return code
}

async function main(argv: readonly string[]): Promise<number> {
  const major = Number(process.versions.node.split('.')[0])
  if (major < MIN_NODE_MAJOR) return refuse(`needs Node ${MIN_NODE_MAJOR} or newer, this is ${process.version}`)
  const cli = parseCli(argv)
  if (typeof cli === 'string') return refuse(cli)
  if (cli.mode === 'leak-check') return leakCheckFiles(cli)
  if (cli.tier === 'live') return refuse('the live tier is not built yet')

  return runTier(cli)
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  process.exitCode = refuse(messageOf(error))
}
