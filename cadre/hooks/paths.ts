/**
 * The one home of the path rules cadre's areas share, a layer 1 module: how a path is shown and masked to the person,
 * whether a path lies inside a folder, the config-dir and user-folder rules, and the path builders and file names more
 * than one area uses. It imports only core and the types, so every area above it can import it with no cycle, and no
 * area reaches into another for a path.
 */
import type { EntryKind, InitIo, InitLocations, PortEntry, RawFacts } from '../types'
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

/** Code points a memory file name keeps; the longest name a file system allows (02-GAPS-B2 S7: one home). */
export const MAX_FILE_NAME_CHARS = 255
/** The extension of an agent file, a rule file and a memory file (02-GAPS-B2 S7: one home). */
export const MARKDOWN_EXTENSION = '.md'

/**
 * The folder name Claude Code gives a project's data under `projects/`: every character of the path that is not an
 * ASCII letter or digit becomes `-`, one for each UTF-16 unit.
 */
export function mangledProjectDir(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

/**
 * The user folder, where the user-level sources and the session history live: CLAUDE_CONFIG_DIR when it is set, else
 * `<home>/.claude`; null when there is neither. The setup scan and the history scan both take it from here, so the two
 * never disagree on it (IN-02).
 */
export function userDirOf(ctx: { readonly configDir: string | null; readonly home: string | null }): string | null {
  if (ctx.configDir !== null) return ctx.configDir

  return ctx.home === null ? null : `${ctx.home}/.claude`
}

/**
 * The names of the regular files in a listing that end in `.md` (02-GAPS-B2 S7: one home); a folder, a link or another
 * kind is not one.
 */
export function markdownFileNames(entries: readonly PortEntry[]): string[] {
  return entries
    .filter(entry => entry.kind === 'file' && !entry.isLink && entry.name.endsWith(MARKDOWN_EXTENSION))
    .map(entry => entry.name)
}

/**
 * The folder the engine keeps a project root's data in, in the user folder: `<userDir>/projects/<root mangled by
 * mangledProjectDir>`. History and memory both build on it with the user folder as given, with no trim (unlike
 * status.ts transcriptFolderOf, which trims a trailing slash).
 */
export function projectFolderOf(userDir: string, root: string): string {
  return `${userDir}/projects/${mangledProjectDir(root)}`
}

/**
 * The auto-memory folder the engine keeps for a project root in the user folder: `<userDir>/projects/<root mangled by
 * mangledProjectDir>/memory` (D-100; 02-GAPS-B2 S7: one home).
 */
export function memoryFolderOf(userDir: string, root: string): string {
  return `${projectFolderOf(userDir, root)}/memory`
}

/** The file that holds `~/.claude.json`: in CLAUDE_CONFIG_DIR when that is set [ASSUMED], else in the home folder. */
export function claudeJsonPathOf(ctx: {
  readonly configDir: string | null
  readonly home: string | null
}): string | null {
  if (ctx.configDir !== null) return `${ctx.configDir}/.claude.json`

  return ctx.home === null ? null : `${ctx.home}/.claude.json`
}

/** One path segment of a repo-relative path: letters, digits, dot, underscore, at sign and dash. */
const SAFE_SEGMENT = /^[A-Za-z0-9._@-]+$/

/**
 * Whether a path is a plain repo-relative path: segments of letters, digits, `.`, `_`, `@` and `-`, none of them `.` or
 * `..`, joined by single slashes, with no leading or trailing slash. Such a path cannot leave the folder it is joined
 * to, and a shell character, a space or a backslash cannot be in it.
 */
export function isSafeRelativePath(path: string): boolean {
  if (path === '') return false

  return path.split('/').every(segment => segment !== '.' && segment !== '..' && SAFE_SEGMENT.test(segment))
}

/**
 * The stamp `/cadre start` writes last into `.cadre/<id>/.runtime/`, after it removed the old one first. The launcher
 * refuses to start when it is missing, when the role files are newer than it (they changed after the render), or
 * when the rendered settings.json, mcp.json or probe-expectations.json is newer than it, which means a render did
 * not finish; so a half-written render never starts a session (D-102).
 */
export const RUNTIME_STAMP_FILE = 'stamp'

/** The inbox of a role in `.cadre/<id>/.runtime/`, where other roles append their notes for it (D-114). */
export const INBOX_FILE = 'inbox.md'

/**
 * An epic's kickoff of a role in `.cadre/<id>/.runtime/` (D-158): /cadre epic writes it for each role it renders into
 * the epic worktree, and the launcher starts with it in place of the role's own `.cadre/<id>/kickoff.txt`.
 */
export const RUNTIME_KICKOFF_FILE = 'kickoff.txt'

/** What `<launcher> --probe` checks the startup inventory of a role against, rendered by `/cadre start` (D-130). */
export const PROBE_EXPECTATIONS_FILE = 'probe-expectations.json'

/**
 * The name of the link in a role's `.runtime` to its private instructions folder in the user's config folder (D-140
 * q1-b), which the launcher adds with `--add-dir` and /cadre start makes on every render. A link, so it has no trailing
 * slash: git does not match a link with a folder pattern (02-GAPS-B2 M2).
 */
export const PRIVATE_INSTRUCTIONS_LINK = 'private-instructions'

/**
 * The per-user files and folders /cadre start renders into `.cadre/<id>/.runtime/` at launch: the final settings, the
 * MCP file, the skill overlay, the linked instructions, the private instructions link, the probe expectations, the
 * inbox and the stamp written last (D-66, D-84, D-102, D-114, D-130, 02-GAPS-B2 M2). The `all` git policy ignores
 * exactly these.
 */
export const RUNTIME_RENDERED: readonly string[] = Object.freeze([
  'settings.json',
  'mcp.json',
  'overlay/',
  'instructions/',
  PRIVATE_INSTRUCTIONS_LINK,
  PROBE_EXPECTATIONS_FILE,
  INBOX_FILE,
  RUNTIME_STAMP_FILE,
])

/** The repo name used in the memory slug when the common dir gives no folder name to name it after. */
const FALLBACK_REPO_NAME = 'repo'

/** The name of a git folder inside a checkout, and the end of a bare repo's folder name. */
const GIT_DIR_NAME = '.git'

/** A character a memory slug may not hold: anything but letters, digits, dot, underscore and dash, per code point. */
const UNSAFE_SLUG_CHARS = /[^A-Za-z0-9._-]/gu

/** The repo's name from its git common dir, as memorySlug says; empty when the common dir gives none. */
function repoName(gitCommonDir: string): string {
  const parts = gitCommonDir.split('/').filter(part => part !== '')
  const last = parts.at(-1) ?? ''
  if (last === GIT_DIR_NAME) return parts.at(-2) ?? ''
  if (last.endsWith(GIT_DIR_NAME)) return last.slice(0, -GIT_DIR_NAME.length)

  return last
}

/**
 * The folder name of a repo's role memory (D-91): the repo's name, then `-` and the first 8 hex characters of the hash
 * of the git common dir, so two repos with the same name do not share memory. When the common dir is a `.git` folder
 * the name is that of the folder holding it (`/w/repo/.git` is `repo`); otherwise it is the common dir's own name with
 * one trailing `.git` removed, so a bare repo `/srv/repo.git` is `repo` and a submodule's `/super/.git/modules/sub` is
 * `sub`. An empty name is `repo`. Every character outside letters, digits, `.`, `_` and `-` becomes `-`, so the slug is
 * always one safe path segment. A linked worktree has the same common dir as its main checkout, so all roles of all
 * worktrees of a repo share one memory folder (D-20).
 */
export function memorySlug(gitCommonDir: string, hashHex: string): string {
  const name = repoName(gitCommonDir)
  const base = name === '' ? FALLBACK_REPO_NAME : name

  return `${base}-${hashHex.slice(0, 8)}`.replace(UNSAFE_SLUG_CHARS, '-')
}

/**
 * The absolute memory folder of a role (D-20, D-91): `<userDir>/cadre/<slug>/<id>`, the folder the scope card names.
 * It follows CLAUDE_CONFIG_DIR as userDir does, so it is `~/.claude/cadre/...` only when that is not set. It is
 * absolute because the engine ignores a repo-relative `autoMemoryDirectory` (spike S2). The role id is a validated
 * slug, so it is safe in a path. It needs only the user folder and the git common dir with its hash, so apply names
 * the folders of the private files from the same facts as /cadre start (G-02-1f, D-140 q2-a).
 */
export function roleMemoryDir(
  user: { readonly userDir: string; readonly gitCommonDir: string; readonly commonDirHash: string },
  id: string,
): string {
  return `${user.userDir}/cadre/${memorySlug(user.gitCommonDir, user.commonDirHash)}/${id}`
}

/** The subfolder of a role memory folder that holds the role's private text file, on every load path (D-140). */
export const PRIVATE_INSTRUCTIONS_FOLDER = 'instructions'

/** The file name of a role's hand-out record, beside the memories in its role memory folder (D-140 q2-a). */
export const INSTRUCTIONS_RECORD_FILE = 'instructions.json'

/**
 * A role's private instructions folder, `<role memory folder>/instructions` (D-140 q1-b, q2-a): apply writes the
 * private text file there, the launcher adds it through `.runtime/private-instructions`, and the role's settings deny
 * writes to it (privateInstructionsDeny, 02-GAPS-B2 S3), all from this one path.
 */
export function privateInstructionsDir(
  user: { readonly userDir: string; readonly gitCommonDir: string; readonly commonDirHash: string },
  id: string,
): string {
  return `${roleMemoryDir(user, id)}/${PRIVATE_INSTRUCTIONS_FOLDER}`
}

/**
 * The absolute path with its empty and `.` segments dropped and each `..` taking off the segment before it (02-GAPS-B2
 * S7: one home; the instruction reader resolves doc links with it too).
 */
export function resolveSegments(path: string): string {
  const kept: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') kept.pop()
    else kept.push(part)
  }

  return `/${kept.join('/')}`
}

/** The display prefix of a path in the repo. */
const REPO_PREFIX = '<repo>/'

/** The display prefix of a path in the home folder. */
const HOME_PREFIX = '~/'

/** The display prefix of a path in a CLAUDE_CONFIG_DIR outside the home folder. */
const CONFIG_PREFIX = '$CLAUDE_CONFIG_DIR/'

/** A folder and a path below it, joined with one `/`. */
export function joinedPath(folder: string, rest: string): string {
  return `${trimSlash(folder)}/${rest}`
}

/**
 * The path a display form stands for (displayPath read back): `<repo>/`, `~/` and `$CLAUDE_CONFIG_DIR/` under their
 * folders; any other form is already the path. It names a chain file of the read, and regen the file of a recorded
 * global part (G-02-1f Regen).
 */
export function pathFromDisplay(
  shown: string,
  sources: { readonly root: string; readonly home: string | null; readonly configDir: string | null },
): string {
  const { root, home, configDir } = sources
  if (shown.startsWith(REPO_PREFIX)) return joinedPath(root, shown.slice(REPO_PREFIX.length))
  if (home !== null && shown.startsWith(HOME_PREFIX)) return joinedPath(home, shown.slice(HOME_PREFIX.length))
  if (configDir !== null && shown.startsWith(CONFIG_PREFIX)) {
    return joinedPath(configDir, shown.slice(CONFIG_PREFIX.length))
  }

  return shown
}

/**
 * Whether a repo-relative path is a folder whose real path lies inside the repo (isDirInsideRoot): a link anywhere in
 * the path that leads out, a file, and a folder whose real path the host could not give are not. The launcher folder
 * question checks a typed folder with it, and regen checks the folder `.cadre/cadre.json` stores.
 */
export async function isRepoFolder(io: InitIo, root: string, path: string): Promise<boolean> {
  return isDirInsideRoot(await io.stat(`${root}/${path}`), root)
}

/** The repo-relative path of the repo state (D-89), which init writes and regen, start and status read. */
export function cadreStatePath(): string {
  return '.cadre/cadre.json'
}

/** The repo-relative path of a role's role.json: what regen reads the role from, and never plans (A5). */
export function roleJsonPath(id: string): string {
  return `.cadre/${id}/role.json`
}

/** The suffix of the copy a conflict plans beside a user-edited file, so the person can diff the two (D-67). */
export const BESIDE_SUFFIX = '.cadre-new'

/** The repo-relative path of the root `.gitignore`, which holds the cadre block (D-64). */
export const GITIGNORE_FILE = '.gitignore'

/**
 * The repo-relative path of a role's launcher, `.cadre/bin/<id>`: generate writes it, and init, start and epic compare
 * or read it; a caller that needs it absolute joins the root to it.
 */
export function launcherPath(id: string): string {
  return `.cadre/bin/${id}`
}

/**
 * The repo-relative handoff folder of a role, `thoughts/shared/handoffs/<id>`, where autopilot's handoffs go, with no
 * trailing slash: a caller that lists it as a folder adds the `/`.
 */
export function handoffFolderOf(id: string): string {
  return `thoughts/shared/handoffs/${id}`
}

/** The folders above a repo-relative path, from the top: `a/b/c` gives `a` and `a/b`. */
export function foldersAbove(path: string): string[] {
  const segments = path.split('/')

  return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join('/'))
}

/** The folder that holds a path: everything before its last slash. */
export function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

/**
 * The auto-memory folders of this repo (G-02-1f Memories), as the setup scan lists them: the `memory` folder of the
 * project folder under `<user folder>/projects` (memoryFolderOf), for the root as resolved, then as given, once each;
 * none with no user folder.
 */
export function memoryFoldersOf(locations: InitLocations): string[] {
  const userDir = userDirOf(locations)
  if (userDir === null) return []

  return Array.from(new Set([locations.root, locations.givenRoot].map(root => memoryFolderOf(userDir, root))))
}
