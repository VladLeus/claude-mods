import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { LeakError } from './errors.ts'
import { filterContext, leakCheck } from './filter.ts'
import { removeTree, scratchRoot } from './scratch.ts'
import { compareRowIds, parseSidecar, publishSummary, summaryText, writeRowResult, writeSummary } from './summary.ts'
import type { Sidecar, SummaryInput } from './summary.ts'

const HOME = '/Users/unitperson'

let dir = ''
let publishDir = ''

before(async () => {
  dir = await mkdtemp(join(scratchRoot(), 'unit-summary-'))
  publishDir = join(dir, 'publish')
  await mkdir(publishDir)
})

after(async () => {
  await removeTree(dir, scratchRoot())
})

function sidecar(over: Partial<Sidecar>): Sidecar {
  return {
    schema: 1,
    id: '03#57',
    half: '',
    title: 'A row title',
    tier: 'offline',
    kind: 'recorded',
    verdict: 'recorded',
    reason: '',
    checks: [],
    observations: [],
    evidence: [],
    screens: [],
    notAutomated: [],
    cassette: 'none',
    durationMs: 5,
    ...over,
  }
}

function input(rows: readonly Sidecar[], over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    run: '261111-120000-abcd',
    tier: 'offline',
    claude: 'absent',
    versions: [{ name: 'cadre', version: '0.5.1' }],
    rows,
    ...over,
  }
}

test('parseSidecar returns null on malformed JSON or a wrong field type', () => {
  const good = sidecar({ observations: [{ name: 'flag', value: { nested: [true, 1, null] }, evidence: 'out' }] })

  assert.equal(parseSidecar('{'), null)
  assert.equal(parseSidecar('[]'), null)
  assert.equal(parseSidecar(JSON.stringify({ ...good, verdict: 'maybe' })), null)
  assert.equal(parseSidecar(JSON.stringify({ ...good, durationMs: '5' })), null)
  assert.equal(parseSidecar(JSON.stringify({ ...good, checks: [{ name: 'x', ok: 'yes', message: '' }] })), null)
  assert.equal(parseSidecar(JSON.stringify({ ...good, notAutomated: [{ name: 'x' }] })), null)
  assert.deepEqual(parseSidecar(JSON.stringify(good)), good)
})

test('summaryText counts verdicts and lists not-automated parts', () => {
  const rows = [
    sidecar({ id: '03#57' }),
    sidecar({ id: '03#45', kind: 'pass', verdict: 'pass' }),
    sidecar({
      id: '03#52',
      kind: 'pass',
      verdict: 'fail',
      checks: [{ name: 'one version line', ok: false, message: 'saw two' }],
      notAutomated: [{ name: '2.1.295 half', reason: 'waits for the RC pin' }],
    }),
    sidecar({ id: '03#68', half: 'a', kind: 'pass', verdict: 'skipped', reason: 'no git' }),
    sidecar({ id: '03#53', kind: 'pass', verdict: 'error', reason: 'harness fault' }),
  ]
  const text = summaryText(input(rows))

  assert.match(text, /Totals: 5 rows: 1 pass, 1 fail, 1 recorded, 1 skipped, 1 error/)
  assert.match(text, /^\| 03#52 \| fail \|/m)
  assert.match(text, /^\| 03#68a \| skipped \|/m)
  assert.match(text, /^- 03#52: 2\.1\.295 half: waits for the RC pin$/m)
  assert.match(text, /^- cadre version: 0\.5\.1$/m)
  assert.doesNotMatch(text, /^## Fixtures/m)
  assert.doesNotMatch(text, /^## Guard/m)
})

test('summaryText keeps at most 160 characters of evidence per row', () => {
  const long = 'x'.repeat(400)
  const text = summaryText(input([sidecar({ observations: [{ name: 'out', value: long, evidence: '' }] })]))
  const line = text.split('\n').find(row => row.startsWith('| 03#57 |')) ?? ''
  const cells = line.split(' | ')

  assert.ok(cells.some(cell => cell.startsWith('out=')))
  assert.ok(cells.every(cell => cell.length <= 160))
})

test('summaryText adds the fixtures and guard sections on the live tier', () => {
  const text = summaryText(input([], { tier: 'live', fixtures: [{ variant: 'bare', status: 'built' }], guard: [] }))

  assert.match(text, /^## Fixtures$/m)
  assert.match(text, /^\| bare \| built \|$/m)
  assert.match(text, /^## Guard$/m)
})

test('writeSummary and publishSummary write filtered text that passes leakCheck', async () => {
  const ctx = filterContext({ HOME })
  const rows = [sidecar({ observations: [{ name: 'path', value: `${HOME}/repo`, evidence: '' }] })]
  const path = join(dir, 'SUMMARY.md')

  await writeSummary(path, summaryText(input(rows)), ctx)
  const published = await publishSummary(path, publishDir, 'cadre-E2E-SUMMARY-unit.md', ctx)
  const written = await readFile(path, 'utf8')
  const copy = await readFile(published, 'utf8')

  assert.equal(published, join(publishDir, 'cadre-E2E-SUMMARY-unit.md'))
  assert.ok(written.includes('~/repo'))
  assert.equal(copy, written)
  assert.doesNotThrow(() => leakCheck(written, ctx))
  assert.doesNotThrow(() => leakCheck(copy, ctx))
})

test('a residue the filter cannot remove makes writeSummary and publishSummary throw and write nothing', async () => {
  const ctx = filterContext({ HOME })
  const rows = [sidecar({ evidence: [{ label: 'ls', text: '/var/folders/zz/abc/T/x' }] })]
  const text = summaryText(input(rows))
  const path = join(dir, 'LEAK.md')
  const raw = join(dir, 'RAW.md')
  await writeFile(raw, text)

  await assert.rejects(writeSummary(path, text, ctx), LeakError)
  await assert.rejects(publishSummary(raw, publishDir, 'LEAK.md', ctx), LeakError)
  assert.equal(existsSync(path), false)
  assert.equal(existsSync(join(publishDir, 'LEAK.md')), false)
})

test('writeRowResult writes a filtered doc and sidecar, and nothing on a residue', async () => {
  const ctx = filterContext({ HOME })
  const rowsDir = join(dir, 'rows')
  await mkdir(rowsDir)
  const good = sidecar({ evidence: [{ label: 'cwd', text: `${HOME}/repo` }] })
  const leaky = sidecar({ id: '03#58', evidence: [{ label: 'ls', text: '/var/folders/zz/abc/T/x' }] })

  await writeRowResult(rowsDir, good, ctx)
  await assert.rejects(writeRowResult(rowsDir, leaky, ctx), LeakError)
  const doc = await readFile(join(rowsDir, '03#57.md'), 'utf8')
  const stored = parseSidecar(await readFile(join(rowsDir, '03#57.json'), 'utf8'))

  assert.ok(doc.includes('~/repo'))
  assert.equal(stored?.evidence[0]?.text, '~/repo')
  assert.equal(existsSync(join(rowsDir, '03#58.md')), false)
  assert.equal(existsSync(join(rowsDir, '03#58.json')), false)
})

test('compareRowIds orders by phase, then row number, then suffix', () => {
  const ids = ['03.2#15c', '03#68b', '03.1#12', '03#100', '03#57', '03.2#3', '03#68a', '03.1#3']

  const ordered = ['03#57', '03#68a', '03#68b', '03#100', '03.1#3', '03.1#12', '03.2#3', '03.2#15c']

  assert.deepEqual(ids.sort(compareRowIds), ordered)
})
