import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { otherEntryChanges, restoreState, snapshotState } from './config-state.ts'
import type { TopEntry } from './config-state.ts'
import { HarnessError } from './errors.ts'
import { treeListing } from './hash.ts'
import { removeTree, scratchRoot } from './scratch.ts'

let dir = ''

before(async () => {
  dir = await mkdtemp(join(scratchRoot(), 'unit-config-state-'))
})

after(async () => {
  await removeTree(dir, scratchRoot())
})

async function e2eLike(name: string, withSettings: boolean): Promise<string> {
  const root = join(dir, name)
  await mkdir(join(root, 'plugins', 'cache', 'mods'), { recursive: true })
  await mkdir(join(root, 'projects', '-scratch-repo'), { recursive: true })
  await mkdir(join(root, 'sessions'))
  await writeFile(join(root, '.claude.json'), '{"unit":true}\n')
  await writeFile(join(root, 'projects', '-scratch-repo', 'unit.jsonl'), '{}\n')
  await writeFile(join(root, 'plugins', 'known_marketplaces.json'), '{"mods":{}}\n')
  await writeFile(join(root, 'plugins', 'cache', 'mods', 'hook.ts'), 'export {}\n')
  if (withSettings) await writeFile(join(root, 'settings.json'), '{"enabledPlugins":{}}\n')

  return root
}

async function shape(path: string): Promise<string> {
  const lines = (await treeListing(path)).trimEnd().split('\n')

  return lines.map(line => {
    const [rel, kind, mode, , , content] = line.split('\t')
    return [rel, kind, mode, content].join('\t')
  }).join('\n')
}

async function untouched(root: string): Promise<{ text: string, mtimeNs: bigint, projects: string }> {
  const claudeJson = join(root, '.claude.json')

  return {
    text: await readFile(claudeJson, 'utf8'),
    mtimeNs: (await lstat(claudeJson, { bigint: true })).mtimeNs,
    projects: await treeListing(join(root, 'projects')),
  }
}

test('restore after a change gives back plugins/ and settings.json and spares .claude.json and projects/', async () => {
  const root = await e2eLike('restore', true)
  const snap = join(dir, 'restore-snap')
  const pluginsBefore = await shape(join(root, 'plugins'))
  const settingsBefore = await readFile(join(root, 'settings.json'), 'utf8')
  const keptBefore = await untouched(root)

  await snapshotState(root, snap)
  await writeFile(join(root, 'plugins', 'known_marketplaces.json'), '{"other":{}}\n')
  await writeFile(join(root, 'plugins', 'installed_plugins.json'), '{}\n')
  await rm(join(root, 'plugins', 'cache', 'mods', 'hook.ts'))
  await writeFile(join(root, 'settings.json'), '{"changed":true}\n')
  await restoreState(root, snap)

  assert.equal(await shape(join(root, 'plugins')), pluginsBefore)
  assert.equal(await readFile(join(root, 'settings.json'), 'utf8'), settingsBefore)
  assert.deepEqual(await untouched(root), keptBefore)
})

test('a dir with no settings.json restores to none', async () => {
  const root = await e2eLike('absent', false)
  const snap = join(dir, 'absent-snap')

  await snapshotState(root, snap)
  await writeFile(join(root, 'settings.json'), '{"added":true}\n')
  await restoreState(root, snap)

  assert.equal(existsSync(join(root, 'settings.json')), false)
  assert.equal(existsSync(join(root, 'plugins', 'known_marketplaces.json')), true)
})

test('snapshotState lists the other top-level entries and one made in the window shows after restore', async () => {
  const root = await e2eLike('window', true)
  const before = await snapshotState(root, join(dir, 'window-snap'))
  await mkdir(join(root, 'cache'))
  const after = await restoreState(root, join(dir, 'window-snap'))

  assert.deepEqual(before.map(entry => entry.name), ['sessions'])
  assert.deepEqual(otherEntryChanges(before, after), ['cache'])
})

test('snapshotState refuses a snapshot folder outside the scratch root', async () => {
  const root = await e2eLike('outside', true)

  await assert.rejects(snapshotState(root, '/unit-outside-snapshot'), HarnessError)
})

test('restoreState refuses an incomplete snapshot and removes nothing', async () => {
  const root = await e2eLike('incomplete', true)
  const empty = join(dir, 'incomplete-snap')
  await mkdir(empty)

  await assert.rejects(restoreState(root, empty), HarnessError)
  assert.equal(existsSync(join(root, 'plugins', 'known_marketplaces.json')), true)
  assert.equal(existsSync(join(root, 'settings.json')), true)
})

test('otherEntryChanges names appeared, disappeared and mtime-changed entries and ignores the four kept names', () => {
  const before: readonly TopEntry[] = [
    { name: 'sessions', kind: 'dir', mtimeMs: 1 },
    { name: 'todos', kind: 'dir', mtimeMs: 1 },
    { name: 'old-entry', kind: 'file', mtimeMs: 1 },
    { name: '.claude.json', kind: 'file', mtimeMs: 1 },
    { name: 'projects', kind: 'dir', mtimeMs: 1 },
    { name: 'plugins', kind: 'dir', mtimeMs: 1 },
    { name: 'settings.json', kind: 'file', mtimeMs: 1 },
  ]
  const after: readonly TopEntry[] = [
    { name: 'sessions', kind: 'dir', mtimeMs: 2 },
    { name: 'todos', kind: 'dir', mtimeMs: 1 },
    { name: 'cache', kind: 'dir', mtimeMs: 2 },
    { name: '.claude.json', kind: 'file', mtimeMs: 2 },
    { name: 'projects', kind: 'dir', mtimeMs: 2 },
    { name: 'plugins', kind: 'link', mtimeMs: 2 },
  ]

  assert.deepEqual(otherEntryChanges(before, after), ['cache', 'old-entry', 'sessions'])
  assert.deepEqual(otherEntryChanges(after, after), [])
})
