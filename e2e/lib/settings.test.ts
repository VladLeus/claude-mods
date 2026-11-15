import assert from 'node:assert/strict'
import { test } from 'node:test'
import { denyCoverOf } from './settings.ts'

const FOLDER = '/cfg/projects/-r-a/memory/'
const FOLDER_RULES: readonly string[] = ['Edit(//cfg/projects/-r-a/memory/**)', 'Write(//cfg/projects/-r-a/memory/**)']

function settingsText(deny: readonly unknown[]): string {
  return JSON.stringify({ permissions: { deny } })
}

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

test('denyCoverOf is null for a text that is not JSON and JSON with no permissions.deny string list', () => {
  assert.equal(denyCoverOf('{"permissions":', FOLDER), null)
  assert.equal(denyCoverOf(JSON.stringify({ permissions: {} }), FOLDER), null)
  assert.equal(denyCoverOf(settingsText(['Read(./x)', 1]), FOLDER), null)
})
