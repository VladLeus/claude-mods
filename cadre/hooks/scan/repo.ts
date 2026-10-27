/**
 * The read-only repo scan, a layer 3 module: the stack, the backend and frontend frameworks, tests and E2E, each with
 * the path that proves it, the source languages and top-level code folders, what an earlier run left in `.cadre/`,
 * and the facts a capped scan may have missed (SCAN-01, D-55, D-67, D-137). It writes nothing and runs nothing. It
 * imports core, the facts read cap and name warnings, paths, state, the other scans and the types, so gather and init
 * scan the repo here.
 */
import type { InitIo, ReadState, RepoScan, ScanFinding, ScanKind } from '../../types'
import { compareText } from '../core/text'
import { hiddenNameWarnings, MAX_READ_BYTES } from '../facts'
import { trimSlash } from '../paths'
import { parseCadreState, parseManifest } from '../state/cadre-files'
import { manifestsOf, packageFilesOf, readDependencies, readManifest } from './manifests'
import { addMarkers, SOURCE_EXTENSIONS } from './markers'
import type { Findings } from './markers'
import { listingState, readRepoFile } from './port-read'
import { MAX_ENTRY_NAME_CHARS, walk } from './walk'
import type { Seen } from './walk'

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
