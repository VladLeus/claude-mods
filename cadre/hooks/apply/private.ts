/**
 * The private role files, a layer 9 module: the private text file and the hand-out record of each role in its role
 * memory folder outside the repo (G-02-1f, D-140 q2-a), their paths and texts, the record parser, the step and input
 * types of an apply, and the private steps applySteps writes after the repo files. It imports core, generate/docs,
 * paths, records, the conflict choice and the types, so the other apply/ modules, init and /cadre start read it here.
 */
import type { DesiredFile, InstructionPart, InstructionPartRecord, Manifest, MemoryItem, Plan } from '../../types'
import { allOrNull, isObject, parseJsonValue, stableJson } from '../core/json'
import { isSha256Hex } from '../core/names'
import { reportText } from '../core/text'
import { partsBody } from '../generate/docs'
import { INSTRUCTIONS_RECORD_FILE, PRIVATE_INSTRUCTIONS_FOLDER } from '../paths'
import { recordedParts, recordsOf } from '../records'
import type { ConflictChoice } from './conflict'

/** One private file of a role (G-02-1f Storage split): its absolute path in the role memory folder, and its text. */
export type PrivateFile = {
  readonly path: string
  readonly text: string
}

/**
 * One step of an apply, in the order it runs; no step deletes anything (LNCH-01). The path of every step but a
 * private one is repo-relative:
 * - `write`: write the text to the path;
 * - `chmod`: make the path executable; it always comes right after the write of the same path;
 * - `private`: write the private files of one role into its role memory folder, the absolute `path` outside the repo
 *   (G-02-1f, D-140 q2-a), after the folder is made and made private (privateLevels); it comes after every write of the
 *   repo files;
 * - `manifest`: write the manifest text; it is the last step of an apply.
 */
export type ApplyStep =
  | { readonly kind: 'write'; readonly path: string; readonly text: string }
  | { readonly kind: 'chmod'; readonly path: string }
  | { readonly kind: 'private'; readonly path: string; readonly files: readonly PrivateFile[] }
  | { readonly kind: 'manifest'; readonly path: string; readonly text: string }

/**
 * What one role of the team was given that is private (G-02-1f Storage split, D-140 q2-a): the role memory folder it
 * goes to (roleMemoryDir), the folder name of the repo for the header of its text file, its global parts in read order
 * and its memories in file-name order.
 */
export type PrivateRole = {
  readonly id: string
  readonly folder: string
  readonly repo: string
  readonly parts: readonly InstructionPart[]
  readonly memories: readonly MemoryItem[]
  /**
   * The other global parts of the files its given parts come from, which it was not given (G-02-1f Regen, AUTO-PICK
   * #19 Q1): its record names them, so regen never asks them as new; none when absent.
   */
  readonly partsNotGiven?: readonly InstructionPartRecord[]
  /**
   * How regen rebuilds its private files (G-02-1f Regen): `text` writes the text file alone (claude -p writes no
   * record, AUTO-PICK #19 Q3), `record` the record alone and `both` both, each whatever it holds, a text file of the
   * header alone and a record with empty lists included (Q11). Absent for init, which writes both, whatever they hold
   * (02-GAPS-B3 C1).
   */
  readonly rebuild?: 'text' | 'record' | 'both'
}

/** What applySteps plans from: the confirmed plan and what it was built from, and the answers to its conflicts. */
export type ApplyInput = {
  readonly plan: Plan
  /** The desired files the plan was built from: a write takes its text from here. */
  readonly desired: readonly DesiredFile[]
  /** The manifest the plan records (planWithManifest). */
  readonly manifest: Manifest
  /** The merged root `.gitignore` text; null when no block is planned or it cannot be merged. */
  readonly gitignore: string | null
  /** The answer to each conflict question, by path (D-67); a conflict with no answer keeps the person's file. */
  readonly choices: ReadonlyMap<string, ConflictChoice>
  /** What each role was given that is private, in the order its files are written; absent writes none (regen). */
  readonly privates?: readonly PrivateRole[]
  /**
   * The text each built role file ends with after the improver pass, by repo-relative path, for each one whose improved
   * text the person accepted (G-02-1f, D-141): the manifest records its hash, as it records a file taken new. Absent
   * before the pass and for regen.
   */
  readonly improved?: ReadonlyMap<string, string>
}

/** The file name of the private text file in PRIVATE_INSTRUCTIONS_FOLDER: a CLAUDE.md, so the engine loads it. */
export const PRIVATE_CLAUDE_MD = 'CLAUDE.md'

/**
 * The private text file of a role: `<role memory folder>/instructions/CLAUDE.md`, in its own subfolder on every load
 * path (D-140), so a run in that folder cannot reach the memory links beside it.
 */
export function privateClaudeMdPath(folder: string): string {
  return `${folder}/${PRIVATE_INSTRUCTIONS_FOLDER}/${PRIVATE_CLAUDE_MD}`
}

/** The hand-out record of a role: `<role memory folder>/instructions.json`, beside its memories (D-140 q2-a). */
export function instructionsRecordPath(folder: string): string {
  return `${folder}/${INSTRUCTIONS_RECORD_FILE}`
}

/**
 * The text of a role's private file (G-02-1f Storage split, D-140 q2-a; 02-GAPS-B3 C4, N5): a first line that names
 * the role and the repo (its folder name, cleaned and capped as a report cell is), says the instructions are built from
 * the global CLAUDE.md, its imports and the CLAUDE.md files above the repo, are private and how they are rebuilt; then
 * the parts given, in that order, as the built `.cadre/<id>/CLAUDE.md` holds them after its header (partsBody): a
 * blank line, then each part under its marker, a blank line between two parts, one final newline. So the two files
 * always mark their parts the same way.
 */
export function privateClaudeMdText(id: string, repo: string, parts: readonly InstructionPart[]): string {
  const header =
    `<!-- cadre: your global instructions for role ${id} in ${reportText(repo)}, ` +
    'built from your global CLAUDE.md, its imports and the CLAUDE.md files above the repo. ' +
    'Private to you, never committed; rebuilt by /cadre init and /cadre regen. -->'

  return `${header}${partsBody(parts)}`
}

/**
 * The text of a role's hand-out record (G-02-1f Storage split, D-140 q2-a), as stableJson writes it: schema 1, each
 * global part the role was given by file, heading and hash, in read order, each memory it was given by file, folder,
 * summary and hash, and, when there are any, the other parts of the same files it was not given (`partsNotGiven`,
 * AUTO-PICK #19 Q1). It holds no part or memory text: /cadre start links the memories it names, and regen tells new,
 * changed and removed items apart by it.
 */
export function instructionsRecordText(
  parts: readonly InstructionPartRecord[],
  memories: readonly Pick<MemoryItem, 'file' | 'folder' | 'summary' | 'hash'>[],
  partsNotGiven: readonly InstructionPartRecord[] = [],
): string {
  return stableJson({
    schema: 1,
    parts: recordsOf(parts),
    ...(partsNotGiven.length === 0 ? {} : { partsNotGiven: recordsOf(partsNotGiven) }),
    memories: memories.map(({ file, folder, summary, hash }) => ({ file, folder, summary, hash })),
  })
}

/**
 * The private files of a role (G-02-1f Storage split, D-140 q2-a): for init, its private text file, then its hand-out
 * record, whatever they hold, a text file of the header alone and a record with empty lists included, so a role never
 * keeps loading parts or linking memories it lost (02-GAPS-B3 C1); for regen, the files `rebuild` names, whatever they
 * hold (G-02-1f Regen).
 */
function privateFilesOf(role: PrivateRole): PrivateFile[] {
  const recordText = instructionsRecordText(role.parts, role.memories, role.partsNotGiven ?? [])
  const record = { path: instructionsRecordPath(role.folder), text: recordText }
  const text = { path: privateClaudeMdPath(role.folder), text: privateClaudeMdText(role.id, role.repo, role.parts) }
  if (role.rebuild === 'text') return [text]
  if (role.rebuild === 'record') return [record]

  return [text, record]
}

/** A memory a role's hand-out record names (D-140 q2-a): its file, the memory folder of its original, summary, hash. */
export type RecordedMemory = Pick<MemoryItem, 'file' | 'folder' | 'summary' | 'hash'>

/**
 * A role's hand-out record as regen reads it (G-02-1f Regen): its global parts, the parts of the same files it was not
 * given (AUTO-PICK #19 Q1) and its memories.
 */
export type InstructionsRecord = {
  readonly parts: readonly InstructionPartRecord[]
  readonly partsNotGiven: readonly InstructionPartRecord[]
  readonly memories: readonly RecordedMemory[]
}

/** A recorded memory: a text file, folder and summary and a lowercase hex SHA-256; null for anything else. */
function recordedMemoryOf(value: unknown): RecordedMemory | null {
  if (!isObject(value)) return null
  const { file, folder, summary, hash } = value
  if (typeof file !== 'string' || typeof folder !== 'string' || typeof summary !== 'string') return null
  if (typeof hash !== 'string' || !isSha256Hex(hash)) return null

  return { file, folder, summary, hash }
}

/**
 * A role's hand-out record read back for regen (G-02-1f Regen, D-140 q2-a), as instructionsRecordText writes it:
 * schema 1, its global parts and memories, and its parts not given, none when absent. The file lies in the user's
 * folder, where a role session could still write it, so every field is checked (partRecordOf, a lowercase hex hash for
 * each memory) and anything else gives null; whether its paths may be read is regen's own check (AUTO-PICK #19 Q9).
 */
export function parseInstructionsRecord(text: string): InstructionsRecord | null {
  const record = parseJsonValue(text)?.value
  if (!isObject(record) || record.schema !== 1 || !Array.isArray(record.memories)) return null
  const parts = recordedParts(record.parts)
  const partsNotGiven = record.partsNotGiven === undefined ? [] : recordedParts(record.partsNotGiven)
  const memories = allOrNull(record.memories, recordedMemoryOf)
  if (parts === null || partsNotGiven === null || memories === null) return null

  return { parts, partsNotGiven, memories }
}

/** One private step per role that has a private file, in the order given (privateFilesOf). */
export function privateSteps(roles: readonly PrivateRole[]): ApplyStep[] {
  return roles.flatMap((role): ApplyStep[] => {
    const files = privateFilesOf(role)

    return files.length === 0 ? [] : [{ kind: 'private', path: role.folder, files }]
  })
}
