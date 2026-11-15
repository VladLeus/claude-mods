import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { recordShim } from './shims.ts'

const PROGRAM_LINES: readonly string[] = ['#!/bin/sh', `printf 'a\\nb\\n'`, `printf '%s\\n' "$1"`, 'exit 3', '']
const ECHO_LINES: readonly string[] = ['#!/bin/sh', `printf '%s\\n' "$@"`, '/bin/cat', '']

let dir = ''

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'unit-shims-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

test('recordShim passes the program stdout and exit code through and appends the stdout to the out file', async () => {
  const program = join(dir, 'program.sh')
  await writeFile(program, PROGRAM_LINES.join('\n'))
  await chmod(program, 0o755)
  const out = join(dir, 'stdout.jsonl')
  const shim = await recordShim(join(dir, 'bin'), program, out)

  const first = spawnSync(shim, ['x'], { encoding: 'utf8' })
  assert.equal(shim, join(dir, 'bin', 'claude'))
  assert.equal(first.stdout, 'a\nb\nx\n')
  assert.equal(first.status, 3)
  assert.equal(await readFile(out, 'utf8'), 'a\nb\nx\n')

  const second = spawnSync(shim, ['y'], { encoding: 'utf8' })
  assert.equal(second.stdout, 'a\nb\ny\n')
  assert.equal(second.status, 3)
  assert.equal(await readFile(out, 'utf8'), 'a\nb\nx\na\nb\ny\n')
})

test('recordShim keeps an argument with spaces whole, passes stdin through and leaves no part file', async () => {
  const folder = join(dir, 'echo')
  await mkdir(folder)
  const program = join(folder, 'program.sh')
  await writeFile(program, ECHO_LINES.join('\n'))
  await chmod(program, 0o755)
  const out = join(folder, 'stdout.jsonl')
  const shim = await recordShim(join(folder, 'bin'), program, out)

  const result = spawnSync(shim, ['two words', 'x'], { encoding: 'utf8', input: 'from stdin\n' })
  assert.equal(result.stdout, 'two words\nx\nfrom stdin\n')
  assert.equal(result.status, 0)
  assert.equal(await readFile(out, 'utf8'), 'two words\nx\nfrom stdin\n')
  assert.deepEqual((await readdir(folder)).filter(name => name.startsWith('stdout.jsonl.')), [])
})
