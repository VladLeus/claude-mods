import type { Stats } from 'node:fs'
import { lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { HarnessError } from './errors.ts'
import { copyTree } from './fixture.ts'
import { isUnder, scratchRoot } from './scratch.ts'

export type EntryKind = 'dir' | 'file' | 'link' | 'other'

export type TopEntry = {
  readonly name: string
  readonly kind: EntryKind
  readonly mtimeMs: number
}

const STATE_NAMES = ['plugins', 'settings.json', 'gsd-core'] as const
const UNWATCHED_NAMES: ReadonlySet<string> = new Set(['.claude.json', 'projects', ...STATE_NAMES])
const ABSENT_SUFFIX = '.absent'

function kindOf(stats: Stats): EntryKind {
  if (stats.isSymbolicLink()) return 'link'
  if (stats.isDirectory()) return 'dir'
  if (stats.isFile()) return 'file'

  return 'other'
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, () => false)
}

export async function otherEntries(dir: string): Promise<readonly TopEntry[]> {
  const entries: TopEntry[] = []
  for (const name of (await readdir(dir)).filter(item => !UNWATCHED_NAMES.has(item)).sort()) {
    const stats = await lstat(join(dir, name)).catch(() => null)
    if (stats) entries.push({ name, kind: kindOf(stats), mtimeMs: stats.mtimeMs })
  }

  return entries
}

export async function snapshotState(dir: string, into: string): Promise<readonly TopEntry[]> {
  if (!isUnder(resolve(into), scratchRoot())) {
    throw new HarnessError('snapshotState refused: the snapshot folder is outside the scratch root')
  }
  if (await exists(into)) throw new HarnessError('snapshotState refused: the snapshot folder already exists')
  const before = await otherEntries(dir)
  await mkdir(into, { recursive: true, mode: 0o700 })
  for (const name of STATE_NAMES) {
    if (await exists(join(dir, name))) await copyTree(join(dir, name), join(into, name))
    else await writeFile(join(into, `${name}${ABSENT_SUFFIX}`), '')
  }

  return before
}

async function removeState(dir: string, name: string): Promise<void> {
  if (!STATE_NAMES.some(item => item === name)) throw new HarnessError(`restoreState refused to remove ${name}`)

  await rm(join(dir, name), { recursive: true, force: true })
}

export async function restoreState(dir: string, from: string): Promise<readonly TopEntry[]> {
  const copied = new Set<string>()
  for (const name of STATE_NAMES) {
    const isCopied = await exists(join(from, name))
    if (isCopied === await exists(join(from, `${name}${ABSENT_SUFFIX}`))) {
      throw new HarnessError(`restoreState refused: the snapshot holds no single record of ${name}`)
    }
    if (isCopied) copied.add(name)
  }
  for (const name of STATE_NAMES) {
    await removeState(dir, name)
    if (copied.has(name)) await copyTree(join(from, name), join(dir, name))
  }

  return otherEntries(dir)
}

export function otherEntryChanges(before: readonly TopEntry[], after: readonly TopEntry[]): readonly string[] {
  const byName = (entries: readonly TopEntry[]): ReadonlyMap<string, TopEntry> =>
    new Map(entries.filter(entry => !UNWATCHED_NAMES.has(entry.name)).map(entry => [entry.name, entry]))
  const was = byName(before)
  const now = byName(after)
  const names = [...new Set([...was.keys(), ...now.keys()])].sort()

  return names.filter(name => {
    const old = was.get(name)
    const current = now.get(name)
    return !old || !current || old.kind !== current.kind || old.mtimeMs !== current.mtimeMs
  })
}
