import type {
  CadreState,
  EntryKind,
  GitPolicy,
  HostRun,
  InitIo,
  LaunchStart,
  Manifest,
  ManifestEntry,
  PortEntry,
  PortRead,
  PortStat,
  ReadState,
  RepoScan,
  ScanFinding,
  ScanKind,
} from '../types'
import { freezeRows } from './core/freeze'
import { fieldKeysOf, isObject, keysOf, parseJsonValue } from './core/json'
import { SHA256_HEX } from './core/names'
import { isRoleId } from './core/role-id'
import { clean, compareText, shown, sortedUnique } from './core/text'
import { hiddenNameWarnings, isChangedByClean, MAX_READ_BYTES } from './facts'
import { isFrameworkId } from './framework'
import { isFileInsideRoot, trimSlash } from './paths'

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
 * The path of a session's autopilot log, `<home>/.claude/autopilot/<id>.log`, beside its status file, with the guards
 * of autopilotStatusPath: null when the home folder is not an absolute path or the id is not a plain session id, so a
 * caller never reads some other file in its place (D-111, T-03-34).
 */
export function autopilotLogPath(home: string, sessionId: string): string | null {
  if (!home.startsWith('/')) return null
  if (!SESSION_ID_PATTERN.test(sessionId)) return null

  return `${trimSlash(home)}/.claude/autopilot/${sessionId}.log`
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

/**
 * The most entries the walk takes from one folder below the first level; the root and every first-level folder are
 * listed in full unless the overall safety cap stops the walk (D-137).
 */
export const MAX_FOLDER_ENTRIES = 200

/** The deepest folder the walk lists in full: the root is depth 0 and a first-level folder depth 1 (D-137). */
const MAX_FULL_DEPTH = 1

/**
 * The overall safety cap on entries over the whole walk (user answer 2026-10-21, D-137); it stops the walk where it is
 * reached.
 */
export const MAX_SCAN_ENTRIES = 20_000

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

/** A manifest the scan reads beside the package.json files, by the one root file it is read from (D-137). */
type ManifestKind = 'gemfile' | 'pyproject' | 'requirements' | 'gomod' | 'cargo' | 'composer'

/**
 * The root file each manifest kind is read from (D-137), in the order the scan reads them. Only these names count,
 * and only in the repo root, so no other manifest is ever read.
 */
export const MANIFEST_FILES: Readonly<Record<ManifestKind, string>> = Object.freeze({
  gemfile: 'Gemfile',
  pyproject: 'pyproject.toml',
  requirements: 'requirements.txt',
  gomod: 'go.mod',
  cargo: 'Cargo.toml',
  composer: 'composer.json',
})

/**
 * One row of the marker table (D-55, D-137): what proves a `kind` of finding, shown with `label`. `dep` is a
 * dependency name in a package.json, `file` matches the name of a file, `dir` is the exact name of a folder,
 * `manifest` with `name` is a dependency name the root manifest of that kind lists, and `path` matches the whole
 * repo-relative path of an entry of the `entry` kind that is not a link.
 */
export type MarkerRow = {
  readonly kind: ScanKind
  readonly label: string
  readonly match:
    | { readonly dep: string }
    | { readonly file: RegExp }
    | { readonly dir: string }
    | { readonly manifest: ManifestKind; readonly name: string }
    | { readonly path: RegExp; readonly entry: 'file' | 'dir' }
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

/** A row that a dependency name in the root manifest of a kind proves (D-137). */
function manifestRow(kind: ScanKind, label: string, manifest: ManifestKind, name: string): MarkerRow {
  return { kind, label, match: Object.freeze({ manifest, name }) }
}

/** A row that the whole repo-relative path of a file or a folder proves, never a link's (D-137). */
function pathRow(kind: ScanKind, label: string, entry: 'file' | 'dir', path: RegExp): MarkerRow {
  return { kind, label, match: Object.freeze({ path, entry }) }
}

/**
 * The marker table (SCAN-01, D-55, D-137), frozen with every row and match. It holds test file name patterns beside
 * the test configs, because a repo such as this one has many `*.test.ts` files and no jest or vitest config, and must
 * still show tests so QA is not dropped. The manifest rows find the backends and the E2E gems a root manifest names,
 * and the path rows find Rails, its system specs and tests, and Cucumber features by where they sit in the repo. Some
 * facts are found in two places, so their kind and label are shared by two rows; the first evidence the scan meets is
 * kept.
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
  manifestRow('be', 'rails', 'gemfile', 'rails'),
  manifestRow('be', 'sinatra', 'gemfile', 'sinatra'),
  manifestRow('be', 'hanami', 'gemfile', 'hanami'),
  manifestRow('be', 'django', 'pyproject', 'django'),
  manifestRow('be', 'flask', 'pyproject', 'flask'),
  manifestRow('be', 'fastapi', 'pyproject', 'fastapi'),
  manifestRow('be', 'django', 'requirements', 'django'),
  manifestRow('be', 'flask', 'requirements', 'flask'),
  manifestRow('be', 'fastapi', 'requirements', 'fastapi'),
  manifestRow('be', 'gin', 'gomod', 'github.com/gin-gonic/gin'),
  manifestRow('be', 'echo', 'gomod', 'github.com/labstack/echo'),
  manifestRow('be', 'fiber', 'gomod', 'github.com/gofiber/fiber'),
  manifestRow('be', 'chi', 'gomod', 'github.com/go-chi/chi'),
  manifestRow('be', 'actix-web', 'cargo', 'actix-web'),
  manifestRow('be', 'axum', 'cargo', 'axum'),
  manifestRow('be', 'rocket', 'cargo', 'rocket'),
  manifestRow('be', 'laravel/framework', 'composer', 'laravel/framework'),
  manifestRow('be', 'symfony', 'composer', 'symfony/framework-bundle'),
  manifestRow('be', 'symfony', 'composer', 'symfony/symfony'),
  depRow('test', 'jest'),
  depRow('test', 'vitest'),
  depRow('test', 'mocha'),
  depRow('e2e', '@playwright/test'),
  depRow('e2e', 'cypress'),
  manifestRow('e2e', 'capybara', 'gemfile', 'capybara'),
  manifestRow('e2e', 'selenium-webdriver', 'gemfile', 'selenium-webdriver'),
  manifestRow('e2e', 'cuprite', 'gemfile', 'cuprite'),
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
  pathRow('be', 'rails', 'file', /^config\/application\.rb$/),
  pathRow('e2e', 'Rails system specs', 'dir', /^spec\/system$/),
  pathRow('e2e', 'Rails system tests', 'dir', /^test\/system$/),
  pathRow('e2e', 'Cucumber features', 'file', /^features\/(?:[^/]+\/)?[^/]+\.feature$/),
])

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

/** The repo folder of the rule files (G-02-1f Sources), below the root; walked with its sub-folders (02-GAPS-B2 M4). */
export const RULES_FOLDER = '.claude/rules'

/** The most folder levels the rule walk lists, `.claude/rules` itself the first (02-GAPS-B2 M4). */
export const MAX_RULE_LEVELS = 5

/** The most listed entries the rule walk takes, every folder together; it stops there (02-GAPS-B2 M4). */
export const MAX_RULE_ENTRIES = 500

/**
 * How one rule walk treats links and folders (02-GAPS-B2 M4): whether a link is taken, as a rule file when its name
 * ends in `.md` and else as a folder to enter, and which stat of a folder lets the walk list it.
 */
export type RuleWalk = {
  readonly isTakenLink: boolean
  readonly isFolderUsable: (stat: PortStat | null) => boolean
}

/** The extension of a rule file. */
const RULE_EXTENSION = '.md'

/** A folder the rule walk listed: its path relative to the rules folder ('' for that folder), level and entries. */
type RuleFolder = {
  readonly rel: string
  readonly level: number
  readonly entries: readonly PortEntry[]
}

/** Whether a listed entry is a rule file for the walk: a `.md` name that is a regular file, or a link when taken. */
function isRuleFile(entry: PortEntry, walk: RuleWalk): boolean {
  if (!entry.name.endsWith(RULE_EXTENSION)) return false
  if (entry.isLink) return walk.isTakenLink

  return entry.kind === 'file'
}

/** Whether a listed entry is a folder the walk may enter: a real folder, or a link not named `.md` when taken. */
function isRuleFolder(entry: PortEntry, walk: RuleWalk): boolean {
  if (entry.isLink) return walk.isTakenLink && !entry.name.endsWith(RULE_EXTENSION)

  return entry.kind === 'dir'
}

/** The entries of a folder below the rules folder, or null when its stat does not let the walk list it or it fails. */
async function ruleFolderEntries(io: InitIo, path: string, walk: RuleWalk): Promise<readonly PortEntry[] | null> {
  if (!walk.isFolderUsable(await io.stat(path))) return null

  return io.list(path)
}

/**
 * The rule files below `<root>/.claude/rules` (02-GAPS-B2 M4), as paths relative to that folder, sorted and once each.
 * The walk is breadth first, from the rules folder (level 1) down to MAX_RULE_LEVELS; each folder is stat-ed and
 * listed only when `walk.isFolderUsable` takes its stat. A rules folder that is not there (missingState `absent`) has
 * none; one whose stat is not usable or that cannot be listed gives null. A sub-folder that cannot be listed is
 * skipped. Every listed entry counts toward MAX_RULE_ENTRIES, and the walk stops there. A `.md` name that is a regular
 * file, or a link when `walk.isTakenLink`, is a rule file; a folder, or a link not named `.md` when links are taken, is
 * entered unless it lies below the last level.
 */
export async function ruleFiles(io: InitIo, root: string, walk: RuleWalk): Promise<readonly string[] | null> {
  const top = `${trimSlash(root)}/${RULES_FOLDER}`
  const stat = await io.stat(top)
  if (stat === null) return (await missingState(io, top)) === 'absent' ? [] : null
  if (!walk.isFolderUsable(stat)) return null
  const entries = await io.list(top)
  if (entries === null) return null
  const found: string[] = []
  // The queue grows as the walk finds folders, so it is read breadth first.
  const queue: RuleFolder[] = [{ rel: '', level: 1, entries }]
  let listed = 0
  for (const folder of queue) {
    for (const entry of folder.entries) {
      if (listed === MAX_RULE_ENTRIES) return sortedUnique(found)
      listed += 1
      const rel = folder.rel === '' ? entry.name : `${folder.rel}/${entry.name}`
      if (isRuleFile(entry, walk)) found.push(rel)
      if (folder.level === MAX_RULE_LEVELS || !isRuleFolder(entry, walk)) continue
      const below = await ruleFolderEntries(io, `${top}/${rel}`, walk)
      if (below !== null) queue.push({ rel, level: folder.level + 1, entries: below })
    }
  }

  return sortedUnique(found)
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
 * A launch start as `.cadre/cadre.json` holds it (A2), or null when it is not one: an object of kind `git-root` or
 * `here`, kept as its kind alone, or of kind `dir` with a string path that isSafeRelativePath takes. A field the
 * contract does not name is dropped.
 */
function launchStartOf(value: unknown): LaunchStart | null {
  if (!isObject(value)) return null
  const { kind, path } = value
  if (kind === 'git-root' || kind === 'here') return { kind }
  if (kind !== 'dir' || typeof path !== 'string' || !isSafeRelativePath(path)) return null

  return { kind: 'dir', path }
}

/**
 * The text of `.cadre/cadre.json` as the repo state, or null when it is not one (T-02-12): JSON with schema 1, a cadre
 * version, a framework that is gsd, superpowers, none or null, a git policy, a list of role ids that are each a
 * usable role id (isRoleId: a slug, not reserved) and are not listed twice, a launch start (launchStartOf), and
 * whether init may read ~/.claude.json (a boolean; missing or any other value makes the state null, fail closed, A1).
 * A missing or invalid launch start makes the state null (fail closed: no cadre.json is in the wild yet, Phase 3
 * writes the first). A field the contract does not name is dropped.
 */
export function parseCadreState(text: string): CadreState | null {
  const value = parseJsonValue(text)?.value
  if (!isObject(value) || value.schema !== 1 || !isVersionText(value.cadreVersion)) return null
  const { framework, gitPolicy, roles } = value
  if (framework !== null && !isFrameworkId(framework)) return null
  if (!isGitPolicy(gitPolicy) || !Array.isArray(roles)) return null
  const launchStart = launchStartOf(value.launchStart)
  if (launchStart === null) return null
  if (typeof value.readUserMcp !== 'boolean') return null

  const ids: string[] = []
  for (const role of roles) {
    if (typeof role !== 'string' || !isRoleId(role) || ids.includes(role)) return null
    ids.push(role)
  }

  return {
    schema: 1,
    cadreVersion: value.cadreVersion,
    framework,
    gitPolicy,
    roles: ids,
    launchStart,
    readUserMcp: value.readUserMcp,
  }
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

/**
 * What the walk saw in breadth-first order, the names it skipped, its warnings, the deeper folders it listed only in
 * part (sorted), and whether it stopped at the overall safety cap (D-137).
 */
type Walk = {
  readonly seen: readonly Seen[]
  readonly hidden: readonly string[]
  readonly warnings: readonly string[]
  readonly cappedFolders: readonly string[]
  readonly isOverallCapped: boolean
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

  return `could not list ${shown(path, MAX_WARNING_PATH_CHARS)} (treated as unknown)`
}

/**
 * Lists the repo breadth-first, each listing sorted by name: folders at depth 0 to MAX_SCAN_DEPTH - 1, never a link or
 * one of SKIP_DIRS (D-55, D-137). The root and every first-level folder are listed in full; a deeper folder gives at
 * most its first MAX_FOLDER_ENTRIES entries in name order, its path is recorded, and the walk goes on with the next
 * folder, so one huge folder cannot end the walk. Independent of that, the walk stops once it has counted
 * MAX_SCAN_ENTRIES entries in all and records that it reached the safety cap. A folder left unlisted for depth is by
 * design and is not recorded. A listing that fails is a warning, not an empty folder. An entry name that `clean` would
 * change is skipped and reported.
 */
async function walk(io: InitIo, base: string): Promise<Walk> {
  const seen: Seen[] = []
  const hidden: string[] = []
  const warnings: string[] = []
  const capped: string[] = []
  const queue: Folder[] = [{ path: '', depth: 0 }]
  const result = (isOverallCapped: boolean): Walk => ({
    seen,
    hidden,
    warnings,
    cappedFolders: [...capped].sort(compareText),
    isOverallCapped,
  })
  let count = 0
  // The queue grows while it is walked, which is what makes the walk breadth-first.
  for (const folder of queue) {
    const listing = await io.list(folderPath(base, folder.path))
    if (listing === null) {
      warnings.push(listWarning(folder.path))
      continue
    }
    const sorted = sortedByName(listing)
    const isCapped = folder.depth > MAX_FULL_DEPTH && sorted.length > MAX_FOLDER_ENTRIES
    if (isCapped) capped.push(folder.path)
    for (const entry of isCapped ? sorted.slice(0, MAX_FOLDER_ENTRIES) : sorted) {
      if (count >= MAX_SCAN_ENTRIES) return result(true)
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

  return result(false)
}

/** The findings so far, one per kind and label. */
type Findings = Map<string, ScanFinding>

/** Adds a finding unless its kind and label already have one, so the evidence is the first path in walk order. */
function addFinding(found: Findings, kind: ScanKind, label: string, evidence: string): void {
  const key = `${kind}:${label}`
  if (found.has(key)) return
  found.set(key, { kind, label, evidence })
}

/**
 * Whether a marker row names an entry: a file row by the file's name, a folder row by the folder's name, and a path row
 * by the whole repo-relative path of an entry of its kind that is not a link (D-137).
 */
function rowNames(row: MarkerRow, entry: Seen): boolean {
  if ('file' in row.match) return entry.kind === 'file' && row.match.file.test(entry.name)
  if ('dir' in row.match) return entry.kind === 'dir' && row.match.dir === entry.name
  if ('path' in row.match) return entry.kind === row.match.entry && !entry.isLink && row.match.path.test(entry.path)

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
  if (read.state !== 'text') return `could not read ${shown(path, MAX_WARNING_PATH_CHARS)} (treated as unknown)`

  const value = parseJsonValue(read.text)?.value
  if (!isObject(value)) return `could not parse ${shown(path, MAX_WARNING_PATH_CHARS)} as JSON (treated as unknown)`

  const names = new Set(DEPENDENCY_GROUPS.flatMap(group => keysOf(value[group])))
  for (const row of MARKER_ROWS) {
    if ('dep' in row.match && names.has(row.match.dep)) addFinding(found, row.kind, row.label, path)
  }

  return null
}

/** A Gemfile line, trimmed, that declares a gem: `gem`, spaces, and a name in matching single or double quotes. */
const GEM_LINE = /^gem\s+(['"])([A-Za-z0-9_.-]+)\1/

/**
 * The gems a Gemfile declares (D-137), in file order and each once: the quoted name of every line that, trimmed,
 * starts with `gem`, spaces and a single- or double-quoted name of letters, digits, `_`, `.` and `-`, a line inside a
 * group block included. A commented line gives nothing, and a version or any other argument is never kept.
 */
export function gemfileGems(text: string): string[] {
  const gems = new Set<string>()
  for (const line of text.split('\n')) {
    const name = GEM_LINE.exec(line.trim())?.[2]
    if (name !== undefined) gems.add(name)
  }

  return [...gems]
}

/** The names that are not empty, in the order given and each once. */
function namesOnce(names: readonly string[]): string[] {
  return [...new Set(names.filter(name => name !== ''))]
}

/** The leading run of letters, digits, `_`, `.` and `-` of a text: a dependency name before its version or extras. */
const NAME_RUN = /^[A-Za-z0-9_.-]*/

/** A Python dependency name as the scan compares it (D-137): the leading name run, lowercased, with `_` as `-`. */
function pythonName(text: string): string {
  return (NAME_RUN.exec(text)?.[0] ?? '').toLowerCase().replaceAll('_', '-')
}

/** The name of a TOML table header line such as `[dependencies]` or `[[bin]]`, trimmed; null for any other line. */
function tableOf(line: string): string | null {
  if (!line.startsWith('[')) return null
  const inner = line.replace(/^\[+/, '')
  const end = inner.indexOf(']')

  return (end < 0 ? inner : inner.slice(0, end)).trim()
}

/** The key of a TOML `key = value` line: the text before the first `=`, trimmed, with no opening quote; else null. */
function keyOf(line: string): string | null {
  const at = line.indexOf('=')
  if (at < 0) return null

  return line.slice(0, at).trim().replace(/^["']/, '')
}

/**
 * The quoted strings of one line of a TOML array, up to the `]` that closes the array or a `#` comment outside a
 * string, and whether the array closed on this line.
 */
function arrayLine(text: string): { readonly strings: readonly string[]; readonly isClosed: boolean } {
  const strings: string[] = []
  let quote = ''
  let current = ''
  for (const char of text) {
    if (quote !== '' && char !== quote) {
      current += char
      continue
    }
    if (quote !== '') {
      strings.push(current)
      quote = ''
      current = ''
      continue
    }
    if (char === '#') break
    if (char === ']') return { strings, isClosed: true }
    if (char === '"' || char === "'") quote = char
  }

  return { strings, isClosed: false }
}

/** The `[project]` key whose array lists the runtime dependencies of a pyproject.toml. */
const PROJECT_DEPENDENCIES = 'dependencies'

/**
 * The dependencies a pyproject.toml lists (D-137), in file order and each once: every quoted string of the
 * `dependencies = [ ... ]` array of the `[project]` table, on one line or several, and every key before `=` in the
 * `[tool.poetry.dependencies]` table. A name is the leading run of letters, digits, `_`, `.` and `-`, lowercased, with
 * `_` as `-`, so a version, an extra or a marker is never kept. Every other table is passed over.
 */
export function pyprojectDeps(text: string): string[] {
  const names: string[] = []
  let table = ''
  let isInArray = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (isInArray) {
      const part = arrayLine(line)
      names.push(...part.strings.map(pythonName))
      isInArray = !part.isClosed
      continue
    }
    const header = tableOf(line)
    if (header !== null) {
      table = header
      continue
    }
    if (table === 'tool.poetry.dependencies') {
      names.push(pythonName(keyOf(line) ?? ''))
      continue
    }
    if (table !== 'project' || keyOf(line) !== PROJECT_DEPENDENCIES) continue
    const value = line.slice(line.indexOf('=') + 1).trim()
    if (!value.startsWith('[')) continue
    const part = arrayLine(value.slice(1))
    names.push(...part.strings.map(pythonName))
    isInArray = !part.isClosed
  }

  return namesOnce(names)
}

/**
 * The dependencies a requirements.txt lists (D-137), in file order and each once: the name of every line that, trimmed,
 * does not start with `#` or `-`, by the name rule of pyprojectDeps, so a comment and an option such as `-r base.txt`
 * give nothing.
 */
export function requirementsDeps(text: string): string[] {
  const lines = text.split('\n').map(line => line.trim())

  return namesOnce(lines.filter(line => !line.startsWith('#') && !line.startsWith('-')).map(pythonName))
}

/** A go.mod line that requires one module: `require`, spaces, then the module path (not the `(` of a block). */
const REQUIRE_LINE = /^require\s+([^\s(]\S*)/

/** The go.mod line that opens a require block. */
const REQUIRE_BLOCK = /^require\s*\($/

/** A Go module path's trailing major version, such as `/v4`. */
const MAJOR_VERSION = /\/v\d+$/

/** A go.mod line, trimmed, without its `//` comment. */
function goLine(raw: string): string {
  const line = raw.trim()
  const at = line.indexOf('//')

  return (at < 0 ? line : line.slice(0, at)).trim()
}

/**
 * The modules a go.mod requires (D-137), in file order and each once: the module path of every `require <path>
 * <version>` line and of every line inside a `require (` ... `)` block, with a trailing `/v<digits>` removed, so
 * `github.com/labstack/echo/v4` is `github.com/labstack/echo`. A comment, a version and every other directive give
 * nothing.
 */
export function goModules(text: string): string[] {
  const modules: string[] = []
  let isInBlock = false
  for (const raw of text.split('\n')) {
    const line = goLine(raw)
    if (isInBlock && line === ')') {
      isInBlock = false
      continue
    }
    if (isInBlock) {
      modules.push((line.split(/\s+/)[0] ?? '').replace(MAJOR_VERSION, ''))
      continue
    }
    if (REQUIRE_BLOCK.test(line)) {
      isInBlock = true
      continue
    }
    const required = REQUIRE_LINE.exec(line)?.[1]
    if (required !== undefined) modules.push(required.replace(MAJOR_VERSION, ''))
  }

  return namesOnce(modules)
}

/** The leading run of letters, digits, `_` and `-` of a text: a crate name, which the `.` of a dotted key ends. */
const CRATE_RUN = /^[A-Za-z0-9_-]*/

/** The start of the name of a Cargo.toml table that holds one dependency, such as `[dependencies.rocket]`. */
const CRATE_TABLE = 'dependencies.'

/** A crate name from the start of a TOML key or table name, without an opening quote. */
function crateName(text: string): string {
  return CRATE_RUN.exec(text.replace(/^["']/, ''))?.[0] ?? ''
}

/**
 * The crates a Cargo.toml depends on (D-137), in file order and each once: every key before `=` in the `[dependencies]`
 * table, a dotted key such as `tokio.workspace` by its first part, and the name of every `[dependencies.<name>]` table.
 * The dev, build and target dependency tables are passed over.
 */
export function cargoDeps(text: string): string[] {
  const names: string[] = []
  let table = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const header = tableOf(line)
    if (header !== null && header.startsWith(CRATE_TABLE)) names.push(crateName(header.slice(CRATE_TABLE.length)))
    if (header !== null) {
      table = header
      continue
    }
    if (table === 'dependencies') names.push(crateName(keyOf(line) ?? ''))
  }

  return namesOnce(names)
}

/**
 * The packages a composer.json requires (D-137), in file order and each once: the keys of `require` and
 * `require-dev`. Null when the text is not a JSON object, so the scan warns that it could not parse it.
 */
export function composerDeps(text: string): string[] | null {
  const value = parseJsonValue(text)?.value
  if (!isObject(value)) return null

  return namesOnce([...fieldKeysOf(value, 'require'), ...fieldKeysOf(value, 'require-dev')])
}

/**
 * The dependency names the root manifest of a kind lists, by the parser of that kind (D-137); null when the text
 * cannot be parsed (only a composer.json, which must be JSON).
 */
function manifestNames(kind: ManifestKind, text: string): readonly string[] | null {
  switch (kind) {
    case 'gemfile':
      return gemfileGems(text)
    case 'pyproject':
      return pyprojectDeps(text)
    case 'requirements':
      return requirementsDeps(text)
    case 'gomod':
      return goModules(text)
    case 'cargo':
      return cargoDeps(text)
    case 'composer':
      return composerDeps(text)
  }
}

/** Whether a text is a manifest kind, a key of MANIFEST_FILES. */
function isManifestKind(value: string): value is ManifestKind {
  return Object.hasOwn(MANIFEST_FILES, value)
}

/**
 * The root manifests the walk saw, in MANIFEST_FILES order (D-137): each a file or a link in the root listing, so
 * reading a link can be refused with a warning instead of the file being passed over without a word. A manifest one
 * folder down or deeper is never read.
 */
function manifestsOf(seen: readonly Seen[]): ManifestKind[] {
  const isRootFile = (entry: Seen): boolean => entry.depth === 0 && (entry.kind === 'file' || entry.isLink)
  const names = new Set(seen.filter(isRootFile).map(entry => entry.name))

  return Object.keys(MANIFEST_FILES)
    .filter(isManifestKind)
    .filter(kind => names.has(MANIFEST_FILES[kind]))
}

/**
 * Adds a finding for each name the root manifest of a kind lists that a manifest row of that kind names, with the
 * manifest's path as evidence (D-137, T-02-57). It reads through readRepoFile, so a link out of the repo is refused,
 * and at most MAX_READ_BYTES. Only the names a row names are kept, never a version, a source or any other text.
 * Returns the warning when the file cannot be read, or a composer.json cannot be parsed, else null.
 */
async function readManifest(found: Findings, io: InitIo, root: string, kind: ManifestKind): Promise<string | null> {
  const path = MANIFEST_FILES[kind]
  const read = await readRepoFile(io, root, path, MAX_READ_BYTES)
  if (read.state !== 'text') return `could not read ${shown(path, MAX_WARNING_PATH_CHARS)} (treated as unknown)`
  const listed = manifestNames(kind, read.text)
  if (listed === null) return `could not parse ${shown(path, MAX_WARNING_PATH_CHARS)} as JSON (treated as unknown)`

  const names = new Set(listed)
  for (const row of MARKER_ROWS) {
    if (!('manifest' in row.match) || row.match.manifest !== kind) continue
    if (names.has(row.match.name)) addFinding(found, row.kind, row.label, path)
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
 * The read-only repo scan (SCAN-01, D-55, D-137): the stack, the backend and frontend frameworks, tests and E2E, each
 * finding with the repo-relative path that proves it, plus the source languages and the top-level code folders, and
 * what an earlier run left in `.cadre/` (D-67). It walks through the port with bounded depth and entries
 * (MAX_SCAN_DEPTH, MAX_FOLDER_ENTRIES in each deeper folder, MAX_SCAN_ENTRIES in all), records the deeper folders it
 * listed only in part and a stop at the safety cap, never follows a link, and reads only the dependency names of the
 * package.json files in the root and one folder down, then of the root manifests of MANIFEST_FILES, and the two state
 * files of `.cadre/`, all through readRepoFile. A listing or read that fails is a warning, never an absence. It writes
 * nothing and runs nothing.
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
  // Then the root manifests, one at a time in MANIFEST_FILES order, for the same reason (D-137).
  for (const kind of manifestsOf(walked.seen)) {
    const problem = await readManifest(found, io, root, kind)
    if (problem !== null) warnings.push(problem)
  }
  const cadre = await readCadre(io, root, warnings)
  const languages = languagesOf(walked.seen)

  return {
    findings: sortedFindings(found),
    languages,
    codeDirs: codeDirsOf(walked.seen),
    hasSource: languages.length > 0,
    cappedFolders: walked.cappedFolders,
    isOverallCapped: walked.isOverallCapped,
    cadre,
    warnings,
  }
}

/**
 * The facts a scan that listed a deeper folder only in part, or stopped at the safety cap, may have missed (D-137), in
 * this order: `stack` when no language was found, `tests` when there is no test finding and `E2E` when there is no
 * E2E finding, the same rule for both caps. Empty when nothing was capped. The frontend and the backend are never
 * named: they come only from root and first-level files, which the folder cap never limits.
 */
export function undecidedFacts(repo: RepoScan): string[] {
  if (repo.cappedFolders.length === 0 && !repo.isOverallCapped) return []
  const hasKind = (kind: ScanKind): boolean => repo.findings.some(finding => finding.kind === kind)

  return [
    ...(repo.languages.length === 0 ? ['stack'] : []),
    ...(hasKind('test') ? [] : ['tests']),
    ...(hasKind('e2e') ? [] : ['E2E']),
  ]
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
 * The argv that asks git, at `root`, for its git dir and its common dir, both as absolute paths (D-165): the two are
 * the same in the main checkout and differ in a linked worktree. /cadre epic and /cadre status both run it.
 */
export function CHECKOUT_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']
}

/**
 * Which checkout a session root is (D-165): the main checkout, a linked worktree with the main checkout's path when git
 * names it, or unknown.
 */
export type Checkout =
  | { readonly kind: 'main' }
  | { readonly kind: 'linked'; readonly main: string | null }
  | { readonly kind: 'unknown' }

/** The end of a main checkout's git dir, which a linked worktree's common dir has too. */
const GIT_DIR_END = '/.git'

/**
 * The checkout a run of CHECKOUT_ARGV tells (D-165), failing closed: a run that exits 0 with exactly two non-empty
 * lines, both absolute paths, is the main checkout when they are equal, else a linked worktree whose main checkout is
 * the common dir without its trailing `/.git` (null when it does not end so); anything else, a run the host rejected
 * included, is unknown.
 */
export function checkoutOf(run: HostRun | null): Checkout {
  if (run === null || run.exitCode !== 0) return { kind: 'unknown' }
  const lines = run.stdout.split('\n').filter(line => line !== '')
  const [gitDir, commonDir] = lines
  if (lines.length !== 2 || gitDir === undefined || commonDir === undefined) return { kind: 'unknown' }
  if (!gitDir.startsWith('/') || !commonDir.startsWith('/')) return { kind: 'unknown' }
  if (gitDir === commonDir) return { kind: 'main' }
  if (!commonDir.endsWith(GIT_DIR_END)) return { kind: 'linked', main: null }

  return { kind: 'linked', main: commonDir.slice(0, -GIT_DIR_END.length) }
}

/** The cadre commands a refusal is worded for. */
export type CommandWord = 'init' | 'regen' | 'start' | 'status' | 'epic'

/**
 * The refusal when the session root is not the git top level, naming the top level, else null (D-56). Trailing
 * slashes are ignored when the two are compared, and the top level is shown cleaned and capped at 240 code points.
 */
export function gitRootRefusal(root: string, top: string, command: CommandWord): string | null {
  if (trimSlash(root) === trimSlash(top)) return null

  return `run /cadre ${command} from the repo root: ${clean(top, MAX_TOP_CHARS)}`
}

/** The refusal when no git repo is above the session root, with the wording D-97 fixes. */
export function notGitRepoReply(command: CommandWord): string {
  return `cadre ${command} needs a git repo: run git init first`
}
