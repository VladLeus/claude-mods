import { createHash } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { HarnessError } from './errors.ts'

const HASHED_SOURCE_RE = /\.(?:ts|tsx|json)$/
const TEST_FILE_RE = /\.test\.ts$/
const SKIPPED_DIR = 'golden'

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export async function hashFile(path: string): Promise<string> {
  return sha256(await readFile(path))
}

async function sourceFiles(root: string, rel: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(rel ? join(root, rel) : root, { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory() && entry.name !== SKIPPED_DIR) found.push(...await sourceFiles(root, path))
    if (entry.isFile() && HASHED_SOURCE_RE.test(entry.name) && !TEST_FILE_RE.test(entry.name)) found.push(path)
  }

  return found
}

export async function hashFolder(dir: string): Promise<string> {
  const hash = createHash('sha256')
  for (const rel of (await sourceFiles(dir, '')).sort()) hash.update(`${rel}\0${await hashFile(join(dir, rel))}\n`)

  return hash.digest('hex')
}

export async function hashPath(path: string): Promise<string> {
  const stats = await lstat(path).catch(() => null)
  if (stats?.isDirectory()) return hashFolder(path)
  if (stats?.isFile()) return hashFile(path)

  throw new HarnessError(`hashPath: ${basename(path)} is neither a file nor a folder`)
}

function kindOf(stats: BigIntStats): string {
  if (stats.isSymbolicLink()) return 'link'
  if (stats.isDirectory()) return 'dir'
  if (stats.isFile()) return 'file'

  return 'other'
}

async function contentOf(path: string, kind: string): Promise<string> {
  if (kind === 'file') return hashFile(path)
  if (kind === 'link') return readlink(path)

  return ''
}

async function listTree(root: string, rel: string, lines: string[]): Promise<void> {
  const path = rel === '.' ? root : join(root, rel)
  const stats = await lstat(path, { bigint: true })
  const kind = kindOf(stats)
  const content = await contentOf(path, kind)
  const mode = (stats.mode & 0o7777n).toString(8)
  lines.push([rel, kind, mode, stats.size.toString(), stats.mtimeNs.toString(), content].join('\t'))
  if (kind !== 'dir') return

  for (const name of await readdir(path)) await listTree(root, rel === '.' ? name : `${rel}/${name}`, lines)
}

export async function treeListing(dir: string): Promise<string> {
  const lines: string[] = []
  await listTree(dir, '.', lines)

  return `${lines.sort().join('\n')}\n`
}

export async function hashTree(dir: string): Promise<string> {
  return sha256(await treeListing(dir))
}
