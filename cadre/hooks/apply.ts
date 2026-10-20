/**
 * Apply plans the writes of a plan the person confirmed (D-105): the files the plan creates or changes in plan order,
 * a chmod right after each launcher, the root `.gitignore` block, and the manifest last, so an apply that stops early
 * never leaves a manifest that claims a file it did not write (LNCH-01). A file the person edited is never written
 * without their answer (D-67). This module reads and writes nothing: init runs the steps through the host port.
 */
import type { DesiredFile, FileMode, FileOp, Manifest, Plan } from '../types'
import { trimSlash } from './facts'
import { MANIFEST_PATH, stableJson } from './plan'

/** Which version of a conflicted file the person keeps: their own (Keep mine) or cadre's new one (Take new, D-67). */
export type ConflictChoice = 'mine' | 'new'

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
  /** The answer to each conflict question, by path (D-67). */
  readonly choices: ReadonlyMap<string, ConflictChoice>
}

/** The repo-relative path of the root `.gitignore`, whose op writes the merged block text. */
const GITIGNORE_PATH = '.gitignore'

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

/**
 * The steps of one file op: a create or a change of a desired file writes its text, and the `.gitignore` op of kind
 * create or change writes the merged block text when there is one. A leave writes nothing, and neither does any other
 * op.
 */
function opSteps(op: FileOp, input: ApplyInput, files: ReadonlyMap<string, DesiredFile>): ApplyStep[] {
  if (op.kind !== 'create' && op.kind !== 'change') return []
  if (op.path === GITIGNORE_PATH) {
    return input.gitignore === null ? [] : [{ kind: 'write', path: op.path, text: input.gitignore }]
  }
  const file = files.get(op.path)
  if (file === undefined) return []

  return writeOf(op.path, file.content, op.mode)
}

/** The plan's op for the manifest; null when the plan has none. */
function manifestOpOf(plan: Plan): FileOp | null {
  for (const op of plan.ops) {
    if (op.kind !== 'hunk' && op.path === MANIFEST_PATH) return op
  }

  return null
}

/**
 * The steps that apply a confirmed plan (D-105, LNCH-01), from the plan's ops in their order: a create or a change of
 * a desired file writes its text, and a launcher (mode exec) is made executable right after its write; the root
 * `.gitignore` op of kind create or change writes the merged block text, when there is one; a leave writes nothing,
 * and so does a hunk. The manifest comes last, once every file is written, so an apply that stops early never leaves a
 * manifest that claims a file it did not write. There is none when the plan keeps the manifest as a conflict (it could
 * not be read, A6), and none when the plan leaves it and no answer is Take new. No step deletes anything.
 */
export async function applySteps(input: ApplyInput): Promise<ApplyStep[]> {
  const files = desiredByPath(input.desired)
  const steps: ApplyStep[] = []
  for (const op of input.plan.ops) {
    if (op.kind === 'hunk' || op.path === MANIFEST_PATH) continue
    steps.push(...opSteps(op, input, files))
  }
  const manifestOp = manifestOpOf(input.plan)
  if (manifestOp === null || manifestOp.kind === 'conflict') return steps
  if (manifestOp.kind === 'leave' && ![...input.choices.values()].includes('new')) return steps

  return [...steps, { kind: 'manifest', path: MANIFEST_PATH, text: stableJson(input.manifest) }]
}

/** The argv that makes a written launcher executable: `/bin/chmod 755` on its absolute path under the root. */
export function chmodArgv(root: string, path: string): readonly string[] {
  return ['/bin/chmod', '755', `${trimSlash(root)}/${path}`]
}
