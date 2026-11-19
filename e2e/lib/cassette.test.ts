import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import {
  cassetteKey,
  cassetteState,
  cassetteTargetOf,
  DAY_MS,
  parseCassette,
  parseRecordMode,
  planCassette,
  readCassette,
  staleParts,
  suiteOfFile,
  withCassette,
  writeCassette,
} from './cassette.ts'
import type { Cassette, CassetteKey, CassetteRun, CassetteTarget } from './cassette.ts'
import { HarnessError, LeakError } from './errors.ts'
import { filterContext } from './filter.ts'
import { verdictOf } from './row.ts'
import type { RowBody, RowContext } from './row.ts'
import { removeTree, scratchRoot } from './scratch.ts'
import type { Check, Note, NotAutomated, Observation } from './summary.ts'

const HOME = '/Users/unitperson'
const CLAUDE = '2.1.322 (Claude Code)'
const NEWER_CLAUDE = '2.1.400 (Claude Code)'
const T0 = Date.UTC(2026, 10, 11, 12, 0, 0)
const RECORDED_AT = new Date(T0).toISOString()
const KEY: CassetteKey = { schema: 1, claude: CLAUDE, inputs: { hooks: 'h1' }, test: 't1' }

type World = {
  readonly repo: string
  readonly testFile: string
  readonly target: CassetteTarget
}

type Seen = {
  readonly checks: Check[]
  readonly observations: Observation[]
  readonly evidence: Note[]
  readonly screens: Note[]
  readonly parts: NotAutomated[]
  readonly skips: string[]
}

type Calls = { count: number }

let dir = ''

before(async () => {
  dir = await mkdtemp(join(scratchRoot(), 'unit-cassette-'))
})

after(async () => {
  await removeTree(dir, scratchRoot())
})

async function makeWorld(name: string): Promise<World> {
  const root = join(dir, name)
  const repo = join(root, 'repo')
  await mkdir(join(repo, 'hooks', 'golden'), { recursive: true })
  await writeFile(join(repo, 'hooks', 'a.ts'), 'export const a = 1\n')
  await writeFile(join(repo, 'hooks', 'a.test.ts'), 'a spec\n')
  await writeFile(join(repo, 'hooks', 'golden', 'g.json'), '{}\n')
  await writeFile(join(repo, 'single.ts'), 'export const single = 1\n')
  const testFile = join(root, 'row.test.ts')
  await writeFile(testFile, 'the row test\n')
  const target = { name: '99#1', dir: join(root, 'cassettes'), repo, testFile, inputs: ['hooks', 'single.ts'] }

  return { repo, testFile, target }
}

function fakeContext(): { readonly ctx: RowContext, readonly seen: Seen } {
  const seen: Seen = { checks: [], observations: [], evidence: [], screens: [], parts: [], skips: [] }
  const ctx: RowContext = {
    scratch: join(dir, 'row-scratch'),
    async check(name, fn) {
      try {
        await fn()
        seen.checks.push({ name, ok: true, message: '' })
      } catch (error) {
        if (error instanceof HarnessError) throw error
        seen.checks.push({ name, ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    },
    observe(name, value, evidence = '') {
      seen.observations.push({ name, value, evidence })
    },
    evidence(label, text) {
      seen.evidence.push({ label, text })
    },
    screen(label, text) {
      seen.screens.push({ label, text })
    },
    skipPart(name, reason) {
      seen.parts.push({ name, reason })
    },
    skip(reason) {
      seen.skips.push(reason)
    },
    after() {},
  }

  return { ctx, seen }
}

type RunSetup = { readonly run: CassetteRun, readonly states: string[] }

function runOf(world: World, over: Partial<CassetteRun> = {}): RunSetup {
  const states: string[] = []
  const run: CassetteRun = {
    ...world.target,
    claude: CLAUDE,
    mode: 'once',
    now: T0,
    meta: { id: '99#1', title: 'A unit row', tier: 'live', kind: 'mixed' },
    filter: filterContext({ HOME }),
    onState: state => {
      states.push(state)
    },
    ...over,
  }

  return { run, states }
}

function wholeRow(calls: Calls): RowBody {
  return async ctx => {
    calls.count += 1
    await ctx.check('first passes', () => {})
    await ctx.check('second fails', () => {
      throw new Error('saw two lines')
    })
    ctx.observe('flag', true, 'raw output')
    ctx.evidence('listing', 'ls output')
    ctx.screen('after the start', 'the screen')
    ctx.skipPart('the 2.1.295 half', 'waits for the RC pin')
  }
}

function neverCalled(): RowBody {
  return async () => {
    throw new Error('the body ran although the cassette should replay')
  }
}

async function recordWhole(world: World): Promise<void> {
  await withCassette(fakeContext().ctx, runOf(world).run, wholeRow({ count: 0 }))
}

async function stored(world: World): Promise<Cassette> {
  const cassette = await readCassette(world.target.dir, world.target.name)
  assert.ok(cassette, 'no readable cassette was written')

  return cassette
}

function written(world: World, name: string, ext: 'json' | 'md' = 'json'): boolean {
  return existsSync(join(world.target.dir, `${name}.${ext}`))
}

function cassetteWith(over: Partial<Cassette>): Cassette {
  return {
    schema: 1,
    key: KEY,
    recordedAt: RECORDED_AT,
    thrown: null,
    row: {
      schema: 1,
      id: '99#1',
      half: '',
      title: 'A unit row',
      tier: 'live',
      kind: 'mixed',
      verdict: 'pass',
      reason: '',
      checks: [],
      observations: [],
      evidence: [],
      screens: [],
      notAutomated: [],
      cassette: 'recorded',
      durationMs: 1,
    },
    ...over,
  }
}

function withEvidence(text: string): Cassette {
  return cassetteWith({ row: { ...cassetteWith({}).row, evidence: [{ label: 'cwd', text }] } })
}

test('parseRecordMode reads once, none and all, takes once for no value and refuses other text', () => {
  assert.equal(parseRecordMode(undefined), 'once')
  assert.equal(parseRecordMode(''), 'once')
  assert.equal(parseRecordMode('once'), 'once')
  assert.equal(parseRecordMode('none'), 'none')
  assert.equal(parseRecordMode('all'), 'all')
  assert.equal(parseRecordMode('ALL'), null)
  assert.equal(parseRecordMode('sometimes'), null)
})

test('the cassette key hashes folders without spec files and golden, and files as they are', async () => {
  const world = await makeWorld('key')
  const first = await cassetteKey(world.target, CLAUDE)
  await writeFile(join(world.repo, 'hooks', 'a.test.ts'), 'another spec\n')
  await writeFile(join(world.repo, 'hooks', 'golden', 'g.json'), '{"changed":true}\n')
  const unchanged = await cassetteKey(world.target, CLAUDE)
  await writeFile(join(world.repo, 'hooks', 'a.ts'), 'export const a = 2\n')
  const folderChanged = await cassetteKey(world.target, CLAUDE)
  await writeFile(join(world.repo, 'single.ts'), 'export const single = 2\n')
  const fileChanged = await cassetteKey(world.target, CLAUDE)
  await writeFile(world.testFile, 'the row test, edited\n')
  const testChanged = await cassetteKey(world.target, CLAUDE)

  assert.deepEqual(Object.keys(first.inputs), ['hooks', 'single.ts'])
  assert.deepEqual(unchanged, first)
  assert.notEqual(folderChanged.inputs.hooks, first.inputs.hooks)
  assert.equal(folderChanged.inputs['single.ts'], first.inputs['single.ts'])
  assert.notEqual(fileChanged.inputs['single.ts'], folderChanged.inputs['single.ts'])
  assert.notEqual(testChanged.test, fileChanged.test)
  assert.equal(testChanged.claude, CLAUDE)
})

test('the cassette key refuses a missing input, a path out of the repo and a missing test file', async () => {
  const world = await makeWorld('key-refusals')
  const missing = { ...world.target, inputs: ['hooks/nope.ts'] }
  const noTest = { ...world.target, testFile: join(world.repo, 'no-test.ts') }

  await assert.rejects(cassetteKey(missing, CLAUDE), (error: unknown) => {
    return error instanceof HarnessError && error.message.includes('hooks/nope.ts')
  })
  await assert.rejects(cassetteKey({ ...world.target, inputs: ['../outside'] }, CLAUDE), HarnessError)
  await assert.rejects(cassetteKey({ ...world.target, inputs: ['/etc'] }, CLAUDE), HarnessError)
  await assert.rejects(cassetteKey(noTest, CLAUDE), HarnessError)
})

test('equal keys replay; a changed claude version, input or test file makes once record and names the part', () => {
  const saved = cassetteWith({})
  const changed = (over: Partial<CassetteKey>): unknown => {
    return planCassette('once', saved, { ...KEY, ...over }, undefined, T0)
  }

  assert.equal(planCassette('once', saved, KEY, undefined, T0).action, 'replay')
  assert.deepEqual(changed({ claude: NEWER_CLAUDE }), { action: 'record', why: 'stale: claude version' })
  assert.deepEqual(changed({ inputs: { hooks: 'h2' } }), { action: 'record', why: 'stale: input hooks' })
  assert.deepEqual(changed({ test: 't2' }), { action: 'record', why: 'stale: test file' })
  const both = { ...KEY, inputs: { hooks: 'h1', extra: 'x' }, test: 't2' }
  assert.deepEqual(staleParts(saved, both, undefined, T0), ['input extra', 'test file'])
})

test('once records with no cassette, none refuses a missing or stale one, all always records', () => {
  const saved = cassetteWith({})
  const stale = { ...KEY, test: 't2' }

  assert.deepEqual(planCassette('once', null, KEY, undefined, T0), { action: 'record', why: 'no cassette yet' })
  assert.deepEqual(planCassette('none', null, KEY, undefined, T0), { action: 'refuse', why: 'no readable cassette' })
  assert.deepEqual(planCassette('none', saved, stale, undefined, T0), { action: 'refuse', why: 'stale: test file' })
  assert.equal(planCassette('none', saved, KEY, undefined, T0).action, 'replay')
  assert.deepEqual(planCassette('all', saved, KEY, undefined, T0), { action: 'record', why: 'E2E_RECORD=all' })
  assert.deepEqual(planCassette('all', null, KEY, undefined, T0), { action: 'record', why: 'E2E_RECORD=all' })
})

test('ttlDays expires a cassette with the injected clock', () => {
  const saved = cassetteWith({})
  const expired = { action: 'record', why: 'stale: older than 7 days' }

  assert.equal(planCassette('once', saved, KEY, 7, T0 + 7 * DAY_MS - 1).action, 'replay')
  assert.deepEqual(planCassette('once', saved, KEY, 7, T0 + 7 * DAY_MS), expired)
  assert.deepEqual(planCassette('none', saved, KEY, 7, T0 + 8 * DAY_MS), { action: 'refuse', why: expired.why })
  assert.equal(planCassette('once', saved, KEY, undefined, T0 + 400 * DAY_MS).action, 'replay')
})

test('record then replay restores checks, observation, evidence, screen, skipped part and verdict fail', async () => {
  const world = await makeWorld('whole')
  const recorded = fakeContext()
  const recording = runOf(world)
  const calls = { count: 0 }

  await withCassette(recorded.ctx, recording.run, wholeRow(calls))
  const saved = await stored(world)
  const replayed = fakeContext()
  const replaying = runOf(world)
  await withCassette(replayed.ctx, replaying.run, neverCalled())
  const failedChecks = replayed.seen.checks.filter(check => !check.ok).length
  const outcome = { harnessError: false, thrown: false, failedChecks, skipped: false }

  assert.equal(calls.count, 1)
  assert.equal(saved.row.verdict, 'fail')
  assert.equal(saved.row.reason, 'checks failed: second fails')
  assert.deepEqual(recording.states, ['recorded'])
  assert.deepEqual(replaying.states, [`(replayed ${RECORDED_AT})`])
  assert.deepEqual(replayed.seen, recorded.seen)
  assert.deepEqual(replayed.seen.checks, [
    { name: 'first passes', ok: true, message: '' },
    { name: 'second fails', ok: false, message: 'saw two lines' },
  ])
  assert.deepEqual(replayed.seen.observations, [{ name: 'flag', value: true, evidence: 'raw output' }])
  assert.deepEqual(replayed.seen.evidence, [{ label: 'listing', text: 'ls output' }])
  assert.deepEqual(replayed.seen.screens, [{ label: 'after the start', text: 'the screen' }])
  assert.deepEqual(replayed.seen.parts, [{ name: 'the 2.1.295 half', reason: 'waits for the RC pin' }])
  assert.equal(verdictOf('mixed', outcome), saved.row.verdict)
  assert.ok(written(world, '99#1', 'md'))
  assert.match(await readFile(join(world.target.dir, '99#1.md'), 'utf8'), /^## Cassette key$/m)
})

test('a passing row of kind recorded stores the verdict recorded and replays without a failed check', async () => {
  const world = await makeWorld('recorded-kind')
  const meta = { id: '99#1', title: 'A unit row', tier: 'live', kind: 'recorded' } as const
  const body: RowBody = async ctx => {
    ctx.observe('seen', 'yes')
  }

  await withCassette(fakeContext().ctx, runOf(world, { meta }).run, body)
  const replayed = fakeContext()
  await withCassette(replayed.ctx, runOf(world, { meta }).run, neverCalled())

  assert.equal((await stored(world)).row.verdict, 'recorded')
  assert.deepEqual(replayed.seen.observations, [{ name: 'seen', value: 'yes', evidence: '' }])
  assert.deepEqual(replayed.seen.checks, [])
})

test('a body that throws a HarnessError writes no cassette and the error goes on', async () => {
  const world = await makeWorld('harness-error')
  const { run, states } = runOf(world)
  const body: RowBody = async ctx => {
    ctx.observe('before', 1)
    throw new HarnessError('tmux is gone')
  }

  await assert.rejects(withCassette(fakeContext().ctx, run, body), HarnessError)
  assert.equal(written(world, '99#1'), false)
  assert.equal(written(world, '99#1', 'md'), false)
  assert.deepEqual(states, [])
})

test('a HarnessError inside a check ends the row and writes no cassette', async () => {
  const world = await makeWorld('harness-check')
  const body: RowBody = async ctx => {
    await ctx.check('looks at a pane', () => {
      throw new HarnessError('the pane is dead')
    })
  }

  await assert.rejects(withCassette(fakeContext().ctx, runOf(world).run, body), HarnessError)
  assert.equal(written(world, '99#1'), false)
})

test('a body that throws another error records the fail and the replay throws the stored message', async () => {
  const world = await makeWorld('thrown')
  const body: RowBody = async ctx => {
    ctx.observe('step', 'one')
    throw new Error('boom in the body')
  }

  await assert.rejects(withCassette(fakeContext().ctx, runOf(world).run, body), /boom in the body/)
  const saved = await stored(world)
  const replayed = fakeContext()

  assert.equal(saved.row.verdict, 'fail')
  assert.equal(saved.thrown, 'boom in the body')
  await assert.rejects(withCassette(replayed.ctx, runOf(world).run, neverCalled()), /boom in the body/)
  assert.deepEqual(replayed.seen.observations, [{ name: 'step', value: 'one', evidence: '' }])
})

test('a skipped body writes no cassette', async () => {
  const world = await makeWorld('skipped')
  const { run, states } = runOf(world)
  const skipped = fakeContext()
  const body: RowBody = async ctx => {
    ctx.skip('no fish on this host')
  }

  await withCassette(skipped.ctx, run, body)

  assert.deepEqual(skipped.seen.skips, ['no fish on this host'])
  assert.equal(written(world, '99#1'), false)
  assert.deepEqual(states, [])
})

test('once records over a stale cassette and says which part changed', async () => {
  const world = await makeWorld('stale')
  await recordWhole(world)
  await writeFile(join(world.repo, 'hooks', 'a.ts'), 'export const a = 3\n')
  const calls = { count: 0 }
  const { run, states } = runOf(world)

  await withCassette(fakeContext().ctx, run, wholeRow(calls))

  assert.equal(calls.count, 1)
  assert.deepEqual(states, ['recorded (stale: input hooks)'])
  assert.equal((await stored(world)).key.inputs.hooks, (await cassetteKey(world.target, CLAUDE)).inputs.hooks)
  await withCassette(fakeContext().ctx, runOf(world).run, neverCalled())
})

test('none replays a fresh cassette and throws a HarnessError naming the stale or missing part', async () => {
  const world = await makeWorld('none')
  const missing = await makeWorld('none-missing')
  const none = (over: World): CassetteRun => runOf(over, { mode: 'none' }).run
  const names = (text: string) => (error: unknown) => error instanceof HarnessError && error.message.includes(text)

  await assert.rejects(withCassette(fakeContext().ctx, none(missing), neverCalled()), names('no readable cassette'))
  assert.equal(written(missing, '99#1'), false)
  await recordWhole(world)
  await withCassette(fakeContext().ctx, none(world), neverCalled())
  await writeFile(join(world.repo, 'single.ts'), 'export const single = 3\n')

  await assert.rejects(withCassette(fakeContext().ctx, none(world), neverCalled()), names('input single.ts'))
  await assert.rejects(withCassette(fakeContext().ctx, none(world), neverCalled()), names('99#1'))
})

test('all records every time, even when the cassette is fresh', async () => {
  const world = await makeWorld('all')
  const calls = { count: 0 }
  const { run, states } = runOf(world, { mode: 'all' })

  await withCassette(fakeContext().ctx, run, wholeRow(calls))
  await withCassette(fakeContext().ctx, run, wholeRow(calls))

  assert.equal(calls.count, 2)
  assert.deepEqual(states, ['recorded (E2E_RECORD=all)', 'recorded (E2E_RECORD=all)'])
})

test('a cassette older than ttlDays is recorded again', async () => {
  const world = await makeWorld('ttl')
  await recordWhole(world)
  const calls = { count: 0 }
  const early = runOf(world, { ttlDays: 7, now: T0 + 6 * DAY_MS })
  const late = runOf(world, { ttlDays: 7, now: T0 + 7 * DAY_MS })

  await withCassette(fakeContext().ctx, early.run, neverCalled())
  await withCassette(fakeContext().ctx, late.run, wholeRow(calls))

  assert.equal(calls.count, 1)
  assert.deepEqual(early.states, [`(replayed ${RECORDED_AT})`])
  assert.deepEqual(late.states, ['recorded (stale: older than 7 days)'])
})

test('a cassette is filtered before it is written and a residue throws LeakError and writes nothing', async () => {
  const world = await makeWorld('filter')
  const ctx = filterContext({ HOME })
  const withHome = { ...withEvidence(`${HOME}/repo`), thrown: `failed in ${HOME}/repo` }
  const leakyTarget = { ...world.target, name: '99#2' }

  await writeCassette(world.target, withHome, ctx)
  const json = await readFile(join(world.target.dir, '99#1.json'), 'utf8')
  const doc = await readFile(join(world.target.dir, '99#1.md'), 'utf8')
  await assert.rejects(writeCassette(leakyTarget, withEvidence('/var/folders/zz/T/x'), ctx), LeakError)

  assert.equal(json.includes(HOME), false)
  assert.equal(doc.includes(HOME), false)
  assert.ok(json.includes('~/repo'))
  assert.equal((await stored(world)).thrown, 'failed in ~/repo')
  assert.equal(written(world, '99#2'), false)
  assert.equal(written(world, '99#2', 'md'), false)
})

test('a row whose evidence holds a residue ends in a HarnessError and writes no cassette', async () => {
  const world = await makeWorld('leak-row')
  const { run, states } = runOf(world)
  const body: RowBody = async ctx => {
    ctx.evidence('ls', '/var/folders/zz/T/x')
  }

  await assert.rejects(withCassette(fakeContext().ctx, run, body), (error: unknown) => {
    return error instanceof HarnessError && error.message.includes('was not written')
  })
  assert.equal(written(world, '99#1'), false)
  assert.equal(written(world, '99#1', 'md'), false)
  assert.deepEqual(states, [])
})

test('parseCassette returns null on malformed JSON, a wrong schema or a wrong field', () => {
  const good = cassetteWith({})
  const text = (value: unknown): string => JSON.stringify(value)

  assert.deepEqual(parseCassette(text(good)), good)
  assert.equal(parseCassette('{'), null)
  assert.equal(parseCassette('[]'), null)
  assert.equal(parseCassette(text({ ...good, schema: 2 })), null)
  assert.equal(parseCassette(text({ ...good, recordedAt: 'yesterday' })), null)
  assert.equal(parseCassette(text({ ...good, thrown: 5 })), null)
  assert.equal(parseCassette(text({ ...good, key: { ...good.key, inputs: { hooks: 1 } } })), null)
  assert.equal(parseCassette(text({ ...good, key: { ...good.key, claude: 3 } })), null)
  assert.equal(parseCassette(text({ ...good, row: { ...good.row, verdict: 'maybe' } })), null)
  assert.equal(parseCassette(text({ ...good, row: undefined })), null)
})

test('an unreadable cassette file counts as no cassette', async () => {
  const world = await makeWorld('broken')
  await mkdir(world.target.dir, { recursive: true })
  await writeFile(join(world.target.dir, '99#1.json'), '{"schema":1,')
  const calls = { count: 0 }
  const { run, states } = runOf(world)

  await withCassette(fakeContext().ctx, run, wholeRow(calls))

  assert.equal(calls.count, 1)
  assert.deepEqual(states, ['recorded'])
  assert.equal((await stored(world)).row.verdict, 'fail')
})

test('cassetteState says replay, record or refuse the way withCassette will act', async () => {
  const world = await makeWorld('state')
  const at = { claude: CLAUDE, mode: 'once', now: T0 } as const
  const missingInput = { ...world.target, inputs: ['hooks/nope.ts'] }

  assert.deepEqual(await cassetteState(world.target, at), { action: 'record', why: 'no cassette yet' })
  assert.equal((await cassetteState(world.target, { ...at, mode: 'none' })).action, 'refuse')
  await recordWhole(world)

  assert.equal((await cassetteState(world.target, at)).action, 'replay')
  assert.deepEqual(await cassetteState(world.target, { ...at, mode: 'all' }), {
    action: 'record',
    why: 'E2E_RECORD=all',
  })
  assert.deepEqual(await cassetteState(world.target, { ...at, claude: NEWER_CLAUDE }), {
    action: 'record',
    why: 'stale: claude version',
  })
  const refused = await cassetteState(missingInput, at)
  assert.equal(refused.action, 'refuse')
  assert.ok('why' in refused && refused.why.includes('hooks/nope.ts'))
})

test('suiteOfFile finds the one suite folder that has a registry and the file', async () => {
  const root = join(dir, 'e2e-sample')
  const files = ['one/rows.ts', 'one/live/x.test.ts', 'two/rows.ts', 'two/live/x.test.ts', 'two/live/y.test.ts']
  for (const file of [...files, 'three/live/x.test.ts']) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), '')
  }
  await mkdir(join(root, 'lib'))

  assert.equal(await suiteOfFile(root, 'live/y.test.ts'), 'two')
  await assert.rejects(suiteOfFile(root, 'live/x.test.ts'), HarnessError)
  await assert.rejects(suiteOfFile(root, 'live/none.test.ts'), HarnessError)
})

test('cassetteTargetOf puts the cassette under e2e/cassettes/<suite> and names it after the row and half', () => {
  const testFile = '/r/e2e/cadre/live/03-70.test.ts'
  const target = cassetteTargetOf('/r/e2e', 'cadre', testFile, {
    id: '03#70',
    cassette: { inputs: ['cadre/hooks'], ttlDays: 7 },
  })
  const half = cassetteTargetOf('/r/e2e', 'cadre', testFile, { id: '03#68', half: 'b', cassette: { inputs: [] } })

  assert.deepEqual(target, {
    name: '03#70',
    dir: '/r/e2e/cassettes/cadre',
    repo: '/r',
    testFile,
    inputs: ['cadre/hooks'],
    ttlDays: 7,
  })
  assert.equal(half.name, '03#68b')
  assert.equal(half.ttlDays, undefined)
})
