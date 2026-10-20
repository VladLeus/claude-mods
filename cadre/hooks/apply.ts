/**
 * Apply plans the writes of a plan the person confirmed (D-105): the files the plan creates or changes in plan order,
 * a chmod right after each launcher, the root `.gitignore` block, and the manifest last, so an apply that stops early
 * never leaves a manifest that claims a file it did not write (LNCH-01). A file the person edited is written only when
 * they answer Take new (D-67), and no write or chmod may follow a link out of the repo. This module reads and writes
 * nothing: init runs the steps through the host port.
 */
import type { DesiredFile, FileMode, FileOp, Manifest, ManifestEntry, Plan, PortStat } from '../types'
import { compareText, isDirInsideRoot, isFileInsideRoot, sortedUnique, trimSlash } from './facts'
import { sha256Hex } from './hash'
import { MANIFEST_PATH, stableJson } from './plan'
import { reportText } from './render'

/** Which version of a conflicted file the person keeps: their own (Keep mine) or cadre's new one (Take new, D-67). */
export type ConflictChoice = 'mine' | 'new'

/**
 * The buttons of a conflict question, in this order; nothing is preselected (D-67). A typed answer of the same words,
 * or of `mine` or `new` alone, counts the same, in any case.
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

/**
 * One step of an apply, in the order it runs; every path is repo-relative and no step deletes anything (LNCH-01):
 * - `write`: write the text to the path;
 * - `chmod`: make the path executable; it always comes right after the write of the same path;
 * - `manifest`: write the manifest text; it is the last step of an apply.
 */
export type ApplyStep =
  | { readonly kind: 'write'; readonly path: string; readonly text: string }
  | { readonly kind: 'chmod'; readonly path: string }
  | { readonly kind: 'manifest'; readonly path: string; readonly text: string }

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
 * The manifest apply writes: the one the plan records, with the entry of each file taken new replaced by one with its
 * new hash, or added when the plan had none for it (an untracked file), sorted by path (D-67).
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
 * the merged block text; a leave writes nothing, and so does a hunk. The manifest comes last, once every file is
 * written, so an apply that stops early never leaves a manifest that claims a file it did not write; it records the
 * new hash of each file taken new and keeps the old entry of each file kept. There is none when the plan keeps the
 * manifest as a conflict (it could not be read, A6), and none when the plan leaves it and no file was taken new. No
 * step deletes anything.
 */
export async function applySteps(input: ApplyInput): Promise<ApplyStep[]> {
  const files = desiredByPath(input.desired)
  const steps: ApplyStep[] = []
  for (const op of input.plan.ops) {
    if (op.kind === 'hunk' || op.path === MANIFEST_PATH) continue
    steps.push(...opSteps(op, input, files))
  }
  const manifestOp = manifestOpOf(input.plan)
  const taken = takenNew(input, files)
  if (manifestOp === null || manifestOp.kind === 'conflict') return steps
  if (manifestOp.kind === 'leave' && taken.length === 0) return steps
  const manifest = await manifestAfter(input.manifest, taken)

  return [...steps, { kind: 'manifest', path: MANIFEST_PATH, text: stableJson(manifest) }]
}

/** The folders above a repo-relative path, below the root, from the top: `.cadre` and `.cadre/be` for `.cadre/be/x`. */
function foldersAbove(path: string): string[] {
  const segments = path.split('/')

  return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join('/'))
}

/**
 * Every repo-relative path the steps name and each folder above one, below the root, sorted by code unit and once
 * each: what init stats, asked with resolve, before an apply writes, so writeProblem can check every write (T-03-13).
 */
export function applyStatPaths(steps: readonly ApplyStep[]): string[] {
  return sortedUnique(steps.flatMap(step => [...foldersAbove(step.path), step.path]))
}

/** Whether a folder above a write lets it through: not there yet, or a real folder strictly inside the root. */
function isSafeFolder(stat: PortStat | null, root: string): boolean {
  if (stat === null) return true

  return !stat.isLink && isDirInsideRoot(stat, root)
}

/** Whether the target of a write lets it through: not there yet, or a regular file strictly inside the root. */
function isSafeTarget(stat: PortStat | null, root: string): boolean {
  if (stat === null) return true

  return !stat.isLink && isFileInsideRoot(stat, root)
}

/**
 * Why a write must not happen, or null when it may (T-03-13): the target is a link, a folder or a file outside the
 * repo, or a folder above it, below the root, is a link, not a folder, or outside the repo. A path with no stat is not
 * there yet, which is fine: the host creates it. `stats` holds the stat of each path applyStatPaths names, keyed by
 * repo-relative path and asked with resolve, so a realPath is absolute; a path it has no key for counts as not there.
 * The path is cleaned and capped as a report cell is.
 */
export function writeProblem(
  path: string,
  stats: ReadonlyMap<string, PortStat | null>,
  root: string,
): string | null {
  const isSafe =
    isSafeTarget(stats.get(path) ?? null, root) &&
    foldersAbove(path).every(folder => isSafeFolder(stats.get(folder) ?? null, root))
  if (isSafe) return null

  return `refused to write ${reportText(path)}: it or a folder above it is a link, or not inside the repo`
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
