import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { HarnessError } from './errors.ts'
import { run, spawn } from './proc.ts'
import { removeTree, scratchRoot } from './scratch.ts'

const PATH = '/usr/bin:/bin'
const TIMEOUT_MS = 10_000

let dir = ''
let home = ''

before(async () => {
  dir = await mkdtemp(join(scratchRoot(), 'unit-proc-'))
  home = join(dir, 'home')
  await mkdir(home)
})

after(async () => {
  await removeTree(dir, scratchRoot())
})

test('run refuses a child with no HOME and starts nothing', async () => {
  const marker = join(dir, 'no-home')
  const env = { PATH }

  await assert.rejects(run(['/usr/bin/touch', marker], { cwd: dir, env, timeoutMs: TIMEOUT_MS }), HarnessError)
  assert.equal(existsSync(marker), false)
})

test('run refuses a child whose HOME is outside the scratch root and starts nothing', async () => {
  const marker = join(dir, 'outside')
  const env = { PATH, HOME: tmpdir() }

  await assert.rejects(run(['/usr/bin/touch', marker], { cwd: dir, env, timeoutMs: TIMEOUT_MS }), HarnessError)
  assert.equal(existsSync(marker), false)
})

test('run refuses a HOME that climbs out of the scratch root', async () => {
  const marker = join(dir, 'climb')
  const env = { PATH, HOME: join(scratchRoot(), '..', '..') }

  await assert.rejects(run(['/usr/bin/touch', marker], { cwd: dir, env, timeoutMs: TIMEOUT_MS }), HarnessError)
  assert.equal(existsSync(marker), false)
})

test('run starts a child with a scratch HOME', async () => {
  const env = { PATH, HOME: home }
  const result = await run(['/usr/bin/printenv', 'HOME'], { cwd: dir, env, timeoutMs: TIMEOUT_MS })

  assert.deepEqual(result, { code: 0, stdout: `${home}\n`, stderr: '' })
})

test('run with the host flag starts a child whatever HOME is', async () => {
  const outside = await run(['/usr/bin/printenv', 'HOME'], {
    cwd: dir,
    env: { PATH, HOME: tmpdir() },
    timeoutMs: TIMEOUT_MS,
    host: true,
  })
  const missing = await run(['/bin/sh', '-c', 'echo ok'], {
    cwd: dir,
    env: { PATH },
    timeoutMs: TIMEOUT_MS,
    host: true,
  })

  assert.deepEqual(outside, { code: 0, stdout: `${tmpdir()}\n`, stderr: '' })
  assert.deepEqual(missing, { code: 0, stdout: 'ok\n', stderr: '' })
})

test('spawn applies the same HOME fence', () => {
  assert.throws(() => spawn(['/usr/bin/true'], { cwd: dir, env: { PATH } }), HarnessError)
})

test('run returns the exit code, stdout and stderr, and feeds input to stdin', async () => {
  const argv = ['/bin/sh', '-c', 'cat; echo err >&2; exit 3']
  const result = await run(argv, { cwd: dir, env: { PATH, HOME: home }, input: 'in', timeoutMs: TIMEOUT_MS })

  assert.deepEqual(result, { code: 3, stdout: 'in', stderr: 'err\n' })
})

test('run throws HarnessError when the child outlives timeoutMs', async () => {
  const argv = ['/bin/sleep', '5']

  await assert.rejects(run(argv, { cwd: dir, env: { PATH, HOME: home }, timeoutMs: 200 }), HarnessError)
})
