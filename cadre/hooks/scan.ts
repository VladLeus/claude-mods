import type { InitIo, PortEntry, PortStat, ReadState, RepoScan, ScanFinding, ScanKind } from '../types'
import { compareText, sortedUnique } from './core/text'
import { hiddenNameWarnings, MAX_READ_BYTES } from './facts'
import { trimSlash } from './paths'
import { manifestsOf, packageFilesOf, readDependencies, readManifest } from './scan/manifests'
import { addMarkers, SOURCE_EXTENSIONS } from './scan/markers'
import type { Findings } from './scan/markers'
import { listingState, missingState, readRepoFile } from './scan/port-read'
import { MAX_ENTRY_NAME_CHARS, walk } from './scan/walk'
import type { Seen } from './scan/walk'
import { parseCadreState, parseManifest } from './state/cadre-files'

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
