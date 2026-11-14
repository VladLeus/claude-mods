import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { denyCoverOf, initEventOf, recordShim } from './shims.ts'

const PROGRAM_LINES: readonly string[] = ['#!/bin/sh', `printf 'a\\nb\\n'`, `printf '%s\\n' "$1"`, 'exit 3', '']
const FOLDER = '/cfg/projects/-r-a/memory/'
const FOLDER_RULES: readonly string[] = ['Edit(//cfg/projects/-r-a/memory/**)', 'Write(//cfg/projects/-r-a/memory/**)']

let dir = ''

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'unit-shims-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

function initLine(fields: Record<string, unknown>): string {
  return JSON.stringify({ type: 'system', subtype: 'init', ...fields })
}

function settingsText(deny: readonly unknown[]): string {
  return JSON.stringify({ permissions: { deny } })
}

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

test('initEventOf reads the lists and the auto memory folder of the first init line, past other events', () => {
  const text = [
    JSON.stringify({ type: 'system', subtype: 'hook_started' }),
    initLine({ skills: ['p:s'], slash_commands: ['c'], memory_paths: { auto: '/m/' } }),
    initLine({ skills: ['later'], slash_commands: [], memory_paths: { auto: '/n/' } }),
  ].join('\n')

  assert.deepEqual(initEventOf(text), { skills: ['p:s'], slashCommands: ['c'], memoryAuto: '/m/' })
})

test('initEventOf gives a null memory folder when memory_paths.auto is missing or not a string', () => {
  const expected = { skills: [], slashCommands: ['c'], memoryAuto: null }

  assert.deepEqual(initEventOf(initLine({ skills: [], slash_commands: ['c'] })), expected)
  assert.deepEqual(initEventOf(initLine({ skills: [], slash_commands: ['c'], memory_paths: { auto: 1 } })), expected)
})

test('initEventOf is null with no init line, an init line that is not JSON, or a missing or mixed list', () => {
  assert.equal(initEventOf(JSON.stringify({ type: 'assistant' })), null)
  assert.equal(initEventOf('{"type":"system","subtype":"init",'), null)
  assert.equal(initEventOf(initLine({ slash_commands: ['c'] })), null)
  assert.equal(initEventOf(initLine({ skills: ['p:s'] })), null)
  assert.equal(initEventOf(initLine({ skills: ['p:s'], slash_commands: ['c', 1] })), null)
})

test('denyCoverOf counts the deny entries and the Edit and Write rules on the folder itself', () => {
  const text = settingsText([...FOLDER_RULES, 'Read(./x)'])

  assert.deepEqual(denyCoverOf(text, FOLDER), { deny: 3, edit: 1, write: 1 })
})

test('denyCoverOf counts the Edit and Write rules on a parent of the folder', () => {
  const text = settingsText(['Edit(//cfg/projects/**)', 'Write(//cfg/projects/**)'])

  assert.deepEqual(denyCoverOf(text, FOLDER), { deny: 2, edit: 1, write: 1 })
})

test('denyCoverOf counts no Write rule when only the Edit rule is there', () => {
  const text = settingsText(['Edit(//cfg/projects/-r-a/memory/**)'])

  assert.deepEqual(denyCoverOf(text, FOLDER), { deny: 1, edit: 1, write: 0 })
})

test('denyCoverOf counts no rule on a folder whose name only starts the same', () => {
  const sibling = settingsText(FOLDER_RULES)
  const short = settingsText(['Edit(//cfg/projects/-r/**)', 'Write(//cfg/projects/-r/**)'])

  assert.deepEqual(denyCoverOf(sibling, '/cfg/projects/-r-ab/memory'), { deny: 2, edit: 0, write: 0 })
  assert.deepEqual(denyCoverOf(short, '/cfg/projects/-r-a/memory'), { deny: 2, edit: 0, write: 0 })
})

test('denyCoverOf counts neither an exact rule with no /** nor a rule with one leading slash', () => {
  const text = settingsText(['Edit(//cfg/projects/-r-a/memory)', 'Write(/cfg/projects/-r-a/memory/**)'])

  assert.deepEqual(denyCoverOf(text, FOLDER), { deny: 2, edit: 0, write: 0 })
})

test('denyCoverOf is null for no text, a text that is not JSON and JSON with no permissions.deny string list', () => {
  assert.equal(denyCoverOf(null, FOLDER), null)
  assert.equal(denyCoverOf('{"permissions":', FOLDER), null)
  assert.equal(denyCoverOf(JSON.stringify({ permissions: {} }), FOLDER), null)
  assert.equal(denyCoverOf(settingsText(['Read(./x)', 1]), FOLDER), null)
})
