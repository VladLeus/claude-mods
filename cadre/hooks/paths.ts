/**
 * The one home of the path rules cadre's areas share, a layer 1 module: how a path is shown and masked to the person,
 * whether a path lies inside a folder, the config-dir and user-folder rules, and the path builders and file names more
 * than one area uses. It imports only core and the types, so every area above it can import it with no cycle, and no
 * area reaches into another for a path.
 */
import type { RawFacts } from '../types'
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
