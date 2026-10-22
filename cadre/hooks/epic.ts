/**
 * `/cadre epic <KEY> [title]` (D-143 to D-148, D-162 to D-164): the key and slug rules, the worktree path, the
 * `git worktree add` argv, the lookup of an epic by its key, the epic record, and the mirror of the main checkout's
 * untracked and ignored files with its excludes file as pure functions, and runEpic, the command itself, which checks
 * the repo, runs git and the mirror steps, and renders each role into the worktree with renderRole (D-157), through
 * the HostIo port only, as runStart does. An epic is a tracker epic that the PM role fetches (D-143): cadre takes the
 * key as typed and slugs it for names. The epic's worktree is `<root>/.claude/worktrees/<slug>` in the main checkout,
 * on the branch `epic/<slug>` made from the current HEAD (D-146). Tracked state such as `.planning/` comes with the
 * branch and is never linked (D-150).
 */
import type {
  CadreState,
  EpicRecord,
  HostIo,
  HostRun,
  InitIo,
  InitLocations,
  PortEntry,
  RoleSpec,
  TemplateRoleId,
  TerminalChoice,
} from '../types'
import { allOrNull, isObject, MAX_READ_BYTES, parseJsonValue, sortedUnique } from './facts'
import { shQuote } from './generate'
import { compileTeam, readTeam, regenBadRole, repoGuard } from './init'
import { stableJson } from './plan'
import { reportText } from './render'
import { standsFor } from './roles'
import { CHECKOUT_ARGV, checkoutOf } from './scan'
import {
  claudeRefusal,
  clipboardRun,
  COPIED_LINE,
  launcherCommand,
  launcherRead,
  NOT_COPIED_LINE,
  renderRole,
} from './start'

/** The folder below the main checkout's root that holds every epic worktree (D-146), as `claude --worktree` uses. */
export const WORKTREES_DIR = '.claude/worktrees'

/** The start of every epic branch name (D-146): `epic/<slug>`. */
export const EPIC_BRANCH_PREFIX = 'epic/'

/** How long `git worktree add` may run before it is given up: a big checkout with its hooks takes long (Pitfall 8). */
export const GIT_ADD_TIMEOUT_MS = 120_000

/** How long any other git run of /cadre epic may run before it is given up (Pitfall 8). */
export const GIT_TIMEOUT_MS = 30_000

/** The most characters an epic slug keeps (D-162). */
export const SLUG_MAX = 48

/**
 * An epic key once one leading `#` is dropped (D-162): 1 to 32 letters, digits, `-` and `_`, the first a letter or a
 * digit.
 */
export const EPIC_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/

/** An epic slug: runs of lowercase letters and digits joined by single dashes, so a `/` or a `..` cannot be in it. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** The template role whose role fetches the epic with the tracker MCP (D-143, D-161). */
const PM_ROLE: TemplateRoleId = 'pm'

/** The refusal when git cannot tell whether the session root is the main checkout (D-165): it fails closed. */
export const EPIC_UNKNOWN_CHECKOUT =
  'cadre epic could not tell from git whether this is the main checkout, so it stopped before creating anything.'

/**
 * The refusal in a linked worktree (D-16, D-165): /cadre epic runs only in the root session of the main checkout, which
 * the reply names, cleaned, when git gave it.
 */
export function epicNotMainReply(main: string | null): string {
  if (main === null) return 'run /cadre epic in the root session of the main checkout, not in a linked worktree.'

  return `run /cadre epic in the root session of the main checkout: ${reportText(main)}`
}

/** The refusal of a team with no PM role (D-161): the PM is the role that fetches the epic. */
export const EPIC_NO_PM =
  'cadre epic needs a PM role to fetch the epic: add one (id pm, or based on pm) with /cadre init.'

/**
 * The refusal of a team with several roles based on `pm` and none with the id `pm` (D-161): the PM fetches the epic,
 * and cadre does not pick one of them. The ids are shown cleaned.
 */
export function epicManyPmReply(ids: readonly string[]): string {
  return (
    `cadre epic needs one PM role to fetch the epic, but ${reportText(ids.join(', '))} are all based on pm ` +
    'and none has the id pm: give the PM the id pm.'
  )
}

/**
 * The PM of the team (D-161): the role with id `pm`, else the one role based on `pm`, as standsFor counts it. A team
 * with neither refuses with EPIC_NO_PM, and one with several roles based on `pm` and none with that id refuses with
 * epicManyPmReply.
 */
export function epicPmOf(
  roles: readonly Pick<RoleSpec, 'id' | 'basedOn'>[],
): { readonly kind: 'ok'; readonly id: string } | { readonly kind: 'refuse'; readonly text: string } {
  if (roles.some(role => role.id === PM_ROLE)) return { kind: 'ok', id: PM_ROLE }
  const candidates = roles.filter(role => standsFor(role, PM_ROLE))
  const [only] = candidates
  if (only === undefined) return { kind: 'refuse', text: EPIC_NO_PM }
  if (candidates.length > 1) return { kind: 'refuse', text: epicManyPmReply(candidates.map(role => role.id)) }

  return { kind: 'ok', id: only.id }
}

/**
 * The epic key a typed key gives (D-162): one leading `#` dropped, so a Redmine `#123` works, then the rest as typed
 * when it matches EPIC_KEY_PATTERN; null for anything else, so the refusal comes before anything runs.
 */
export function epicKeyOf(raw: string): string | null {
  const key = raw.startsWith('#') ? raw.slice(1) : raw

  return EPIC_KEY_PATTERN.test(key) ? key : null
}

/**
 * The slug of an epic (D-162): the key and the title words lowercased, each run of characters other than `a-z` and
 * `0-9` turned into one `-`, trimmed of `-`. Over SLUG_MAX characters it is cut to SLUG_MAX and back to its last `-`
 * (the cut text is kept when it has none), then trimmed of a trailing `-`. Null when nothing is left.
 */
export function epicSlug(key: string, title: string): string | null {
  const slug = `${key} ${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug === '') return null
  if (slug.length <= SLUG_MAX) return slug
  const cut = slug.slice(0, SLUG_MAX)
  const at = cut.lastIndexOf('-')

  return (at === -1 ? cut : cut.slice(0, at)).replace(/-+$/, '')
}

/**
 * Whether a name can be an epic worktree folder and the end of its branch name (D-147, D-162): it matches SLUG_PATTERN
 * and holds no `/` and no `..`. epicSlug always gives such a name; the check stays before any run, as D-147 refuses
 * any other name.
 */
export function isEpicSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !slug.includes('/') && !slug.includes('..')
}

/** The absolute path of the epic worktree `name` in the main checkout at `root` (D-146). */
export function worktreePathOf(root: string, name: string): string {
  return `${root}/${WORKTREES_DIR}/${name}`
}

/**
 * The `git worktree add` argv run at `root` (D-147), with no shell: a new branch, `-b <branch>` from the current HEAD,
 * or, for a branch that is kept (D-163), the worktree added on that branch without `-b`.
 */
export function worktreeAddArgv(root: string, path: string, branch: string, isNew: boolean): readonly string[] {
  if (isNew) return ['git', '-C', root, 'worktree', 'add', '-b', branch, path, 'HEAD']

  return ['git', '-C', root, 'worktree', 'add', path, branch]
}

/** The argv that lists the worktrees of the repo at `root` in git's porcelain format, main checkout first (D-163). */
export function WORKTREE_LIST_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'worktree', 'list', '--porcelain']
}

/** The argv that lists the short names of the repo's local `epic/` branches at `root`, one per line (D-163). */
export function EPIC_BRANCHES_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/epic/']
}

/**
 * The argv that names the branch checked out at `root`, the base of a new epic worktree (D-164). On a detached HEAD it
 * exits 1 with no output, and BASE_COMMIT_ARGV names the commit instead.
 */
export function BASE_BRANCH_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'symbolic-ref', '--short', '-q', 'HEAD']
}

/** The argv that names the commit checked out at `root`, the base when no branch is checked out there (D-164). */
export function BASE_COMMIT_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'rev-parse', 'HEAD']
}

/**
 * The argv that names, as an absolute path, the git dir of the worktree at `path`, where its epic record lies (D-164).
 * git may name that folder unlike the worktree's own folder, so it is always asked, never derived (RESEARCH Pattern 3).
 */
export function GIT_DIR_ARGV(path: string): readonly string[] {
  return ['git', '-C', path, 'rev-parse', '--absolute-git-dir']
}

/** One worktree of a `git worktree list --porcelain` run (D-163). */
export type WorktreeEntry = {
  /** The worktree's absolute path, as git gave it. */
  readonly path: string
  /** The short name of the local branch checked out there; null on a detached HEAD or a ref outside `refs/heads/`. */
  readonly branch: string | null
  /** Why the worktree is locked, '' for a lock with no reason; null when it is not locked. */
  readonly locked: string | null
  /** Whether it is the main checkout, which git always lists first. */
  readonly isMain: boolean
}

/** The start of the porcelain line that opens a worktree's block and gives its path. */
const WORKTREE_LINE = 'worktree '

/** The start of the porcelain line that names the local branch a worktree has checked out. */
const BRANCH_LINE = 'branch refs/heads/'

/** The porcelain line of a locked worktree; a space and the reason follow it when the lock has one. */
const LOCKED_LINE = 'locked'

/**
 * The worktrees a WORKTREE_LIST_ARGV run lists (RESEARCH Pattern 3): one per block of lines between blank lines, with
 * the path of its `worktree` line, the branch of its `branch refs/heads/` line (else null), the reason of its `locked`
 * line ('' for a bare `locked`, null with no such line), and isMain for the first block. A block with no `worktree`
 * line is left out.
 */
export function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const blocks = stdout.split('\n\n').filter(block => block.trim() !== '')

  return blocks.flatMap((block, index): WorktreeEntry[] => {
    const lines = block.split('\n')
    const worktreeLine = lines.find(line => line.startsWith(WORKTREE_LINE))
    if (worktreeLine === undefined) return []
    const branchLine = lines.find(line => line.startsWith(BRANCH_LINE))
    const lockedLine = lines.find(line => line === LOCKED_LINE || line.startsWith(`${LOCKED_LINE} `))

    return [
      {
        path: worktreeLine.slice(WORKTREE_LINE.length),
        branch: branchLine === undefined ? null : branchLine.slice(BRANCH_LINE.length),
        // A bare `locked` line slices to '': a lock with no reason.
        locked: lockedLine === undefined ? null : lockedLine.slice(LOCKED_LINE.length + 1),
        isMain: index === 0,
      },
    ]
  })
}

/**
 * Whether a branch is one of the epic whose key slugs to `keySlug` (D-163): `epic/<keySlug>` itself, or a name that
 * starts with `epic/<keySlug>-`, so the key finds its epic whatever title it was made with, and `epic/proj-10` is never
 * the epic of PROJ-1.
 */
export function isEpicBranchOf(branch: string, keySlug: string): boolean {
  const exact = `${EPIC_BRANCH_PREFIX}${keySlug}`

  return branch === exact || branch.startsWith(`${exact}-`)
}

/** The refusal when git cannot list the worktrees or the epic branches (D-163): it fails closed, before any add. */
export const EPIC_NO_WORKTREE_LIST =
  'cadre epic could not list the worktrees and epic branches from git, so it stopped before creating anything.'

/**
 * The refusal of a key with more than one worktree on its epic branches (D-163): cadre reuses one and does not pick
 * it, so the reply names them all, cleaned.
 */
export function epicManyWorktreesReply(paths: readonly string[]): string {
  return (
    'cadre epic reuses one worktree per key, but this key has more than one, so it stopped: ' +
    reportText(paths.join(', '))
  )
}

/**
 * The refusal of a key with no worktree and more than one kept epic branch (D-163): cadre adds the worktree back on one
 * and does not pick it, so the reply names them all, cleaned.
 */
export function epicManyBranchesReply(branches: readonly string[]): string {
  return (
    'cadre epic adds a worktree back on one kept branch per key, but this key has more than one and no worktree, ' +
    `so it stopped: ${reportText(branches.join(', '))}`
  )
}

/**
 * How /cadre epic comes by the worktree of the key that slugs to `keySlug` (D-163), by the key and never by the title:
 * the one registered worktree on an epic branch of the key (isEpicBranchOf) is reused; with no such worktree, the one
 * kept epic branch of the key gets a worktree added back on it, named for the branch without `epic/`; with neither,
 * the worktree is new. The main checkout is never the epic's worktree, whatever branch it has. More than one such
 * worktree, or no worktree and more than one such branch, refuses and names them.
 */
export function epicLookup(input: {
  readonly worktrees: readonly WorktreeEntry[]
  readonly branches: readonly string[]
  readonly keySlug: string
}):
  | { readonly kind: 'reuse'; readonly path: string; readonly branch: string }
  | { readonly kind: 'readd'; readonly branch: string; readonly name: string }
  | { readonly kind: 'new' }
  | { readonly kind: 'refuse'; readonly text: string } {
  const found = input.worktrees.flatMap(entry =>
    !entry.isMain && entry.branch !== null && isEpicBranchOf(entry.branch, input.keySlug)
      ? [{ path: entry.path, branch: entry.branch }]
      : [],
  )
  if (found.length > 1) return { kind: 'refuse', text: epicManyWorktreesReply(found.map(entry => entry.path)) }
  const [worktree] = found
  if (worktree !== undefined) return { kind: 'reuse', path: worktree.path, branch: worktree.branch }
  const kept = input.branches.filter(branch => isEpicBranchOf(branch, input.keySlug))
  if (kept.length > 1) return { kind: 'refuse', text: epicManyBranchesReply(kept) }
  const [only] = kept
  if (only === undefined) return { kind: 'new' }

  return { kind: 'readd', branch: only, name: only.slice(EPIC_BRANCH_PREFIX.length) }
}

/** The file name of the epic record in its worktree's git dir (D-164): per worktree, outside the tree, never shared. */
export const EPIC_RECORD_FILE = 'cadre-epic.json'

/**
 * Whether a recorded link or copy path is safe to act on inside the worktree (D-164, T-03.1-03): relative, so not
 * starting with `/`, and with no empty, `.` or `..` segment, so a later removal of it cannot leave the worktree.
 */
export function isSafeRelPath(path: string): boolean {
  if (path.startsWith('/')) return false

  return path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

/** Where the epic record of the worktree whose git dir is `gitDir` lies (D-164): beside that worktree's git files. */
export function epicRecordPath(gitDir: string): string {
  return `${gitDir}/${EPIC_RECORD_FILE}`
}

/** The text of an epic record as cadre writes it (D-164): stable JSON, so one record always gives the same text. */
export function epicRecordText(record: EpicRecord): string {
  return stableJson(record)
}

/**
 * An epic record read back (D-164, T-03.1-03), as epicRecordText writes it: JSON with schema 1, a key, slug, title and
 * branch that are strings, the branch `epic/<slug>`, a base that is a string or null, a number createdAt, and links and
 * copies that are lists of paths isSafeRelPath accepts. Anything else gives null (fail closed); a field the record does
 * not name is dropped.
 */
export function parseEpicRecord(text: string): EpicRecord | null {
  const value = parseJsonValue(text)?.value
  if (!isObject(value) || value.schema !== 1) return null
  const { key, slug, title, branch, base, createdAt, links, copies } = value
  if (typeof key !== 'string' || typeof slug !== 'string' || typeof title !== 'string') return null
  if (typeof branch !== 'string' || branch !== `${EPIC_BRANCH_PREFIX}${slug}`) return null
  if (base !== null && typeof base !== 'string') return null
  if (typeof createdAt !== 'number' || !Array.isArray(links) || !Array.isArray(copies)) return null
  const safePath = (path: unknown): string | null => (typeof path === 'string' && isSafeRelPath(path) ? path : null)
  const linked = allOrNull(links, safePath)
  const copied = allOrNull(copies, safePath)
  if (linked === null || copied === null) return null

  return { schema: 1, key, slug, title, branch, base, createdAt, links: linked, copies: copied }
}

/**
 * The argv that lists what git does not track and does not ignore in the main checkout at `root` (D-147, RESEARCH
 * Pattern 3): with `-z`, so each name comes raw and NUL-ended, never octal-quoted, and with `--directory`, so a folder
 * git does not track at all is one entry.
 */
export function LS_OTHERS_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'ls-files', '-z', '--others', '--directory', '--exclude-standard']
}

/** The argv that lists what git ignores in the main checkout at `root` (D-147), NUL-ended as LS_OTHERS_ARGV lists. */
export function LS_IGNORED_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'ls-files', '-z', '--others', '--ignored', '--directory', '--exclude-standard']
}

/**
 * The entries of the main checkout that the epic worktree mirrors (D-147): the NUL-ended names of the LS_OTHERS_ARGV
 * and LS_IGNORED_ARGV runs, each without the trailing `/` git gives a folder, once each and sorted (sortedUnique). An
 * empty name is dropped.
 */
export function untrackedEntries(others: string, ignored: string): string[] {
  const names = [...others.split('\0'), ...ignored.split('\0')]

  return sortedUnique(names.map(name => (name.endsWith('/') ? name.slice(0, -1) : name)).filter(name => name !== ''))
}

/** The file in the worktree's git dir that hides cadre's links from git (D-147), beside the epic record. */
export const EXCLUDES_FILE = 'cadre-links.exclude'

/**
 * The excludes line that hides each role's own `.runtime/` in the worktree (AUTO-PICK #25, RESEARCH Pitfall 5): the
 * mirror makes `.cadre/<id>/` a real folder there, so the files a render writes into it would show as untracked.
 */
export const RUNTIME_EXCLUDE_LINE = '/.cadre/*/.runtime/'

/** The line that starts cadre's own lines in the excludes file. */
const EXCLUDES_HEADING = '# cadre links (cadre epic)'

/**
 * The excludes line of a link (03.1-W2 S2): `/` then the path with gitignore's special characters `\`, `*`, `?` and
 * `[` escaped by a backslash, and each trailing space written `\ `, so the line matches the link's own name and
 * nothing else.
 */
function excludesLine(path: string): string {
  const escaped = path.replace(/[\\*?[]/g, char => `\\${char}`).replace(/ +$/, spaces => spaces.replace(/ /g, '\\ '))

  return `/${escaped}`
}

/**
 * The text of the worktree's excludes file (D-147): the user's global excludes text, ended with a newline when it is
 * not empty and has none, then EXCLUDES_HEADING, one excludesLine per link, sorted and once each, and
 * RUNTIME_EXCLUDE_LINE last. The leading `/` matches the link at the worktree root only; a copy gets no line, as main
 * ignores it already (D-172).
 */
export function excludesText(globalText: string, links: readonly string[]): string {
  const head = globalText === '' || globalText.endsWith('\n') ? globalText : `${globalText}\n`
  const lines = [EXCLUDES_HEADING, ...sortedUnique(links).map(excludesLine), RUNTIME_EXCLUDE_LINE]

  return `${head}${lines.join('\n')}\n`
}

/**
 * The argv that names the user's global excludes file (D-147): git's `core.excludesFile` as a path, with `~` expanded;
 * it exits 1 with no output when the key is not set. The global config is the same everywhere, so `-C <root>` only
 * keeps the argv apart from the others. `--includes` follows the global file's include and includeIf, which a given
 * scope otherwise skips, so a key set in an included file is found (03.1-W2 S1).
 */
export function GLOBAL_EXCLUDES_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'config', '--includes', '--global', '--path', 'core.excludesFile']
}

/**
 * The argv that prints XDG_CONFIG_HOME, below which git finds its default global excludes file (D-147, RESEARCH
 * Alternatives Considered); it exits 1 when the variable is not set. It is a run, so the host's env reader keeps its
 * own few names (HostEnvName).
 */
export const XDG_ARGV: readonly string[] = Object.freeze(['/usr/bin/printenv', 'XDG_CONFIG_HOME'])

/** The trimmed first line of a run that exited 0, when it is an absolute path; null for anything else. */
function absoluteOutput(run: HostRun | null): string | null {
  if (run === null || run.exitCode !== 0) return null
  const line = (run.stdout.split('\n')[0] ?? '').trim()

  return line.startsWith('/') ? line : null
}

/**
 * The path of the user's global excludes file, as git finds it (D-147): what the GLOBAL_EXCLUDES_ARGV run names, else
 * `<XDG_CONFIG_HOME>/git/ignore` from the XDG_ARGV run, else `<home>/.config/git/ignore`; null with no home. A run's
 * output counts only when it exited 0 and its trimmed first line is an absolute path.
 */
export function globalExcludesPath(config: HostRun | null, xdg: HostRun | null, home: string | null): string | null {
  const configured = absoluteOutput(config)
  if (configured !== null) return configured
  const xdgHome = absoluteOutput(xdg)
  if (xdgHome !== null) return `${xdgHome}/git/ignore`
  if (home === null) return null

  return `${home}/.config/git/ignore`
}

/** The argv that gives each worktree of the repo at `root` a config of its own (D-147); it sets the shared config. */
export function WORKTREE_CONFIG_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'config', 'extensions.worktreeConfig', 'true']
}

/** The argv that makes `file` the excludes file of the worktree at `path`, in that worktree's own config (D-147). */
export function EXCLUDES_CONFIG_ARGV(path: string, file: string): readonly string[] {
  return ['git', '-C', path, 'config', '--worktree', 'core.excludesFile', file]
}

/**
 * One step of the mirror into the epic worktree (D-147, D-148, D-172), in the order runEpic runs it; every path is
 * absolute:
 * - `mkdir`: make a real folder in the worktree, and the folders above it;
 * - `link`: make `path` a symbolic link to `target` in the main checkout, never over something that is there;
 * - `copy`: copy the regular file `source` of the main checkout to `path`, keeping its mode and times.
 */
export type EpicStep =
  | { readonly kind: 'mkdir'; readonly path: string }
  | { readonly kind: 'link'; readonly path: string; readonly target: string }
  | { readonly kind: 'copy'; readonly path: string; readonly source: string }

/** How long one mirror step (a folder, a link or a copy) may run before it is given up (Pitfall 8). */
export const MIRROR_STEP_TIMEOUT_MS = 10_000

/**
 * The argv that runs a mirror step, absolute and with no shell, `--` before the paths (D-147, T-03.1-06): `/bin/mkdir
 * -p --` for a folder; `/bin/ln -s --` for a link, with no `-f`, so it never replaces what is there; `/bin/cp -p --`
 * for a copy.
 */
export function epicStepArgv(step: EpicStep): readonly string[] {
  if (step.kind === 'mkdir') return ['/bin/mkdir', '-p', '--', step.path]
  if (step.kind === 'link') return ['/bin/ln', '-s', '--', step.target, step.path]

  return ['/bin/cp', '-p', '--', step.source, step.path]
}

/** The folder of cadre's own files, which the worktree gets as a real folder and never as one link (D-156). */
const CADRE_DIR = '.cadre'

/** The folder whose children the mirror links one by one, all but `worktrees` (D-147). */
const CLAUDE_DIR = '.claude'

/** The child of CLAUDE_DIR that holds the epic worktrees, never linked (D-147). */
const CLAUDE_WORKTREES_CHILD = 'worktrees'

/** The start of the last segment of a file the mirror copies instead of linking (D-148, D-172). */
const ENV_PREFIX = '.env'

/** A C0 control character or DEL: no gitignore line can hold a name with one (03.1-W2 S2). */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

/**
 * The folders the mirror makes real in the worktree and never links whole (D-156): `.cadre`, `.cadre/bin` and
 * `.cadre/<id>` for each role id. A launcher in a real `.cadre/bin/` finds the worktree as its root, and a render
 * writes the worktree's own `.cadre/<id>/.runtime/`, never main's.
 */
function protectedFolders(roleIds: readonly string[]): string[] {
  return [CADRE_DIR, `${CADRE_DIR}/bin`, ...roleIds.map(id => `${CADRE_DIR}/${id}`)]
}

/** The folders above a repo-relative path, from the top: `a/b/c` gives `a` and `a/b`. */
function foldersAbove(path: string): string[] {
  const segments = path.split('/')

  return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join('/'))
}

/** The repo-relative folder a path lies in, '' for the root. */
function parentOf(path: string): string {
  const at = path.lastIndexOf('/')

  return at === -1 ? '' : path.slice(0, at)
}

/** Whether a repo-relative path is `folder` itself or lies below it. */
function isAtOrUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`)
}

/** What the listing of its folder in `listings` shows for a repo-relative path; undefined when it shows nothing. */
function listedEntry(listings: ReadonlyMap<string, readonly PortEntry[]>, path: string): PortEntry | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1)

  return listings.get(parentOf(path))?.find(entry => entry.name === name)
}

/**
 * The folders runEpic lists for mirrorPlan (D-147), repo-relative and '' for the root, each list sorted and once each:
 * every folder the rules read. In the main checkout (`main`): the protected folders (`.cadre`, `.cadre/bin` and
 * `.cadre/<id>` for each role id) and `.claude`, whose children the mirror walks, and the folder of each entry, which
 * shows whether it is a file. In the worktree (`tree`): the root, `.claude`, each protected folder and the folders
 * above it, and the folders above each entry, which show what the worktree holds already and which of its folders
 * are links.
 */
export function mirrorPaths(
  entries: readonly string[],
  roleIds: readonly string[],
): { readonly main: readonly string[]; readonly tree: readonly string[] } {
  const kept = protectedFolders(roleIds)
  const main = sortedUnique([...kept, CLAUDE_DIR, ...entries.map(parentOf)])
  const above = [...kept.flatMap(folder => [...foldersAbove(folder), folder]), ...entries.flatMap(foldersAbove)]

  return { main, tree: sortedUnique(['', CLAUDE_DIR, ...above]) }
}

/**
 * The mirror of the main checkout into the epic worktree (D-147, D-148, D-149, D-156, D-172). `main` and `tree` hold
 * the listing of each repo-relative folder ('' for the root) in the main checkout and in the worktree, as mirrorPaths
 * names them; a folder with no listing counts as empty, and a target the worktree lists, a dangling link included, is
 * there. The entries are taken sorted, and each, then each child it hands on, gets the first rule that fits:
 * - (a) `.claude/worktrees` and anything below it: nothing;
 * - (b) anything at or below `.cadre/<id>/.runtime` for a role id: nothing, as each worktree renders its own;
 * - (c) a path already planned or already in the worktree's listing, or below either: nothing, so no step lands in the
 *   main checkout and a reuse plans no more than the first run did;
 * - (d) a path below a folder the worktree lists as a link (a tracked link in HEAD): nothing, and the
 *   mirrorLinkedParentWarning line;
 * - (e) a protected folder (`.cadre`, `.cadre/bin`, `.cadre/<id>`) or a folder above one: a mkdir step, then each
 *   child of its main listing, by these same rules;
 * - (f) `.claude`: each child of its main listing but `worktrees`, by these same rules;
 * - (g) a path whose name holds a control character, a line break included: nothing, nothing below it, and the
 *   mirrorUnhideableWarning line, as no excludes line can hide it (03.1-W2 S2);
 * - (h) a file whose last segment starts with `.env`, as the main listing of its folder shows (a regular file, not a
 *   link): a copy step, unless the worktree lists its target;
 * - (i) anything else: a link step to the main checkout's path, unless the worktree lists its target.
 * A link or copy below a folder the worktree does not list gets a mkdir step for each such folder from the top first,
 * once each. The result holds the steps in order (absolute paths), the repo-relative paths linked and copied, and the
 * warnings.
 */
export function mirrorPlan(input: {
  readonly root: string
  readonly worktree: string
  readonly entries: readonly string[]
  readonly roleIds: readonly string[]
  readonly main: ReadonlyMap<string, readonly PortEntry[]>
  readonly tree: ReadonlyMap<string, readonly PortEntry[]>
}): {
  readonly steps: readonly EpicStep[]
  readonly links: readonly string[]
  readonly copies: readonly string[]
  readonly warnings: readonly string[]
} {
  const { root, worktree, main, tree } = input
  const kept = protectedFolders(input.roleIds)
  const runtimes = input.roleIds.map(id => `${CADRE_DIR}/${id}/.runtime`)
  const steps: EpicStep[] = []
  const links: string[] = []
  const copies: string[] = []
  const warnings: string[] = []
  const made = new Set<string>()
  const placed = new Set<string>()
  const mkdir = (folder: string) => {
    steps.push({ kind: 'mkdir', path: `${worktree}/${folder}` })
    made.add(folder)
  }
  const childrenOf = (folder: string) => sortedUnique((main.get(folder) ?? []).map(entry => entry.name))

  const visit = (path: string): void => {
    if (isAtOrUnder(path, WORKTREES_DIR)) return
    if (runtimes.some(runtime => isAtOrUnder(path, runtime))) return
    const above = foldersAbove(path)
    if (made.has(path) || placed.has(path) || above.some(folder => placed.has(folder))) return
    if (above.some(folder => listedEntry(tree, folder)?.isLink === true)) {
      warnings.push(mirrorLinkedParentWarning(path))
      return
    }
    const missing = above.filter(folder => !made.has(folder) && listedEntry(tree, folder) === undefined)
    if (kept.some(folder => isAtOrUnder(folder, path))) {
      for (const folder of [...missing, path]) mkdir(folder)
      for (const child of childrenOf(path)) visit(`${path}/${child}`)
      return
    }
    if (path === CLAUDE_DIR) {
      for (const child of childrenOf(path).filter(name => name !== CLAUDE_WORKTREES_CHILD)) visit(`${path}/${child}`)
      return
    }
    if (listedEntry(tree, path) !== undefined) {
      // A target that is there is placed, so nothing below it is mirrored, as below a planned link
      // (rule c, 03.1-W2 S3).
      placed.add(path)
      return
    }
    if (CONTROL_CHARACTER.test(path)) {
      placed.add(path)
      warnings.push(mirrorUnhideableWarning(path))
      return
    }
    for (const folder of missing) mkdir(folder)
    placed.add(path)
    const shown = listedEntry(main, path)
    const isEnvFile = path.slice(path.lastIndexOf('/') + 1).startsWith(ENV_PREFIX)
    if (isEnvFile && shown !== undefined && shown.kind === 'file' && !shown.isLink) {
      steps.push({ kind: 'copy', path: `${worktree}/${path}`, source: `${root}/${path}` })
      copies.push(path)
      return
    }
    steps.push({ kind: 'link', path: `${worktree}/${path}`, target: `${root}/${path}` })
    links.push(path)
  }
  for (const entry of sortedUnique(input.entries)) visit(entry)

  return { steps, links, copies, warnings }
}

/** The refusal of a typed key that is not an epic key (D-162): the key as typed, cleaned, and what a key may hold. */
export function epicBadKeyReply(raw: string): string {
  return (
    `${reportText(raw)} is not an epic key: a key is 1-32 letters, digits, - or _, starting with a letter or ` +
    'a digit (one leading # is dropped, so #123 works).'
  )
}

/** The refusal of a worktree name that isEpicSlug refuses (D-147), shown cleaned: nothing is created. */
export function epicBadNameReply(name: string): string {
  return (
    `${reportText(name)} cannot name an epic worktree (lowercase letters and digits with single - between them), ` +
    'so cadre epic stopped.'
  )
}

/**
 * The reply when `git worktree add` fails or cannot run (RESEARCH Pitfall 3), naming the branch cleaned. With `-b`,
 * git may have made the new branch before it failed: the reply says the branch may now exist and is kept, since cadre
 * never deletes a branch.
 */
export function epicAddFailedReply(branch: string, isNew: boolean): string {
  const name = reportText(branch)
  if (!isNew) return `git could not add the epic worktree on the kept branch ${name}, so cadre epic stopped.`

  return (
    `git could not add the epic worktree, so cadre epic stopped. The branch ${name} may now exist: ` +
    'cadre keeps it, and the next /cadre epic run adds the worktree on it.'
  )
}

/**
 * The refusal when the worktree path already exists and git does not list a worktree of the key there (D-147, D-163):
 * cadre adds no worktree over it. The path is shown cleaned.
 */
export function epicPathExistsReply(path: string): string {
  return (
    'the epic worktree path already exists and git lists no worktree of this key there, so cadre epic stopped ' +
    `before adding it: ${reportText(path)}`
  )
}

/**
 * The warning line when the new worktree got no epic record (D-164): the write of the record to the worktree's git dir
 * failed. The worktree stays and the run goes on; the key is shown cleaned.
 */
export function epicNoRecordWarning(key: string): string {
  return `cadre could not write ${EPIC_RECORD_FILE} for the epic ${reportText(key)}: the write failed.`
}

/**
 * The warning line for an entry the mirror leaves out because a folder above it in the worktree is a link (D-147,
 * T-03.1-05): a step there would land in the link's target. The repo-relative path is shown cleaned.
 */
export function mirrorLinkedParentWarning(path: string): string {
  return (
    `cadre epic left ${reportText(path)} out of the worktree: a folder above it there is a link, and cadre never ` +
    'links or copies through a link.'
  )
}

/**
 * The warning line for an entry the mirror leaves out because its name holds a control character, a line break
 * included (03.1-W2 S2): no excludes line can hide a link to it from git, so it gets no step. The repo-relative path
 * is shown cleaned.
 */
export function mirrorUnhideableWarning(path: string): string {
  return (
    `cadre epic left ${reportText(path)} out of the worktree: its name holds a line break or another control ` +
    'character, so no excludes line could hide it from git.'
  )
}

/**
 * The warning line when the user's global excludes file cannot be read or is over the read cap (D-147): the worktree's
 * own excludes file, which git reads in its place there, starts without its patterns. The path is shown cleaned.
 */
export function globalExcludesWarning(path: string): string {
  return (
    `cadre epic could not read your global git excludes file ${reportText(path)}, so the worktree's excludes file ` +
    'leaves its patterns out: a file only it ignores may show as untracked in the worktree.'
  )
}

/**
 * The reply when git cannot list what the main checkout does not track or ignores (D-147): nothing is linked or copied.
 * The worktree stays, and the reply says to run /cadre epic with the key, cleaned, again.
 */
export function epicListFailedReply(key: string): string {
  return (
    'git could not list the untracked and ignored files of the main checkout, so cadre epic linked and copied ' +
    `nothing into the worktree. The worktree stays: run /cadre epic ${reportText(key)} again.`
  )
}

/**
 * The reply when the excludes file that hides the links from git cannot be set up (D-147): git named no git dir for the
 * worktree, the file could not be written, or a `git config` of it failed. It comes before any step, so no link was
 * made; the worktree stays, and the reply says to run /cadre epic with the key, cleaned, again.
 */
export function epicExcludesFailedReply(key: string): string {
  return (
    'cadre epic could not set up the excludes file that hides its links from git, so it made no links. ' +
    `The worktree stays: run /cadre epic ${reportText(key)} again.`
  )
}

/**
 * The reply when a mirror step fails (D-147): the mirror stops at that step, named by its path below the worktree
 * root, cleaned. What ran before it stays and is recorded, and the next /cadre epic run of the key makes the rest.
 */
export function epicStepFailedReply(path: string): string {
  return (
    `cadre epic could not make ${reportText(path)} in the worktree (a folder, link or copy), so it stopped there. ` +
    'The worktree stays: fix it and run /cadre epic with the same key again.'
  )
}

/** The line that says how the epic came by its worktree: made on a new branch, reused, or added back on a kept one. */
function outcomeLine(outcome: 'created' | 'reused' | 're-added', path: string, branch: string): string {
  if (outcome === 'created') return `Created the worktree ${path} on the new branch ${branch}.`
  if (outcome === 'reused') return `Reused the worktree ${path} on the branch ${branch}.`

  return `Added the worktree ${path} back on the kept branch ${branch}.`
}

/**
 * The reply of /cadre epic once the epic has its worktree (D-145): `cadre epic <KEY>`, a `Title: ` line when there is a
 * title, the line of outcomeLine with the worktree path and its branch, the line `Linked <n>, copied <m>.` with what
 * this run linked and copied into it (D-147), then one `warning: ` line per warning. The key, title, path and branch
 * are shown cleaned.
 */
export function epicCreatedText(input: {
  readonly key: string
  readonly title: string
  readonly path: string
  readonly branch: string
  readonly outcome: 'created' | 'reused' | 're-added'
  readonly linked: number
  readonly copied: number
  readonly warnings: readonly string[]
}): string {
  return [
    `cadre epic ${reportText(input.key)}`,
    ...(input.title === '' ? [] : [`Title: ${reportText(input.title)}`]),
    outcomeLine(input.outcome, reportText(input.path), reportText(input.branch)),
    `Linked ${input.linked}, copied ${input.copied}.`,
    ...input.warnings.map(warning => `warning: ${warning}`),
  ].join('\n')
}

/** What the mirror stage of runEpic did: the reply it stopped with (else null), what it made, and its warnings. */
type Mirrored = {
  readonly failure: string | null
  /** The repo-relative paths of the links whose step ran. */
  readonly links: readonly string[]
  /** The repo-relative paths of the copies whose step ran. */
  readonly copies: readonly string[]
  readonly warnings: readonly string[]
}

/** The listing of each folder `rels` names below `base` ('' for `base` itself); a folder it cannot list is left out. */
async function listingsOf(
  io: InitIo,
  base: string,
  rels: readonly string[],
): Promise<Map<string, readonly PortEntry[]>> {
  const listings = new Map<string, readonly PortEntry[]>()
  for (const rel of rels) {
    const listing = await io.list(rel === '' ? base : `${base}/${rel}`)
    if (listing !== null) listings.set(rel, listing)
  }

  return listings
}

/**
 * The text of the user's global excludes file for the head of the worktree's excludes file (D-147): its path from
 * globalExcludesPath over the GLOBAL_EXCLUDES_ARGV and XDG_ARGV runs and `home`, then its text read through the port,
 * capped at MAX_READ_BYTES. No path, or no file there, gives ''; a file that cannot be read or is over the cap gives ''
 * and the globalExcludesWarning line.
 */
async function globalExcludesOf(
  io: InitIo,
  host: HostIo,
  root: string,
  home: string | null,
): Promise<{ readonly text: string; readonly warnings: readonly string[] }> {
  const config = await host.run(GLOBAL_EXCLUDES_ARGV(root), { timeoutMs: GIT_TIMEOUT_MS })
  const xdg = await host.run(XDG_ARGV, { timeoutMs: GIT_TIMEOUT_MS })
  const path = globalExcludesPath(config, xdg, home)
  if (path === null) return { text: '', warnings: [] }
  const read = await io.read(path, MAX_READ_BYTES)
  if (read.state === 'text') return { text: read.text, warnings: [] }
  if (read.state === 'absent') return { text: '', warnings: [] }

  return { text: '', warnings: [globalExcludesWarning(path)] }
}

/**
 * The mirror of the main checkout at `root` into the worktree (D-147, D-148), whose git dir `gitDir` is absolute: the
 * two ls-files runs (a run that fails or cannot start stops it with epicListFailedReply), the folders mirrorPaths
 * names listed in both checkouts, and mirrorPlan. The excludes file is then written in the git dir: the user's global
 * excludes text (globalExcludesOf), then the links `recorded` holds and the plan's own, once each (D-163). The worktree
 * is pointed at it with WORKTREE_CONFIG_ARGV, then EXCLUDES_CONFIG_ARGV, on every run, as both are idempotent: a write
 * or run that fails stops it with epicExcludesFailedReply, before any step. Each step then runs with its epicStepArgv,
 * and the first one that fails stops it with epicStepFailedReply. What ran before the stop is in the result.
 */
async function mirrorSteps(
  io: InitIo,
  host: HostIo,
  input: {
    readonly root: string
    readonly home: string | null
    readonly worktree: string
    readonly gitDir: string
    readonly key: string
    readonly roleIds: readonly string[]
    readonly recorded: readonly string[]
  },
): Promise<Mirrored> {
  const { root, worktree, key } = input
  const listFailed: Mirrored = { failure: epicListFailedReply(key), links: [], copies: [], warnings: [] }
  const others = await host.run(LS_OTHERS_ARGV(root), { timeoutMs: GIT_TIMEOUT_MS })
  if (others === null || others.exitCode !== 0) return listFailed
  const ignored = await host.run(LS_IGNORED_ARGV(root), { timeoutMs: GIT_TIMEOUT_MS })
  if (ignored === null || ignored.exitCode !== 0) return listFailed
  const entries = untrackedEntries(others.stdout, ignored.stdout)
  const paths = mirrorPaths(entries, input.roleIds)
  const main = await listingsOf(io, root, paths.main)
  const tree = await listingsOf(io, worktree, paths.tree)
  const plan = mirrorPlan({ root, worktree, entries, roleIds: input.roleIds, main, tree })
  const global = await globalExcludesOf(io, host, root, input.home)
  const warnings = [...plan.warnings, ...global.warnings]

  const file = `${input.gitDir}/${EXCLUDES_FILE}`
  const excludesFailed: Mirrored = { failure: epicExcludesFailedReply(key), links: [], copies: [], warnings }
  const hidden = sortedUnique([...input.recorded, ...plan.links])
  if (!(await host.write(file, excludesText(global.text, hidden)))) return excludesFailed
  for (const argv of [WORKTREE_CONFIG_ARGV(root), EXCLUDES_CONFIG_ARGV(worktree, file)]) {
    const configured = await host.run(argv, { timeoutMs: GIT_TIMEOUT_MS })
    if (configured === null || configured.exitCode !== 0) return excludesFailed
  }

  const ran: EpicStep[] = []
  const made = (kind: EpicStep['kind']) =>
    ran.filter(step => step.kind === kind).map(step => step.path.slice(worktree.length + 1))
  for (const step of plan.steps) {
    const done = await host.run(epicStepArgv(step), { timeoutMs: MIRROR_STEP_TIMEOUT_MS })
    if (done === null || done.exitCode !== 0) {
      const failure = epicStepFailedReply(step.path.slice(worktree.length + 1))

      return { failure, links: made('link'), copies: made('copy'), warnings }
    }
    ran.push(step)
  }

  return { failure: null, links: made('link'), copies: made('copy'), warnings }
}

/** The epic worktree as runEpic hands it to its mirror stage once git has made or found it (D-147, D-164). */
type EpicWorktree = {
  readonly path: string
  readonly branch: string
  readonly outcome: 'created' | 'reused' | 're-added'
  /** The title the reply shows. */
  readonly title: string
  /** The worktree's git dir as git named it; anything but an absolute path means git named none. */
  readonly gitDir: string
  /** The record to write once the mirror ran: the one on disk, or a new one with what this run can name. */
  readonly record: EpicRecord
}

/**
 * The render stage of runEpic (D-157, D-102, RESEARCH Pattern 1), once the mirror ran every step: the team, read in the
 * main checkout, is compiled there once (compileTeam), and each role, in cadre.json order, is rendered for the worktree
 * by renderRole with the worktree as its root (`{ ...main, root: worktree, givenRoot: worktree }`), so every
 * `.runtime/` it writes is the worktree's own, never main's. The render names the main checkout as the epic's, so the
 * role keeps the worktree's CLAUDE.md files out and gets main's code-dir denies too (Pitfalls 1 and 2), and it looks a
 * server up in the `~/.claude.json` project of the worktree, then of the main root as resolved and as given, where the
 * user's project servers are recorded. Its lines: one `warning: <id>: <text>` line per render warning, then one line
 * per role, two spaces in: `<id>: ` and the role's command `cd -- <worktree> && <launcher>` (launcherCommand rooted at
 * the worktree, D-167), or the render's refusal for that role, which does not stop the others. When any role
 * rendered, the commands are copied through the host with clipboardRun, one per line, and COPIED_LINE or
 * NOT_COPIED_LINE ends the lines. It never runs a launcher and never starts a background session (D-108, D-167).
 */
async function renderedLines(
  io: InitIo,
  host: HostIo,
  team: { readonly locations: InitLocations; readonly state: CadreState; readonly roles: readonly RoleSpec[] },
  worktree: string,
): Promise<string[]> {
  const { locations, state, roles } = team
  const { gathered, scopes } = await compileTeam(io, locations, state, roles)
  const worktreeLocations: InitLocations = { ...locations, root: worktree, givenRoot: worktree }
  const warnings: string[] = []
  const roleLines: string[] = []
  const commands: string[] = []
  for (const role of roles) {
    const { id } = role
    const scope = scopes.get(id)
    // Fail closed: readTeam read every listed role and compileTeam compiled each one, so it is always there.
    if (scope === undefined) {
      roleLines.push(`  ${id}: ${regenBadRole(id)}`)
      continue
    }
    const render = await renderRole(io, host, {
      locations: worktreeLocations,
      state,
      role,
      scope,
      codeDirs: gathered.repo.codeDirs,
      mcpRoots: [worktree, locations.root, locations.givenRoot],
      epic: { mainRoot: locations.root },
    })
    if (render.kind === 'refuse') {
      roleLines.push(`  ${id}: ${render.text}`)
      continue
    }
    const command = `cd -- ${shQuote(worktree)} && ${launcherCommand(worktree, id)}`
    warnings.push(...render.warnings.map(warning => `warning: ${id}: ${warning}`))
    roleLines.push(`  ${id}: ${command}`)
    commands.push(command)
  }
  if (commands.length === 0) return [...warnings, ...roleLines]
  const copy = clipboardRun(commands.join('\n'))
  const copied = await host.run(copy.argv, copy.options)
  const copyLine = copied !== null && copied.exitCode === 0 ? COPIED_LINE : NOT_COPIED_LINE

  return [...warnings, ...roleLines, copyLine]
}

/**
 * The mirror and render stages of runEpic and their reply (D-147, D-157, D-163, D-164): a worktree whose git dir git
 * did not name absolutely gets epicExcludesFailedReply, as its links could not be hidden. Otherwise mirrorSteps runs
 * with the record's links, and the record is written to the git dir with its links and copies joined, once each, with
 * those this run made, also when the mirror stopped, so the next run and the epic's removal find them. A stopped
 * mirror replies with its failure and renders nothing; else the reply is epicCreatedText with what this run linked and
 * copied, the mirror's warnings and the epicNoRecordWarning line when the record write failed, then the lines of the
 * render stage (renderedLines), which renders each role of the team into the worktree.
 */
async function mirroredReply(
  io: InitIo,
  host: HostIo,
  epic: {
    readonly root: string
    readonly home: string | null
    readonly key: string
    readonly roleIds: readonly string[]
    /** The main checkout's locations, and the team readTeam read there, which the render stage renders. */
    readonly locations: InitLocations
    readonly state: CadreState
    readonly roles: readonly RoleSpec[]
  },
  worktree: EpicWorktree,
): Promise<string> {
  const { key } = epic
  const { path, gitDir, record } = worktree
  if (!gitDir.startsWith('/')) return epicExcludesFailedReply(key)
  const mirrored = await mirrorSteps(io, host, { ...epic, worktree: path, gitDir, recorded: record.links })
  const links = sortedUnique([...record.links, ...mirrored.links])
  const copies = sortedUnique([...record.copies, ...mirrored.copies])
  const isRecorded = await host.write(epicRecordPath(gitDir), epicRecordText({ ...record, links, copies }))
  if (mirrored.failure !== null) return mirrored.failure
  const warnings = [...mirrored.warnings, ...(isRecorded ? [] : [epicNoRecordWarning(key)])]
  const { title, branch, outcome } = worktree
  const counts = { linked: mirrored.links.length, copied: mirrored.copies.length }
  const created = epicCreatedText({ key, title, path, branch, outcome, ...counts, warnings })

  return [created, ...(await renderedLines(io, host, epic, path))].join('\n')
}

/**
 * `/cadre epic <KEY> [title]` in the main checkout's root session (D-145, D-146, D-147, D-163, D-164). Before anything
 * is created it refuses, in this order (D-165): a key epicKeyOf refuses (epicBadKeyReply), before anything runs; the
 * repo refusals of repoGuard, in the epic wording; a root that CHECKOUT_ARGV and checkoutOf do not show as the main
 * checkout (epicNotMainReply naming the main checkout, or EPIC_UNKNOWN_CHECKOUT); the team refusals of readTeam, which
 * reads the whole team from the main root; a team with no one PM (epicPmOf, D-161); the first launcher refusal of
 * launcherRead, role by role in cadre.json order; the claude refusals of claudeRefusal (D-107); and a slug isEpicSlug
 * refuses. It then finds the epic by its key (D-163): git lists the worktrees and the epic branches (a run that fails
 * or cannot start refuses with EPIC_NO_WORKTREE_LIST) and epicLookup decides, its refusals included. A reused worktree
 * gets no add, and the reply shows the title of its epic record, else the title typed. Otherwise the worktree
 * `<root>/.claude/worktrees/<name>` is added back on the kept branch, named for it, or made on the new branch
 * `epic/<slug>` from the current HEAD: a name isEpicSlug refuses, or a path that already exists (epicPathExistsReply),
 * stops it before the one `git worktree add` through the host; an add that fails or cannot start gives
 * epicAddFailedReply, and the branch is never deleted. Its epic record (D-164) holds the key, its name as the slug, the
 * title typed, the branch, the base (the branch checked out at the root, else its commit, else null) and the time.
 * Either way the main checkout is then mirrored into the worktree (mirroredReply, D-147, D-148): what git does not
 * track or ignores there and the worktree lacks is linked in or copied, hidden from git by the worktree's own excludes
 * file, which keeps the user's global excludes and is set up before the first link; a worktree whose git dir git does
 * not name as an absolute path stops with epicExcludesFailedReply. The record is then written to that git dir with its
 * links and copies joined with those this run made (D-163); a reused worktree whose record is unreadable gets a new
 * one from this run's key, title and branch, with no base. A write that fails adds the epicNoRecordWarning line.
 * Once the mirror ran every step, each role of the team is rendered into the worktree (renderedLines, D-157): the team
 * read from the main root is compiled there, and renderRole renders each role with the worktree as its root, so the
 * team, the manifest and the launchers are never read from the worktree (RESEARCH Pattern 1). Running /cadre epic is
 * the consent to these steps (D-165), so it asks nothing. The reply is epicCreatedText followed by the render stage's
 * lines (one per role: its `cd -- <worktree> && <launcher>` command, copied with the others, or its render refusal),
 * or the reply the mirror stopped with. `options.terminal` is where the roles will open (D-167).
 */
export async function runEpic(
  io: InitIo,
  host: HostIo,
  options: { readonly key: string; readonly title: string; readonly terminal: Exclude<TerminalChoice, 'none'> },
): Promise<string> {
  const key = epicKeyOf(options.key)
  if (key === null) return epicBadKeyReply(options.key)
  const guard = await repoGuard(io, 'epic')
  if (guard.kind === 'refuse') return guard.text
  const { root, home } = guard.locations
  const checkout = checkoutOf(await host.run(CHECKOUT_ARGV(root), { timeoutMs: GIT_TIMEOUT_MS }))
  if (checkout.kind === 'linked') return epicNotMainReply(checkout.main)
  if (checkout.kind === 'unknown') return EPIC_UNKNOWN_CHECKOUT
  const team = await readTeam(io, root, 'epic', null)
  if (team.kind === 'refuse') return team.text
  const pm = epicPmOf(team.value.roles)
  if (pm.kind === 'refuse') return pm.text
  for (const id of team.value.state.roles) {
    const launcher = await launcherRead(io, root, id)
    if (launcher.kind === 'refuse') return launcher.text
  }
  const claude = await claudeRefusal(host, home)
  if (claude !== null) return claude

  const slug = epicSlug(key, options.title)
  const keySlug = epicSlug(key, '')
  if (slug === null || keySlug === null) return epicBadKeyReply(options.key)
  if (!isEpicSlug(slug)) return epicBadNameReply(slug)
  const listed = await host.run(WORKTREE_LIST_ARGV(root), { timeoutMs: GIT_TIMEOUT_MS })
  if (listed === null || listed.exitCode !== 0) return EPIC_NO_WORKTREE_LIST
  const refs = await host.run(EPIC_BRANCHES_ARGV(root), { timeoutMs: GIT_TIMEOUT_MS })
  if (refs === null || refs.exitCode !== 0) return EPIC_NO_WORKTREE_LIST
  const branches = refs.stdout.split('\n').filter(line => line !== '')
  const lookup = epicLookup({ worktrees: parseWorktreeList(listed.stdout), branches, keySlug })
  if (lookup.kind === 'refuse') return lookup.text
  const { state, roles } = team.value
  const epic = { root, home, key, roleIds: state.roles, locations: guard.locations, state, roles }

  if (lookup.kind === 'reuse') {
    const asked = await host.run(GIT_DIR_ARGV(lookup.path), { timeoutMs: GIT_TIMEOUT_MS })
    const recordDir = asked !== null && asked.exitCode === 0 ? asked.stdout.trim() : ''
    const read = recordDir.startsWith('/') ? await io.read(epicRecordPath(recordDir), MAX_READ_BYTES) : null
    const parsed = read !== null && read.state === 'text' ? parseEpicRecord(read.text) : null
    // An unreadable record is written anew with what this run can name; its base is not known any more.
    const record: EpicRecord = parsed ?? {
      schema: 1,
      key,
      slug: lookup.branch.slice(EPIC_BRANCH_PREFIX.length),
      title: options.title,
      branch: lookup.branch,
      base: null,
      createdAt: (await io.now()) ?? 0,
      links: [],
      copies: [],
    }

    return mirroredReply(io, host, epic, {
      path: lookup.path,
      branch: lookup.branch,
      outcome: 'reused',
      title: record.title,
      gitDir: recordDir,
      record,
    })
  }

  const isNew = lookup.kind === 'new'
  const name = lookup.kind === 'readd' ? lookup.name : slug
  // A kept branch names the worktree too, so its name gets the check the typed slug got (D-147).
  if (!isEpicSlug(name)) return epicBadNameReply(name)
  const branch = lookup.kind === 'readd' ? lookup.branch : `${EPIC_BRANCH_PREFIX}${slug}`
  const path = worktreePathOf(root, name)
  if ((await io.stat(path)) !== null) return epicPathExistsReply(path)
  const symbolic = await host.run(BASE_BRANCH_ARGV(root), { timeoutMs: GIT_TIMEOUT_MS })
  const headBranch = symbolic !== null && symbolic.exitCode === 0 ? symbolic.stdout.trim() : ''
  const commit = headBranch === '' ? await host.run(BASE_COMMIT_ARGV(root), { timeoutMs: GIT_TIMEOUT_MS }) : null
  const headCommit = commit !== null && commit.exitCode === 0 ? commit.stdout.trim() : ''
  const base = headBranch === '' ? headCommit : headBranch
  const added = await host.run(worktreeAddArgv(root, path, branch, isNew), { timeoutMs: GIT_ADD_TIMEOUT_MS })
  if (added === null || added.exitCode !== 0) return epicAddFailedReply(branch, isNew)

  const named = await host.run(GIT_DIR_ARGV(path), { timeoutMs: GIT_TIMEOUT_MS })
  const gitDir = named !== null && named.exitCode === 0 ? named.stdout.trim() : ''
  const record: EpicRecord = {
    schema: 1,
    key,
    slug: name,
    title: options.title,
    branch,
    base: base === '' ? null : base,
    createdAt: (await io.now()) ?? 0,
    links: [],
    copies: [],
  }
  const outcome = isNew ? 'created' : 're-added'

  return mirroredReply(io, host, epic, { path, branch, outcome, title: options.title, gitDir, record })
}
