import assert from 'node:assert/strict'
import { test } from 'node:test'
import { roleWaves } from './schedule.ts'
import type { ScheduledRow } from './schedule.ts'

const MIXES: readonly (readonly string[])[] = [[], ['be'], ['pm'], ['be', 'pm']]

function row(file: string, roleSession: string | null = null): ScheduledRow {
  return { file, roleSession }
}

function rowsOf(mix: readonly (readonly string[])[]): readonly ScheduledRow[] {
  return mix.flatMap((roles, index) => {
    const file = `f${index}`

    return roles.length === 0 ? [row(file)] : roles.map(role => row(file, role))
  })
}

function everyMixOf(files: number): readonly (readonly (readonly string[])[])[] {
  if (files === 0) return [[]]

  return everyMixOf(files - 1).flatMap(rest => MIXES.map(roles => [...rest, roles]))
}

test('no rows make no waves', () => {
  assert.deepEqual(roleWaves([]), [])
})

test('rows without a role session run in one wave, each file once, in the order given', () => {
  assert.deepEqual(roleWaves([row('a'), row('b'), row('a'), row('c')]), [['a', 'b', 'c']])
})

test('rows of different role sessions share a wave', () => {
  assert.deepEqual(roleWaves([row('a', 'be'), row('b', 'pm'), row('c')]), [['a', 'b', 'c']])
})

test('files with rows of the same role session never share a wave', () => {
  assert.deepEqual(roleWaves([row('a', 'be'), row('b', 'be'), row('c', 'be')]), [['a'], ['b'], ['c']])
})

test('files without a role session and files of other roles fill the first wave', () => {
  const rows = [row('free1'), row('be1', 'be'), row('be2', 'be'), row('free2'), row('pm1', 'pm'), row('be3', 'be')]

  assert.deepEqual(roleWaves(rows), [['free1', 'be1', 'free2', 'pm1'], ['be2'], ['be3']])
})

test('two rows of one file with the same role session are one file in one wave', () => {
  assert.deepEqual(roleWaves([row('a', 'be'), row('a', 'be'), row('b', 'be')]), [['a'], ['b']])
})

test('a file holding rows of two role sessions waits for the files of both', () => {
  const rows = [row('both', 'be'), row('both', 'pm'), row('pm1', 'pm'), row('be1', 'be'), row('free')]

  assert.deepEqual(roleWaves(rows), [['both', 'free'], ['pm1', 'be1']])
})

test('over every mix of four files no wave holds two files of one role session and every file runs once', () => {
  for (const mix of everyMixOf(4)) {
    const waves = roleWaves(rowsOf(mix))

    assert.deepEqual(waves.flat().sort(), ['f0', 'f1', 'f2', 'f3'], `files run once for ${JSON.stringify(mix)}`)
    for (const wave of waves) {
      const roles = wave.flatMap(file => mix[Number(file.slice(1))] ?? [])
      assert.equal(new Set(roles).size, roles.length, `a role twice in a wave for ${JSON.stringify(mix)}`)
    }
  }
})
