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
import { sha256Hex } from './core/hash'
import { stableJson } from './core/json'
import { compareText, pad, reportText, sortedUnique } from './core/text'
import { BESIDE_SUFFIX, GITIGNORE_FILE, isSafeRelativePath } from './paths'
import { classifyFile, MANIFEST_PATH } from './plan/classify'
import type { DiskHash } from './plan/classify'
import { IGNORE_BEGIN, IGNORE_END, mergeIgnoreBlock, OPEN_BLOCK_WARNING } from './plan/gitignore'

/** Code points the kind column of the plan table takes; a hunk row uses the same column. */
const KIND_WIDTH = 10

/** The indent of a line that belongs to the row above it, so the text lines up under the path. */
const DETAIL_INDENT = ' '.repeat(2 + KIND_WIDTH)

/**
 * The framework config files a hunk may target (PLAN-06). Phase 2 knows one, GSD's `.planning/config.json`; workstream
 * configs are not read. A hunk for any other file is refused.
 */
export const HUNK_FILES: readonly string[] = Object.freeze(['.planning/config.json'])

/**
 * Whether a path may be the target of a file op (PLAN-06): a safe relative path under `.cadre/` that is never inside a
 * `.runtime` folder, whatever the letter case (those hold the per-user files rendered at launch), or exactly the root
 * `.gitignore`. The root CLAUDE.md, `.claude/`, `.planning/`, any path with `..` and any absolute path all fail.
 */
export function isSafeOpPath(path: string): boolean {
  if (!isSafeRelativePath(path)) return false
  if (path === GITIGNORE_FILE) return true
  if (!path.startsWith('.cadre/')) return false

  return !path.split('/').some(segment => segment.toLowerCase() === '.runtime')
}

/** The paths cadre plans itself: the manifest, and the `.gitignore` through its marked block. */
const OWN_PATHS: readonly string[] = [MANIFEST_PATH, GITIGNORE_FILE]

/** The note under a conflict: the file is the user's now, and the new version goes beside it. */
const CONFLICT_NOTE = 'changed outside cadre: kept as is; the new version is planned beside it'

/** The note under a conflict whose file cannot be read: it counts as edited, never as absent or equal. */
const UNREADABLE_NOTE = 'could not read it (treated as changed): kept as is; the new version is planned beside it'

/** The note under the `.cadre-new` copy. */
const NEW_VERSION_NOTE = 'the new version, for diffing; init asks Keep mine or Take new for the file'

/** The note under a `.cadre-new` path that already holds something else: it is kept as it is too. */
const OCCUPIED_NOTE = 'a different file is already there: kept as is'

/** The note under a file the last manifest lists and this plan no longer generates. */
const STALE_NOTE = 'no longer generated (kept; cadre deletes nothing)'

/**
 * What buildPlan reads, all of it gathered before the call so that planning itself touches nothing. `disk` is keyed by
 * repo-relative path and a missing key counts as absent. Only a manifest read in full (`manifestState` present) is
 * trusted: with any other state every differing file is a conflict (fail closed).
 */
export type PlanInput = {
  /** The files the plan wants on disk. A path outside `.cadre/`, or one named twice, is refused with a warning. */
  readonly desired: readonly DesiredFile[]
  readonly disk: ReadonlyMap<string, PortRead>
  /** The manifest of the last run; null when there is none or it could not be read. */
  readonly manifest: Manifest | null
  readonly manifestState: ReadState
  /** Manifest entries of files this plan does not regenerate; they stay in the new manifest with no op (D-68). */
  readonly carried: readonly ManifestEntry[]
  /** The root `.gitignore` as read and the lines of the cadre block to put in it; null when no block is planned. */
  readonly gitignore: { readonly disk: PortRead; readonly lines: readonly string[] } | null
  /** The framework config changes, already answered; they come after the file ops in this order (PLAN-06). */
  readonly hunks: readonly HunkOp[]
  /** The cadre version the manifest records. */
  readonly cadreVersion: string
}

/**
 * The exact repo-relative paths the caller must read into PlanInput.disk before buildPlan: each desired path that
 * isSafeOpPath accepts, the `.cadre-new` copy beside it, and the manifest, once each and sorted by code unit. A key
 * missing from `disk` counts as absent, so a path left out would be planned as if nothing were there (B1).
 */
export function planReadPaths(desired: readonly DesiredFile[]): string[] {
  const paths = desired
    .map(file => file.path)
    .filter(isSafeOpPath)
    .flatMap(path => [path, `${path}${BESIDE_SUFFIX}`])

  return sortedUnique([...paths, MANIFEST_PATH])
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

/** The note under a manifest that could not be read: kept as it is, so the entries of other roles survive (A6). */
const UNREADABLE_MANIFEST_NOTE =
  "could not read it (treated as changed): kept as is, so no role's entries are dropped; it is not written"

/** The warning for a manifest that could not be read (A6, Pitfall 6: unknown is never absent). */
const UNREADABLE_MANIFEST_WARNING =
  'could not read .cadre/manifest.json (treated as unknown): it is kept as is and not written'

/**
 * The op for the manifest file, and the manifest the plan records: schema 1, the cadre version and the entries sorted
 * by path. A manifest that could not be read, by the scan (`manifestState` unknown) or on the disk (unknown or too
 * large), is a conflict with a note: it may hold the entries of other roles, so it is kept as it is and apply does not
 * write it (A6). Any other manifest is compared as plain text, since cadre owns the file: one that is not there is
 * created, the same text is left, and other text is a change.
 */
function manifestOp(
  input: PlanInput,
  entries: readonly ManifestEntry[],
): { readonly op: FileOp; readonly manifest: Manifest } {
  const manifest: Manifest = { schema: 1, cadreVersion: input.cadreVersion, files: [...entries].sort(byPath) }
  const read = input.disk.get(MANIFEST_PATH)
  const isUnreadable = read !== undefined && (read.state === 'unknown' || read.state === 'too-large')
  if (input.manifestState === 'unknown' || isUnreadable) {
    return { op: { kind: 'conflict', path: MANIFEST_PATH, mode: 'file', note: UNREADABLE_MANIFEST_NOTE }, manifest }
  }
  const isAbsent = read === undefined || read.state === 'absent'
  const isSame = read !== undefined && read.state === 'text' && read.text === stableJson(manifest)
  const kind: FileOpKind = isAbsent ? 'create' : isSame ? 'leave' : 'change'

  return { op: { kind, path: MANIFEST_PATH, mode: 'file', note: null }, manifest }
}

/** What one part of the plan adds: its file ops and its warnings. */
type Part = { readonly ops: readonly FileOp[]; readonly warnings: readonly string[] }

/** The warning when the `.gitignore` is there but cadre could not read it (Pitfall 6: unknown is never absent). */
const UNREADABLE_IGNORE_WARNING = 'could not read .gitignore (treated as unknown): the ignore block is not planned'

/**
 * The `.gitignore` op: the marked block merged into what is there. A file that is not there is created; one that
 * already holds the merged text is left; any other is changed, and only the block differs. Created, changed or left,
 * the op carries the block it plans as its detail rows, the markers included, so the review and the reply show what
 * the block holds (PLAN-03, D-134). A file that cannot be read, or whose block never ends, plans nothing and says so,
 * because guessing could overwrite the user's lines (T-02-18).
 */
function ignorePart(gitignore: PlanInput['gitignore']): Part {
  if (gitignore === null) return { ops: [], warnings: [] }
  const { disk, lines } = gitignore
  if (disk.state === 'unknown' || disk.state === 'too-large') return { ops: [], warnings: [UNREADABLE_IGNORE_WARNING] }
  const existing = disk.state === 'text' ? disk.text : null
  const merged = mergeIgnoreBlock(existing, lines)
  if (merged === null) return { ops: [], warnings: [OPEN_BLOCK_WARNING] }
  const kind: FileOpKind = existing === null ? 'create' : merged === existing ? 'leave' : 'change'
  const op: FileOp = {
    kind,
    path: GITIGNORE_FILE,
    mode: 'file',
    note: null,
    detail: [IGNORE_BEGIN, ...lines, IGNORE_END],
  }

  return { ops: [op], warnings: [] }
}

/** The warning for a path the plan will not touch: PLAN-06 allows only `.cadre/` and the root `.gitignore`. */
function refusalWarning(path: string): string {
  return `refused to plan ${reportText(path)}: not a .cadre/ path or .gitignore (PLAN-06)`
}

/** The warning for a path that would be planned a second time: the first one is kept, so one path has one op. */
function twiceWarning(path: string): string {
  return `refused to plan ${reportText(path)} twice: only the first is kept`
}

/**
 * The desired files the plan takes, and one warning for each it refuses: an unsafe path, a path cadre plans itself,
 * and a path named a second time. Both checks ignore letter case, since a file system may (B10); a warning shows the
 * path as it was given.
 */
function acceptFiles(desired: readonly DesiredFile[]): {
  readonly files: readonly DesiredFile[]
  readonly warnings: readonly string[]
} {
  const files: DesiredFile[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  for (const file of desired) {
    const key = file.path.toLowerCase()
    if (!isSafeOpPath(file.path)) {
      warnings.push(refusalWarning(file.path))
      continue
    }
    if (OWN_PATHS.some(own => own.toLowerCase() === key)) {
      warnings.push(`refused to plan ${reportText(file.path)}: cadre plans it itself`)
      continue
    }
    if (seen.has(key)) {
      warnings.push(twiceWarning(file.path))
      continue
    }
    seen.add(key)
    files.push(file)
  }

  return { files, warnings }
}

/** What one desired file adds to the plan: its ops and warnings, and the entry the new manifest records for it. */
type FilePlan = Part & { readonly entry: ManifestEntry | null }

/**
 * The `.cadre-new` copy beside a conflict (D-67): the new version, for diffing. It is classified like any generated
 * file that has no manifest entry, so one that is already there with the new text is left and one that holds something
 * else is kept as it is, never overwritten. A path another desired file already names is not planned twice.
 */
async function besidePart(
  input: PlanInput,
  file: DesiredFile,
  sha256: string,
  attempted: ReadonlySet<string>,
): Promise<Part> {
  const path = `${file.path}${BESIDE_SUFFIX}`
  if (attempted.has(path)) return { ops: [], warnings: [twiceWarning(path)] }
  const kind = classifyFile(sha256, null, await diskHashOf(input.disk.get(path)))
  const note = kind === 'conflict' ? OCCUPIED_NOTE : NEW_VERSION_NOTE

  return { ops: [{ kind, path, mode: file.mode, note }], warnings: [] }
}

/**
 * The ops for one desired file and its manifest entry (D-67, PLAN-04). A conflict keeps the user's file, so it is never
 * a create or a change, and the new manifest keeps the entry the old one had, or none, rather than claiming the file
 * holds what cadre generated.
 */
async function planFile(
  input: PlanInput,
  file: DesiredFile,
  old: ManifestEntry | null,
  attempted: ReadonlySet<string>,
): Promise<FilePlan> {
  const sha256 = await sha256Hex(file.content)
  const disk = await diskHashOf(input.disk.get(file.path))
  const kind = classifyFile(sha256, old?.sha256 ?? null, disk)
  if (kind !== 'conflict') {
    const entry: ManifestEntry = { path: file.path, sha256, mode: file.mode }

    return { ops: [{ kind, path: file.path, mode: file.mode, note: null }], warnings: [], entry }
  }
  const note = disk.state === 'unknown' ? UNREADABLE_NOTE : CONFLICT_NOTE
  const beside = await besidePart(input, file, sha256, attempted)
  const conflict: FileOp = { kind, path: file.path, mode: file.mode, note }

  return { ops: [conflict, ...beside.ops], warnings: beside.warnings, entry: old }
}

/**
 * The manifest entries this plan keeps without regenerating: the carried ones (regen, D-68) and the ones the last
 * manifest lists that are no longer desired, which get a leave op with a note because cadre deletes nothing. An
 * entry whose path is already taken, or is one cadre plans itself, is skipped; one outside `.cadre/` is refused.
 */
function keptPart(
  carried: readonly ManifestEntry[],
  old: readonly ManifestEntry[],
  taken: ReadonlySet<string>,
): Part & { readonly entries: readonly ManifestEntry[] } {
  const ops: FileOp[] = []
  const entries: ManifestEntry[] = []
  const warnings: string[] = []
  const seen = new Set([...taken, ...OWN_PATHS])
  const tagged = [
    ...carried.map((entry): [ManifestEntry, boolean] => [entry, false]),
    ...old.map((entry): [ManifestEntry, boolean] => [entry, true]),
  ]
  for (const [entry, isStale] of tagged) {
    if (seen.has(entry.path)) continue
    seen.add(entry.path)
    if (!isSafeOpPath(entry.path)) {
      warnings.push(refusalWarning(entry.path))
      continue
    }
    entries.push(entry)
    if (isStale) ops.push({ kind: 'leave', path: entry.path, mode: entry.mode, note: STALE_NOTE })
  }

  return { ops, warnings, entries }
}

/** The hunks the plan keeps, in their order, and one warning for each aimed at a file that is not a known config. */
function hunkPart(hunks: readonly HunkOp[]): { readonly ops: readonly HunkOp[]; readonly warnings: readonly string[] } {
  const ops: HunkOp[] = []
  const warnings: string[] = []
  for (const hunk of hunks) {
    if (!HUNK_FILES.includes(hunk.file)) {
      warnings.push(`refused hunk for ${reportText(hunk.file)}: not a known framework config (PLAN-06)`)
      continue
    }
    ops.push(hunk)
  }

  return { ops, warnings }
}

/** The file plan and the manifest it records, which apply writes last (LNCH-01). */
export type PlannedFiles = { readonly plan: Plan; readonly manifest: Manifest }

/**
 * The file plan buildPlan gives, and the manifest that plan records: schema 1, the cadre version and, sorted by path,
 * every entry the plan keeps (each desired file that is not a conflict, with its new hash, the old entry of a conflict,
 * the carried and the stale entries). The manifest op compares the stableJson text of this manifest with the disk,
 * and apply writes that same text, so the plan and the written manifest never differ (LNCH-01).
 */
export async function planWithManifest(input: PlanInput): Promise<PlannedFiles> {
  const manifest = input.manifestState === 'present' ? input.manifest : null
  const old = manifest?.files ?? []
  const recorded = new Map(old.map((entry): [string, ManifestEntry] => [entry.path, entry]))
  const attempted = new Set(input.desired.map(file => file.path))
  const accepted = acceptFiles(input.desired)
  const ops: FileOp[] = []
  const entries: ManifestEntry[] = []
  const warnings = [...accepted.warnings]
  for (const file of accepted.files) {
    const planned = await planFile(input, file, recorded.get(file.path) ?? null, attempted)
    ops.push(...planned.ops)
    warnings.push(...planned.warnings)
    if (planned.entry !== null) entries.push(planned.entry)
  }
  const kept = keptPart(input.carried, old, new Set([...attempted, ...ops.map(op => op.path)]))
  const ignore = ignorePart(input.gitignore)
  const hunks = hunkPart(input.hunks)
  entries.push(...kept.entries)
  const manifestFile = manifestOp(input, entries)
  ops.push(...kept.ops, ...ignore.ops, manifestFile.op)
  warnings.push(...kept.warnings, ...ignore.warnings, ...hunks.warnings)
  if (manifestFile.op.kind === 'conflict') warnings.push(UNREADABLE_MANIFEST_WARNING)

  return { plan: { ops: [...ops.sort(byPath), ...hunks.ops], warnings }, manifest: manifestFile.manifest }
}

/**
 * The file plan (PLAN-01): one op per desired file, one for the manifest and, when asked, one for the `.gitignore`
 * block, sorted by path, then the framework config hunks in their given order. Every file is hashed once and
 * classified against the disk and the last manifest (D-67); a file the user edited or cadre cannot read is a conflict
 * and is never planned for overwrite (PLAN-04), and so is a manifest cadre cannot read, with a warning (A6). There is
 * no op that deletes. Every path is checked against the PLAN-06 allow-list and the manifest is planned from the hashes
 * with no timestamp, so building the plan again from the same input gives the same plan. Classification uses the disk
 * as read for this run; apply plans again from the disk right before it writes. It is the plan of planWithManifest.
 */
export async function buildPlan(input: PlanInput): Promise<Plan> {
  return (await planWithManifest(input)).plan
}

/**
 * The rows of one file op: the kind and path, `(executable)` for a launcher, the note under the path, then one row per
 * detail line (the `.gitignore` block, PLAN-03), each indented like the note and cleaned as a report cell.
 */
function fileRows(op: FileOp): string[] {
  const flag = op.mode === 'exec' ? ' (executable)' : ''
  const rows = [`  ${pad(op.kind, KIND_WIDTH)}${reportText(op.path)}${flag}`]
  const note = op.note === null ? '' : reportText(op.note)
  if (note !== '') rows.push(`${DETAIL_INDENT}${note}`)
  const detail = op.detail ?? []

  return [...rows, ...detail.map(line => `${DETAIL_INDENT}${reportText(line)}`)]
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
 * The summary line of a plan (PLAN-01, D-136): `Summary: `, how many file ops of each kind it holds, then its hunks
 * with how many were accepted. renderPlan ends with it, and the review question carries it in its context line.
 */
export function planSummary(plan: Plan): string {
  const counts: Record<FileOpKind, number> = { create: 0, change: 0, leave: 0, conflict: 0 }
  let hunks = 0
  let accepted = 0
  for (const op of plan.ops) {
    if (op.kind === 'hunk') {
      hunks += 1
      accepted += op.isAccepted ? 1 : 0
      continue
    }
    counts[op.kind] += 1
  }
  const hunkCount = hunks === 0 ? '0 hunks' : `${hunks} hunks (${accepted} accepted)`
  const kinds = `${counts.create} create, ${counts.change} change, ${counts.leave} leave, ${counts.conflict} conflict`

  return `Summary: ${kinds}, ${hunkCount}`
}

/**
 * The plan as the lines init prints (PLAN-01): `File plan:`, one row per op in plan order with the kind padded to a
 * column and its note and detail rows under it (the `.gitignore` block, PLAN-03), any warnings, and last its summary
 * (planSummary), which counts each kind and the hunks with their accepted ones. Every value that comes from outside is
 * cleaned and capped as reportText does, so a hostile path or note cannot add a line.
 */
export function renderPlan(plan: Plan): string[] {
  const rows = plan.ops.flatMap(op => (op.kind === 'hunk' ? hunkRows(op) : fileRows(op)))
  const warnings = plan.warnings.map(warning => `warning: ${reportText(warning)}`)

  return ['File plan:', ...rows, ...warnings, planSummary(plan)]
}
