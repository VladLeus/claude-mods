/**
 * Apply plans the writes of a plan the person confirmed (D-105): the files the plan creates or changes in plan order,
 * a chmod right after each launcher, the root `.gitignore` block, then the private files of each role in its role
 * memory folder outside the repo (G-02-1f, D-140 q2-a), and the manifest last, so an apply that stops early never
 * leaves a manifest that claims a file it did not write (LNCH-01). A file the person edited is written only when they
 * answer Take new (D-67), no write or chmod may follow a link out of the repo, and no write outside the repo may go
 * anywhere but a private file of a confirmed role (T-02-72). The framework commands of the accepted hunks are
 * re-resolved from their adapter proposals, and a failed one makes its roles attended (D-106, D-120). It also gives
 * the argvs and the reply lines of the security plugin installs, with the Python check and the marketplace add, and
 * the setup the plan is made again from after them (decision #39). Init runs the steps through the host port. The
 * improver pass between the file writes and the manifest (G-02-1f, D-141) is the one part that runs here, through the
 * ports init gives it: each improver run goes through HostIo.run, while its reads and questions go through InitIo,
 * which can neither write nor run.
 */
import type {
  DesiredFile,
  FileMode,
  FileOp,
  HostIo,
  HostRun,
  HunkOp,
  InitIo,
  InitLocations,
  InstructionPart,
  Manifest,
  ManifestEntry,
  MemoryItem,
  Plan,
  PortEntry,
  PortRead,
  PortStat,
  SettingProposal,
  SetupScan,
  WriteStat,
} from '../types'
import { ADAPTERS } from './adapters'
import { ASK_HEADERS, askChoice, noteLine, quotedLabels, showBlock, withContext } from './ask'
import { CLAUDE_SECURITY_PLUGIN } from './assign'
import {
  compareText,
  countedNoun,
  displayPath,
  isDirInsideRoot,
  isFileInsideRoot,
  MAX_READ_BYTES,
  sortedUnique,
  trimSlash,
} from './facts'
import { roleClaudeMdText } from './generate'
import { sha256Hex } from './hash'
import { PRIVATE_INSTRUCTIONS_FOLDER } from './launch'
import { MANIFEST_PATH, stableJson } from './plan'
import { resolveToolCommand } from './recommend'
import type { GsdToolContext } from './recommend'
import { diffLines, lineDiff, reportText } from './render'
import type { LineDiff } from './render'
import { missingState } from './scan'

/** Which version of a conflicted file the person keeps: their own (Keep mine) or cadre's new one (Take new, D-67). */
export type ConflictChoice = 'mine' | 'new'

/**
 * The buttons of a conflict question, in this order: the dialog focuses the first option; the order is fixed (D-67). A
 * typed answer of the same words, or of `mine` or `new` alone, counts the same, in any case.
 */
export const CONFLICT_OPTIONS: readonly string[] = Object.freeze(['Keep mine', 'Take new'])

/**
 * The question init asks for one conflicted file after Confirm (D-105, D-67): the file was changed outside cadre, and
 * the person keeps their version or takes the new one, which then overwrites theirs. The path is cleaned and capped
 * as a report cell is.
 */
export function conflictQuestion(path: string): string {
  const shown = reportText(path)

  return `${shown} was changed outside cadre. Keep your version, or take the new one (yours is then overwritten)?`
}

/**
 * The answer to a conflict question: `mine` for Keep mine or mine, `new` for Take new or new, in any case and trimmed;
 * else null, so the question is asked again (D-67).
 */
export function parseConflictAnswer(answer: string): ConflictChoice | null {
  const wanted = answer.trim().toLowerCase()
  if (wanted === 'keep mine' || wanted === 'mine') return 'mine'
  if (wanted === 'take new' || wanted === 'new') return 'new'

  return null
}

/** The suffix of the copy a conflict plans beside a user-edited file: the same value plan.ts uses (D-67). */
const BESIDE_SUFFIX = '.cadre-new'

/** The repo-relative path of the root `.gitignore`, whose op writes the merged block text. */
const GITIGNORE_PATH = '.gitignore'

/**
 * The files init asks Keep mine or Take new for, in plan order (D-67, D-105): every conflict file op except the
 * manifest, which is never written while it is a conflict (A6), and a `.cadre-new` copy, which only holds a new
 * version for diffing.
 */
export function conflictPaths(plan: Plan): string[] {
  const paths: string[] = []
  for (const op of plan.ops) {
    if (op.kind !== 'conflict' || op.path === MANIFEST_PATH || op.path.endsWith(BESIDE_SUFFIX)) continue
    paths.push(op.path)
  }

  return paths
}

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

/** The file name of a role's hand-out record, beside the memories in its role memory folder (D-140 q2-a). */
export const INSTRUCTIONS_RECORD_FILE = 'instructions.json'

/** The file name of the private text file in PRIVATE_INSTRUCTIONS_FOLDER: a CLAUDE.md, so the engine loads it. */
const PRIVATE_CLAUDE_MD = 'CLAUDE.md'

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
 * The text of a role's private file (G-02-1f Storage split, D-140 q2-a): a first line that names the role and the repo
 * (its folder name, cleaned and capped as a report cell is), says the instructions are private and how they are
 * rebuilt; then the parts given, in that order, in the format of the built `.cadre/<id>/CLAUDE.md` (roleClaudeMdText):
 * a blank line, then each part under its marker, a blank line between two parts, one final newline. The first line of
 * that format is replaced by this one, so the two files always mark their parts the same way.
 */
export function privateClaudeMdText(id: string, repo: string, parts: readonly InstructionPart[]): string {
  const header =
    `<!-- cadre: your global instructions for role ${id} in ${reportText(repo)}, built from ~/.claude/CLAUDE.md ` +
    'and its imports. Private to you, never committed; rebuilt by /cadre init and /cadre regen. -->'
  const built = roleClaudeMdText(id, parts)
  const headerEnd = built.indexOf('\n')

  return `${header}${headerEnd < 0 ? '\n' : built.slice(headerEnd)}`
}

/**
 * The text of a role's hand-out record (G-02-1f Storage split, D-140 q2-a), as stableJson writes it: schema 1, each
 * global part the role was given by file, heading and hash, in read order, and each memory it was given by file,
 * folder, summary and hash. It holds no part or memory text: /cadre start links the memories it names, and regen
 * tells new, changed and removed items apart by it.
 */
export function instructionsRecordText(parts: readonly InstructionPart[], memories: readonly MemoryItem[]): string {
  return stableJson({
    schema: 1,
    parts: parts.map(({ file, heading, hash }) => ({ file, heading, hash })),
    memories: memories.map(({ file, folder, summary, hash }) => ({ file, folder, summary, hash })),
  })
}

/**
 * The private files of a role (G-02-1f Storage split, D-140 q2-a): its private text file when it was given a global
 * part, then its hand-out record when it was given a global part or a memory; none when it was given neither.
 */
function privateFilesOf(role: PrivateRole): PrivateFile[] {
  if (role.parts.length === 0 && role.memories.length === 0) return []
  const record = { path: instructionsRecordPath(role.folder), text: instructionsRecordText(role.parts, role.memories) }
  if (role.parts.length === 0) return [record]
  const text = privateClaudeMdText(role.id, role.repo, role.parts)

  return [{ path: privateClaudeMdPath(role.folder), text }, record]
}

/** One private step per role that has a private file, in the order given (privateFilesOf). */
function privateSteps(roles: readonly PrivateRole[]): ApplyStep[] {
  return roles.flatMap((role): ApplyStep[] => {
    const files = privateFilesOf(role)

    return files.length === 0 ? [] : [{ kind: 'private', path: role.folder, files }]
  })
}

/** The desired files by path; of two with the same path the first is kept, as buildPlan keeps it. */
function desiredByPath(desired: readonly DesiredFile[]): ReadonlyMap<string, DesiredFile> {
  const files = new Map<string, DesiredFile>()
  for (const file of desired) {
    if (!files.has(file.path)) files.set(file.path, file)
  }

  return files
}

/** A write of the text, then a chmod of the same path when the file is a launcher (mode exec). */
function writeOf(path: string, text: string, mode: FileMode): ApplyStep[] {
  const write: ApplyStep = { kind: 'write', path, text }
  if (mode !== 'exec') return [write]

  return [write, { kind: 'chmod', path }]
}

/** Whether an op writes its path as planned: a create or a change. */
function isCreateOrChange(op: FileOp): boolean {
  return op.kind === 'create' || op.kind === 'change'
}

/**
 * Whether the op of a desired file writes it: a create, a change, or a conflict the person answered Take new (D-67).
 * A leave, and a conflict answered Keep mine or not answered at all (one that appeared after the questions), keep the
 * file on the disk as it is.
 */
function isWritten(op: FileOp, choices: ReadonlyMap<string, ConflictChoice>): boolean {
  if (isCreateOrChange(op)) return true

  return op.kind === 'conflict' && choices.get(op.path) === 'new'
}

/** The step of the `.gitignore` op: a create or a change writes the merged block text, when there is one. */
function ignoreSteps(op: FileOp, gitignore: string | null): ApplyStep[] {
  if (gitignore === null || !isCreateOrChange(op)) return []

  return [{ kind: 'write', path: op.path, text: gitignore }]
}

/** The desired file a `.cadre-new` copy holds the new version of; null for any other path. */
function besideOriginal(path: string, files: ReadonlyMap<string, DesiredFile>): DesiredFile | null {
  if (!path.endsWith(BESIDE_SUFFIX)) return null

  return files.get(path.slice(0, -BESIDE_SUFFIX.length)) ?? null
}

/**
 * The steps of one file op. The `.gitignore` op gives what ignoreSteps gives. A desired file is written when isWritten
 * says so, and a launcher is made executable right after its write. The `.cadre-new` copy beside a conflict gets the
 * new version, for diffing, when the person did not take the new version and the copy's op is a create or a change: a
 * copy that already holds something else (a conflict) is kept as it is, and a copy is never made executable (D-67). A
 * leave writes nothing.
 */
function opSteps(op: FileOp, input: ApplyInput, files: ReadonlyMap<string, DesiredFile>): ApplyStep[] {
  if (op.path === GITIGNORE_PATH) return ignoreSteps(op, input.gitignore)
  const file = files.get(op.path)
  if (file !== undefined) return isWritten(op, input.choices) ? writeOf(op.path, file.content, op.mode) : []
  const original = besideOriginal(op.path, files)
  if (original === null || !isCreateOrChange(op) || input.choices.get(original.path) === 'new') return []

  return [{ kind: 'write', path: op.path, text: original.content }]
}

/** The plan's op for the manifest; null when the plan has none. */
function manifestOpOf(plan: Plan): FileOp | null {
  for (const op of plan.ops) {
    if (op.kind !== 'hunk' && op.path === MANIFEST_PATH) return op
  }

  return null
}

/**
 * The desired files of the conflicts answered Take new, with the mode of their op: exactly the conflicts opSteps
 * writes, since the walk never writes the manifest or the `.gitignore` as a desired file either.
 */
function takenNew(input: ApplyInput, files: ReadonlyMap<string, DesiredFile>): DesiredFile[] {
  const taken: DesiredFile[] = []
  for (const op of input.plan.ops) {
    if (op.kind !== 'conflict' || op.path === MANIFEST_PATH || op.path === GITIGNORE_PATH) continue
    const file = files.get(op.path)
    if (file === undefined || !isWritten(op, input.choices)) continue
    taken.push({ path: op.path, content: file.content, mode: op.mode })
  }

  return taken
}

/**
 * The files whose text the manifest records anew (D-67, D-141): each file taken new with its desired text, and each
 * built role file whose improved text the person accepted (`improved`) with that text, which wins over the desired
 * text of the same path; each with the mode of its desired file. An improved path with no desired file gives none.
 */
function changedFiles(input: ApplyInput, files: ReadonlyMap<string, DesiredFile>): DesiredFile[] {
  const improved = input.improved ?? new Map<string, string>()
  const taken = takenNew(input, files).filter(file => !improved.has(file.path))
  const accepted = Array.from(improved).flatMap(([path, content]): DesiredFile[] => {
    const desired = files.get(path)

    return desired === undefined ? [] : [{ path, content, mode: desired.mode }]
  })

  return [...taken, ...accepted]
}

/**
 * The manifest apply writes: the one the plan records, with the entry of each file taken new or improved replaced by
 * one with the hash of its new text, or added when the plan had none for it (an untracked file), sorted by path (D-67,
 * D-141).
 */
async function manifestAfter(manifest: Manifest, taken: readonly DesiredFile[]): Promise<Manifest> {
  const paths = new Set(taken.map(file => file.path))
  const files: ManifestEntry[] = manifest.files.filter(entry => !paths.has(entry.path))
  for (const file of taken) files.push({ path: file.path, sha256: await sha256Hex(file.content), mode: file.mode })
  files.sort((a, b) => compareText(a.path, b.path))

  return { schema: 1, cadreVersion: manifest.cadreVersion, files }
}

/**
 * The steps that apply a confirmed plan (D-105, LNCH-01), from the plan's ops in their order (opSteps): a create or a
 * change of a desired file writes its text, and so does a conflict answered Take new (D-67), while its `.cadre-new`
 * copy is then not written; a conflict answered Keep mine, or not answered, keeps the person's file and writes the
 * copy instead. Every chmod step comes right after the write step of the same path. The root `.gitignore` op writes
 * the merged block text; a leave writes nothing, and so does a hunk. After the repo files come the private files of
 * each role in `privates`, one step per role that has one (G-02-1f, D-140 q2-a). The manifest comes last, once every
 * file is written, so an apply that stops early never leaves a manifest that claims a file it did not write; it
 * records the new hash of each file taken new and of each built role file whose improved text the person accepted
 * (`improved`, D-141), keeps the old entry of each file kept, and never names a private file. There is none when the
 * plan keeps the manifest as a conflict (it could not be read, A6), and none when the plan leaves it and no file was
 * taken new or improved. No step deletes anything.
 */
export async function applySteps(input: ApplyInput): Promise<ApplyStep[]> {
  const files = desiredByPath(input.desired)
  const steps: ApplyStep[] = []
  for (const op of input.plan.ops) {
    if (op.kind === 'hunk' || op.path === MANIFEST_PATH) continue
    steps.push(...opSteps(op, input, files))
  }
  steps.push(...privateSteps(input.privates ?? []))
  const manifestOp = manifestOpOf(input.plan)
  const changed = changedFiles(input, files)
  if (manifestOp === null || manifestOp.kind === 'conflict') return steps
  if (manifestOp.kind === 'leave' && changed.length === 0) return steps
  const manifest = await manifestAfter(input.manifest, changed)

  return [...steps, { kind: 'manifest', path: MANIFEST_PATH, text: stableJson(manifest) }]
}

/** The folders above a repo-relative path, below the root, from the top: `.cadre` and `.cadre/be` for `.cadre/be/x`. */
function foldersAbove(path: string): string[] {
  const segments = path.split('/')

  return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join('/'))
}

/** The steps that name a repo-relative path: every step but a private one, whose folder lies outside the repo. */
function repoSteps(steps: readonly ApplyStep[]): ApplyStep[] {
  return steps.filter(step => step.kind !== 'private')
}

/**
 * Every repo-relative path the steps name and each folder above one, below the root, sorted by code unit and once
 * each: what init stats, asked with resolve, before an apply writes, so writeProblem can check every write (T-03-13).
 * A private step names none: its paths are checked by privateWriteProblem (privateCheckPaths).
 */
export function applyStatPaths(steps: readonly ApplyStep[]): string[] {
  return sortedUnique(repoSteps(steps).flatMap(step => [...foldersAbove(step.path), step.path]))
}

/**
 * Why a write is refused when its target or a folder above it is a link, not the kind it must be, or outside the
 * repo.
 */
const LINK_REASON = 'it or a folder above it is a link, or not inside the repo'

/** Why a write is refused when its target is a real folder (A5). */
const FOLDER_REASON = 'it is a folder'

/** Why a write is refused when the stat of its target or of a folder above it failed or was not asked (#44). */
const STAT_FAILED_REASON = 'it or a folder above it could not be checked (a stat failed)'

/**
 * Whether a folder above a write lets it through: not there yet, or a real folder strictly inside the root; a failed
 * stat never lets it through.
 */
function isSafeFolder(stat: WriteStat, root: string): boolean {
  if (stat === 'absent') return true
  if (stat === 'failed') return false

  return !stat.isLink && isDirInsideRoot(stat, root)
}

/** Whether the target of a write lets it through: not there yet, or a regular file strictly inside the root. */
function isSafeTarget(stat: PortStat | 'absent', root: string): boolean {
  if (stat === 'absent') return true

  return !stat.isLink && isFileInsideRoot(stat, root)
}

/**
 * Why a write must not happen, or null when it may (T-03-13, #44): a failed stat of the target or of a folder above
 * it, below the root, refuses it as not checked, and so does a path `stats` has no key for (fail closed); a folder
 * above that is a link, not a folder or outside the repo refuses it, as does a target that is a link, not a regular
 * file or outside the repo, except that a target that is a real folder is refused as a folder. An absent path is fine:
 * the host creates it. `stats` holds the WriteStat of each path applyStatPaths names, keyed by repo-relative path and
 * asked with resolve, so a realPath is absolute. The path is cleaned and capped as a report cell is.
 */
export function writeProblem(
  path: string,
  stats: ReadonlyMap<string, WriteStat>,
  root: string,
): string | null {
  const target = stats.get(path) ?? 'failed'
  const above = foldersAbove(path).map(folder => stats.get(folder) ?? 'failed')
  const refused = `refused to write ${reportText(path)}: `
  if (target === 'failed' || above.includes('failed')) return `${refused}${STAT_FAILED_REASON}`
  if (!above.every(stat => isSafeFolder(stat, root))) return `${refused}${LINK_REASON}`
  if (target !== 'absent' && !target.isLink && target.kind === 'dir') return `${refused}${FOLDER_REASON}`
  if (!isSafeTarget(target, root)) return `${refused}${LINK_REASON}`

  return null
}

/**
 * Every folder whose listing init reads before an apply writes, sorted by code unit and once each: the root, as '',
 * and each folder above a path the steps name, so each path applyStatPaths names is listed by its own folder (#72 A2).
 * A private step names none, as for applyStatPaths.
 */
export function applyListPaths(steps: readonly ApplyStep[]): string[] {
  return sortedUnique(['', ...repoSteps(steps).flatMap(step => foldersAbove(step.path))])
}

/** Why a write is refused when the folder that holds it, or one that holds a folder above it, lists it as a link. */
const LISTED_LINK_REASON = 'it or a folder above it is listed as a link'

/** Why a write is refused when the folder that holds it or a folder above it is there but could not be listed. */
const LIST_FAILED_REASON = 'it or a folder above it could not be checked (a folder listing failed)'

/** The folder that holds a repo-relative path, '' for a path at the root. */
function folderOf(path: string): string {
  const at = path.lastIndexOf('/')

  return at < 0 ? '' : path.slice(0, at)
}

/**
 * Why a write must not happen by the listings, or null when it may (#72 A2, T-03-13): a check that does not rest on
 * what the host's stat makes of a link. From the top, each folder above the path and the path itself is looked up in
 * the listing of the folder that holds it, which shows a link as a link, a dangling one included, and an entry listed
 * as a link refuses. A folder below the root with no listing refuses as not checked, unless writeProblem's stat found
 * it absent: a folder that is not there holds nothing, and its own entry was looked up one step before. A root, '',
 * with no listing only skips the look-up of the top entry, as the scans treat an unlistable root as unknown and not as
 * a refusal. `listings` holds what the host listed for each folder applyListPaths names, keyed by repo-relative path,
 * null where it could not list; `stats` is the map writeProblem reads. The path is cleaned and capped as a report cell
 * is.
 */
export function listedLinkProblem(
  path: string,
  stats: ReadonlyMap<string, WriteStat>,
  listings: ReadonlyMap<string, readonly PortEntry[] | null>,
): string | null {
  const refused = `refused to write ${reportText(path)}: `
  for (const entryPath of [...foldersAbove(path), path]) {
    const folder = folderOf(entryPath)
    const entries = listings.get(folder) ?? null
    if (entries === null && folder === '') continue
    if (entries === null && stats.get(folder) === 'absent') return null
    if (entries === null) return `${refused}${LIST_FAILED_REASON}`
    const name = entryPath.slice(folder === '' ? 0 : folder.length + 1)
    if (entries.some(entry => entry.name === name && entry.isLink)) return `${refused}${LISTED_LINK_REASON}`
  }

  return null
}

/**
 * Why a chmod step must not run, or null when it may: a chmod runs only after the write of the same path in this same
 * apply passed writeProblem and landed, and `written` holds the repo-relative paths whose write did. `/bin/chmod`
 * follows links, so a chmod on a path whose write was refused or failed could change the target of a link planted
 * there, outside the repo (RESEARCH 3.2, T-03-13). The path is cleaned and capped as a report cell is.
 */
export function chmodProblem(path: string, written: ReadonlySet<string>): string | null {
  if (written.has(path)) return null

  return `${reportText(path)} was not made executable: its write was refused or failed`
}

/** The argv that makes a written launcher executable: `/bin/chmod 755` on its absolute path under the root. */
export function chmodArgv(root: string, path: string): readonly string[] {
  return ['/bin/chmod', '755', `${trimSlash(root)}/${path}`]
}

/** The folder that holds an absolute path: everything before its last slash. */
function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

/** The private text file's subfolder of a role memory folder: `<folder>/instructions` (D-140). */
function subfolderOf(folder: string): string {
  return `${folder}/${PRIVATE_INSTRUCTIONS_FOLDER}`
}

/**
 * The folders apply makes private before it writes these files of a role memory folder (02-GAPS-B2 N13), from the
 * top: `<userDir>/cadre`, the repo's folder `<repo>-<hash8>` in it, the role memory folder and, when one of the files
 * lies in it, its instructions/ subfolder. The mkdir run makes the last one and every one above it.
 */
export function privateLevels(folder: string, files: readonly PrivateFile[]): string[] {
  const repoFolder = parentOf(folder)
  const subfolder = subfolderOf(folder)
  const isInSubfolder = files.some(file => file.path.startsWith(`${subfolder}/`))

  return [parentOf(repoFolder), repoFolder, folder, ...(isInSubfolder ? [subfolder] : [])]
}

/** The mode of every private folder level (02-GAPS-B2 N13): only the user may list, enter or change it. */
const PRIVATE_FOLDER_MODE = '700'

/** The argv that makes a folder private: `/bin/chmod 700` on its absolute path (02-GAPS-B2 N13). */
export function privateModeArgv(path: string): readonly string[] {
  return ['/bin/chmod', PRIVATE_FOLDER_MODE, path]
}

/**
 * The way to a private file from its role memory folder down, from the top: the role memory folder, its instructions/
 * subfolder when the file lies in it, and the file.
 */
function privateWay(folder: string, path: string): string[] {
  const subfolder = subfolderOf(folder)

  return path.startsWith(`${subfolder}/`) ? [folder, subfolder, path] : [folder, path]
}

/**
 * What apply asks before it writes these private files of a role memory folder (G-02-1f, T-02-72), in the order of
 * their ways (privateWay), once each: `stats`, every path on the way to a file, the file included, which apply stats
 * with statForWrite; `listings`, the folder that holds each of them, from the repo's folder down.
 */
export function privateCheckPaths(
  folder: string,
  files: readonly PrivateFile[],
): { readonly stats: readonly string[]; readonly listings: readonly string[] } {
  const ways = files.flatMap(file => privateWay(folder, file.path))

  return { stats: [...new Set(ways)], listings: [...new Set(ways.map(parentOf))] }
}

/** What privateWriteProblem checks a private write against. */
export type PrivateWriteCheck = {
  /** The private files of the confirmed roles, absolute: the only paths outside the repo apply may write (T-02-72). */
  readonly allowed: ReadonlySet<string>
  /** The statForWrite answer of each path privateCheckPaths names; a path with no answer counts as failed. */
  readonly stats: ReadonlyMap<string, WriteStat>
  /** The listing of each folder privateCheckPaths names, null where the host could not list it. */
  readonly listings: ReadonlyMap<string, readonly PortEntry[] | null>
  /** Where a refused path is shown from: under the home folder as `~/...` (displayPath). */
  readonly locations: Pick<InitLocations, 'home' | 'root' | 'configDir'>
}

/** Why a write is refused when its path is outside the repo and is not a private file of a confirmed role (T-02-72). */
const OUTSIDE_REASON = 'outside the repo and the role memory folders'

/**
 * The role memory folder of a private file: the folder that holds a hand-out record, or the one above the
 * instructions/ subfolder that holds a private text file; null for any other path.
 */
function privateFolderOf(path: string): string | null {
  const textEnd = `/${PRIVATE_INSTRUCTIONS_FOLDER}/${PRIVATE_CLAUDE_MD}`
  if (path.endsWith(textEnd)) return path.slice(0, -textEnd.length)
  if (path.endsWith(`/${INSTRUCTIONS_RECORD_FILE}`)) return parentOf(path)

  return null
}

/**
 * Why the listings refuse a private write, or null (#72 A2): from the top, each path of the way is looked up in the
 * listing of the folder that holds it, which shows a link as a link, a dangling one included, and one listed as a link
 * refuses. A folder on the way that is there but gave no listing refuses as not checked, while one its stat found
 * absent holds nothing, so the look-up stops there; the repo's folder, which holds the role memory folder, only skips
 * the look-up of the top path when it gave no listing.
 */
function privateListingProblem(way: readonly string[], check: PrivateWriteCheck): string | null {
  for (const [index, path] of way.entries()) {
    const folder = parentOf(path)
    const entries = check.listings.get(folder) ?? null
    if (entries === null && index === 0) continue
    if (entries === null && check.stats.get(folder) === 'absent') return null
    if (entries === null) return LIST_FAILED_REASON
    const name = path.slice(folder.length + 1)
    if (entries.some(entry => entry.name === name && entry.isLink)) return LISTED_LINK_REASON
  }

  return null
}

/**
 * Why a write outside the repo must not happen, or null when it may (G-02-1f, T-02-72). Apply writes outside the repo
 * only a private file of a confirmed role, its private text file or its hand-out record in its role memory folder
 * (`allowed`); any other path is refused as outside the repo and the role memory folders. A private file is then
 * refused as not checked when the stat of a path on its way, from the role memory folder down, failed or was not asked
 * (fail closed); when a folder lists it or a path on its way as a link, or such a folder is there but could not be
 * listed (privateListingProblem, #72 A2), since a write through a link there would land outside the role memory
 * folders; and when it is a real folder. An absent path is fine: the mkdir run and the host make it. The path is shown
 * as displayPath shows it, `~/...` under the home folder, cleaned.
 */
export function privateWriteProblem(path: string, check: PrivateWriteCheck): string | null {
  const { home, root, configDir } = check.locations
  const refused = `refused to write ${displayPath(path, home, root, configDir)}: `
  const folder = privateFolderOf(path)
  if (folder === null || !check.allowed.has(path)) return `${refused}${OUTSIDE_REASON}`
  const way = privateWay(folder, path)
  const stats = way.map(onWay => check.stats.get(onWay) ?? 'failed')
  if (stats.includes('failed')) return `${refused}${STAT_FAILED_REASON}`
  const listed = privateListingProblem(way, check)
  if (listed !== null) return `${refused}${listed}`
  const target = stats.at(-1)
  if (typeof target === 'object' && !target.isLink && target.kind === 'dir') return `${refused}${FOLDER_REASON}`

  return null
}

/** How long one improver run may take before it is given up (G-02-1f, D-141, T-02-77): the file then stays as built. */
export const IMPROVER_TIMEOUT_MS = 300_000

/**
 * The argv of one improver run (D-141 imp-b): `claude -p` in acceptEdits, so the run edits the file in place and asks
 * nothing, then `--` and a prompt that names the claude-md-management:claude-md-improver skill and the file's absolute
 * path. Init runs it only after Confirm, through the host port, with the folder that holds the file as cwd.
 */
export function improverArgv(path: string): readonly string[] {
  return [
    'claude',
    '-p',
    '--permission-mode',
    'acceptEdits',
    '--',
    `Use the claude-md-management:claude-md-improver skill to improve the file ${path} only.`,
  ]
}

/**
 * One built role file the improver pass offers (G-02-1f, D-141): its absolute path, its repo-relative path when it is
 * a repo file (`.cadre/<id>/CLAUDE.md`; null for a private text file), and the text cadre built and wrote there.
 */
export type BuiltFile = {
  readonly path: string
  readonly repoPath: string | null
  readonly text: string
}

/** The repo-relative path of a role's built CLAUDE.md, as desiredFiles names it (G-02-1f Storage split). */
function builtPathOf(id: string): string {
  return `.cadre/${id}/CLAUDE.md`
}

/**
 * The built role files of an apply the improver pass offers, in step order (G-02-1f, D-141): the written
 * `.cadre/<id>/CLAUDE.md` of each role in `withParts`, the roles whose built file holds a repo part (a header alone
 * has nothing to improve), and the private text file of each private step, which apply writes only for a role given
 * a global part (privateFilesOf). A record, a `.cadre-new` copy and every other file are left out. `root` is the repo
 * root the repo paths lie under.
 */
export function builtRoleFiles(
  steps: readonly ApplyStep[],
  root: string,
  withParts: ReadonlySet<string>,
): BuiltFile[] {
  const base = trimSlash(root)
  const built = new Set(Array.from(withParts, builtPathOf))

  return steps.flatMap((step): BuiltFile[] => {
    if (step.kind === 'write' && built.has(step.path)) {
      return [{ path: `${base}/${step.path}`, repoPath: step.path, text: step.text }]
    }
    if (step.kind !== 'private') return []
    const textPath = privateClaudeMdPath(step.path)

    return step.files.filter(file => file.path === textPath).map(file => ({ ...file, repoPath: null }))
  })
}

/**
 * The steps that write built role files back as cadre built them, after the improver pass (G-02-1f, D-141, T-02-76): a
 * repo file as a write of its repo path and a private text file as the private step of its role memory folder, so
 * each write gets the same checks as the first one. A path that is neither gives none.
 */
export function restoreSteps(files: readonly BuiltFile[]): ApplyStep[] {
  return files.flatMap((file): ApplyStep[] => {
    if (file.repoPath !== null) return [{ kind: 'write', path: file.repoPath, text: file.text }]
    const folder = privateFolderOf(file.path)

    return folder === null ? [] : [{ kind: 'private', path: folder, files: [{ path: file.path, text: file.text }] }]
  })
}

/** The answers to the per-file improver question, Accept first (D-141). */
export const IMPROVER_OPTIONS: readonly string[] = Object.freeze(['Accept', 'Keep original'])

/** What the person chose for one improved file: the improver's text, or the text cadre built. */
type ImproverChoice = 'accept' | 'keep'

/** The answer to the per-file improver question: Accept or Keep original, trimmed and in any case; else null. */
function parseImproverAnswer(answer: string): ImproverChoice | null {
  const wanted = answer.trim().toLowerCase()
  if (wanted === 'accept') return 'accept'
  if (wanted === 'keep original') return 'keep'

  return null
}

/** How many lines a diff adds and removes, as the improver block and question say it (D-141). */
function diffCounts(diff: LineDiff): string {
  return `${countedNoun(diff.added, 'line', 'lines')} added, ${diff.removed} removed`
}

/** The per-file improver question (D-141): whether to keep the improver's changes to the file at the shown path. */
export function improverQuestion(path: string): string {
  return `Accept the improver's changes to ${path}?`
}

/** The context line of the per-file improver question (D-136, D-141): the size of the change, and where its diff is. */
export function improverContextLine(diff: LineDiff): string {
  return `${diffCounts(diff)}; the pane shows the diff.`
}

/**
 * The improver block of one file (G-02-1f, D-141): its shown path with how many lines the improver added and removed,
 * then the changed lines (diffLines).
 */
export function improverBlockLines(path: string, diff: LineDiff): string[] {
  return [`${path}: ${diffCounts(diff)}`, ...diffLines(diff)]
}

/** The note for a built file the improver ran on and did not change (D-141). */
export function improverNoChangeNote(path: string): string {
  return `the improver made no change to ${path}`
}

/** The note for a built file whose improver run failed (D-141, T-02-77): why, and that the file stays as built. */
export function improverFailedNote(path: string, reason: string): string {
  return `the improver did not run for ${path} (${reason}): the file stays as built`
}

/**
 * The note for a built file the improver left as something cadre cannot read and show as a diff: gone, a link, not a
 * regular file, over the read cap or unreadable (D-141, T-02-76); it is written back as built.
 */
export function improverUnreadableNote(path: string): string {
  return `the improver left ${path} unreadable: it is written back as built`
}

/** The reply warning for a per-file improver question that got no usable answer (D-141): the file stays as built. */
export function improverDismissedWarning(path: string): string {
  return `the improver question for ${path} was dismissed: the file stays as built`
}

/**
 * Why an improver run failed, or null when it exited 0 (D-141, T-02-77): `it exited with <code>` for any other exit;
 * for a run the host gave no result for, `it timed out` when it lasted IMPROVER_TIMEOUT_MS or longer by the clock,
 * since the host gives up a run at its time, else `it could not start`. `elapsedMs` is null when the clock was not
 * read.
 */
export function improverFailure(run: HostRun | null, elapsedMs: number | null): string | null {
  if (run !== null) return run.exitCode === 0 ? null : `it exited with ${run.exitCode}`
  if (elapsedMs !== null && elapsedMs >= IMPROVER_TIMEOUT_MS) return 'it timed out'

  return 'it could not start'
}

/** How many built files the improver changed and the person accepted, of how many the pass ran for (D-141). */
export type ImproverTally = {
  readonly changed: number
  readonly total: number
}

/** The reply line of an improver pass (D-141), which comes right after the applied lines. */
export function improverLine(tally: ImproverTally): string {
  return `Improver: ${tally.changed} of ${tally.total} built files changed and accepted.`
}

/** What the improver pass did (G-02-1f, D-141), with its tally. */
export type ImproverOutcome = ImproverTally & {
  /** The text of each repo file whose change the person accepted, by repo-relative path: the manifest records it. */
  readonly accepted: ReadonlyMap<string, string>
  /**
   * The built files to write back as cadre built them: each kept, not answered, left unreadable, or changed by a run
   * that failed.
   */
  readonly restores: readonly BuiltFile[]
  /** The reply warning of each per-file question that got no usable answer. */
  readonly warnings: readonly string[]
}

/** What the pass did with one built file: left it as it is, kept the person's accepted text, or gives it back. */
type ImprovedFile =
  | { readonly kind: 'left' }
  | { readonly kind: 'accepted'; readonly text: string }
  | { readonly kind: 'restore'; readonly warning: string | null }

/** A built file the pass leaves as it is. */
const LEFT: ImprovedFile = Object.freeze({ kind: 'left' })

/** A built file the pass gives back to be written as built, with no warning. */
const RESTORE: ImprovedFile = Object.freeze({ kind: 'restore', warning: null })

/**
 * A built file as the improver pass reads it, before and after its run (D-141, T-02-76): only a regular file that is
 * not a link, and for a repo file one whose real path lies inside the repo, is read, up to MAX_READ_BYTES; any other
 * path is `unknown`, and a missing one `absent`. So a link the improver left is never read or shown.
 */
async function builtRead(io: InitIo, file: BuiltFile, root: string): Promise<PortRead> {
  const stat = await io.stat(file.path)
  if (stat === null) return { state: await missingState(io, file.path) }
  if (stat.isLink || stat.kind !== 'file') return { state: 'unknown' }
  if (file.repoPath !== null && !isFileInsideRoot(stat, root)) return { state: 'unknown' }

  return io.read(file.path, MAX_READ_BYTES)
}

/** Whether two reads of one path found the same: the same state and, for text, the same text or size. */
function isSameRead(before: PortRead, after: PortRead): boolean {
  if (before.state === 'text' && after.state === 'text') return before.text === after.text
  if (before.state === 'too-large' && after.state === 'too-large') return before.bytes === after.bytes

  return before.state === after.state
}

/** Where the improver pass shows a path from: the home folder and the repo of the run, and CLAUDE_CONFIG_DIR. */
type ShownFrom = Pick<InitLocations, 'home' | 'root' | 'configDir'>

/** A built file as the pass names it: a repo file by its repo path, a private one as displayPath shows it (`~/...`). */
function shownBuiltPath(file: BuiltFile, from: ShownFrom): string {
  if (file.repoPath !== null) return reportText(file.repoPath)

  return displayPath(file.path, from.home, from.root, from.configDir)
}

/**
 * One file of the improver pass (G-02-1f, D-141). It reads the file (builtRead), runs improverArgv in the folder that
 * holds it with IMPROVER_TIMEOUT_MS, the clock read around the run, and reads it again; the file changed when the two
 * reads differ and it no longer holds the built text. A failed run (improverFailure) notes why and gives a changed file
 * back as built, asking nothing. An unchanged file is noted. A changed file cadre cannot read is noted and given back.
 * Else the improver block shows its diff from the built text and the per-file question is asked: Accept keeps the new
 * text, Keep original gives the file back, and a question with no usable answer gives it back with a warning.
 */
async function improveOne(io: InitIo, host: HostIo, file: BuiltFile, from: ShownFrom): Promise<ImprovedFile> {
  const shownPath = shownBuiltPath(file, from)
  const before = await builtRead(io, file, from.root)
  const started = await io.now()
  const run = await host.run(improverArgv(file.path), { cwd: parentOf(file.path), timeoutMs: IMPROVER_TIMEOUT_MS })
  const ended = await io.now()
  const after = await builtRead(io, file, from.root)
  const isAsBuilt = after.state === 'text' && after.text === file.text
  const isChanged = !isAsBuilt && !isSameRead(before, after)
  const failure = improverFailure(run, started === null || ended === null ? null : ended - started)
  if (failure !== null) {
    await noteLine(io, improverFailedNote(shownPath, failure))

    return isChanged ? RESTORE : LEFT
  }
  if (!isChanged) {
    await noteLine(io, improverNoChangeNote(shownPath))

    return LEFT
  }
  if (after.state !== 'text') {
    await noteLine(io, improverUnreadableNote(shownPath))

    return RESTORE
  }
  const diff = lineDiff(file.text, after.text)
  await showBlock(io, 'improver', improverBlockLines(shownPath, diff))
  const answer = await askChoice(io, {
    question: withContext(improverQuestion(shownPath), improverContextLine(diff)),
    spec: { options: IMPROVER_OPTIONS, header: ASK_HEADERS.improver },
    parse: parseImproverAnswer,
    accepts: quotedLabels(IMPROVER_OPTIONS),
  })
  if (answer.kind !== 'answered') return { kind: 'restore', warning: improverDismissedWarning(shownPath) }

  return answer.value === 'accept' ? { kind: 'accepted', text: after.text } : RESTORE
}

/**
 * The improver pass (G-02-1f, D-141 imp-b): after Confirm, once the built files are written and before the manifest,
 * each file in `files` gets one improver run in turn, in place (improveOne), and the person reviews each change. It
 * gives the accepted text of each repo file for the manifest, the files to write back as built (restoreSteps), the
 * reply warnings, and how many files were changed and accepted of how many it ran for. It writes nothing itself; a
 * dry run never reaches it, since it holds no HostIo (T-03-16).
 */
export async function improveBuiltFiles(
  io: InitIo,
  host: HostIo,
  files: readonly BuiltFile[],
  from: ShownFrom,
): Promise<ImproverOutcome> {
  const accepted = new Map<string, string>()
  const restores: BuiltFile[] = []
  const warnings: string[] = []
  let changed = 0
  for (const file of files) {
    const result = await improveOne(io, host, file, from)
    if (result.kind === 'accepted') {
      changed += 1
      if (file.repoPath !== null) accepted.set(file.repoPath, result.text)
      continue
    }
    if (result.kind === 'left') continue
    restores.push(file)
    if (result.warning !== null) warnings.push(result.warning)
  }

  return { accepted, restores, warnings, changed, total: files.length }
}

/** One framework command apply runs for an accepted hunk: the hunk's key and file, the argv, and its display form. */
export type HunkRun = {
  readonly key: string
  readonly file: string
  /** Re-resolved from the adapter proposal (D-106); never printed, since it holds the raw user-level GSD dir. */
  readonly argv: readonly string[]
  /** The command as the person may run it by hand, with the GSD dir shown as `~/...` (D-71). */
  readonly display: string
}

/**
 * The adapter proposal a hunk was asked from (A5): among the adapters whose autonomyHunks(setup) changes the hunk's
 * file, the first proposal they offer for this setup whose key is the hunk's key; null when none does. Only the
 * hunk's file and key are read, never its before, after or displayed command (D-106).
 */
export function hunkProposal(setup: SetupScan, hunk: HunkOp): SettingProposal | null {
  for (const adapter of ADAPTERS) {
    const offered = adapter.autonomyHunks(setup)
    if (offered === null || offered.file !== hunk.file) continue
    const proposal = offered.proposals.find(candidate => candidate.key === hunk.key)
    if (proposal !== undefined) return proposal
  }

  return null
}

/**
 * The framework commands apply runs, before it renders and hashes ROLE.md (D-120): one for each hunk the person
 * accepted and cadre can run, in hunk order. The argv is re-resolved from the hunk's adapter proposal with
 * resolveToolCommand and is never parsed from the command, before or after text the plan displayed (D-106, D-71).
 * Without a proven user-level GSD the command resolves no argv, so a repo-local GSD gives no run and is only printed
 * for the person (D-28, D-72); a hunk no adapter offers gives no run either.
 */
export function hunkRuns(hunks: readonly HunkOp[], setup: SetupScan, gsd: GsdToolContext): HunkRun[] {
  const runs: HunkRun[] = []
  for (const hunk of hunks) {
    if (!hunk.isAccepted || !hunk.isRunnable) continue
    const proposal = hunkProposal(setup, hunk)
    if (proposal === null) continue
    const { argv, display } = resolveToolCommand(proposal.write, gsd)
    if (argv === null) continue
    runs.push({ key: hunk.key, file: hunk.file, argv, display })
  }

  return runs
}

/**
 * The hunks after their runs (D-106, D-120): each hunk whose key is in `failed` is no longer runnable, so isUnmetHunk
 * makes the roles of its framework attended when it is required and the plan re-judges them before ROLE.md is
 * rendered; every other hunk is kept as it was. The hunks given are not changed. A failure is matched by key, which is
 * unique while every hunk targets the one GSD config file; key it by file and key once a second hunk file exists.
 */
export function hunksAfterRuns(hunks: readonly HunkOp[], failed: ReadonlySet<string>): HunkOp[] {
  return hunks.map(hunk => (failed.has(hunk.key) ? { ...hunk, isRunnable: false } : hunk))
}

/**
 * The line init prints for a framework command that failed at apply (D-106): the file and the key it changes, and the
 * command in display form for the person to run themselves. Every value is cleaned and capped as a report cell is.
 */
export function hunkFailureLine(run: HunkRun): string {
  const change = `the ${reportText(run.file)} change ${reportText(run.key)}`

  return `${change} failed: run it yourself: ${reportText(run.display)}`
}

/**
 * The argv that installs a plugin by its exact key (decision #39). Init runs it only after Confirm, through the host
 * port, with the home folder as cwd.
 */
export function pluginInstallArgv(key: string): readonly string[] {
  return ['claude', 'plugin', 'install', key]
}

/**
 * The argv of the Python check init runs right before the claude-security install (decision #39): claude-security's
 * README asks for Python 3.9 or newer on PATH. Like every install run it has the home folder as cwd, so no repo-level
 * settings or marketplace definitions take part (T-03-46).
 */
export const PYTHON_VERSION_ARGV: readonly string[] = Object.freeze(['python3', '--version'])

/**
 * The argv that adds Anthropic's official marketplace (decision #39): init runs it once per apply, after the first
 * install that fails, and then tries that install once more. It has the home folder as cwd, never the repo, so no
 * repo-level settings or marketplace definitions take part (T-03-46).
 */
export const MARKETPLACE_ADD_ARGV: readonly string[] = Object.freeze([
  'claude',
  'plugin',
  'marketplace',
  'add',
  'anthropics/claude-plugins-official',
])

/**
 * The text init prints for a plugin it could not install (decision #39): the command to run by hand, and, when the
 * marketplace add failed too, that add as a first step only for a missing marketplace, since the add also fails when
 * the marketplace is there already (decision #69 A3). The key is cleaned and capped as a report cell is.
 */
export function installFailureText(key: string, isMarketplaceFailed: boolean): string {
  const shown = reportText(key)
  const install = `claude plugin install ${shown}`
  const add = ` (if the claude-plugins-official marketplace is missing, first run: ${MARKETPLACE_ADD_ARGV.join(' ')})`

  return `could not install ${shown}: run it yourself: ${install}${isMarketplaceFailed ? add : ''}`
}

/**
 * The line init prints once plugins were installed (decision #39): their keys, and that /reload-plugins loads them in
 * the session that ran init. Each key is cleaned and capped as a report cell is.
 */
export function installedLine(keys: readonly string[]): string {
  const them = keys.length === 1 ? 'it' : 'them'

  return `Installed ${keys.map(reportText).join(' and ')}: run /reload-plugins to load ${them} in this session.`
}

/** The version line python3 prints, `Python <major>.<minor>...`, with the major and minor version (decision #39). */
const PYTHON_VERSION_LINE = /^Python (\d+)\.(\d+)/

/**
 * Why claude-security is not to be installed, or null when Python is fine for it (decision #39): claude-security's
 * README asks for Python 3.9 or newer on PATH. A run of PYTHON_VERSION_ARGV the host rejected, or that did not exit 0,
 * means python3 was not found. Otherwise the first line with text of stdout, else of stderr (an older python3 prints
 * its version there), must be a PYTHON_VERSION_LINE of 3.9 or newer; any other line is named, cleaned and capped as a
 * report cell is (T-03-45), and output with no text says nothing. The text ends with the command to run once Python is
 * there.
 */
export function pythonProblem(run: HostRun | null): string | null {
  const needs = (why: string): string =>
    `claude-security was not installed: it needs Python 3.9 or newer on PATH (${why}): install it, then run: ` +
    pluginInstallArgv(CLAUDE_SECURITY_PLUGIN).join(' ')
  if (run === null || run.exitCode !== 0) return needs('python3 was not found')
  const firstLine = (text: string): string | undefined => text.split(/\r?\n/).find(line => line.trim() !== '')
  const line = firstLine(run.stdout) ?? firstLine(run.stderr)
  if (line === undefined) return needs('python3 --version says nothing')
  const match = PYTHON_VERSION_LINE.exec(line)
  const major = Number(match?.[1])
  const minor = Number(match?.[2])
  if (major > 3 || (major === 3 && minor >= 9)) return null

  return needs(`python3 --version says ${reportText(line)}`)
}

/**
 * The text init prints for each plugin to install when no home folder is known to run the installs from (decision
 * #39): nothing is run then, since a run from the repo would let its settings and marketplace definitions take part
 * (T-03-46). The key is cleaned and capped as a report cell is.
 */
export function noHomeInstallText(key: string): string {
  const shown = reportText(key)

  return (
    `could not install ${shown}: no home folder is known to run it from: run it yourself: ` +
    `claude plugin install ${shown}`
  )
}

/**
 * The setup scan the plan is made again from after the installs (decision #39): the setup with each installed plugin
 * key added to its plugins and to its installed plugins, sorted and once each, as the next scan lists them, so a
 * Security role's settings enable claude-security once it is installed. The review plans from it too, with the keys
 * answered Install, so the cards and the plan it shows are those Confirm writes when every install works (decision #69
 * A4). The setup given is not changed.
 */
export function setupAfterInstalls(setup: SetupScan, installed: readonly string[]): SetupScan {
  return {
    ...setup,
    plugins: sortedUnique([...setup.plugins, ...installed]),
    installedPlugins: sortedUnique([...setup.installedPlugins, ...installed]),
  }
}
