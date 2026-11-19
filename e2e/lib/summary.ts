import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { HarnessError } from './errors.ts'
import { filterText, isRecord, leakCheck } from './filter.ts'
import type { FilterContext } from './filter.ts'

export type Tier = 'offline' | 'live'
export type RowKind = 'pass' | 'recorded' | 'mixed'
export type Verdict = 'pass' | 'fail' | 'recorded' | 'skipped' | 'error'
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export type Check = {
  readonly name: string
  readonly ok: boolean
  readonly message: string
}

export type Observation = {
  readonly name: string
  readonly value: Json
  readonly evidence: string
}

export type Note = {
  readonly label: string
  readonly text: string
}

export type NotAutomated = {
  readonly name: string
  readonly reason: string
}

export type Sidecar = {
  readonly schema: 1
  readonly id: string
  readonly half: string
  readonly title: string
  readonly tier: Tier
  readonly kind: RowKind
  readonly verdict: Verdict
  readonly reason: string
  readonly checks: readonly Check[]
  readonly observations: readonly Observation[]
  readonly evidence: readonly Note[]
  readonly screens: readonly Note[]
  readonly notAutomated: readonly NotAutomated[]
  readonly cassette: string
  readonly durationMs: number
}

export type FixtureStatus = {
  readonly variant: string
  readonly status: string
}

export type SuiteVersion = {
  readonly name: string
  readonly version: string
}

export type SummaryInput = {
  readonly run: string
  readonly tier: Tier
  readonly claude: string
  readonly versions: readonly SuiteVersion[]
  readonly rows: readonly Sidecar[]
  readonly fixtures?: readonly FixtureStatus[]
  readonly guard?: readonly string[]
}

export const SIDECAR_SCHEMA = 1
export const SUMMARY_EVIDENCE_CHARS = 160
export const TIERS: readonly Tier[] = ['offline', 'live']
export const ROW_KINDS: readonly RowKind[] = ['pass', 'recorded', 'mixed']
export const VERDICTS: readonly Verdict[] = ['pass', 'fail', 'recorded', 'skipped', 'error']
export const REFUSED_EXIT = 2

const ROW_ID_RE = /^(\d+(?:\.\d+)*)#(\d+)([a-z]*)$/

function isOneOf<T extends string>(value: unknown, list: readonly T[]): value is T {
  return list.some(item => item === value)
}

function isListOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(guard)
}

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJson)

  return isRecord(value) && Object.values(value).every(isJson)
}

function isCheck(item: unknown): item is Check {
  if (!isRecord(item)) return false

  return typeof item.name === 'string' && typeof item.ok === 'boolean' && typeof item.message === 'string'
}

function isObservation(item: unknown): item is Observation {
  return isRecord(item) && typeof item.name === 'string' && isJson(item.value) && typeof item.evidence === 'string'
}

function isNote(item: unknown): item is Note {
  return isRecord(item) && typeof item.label === 'string' && typeof item.text === 'string'
}

function isNotAutomated(item: unknown): item is NotAutomated {
  return isRecord(item) && typeof item.name === 'string' && typeof item.reason === 'string'
}

export function parseSidecar(text: string): Sidecar | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || value.schema !== SIDECAR_SCHEMA) return null
  const { id, half, title, tier, kind, verdict, reason, checks, observations } = value
  const { evidence, screens, notAutomated, cassette, durationMs } = value
  if (typeof id !== 'string' || typeof half !== 'string' || typeof title !== 'string') return null
  if (typeof reason !== 'string' || typeof cassette !== 'string') return null
  if (!isOneOf(tier, TIERS) || !isOneOf(kind, ROW_KINDS) || !isOneOf(verdict, VERDICTS)) return null
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return null
  if (!isListOf(checks, isCheck) || !isListOf(observations, isObservation)) return null
  if (!isListOf(evidence, isNote) || !isListOf(screens, isNote) || !isListOf(notAutomated, isNotAutomated)) return null

  return {
    schema: SIDECAR_SCHEMA,
    id,
    half,
    title,
    tier,
    kind,
    verdict,
    reason,
    checks,
    observations,
    evidence,
    screens,
    notAutomated,
    cassette,
    durationMs,
  }
}

export function rowFileName(id: string, half: string): string {
  return `${id}${half}`
}

function parseRowId(id: string): { phase: number[], row: number, suffix: string } | null {
  const match = ROW_ID_RE.exec(id)
  if (!match || match[1] === undefined || match[2] === undefined) return null

  return { phase: match[1].split('.').map(Number), row: Number(match[2]), suffix: match[3] ?? '' }
}

function compareText(a: string, b: string): number {
  if (a === b) return 0

  return a < b ? -1 : 1
}

export function compareRowIds(a: string, b: string): number {
  const left = parseRowId(a)
  const right = parseRowId(b)
  if (!left || !right) return compareText(a, b)
  for (let index = 0; index < Math.max(left.phase.length, right.phase.length); index += 1) {
    const diff = (left.phase[index] ?? -1) - (right.phase[index] ?? -1)
    if (diff !== 0) return diff
  }
  if (left.row !== right.row) return left.row - right.row

  return compareText(left.suffix, right.suffix)
}

function filterJson(value: Json, ctx: FilterContext): Json {
  if (typeof value === 'string') return filterText(value, ctx)
  if (Array.isArray(value)) return value.map(item => filterJson(item, ctx))
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [filterText(key, ctx), filterJson(item, ctx)]))
}

export function filterSidecar(row: Sidecar, ctx: FilterContext): Sidecar {
  const text = (value: string): string => filterText(value, ctx)
  const note = (item: Note): Note => ({ label: text(item.label), text: text(item.text) })

  return {
    ...row,
    title: text(row.title),
    reason: text(row.reason),
    checks: row.checks.map(check => ({ name: text(check.name), ok: check.ok, message: text(check.message) })),
    observations: row.observations.map(item => ({
      name: text(item.name),
      value: filterJson(item.value, ctx),
      evidence: text(item.evidence),
    })),
    evidence: row.evidence.map(note),
    screens: row.screens.map(note),
    notAutomated: row.notAutomated.map(part => ({ name: text(part.name), reason: text(part.reason) })),
    cassette: text(row.cassette),
  }
}

function fenced(text: string): readonly string[] {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(run => run[0].length))
  const fence = '`'.repeat(Math.max(3, longest + 1))

  return [fence, text.replace(/\n$/, ''), fence]
}

function labelled(prefix: string, text: string): readonly string[] {
  if (!text) return [prefix]
  if (!text.includes('\n')) return [`${prefix}: ${text}`]

  return [`${prefix}:`, '', ...fenced(text), '']
}

function section(title: string, lines: readonly string[]): readonly string[] {
  if (lines.length === 0) return []

  return ['', `## ${title}`, '', ...lines]
}

function noteLines(notes: readonly Note[]): readonly string[] {
  return notes.flatMap(item => [`### ${item.label}`, '', ...fenced(item.text), ''])
}

function checkLines(check: Check): readonly string[] {
  return labelled(`- ${check.ok ? 'pass' : 'fail'}: ${check.name}`, check.message)
}

function observationLines(observations: readonly Observation[]): readonly string[] {
  return observations.flatMap(item => {
    const head = `- ${item.name}: ${JSON.stringify(item.value)}`
    if (!item.evidence) return [head]

    return [head, '', ...fenced(item.evidence), '']
  })
}

export function rowDocText(row: Sidecar): string {
  const lines = [
    `# ${rowFileName(row.id, row.half)} ${row.title}`,
    '',
    `- Verdict: ${row.verdict}`,
    `- Tier: ${row.tier}`,
    `- Kind: ${row.kind}`,
    `- Cassette: ${row.cassette}`,
    `- Duration: ${row.durationMs} ms`,
    ...(row.reason ? labelled('- Reason', row.reason) : []),
    ...section('Checks', row.checks.flatMap(checkLines)),
    ...section('Observations', observationLines(row.observations)),
    ...section('Evidence', noteLines(row.evidence)),
    ...section('Screens', noteLines(row.screens)),
    ...section('Not automated', row.notAutomated.map(part => `- ${part.name}: ${part.reason}`)),
  ]

  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

export async function writeRowResult(dir: string, row: Sidecar, ctx: FilterContext): Promise<void> {
  const filtered = filterSidecar(row, ctx)
  const json = `${JSON.stringify(filtered, null, 2)}\n`
  const doc = rowDocText(filtered)
  leakCheck(json, ctx)
  leakCheck(doc, ctx)
  const name = rowFileName(row.id, row.half)

  await writeFile(join(dir, `${name}.json`), json)
  await writeFile(join(dir, `${name}.md`), doc)
}

function cell(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim().replaceAll('|', '\\|')
  if (flat.length <= SUMMARY_EVIDENCE_CHARS) return flat

  return `${flat.slice(0, SUMMARY_EVIDENCE_CHARS - 1)}…`
}

function evidenceCell(row: Sidecar): string {
  const parts = [
    row.reason,
    ...row.checks.filter(check => !check.ok).map(check => `${check.name}: ${check.message}`),
    ...row.observations.map(item => `${item.name}=${JSON.stringify(item.value)}`),
    ...row.evidence.map(item => `${item.label}: ${item.text}`),
  ]

  return cell(parts.filter(part => part.length > 0).join('; '))
}

function rowLine(row: Sidecar): string {
  const parts = row.notAutomated.map(part => part.name).join('; ')
  const id = rowFileName(row.id, row.half)
  const cells = [id, row.verdict, cell(row.cassette), evidenceCell(row), cell(parts), cell(row.title)]

  return `| ${cells.join(' | ')} |`
}

function fixtureLines(fixtures: readonly FixtureStatus[]): readonly string[] {
  if (fixtures.length === 0) return ['', '## Fixtures', '', 'none']

  const table = fixtures.map(fixture => `| ${fixture.variant} | ${fixture.status} |`)

  return ['', '## Fixtures', '', '| Variant | Status |', '|---|---|', ...table]
}

function guardLines(guard: readonly string[]): readonly string[] {
  const items = guard.length > 0 ? guard.map(item => `- ${item}`) : ['- no change']

  return ['', '## Guard', '', ...items]
}

export function summaryText(input: SummaryInput): string {
  const rows = [...input.rows].sort((a, b) => compareRowIds(rowFileName(a.id, a.half), rowFileName(b.id, b.half)))
  const counts = VERDICTS.map(verdict => `${rows.filter(row => row.verdict === verdict).length} ${verdict}`)
  const parts = rows.flatMap(row => {
    const id = rowFileName(row.id, row.half)

    return row.notAutomated.map(part => `- ${id}: ${part.name}: ${part.reason}`)
  })
  const live = input.tier === 'live' ? [...fixtureLines(input.fixtures ?? []), ...guardLines(input.guard ?? [])] : []
  const lines = [
    `# E2E run ${input.run}`,
    '',
    `- Tier: ${input.tier}`,
    `- claude --version: ${input.claude}`,
    ...input.versions.map(item => `- ${item.name} version: ${item.version}`),
    `- Totals: ${rows.length} rows: ${counts.join(', ')}`,
    '',
    '## Rows',
    '',
    '| Row | Verdict | Cassette | Evidence | Not automated | Title |',
    '|---|---|---|---|---|---|',
    ...rows.map(rowLine),
    ...section('Not automated', parts),
    ...live,
  ]

  return `${lines.join('\n')}\n`
}

export async function writeSummary(path: string, text: string, ctx: FilterContext): Promise<void> {
  const out = filterText(text, ctx)
  leakCheck(out, ctx)

  await writeFile(path, out)
}

export async function publishSummary(src: string, dstDir: string, name: string, ctx: FilterContext): Promise<string> {
  if (basename(name) !== name) throw new HarnessError('publishSummary needs a plain file name')
  const out = filterText(await readFile(src, 'utf8'), ctx)
  leakCheck(out, ctx)
  const dst = join(dstDir, name)

  await writeFile(dst, out)

  return dst
}

export function isRefusedRun(code: number): boolean {
  return code === REFUSED_EXIT
}
