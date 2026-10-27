/**
 * The repo walk, a layer 3 module: the bounded breadth-first listing every repo scan starts from, with its depth,
 * per-folder and overall caps, the folders it never lists and the names it skips (D-55, D-137). It lists through the
 * init port and reads no file. It imports core and the types, so the marker, manifest and repo scans walk here.
 */
import type { EntryKind, InitIo, PortEntry } from '../../types'
import { compareText, isChangedByClean, shown } from '../core/text'

/** Code points a repo entry name keeps; a longer name is skipped, as the detection skips it (WR-03). */
export const MAX_ENTRY_NAME_CHARS = 255

/** Code points of a repo path a warning shows. */
export const MAX_WARNING_PATH_CHARS = 120

/**
 * How deep the walk goes: a file path has at most 3 segments, so folders at depth 0 (the root) to 2 are listed and a
 * folder at depth 3 is not (D-55). The depth limit is part of the scan's design, so it never marks a scan truncated.
 */
export const MAX_SCAN_DEPTH = 3

/**
 * The most entries the walk takes from one folder below the first level; the root and every first-level folder are
 * listed in full unless the overall safety cap stops the walk (D-137).
 */
export const MAX_FOLDER_ENTRIES = 200

/** The deepest folder the walk lists in full: the root is depth 0 and a first-level folder depth 1 (D-137). */
const MAX_FULL_DEPTH = 1

/**
 * The overall safety cap on entries over the whole walk (user answer 2026-10-21, D-137); it stops the walk where it is
 * reached.
 */
export const MAX_SCAN_ENTRIES = 20_000

/**
 * Folders the walk never lists, at any depth: version control and tool state, installed dependencies, build output,
 * and the folders cadre and Claude keep. A folder is skipped by its name alone (D-55).
 */
export const SKIP_DIRS: readonly string[] = Object.freeze([
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  'coverage',
  '.cadre',
  '.planning',
  '.claude',
  'thoughts',
])

/** A folder waiting to be listed: its path below the root with `/` separators (empty for the root), and its depth. */
type Folder = {
  readonly path: string
  readonly depth: number
}

/** One entry the walk saw: its path below the root, its name, what the host says it is, and its folder's depth. */
export type Seen = {
  readonly path: string
  readonly name: string
  readonly kind: EntryKind
  readonly isLink: boolean
  readonly depth: number
}

/**
 * What the walk saw in breadth-first order, the names it skipped, its warnings, the deeper folders it listed only in
 * part (sorted), and whether it stopped at the overall safety cap (D-137).
 */
type Walk = {
  readonly seen: readonly Seen[]
  readonly hidden: readonly string[]
  readonly warnings: readonly string[]
  readonly cappedFolders: readonly string[]
  readonly isOverallCapped: boolean
}

/** The absolute path of a folder to list: the root for the empty path, else below the root. */
function folderPath(base: string, path: string): string {
  if (path !== '') return `${base}/${path}`

  return base === '' ? '/' : base
}

/** A listing sorted by name, as a copy, so the walk order never depends on the host's order. */
function sortedByName(listing: readonly PortEntry[]): PortEntry[] {
  return [...listing].sort((a, b) => compareText(a.name, b.name))
}

/** Whether a name is `.` or `..` or empty, which a listing never gives and the walk never follows. */
function isDotName(name: string): boolean {
  return name === '' || name === '.' || name === '..'
}

/** Whether the walk may list an entry: a real folder, not a link, and not one of SKIP_DIRS. */
function isWalkable(entry: PortEntry): boolean {
  return entry.kind === 'dir' && !entry.isLink && !SKIP_DIRS.includes(entry.name)
}

/** The warning for a folder the host could not list; the root is named as the repo root. */
function listWarning(path: string): string {
  if (path === '') return 'could not list the repo root (treated as unknown)'

  return `could not list ${shown(path, MAX_WARNING_PATH_CHARS)} (treated as unknown)`
}

/**
 * Lists the repo breadth-first, each listing sorted by name: folders at depth 0 to MAX_SCAN_DEPTH - 1, never a link or
 * one of SKIP_DIRS (D-55, D-137). The root and every first-level folder are listed in full; a deeper folder gives at
 * most its first MAX_FOLDER_ENTRIES entries in name order, its path is recorded, and the walk goes on with the next
 * folder, so one huge folder cannot end the walk. Independent of that, the walk stops once it has counted
 * MAX_SCAN_ENTRIES entries in all and records that it reached the safety cap. A folder left unlisted for depth is by
 * design and is not recorded. A listing that fails is a warning, not an empty folder. An entry name that `clean` would
 * change is skipped and reported.
 */
export async function walk(io: InitIo, base: string): Promise<Walk> {
  const seen: Seen[] = []
  const hidden: string[] = []
  const warnings: string[] = []
  const capped: string[] = []
  const queue: Folder[] = [{ path: '', depth: 0 }]
  const result = (isOverallCapped: boolean): Walk => ({
    seen,
    hidden,
    warnings,
    cappedFolders: [...capped].sort(compareText),
    isOverallCapped,
  })
  let count = 0
  // The queue grows while it is walked, which is what makes the walk breadth-first.
  for (const folder of queue) {
    const listing = await io.list(folderPath(base, folder.path))
    if (listing === null) {
      warnings.push(listWarning(folder.path))
      continue
    }
    const sorted = sortedByName(listing)
    const isCapped = folder.depth > MAX_FULL_DEPTH && sorted.length > MAX_FOLDER_ENTRIES
    if (isCapped) capped.push(folder.path)
    for (const entry of isCapped ? sorted.slice(0, MAX_FOLDER_ENTRIES) : sorted) {
      if (count >= MAX_SCAN_ENTRIES) return result(true)
      count += 1
      if (isChangedByClean(entry.name, MAX_ENTRY_NAME_CHARS)) {
        hidden.push(entry.name)
        continue
      }
      if (isDotName(entry.name)) continue

      const path = folder.path === '' ? entry.name : `${folder.path}/${entry.name}`
      seen.push({ path, name: entry.name, kind: entry.kind, isLink: entry.isLink, depth: folder.depth })
      if (!isWalkable(entry) || folder.depth + 1 >= MAX_SCAN_DEPTH) continue
      queue.push({ path, depth: folder.depth + 1 })
    }
  }

  return result(false)
}
