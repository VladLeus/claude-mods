import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { HarnessError } from '../lib/errors.ts'
import { variantClosure } from '../lib/fixture.ts'
import { VARIANTS } from './fixtures/index.ts'
import { ROWS } from './rows.ts'
import type { RowEntry } from './rows.ts'

const PLANNING_DIR = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), '.planning')
const UAT_FILES = [
  { phase: '03', path: 'phases/03-apply-launch-kickoff-and-isolation-check/03-UAT.md' },
  { phase: '03.1', path: 'phases/03.1-worktree-sessions/03.1-UAT.md' },
  { phase: '03.2', path: 'phases/03.2-conveyor-and-framework-choice/03.2-UAT.md' },
] as const
const ROW_HEADER_RE = /^### ([0-9]+[a-z]?)\.(?:\s|$)/
const HEADER_RE = /^#{1,6}\s/
const SCRIPTED_RE = /^cut: scripted(?:\s|$)/
const KINDS: readonly string[] = ['pass', 'recorded', 'mixed']
const TWO_VARIANT_ROWS: Readonly<Record<string, readonly string[]>> = {
  '03#61': ['gsd-pre', 'gsd'],
  '03#76': ['gsd-dir', 'gsd-here'],
  '03.1#14': ['gsd', 'gsd-ignoreall'],
  '03.1#16': ['gsd', 'gsd-ignoreall'],
  '03.2#5': ['sp-pre', 'gsd'],
}
const CASSETTE_ROWS: readonly string[] = [
  '03#46', '03#50', '03#55', '03#59', '03#60', '03#66', '03#70', '03#72', '03#73', '03#78', '03#80', '03#82',
  '03.1#1', '03.1#3', '03.1#15', '03.1#16',
  '03.2#3', '03.2#27',
]
const RC_PIN_ROWS: readonly string[] = ['03#50', '03#52', '03#59', '03#60', '03#75']
const EXCLUSIVE_ROWS: readonly string[] = ['03#61', '03#80', '03#82', '03#83', '03#87', '03.2#3', '03.2#30']
const SAMPLE_FROM: Readonly<Record<string, readonly string[]>> = { gsd: ['gsd-pre'], 'gsd-pre': [], 'sp-pre': [] }
const CYCLE_FROM: Readonly<Record<string, readonly string[]>> = { a: ['b'], b: ['c'], c: ['a'] }
const NO_PLANNING = existsSync(PLANNING_DIR) ? false : 'no .planning/ folder: the UAT files are not on this branch'
const SAMPLE_UAT = [
  '### 1. A scripted row',
  'expected: one',
  'cut: scripted',
  '### 2. An agent row',
  'cut: agent',
  '### 15c. A scripted row with a suffix and a note',
  'cut: scripted (latest engine; the 2.1.295 half waits for the RC pin)',
  '### 3. A row with no cut line',
  '## Gaps',
  'cut: scripted',
  '### 4. A row whose second cut line is ignored',
  'cut: critical C1',
  'cut: scripted',
].join('\n')

function key(row: RowEntry): string {
  return `${row.id}${row.half ?? ''}`
}

function entryOf(id: string): RowEntry | undefined {
  return ROWS.find(row => row.id === id)
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort()
}

function fromOf(map: Readonly<Record<string, readonly string[]>>): (variant: string) => readonly string[] | undefined {
  return variant => map[variant]
}

function builderFrom(variant: string): readonly string[] | undefined {
  return VARIANTS[variant]?.from
}

function harnessErrorNaming(name: string): (error: unknown) => boolean {
  return error => error instanceof HarnessError && error.message.includes(name)
}

function scriptedIds(text: string, phase: string): string[] | null {
  const ids: string[] = []
  let headers = 0
  let row: string | null = null
  for (const line of text.split(/\r?\n/)) {
    const header = ROW_HEADER_RE.exec(line)
    if (header) {
      headers += 1
      row = header[1] ?? null
      continue
    }
    if (HEADER_RE.test(line)) row = null
    if (row === null || !line.startsWith('cut:')) continue
    if (SCRIPTED_RE.test(line)) ids.push(`${phase}#${row}`)
    row = null
  }

  return headers === 0 ? null : ids
}

async function uatScriptedIds(): Promise<string[]> {
  const ids: string[] = []
  for (const file of UAT_FILES) {
    const text = await readFile(join(PLANNING_DIR, file.path), 'utf8').catch(() => null)
    const found = text === null ? null : scriptedIds(text, file.phase)
    assert.ok(found, `${file.path} is unreadable or holds no rows`)
    ids.push(...found)
  }

  return ids
}

test('the UAT parse keeps the rows cut as scripted and reads text without rows as null', () => {
  assert.deepEqual(scriptedIds(SAMPLE_UAT, '09'), ['09#1', '09#15c'])
  assert.equal(scriptedIds('no rows here\ncut: scripted', '09'), null)
})

test('the registry rows equal the rows the three UAT files cut as scripted', { skip: NO_PLANNING }, async () => {
  const uat = await uatScriptedIds()

  assert.deepEqual(sorted(new Set(ROWS.map(row => row.id))), sorted(new Set(uat)))
})

test('every registry entry is unique per id and half', () => {
  const keys = ROWS.map(key)

  assert.deepEqual(keys.filter((item, index) => keys.indexOf(item) !== index), [])
})

test('every live entry names at least one fixture variant and none twice', () => {
  for (const row of ROWS.filter(item => item.tier === 'live')) {
    assert.ok(row.fixture.length > 0, `${key(row)} names no fixture variant`)
    assert.equal(new Set(row.fixture).size, row.fixture.length, `${key(row)} names a fixture variant twice`)
  }
})

test('the rows that copy two variants list exactly those two', () => {
  for (const [id, variants] of Object.entries(TWO_VARIANT_ROWS)) {
    const row = entryOf(id)
    assert.ok(row, `${id} is not in the registry`)
    assert.deepEqual(sorted(row.fixture), sorted(variants), `${id} lists other variants`)
  }
})

test('every kind is pass, recorded or mixed', () => {
  assert.deepEqual(ROWS.filter(row => !KINDS.includes(row.kind)).map(key), [])
})

test('the entries with a cassette are exactly the 18 live recorded and mixed rows', () => {
  const withCassette = ROWS.filter(row => row.cassette !== undefined)
  const liveRecorded = ROWS.filter(row => row.tier === 'live' && row.kind !== 'pass')

  assert.deepEqual(sorted(withCassette.map(key)), sorted(CASSETTE_ROWS))
  assert.deepEqual(sorted(liveRecorded.map(key)), sorted(CASSETTE_ROWS))
  assert.ok(withCassette.every(row => row.tier === 'live'))
})

test('no offline entry has a cassette', () => {
  assert.deepEqual(ROWS.filter(row => row.tier === 'offline' && row.cassette !== undefined).map(key), [])
})

test('the rows with a 2.1.295 half record that half as a partial', () => {
  for (const id of RC_PIN_ROWS) {
    const parts = entryOf(id)?.partial ?? []
    assert.ok(parts.some(item => item.part.includes('2.1.295')), `${id} has no partial for its 2.1.295 half`)
  }
})

test('the variant closure lists every variant once, after the variants it copies from', () => {
  assert.deepEqual(variantClosure(['sp-pre', 'gsd'], fromOf(SAMPLE_FROM)), ['sp-pre', 'gsd-pre', 'gsd'])
  assert.deepEqual(variantClosure(['gsd', 'gsd-pre', 'gsd'], fromOf(SAMPLE_FROM)), ['gsd-pre', 'gsd'])
})

test('the variant closure refuses an unknown variant and a cycle', () => {
  const unknown = harnessErrorNaming('no-such-variant')

  assert.throws(() => variantClosure(['gsd', 'no-such-variant'], fromOf(SAMPLE_FROM)), unknown)
  assert.throws(() => variantClosure(['a'], fromOf(CYCLE_FROM)), HarnessError)
})

test('every builder copies only from variants that have a builder', () => {
  for (const [variant, builder] of Object.entries(VARIANTS)) {
    const missing = builder.from.filter(name => VARIANTS[name] === undefined)
    assert.deepEqual(missing, [], `${variant} copies from variants with no builder`)
  }
})

test('the closure of every live entry with built variants holds each once, after what it copies from', () => {
  const entries = ROWS.filter(row => row.tier === 'live' && row.fixture.every(name => VARIANTS[name] !== undefined))
  assert.ok(entries.length > 0, 'no live entry names only variants that have a builder')
  for (const row of entries) {
    const closure = variantClosure(row.fixture, builderFrom)
    assert.equal(new Set(closure).size, closure.length, `${key(row)}: a variant twice in the closure`)
    for (const name of row.fixture) assert.ok(closure.includes(name), `${key(row)}: ${name} not in the closure`)
    for (const [index, name] of closure.entries()) {
      const late = (builderFrom(name) ?? []).filter(dependency => !closure.slice(0, index).includes(dependency))
      assert.deepEqual(late, [], `${key(row)}: ${name} does not come after every variant it copies from`)
    }
  }
})

test('the exclusive entries are exactly the live rows that install plugins or marketplaces or stage a user-level GSD', () => {
  const exclusive = ROWS.filter(row => row.exclusive === true)

  assert.deepEqual(sorted(exclusive.map(key)), sorted(EXCLUSIVE_ROWS))
  assert.ok(exclusive.every(row => row.tier === 'live'), 'an exclusive entry is not live')
  assert.equal(entryOf('03#83')?.file, entryOf('03#87')?.file, '03#83 and 03#87 do not share one file')
})
