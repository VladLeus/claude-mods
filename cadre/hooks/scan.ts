import type { EntryKind, InitIo, PortEntry, PortRead, RepoScan, ScanFinding, ScanKind } from '../types'
import { clean, hiddenNameWarnings, isChangedByClean, isFileInsideRoot, isObject, MAX_READ_BYTES } from './facts'
import { freezeRows } from './freeze'

/**
 * How long an autopilot status file's `beat` counts as alive: twice the 30 second heartbeat autopilot writes, because
 * autopilot itself drops a status older than two beats. The value is copied from autopilot, never imported (D-42).
 */
export const AUTOPILOT_FRESH_MS = 60_000

/** Whether autopilot runs in this session: `none`, `active`, or `unknown` when its status file cannot tell (D-42). */
export type RunState = 'none' | 'active' | 'unknown'

/** A session id as autopilot names its status file: 1 to 128 letters, digits, underscores and dashes. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** Code points a repo entry name keeps; a longer name is skipped, as the detection skips it (WR-03). */
const MAX_NAME_CHARS = 255

/** Code points of a repo path a warning shows. */
const MAX_WARNING_PATH_CHARS = 120

/** The value of a JSON text; undefined when the text is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Orders two texts by code unit, so a sort never depends on the locale. */
function compareText(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1

  return 0
}

/**
 * The path of a session's autopilot status file, `<home>/.claude/autopilot/<id>.json`. Null when the home folder is not
 * an absolute path or the id is not a plain session id, so a caller treats the run state as unknown and never reads
 * some other file in its place (D-42).
 */
export function autopilotStatusPath(home: string, sessionId: string): string | null {
  if (!home.startsWith('/')) return null
  if (!SESSION_ID_PATTERN.test(sessionId)) return null

  return `${home}/.claude/autopilot/${sessionId}.json`
}

/**
 * Whether an autopilot run is live in this session, from a read of its status file (SCAN-04, D-42). It fails closed:
 * only an absent file, `isOn: false` or a stale beat is `none`. A file that is unreadable or over the read cap, is not
 * JSON or not an object, or holds a non-boolean `isOn`, or (when on) a `beat` that is not a finite number, is
 * `unknown`, and so is a clock that is not a finite number. Otherwise the run is `active`, in any phase, while the
 * beat is within AUTOPILOT_FRESH_MS of `now`, a beat ahead of the clock included. `now` is epoch milliseconds.
 */
export function autopilotRunState(read: PortRead, now: number): RunState {
  if (read.state === 'absent') return 'none'
  if (read.state !== 'text') return 'unknown'

  const value = parseJson(read.text)
  if (!isObject(value)) return 'unknown'
  if (value.isOn === false) return 'none'
  if (value.isOn !== true) return 'unknown'

  const beat = value.beat
  if (typeof beat !== 'number' || !Number.isFinite(beat) || !Number.isFinite(now)) return 'unknown'

  return Math.abs(now - beat) <= AUTOPILOT_FRESH_MS ? 'active' : 'none'
}

/**
 * The text that stops `/cadre init` or `/cadre regen` for a run state, or null when it may go on. An active run is
 * told how to stop it; an unknown state says the status file could not be read (D-42).
 */
export function autopilotReply(state: RunState, command: 'init' | 'regen'): string | null {
  if (state === 'none') return null
  if (state === 'active') {
    return (
      `cadre ${command} does not run inside an active autopilot run in this session. ` +
      `Stop it with /autopilot stop, or run /cadre ${command} in another session.`
    )
  }

  return (
    `cadre ${command} can't tell whether autopilot is running in this session ` +
    '(its status file could not be read), so it stopped.'
  )
}

/**
 * How deep the walk goes: a file path has at most 3 segments, so folders at depth 0 (the root) to 2 are listed and a
 * folder at depth 3 is not (D-55).
 */
export const MAX_SCAN_DEPTH = 3

/** The most entries the walk looks at over all folders; it stops there and the scan says it is truncated (D-55). */
export const MAX_SCAN_ENTRIES = 2000

/**
 * Folders the walk never lists, at any depth: version control and tool state, installed dependencies, build output,
 * and the folders cadre and Claude keep. A folder is skipped by its name alone (D-55).
 */
export const SKIP_DIRS: readonly string[] = Object.freeze([
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  'coverage',
  '.cadre',
  '.planning',
  '.claude',
  'thoughts',
])

/** The language, by display name, of each source file extension; an extension that is not here is not source (D-55). */
export const SOURCE_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  rb: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  swift: 'Swift',
  php: 'PHP',
  cs: 'C#',
})

/** The dependency groups of a package.json whose names count; optionalDependencies and the rest do not (D-55). */
const DEPENDENCY_GROUPS: readonly string[] = Object.freeze(['dependencies', 'devDependencies', 'peerDependencies'])

/**
 * One row of the marker table (D-55): what proves a `kind` of finding, shown with `label`. `dep` is a dependency name
 * in a package.json, `file` matches the name of a file, and `dir` is the exact name of a folder.
 */
export type MarkerRow = {
  readonly kind: ScanKind
  readonly label: string
  readonly match: { readonly dep: string } | { readonly file: RegExp } | { readonly dir: string }
}

/** A row that a dependency name in a package.json proves; its label is the package name. */
function depRow(kind: ScanKind, dep: string): MarkerRow {
  return { kind, label: dep, match: Object.freeze({ dep }) }
}

/** A row that a file name proves. */
function fileRow(kind: ScanKind, label: string, file: RegExp): MarkerRow {
  return { kind, label, match: Object.freeze({ file }) }
}

/** A row that a folder name proves. */
function dirRow(kind: ScanKind, label: string, dir: string): MarkerRow {
  return { kind, label, match: Object.freeze({ dir }) }
}

/**
 * The marker table (SCAN-01, D-55), frozen with every row and match. It holds test file name patterns beside the test
 * configs, because a repo such as this one has many `*.test.ts` files and no jest or vitest config, and must still
 * show tests so QA is not dropped.
 */
export const MARKER_ROWS: readonly MarkerRow[] = freezeRows([
  depRow('fe', 'react'),
  depRow('fe', 'vue'),
  depRow('fe', 'next'),
  depRow('fe', 'svelte'),
  depRow('fe', '@angular/core'),
  depRow('be', 'express'),
  depRow('be', '@nestjs/core'),
  depRow('be', 'fastify'),
  depRow('be', 'koa'),
  depRow('be', 'hono'),
  depRow('test', 'jest'),
  depRow('test', 'vitest'),
  depRow('test', 'mocha'),
  depRow('e2e', '@playwright/test'),
  depRow('e2e', 'cypress'),
  fileRow('lang', 'JavaScript/TypeScript (package.json)', /^package\.json$/),
  fileRow('lang', 'Ruby (Gemfile)', /^Gemfile$/),
  fileRow('lang', 'Go (go.mod)', /^go\.mod$/),
  fileRow('lang', 'Python (pyproject.toml)', /^pyproject\.toml$/),
  fileRow('lang', 'Rust (Cargo.toml)', /^Cargo\.toml$/),
  fileRow('test', 'Jest config', /^jest\.config\./),
  fileRow('test', 'Vitest config', /^vitest\.config\./),
  fileRow('test', 'RSpec config', /^\.rspec$/),
  fileRow('test', 'pytest config', /^pytest\.ini$/),
  fileRow('test', 'pytest conftest', /^conftest\.py$/),
  fileRow('test', 'JS/TS test files', /\.(test|spec)\.[cm]?[jt]sx?$/),
  fileRow('test', 'Go test files', /_test\.go$/),
  fileRow('test', 'RSpec spec files', /_spec\.rb$/),
  fileRow('test', 'pytest test files', /^test_.+\.py$/),
  fileRow('e2e', 'Playwright config', /^playwright\.config\./),
  fileRow('e2e', 'Cypress config', /^cypress\.config\./),
  dirRow('e2e', 'Cypress folder', 'cypress'),
])

/**
 * What a repo with no `.cadre/` shows in the scan. Frozen, so no caller can change the one object every such scan
 * shares.
 */
const NO_CADRE: RepoScan['cadre'] = Object.freeze({
  dir: 'absent',
  manifest: null,
  manifestState: 'absent',
  state: null,
  stateState: 'absent',
})

/** The root without trailing slashes, so a path below it is `${base}/${name}`; empty for the root `/`. */
function baseOf(root: string): string {
  return root.replace(/\/+$/, '')
}

/** A repo path as a warning shows it: cleaned and capped. */
function shown(path: string): string {
  return clean(path, MAX_WARNING_PATH_CHARS)
}

/**
 * Reads a repo file through the port, only when its resolved stat is a regular file whose real path is inside the
 * root (WR-02), so a link that leaves the repo, a folder, a device or a FIFO is `unknown` and never read. A path with
 * no stat goes to the port read, which tells a missing file (`absent`) from one it could not read (`unknown`). A file
 * over `maxBytes` UTF-8 bytes comes back `too-large`.
 */
export async function readRepoFile(io: InitIo, root: string, relPath: string, maxBytes: number): Promise<PortRead> {
  const path = `${baseOf(root)}/${relPath}`
  const stat = await io.stat(path)
  if (stat === null) return io.read(path, maxBytes)
  if (!isFileInsideRoot(stat, root)) return { state: 'unknown' }

  return io.read(path, maxBytes)
}

/** A folder waiting to be listed: its path below the root with `/` separators (empty for the root), and its depth. */
type Folder = {
  readonly path: string
  readonly depth: number
}

/** One entry the walk saw: its path below the root, its name, what the host says it is, and its folder's depth. */
type Seen = {
  readonly path: string
  readonly name: string
  readonly kind: EntryKind
  readonly isLink: boolean
  readonly depth: number
}

/** What the walk saw in breadth-first order, the names it skipped, its warnings, and whether it stopped at a cap. */
type Walk = {
  readonly seen: readonly Seen[]
  readonly hidden: readonly string[]
  readonly warnings: readonly string[]
  readonly isTruncated: boolean
}

/** The absolute path of a folder to list: the root for the empty path, else below the root. */
function folderPath(base: string, path: string): string {
  if (path !== '') return `${base}/${path}`

  return base === '' ? '/' : base
}

/** A listing sorted by name, as a copy, so the walk order never depends on the host's order. */
function sortedByName(listing: readonly PortEntry[]): PortEntry[] {
  return [...listing].sort((a, b) => compareText(a.name, b.name))
}

/** Whether a name is `.` or `..` or empty, which a listing never gives and the walk never follows. */
function isDotName(name: string): boolean {
  return name === '' || name === '.' || name === '..'
}

/** Whether the walk may list an entry: a real folder, not a link, and not one of SKIP_DIRS. */
function isWalkable(entry: PortEntry): boolean {
  return entry.kind === 'dir' && !entry.isLink && !SKIP_DIRS.includes(entry.name)
}

/** The warning for a folder the host could not list; the root is named as the repo root. */
function listWarning(path: string): string {
  if (path === '') return 'could not list the repo root (treated as unknown)'

  return `could not list ${shown(path)} (treated as unknown)`
}

/**
 * Lists the repo breadth-first, each listing sorted by name: folders at depth 0 to MAX_SCAN_DEPTH - 1, never a link or
 * one of SKIP_DIRS, and at most MAX_SCAN_ENTRIES entries over all of them. It is truncated when it hits the entry cap
 * or leaves a folder unlisted for depth. A listing that fails is a warning, not an empty folder. An entry name that
 * `clean` would change is skipped and reported.
 */
async function walk(io: InitIo, base: string): Promise<Walk> {
  const seen: Seen[] = []
  const hidden: string[] = []
  const warnings: string[] = []
  const queue: Folder[] = [{ path: '', depth: 0 }]
  let isTruncated = false
  let count = 0
  // The queue grows while it is walked, which is what makes the walk breadth-first.
  for (const folder of queue) {
    const listing = await io.list(folderPath(base, folder.path))
    if (listing === null) {
      warnings.push(listWarning(folder.path))
      continue
    }
    for (const entry of sortedByName(listing)) {
      if (count >= MAX_SCAN_ENTRIES) return { seen, hidden, warnings, isTruncated: true }
      count += 1
      if (isChangedByClean(entry.name, MAX_NAME_CHARS)) {
        hidden.push(entry.name)
        continue
      }
      if (isDotName(entry.name)) continue

      const path = folder.path === '' ? entry.name : `${folder.path}/${entry.name}`
      seen.push({ path, name: entry.name, kind: entry.kind, isLink: entry.isLink, depth: folder.depth })
      if (!isWalkable(entry)) continue
      if (folder.depth + 1 >= MAX_SCAN_DEPTH) {
        isTruncated = true
        continue
      }
      queue.push({ path, depth: folder.depth + 1 })
    }
  }

  return { seen, hidden, warnings, isTruncated }
}

/** The findings so far, one per kind and label. */
type Findings = Map<string, ScanFinding>

/** Adds a finding unless its kind and label already have one, so the evidence is the first path in walk order. */
function addFinding(found: Findings, kind: ScanKind, label: string, evidence: string): void {
  const key = `${kind}:${label}`
  if (found.has(key)) return
  found.set(key, { kind, label, evidence })
}

/** Whether a marker row names an entry: a file row by the file's name, a folder row by the folder's name. */
function rowNames(row: MarkerRow, entry: Seen): boolean {
  if ('file' in row.match) return entry.kind === 'file' && row.match.file.test(entry.name)
  if ('dir' in row.match) return entry.kind === 'dir' && row.match.dir === entry.name

  return false
}

/** Adds a finding for every marker file or folder the walk saw, with the path that proves it. */
function addMarkers(found: Findings, seen: readonly Seen[]): void {
  for (const entry of seen) {
    for (const row of MARKER_ROWS) {
      if (rowNames(row, entry)) addFinding(found, row.kind, row.label, entry.path)
    }
  }
}

/**
 * The package.json files at folder depth 0 or 1, in walk order. A link counts, so reading it can be refused with a
 * warning instead of the file being passed over without a word.
 */
function packageFilesOf(seen: readonly Seen[]): string[] {
  const isPackage = (entry: Seen): boolean =>
    entry.name === 'package.json' && entry.depth <= 1 && (entry.kind === 'file' || entry.isLink)

  return seen.filter(isPackage).map(entry => entry.path)
}

/** The keys of an object value, names only; none when the value is not an object. */
function keysOf(value: unknown): string[] {
  return isObject(value) ? Object.keys(value) : []
}

/**
 * Adds a finding for each dependency of one package.json that a dependency row names. Only the dependency names are
 * read; their versions and every other field are ignored. Returns the warning when the file cannot be read or parsed,
 * else null.
 */
async function readDependencies(found: Findings, io: InitIo, root: string, path: string): Promise<string | null> {
  const read = await readRepoFile(io, root, path, MAX_READ_BYTES)
  if (read.state !== 'text') return `could not read ${shown(path)} (treated as unknown)`

  const value = parseJson(read.text)
  if (!isObject(value)) return `could not parse ${shown(path)} as JSON (treated as unknown)`

  const names = new Set(DEPENDENCY_GROUPS.flatMap(group => keysOf(value[group])))
  for (const row of MARKER_ROWS) {
    if ('dep' in row.match && names.has(row.match.dep)) addFinding(found, row.kind, row.label, path)
  }

  return null
}

/** The language of a source file by its extension; null for any other entry, a dotfile and a name with no dot. */
function languageOf(entry: Seen): string | null {
  if (entry.kind !== 'file') return null
  const dot = entry.name.lastIndexOf('.')
  if (dot < 1) return null
  const extension = entry.name.slice(dot + 1)
  if (!Object.hasOwn(SOURCE_EXTENSIONS, extension)) return null

  return SOURCE_EXTENSIONS[extension] ?? null
}

/** The source languages the walk saw, each once, sorted. */
function languagesOf(seen: readonly Seen[]): string[] {
  const names = new Set<string>()
  for (const entry of seen) {
    const language = languageOf(entry)
    if (language !== null) names.add(language)
  }

  return [...names].sort(compareText)
}

/** The top-level folders that hold a source file at any depth walked, sorted. */
function codeDirsOf(seen: readonly Seen[]): string[] {
  const dirs = new Set<string>()
  for (const entry of seen) {
    if (languageOf(entry) === null) continue
    const slash = entry.path.indexOf('/')
    if (slash < 0) continue
    dirs.add(entry.path.slice(0, slash))
  }

  return [...dirs].sort(compareText)
}

/** The findings sorted by kind, then by label. */
function sortedFindings(found: Findings): ScanFinding[] {
  return [...found.values()].sort((a, b) => compareText(a.kind, b.kind) || compareText(a.label, b.label))
}

/**
 * The read-only repo scan (SCAN-01, D-55): the stack, the backend and frontend frameworks, tests and E2E, each finding
 * with the repo-relative path that proves it, plus the source languages and the top-level code folders. It walks
 * through the port with bounded depth and entries (MAX_SCAN_DEPTH, MAX_SCAN_ENTRIES), never follows a link, and reads
 * only the dependency names of the package.json files in the root and one folder down, through readRepoFile. A listing
 * or read that fails is a warning, never an absence. It writes nothing and runs nothing.
 */
export async function scanRepo(io: InitIo, root: string): Promise<RepoScan> {
  const walked = await walk(io, baseOf(root))
  const found: Findings = new Map()
  addMarkers(found, walked.seen)
  const warnings = [...walked.warnings, ...hiddenNameWarnings(walked.hidden, 'repo entry', MAX_NAME_CHARS)]
  // One file at a time and in walk order, so the first path that names a dependency is always the same one.
  for (const path of packageFilesOf(walked.seen)) {
    const problem = await readDependencies(found, io, root, path)
    if (problem !== null) warnings.push(problem)
  }
  const languages = languagesOf(walked.seen)

  return {
    findings: sortedFindings(found),
    languages,
    codeDirs: codeDirsOf(walked.seen),
    hasSource: languages.length > 0,
    isTruncated: walked.isTruncated,
    cadre: NO_CADRE,
    warnings,
  }
}
