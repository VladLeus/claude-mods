import type {
  DesiredFile,
  FileOp,
  FileOpKind,
  GitPolicy,
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
 * The begin marker of the cadre block in the root `.gitignore`. The marker strings are an on-disk contract: re-runs,
 * regen and a later uninstall find the block by them (D-64).
 */
export const IGNORE_BEGIN = '# >>> cadre'

/** The end marker of the cadre block in the root `.gitignore`; an on-disk contract like IGNORE_BEGIN (D-64). */
export const IGNORE_END = '# <<< cadre'

/**
 * The per-user files and folders Phase 3 renders into `.cadre/<id>/.runtime/` at launch: the final settings, the MCP
 * file, the skill overlay and the linked instructions (D-66, D-84). The `all` git policy ignores exactly these.
 */
export const RUNTIME_RENDERED: readonly string[] = Object.freeze([
  'settings.json',
  'mcp.json',
  'overlay/',
  'instructions/',
])

/** The scratch copies a conflict plans beside a user-edited file are for diffing and never go into git (D-99). */
const CADRE_NEW_LINE = '.cadre/**/*.cadre-new'

/** The lines that already ignore the `thoughts/` folder, where the handoffs live (D-64). */
const THOUGHTS_LINES: readonly string[] = ['thoughts/', '/thoughts', 'thoughts', '/thoughts/']

/** The repo-relative path of the root `.gitignore`, the one file besides `.cadre/` a plan may write (PLAN-06). */
const GITIGNORE_PATH = '.gitignore'

/** The lines of a text, each with its own line ending, so joining them gives the text back byte for byte. */
function linesOf(text: string): string[] {
  return text.split(/(?<=\n)/)
}

/** A line without its line ending, `\n` or `\r\n`, so a file with Windows line endings is read the same way. */
function lineText(line: string): string {
  return line.replace(/\r?\n$/, '')
}

/**
 * Where the cadre block sits in the lines of a `.gitignore`: the index of the first begin marker line and of the first
 * end marker line after it. A marker that is not there is -1, so a begin marker with no end marker is { begin >= 0,
 * end: -1 }. A marker is a whole line.
 */
function blockMarkers(lines: readonly string[]): { readonly begin: number; readonly end: number } {
  const begin = lines.findIndex(line => lineText(line) === IGNORE_BEGIN)
  if (begin === -1) return { begin, end: -1 }
  const end = lines.findIndex((line, index) => index > begin && lineText(line) === IGNORE_END)

  return { begin, end }
}

/**
 * The lines the cadre block holds for a git policy, without the thoughts/ line (D-64, D-90, D-99). `definitions`
 * ignores every `.runtime` folder wholesale, `all` ignores only the per-user rendered files in them, and `ignore`
 * ignores all of `.cadre/`. The first two also ignore the `.cadre-new` scratch copies. Each call gives a new array.
 */
export function ignoreLines(policy: GitPolicy): string[] {
  if (policy === 'ignore') return ['.cadre/']
  if (policy === 'all') return [...RUNTIME_RENDERED.map(name => `.cadre/*/.runtime/${name}`), CADRE_NEW_LINE]

  return ['.cadre/*/.runtime/', CADRE_NEW_LINE]
}

/**
 * Whether the `.gitignore` text already ignores `thoughts/` on a line of its own, outside the cadre block: `thoughts/`,
 * `/thoughts`, `thoughts` or `/thoughts/`. A line inside the block does not count, since the block is rewritten. Only
 * this file is read, so a nested or a global ignore file is not consulted (best effort, PLAN-03). With a block that
 * never ends, everything after its begin marker counts as inside it.
 */
export function hasThoughtsIgnore(text: string | null): boolean {
  if (text === null) return false
  const lines = linesOf(text)
  const { begin, end } = blockMarkers(lines)
  const outside = begin === -1 ? lines : [...lines.slice(0, begin), ...(end === -1 ? [] : lines.slice(end + 1))]

  return outside.some(line => THOUGHTS_LINES.includes(lineText(line)))
}

/**
 * The lines of the cadre block for a policy and the current `.gitignore` text: `thoughts/` first, unless
 * hasThoughtsIgnore finds it already ignored outside the block, then the policy's lines (PLAN-03, D-64, D-90).
 */
export function gitignoreLines(policy: GitPolicy, existing: string | null): string[] {
  if (hasThoughtsIgnore(existing)) return ignoreLines(policy)

  return ['thoughts/', ...ignoreLines(policy)]
}

/**
 * The `.gitignore` text with the cadre block set to `lines`: the text between the begin and the end marker is replaced,
 * or the block is appended when there is none (a missing file gives the block alone). No line outside the block is
 * touched, byte for byte, and a marker that ends in a carriage return is still found. A begin marker with no end marker
 * after it is a block cadre cannot tell the extent of, so the result is null and the caller asks for a fix by hand
 * (D-64). The lines are plain ignore patterns and the block is always written with `\n`.
 */
export function mergeIgnoreBlock(existing: string | null, lines: readonly string[]): string | null {
  const block = [IGNORE_BEGIN, ...lines, IGNORE_END].map(line => `${line}\n`).join('')
  if (existing === null) return block
  const old = linesOf(existing)
  const { begin, end } = blockMarkers(old)
  if (begin === -1) return `${existing}${existing === '' || existing.endsWith('\n') ? '' : '\n'}${block}`
  if (end === -1) return null

  return `${old.slice(0, begin).join('')}${block}${old.slice(end + 1).join('')}`
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

/** What one part of the plan adds: its file ops and its warnings. */
type Part = { readonly ops: readonly FileOp[]; readonly warnings: readonly string[] }

/** The warning when the `.gitignore` is there but cadre could not read it (Pitfall 6: unknown is never absent). */
const UNREADABLE_IGNORE_WARNING = 'could not read .gitignore (treated as unknown): the ignore block is not planned'

/** The warning when the cadre block in the `.gitignore` has a begin marker and no end marker. */
const OPEN_BLOCK_WARNING =
  'the cadre block in .gitignore has no end marker: fix it by hand; the ignore block is not planned'

/**
 * The `.gitignore` op: the marked block merged into what is there. A file that is not there is created; one that
 * already holds the merged text is left; any other is changed, and only the block differs. A file that cannot be read,
 * or whose block never ends, plans nothing and says so, because guessing could overwrite the user's lines (T-02-18).
 */
function ignorePart(gitignore: PlanInput['gitignore']): Part {
  if (gitignore === null) return { ops: [], warnings: [] }
  const { disk, lines } = gitignore
  if (disk.state === 'unknown' || disk.state === 'too-large') return { ops: [], warnings: [UNREADABLE_IGNORE_WARNING] }
  const existing = disk.state === 'text' ? disk.text : null
  const merged = mergeIgnoreBlock(existing, lines)
  if (merged === null) return { ops: [], warnings: [OPEN_BLOCK_WARNING] }
  const kind: FileOpKind = existing === null ? 'create' : merged === existing ? 'leave' : 'change'

  return { ops: [{ kind, path: GITIGNORE_PATH, mode: 'file', note: null }], warnings: [] }
}

/**
 * The file plan (PLAN-01): one op per desired file, one for the manifest and, when asked, one for the `.gitignore`
 * block, sorted by path. Every file is hashed once and classified against the disk and the last manifest (D-67), and
 * the manifest is planned from the desired files' hashes with no timestamp, so building the plan again from the same
 * input gives the same plan (PLAN-04).
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
  const ignore = ignorePart(input.gitignore)
  ops.push(manifestOp(input, entries), ...ignore.ops)

  return { ops: ops.sort(byPath), warnings: [...ignore.warnings] }
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
