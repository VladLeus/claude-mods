/**
 * The one home of the path rules cadre's areas share, a layer 1 module: how a path is shown and masked to the person,
 * whether a path lies inside a folder, the config-dir and user-folder rules, and the path builders and file names more
 * than one area uses. It imports only core and the types, so every area above it can import it with no cycle, and no
 * area reaches into another for a path.
 */
import type { EntryKind, RawFacts } from '../types'
import { isObject } from './core/json'
import { clean } from './core/text'

/** Code points a host warning keeps, the ellipsis included. */
export const MAX_WARNING_CHARS = 240

/**
 * Replaces each occurrence of an absolute path with its display form, at path boundaries only: the match may not
 * sit inside a longer path or name (`/repo` is not in `/home/u/repo` or `/repo-other`). A trailing `/` on the path
 * is ignored, and a path too short to be one is left alone, so an empty or root-only value never rewrites the text.
 */
function maskPath(text: string, needle: string | null, replacement: string): string {
  if (needle === null) return text
  const trimmed = needle.replace(/\/+$/, '')
  if (trimmed.length < 2) return text
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return text.replace(new RegExp(`(?<![\\w.~-])${escaped}(?=$|/|[^\\w.-]|\\.(?=$|[^\\w.-]))`, 'g'), () => replacement)
}

/**
 * A host warning with the repo root, the home folder and a safe CLAUDE_CONFIG_DIR replaced by `<repo>`, `~` and
 * `$CLAUDE_CONFIG_DIR`, then cleaned and capped. A warning that is not a string becomes ''.
 */
function safeWarning(warning: unknown, raw: RawFacts, configDir: string | null): string {
  if (typeof warning !== 'string') return ''
  const withoutRoot = maskPath(warning, raw.root, '<repo>')
  const withoutHome = maskPath(withoutRoot, raw.home, '~')
  const withoutConfig = maskPath(withoutHome, safeConfigDir(configDir), '$CLAUDE_CONFIG_DIR')

  return clean(withoutConfig, MAX_WARNING_CHARS)
}

/** The host's warnings as display-safe text; a warning that cleans to nothing is dropped. */
export function safeWarnings(warnings: unknown, raw: RawFacts, configDir: string | null): string[] {
  if (!Array.isArray(warnings)) return []

  return warnings.map(warning => safeWarning(warning, raw, configDir)).filter(text => text !== '')
}

/**
 * Whether a config dir value is usable: an absolute POSIX path with no empty, `.` or `..` segment. Any other value
 * is ignored. Symlinks and case-insensitive paths cannot be resolved here, so the host must realpath the repo root,
 * the home folder and CLAUDE_CONFIG_DIR before calling.
 */
export function isSafeConfigDir(value: unknown): boolean {
  if (typeof value !== 'string' || !value.startsWith('/')) return false

  return !value.split('/').slice(1).some(segment => segment === '' || segment === '.' || segment === '..')
}

/**
 * The part of `path` below `base`: '' when they name the same folder, a string starting with `/` when `path` is
 * inside `base`, and null otherwise. A base that is null, empty or `/` is never a folder that contains a path. It is
 * exported for the instruction read (02-GAPS-B2 N10).
 */
export function relativeTo(path: string, base: string | null): string | null {
  const trimmed = (base ?? '').replace(/\/+$/, '')
  if (trimmed === '') return null
  if (path === trimmed) return ''
  if (path.startsWith(`${trimmed}/`)) return path.slice(trimmed.length)

  return null
}

/**
 * A path as the report may show it: under the repo root as `<repo>/...`, under the home folder as `~/...`, under a
 * safe CLAUDE_CONFIG_DIR as `$CLAUDE_CONFIG_DIR/...` (IN-03), and anything else as the cleaned path. The repo root is
 * checked first, so a repo inside home reads as `<repo>`, and home before the config dir, so `~/x` stays `~/x`.
 */
export function displayPath(
  path: string,
  home: string | null,
  root: string,
  configDir: string | null = null,
): string {
  const underRoot = relativeTo(path, root)
  if (underRoot !== null) return clean(`<repo>${underRoot}`)
  const underHome = relativeTo(path, home)
  if (underHome !== null) return clean(`~${underHome}`)
  const underConfig = relativeTo(path, safeConfigDir(configDir))
  if (underConfig !== null) return clean(`$CLAUDE_CONFIG_DIR${underConfig}`)

  return clean(path)
}

/** CLAUDE_CONFIG_DIR without trailing slashes when it is safe, else null. */
function safeConfigDir(configDir: string | null): string | null {
  const trimmed = trimSlash(configDir)

  return isSafeConfigDir(trimmed) ? trimmed : null
}

/** A path without its trailing slashes, so a path below it is `${trimmed}/${name}`; '' for `/`, and null stays null. */
export function trimSlash(path: string): string
export function trimSlash(path: string | null): string | null
export function trimSlash(path: string | null): string | null {
  return path === null ? null : path.replace(/\/+$/, '')
}

/** Warning when HOME is unset or not an absolute path; the home-folder check then has nothing to compare with. */
export const HOME_UNUSABLE_WARNING = 'HOME is unset or not an absolute path: the home-folder check was skipped'
/** Warning when CLAUDE_CONFIG_DIR is set but cannot be used; the value itself is never shown. */
const CONFIG_DIR_WARNING =
  'CLAUDE_CONFIG_DIR is ignored: it must be an absolute path with no .. segment, outside the repo'
/** Warning when no usable CLAUDE_CONFIG_DIR and no home folder outside the repo leave a user folder to read. */
const NO_USER_FOLDER_WARNING =
  'user-level installs were not checked: no CLAUDE_CONFIG_DIR or home folder outside the repo'

/** The paths the host reads from: the repo root, the home folder, and CLAUDE_CONFIG_DIR when it is set. */
export type ReadEnv = {
  root: string
  home: string | null
  configDir: string | null
}

/**
 * Whether a host stat answer shows a regular file whose real path lies inside the root (WR-02). register.tsx reads a
 * repo file only then, so a symlink to a file outside the repo, a device, a FIFO or a folder is never read. A stat
 * without a realPath, or one that lands on the root itself, does not count.
 */
export function isFileInsideRoot(stat: unknown, root: string): boolean {
  return isKindInsideRoot(stat, root, 'file')
}

/**
 * Whether a host stat answer shows a folder whose real path lies inside the root, by the rule isFileInsideRoot uses
 * for a file: a folder link that leaves the repo, or a stat without a realPath or on the root itself, does not count.
 * The setup scan lists a repo folder only then.
 */
export function isDirInsideRoot(stat: unknown, root: string): boolean {
  return isKindInsideRoot(stat, root, 'dir')
}

/** Whether a stat answer is of this kind and its real path lies strictly below the root. */
function isKindInsideRoot(stat: unknown, root: string, kind: EntryKind): boolean {
  if (!isObject(stat) || stat.kind !== kind) return false
  const realPath = stat.realPath
  if (typeof realPath !== 'string') return false
  const below = relativeTo(realPath, root)

  return below !== null && below !== ''
}

/** One path after the host's realpath answer: the path to use, and the warning when it was used as given. */
type ResolvedPath = { readonly path: string; readonly warning: string | null }

/**
 * One path after the host's realpath answer (D-39): where it lands when the host gave a realPath, else the path as
 * given, with a warning that it was used as given. The warning names the role of the path, never the path itself, so
 * no home path can reach the report through it. Pure: the host's answer is an argument.
 */
export function resolvedPath(given: string, realPath: string | undefined, label: string): ResolvedPath {
  if (realPath !== undefined && realPath !== '') return { path: realPath, warning: null }

  return { path: given, warning: `could not resolve ${label} (used as given)` }
}

/**
 * CLAUDE_CONFIG_DIR when it is set, safe and outside the repo; null when unset,
 * and null with a warning when unusable.
 */
function usableConfigDir(env: ReadEnv, warnings: string[]): string | null {
  const { root, configDir } = env
  if (configDir === null) return null
  if (isSafeConfigDir(configDir) && relativeTo(configDir, root) === null) return configDir
  warnings.push(CONFIG_DIR_WARNING)

  return null
}

/**
 * The user-level folder to read, or null when there is none outside the repo. A folder inside the repo is never
 * used, because a repo must not be able to host the user-level install. An unsafe home folder counts as no home.
 * Warns when CLAUDE_CONFIG_DIR is set but cannot be used, and when no user-level folder is left at all.
 */
export function userFolderOf(env: ReadEnv, warnings: string[]): string | null {
  const { root, home } = env
  const configDir = usableConfigDir(env, warnings)
  if (configDir !== null) return configDir
  const homeFolder = home !== null && home !== '' && isSafeConfigDir(home) ? `${home}/.claude` : null
  if (homeFolder !== null && relativeTo(homeFolder, root) === null) return homeFolder
  warnings.push(NO_USER_FOLDER_WARNING)

  return null
}
