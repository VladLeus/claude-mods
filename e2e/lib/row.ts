import { dirname, join } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { cassetteTargetOf, parseRecordMode, suiteOfFile, withCassette } from './cassette.ts'
import type { CassetteInputs } from './cassette.ts'
import { HarnessError, LeakError } from './errors.ts'
import { filterContext, filterText } from './filter.ts'
import { removeTree, rowDir, scratchRoot } from './scratch.ts'
import { SIDECAR_SCHEMA, writeRowResult } from './summary.ts'
import type { Check, Json, NotAutomated, Note, Observation, RowKind, Sidecar, Tier, Verdict } from './summary.ts'

export const OFFLINE_TEST_MS = 60_000
export const LIVE_TEST_MS = 600_000

const E2E_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

export type RowMeta = {
  readonly id: string
  readonly half?: 'a' | 'b'
  readonly title: string
  readonly tier: Tier
  readonly kind: RowKind
  readonly mac?: string
  readonly skip?: string
  readonly file?: string
  readonly cassette?: CassetteInputs
}

export type Cleanup = () => void | Promise<void>

export type RowContext = {
  readonly scratch: string
  check(name: string, fn: () => void | Promise<void>): Promise<void>
  observe(name: string, value: Json, evidence?: string): void
  evidence(label: string, text: string): void
  screen(label: string, text: string): void
  skipPart(name: string, reason: string): void
  skip(reason: string): void
  after(fn: Cleanup): void
}

export type RowBody = (ctx: RowContext) => Promise<void>

export type Outcome = {
  readonly harnessError: boolean
  readonly thrown: boolean
  readonly failedChecks: number
  readonly skipped: boolean
}

type RowRecord = {
  readonly checks: Check[]
  readonly observations: Observation[]
  readonly evidence: Note[]
  readonly screens: Note[]
  readonly notAutomated: NotAutomated[]
  readonly cleanups: Cleanup[]
  cassette: string
  skipReason: string | null
  failure: unknown
  failed: boolean
  settled: boolean
  scratch: string | null
}

export function rowName(meta: RowMeta): string {
  return `${meta.id}${meta.half ?? ''} ${meta.title}`
}

export function staticSkip(meta: RowMeta, platform: string): string | null {
  if (meta.skip) return meta.skip
  if (meta.mac && platform !== 'darwin') return `macOS only: ${meta.mac}`

  return null
}

export function verdictOf(kind: RowKind, outcome: Outcome): Verdict {
  if (outcome.harnessError) return 'error'
  if (outcome.thrown || outcome.failedChecks > 0) return 'fail'
  if (outcome.skipped) return 'skipped'
  if (kind === 'recorded') return 'recorded'

  return 'pass'
}

function messageOf(error: unknown): string {
  if (error instanceof HarnessError) return error.message
  if (error instanceof Error) return error.stack ?? error.message

  return String(error)
}

function emptyRecord(): RowRecord {
  return {
    checks: [],
    observations: [],
    evidence: [],
    screens: [],
    notAutomated: [],
    cleanups: [],
    cassette: 'none',
    skipReason: null,
    failure: null,
    failed: false,
    settled: false,
    scratch: null,
  }
}

function contextOf(rec: RowRecord, scratch: string, t: TestContext): RowContext {
  return {
    scratch,
    async check(name, fn) {
      try {
        await fn()
        rec.checks.push({ name, ok: true, message: '' })
      } catch (error) {
        if (error instanceof HarnessError) throw error
        rec.checks.push({ name, ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    },
    observe(name, value, evidence = '') {
      rec.observations.push({ name, value, evidence })
    },
    evidence(label, text) {
      rec.evidence.push({ label, text })
    },
    screen(label, text) {
      rec.screens.push({ label, text })
    },
    skipPart(name, reason) {
      rec.notAutomated.push({ name, reason })
    },
    skip(reason) {
      rec.skipReason = reason
      t.skip(reason)
    },
    after(fn) {
      rec.cleanups.push(fn)
    },
  }
}

function outcomeOf(rec: RowRecord): Outcome {
  return {
    harnessError: rec.failed && rec.failure instanceof HarnessError,
    thrown: rec.failed,
    failedChecks: rec.checks.filter(check => !check.ok).length,
    skipped: rec.skipReason !== null,
  }
}

function reasonOf(verdict: Verdict, rec: RowRecord): string {
  if (verdict === 'skipped') return rec.skipReason ?? ''
  if (rec.failed) return messageOf(rec.failure)
  if (verdict !== 'fail') return ''

  return `checks failed: ${rec.checks.filter(check => !check.ok).map(check => check.name).join(', ')}`
}

async function runCleanups(rec: RowRecord): Promise<string | null> {
  const errors: string[] = []
  for (const cleanup of [...rec.cleanups].reverse()) {
    try {
      await cleanup()
    } catch (error) {
      errors.push(messageOf(error))
    }
  }

  return errors.length > 0 ? `cleanup failed: ${errors.join('; ')}` : null
}

function sidecarOf(meta: RowMeta, rec: RowRecord, verdict: Verdict, reason: string, durationMs: number): Sidecar {
  return {
    schema: SIDECAR_SCHEMA,
    id: meta.id,
    half: meta.half ?? '',
    title: meta.title,
    tier: meta.tier,
    kind: meta.kind,
    verdict,
    reason,
    checks: rec.checks,
    observations: rec.observations,
    evidence: rec.evidence,
    screens: rec.screens,
    notAutomated: rec.notAutomated,
    cassette: rec.cassette,
    durationMs,
  }
}

async function finishRow(
  meta: RowMeta,
  rec: RowRecord,
  runDir: string,
  durationMs: number,
  timeoutMs: number,
): Promise<void> {
  const cleanupError = await runCleanups(rec)
  const settledVerdict = rec.settled ? verdictOf(meta.kind, outcomeOf(rec)) : 'error'
  const verdict = cleanupError ? 'error' : settledVerdict
  const reason = [rec.settled ? reasonOf(settledVerdict, rec) : `timed out after ${timeoutMs} ms`, cleanupError ?? '']
    .filter(part => part.length > 0)
    .join('; ')
  const ctx = filterContext(process.env)
  try {
    await writeRowResult(runDir, sidecarOf(meta, rec, verdict, reason, durationMs), ctx)
  } catch (error) {
    if (!(error instanceof LeakError)) throw error
    const empty = emptyRecord()
    const reasonText = `the row result was not written: ${error.message}`
    await writeRowResult(runDir, sidecarOf(meta, empty, 'error', reasonText, durationMs), ctx)
    throw error
  }
  if (cleanupError) throw new HarnessError(filterText(cleanupError, ctx))
  if (!rec.scratch || verdict === 'fail' || verdict === 'error' || process.env.E2E_KEEP === '1') return

  await removeTree(rec.scratch, scratchRoot())
}

function cassetteBody(meta: RowMeta, spec: CassetteInputs, rec: RowRecord, fn: RowBody): RowBody {
  const onState = (state: string): void => {
    rec.cassette = state
  }

  return async ctx => {
    const mode = parseRecordMode(process.env.E2E_RECORD)
    if (mode === null) throw new HarnessError('E2E_RECORD must be once, none or all')
    const claude = process.env.E2E_CLAUDE_VERSION
    if (!claude) throw new HarnessError('E2E_CLAUDE_VERSION is unset: run through npm run e2e:live')
    if (!meta.file) throw new HarnessError(`rowTest: the registry entry of ${meta.id} names no test file`)
    const suite = await suiteOfFile(E2E_DIR, meta.file)
    const testFile = join(E2E_DIR, suite, meta.file)
    const target = cassetteTargetOf(E2E_DIR, suite, testFile, { id: meta.id, half: meta.half, cassette: spec })
    const world = { claude, mode, now: Date.now() }

    await withCassette(ctx, { ...target, ...world, meta, filter: filterContext(process.env), onState }, fn)
  }
}

async function runRow(meta: RowMeta, fn: RowBody, t: TestContext, runDir: string, timeoutMs: number): Promise<void> {
  const started = Date.now()
  const rec = emptyRecord()
  t.after(() => finishRow(meta, rec, runDir, Date.now() - started, timeoutMs))
  const skip = staticSkip(meta, process.platform)
  if (skip) {
    rec.skipReason = skip
    rec.settled = true
    t.skip(skip)
    return
  }
  try {
    rec.scratch = await rowDir(`${meta.id}${meta.half ?? ''}`, scratchRoot())
    const body = meta.cassette ? cassetteBody(meta, meta.cassette, rec, fn) : fn
    await body(contextOf(rec, rec.scratch, t))
  } catch (error) {
    rec.failure = error
    rec.failed = true
  }
  rec.settled = true
  const verdict = verdictOf(meta.kind, outcomeOf(rec))
  if (verdict !== 'fail' && verdict !== 'error') return

  throw new Error(filterText(`${verdict}: ${reasonOf(verdict, rec)}`, filterContext(process.env)))
}

export function rowTest(meta: RowMeta, fn: RowBody): void {
  const runDir = process.env.E2E_RUN_DIR
  if (!runDir) throw new HarnessError('E2E_RUN_DIR is unset: run through npm run e2e or e2e:live')
  const timeoutMs = meta.tier === 'live' ? LIVE_TEST_MS : OFFLINE_TEST_MS

  test(rowName(meta), { timeout: timeoutMs }, t => runRow(meta, fn, t, runDir, timeoutMs))
}
