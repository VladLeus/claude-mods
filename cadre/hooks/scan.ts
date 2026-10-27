import type { InitIo, PortEntry, PortStat, ReadState, RepoScan, ScanFinding, ScanKind } from '../types'
import { fieldKeysOf, isObject, keysOf, parseJsonValue } from './core/json'
import { compareText, shown, sortedUnique } from './core/text'
import { hiddenNameWarnings, MAX_READ_BYTES } from './facts'
import { trimSlash } from './paths'
import { addFinding, addMarkers, MANIFEST_FILES, MARKER_ROWS, SOURCE_EXTENSIONS } from './scan/markers'
import type { Findings, ManifestKind } from './scan/markers'
import { listingState, missingState, readRepoFile } from './scan/port-read'
import { MAX_ENTRY_NAME_CHARS, MAX_WARNING_PATH_CHARS, walk } from './scan/walk'
import type { Seen } from './scan/walk'
import { parseCadreState, parseManifest } from './state/cadre-files'

/** The dependency groups of a package.json whose names count; optionalDependencies and the rest do not (D-55). */
const DEPENDENCY_GROUPS: readonly string[] = Object.freeze(['dependencies', 'devDependencies', 'peerDependencies'])

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
