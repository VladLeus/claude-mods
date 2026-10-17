import type {
  CadreState,
  EntryKind,
  GitPolicy,
  InitIo,
  Manifest,
  ManifestEntry,
  PortEntry,
  PortRead,
  ReadState,
  RepoScan,
  ScanFinding,
  ScanKind,
} from '../types'
import { isRoleId } from './command'
import {
  clean,
  compareText,
  hiddenNameWarnings,
  isChangedByClean,
  isFileInsideRoot,
  isObject,
  keysOf,
  MAX_READ_BYTES,
  parseJsonValue,
  trimSlash,
} from './facts'
import { isFrameworkId } from './framework'
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
const MAX_ENTRY_NAME_CHARS = 255

/** Code points of a repo path a warning shows. */
const MAX_WARNING_PATH_CHARS = 120

/** Code points of the git top level a refusal shows. */
const MAX_TOP_CHARS = 240

/** A lowercase hex SHA-256: exactly 64 characters, 0 to 9 and a to f. */
const SHA256_HEX = /^[0-9a-f]{64}$/

/** A cadre version as the manifest and the state file record it: three numbers joined by dots. */
const VERSION_TEXT = /^\d+\.\d+\.\d+$/

/** One path segment of a repo-relative path: letters, digits, dot, underscore, at sign and dash. */
const SAFE_SEGMENT = /^[A-Za-z0-9._@-]+$/

/**
 * The path of a session's autopilot status file, `<home>/.claude/autopilot/<id>.json`, with trailing slashes on the
 * home folder dropped so `/` never gives `//`. Null when the home folder is not an absolute path or the id is not a
 * plain session id, so a caller treats the run state as unknown and never reads some other file in its place (D-42).
 */
export function autopilotStatusPath(home: string, sessionId: string): string | null {
  if (!home.startsWith('/')) return null
  if (!SESSION_ID_PATTERN.test(sessionId)) return null

  return `${trimSlash(home)}/.claude/autopilot/${sessionId}.json`
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

  const value = parseJsonValue(read.text)?.value
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
 * folder at depth 3 is not (D-55). The depth limit is part of the scan's design, so it never marks a scan truncated.
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

/** A repo path as a warning shows it: cleaned and capped. */
function shown(path: string): string {
  return clean(path, MAX_WARNING_PATH_CHARS)
}

/**
 * Whether a path the port could not stat or list is missing (`absent`) or there but out of reach (`unknown`). The
 * port's read answers `absent` only for a path that is not there, so a read capped at 0 bytes tells the two apart and
 * never returns any of the file's text. The setup scan uses the same probe, so both scans tell a missing path from a
 * failed one the same way.
 */
export async function missingState(io: InitIo, path: string): Promise<'absent' | 'unknown'> {
  const probe = await io.read(path, 0)

  return probe.state === 'absent' ? 'absent' : 'unknown'
}

/** A folder as listingState sees it: present with its entries, or absent, or unknown when it cannot be listed. */
export type Listing =
  | { readonly state: 'present'; readonly entries: readonly PortEntry[] }
  | { readonly state: 'absent' }
  | { readonly state: 'unknown' }

/**
 * A folder's listing through the port. The port's list answers null both for a folder that is not there and for one
 * it cannot list, so a null listing is told apart by missingState: a missing path is `absent`, anything else (a file,
 * a failed stat or listing) is `unknown`, because unknown is never the same as absent.
 */
export async function listingState(io: InitIo, path: string): Promise<Listing> {
  const entries = await io.list(path)
  if (entries !== null) return { state: 'present', entries }

  return { state: await missingState(io, path) }
}

/**
 * Reads a repo file through the port, only when its resolved stat is a regular file whose real path is inside the
 * root (WR-02), so a link that leaves the repo, a folder, a device or a FIFO is `unknown` and never read. A path with
 * no stat is never read either: missingState tells a missing file (`absent`) from one the port could not stat
 * (`unknown`). A file over `maxBytes` UTF-8 bytes comes back `too-large`.
 */
export async function readRepoFile(io: InitIo, root: string, relPath: string, maxBytes: number): Promise<PortRead> {
  const path = `${trimSlash(root)}/${relPath}`
  const stat = await io.stat(path)
  if (stat === null) return { state: await missingState(io, path) }
  if (!isFileInsideRoot(stat, root)) return { state: 'unknown' }

  return io.read(path, maxBytes)
}

/**
 * Whether a path is a plain repo-relative path: segments of letters, digits, `.`, `_`, `@` and `-`, none of them `.` or
 * `..`, joined by single slashes, with no leading or trailing slash. Such a path cannot leave the folder it is joined
 * to, and a shell character, a space or a backslash cannot be in it.
 */
export function isSafeRelativePath(path: string): boolean {
  if (path === '') return false

  return path.split('/').every(segment => segment !== '.' && segment !== '..' && SAFE_SEGMENT.test(segment))
}

/** Whether a value is a cadre version text: x.y.z, or `unknown` when cadre could not read its own version. */
function isVersionText(value: unknown): value is string {
  return typeof value === 'string' && (value === 'unknown' || VERSION_TEXT.test(value))
}

/** Whether a value is a git policy cadre stores. */
function isGitPolicy(value: unknown): value is GitPolicy {
  return value === 'all' || value === 'definitions' || value === 'ignore'
}

/** One manifest entry, field by field: a safe path, a lowercase hex SHA-256 and a mode of file or exec; else null. */
function manifestEntryOf(value: unknown): ManifestEntry | null {
  if (!isObject(value)) return null
  const { path, sha256, mode } = value
  if (typeof path !== 'string' || !isSafeRelativePath(path)) return null
  if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) return null
  if (mode !== 'file' && mode !== 'exec') return null

  return { path, sha256, mode }
}

/**
 * The text of `.cadre/manifest.json` as a manifest, or null when it is not one (T-02-12): JSON with schema 1, a cadre
 * version, and a list of entries, each with a safe repo-relative path, a lowercase hex SHA-256 and a mode. A path
 * listed twice makes the whole manifest invalid, and a field the contract does not name is dropped.
 */
export function parseManifest(text: string): Manifest | null {
  const value = parseJsonValue(text)?.value
  if (!isObject(value) || value.schema !== 1 || !isVersionText(value.cadreVersion)) return null
  if (!Array.isArray(value.files)) return null

  const files: ManifestEntry[] = []
  const paths = new Set<string>()
  for (const item of value.files) {
    const file = manifestEntryOf(item)
    if (file === null || paths.has(file.path)) return null
    paths.add(file.path)
    files.push(file)
  }

  return { schema: 1, cadreVersion: value.cadreVersion, files }
}

/**
 * The text of `.cadre/cadre.json` as the repo state, or null when it is not one (T-02-12): JSON with schema 1, a cadre
 * version, a framework that is gsd, superpowers, none or null, a git policy, and a list of role ids that are each a
 * usable role id (isRoleId: a slug, not reserved) and are not listed twice. A field the contract does not name is
 * dropped.
 */
export function parseCadreState(text: string): CadreState | null {
  const value = parseJsonValue(text)?.value
  if (!isObject(value) || value.schema !== 1 || !isVersionText(value.cadreVersion)) return null
  const { framework, gitPolicy, roles } = value
  if (framework !== null && !isFrameworkId(framework)) return null
  if (!isGitPolicy(gitPolicy) || !Array.isArray(roles)) return null

  const ids: string[] = []
  for (const role of roles) {
    if (typeof role !== 'string' || !isRoleId(role) || ids.includes(role)) return null
    ids.push(role)
  }

  return { schema: 1, cadreVersion: value.cadreVersion, framework, gitPolicy, roles: ids }
}

/** One `.cadre/` file as the scan reports it: its state, and its parsed value when it is present. */
type CadreFile<T> = {
  readonly state: ReadState
  readonly value: T | null
}

/**
 * Reads and parses one file of `.cadre/` through readRepoFile. Absent stays absent. A file that cannot be read, or
 * that `parse` refuses, is unknown with a warning, so a re-run never takes it for a file that is not there (D-67).
 */
async function readCadreFile<T>(
  io: InitIo,
  root: string,
  name: string,
  parse: (text: string) => T | null,
  noun: string,
  warnings: string[],
): Promise<CadreFile<T>> {
  const path = `.cadre/${name}`
  const read = await readRepoFile(io, root, path, MAX_READ_BYTES)
  if (read.state === 'absent') return { state: 'absent', value: null }
  if (read.state !== 'text') {
    warnings.push(`could not read ${path} (treated as unknown)`)

    return { state: 'unknown', value: null }
  }

  const value = parse(read.text)
  if (value === null) {
    warnings.push(`ignored ${path}: not a valid cadre ${noun} (treated as unknown)`)

    return { state: 'unknown', value: null }
  }

  return { state: 'present', value }
}

/**
 * Whether `.cadre/` is there, by listingState: a listing means present, a missing path absent, and anything else
 * unknown (a file in its place, or a stat and listing that fail), because something may be there that the scan cannot
 * see into.
 */
async function cadreDirState(io: InitIo, root: string): Promise<ReadState> {
  return (await listingState(io, `${trimSlash(root)}/.cadre`)).state
}

/**
 * What an earlier run left in `.cadre/` (D-67): whether the folder is there, and its manifest.json and cadre.json,
 * each present with its parsed value, absent, or unknown with a warning. With no folder, nothing else is read.
 */
async function readCadre(io: InitIo, root: string, warnings: string[]): Promise<RepoScan['cadre']> {
  const dir = await cadreDirState(io, root)
  if (dir === 'absent') return { dir, manifest: null, manifestState: 'absent', state: null, stateState: 'absent' }
  if (dir === 'unknown') warnings.push('could not list .cadre (treated as unknown)')

  const manifest = await readCadreFile(io, root, 'manifest.json', parseManifest, 'manifest', warnings)
  const state = await readCadreFile(io, root, 'cadre.json', parseCadreState, 'state', warnings)

  return { dir, manifest: manifest.value, manifestState: manifest.state, state: state.value, stateState: state.state }
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

/** What the walk saw in breadth-first order, the names it skipped, its warnings, and whether it hit the entry cap. */
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
 * one of SKIP_DIRS, and at most MAX_SCAN_ENTRIES entries over all of them. It is truncated only when it hits the entry
 * cap; a folder left unlisted for depth is by design and is not a truncation. A listing that fails is a warning, not an
 * empty folder. An entry name that `clean` would change is skipped and reported.
 */
async function walk(io: InitIo, base: string): Promise<Walk> {
  const seen: Seen[] = []
  const hidden: string[] = []
  const warnings: string[] = []
  const queue: Folder[] = [{ path: '', depth: 0 }]
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
      if (isChangedByClean(entry.name, MAX_ENTRY_NAME_CHARS)) {
        hidden.push(entry.name)
        continue
      }
      if (isDotName(entry.name)) continue

      const path = folder.path === '' ? entry.name : `${folder.path}/${entry.name}`
      seen.push({ path, name: entry.name, kind: entry.kind, isLink: entry.isLink, depth: folder.depth })
      if (!isWalkable(entry) || folder.depth + 1 >= MAX_SCAN_DEPTH) continue
      queue.push({ path, depth: folder.depth + 1 })
    }
  }

  return { seen, hidden, warnings, isTruncated: false }
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

/**
 * Adds a finding for each dependency of one package.json that a dependency row names. Only the dependency names are
 * read; their versions and every other field are ignored. Returns the warning when the file cannot be read or parsed,
 * else null.
 */
async function readDependencies(found: Findings, io: InitIo, root: string, path: string): Promise<string | null> {
  const read = await readRepoFile(io, root, path, MAX_READ_BYTES)
  if (read.state !== 'text') return `could not read ${shown(path)} (treated as unknown)`

  const value = parseJsonValue(read.text)?.value
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
 * with the repo-relative path that proves it, plus the source languages and the top-level code folders, and what an
 * earlier run left in `.cadre/` (D-67). It walks through the port with bounded depth and entries (MAX_SCAN_DEPTH,
 * MAX_SCAN_ENTRIES), never follows a link, and reads only the dependency names of the package.json files in the root
 * and one folder down, and the two state files of `.cadre/`, all through readRepoFile. A listing or read that fails
 * is a warning, never an absence. It writes nothing and runs nothing.
 */
export async function scanRepo(io: InitIo, root: string): Promise<RepoScan> {
  const walked = await walk(io, trimSlash(root))
  const found: Findings = new Map()
  addMarkers(found, walked.seen)
  const warnings = [...walked.warnings, ...hiddenNameWarnings(walked.hidden, 'repo entry', MAX_ENTRY_NAME_CHARS)]
  // One file at a time and in walk order, so the first path that names a dependency is always the same one.
  for (const path of packageFilesOf(walked.seen)) {
    const problem = await readDependencies(found, io, root, path)
    if (problem !== null) warnings.push(problem)
  }
  const cadre = await readCadre(io, root, warnings)
  const languages = languagesOf(walked.seen)

  return {
    findings: sortedFindings(found),
    languages,
    codeDirs: codeDirsOf(walked.seen),
    hasSource: languages.length > 0,
    isTruncated: walked.isTruncated,
    cadre,
    warnings,
  }
}

/** The root and each folder above it, nearest first, then the file system root as the empty string. */
function folderChain(root: string): string[] {
  const chain: string[] = []
  let folder = trimSlash(root)
  while (folder !== '') {
    chain.push(folder)
    folder = folder.slice(0, folder.lastIndexOf('/'))
  }
  chain.push('')

  return chain
}

/**
 * The git top level above the session root (D-56): the nearest folder, the root itself included, that has a `.git` file
 * or folder (a linked worktree has a file), found by statting `<folder>/.git` up to `/`, with no process call. A
 * `.git` that cannot be statted is passed over; if none is found, or the root is not an absolute path, the answer is
 * `none`, and the caller refuses.
 */
export async function findGitTop(
  io: InitIo,
  root: string,
): Promise<{ readonly state: 'found'; readonly top: string } | { readonly state: 'none' }> {
  if (!root.startsWith('/')) return { state: 'none' }
  for (const folder of folderChain(root)) {
    const stat = await io.stat(`${folder}/.git`)
    if (stat === null) continue
    if (stat.kind === 'file' || stat.kind === 'dir') return { state: 'found', top: folder === '' ? '/' : folder }
  }

  return { state: 'none' }
}

/**
 * The refusal when the session root is not the git top level, naming the top level, else null (D-56). Trailing
 * slashes are ignored when the two are compared, and the top level is shown cleaned and capped at 240 code points.
 */
export function gitRootRefusal(root: string, top: string, command: 'init' | 'regen'): string | null {
  if (trimSlash(root) === trimSlash(top)) return null

  return `run /cadre ${command} from the repo root: ${clean(top, MAX_TOP_CHARS)}`
}

/** The refusal when no git repo is above the session root, with the wording D-97 fixes. */
export function notGitRepoReply(command: 'init' | 'regen'): string {
  return `cadre ${command} needs a git repo: run git init first`
}
