import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { HarnessError } from './errors.ts'
import { removeTree, scratchRoot } from './scratch.ts'

let dir = ''
let root = ''

before(async () => {
  dir = await mkdtemp(join(scratchRoot(), 'unit-scratch-'))
  root = join(dir, 'root')
  await mkdir(root)
})

after(async () => {
  await removeTree(dir, scratchRoot())
})

async function folderWithFile(path: string): Promise<string> {
  await mkdir(path, { recursive: true })
  const file = join(path, 'keep.txt')
  await writeFile(file, 'keep')

  return file
}

test('removeTree removes a folder inside the scratch root', async () => {
  const target = join(root, 'plain')
  await folderWithFile(target)

  await removeTree(target, root)
  assert.equal(existsSync(target), false)
})

test('removeTree refuses a path outside the scratch root and removes nothing', async () => {
  const file = await folderWithFile(join(dir, 'outside'))

  await assert.rejects(removeTree(join(dir, 'outside'), root), HarnessError)
  await assert.rejects(removeTree(`${root}/../outside`, root), HarnessError)
  assert.equal(existsSync(file), true)
})

test('removeTree refuses a symlink and removes neither the link nor its target', async () => {
  const file = await folderWithFile(join(dir, 'link-target'))
  const link = join(root, 'link')
  await symlink(join(dir, 'link-target'), link)

  await assert.rejects(removeTree(link, root), HarnessError)
  assert.equal((await lstat(link)).isSymbolicLink(), true)
  assert.equal(existsSync(file), true)
})

test('removeTree refuses a path holding whitespace and removes nothing', async () => {
  const file = await folderWithFile(join(root, 'has space'))

  await assert.rejects(removeTree(join(root, 'has space'), root), HarnessError)
  assert.equal(existsSync(file), true)
})
