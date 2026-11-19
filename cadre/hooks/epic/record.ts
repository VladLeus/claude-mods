/**
 * The epic record of /cadre epic (D-164, T-03.1-03), a layer 11 module: `cadre-epic.json` beside the worktree's git
 * files, which names the epic's key, slug, title, branch `epic/<slug>`, base and the links, copies and walked folders
 * its mirror made (epicRecordText), and parseEpicRecord, which reads one back and gives null for any shape or path it
 * cannot trust (fail closed); readEpicRecord reads it back from the git dir git names for a worktree, through the
 * HostIo and InitIo ports; with EPIC_BRANCH_PREFIX, the start of every epic branch name (D-146). It imports core,
 * git/argv, paths (whose EPIC_RECORD_FILE it passes on), scan and epic/git; the other epic modules read it.
 */
import type { EpicRecord, HostIo, InitIo } from '../../types'
import { allOrNull, isObject, parseJsonValue, stableJson } from '../core/json'
import { GIT_TIMEOUT_MS } from '../git/argv'
import { EPIC_RECORD_FILE } from '../paths'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { GIT_DIR_ARGV } from './git'

export { EPIC_RECORD_FILE } from '../paths'

/** The start of every epic branch name (D-146): `epic/<slug>`. */
export const EPIC_BRANCH_PREFIX = 'epic/'

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
 * The copy times of a record: none when it names none; null when they are not an object, or a path isSafeRelPath
 * refuses or a time that is not a finite number is among them.
 */
function copiedAtOf(value: unknown): Readonly<Record<string, number>> | null {
  if (value === undefined) return {}
  if (!isObject(value)) return null
  const times = new Map<string, number>()
  for (const [path, time] of Object.entries(value)) {
    if (!isSafeRelPath(path) || typeof time !== 'number' || !Number.isFinite(time)) return null
    times.set(path, time)
  }

  return Object.fromEntries(times)
}

/**
 * An epic record read back, as epicRecordText writes it: JSON with schema 1, a key, slug, title and branch that are
 * strings, the branch `epic/<slug>`, a base that is a string or null, a number createdAt, links and copies that are
 * lists of paths isSafeRelPath accepts, walked, when the record names it, a list of such paths too, and copiedAt, kept
 * when it holds a time, from such paths to finite numbers. Anything else gives null (fail closed); a field the record
 * does not name is dropped.
 */
export function parseEpicRecord(text: string): EpicRecord | null {
  const value = parseJsonValue(text)?.value
  if (!isObject(value) || value.schema !== 1) return null
  const { key, slug, title, branch, base, createdAt, links, copies, walked, copiedAt } = value
  if (typeof key !== 'string' || typeof slug !== 'string' || typeof title !== 'string') return null
  if (typeof branch !== 'string' || branch !== `${EPIC_BRANCH_PREFIX}${slug}`) return null
  if (base !== null && typeof base !== 'string') return null
  if (typeof createdAt !== 'number' || !Array.isArray(links) || !Array.isArray(copies)) return null
  const safePath = (path: unknown): string | null => (typeof path === 'string' && isSafeRelPath(path) ? path : null)
  const linked = allOrNull(links, safePath)
  const copied = allOrNull(copies, safePath)
  const times = copiedAtOf(copiedAt)
  if (linked === null || copied === null || times === null) return null
  const record: EpicRecord = { schema: 1, key, slug, title, branch, base, createdAt, links: linked, copies: copied }
  const timed = Object.keys(times).length > 0 ? { ...record, copiedAt: times } : record
  if (walked === undefined) return timed
  if (!Array.isArray(walked)) return null
  const made = allOrNull(walked, safePath)
  if (made === null) return null

  return { ...timed, walked: made }
}

/**
 * The epic record of the worktree at `path` (D-164), read from the git dir GIT_DIR_ARGV names for it; null when git
 * names no absolute git dir, or the record there is absent, unreadable or not valid (parseEpicRecord).
 */
export async function readEpicRecord(io: InitIo, host: HostIo, path: string): Promise<EpicRecord | null> {
  const named = await host.run(GIT_DIR_ARGV(path), { timeoutMs: GIT_TIMEOUT_MS })
  const gitDir = named !== null && named.exitCode === 0 ? named.stdout.trim() : ''
  if (!gitDir.startsWith('/')) return null
  const read = await io.read(epicRecordPath(gitDir), MAX_READ_BYTES)

  return read.state === 'text' ? parseEpicRecord(read.text) : null
}
