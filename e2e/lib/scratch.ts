import { realpathSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HarnessError } from './errors.ts'

export const SCRATCH_DIR_NAME = 'claude-mods-e2e'
export const PRUNE_AGE_MS = 24 * 60 * 60_000
export const RUN_ID_RE = /^\d{6}-\d{6}-[0-9a-f]{4}$/

const REPO_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

export function isUnder(path: string, root: string): boolean {
  const base = root.endsWith('/') ? root : `${root}/`

  return normalize(path).startsWith(base)
}

export function scratchBase(): string {
  return join(realpathSync(tmpdir()), SCRATCH_DIR_NAME)
}

export function scratchRoot(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const root = env.E2E_SCRATCH
  if (!root) throw new HarnessError('E2E_SCRATCH is unset: run through npm run e2e or e2e:live')

  return root
}

export function rootReason(root: string): string | null {
  if (root === '' || root === '/') return 'the scratch root is empty or /'
  if (/\s/.test(root)) return 'the scratch root holds whitespace'
  if (!isAbsolute(root) || normalize(root) !== root || root.endsWith('/')) return 'the scratch root is not canonical'
  if (root === REPO_DIR || isUnder(root, REPO_DIR)) return 'the scratch root is inside the repo'
  const home = process.env.HOME || homedir()
  if (root === home || isUnder(home, root)) return 'the scratch root is HOME or an ancestor of HOME'
  if (!root.split('/').includes(SCRATCH_DIR_NAME)) return `the scratch root is not under a ${SCRATCH_DIR_NAME} folder`

  return null
}

export function removeReason(path: string, root: string): string | null {
  const rootWhy = rootReason(root)
  if (rootWhy) return rootWhy
  if (/\s/.test(path)) return 'the path holds whitespace'
  if (!isAbsolute(path)) return 'the path is not absolute'
  if (!isUnder(path, root)) return 'the path is outside the scratch root'

  return null
}

export async function removeTree(path: string, root: string): Promise<void> {
  const why = removeReason(path, root)
  if (why) throw new HarnessError(`removeTree refused: ${why}`)
  const stats = await lstat(path).catch(() => null)
  if (!stats) return
  if (stats.isSymbolicLink()) throw new HarnessError('removeTree refused: the path is a symlink')

  await rm(path, { recursive: true, force: true })
}

export async function makeRunRoot(base: string, run: string): Promise<string> {
  const root = join(base, run)
  const why = rootReason(root)
  if (why) throw new HarnessError(why)

  await mkdir(base, { recursive: true, mode: 0o700 })
  await mkdir(root, { mode: 0o700 })

  return root
}

export async function pruneRuns(base: string, now: number): Promise<readonly string[]> {
  const entries = await readdir(base, { withFileTypes: true }).catch(() => [])
  const warnings: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !RUN_ID_RE.test(entry.name)) continue
    const path = join(base, entry.name)
    const stats = await lstat(path).catch(() => null)
    if (!stats || now - stats.mtimeMs < PRUNE_AGE_MS) continue
    try {
      await removeTree(path, base)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`could not prune the old run ${entry.name}: ${message}`)
    }
  }

  return warnings
}

export async function rowDir(name: string, root: string): Promise<string> {
  const parent = join(root, 'rows')
  await mkdir(parent, { recursive: true })

  return mkdtemp(join(parent, `${name.replace(/[^A-Za-z0-9._-]/g, '-')}-`))
}
