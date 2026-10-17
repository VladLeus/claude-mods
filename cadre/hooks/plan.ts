import type {
  DesiredFile,
  FileOp,
  FileOpKind,
  HunkOp,
  Manifest,
  ManifestEntry,
  Plan,
  PortRead,
  ReadState,
} from '../types'
import { compareText, isObject } from './facts'
import { sha256Hex } from './hash'
import { pad, reportText } from './render'

/**
 * The repo-relative path of the manifest, which records every file cadre generated with its hash. Re-runs, regen and a
 * later uninstall find the generated files through it (D-66, D-67).
 */
export const MANIFEST_PATH = '.cadre/manifest.json'

/** Code points the kind column of the plan table takes; a hunk row uses the same column. */
const KIND_WIDTH = 10

/** The indent of a line that belongs to the row above it, so the text lines up under the path. */
const DETAIL_INDENT = ' '.repeat(2 + KIND_WIDTH)

/** The value with the keys of every object sorted by code unit; arrays keep their order. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys)
  if (!isObject(value)) return value
  const pairs = Object.keys(value)
    .sort(compareText)
    .map((key): [string, unknown] => [key, sortedKeys(value[key])])

  return Object.fromEntries(pairs)
}

/**
 * A value as stable JSON: the keys of every object sorted by code unit, arrays in their order, two-space indent and one
 * trailing newline. The same value always gives the same text, so a re-run hashes a generated file the same way
 * (PLAN-04). A key that is a whole number, such as "10", comes first and in numeric order, as JavaScript orders it,
 * which is also the same on every run.
 */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortedKeys(value), null, 2)}\n`
}

/** A file on disk as classifyFile sees it: not there, unreadable, or there with the SHA-256 of its text. */
type DiskHash =
  | { readonly state: 'absent' }
  | { readonly state: 'unknown' }
  | { readonly state: 'present'; readonly hash: string }

/**
 * What the plan does to one generated file (D-67). A file that is not there is created. A file that already holds the
 * desired content is left, which also settles an untracked file that happens to match. A file that still holds what the
 * manifest recorded, while the desired content differs, was not edited, so it is changed. Any other file, one the user
 * edited, one with no manifest entry that differs, or one that cannot be read, is a conflict and is kept as it is
 * (PLAN-04): an unreadable file counts as edited, never as absent.
 */
export function classifyFile(desiredHash: string, manifestHash: string | null, disk: DiskHash): FileOpKind {
  if (disk.state === 'absent') return 'create'
  if (disk.state === 'unknown') return 'conflict'
  if (disk.hash === desiredHash) return 'leave'
  if (disk.hash === manifestHash) return 'change'

  return 'conflict'
}

/**
 * What buildPlan reads, all of it gathered before the call so that planning itself touches nothing. `disk` is keyed by
 * repo-relative path and a missing key counts as absent. `manifest` is the manifest of the last run, with the state it
 * was read in. `carried`, `gitignore` and `hunks` are for the cases later in the plan.
 */
export type PlanInput = {
  /** The files the plan wants on disk. */
  readonly desired: readonly DesiredFile[]
  readonly disk: ReadonlyMap<string, PortRead>
  readonly manifest: Manifest | null
  readonly manifestState: ReadState
  /** Manifest entries of files this plan does not regenerate; they stay in the new manifest with no op (D-68). */
  readonly carried: readonly ManifestEntry[]
  /** The root `.gitignore` as read and the lines of the cadre block to put in it; null when no block is planned. */
  readonly gitignore: { readonly disk: PortRead; readonly lines: readonly string[] } | null
  /** The framework config changes, already answered; they come after the file ops in this order. */
  readonly hunks: readonly HunkOp[]
  /** The cadre version the manifest records. */
  readonly cadreVersion: string
}

/** A file read through the port as classifyFile sees it. A read that failed or was too large is unknown. */
async function diskHashOf(read: PortRead | undefined): Promise<DiskHash> {
  if (read === undefined || read.state === 'absent') return { state: 'absent' }
  if (read.state !== 'text') return { state: 'unknown' }

  return { state: 'present', hash: await sha256Hex(read.text) }
}

/** Orders anything with a path by code unit, so a plan never depends on the locale of the machine. */
function byPath(a: { readonly path: string }, b: { readonly path: string }): number {
  return compareText(a.path, b.path)
}

/**
 * The op for the manifest file. It is compared as plain text and never as a conflict: cadre owns the file, so a text
 * that differs, or a file that cannot be read, is a change.
 */
function manifestOp(input: PlanInput, entries: readonly ManifestEntry[]): FileOp {
  const manifest: Manifest = { schema: 1, cadreVersion: input.cadreVersion, files: [...entries].sort(byPath) }
  const read = input.disk.get(MANIFEST_PATH)
  const isAbsent = read === undefined || read.state === 'absent'
  const isSame = read !== undefined && read.state === 'text' && read.text === stableJson(manifest)
  const kind: FileOpKind = isAbsent ? 'create' : isSame ? 'leave' : 'change'

  return { kind, path: MANIFEST_PATH, mode: 'file', note: null }
}

/**
 * The file plan (PLAN-01): one op per desired file and one for the manifest, sorted by path. Every file is hashed once
 * and classified against the disk and the last manifest (D-67), and the manifest is planned from the desired files'
 * hashes with no timestamp, so building the plan again from the same input gives the same plan (PLAN-04).
 */
export async function buildPlan(input: PlanInput): Promise<Plan> {
  const recorded = new Map((input.manifest?.files ?? []).map((entry): [string, string] => [entry.path, entry.sha256]))
  const ops: FileOp[] = []
  const entries: ManifestEntry[] = []
  for (const file of input.desired) {
    const sha256 = await sha256Hex(file.content)
    const disk = await diskHashOf(input.disk.get(file.path))
    const kind = classifyFile(sha256, recorded.get(file.path) ?? null, disk)
    ops.push({ kind, path: file.path, mode: file.mode, note: null })
    entries.push({ path: file.path, sha256, mode: file.mode })
  }
  ops.push(manifestOp(input, entries))

  return { ops: ops.sort(byPath), warnings: [] }
}

/** The rows of one file op: the kind and path, `(executable)` for a launcher, and the note under the path. */
function fileRows(op: FileOp): string[] {
  const flag = op.mode === 'exec' ? ' (executable)' : ''
  const rows = [`  ${pad(op.kind, KIND_WIDTH)}${reportText(op.path)}${flag}`]
  const note = op.note === null ? '' : reportText(op.note)
  if (note !== '') rows.push(`${DETAIL_INDENT}${note}`)

  return rows
}

/** The rows of one hunk: the file, the key before and after with its flags, and the command under it. */
function hunkRows(op: HunkOp): string[] {
  const change = `${reportText(op.key)}: ${reportText(op.before)} -> ${reportText(op.after)}`
  const flags = `${op.isRequired ? 'required' : 'optional'}, ${op.isAccepted ? 'accepted' : 'declined'}`

  return [
    `  ${pad('hunk', KIND_WIDTH)}${reportText(op.file)}  ${change}  (${flags})`,
    `${DETAIL_INDENT}run: ${reportText(op.command)}`,
  ]
}

/**
 * The plan as the lines init prints (PLAN-01): `File plan:`, one row per op in plan order with the kind padded to a
 * column, any warnings, and a summary that counts each kind and the hunks with their accepted ones. Every value that
 * comes from outside is cleaned and capped as reportText does, so a hostile path or note cannot add a line.
 */
export function renderPlan(plan: Plan): string[] {
  const counts: Record<FileOpKind, number> = { create: 0, change: 0, leave: 0, conflict: 0 }
  const rows: string[] = []
  let hunks = 0
  let accepted = 0
  for (const op of plan.ops) {
    if (op.kind === 'hunk') {
      rows.push(...hunkRows(op))
      hunks += 1
      accepted += op.isAccepted ? 1 : 0
      continue
    }
    rows.push(...fileRows(op))
    counts[op.kind] += 1
  }
  const warnings = plan.warnings.map(warning => `Warning: ${reportText(warning)}`)
  const hunkCount = hunks === 0 ? '0 hunks' : `${hunks} hunks (${accepted} accepted)`
  const kinds = `${counts.create} create, ${counts.change} change, ${counts.leave} leave, ${counts.conflict} conflict`

  return ['File plan:', ...rows, ...warnings, `Summary: ${kinds}, ${hunkCount}`]
}
