/**
 * The epic record of /cadre epic (D-164, T-03.1-03), a layer 11 module: `cadre-epic.json` beside the worktree's git
 * files, which names the epic's key, slug, title, branch `epic/<slug>`, base and the links and copies its mirror made
 * (epicRecordText), and parseEpicRecord, which reads one back and gives null for any shape or path it cannot trust (fail
 * closed); with EPIC_BRANCH_PREFIX, the start of every epic branch name (D-146). It is pure and imports core; the other
 * epic modules read it.
 */
import type { EpicRecord } from '../../types'
import { allOrNull, isObject, parseJsonValue, stableJson } from '../core/json'

/** The start of every epic branch name (D-146): `epic/<slug>`. */
export const EPIC_BRANCH_PREFIX = 'epic/'

/** The file name of the epic record in its worktree's git dir (D-164): per worktree, outside the tree, never shared. */
export const EPIC_RECORD_FILE = 'cadre-epic.json'

/**
 * Whether a recorded link or copy path is safe to act on inside the worktree (D-164, T-03.1-03): relative, so not
 * starting with `/`, and with no empty, `.` or `..` segment, so a later removal of it cannot leave the worktree.
 */
export function isSafeRelPath(path: string): boolean {
  if (path.startsWith('/')) return false

  return path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

/** Where the epic record of the worktree whose git dir is `gitDir` lies (D-164): beside that worktree's git files. */
export function epicRecordPath(gitDir: string): string {
  return `${gitDir}/${EPIC_RECORD_FILE}`
}

/** The text of an epic record as cadre writes it (D-164): stable JSON, so one record always gives the same text. */
export function epicRecordText(record: EpicRecord): string {
  return stableJson(record)
}

/**
 * An epic record read back (D-164, T-03.1-03), as epicRecordText writes it: JSON with schema 1, a key, slug, title and
 * branch that are strings, the branch `epic/<slug>`, a base that is a string or null, a number createdAt, and links and
 * copies that are lists of paths isSafeRelPath accepts. Anything else gives null (fail closed); a field the record does
 * not name is dropped.
 */
export function parseEpicRecord(text: string): EpicRecord | null {
  const value = parseJsonValue(text)?.value
  if (!isObject(value) || value.schema !== 1) return null
  const { key, slug, title, branch, base, createdAt, links, copies } = value
  if (typeof key !== 'string' || typeof slug !== 'string' || typeof title !== 'string') return null
  if (typeof branch !== 'string' || branch !== `${EPIC_BRANCH_PREFIX}${slug}`) return null
  if (base !== null && typeof base !== 'string') return null
  if (typeof createdAt !== 'number' || !Array.isArray(links) || !Array.isArray(copies)) return null
  const safePath = (path: unknown): string | null => (typeof path === 'string' && isSafeRelPath(path) ? path : null)
  const linked = allOrNull(links, safePath)
  const copied = allOrNull(copies, safePath)
  if (linked === null || copied === null) return null

  return { schema: 1, key, slug, title, branch, base, createdAt, links: linked, copies: copied }
}
