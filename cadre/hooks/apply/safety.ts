/**
 * The write safety checks, a layer 9 module: what an apply stats and lists before it writes, and why a repo write, a
 * chmod or a private write must not run, with no link, folder or out-of-repo path on its way (T-03-17, T-03-38,
 * T-02-72, #72 A2), and the levels of a role memory folder that are made private (02-GAPS-B3 C5). It imports core,
 * paths, the private role files and the types, so the apply runner, the improver and /cadre start check writes here.
 */
import type { InitLocations, PortEntry, PortStat, WriteStat } from '../../types'
import { reportText, sortedUnique } from '../core/text'
import {
  displayPath,
  foldersAbove,
  INSTRUCTIONS_RECORD_FILE,
  isDirInsideRoot,
  isFileInsideRoot,
  PRIVATE_INSTRUCTIONS_FOLDER,
  trimSlash,
} from '../paths'
import { PRIVATE_CLAUDE_MD } from './private'
import type { ApplyStep, PrivateFile } from './private'

/** The steps that name a repo-relative path: every step but a private one, whose folder lies outside the repo. */
function repoSteps(steps: readonly ApplyStep[]): ApplyStep[] {
  return steps.filter(step => step.kind !== 'private')
}

/**
 * Every repo-relative path the steps name and each folder above one, below the root, sorted by code unit and once
 * each: what init stats, asked with resolve, before an apply writes, so writeProblem can check every write (T-03-13).
 * A private step names none: its paths are checked by privateWriteProblem (privateCheckPaths).
 */
export function applyStatPaths(steps: readonly ApplyStep[]): string[] {
  return sortedUnique(repoSteps(steps).flatMap(step => [...foldersAbove(step.path), step.path]))
}

/**
 * Why a write is refused when its target or a folder above it is a link, not the kind it must be, or outside the
 * repo.
 */
const LINK_REASON = 'it or a folder above it is a link, or not inside the repo'

/** Why a write is refused when its target is a real folder (A5). */
const FOLDER_REASON = 'it is a folder'

/** Why a write is refused when the stat of its target or of a folder above it failed or was not asked (#44). */
const STAT_FAILED_REASON = 'it or a folder above it could not be checked (a stat failed)'

/**
 * Whether a folder above a write lets it through: not there yet, or a real folder strictly inside the root; a failed
 * stat never lets it through.
 */
function isSafeFolder(stat: WriteStat, root: string): boolean {
  if (stat === 'absent') return true
  if (stat === 'failed') return false

  return !stat.isLink && isDirInsideRoot(stat, root)
}

/** Whether the target of a write lets it through: not there yet, or a regular file strictly inside the root. */
function isSafeTarget(stat: PortStat | 'absent', root: string): boolean {
  if (stat === 'absent') return true

  return !stat.isLink && isFileInsideRoot(stat, root)
}

/**
 * Why a write must not happen, or null when it may (T-03-13, #44): a failed stat of the target or of a folder above
 * it, below the root, refuses it as not checked, and so does a path `stats` has no key for (fail closed); a folder
 * above that is a link, not a folder or outside the repo refuses it, as does a target that is a link, not a regular
 * file or outside the repo, except that a target that is a real folder is refused as a folder. An absent path is fine:
 * the host creates it. `stats` holds the WriteStat of each path applyStatPaths names, keyed by repo-relative path and
 * asked with resolve, so a realPath is absolute. The path is cleaned and capped as a report cell is.
 */
export function writeProblem(
  path: string,
  stats: ReadonlyMap<string, WriteStat>,
  root: string,
): string | null {
  const target = stats.get(path) ?? 'failed'
  const above = foldersAbove(path).map(folder => stats.get(folder) ?? 'failed')
  const refused = `refused to write ${reportText(path)}: `
  if (target === 'failed' || above.includes('failed')) return `${refused}${STAT_FAILED_REASON}`
  if (!above.every(stat => isSafeFolder(stat, root))) return `${refused}${LINK_REASON}`
  if (target !== 'absent' && !target.isLink && target.kind === 'dir') return `${refused}${FOLDER_REASON}`
  if (!isSafeTarget(target, root)) return `${refused}${LINK_REASON}`

  return null
}

/**
 * Every folder whose listing init reads before an apply writes, sorted by code unit and once each: the root, as '',
 * and each folder above a path the steps name, so each path applyStatPaths names is listed by its own folder (#72 A2).
 * A private step names none, as for applyStatPaths.
 */
export function applyListPaths(steps: readonly ApplyStep[]): string[] {
  return sortedUnique(['', ...repoSteps(steps).flatMap(step => foldersAbove(step.path))])
}

/** Why a write is refused when the folder that holds it, or one that holds a folder above it, lists it as a link. */
const LISTED_LINK_REASON = 'it or a folder above it is listed as a link'

/** Why a write is refused when the folder that holds it or a folder above it is there but could not be listed. */
const LIST_FAILED_REASON = 'it or a folder above it could not be checked (a folder listing failed)'

/** The folder that holds a repo-relative path, '' for a path at the root. */
function folderOf(path: string): string {
  const at = path.lastIndexOf('/')

  return at < 0 ? '' : path.slice(0, at)
}

/**
 * Why a write must not happen by the listings, or null when it may (#72 A2, T-03-13): a check that does not rest on
 * what the host's stat makes of a link. From the top, each folder above the path and the path itself is looked up in
 * the listing of the folder that holds it, which shows a link as a link, a dangling one included, and an entry listed
 * as a link refuses. A folder below the root with no listing refuses as not checked, unless writeProblem's stat found
 * it absent: a folder that is not there holds nothing, and its own entry was looked up one step before. A root, '',
 * with no listing only skips the look-up of the top entry, as the scans treat an unlistable root as unknown and not as
 * a refusal. `listings` holds what the host listed for each folder applyListPaths names, keyed by repo-relative path,
 * null where it could not list; `stats` is the map writeProblem reads. The path is cleaned and capped as a report cell
 * is.
 */
export function listedLinkProblem(
  path: string,
  stats: ReadonlyMap<string, WriteStat>,
  listings: ReadonlyMap<string, readonly PortEntry[] | null>,
): string | null {
  const refused = `refused to write ${reportText(path)}: `
  for (const entryPath of [...foldersAbove(path), path]) {
    const folder = folderOf(entryPath)
    const entries = listings.get(folder) ?? null
    if (entries === null && folder === '') continue
    if (entries === null && stats.get(folder) === 'absent') return null
    if (entries === null) return `${refused}${LIST_FAILED_REASON}`
    const name = entryPath.slice(folder === '' ? 0 : folder.length + 1)
    if (entries.some(entry => entry.name === name && entry.isLink)) return `${refused}${LISTED_LINK_REASON}`
  }

  return null
}

/**
 * Why a chmod step must not run, or null when it may: a chmod runs only after the write of the same path in this same
 * apply passed writeProblem and landed, and `written` holds the repo-relative paths whose write did. `/bin/chmod`
 * follows links, so a chmod on a path whose write was refused or failed could change the target of a link planted
 * there, outside the repo (RESEARCH 3.2, T-03-13). The path is cleaned and capped as a report cell is.
 */
export function chmodProblem(path: string, written: ReadonlySet<string>): string | null {
  if (written.has(path)) return null

  return `${reportText(path)} was not made executable: its write was refused or failed`
}

/** The argv that makes a written launcher executable: `/bin/chmod 755` on its absolute path under the root. */
export function chmodArgv(root: string, path: string): readonly string[] {
  return ['/bin/chmod', '755', `${trimSlash(root)}/${path}`]
}

/** The folder that holds an absolute path: everything before its last slash. */
export function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

/** The private text file's subfolder of a role memory folder: `<folder>/instructions` (D-140). */
function subfolderOf(folder: string): string {
  return `${folder}/${PRIVATE_INSTRUCTIONS_FOLDER}`
}

/**
 * Every folder level of a role memory folder from the top (02-GAPS-B3 S3, S7, C5): <userDir>/cadre, <repo>-<hash8>,
 * the role memory folder and its instructions/ subfolder. `<userDir>` itself is never a level: a linked config folder
 * is a common setup.
 */
export function roleFolderLevels(folder: string): string[] {
  const repoFolder = parentOf(folder)

  return [parentOf(repoFolder), repoFolder, folder, subfolderOf(folder)]
}

/**
 * The folders apply makes private before it writes these files of a role memory folder (02-GAPS-B2 N13), from the
 * top: the levels of roleFolderLevels, its instructions/ subfolder only when one of the files lies in it. The mkdir
 * run makes the last one and every one above it.
 */
export function privateLevels(folder: string, files: readonly PrivateFile[]): string[] {
  const subfolder = subfolderOf(folder)
  const isInSubfolder = files.some(file => file.path.startsWith(`${subfolder}/`))

  return roleFolderLevels(folder).filter(level => isInSubfolder || level !== subfolder)
}

/**
 * The way to a private file from the top (02-GAPS-B3 S3): the levels of roleFolderLevels above the role memory folder
 * (`<userDir>/cadre` and `<repo>-<hash8>`), the role memory folder, its instructions/ subfolder when the file lies in
 * it, and the file.
 */
function privateWay(folder: string, path: string): string[] {
  const subfolder = subfolderOf(folder)
  const isInSubfolder = path.startsWith(`${subfolder}/`)

  return [...roleFolderLevels(folder).filter(level => isInSubfolder || level !== subfolder), path]
}

/**
 * What apply asks before it writes these private files of a role memory folder (G-02-1f, T-02-72; 02-GAPS-B3 S3), in
 * the order of their ways (privateWay), once each: `stats`, every path on the way to a file from `<userDir>/cadre`
 * down, the file included, which apply stats with statForWrite; `listings`, the folder that holds each of them, from
 * `<userDir>` down. `<userDir>` itself is never checked for a link, as a linked config folder is common; only its
 * listing is asked.
 */
export function privateCheckPaths(
  folder: string,
  files: readonly PrivateFile[],
): { readonly stats: readonly string[]; readonly listings: readonly string[] } {
  const ways = files.flatMap(file => privateWay(folder, file.path))

  return { stats: [...new Set(ways)], listings: [...new Set(ways.map(parentOf))] }
}

/** What privateWriteProblem checks a private write against. */
export type PrivateWriteCheck = {
  /** The private files of the confirmed roles, absolute: the only paths outside the repo apply may write (T-02-72). */
  readonly allowed: ReadonlySet<string>
  /** The statForWrite answer of each path privateCheckPaths names; a path with no answer counts as failed. */
  readonly stats: ReadonlyMap<string, WriteStat>
  /** The listing of each folder privateCheckPaths names, null where the host could not list it. */
  readonly listings: ReadonlyMap<string, readonly PortEntry[] | null>
  /** Where a refused path is shown from: under the home folder as `~/...` (displayPath). */
  readonly locations: Pick<InitLocations, 'home' | 'root' | 'configDir'>
}

/** Why a write is refused when its path is outside the repo and is not a private file of a confirmed role (T-02-72). */
const OUTSIDE_REASON = 'outside the repo and the role memory folders'

/**
 * The role memory folder of a private file: the folder that holds a hand-out record, or the one above the
 * instructions/ subfolder that holds a private text file; null for any other path.
 */
export function privateFolderOf(path: string): string | null {
  const textEnd = `/${PRIVATE_INSTRUCTIONS_FOLDER}/${PRIVATE_CLAUDE_MD}`
  if (path.endsWith(textEnd)) return path.slice(0, -textEnd.length)
  if (path.endsWith(`/${INSTRUCTIONS_RECORD_FILE}`)) return parentOf(path)

  return null
}

/**
 * Why the listings refuse a private write, or null (#72 A2; 02-GAPS-B3 S3): from the top, each path of the way is
 * looked up in the listing of the folder that holds it, which shows a link as a link, a dangling one included, and one
 * listed as a link refuses. A folder that gave no listing refuses as not checked when it is there or was not stat'ed,
 * `<userDir>` included, while one its stat found absent holds nothing, so the look-up stops there. `<userDir>` itself
 * is never checked for a link, as a linked config folder is common.
 */
function privateListingProblem(way: readonly string[], check: PrivateWriteCheck): string | null {
  for (const path of way) {
    const folder = parentOf(path)
    const entries = check.listings.get(folder) ?? null
    if (entries === null && check.stats.get(folder) === 'absent') return null
    if (entries === null) return LIST_FAILED_REASON
    const name = path.slice(folder.length + 1)
    if (entries.some(entry => entry.name === name && entry.isLink)) return LISTED_LINK_REASON
  }

  return null
}

/**
 * Why a write outside the repo must not happen, or null when it may (G-02-1f, T-02-72). Apply writes outside the repo
 * only a private file of a confirmed role, its private text file or its hand-out record in its role memory folder
 * (`allowed`); any other path is refused as outside the repo and the role memory folders. A private file is then
 * refused as not checked when the stat of a path on its way, from the role memory folder down, failed or was not asked
 * (fail closed); when a folder lists it or a path on its way as a link, or such a folder is there but could not be
 * listed (privateListingProblem, #72 A2), since a write through a link there would land outside the role memory
 * folders; and when it is a real folder. An absent path is fine: the mkdir run and the host make it. The path is shown
 * as displayPath shows it, `~/...` under the home folder, cleaned.
 */
export function privateWriteProblem(path: string, check: PrivateWriteCheck): string | null {
  const { home, root, configDir } = check.locations
  const refused = `refused to write ${displayPath(path, home, root, configDir)}: `
  const folder = privateFolderOf(path)
  if (folder === null || !check.allowed.has(path)) return `${refused}${OUTSIDE_REASON}`
  const way = privateWay(folder, path)
  const stats = way.map(onWay => check.stats.get(onWay) ?? 'failed')
  if (stats.includes('failed')) return `${refused}${STAT_FAILED_REASON}`
  const listed = privateListingProblem(way, check)
  if (listed !== null) return `${refused}${listed}`
  const target = stats.at(-1)
  if (typeof target === 'object' && !target.isLink && target.kind === 'dir') return `${refused}${FOLDER_REASON}`

  return null
}

/**
 * Why the levels of a role memory folder must not be written through (02-GAPS-B3 C5, S3), or null: from the top, the
 * first level that is there and is a link (by its stat or its parent's listing), is not a folder, or whose parent
 * could not be listed; an absent level ends the look, since mkdir makes it and every one below.
 */
export function privateLevelsProblem(
  levels: readonly string[],
  stats: ReadonlyMap<string, PortStat | null>,
  listings: ReadonlyMap<string, readonly PortEntry[] | null>,
): { readonly path: string; readonly reason: 'link' | 'not-folder' | 'unchecked' } | null {
  for (const path of levels) {
    const stat = stats.get(path) ?? null
    if (stat === null) return null
    const folder = parentOf(path)
    const entries = listings.get(folder) ?? null
    const name = path.slice(folder.length + 1)
    if (stat.isLink || entries?.some(entry => entry.name === name && entry.isLink) === true) {
      return { path, reason: 'link' }
    }
    if (entries === null) return { path, reason: 'unchecked' }
    if (stat.kind !== 'dir') return { path, reason: 'not-folder' }
  }

  return null
}
