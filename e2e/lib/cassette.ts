import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { HarnessError, LeakError } from './errors.ts'
import { filterText, isRecord, leakCheck } from './filter.ts'
import type { FilterContext } from './filter.ts'
import { hashFile, hashPath } from './hash.ts'
import type { RowBody, RowContext, RowMeta } from './row.ts'
import { filterSidecar, parseSidecar, rowDocText, rowFileName, SIDECAR_SCHEMA } from './summary.ts'
import type { Check, Note, NotAutomated, Observation, RowKind, Sidecar, Verdict } from './summary.ts'

export const CASSETTE_SCHEMA = 1
export const DAY_MS = 86_400_000

const MODES: readonly CassetteMode[] = ['once', 'none', 'all']
const NO_CASSETTE = 'no cassette yet'

export type CassetteMode = 'once' | 'none' | 'all'

export type CassetteInputs = {
  readonly inputs: readonly string[]
  readonly ttlDays?: number | undefined
}

export type CassetteTarget = CassetteInputs & {
  readonly name: string
  readonly dir: string
  readonly repo: string
  readonly testFile: string
}

export type CassetteWorld = {
  readonly claude: string
  readonly mode: CassetteMode
  readonly now: number
}

export type CassetteKey = {
  readonly schema: typeof CASSETTE_SCHEMA
  readonly claude: string
  readonly inputs: Readonly<Record<string, string>>
  readonly test: string
}

export type Cassette = {
  readonly schema: typeof CASSETTE_SCHEMA
  readonly key: CassetteKey
  readonly recordedAt: string
  readonly thrown: string | null
  readonly row: Sidecar
}

export type CassettePlan =
  | { readonly action: 'replay', readonly cassette: Cassette }
  | { readonly action: 'record', readonly why: string }
  | { readonly action: 'refuse', readonly why: string }

export type CassetteRowRef = {
  readonly id: string
  readonly half?: string | undefined
  readonly cassette: CassetteInputs
}

export type CassetteRun = CassetteTarget & CassetteWorld & {
  readonly meta: Pick<RowMeta, 'id' | 'half' | 'title' | 'tier' | 'kind'>
  readonly filter: FilterContext
  readonly onState: (state: string) => void
}

type Recorded = {
  readonly checks: Check[]
  readonly observations: Observation[]
  readonly evidence: Note[]
  readonly screens: Note[]
  readonly notAutomated: NotAutomated[]
  skipped: boolean
}

type Outcome = {
  readonly rec: Recorded
  readonly thrown: string | null
  readonly durationMs: number
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function parseRecordMode(value: string | undefined): CassetteMode | null {
  if (value === undefined || value === '') return 'once'

  return MODES.find(mode => mode === value) ?? null
}

export function cassetteTargetOf(
  e2eDir: string,
  suite: string,
  testFile: string,
  row: CassetteRowRef,
): CassetteTarget {
  return {
    name: rowFileName(row.id, row.half ?? ''),
    dir: join(e2eDir, 'cassettes', suite),
    repo: dirname(e2eDir),
    testFile,
    inputs: row.cassette.inputs,
    ttlDays: row.cassette.ttlDays,
  }
}

export async function suiteOfFile(e2eDir: string, file: string): Promise<string> {
  const entries = await readdir(e2eDir, { withFileTypes: true })
  const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  const found = dirs.filter(name => existsSync(join(e2eDir, name, 'rows.ts')) && existsSync(join(e2eDir, name, file)))
  const [suite] = found
  if (suite === undefined || found.length > 1) {
    throw new HarnessError(`the test file ${file} is in ${found.length} suite folders, not one`)
  }

  return suite
}

async function inputHash(repo: string, input: string): Promise<string> {
  if (isAbsolute(input) || input.split('/').includes('..')) {
    throw new HarnessError(`cassette input is not a repo path: ${input}`)
  }
  try {
    return await hashPath(join(repo, input))
  } catch (error) {
    if (!(error instanceof HarnessError)) throw error
    throw new HarnessError(`cassette input not found: ${input}`)
  }
}

export async function cassetteKey(target: CassetteTarget, claude: string): Promise<CassetteKey> {
  const inputs: Record<string, string> = {}
  for (const input of [...new Set(target.inputs)].sort()) inputs[input] = await inputHash(target.repo, input)
  const test = await hashFile(target.testFile).catch(() => {
    throw new HarnessError(`cassette test file not found: ${basename(target.testFile)}`)
  })

  return { schema: CASSETTE_SCHEMA, claude, inputs, test }
}

function parseKey(value: unknown): CassetteKey | null {
  if (!isRecord(value) || value.schema !== CASSETTE_SCHEMA) return null
  const { claude, inputs, test } = value
  if (typeof claude !== 'string' || typeof test !== 'string' || !isRecord(inputs)) return null
  const hashes: Record<string, string> = {}
  for (const [path, hash] of Object.entries(inputs)) {
    if (typeof hash !== 'string') return null
    hashes[path] = hash
  }

  return { schema: CASSETTE_SCHEMA, claude, inputs: hashes, test }
}

export function parseCassette(text: string): Cassette | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || value.schema !== CASSETTE_SCHEMA) return null
  const { key, recordedAt, thrown, row } = value
  if (typeof recordedAt !== 'string' || !Number.isFinite(Date.parse(recordedAt))) return null
  if (thrown !== null && typeof thrown !== 'string') return null
  const parsedKey = parseKey(key)
  const parsedRow = parseSidecar(JSON.stringify(row))
  if (!parsedKey || !parsedRow) return null

  return { schema: CASSETTE_SCHEMA, key: parsedKey, recordedAt, thrown, row: parsedRow }
}

export async function readCassette(dir: string, name: string): Promise<Cassette | null> {
  const text = await readFile(join(dir, `${name}.json`), 'utf8').catch(() => null)

  return text === null ? null : parseCassette(text)
}

export function staleParts(stored: Cassette, key: CassetteKey, ttlDays: number | undefined, now: number): string[] {
  const parts: string[] = []
  if (stored.key.claude !== key.claude) parts.push('claude version')
  const paths = [...new Set([...Object.keys(stored.key.inputs), ...Object.keys(key.inputs)])].sort()
  for (const path of paths) {
    if (stored.key.inputs[path] !== key.inputs[path]) parts.push(`input ${path}`)
  }
  if (stored.key.test !== key.test) parts.push('test file')
  if (ttlDays !== undefined && now - Date.parse(stored.recordedAt) >= ttlDays * DAY_MS) {
    parts.push(`older than ${ttlDays} days`)
  }

  return parts
}

export function planCassette(
  mode: CassetteMode,
  stored: Cassette | null,
  key: CassetteKey,
  ttlDays: number | undefined,
  now: number,
): CassettePlan {
  if (mode === 'all') return { action: 'record', why: 'E2E_RECORD=all' }
  if (stored === null) {
    return mode === 'none' ? { action: 'refuse', why: 'no readable cassette' } : { action: 'record', why: NO_CASSETTE }
  }
  const parts = staleParts(stored, key, ttlDays, now)
  if (parts.length === 0) return { action: 'replay', cassette: stored }
  const why = `stale: ${parts.join(', ')}`

  return mode === 'none' ? { action: 'refuse', why } : { action: 'record', why }
}

export function planText(plan: CassettePlan): string {
  if (plan.action === 'replay') return `replay (recorded ${plan.cassette.recordedAt})`

  return `${plan.action} (${plan.why})`
}

export async function cassetteState(target: CassetteTarget, world: CassetteWorld): Promise<CassettePlan> {
  let key: CassetteKey
  try {
    key = await cassetteKey(target, world.claude)
  } catch (error) {
    if (!(error instanceof HarnessError)) throw error
    return { action: 'refuse', why: error.message }
  }

  return planCassette(world.mode, await readCassette(target.dir, target.name), key, target.ttlDays, world.now)
}

function filterCassette(cassette: Cassette, ctx: FilterContext): Cassette {
  return {
    ...cassette,
    thrown: cassette.thrown === null ? null : filterText(cassette.thrown, ctx),
    row: filterSidecar(cassette.row, ctx),
  }
}

function cassetteDocText(cassette: Cassette): string {
  const { key } = cassette
  const lines = [
    '',
    '## Cassette key',
    '',
    `- claude: ${key.claude}`,
    `- recorded: ${cassette.recordedAt}`,
    `- test: ${key.test}`,
    ...Object.entries(key.inputs).map(([path, hash]) => `- input ${path}: ${hash}`),
  ]

  return `${rowDocText(cassette.row)}${lines.join('\n')}\n`
}

export async function writeCassette(target: CassetteTarget, cassette: Cassette, ctx: FilterContext): Promise<void> {
  const filtered = filterCassette(cassette, ctx)
  const json = `${JSON.stringify(filtered, null, 2)}\n`
  const doc = cassetteDocText(filtered)
  leakCheck(json, ctx)
  leakCheck(doc, ctx)
  await mkdir(target.dir, { recursive: true })
  await writeFile(join(target.dir, `${target.name}.md`), doc)
  await writeFile(join(target.dir, `${target.name}.json`), json)
}

function recordedState(why: string): string {
  return why === NO_CASSETTE ? 'recorded' : `recorded (${why})`
}

function recordedVerdict(kind: RowKind, failed: boolean): Verdict {
  if (failed) return 'fail'

  return kind === 'recorded' ? 'recorded' : 'pass'
}

function reasonOf(thrown: string | null, failedChecks: readonly Check[]): string {
  if (thrown !== null) return thrown
  if (failedChecks.length === 0) return ''

  return `checks failed: ${failedChecks.map(check => check.name).join(', ')}`
}

function cassetteOf(run: CassetteRun, key: CassetteKey, outcome: Outcome, state: string): Cassette {
  const { rec, thrown } = outcome
  const failedChecks = rec.checks.filter(check => !check.ok)
  const row: Sidecar = {
    schema: SIDECAR_SCHEMA,
    id: run.meta.id,
    half: run.meta.half ?? '',
    title: run.meta.title,
    tier: run.meta.tier,
    kind: run.meta.kind,
    verdict: recordedVerdict(run.meta.kind, thrown !== null || failedChecks.length > 0),
    reason: reasonOf(thrown, failedChecks),
    checks: rec.checks,
    observations: rec.observations,
    evidence: rec.evidence,
    screens: rec.screens,
    notAutomated: rec.notAutomated,
    cassette: state,
    durationMs: outcome.durationMs,
  }

  return { schema: CASSETTE_SCHEMA, key, recordedAt: new Date(run.now).toISOString(), thrown, row }
}

function emptyRecorded(): Recorded {
  return { checks: [], observations: [], evidence: [], screens: [], notAutomated: [], skipped: false }
}

function recordingContext(ctx: RowContext, rec: Recorded): RowContext {
  return {
    scratch: ctx.scratch,
    check: (name, fn) => ctx.check(name, async () => {
      try {
        await fn()
      } catch (error) {
        if (!(error instanceof HarnessError)) rec.checks.push({ name, ok: false, message: messageOf(error) })
        throw error
      }
      rec.checks.push({ name, ok: true, message: '' })
    }),
    observe: (name, value, evidence = '') => {
      rec.observations.push({ name, value, evidence })
      ctx.observe(name, value, evidence)
    },
    evidence: (label, text) => {
      rec.evidence.push({ label, text })
      ctx.evidence(label, text)
    },
    screen: (label, text) => {
      rec.screens.push({ label, text })
      ctx.screen(label, text)
    },
    skipPart: (name, reason) => {
      rec.notAutomated.push({ name, reason })
      ctx.skipPart(name, reason)
    },
    skip: reason => {
      rec.skipped = true
      ctx.skip(reason)
    },
    after: fn => {
      ctx.after(fn)
    },
  }
}

async function replay(ctx: RowContext, cassette: Cassette, onState: (state: string) => void): Promise<void> {
  onState(`(replayed ${cassette.recordedAt})`)
  const { row } = cassette
  for (const check of row.checks) {
    await ctx.check(check.name, () => {
      if (!check.ok) throw new Error(check.message)
    })
  }
  for (const item of row.observations) ctx.observe(item.name, item.value, item.evidence)
  for (const item of row.evidence) ctx.evidence(item.label, item.text)
  for (const item of row.screens) ctx.screen(item.label, item.text)
  for (const part of row.notAutomated) ctx.skipPart(part.name, part.reason)
  if (cassette.thrown !== null) throw new Error(cassette.thrown)
}

async function saveCassette(run: CassetteRun, cassette: Cassette): Promise<void> {
  try {
    await writeCassette(run, cassette, run.filter)
  } catch (error) {
    if (!(error instanceof LeakError)) throw error
    throw new HarnessError(`the cassette ${run.name} was not written: ${error.message}`)
  }
}

async function record(ctx: RowContext, run: CassetteRun, key: CassetteKey, why: string, body: RowBody): Promise<void> {
  const rec = emptyRecorded()
  const started = Date.now()
  let failure: { readonly error: unknown } | null = null
  try {
    await body(recordingContext(ctx, rec))
  } catch (error) {
    failure = { error }
  }
  if (failure?.error instanceof HarnessError) throw failure.error
  if (!rec.skipped) {
    const thrown = failure === null ? null : messageOf(failure.error)
    const state = recordedState(why)
    await saveCassette(run, cassetteOf(run, key, { rec, thrown, durationMs: Date.now() - started }, state))
    run.onState(state)
  }
  if (failure !== null) throw failure.error
}

export async function withCassette(ctx: RowContext, run: CassetteRun, body: RowBody): Promise<void> {
  const key = await cassetteKey(run, run.claude)
  const stored = await readCassette(run.dir, run.name)
  const plan = planCassette(run.mode, stored, key, run.ttlDays, run.now)
  if (plan.action === 'refuse') throw new HarnessError(`E2E_RECORD=none: cassette ${run.name}: ${plan.why}`)
  if (plan.action === 'replay') return replay(ctx, plan.cassette, run.onState)

  return record(ctx, run, key, plan.why, body)
}
