/**
 * The instruction part records apply, init, roles and regen share, a layer 1 module: a part's record as a role.json and
 * a role's hand-out record hold it (its file, heading and hash), the checks a recorded part must pass to be read back,
 * and the name of the text above a file's first heading. It imports only core, the types and facts' isChangedByClean,
 * so those modules can all import it with no cycle, and none of them reaches into another for a record.
 */
import type { InstructionPart, InstructionPartRecord } from '../types'
import { allOrNull, isObject } from './core/json'
import { MAX_HEADING_CHARS, SHA256_HEX } from './core/names'
import { isChangedByClean } from './facts'

/** The extension of every file a repo part comes from: the read of the instruction files takes only `.md` files. */
const PART_FILE_EXTENSION = '.md'

/**
 * Whether a recorded repo part names a file regen may read again (G-02-1f Regen, T-02-78): a path below the repo root,
 * with no leading `/` and no empty, `.` or `..` segment, that clean leaves as it is, of a `.md` file that is not under
 * a `.git` folder in any letter case, as the read follows only such files (02-GAPS-B2 M3). Such a record never names a
 * file outside the repo, and regen reads it through readRepoFile, which follows no link out of the repo. Init records
 * only a part whose file it takes, so it never writes a role.json that parseRoleJson refuses.
 */
export function isRecordedPartFile(file: string): boolean {
  if (file.startsWith('/') || isChangedByClean(file, Number.POSITIVE_INFINITY)) return false
  if (!file.endsWith(PART_FILE_EXTENSION)) return false
  const segments = file.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return false

  return !segments.some(segment => segment.toLowerCase() === '.git')
}

/**
 * One part record (G-02-1f Regen): a file `isFile` takes, a heading clean leaves as it is at MAX_HEADING_CHARS code
 * points, and a SHA-256 in lowercase hex; null for anything else. role.json takes repo files (isRecordedPartFile), and
 * a role's private instructions.json the global ones regen checks on its own.
 */
export function partRecordOf(value: unknown, isFile: (file: string) => boolean): InstructionPartRecord | null {
  if (!isObject(value)) return null
  const { file, heading, hash } = value
  if (typeof file !== 'string' || !isFile(file)) return null
  if (typeof heading !== 'string' || isChangedByClean(heading, MAX_HEADING_CHARS)) return null
  if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) return null

  return { file, heading, hash }
}

/**
 * The repo part records of one key of a role.json object (G-02-1f Regen), in their order: undefined when it is not
 * there, as in a role.json written before them; null when it is not a list of records partRecordOf takes.
 */
export function partRecordsOf(value: unknown): InstructionPartRecord[] | null | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return null

  return allOrNull(value, item => partRecordOf(item, isRecordedPartFile))
}

/** A part as a role's records name it (G-02-1f Regen): its file, heading and hash, nothing of its text. */
export function partRecord(part: Pick<InstructionPart, 'file' | 'heading' | 'hash'>): InstructionPartRecord {
  return { file: part.file, heading: part.heading, hash: part.hash }
}

/** Part records as a hand-out record holds them: file, heading and hash, in the order given. */
export function recordsOf(parts: readonly InstructionPartRecord[]): InstructionPartRecord[] {
  return parts.map(({ file, heading, hash }) => ({ file, heading, hash }))
}

/** Whether a recorded global part names its file as text regen can map back to a path: not empty, and clean. */
function isRecordedGlobalFile(file: string): boolean {
  return file !== '' && !isChangedByClean(file, Number.POSITIVE_INFINITY)
}

/** A list of global part records partRecordOf takes; null when the value is not such a list. */
export function recordedParts(value: unknown): InstructionPartRecord[] | null {
  if (!Array.isArray(value)) return null

  return allOrNull(value, item => partRecordOf(item, isRecordedGlobalFile))
}

/**
 * How a part with no heading is named: the text before the first heading of its file (G-02-1f); the built role file's
 * markers name it the same way (generate.ts).
 */
export const TOP_OF_FILE = '(top of file)'
