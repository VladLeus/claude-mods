/**
 * The apply steps, a layer 9 module: the writes of a plan the person confirmed, in order (D-105, LNCH-01): the files
 * the plan creates or changes in plan order, a chmod right after each launcher, the root `.gitignore` block, the
 * private steps and the manifest last, so an apply that stops early never leaves a manifest that claims a file it did
 * not write; an edited file is written only on Take new (D-67). It imports core, paths, plan/classify, the private
 * role files, the conflict choice and the types, so the apply runner and init plan their writes here.
 */
import type { DesiredFile, FileMode, FileOp, Manifest, ManifestEntry, Plan } from '../../types'
import { sha256Hex } from '../core/hash'
import { stableJson } from '../core/json'
import { compareText } from '../core/text'
import { BESIDE_SUFFIX, GITIGNORE_FILE } from '../paths'
import { MANIFEST_PATH } from '../plan/classify'
import type { ConflictChoice } from './conflict'
import { privateSteps } from './private'
import type { ApplyInput, ApplyStep } from './private'

/** The desired files by path; of two with the same path the first is kept. */
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
  if (op.path === GITIGNORE_FILE) return ignoreSteps(op, input.gitignore)
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
    if (op.kind !== 'conflict' || op.path === MANIFEST_PATH || op.path === GITIGNORE_FILE) continue
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
