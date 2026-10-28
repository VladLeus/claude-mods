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
  PortRead,
  RoleSpec,
  TemplateRoleId,
  TerminalChoice,
} from '../types'
import { allOrNull, isObject, parseJsonValue, stableJson } from './core/json'
import { reportText, sortedUnique } from './core/text'
import { asciiLine, ROLE_LINE_MAX } from './generate/kickoff'
import { hasRuntimeKickoff, shQuote } from './generate/launcher'
import { GIT_TIMEOUT_MS } from './git/argv'
import { CHECKOUT_ARGV, checkoutOf } from './git/checkout'
import { repoGuard } from './guards/repo'
import { hasRunFailed } from './host/steps'
import { foldersAbove, launcherPath } from './paths'
import { standIn, standsFor } from './roles/template'
import { MAX_READ_BYTES } from './scan/facts/normalize'
import { claudeRefusal, launcherRead, renderRole } from './start'
import { roleRunState } from './status'
import { compileTeam, readTeam, regenBadRole } from './team'
import { askChoice, quotedLabels } from './ui/ask'
import { terminalHostOf } from './ui/open'
import {
  clipboardRun,
  COPIED_LINE,
  launcherCommand,
  NOT_COPIED_LINE,
  TERMINAL_OPEN_TIMEOUT_MS,
  terminalPlan,
} from './ui/terminal'
import type { TerminalPlan } from './ui/terminal'

/** The folder below the main checkout's root that holds every epic worktree (D-146), as `claude --worktree` uses. */
export const WORKTREES_DIR = '.claude/worktrees'

/** The start of every epic branch name (D-146): `epic/<slug>`. */
export const EPIC_BRANCH_PREFIX = 'epic/'

/** How long `git worktree add` may run before it is given up: a big checkout with its hooks takes long (Pitfall 8). */
export const GIT_ADD_TIMEOUT_MS = 120_000

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

/** The template role whose role PM feeds the epic's tickets to, and the other roles wait for (D-144, D-159). */
const TL_ROLE: TemplateRoleId = 'tl'

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
 * The parent a role of the epic waits for (D-159): none for the PM `pmId`; the PM for the TL, the role standIn finds
 * for `tl` (the one with id tl, else the first based on tl); the TL for every other role, or the PM when the team has
 * no TL.
 */
export function epicParentOf(
  role: Pick<RoleSpec, 'id' | 'basedOn'>,
  roles: readonly Pick<RoleSpec, 'id' | 'basedOn'>[],
  pmId: string,
): string | null {
  if (role.id === pmId) return null
  const tlId = standIn(TL_ROLE, roles)
  if (tlId === null || tlId === role.id) return pmId

  return tlId
}

/**
 * The refusal when a role's launcher in the main checkout was written before the epic kickoff (D-158): it would start
 * the role with its own kickoff and not the epic's, so /cadre epic stops before it creates anything and names each such
 * role, cleaned, with the /cadre regen that writes its launcher anew. As a new epic worktree checks out HEAD (D-146), a
 * repo that commits `.cadre/` (the `definitions` and `all` policies) is told to commit the regenerated launchers and
 * `.cadre/manifest.json` first, else the worktree holds the old ones and no role opens (03.1-W4 S2; the manifest, which
 * holds each launcher's sha256, since /cadre start in the worktree checks it, 03.1-W6 S2).
 */
export function epicOldLauncherReply(ids: readonly string[]): string {
  const regens = ids.map(id => `/cadre regen ${reportText(id)}`).join(', ')

  return (
    `cadre epic stopped before creating anything: the launcher of ${reportText(ids.join(', '))} predates the epic ` +
    `kickoff and would start without it. Run ${regens}. A new epic worktree is made from HEAD, so if this repo ` +
    'commits .cadre/, commit the regenerated .cadre/ files (the .cadre/bin/ launchers and .cadre/manifest.json) ' +
    'too. Then run /cadre epic again.'
  )
}

/** The chip of the question on which roles of the epic to open (D-166). */
export const EPIC_ROLES_HEADER = 'Epic roles'

/** The option of the role question that opens only the PM, who always opens (D-166). */
const PM_ONLY_OPTION = 'PM only'

/** The recommended option of the role question, which opens each of the team's `count` roles (D-166). */
function allRolesOption(count: number): string {
  return `All ${count} roles (Recommended)`
}

/**
 * The question on which roles of the epic to open (D-166), for a team of `count` roles: all of them, the PM only, or
 * the role ids typed under Other. The PM always opens, as it fetches the epic.
 */
export function epicRolesQuestion(count: number): string {
  return (
    `Which roles should cadre epic open in the worktree? All ${count}, PM only, or type role ids under Other; ` +
    'the PM always opens, as it fetches the epic.'
  )
}

/** The reply when the role question is dismissed or gets no usable answer (D-166): nothing was created. */
export const EPIC_CANCELLED = 'cadre epic was cancelled: no roles were picked to open, so it created nothing.'

/**
 * The role ids an answer to the role question picks (D-166), in cadre.json order: every id for the all option, the PM
 * for PM only, else the ids typed, split on commas and whitespace, each a team role id as it is, with the PM added;
 * null for an empty answer or one that names an id the team does not have, so it is asked again.
 */
function pickedIds(answer: string, ids: readonly string[], pmId: string): readonly string[] | null {
  const typed = answer.trim()
  if (typed === allRolesOption(ids.length)) return ids
  if (typed === PM_ONLY_OPTION) return [pmId]
  const words = typed.split(/[\s,]+/).filter(word => word !== '')
  if (words.length === 0 || words.some(word => !ids.includes(word))) return null

  return ids.filter(id => id === pmId || words.includes(id))
}

/**
 * The roles /cadre epic opens (D-166), in cadre.json order: the whole team when it has one role or the session has no
 * dialog (`claude -p`), else what one epicRolesQuestion under EPIC_ROLES_HEADER picks (pickedIds), asked with
 * askChoice, so an answer it cannot read is asked again with why on top. Null when the question is dismissed or gets
 * no usable answer, which cancels the run before anything is created.
 */
async function epicPickedRoles(
  io: InitIo,
  roles: readonly RoleSpec[],
  pmId: string,
): Promise<readonly RoleSpec[] | null> {
  if (roles.length < 2 || (await io.isInteractive()) !== true) return roles
  const ids = roles.map(role => role.id)
  const options = [allRolesOption(ids.length), PM_ONLY_OPTION]
  const answer = await askChoice(io, {
    question: epicRolesQuestion(ids.length),
    spec: { options, header: EPIC_ROLES_HEADER },
    parse: text => pickedIds(text, ids, pmId),
    accepts: `${quotedLabels(options)}, or role ids from: ${ids.join(', ')}`,
  })
  if (answer.kind !== 'answered') return null

  return roles.filter(role => answer.value.includes(role.id))
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
 * not empty and has none, then EXCLUDES_HEADING, one excludesLine per hidden path (each link, and each copy of a
 * GIT_FILE_NAMES file, 03.1 S1), sorted and once each, and RUNTIME_EXCLUDE_LINE last. The leading `/` matches the link
 * at the worktree root only; an env file copy gets no line, as main ignores it already (D-172).
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

/**
 * The last segments of the files git never reads through a link in a work tree (git 2.32+), so the mirror copies them,
 * as it copies env files, and hides each copy (03.1 S1).
 */
const GIT_FILE_NAMES: readonly string[] = ['.gitattributes', '.gitignore', '.mailmap']

/** Whether the last segment of a repo-relative path is one of GIT_FILE_NAMES (03.1 S1). */
function isGitFile(path: string): boolean {
  return GIT_FILE_NAMES.includes(path.slice(path.lastIndexOf('/') + 1))
}

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
 * - (h) a file whose last segment starts with `.env`, or is `.gitignore`, `.gitattributes` or `.mailmap`
 *   (GIT_FILE_NAMES, which git never reads through a link, 03.1 S1), as the main listing of its folder shows (a regular
 *   file, not a link): a copy step, unless the worktree lists its target;
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
    const name = path.slice(path.lastIndexOf('/') + 1)
    const isCopied = name.startsWith(ENV_PREFIX) || GIT_FILE_NAMES.includes(name)
    if (isCopied && shown !== undefined && shown.kind === 'file' && !shown.isLink) {
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
 * excludes text (globalExcludesOf), then the links `recorded` holds and the plan's own, and each copy of a
 * GIT_FILE_NAMES file, recorded (`recordedCopies`) or planned, once each (D-163, 03.1 S1). The worktree is pointed at
 * it with WORKTREE_CONFIG_ARGV, then EXCLUDES_CONFIG_ARGV, on every run, as both are idempotent: a write or run that
 * fails stops it with epicExcludesFailedReply, before any step. Each step then runs with its epicStepArgv, and the
 * first one that fails stops it with epicStepFailedReply. What ran before the stop is in the result.
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
    readonly recordedCopies: readonly string[]
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
  const gitFileCopies = [...input.recordedCopies, ...plan.copies].filter(isGitFile)
  const hidden = sortedUnique([...input.recorded, ...plan.links, ...gitFileCopies])
  if (!(await host.write(file, excludesText(global.text, hidden)))) return excludesFailed
  for (const argv of [WORKTREE_CONFIG_ARGV(root), EXCLUDES_CONFIG_ARGV(worktree, file)]) {
    const configured = await host.run(argv, { timeoutMs: GIT_TIMEOUT_MS })
    if (hasRunFailed(configured)) return excludesFailed
  }

  const ran: EpicStep[] = []
  const made = (kind: EpicStep['kind']) =>
    ran.filter(step => step.kind === kind).map(step => step.path.slice(worktree.length + 1))
  for (const step of plan.steps) {
    const done = await host.run(epicStepArgv(step), { timeoutMs: MIRROR_STEP_TIMEOUT_MS })
    if (hasRunFailed(done)) {
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
 * Whom PM feeds the epic's tickets (D-144): the TL's session `cadre-<tl id>` when the team has a TL, else its roles.
 */
function feedTarget(tlId: string | null): string {
  return tlId === null ? 'your roles' : `cadre-${tlId}`
}

/** What stands between the epic key and its title in PM's epic kickoff line (D-158). */
const TITLE_SEPARATOR = ': '

/**
 * The role line of PM's epic kickoff (D-158): the epic key, and its title when there is one, then what PM does first:
 * read its ROLE.md and inbox, fetch the epic with its tracker MCP, resolve its gaps (decide, or ask the user), then
 * feed `target` ticket by ticket (D-144).
 */
function pmEpicSentence(id: string, key: string, title: string, target: string): string {
  const epic = title === '' ? key : `${key}${TITLE_SEPARATOR}${title}`
  const next =
    `Read .cadre/${id}/ROLE.md and your inbox, fetch the epic with your tracker MCP, resolve its gaps ` +
    `(decide or ask the user), then feed ${target} ticket by ticket.`

  return `You are the PM of epic ${epic}. ${next}`
}

/**
 * The role line of a worker's epic kickoff (D-158): who the role is, the epic key and its ROLE.md, then the wait for
 * its parent's session `cadre-<parent>` with wait_for reason session-answer, and to work what it sends. With no parent
 * named it waits with no `from`, so it never names a session that is not its parent.
 */
function workerEpicSentence(id: string, key: string, title: string, parent: string | null): string {
  const from = parent === null ? '' : ` from cadre-${parent}`
  const wait = `wait for your parent: wait_for reason session-answer${from}, then work what it sends.`

  return `You are ${title} (cadre role ${id}) on epic ${key}. Read .cadre/${id}/ROLE.md, then ${wait}`
}

/**
 * PM's epic kickoff line (D-158): the epic title, with its separator, gets what ROLE_LINE_MAX leaves once the rest of
 * the line is in, so a long title never cuts off the instruction at the end; the whole line is then capped.
 */
function pmEpicLine(id: string, key: string, title: string, target: string): string {
  const room = ROLE_LINE_MAX - pmEpicSentence(id, key, '', target).length - TITLE_SEPARATOR.length
  const kept = asciiLine(title, room)

  return asciiLine(pmEpicSentence(id, key, kept, target), ROLE_LINE_MAX)
}

/**
 * A worker's epic kickoff line (D-158), as kickoffRoleLine budgets its title: the role title gets what ROLE_LINE_MAX
 * leaves once the rest of the line is in, a title with no ASCII character left gives way to the role id, and the whole
 * line is then capped.
 */
function workerEpicLine(role: RoleSpec, key: string, parent: string | null): string {
  const room = ROLE_LINE_MAX - workerEpicSentence(role.id, key, '', parent).length
  const own = asciiLine(role.title, room)
  const title = own === '' ? asciiLine(role.id, room) : own

  return asciiLine(workerEpicSentence(role.id, key, title, parent), ROLE_LINE_MAX)
}

/**
 * The epic kickoff of a role, the text /cadre epic writes to its `.runtime/kickoff.txt` (D-158 to D-160): D-79's
 * positional autopilot command `/autopilot <duration> <threshold> "<line>"` with the role's own duration and threshold,
 * and a newline. PM's line names the epic key and title and says to fetch the epic with its tracker MCP, resolve its
 * gaps (decide or ask the user) and feed the TL `tlId`, else its roles, ticket by ticket, and it ends ` --ask-user`
 * whatever its role.json says, as PM is the one role that asks the user (D-144). Every other role's line names the role
 * and the key and says to wait for its parent's session `cadre-<parent>` (epicParentOf) with wait_for reason
 * session-answer, then work what it sends, and it never carries ` --ask-user` (D-160). Each line is one line of
 * printable ASCII with no quote or backtick (asciiLine), so it sits inside the command's quotes, at most ROLE_LINE_MAX
 * long: the epic title (PM) or the role title is cut first, so the key stays whole and the line keeps its end whenever
 * the line with no title fits.
 */
export function epicKickoffText(input: {
  readonly role: RoleSpec
  readonly key: string
  readonly title: string
  readonly isPm: boolean
  readonly parent: string | null
  readonly tlId: string | null
}): string {
  const { role, key, title, parent, tlId } = input
  const { duration, threshold } = role.autopilot
  if (!input.isPm) return `/autopilot ${duration} ${threshold} "${workerEpicLine(role, key, parent)}"\n`

  return `/autopilot ${duration} ${threshold} "${pmEpicLine(role.id, key, title, feedTarget(tlId))}" --ask-user\n`
}

/**
 * The role line of a role whose launcher in the epic worktree predates the epic kickoff (D-158): the epic branch holds
 * an older `.cadre/bin/<id>`, which would start the role without its epic kickoff, so the role is not opened. The
 * advice names `.cadre/manifest.json` too, else /cadre start in the worktree refuses the launcher as changed
 * (03.1-W6 S2). The id is shown cleaned.
 */
export function epicWorktreeLauncherLine(id: string): string {
  const role = reportText(id)

  return (
    `not opened: the epic branch holds a launcher .cadre/bin/${role} older than the epic kickoff. ` +
    `Commit the regenerated .cadre/bin/${role} and .cadre/manifest.json to the branch and run /cadre epic with the ` +
    'same key again.'
  )
}

/**
 * The role line of a role whose launcher in the epic worktree is not the text cadre checked in the main checkout
 * (03.1-W4 S1, LNCH-04): it differs from it, or it could not be read in full, so cadre does not open it or copy its
 * command. The id is shown cleaned.
 */
export function epicWorktreeLauncherChangedLine(id: string): string {
  const role = reportText(id)

  return `not opened: the worktree's .cadre/bin/${role} is not the launcher cadre checked in the main checkout.`
}

/**
 * Whether a picked role may open its launcher in the epic worktree (D-158, 03.1-W4 S1): null when the worktree has
 * none, as nothing runs then, or when it is the very text runEpic checked in the main checkout with launcherRead
 * (`verified`); epicWorktreeLauncherLine when it is a text without the epic kickoff line; else
 * epicWorktreeLauncherChangedLine, so cadre never opens a launcher it did not check (LNCH-04, T-03-28).
 */
export function epicWorktreeLauncherCheck(id: string, read: PortRead, verified: string | undefined): string | null {
  if (read.state === 'absent') return null
  if (read.state === 'text' && !hasRuntimeKickoff(read.text)) return epicWorktreeLauncherLine(id)
  if (read.state === 'text' && read.text === verified) return null

  return epicWorktreeLauncherChangedLine(id)
}

/** A picked role once the render stage ran: why it cannot open, as its reply line says, or null when it can. */
type RenderedRole = { readonly id: string; readonly line: string | null }

/** How one role fared in the open stage (D-167): its reply line, its command to copy when it did not open, and why. */
type OpenedRole = { readonly line: string; readonly command: string | null; readonly refusal: string | null }

/**
 * Opens one role in a terminal as `plan` says (D-167): `opened in a new <name>` when the open run exits 0. A plan that
 * refuses, or an open that fails or cannot run, gives the role's `command` instead, to print and copy, with the refusal
 * when that is why.
 */
async function openedRole(host: HostIo, plan: TerminalPlan, command: string): Promise<OpenedRole> {
  if (plan.kind === 'refuse') return { line: command, command, refusal: plan.text }
  const opened = await host.run(plan.argv, { timeoutMs: TERMINAL_OPEN_TIMEOUT_MS })
  if (hasRunFailed(opened)) return { line: command, command, refusal: null }

  return { line: `opened in a new ${plan.name}`, command: null, refusal: null }
}

/**
 * The open stage of runEpic (D-145, D-167): `/usr/bin/uname -s`, TMUX and TERM_PROGRAM are asked once for the run, and
 * each rendered role that can open opens in a terminal inside the worktree as /cadre start opens one: terminalPlan with
 * the `--terminal` choice (auto-detected when bare, forced by terminal, iterm or tmux), the worktree as its root and
 * launcherCommand rooted there (openedRole). One line per role, two spaces in: `<id>: opened in a new <name>`; for a
 * role it could not open, its command `cd -- <worktree> && <launcher>`; for a role that cannot open, the line the
 * render stage gave it. The first refusal of terminalPlan is printed once above the role lines. When any command was
 * printed, the commands are copied through the host with clipboardRun, one per line, and COPIED_LINE or
 * NOT_COPIED_LINE ends the lines. It never runs a launcher and never starts a background session (D-108, D-167).
 */
async function openedLines(
  host: HostIo,
  rendered: readonly RenderedRole[],
  worktree: string,
  terminal: Exclude<TerminalChoice, 'none'>,
): Promise<string[]> {
  const { isMacOs, tmux, termProgram } = await terminalHostOf(host)
  const lines: string[] = []
  const commands: string[] = []
  const refusals: string[] = []
  for (const { id, line } of rendered) {
    if (line !== null) {
      lines.push(`  ${id}: ${line}`)
      continue
    }
    const launcher = launcherCommand(worktree, id)
    const plan = terminalPlan({ choice: terminal, tmux, termProgram, isMacOs, id, root: worktree, command: launcher })
    const opened = await openedRole(host, plan, `cd -- ${shQuote(worktree)} && ${launcher}`)
    lines.push(`  ${id}: ${opened.line}`)
    if (opened.command !== null) commands.push(opened.command)
    if (opened.refusal !== null) refusals.push(opened.refusal)
  }
  const head = refusals.slice(0, 1)
  if (commands.length === 0) return [...head, ...lines]
  const copy = clipboardRun(commands.join('\n'))
  const copied = await host.run(copy.argv, copy.options)

  return [...head, ...lines, copied !== null && copied.exitCode === 0 ? COPIED_LINE : NOT_COPIED_LINE]
}

/**
 * The render stage of runEpic (D-157, D-102, RESEARCH Pattern 1), once the mirror ran every step: the team, read in the
 * main checkout, is compiled there once (compileTeam), and each picked role, in cadre.json order, is rendered for the
 * worktree by renderRole with the worktree as its root (`{ ...main, root: worktree, givenRoot: worktree }`), so every
 * `.runtime/` it writes is the worktree's own, never main's. The render names the main checkout as the epic's, so the
 * role keeps the worktree's CLAUDE.md files out and gets main's code-dir denies too (Pitfalls 1 and 2), and it looks a
 * server up in the `~/.claude.json` project of the worktree, then of the main root as resolved and as given, where the
 * user's project servers are recorded. Each role's render also writes its epic kickoff into its `.runtime/`
 * (epicKickoffText with the epic key, the worktree's title, the role's parent from epicParentOf over the whole team and
 * the team's TL, D-158 to D-160). Its lines: one `warning: <id>: <text>` line per render warning, then the lines of
 * the open stage (openedLines). A role whose render refuses keeps that refusal as its line, which does not stop the
 * others, and one whose launcher in the worktree reads as a text without the epic kickoff line (hasRuntimeKickoff)
 * gets epicWorktreeLauncherLine and does not open, and one that is there but is not the launcher text runEpic checked
 * in the main checkout, or cannot be read in full, gets epicWorktreeLauncherChangedLine and does not open either
 * (epicWorktreeLauncherCheck, 03.1-W4 S1); a role whose worktree has no launcher stays openable.
 */
async function renderedLines(
  io: InitIo,
  host: HostIo,
  team: {
    readonly locations: InitLocations
    readonly state: CadreState
    readonly roles: readonly RoleSpec[]
    readonly picked: readonly RoleSpec[]
    readonly key: string
    readonly pmId: string
    readonly terminal: Exclude<TerminalChoice, 'none'>
    /** The text of each picked role's launcher in the main checkout, as runEpic checked it (03.1-W4 S1). */
    readonly launchers: ReadonlyMap<string, string>
  },
  epicWorktree: { readonly path: string; readonly title: string },
): Promise<string[]> {
  const { locations, state, roles, key } = team
  const worktree = epicWorktree.path
  const tlId = standIn(TL_ROLE, roles)
  const { gathered, scopes } = await compileTeam(io, locations, state, roles)
  const worktreeLocations: InitLocations = { ...locations, root: worktree, givenRoot: worktree }
  const warnings: string[] = []
  const rendered: RenderedRole[] = []
  for (const role of team.picked) {
    const { id } = role
    const scope = scopes.get(id)
    // Fail closed: readTeam read every listed role and compileTeam compiled each one, so it is always there.
    if (scope === undefined) {
      rendered.push({ id, line: regenBadRole(id) })
      continue
    }
    const parent = epicParentOf(role, roles, team.pmId)
    const kickoff = epicKickoffText({ role, key, title: epicWorktree.title, isPm: id === team.pmId, parent, tlId })
    const render = await renderRole(io, host, {
      locations: worktreeLocations,
      state,
      role,
      scope,
      codeDirs: gathered.repo.codeDirs,
      mcpRoots: [worktree, locations.root, locations.givenRoot],
      epic: { mainRoot: locations.root, kickoff },
    })
    if (render.kind === 'refuse') {
      rendered.push({ id, line: render.text })
      continue
    }
    warnings.push(...render.warnings.map(warning => `warning: ${id}: ${warning}`))
    // Open only the launcher cadre checked in main (03.1-W4 S1).
    const launcher = await io.read(`${worktree}/${launcherPath(id)}`, MAX_READ_BYTES)
    rendered.push({ id, line: epicWorktreeLauncherCheck(id, launcher, team.launchers.get(id)) })
  }

  return [...warnings, ...(await openedLines(host, rendered, worktree, team.terminal))]
}

/**
 * The mirror and render stages of runEpic and their reply (D-147, D-157, D-163, D-164): a worktree whose git dir git
 * did not name absolutely gets epicExcludesFailedReply, as its links could not be hidden. Otherwise mirrorSteps runs
 * with the record's links and copies, and the record is written to the git dir with its links and copies joined, once
 * each, with those this run made, also when the mirror stopped, so the next run and the epic's removal find them. A
 * stopped mirror replies with its failure and renders nothing; else the reply is epicCreatedText with what this run
 * linked and copied, the mirror's warnings and the epicNoRecordWarning line when the record write failed, then the
 * lines of the render stage (renderedLines), which renders each picked role into the worktree and opens it there.
 */
async function mirroredReply(
  io: InitIo,
  host: HostIo,
  epic: {
    readonly root: string
    readonly home: string | null
    readonly key: string
    readonly roleIds: readonly string[]
    /** The main checkout's locations, and the team readTeam read there. */
    readonly locations: InitLocations
    readonly state: CadreState
    readonly roles: readonly RoleSpec[]
    /** The roles the render and open stages render and open (epicPickedRoles, D-166). */
    readonly picked: readonly RoleSpec[]
    /** The id of the team's PM (epicPmOf), whose epic kickoff names the epic (D-158). */
    readonly pmId: string
    /** Where the roles open (D-167). */
    readonly terminal: Exclude<TerminalChoice, 'none'>
    /** The text of each picked role's launcher in the main checkout, as runEpic checked it (03.1-W4 S1). */
    readonly launchers: ReadonlyMap<string, string>
  },
  worktree: EpicWorktree,
): Promise<string> {
  const { key } = epic
  const { path, gitDir, record } = worktree
  if (!gitDir.startsWith('/')) return epicExcludesFailedReply(key)
  const mirrored = await mirrorSteps(io, host, {
    ...epic,
    worktree: path,
    gitDir,
    recorded: record.links,
    recordedCopies: record.copies,
  })
  const links = sortedUnique([...record.links, ...mirrored.links])
  const copies = sortedUnique([...record.copies, ...mirrored.copies])
  const isRecorded = await host.write(epicRecordPath(gitDir), epicRecordText({ ...record, links, copies }))
  if (mirrored.failure !== null) return mirrored.failure
  const warnings = [...mirrored.warnings, ...(isRecorded ? [] : [epicNoRecordWarning(key)])]
  const { title, branch, outcome } = worktree
  const counts = { linked: mirrored.links.length, copied: mirrored.copies.length }
  const created = epicCreatedText({ key, title, path, branch, outcome, ...counts, warnings })

  return [created, ...(await renderedLines(io, host, epic, worktree))].join('\n')
}

/**
 * `/cadre epic <KEY> [title]` in the main checkout's root session (D-145, D-146, D-147, D-163, D-164). Before anything
 * is created it refuses, in this order (D-165): a key epicKeyOf refuses (epicBadKeyReply), before anything runs; the
 * repo refusals of repoGuard, in the epic wording; a root that CHECKOUT_ARGV and checkoutOf do not show as the main
 * checkout (epicNotMainReply naming the main checkout, or EPIC_UNKNOWN_CHECKOUT); the team refusals of readTeam, which
 * reads the whole team from the main root; a team with no one PM (epicPmOf, D-161); a dismissed role question, or one
 * with no usable answer (EPIC_CANCELLED, D-166), as epicPickedRoles asks which roles to open when the session has a
 * dialog and the team has more than one role; the first launcher refusal of launcherRead, for each picked role in
 * cadre.json order; a launcher written before the epic kickoff (hasRuntimeKickoff), which epicOldLauncherReply names
 * with every such role (D-158); the claude refusals of claudeRefusal (D-107); and a slug isEpicSlug refuses. It then
 * finds the epic by its key (D-163): git lists the worktrees and the epic branches (a run that fails or cannot start
 * refuses with EPIC_NO_WORKTREE_LIST) and epicLookup decides, its refusals included. A reused worktree gets no add, and
 * the reply shows the title of its epic record, else the title typed. Otherwise the worktree
 * `<root>/.claude/worktrees/<name>` is added back on the kept branch, named for it, or made on the new branch
 * `epic/<slug>` from the current HEAD: a name isEpicSlug refuses, or a path that already exists (epicPathExistsReply),
 * stops it before the one `git worktree add` through the host; an add that fails or cannot start gives
 * epicAddFailedReply, and the branch is never deleted. Its epic record (D-164) holds the key, its name as the slug, the
 * title typed, the branch, the base (the branch checked out at the root, else its commit, else null) and the time.
 * Either way the main checkout is then mirrored into the worktree (mirroredReply, D-147, D-148): what git does not
 * track or ignores there and the worktree lacks is linked in or copied, hidden from git by the worktree's own excludes
 * file, which keeps the user's global excludes and is set up before the first link; a worktree whose git dir git does
 * not name as an absolute path stops with epicExcludesFailedReply. The record is then written to that git dir with its
 * links and copies joined with those this run made (D-163); a reused worktree whose record is unreadable gets a new one
 * from this run's key, title and branch, with no base. A write that fails adds the epicNoRecordWarning line. Once the
 * mirror ran every step, each picked role is rendered into the worktree (renderedLines, D-157): the team read from the
 * main root is compiled there, and renderRole renders each role with the worktree as its root, so the team, the
 * manifest and the launchers are never read from the worktree (RESEARCH Pattern 1). Running /cadre epic is the consent
 * to these steps (D-165), so it asks only which roles to open. Each rendered role then opens in a terminal inside the
 * worktree, where `options.terminal` says (openedLines, D-167). The reply is epicCreatedText followed by the render
 * stage's lines (one per picked role: that it opened, its `cd -- <worktree> && <launcher>` command, copied with the
 * others, its render refusal, or the line of a worktree launcher older than the epic kickoff or not the one checked in
 * the main checkout (03.1-W4 S1)), or the reply the mirror stopped with. It never runs a launcher and never starts a
 * background session (D-108).
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
  const picked = await epicPickedRoles(io, team.value.roles, pm.id)
  if (picked === null) return EPIC_CANCELLED
  const launchers = new Map<string, string>()
  const older: string[] = []
  for (const { id } of picked) {
    const launcher = await launcherRead(io, root, id)
    if (launcher.kind === 'refuse') return launcher.text
    launchers.set(id, launcher.value)
    if (!hasRuntimeKickoff(launcher.value)) older.push(id)
  }
  if (older.length > 0) return epicOldLauncherReply(older)
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
  const epic = {
    root,
    home,
    key,
    roleIds: state.roles,
    locations: guard.locations,
    state,
    roles,
    picked,
    pmId: pm.id,
    terminal: options.terminal,
    launchers,
  }

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
  if (hasRunFailed(added)) return epicAddFailedReply(branch, isNew)

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

/**
 * The argv that asks git what changed in the worktree at `path` (D-169): it is clean when the run exits 0 silent.
 * `--untracked-files=normal` overrides a `status.showUntrackedFiles=no` config, so untracked work always shows
 * (03.1-W5 S1).
 */
export function STATUS_ARGV(path: string): readonly string[] {
  return ['git', '-C', path, 'status', '--porcelain', '--untracked-files=normal']
}

/**
 * The argv that asks git, at `root`, whether `branch` is merged into `base` (D-169): it exits 0 when it is, 1 when it
 * is not, and 128 for a name git does not know (RESEARCH Pattern 3).
 */
export function MERGED_ARGV(root: string, branch: string, base: string): readonly string[] {
  return ['git', '-C', root, 'merge-base', '--is-ancestor', branch, base]
}

/**
 * The argv that removes the worktree at `path` from the repo at `root` (D-170), its folder and the copies in it, with
 * `--force` only on the forced path; git leaves the targets of the links in it alone (RESEARCH Pattern 3).
 */
export function REMOVE_ARGV(root: string, path: string, force: boolean): readonly string[] {
  return ['git', '-C', root, 'worktree', 'remove', ...(force ? ['--force'] : []), path]
}

/** How long `git worktree remove` may run before it is given up: a big worktree takes long to delete (Pitfall 8). */
export const REMOVE_TIMEOUT_MS = 120_000

/**
 * The argv that removes one link cadre recorded in the worktree (D-170): `/bin/rm -f --` and never `-r`, so it removes
 * the link itself and never what the link points at in the main checkout.
 */
export function linkRemoveArgv(path: string): readonly string[] {
  return ['/bin/rm', '-f', '--', path]
}

/**
 * The recorded links /cadre epic done removes itself (D-170, 03.1-W5 M1), as absolute paths in sorted order, once each:
 * each one the worktree's listing in `tree` shows as a link, with every folder above it listed as a real folder, so no
 * rm is resolved through a link into the main checkout. Any other recorded path, one below a folder that became a link,
 * one that is no longer a link, or one whose folders could not be listed, is left to git worktree remove, which never
 * follows a link.
 */
export function epicLinkRemovals(
  worktree: string,
  links: readonly string[],
  tree: ReadonlyMap<string, readonly PortEntry[]>,
): string[] {
  const isRealFolder = (folder: string): boolean => {
    const listed = listedEntry(tree, folder)
    if (listed === undefined) return false

    return listed.kind === 'dir' && !listed.isLink
  }

  return sortedUnique(links)
    .filter(link => foldersAbove(link).every(isRealFolder) && listedEntry(tree, link)?.isLink === true)
    .map(link => `${worktree}/${link}`)
}

/** The refusal when git cannot list the worktrees for /cadre epic done (D-152): it fails closed and removes nothing. */
export const EPIC_DONE_NO_LIST = 'cadre epic done could not list the worktrees from git, so it removed nothing.'

/** The refusal when git lists no worktree on an epic branch of the key (D-152, D-163); the key is shown cleaned. */
export function epicNotFoundReply(key: string): string {
  return `git lists no worktree of the epic ${reportText(key)}, so cadre epic done removed nothing.`
}

/**
 * The reply once the epic's worktree is removed (D-152): the worktree and the copies in it are gone, and its branch is
 * kept, as cadre never deletes a branch. The key, the path and the branch are shown cleaned.
 */
export function epicRemovedText(key: string, path: string, branch: string): string {
  const kept = `its branch ${reportText(branch)} is kept, as cadre never deletes a branch.`

  return `cadre epic done ${reportText(key)}: removed the worktree ${reportText(path)}; ${kept}`
}

/**
 * The reply when `git worktree remove` fails or cannot run (D-170): the links cadre recorded were removed before it, so
 * the worktree stays without them, and /cadre epic with the key, shown cleaned, links them again.
 */
export function epicRemoveFailedReply(key: string): string {
  return (
    'git could not remove the epic worktree, so cadre epic done stopped. The links it records were removed first: ' +
    `run /cadre epic ${reportText(key)} to link them again.`
  )
}

/**
 * What the clean check of /cadre epic done found (D-169): `clean` when git shows nothing, `dirty` when it shows a
 * change, `unknown` when git could not tell.
 */
export type CleanState = 'clean' | 'dirty' | 'unknown'

/**
 * What the merged check of /cadre epic done found (D-169): `merged` or `not-merged` into the recorded base, `unknown`
 * when git could not tell, `no-record` when no readable epic record names a base to check against.
 */
export type MergedState = 'merged' | 'not-merged' | 'unknown' | 'no-record'

/**
 * The clean check from a STATUS_ARGV run (D-169): clean when it exits 0 with no output, dirty when it exits 0 with
 * output, unknown when it exits otherwise or could not run, so a status git could not give never reads as clean. The
 * links are hidden by the worktree's excludes file, and ignored copies do not show. Untracked files show even when the
 * config hides them (STATUS_ARGV, 03.1-W5 S1).
 */
export function cleanStateOf(run: HostRun | null): CleanState {
  if (run === null || run.exitCode !== 0) return 'unknown'

  return run.stdout === '' ? 'clean' : 'dirty'
}

/**
 * The merged check from a MERGED_ARGV run (D-169, RESEARCH Pitfall 7): merged on exit 0, not merged on exit 1, unknown
 * on any other exit (128 for a name git does not know) or a run that could not run, so it never reads as merged then.
 */
export function mergedStateOf(run: HostRun | null): MergedState {
  if (run === null) return 'unknown'
  if (run.exitCode === 0) return 'merged'

  return run.exitCode === 1 ? 'not-merged' : 'unknown'
}

/** The reason the clean check gives (D-169), with its fix: none when the worktree is clean. */
function cleanProblems(clean: CleanState): string[] {
  if (clean === 'clean') return []
  if (clean === 'dirty') return ['git shows changes in the worktree: commit or stash them there']

  return ['git could not tell whether the worktree is clean: run git status there, then commit or stash what it shows']
}

/**
 * The reason the merged check gives (D-169), with its fix and the branch and base shown cleaned: none when the branch
 * is merged; with no base to check against, the missing epic record is named.
 */
function mergedProblems(merged: MergedState, branch: string, base: string | null): string[] {
  if (merged === 'merged') return []
  const name = reportText(branch)
  if (merged === 'no-record' || base === null) {
    return [
      `the epic record ${EPIC_RECORD_FILE}, which names the branch the worktree was made from, is missing or not ` +
        `valid, so cadre cannot tell whether ${name} is merged: merge it, then use --force`,
    ]
  }
  const into = reportText(base)
  if (merged === 'not-merged') return [`the branch ${name} is not merged into ${into}: merge it into ${into}`]

  return [`git could not tell whether ${name} is merged into ${into}: check that ${into} exists, then merge into it`]
}

/**
 * The reason the role check gives (D-171), with its fix and the ids shown cleaned: the roles that still run in the
 * worktree, none when no role does; a team that could not be read gives `role states unknown`, never no reason.
 */
function roleProblems(running: readonly string[], teamRead: boolean): string[] {
  if (!teamRead) {
    return [
      'role states unknown: cadre could not read the team in .cadre/, so it cannot tell whether a role still runs ' +
        'in the worktree: fix the team, or stop every role and use --force',
    ]
  }
  if (running.length === 0) return []
  const ids = reportText(running.join(', '))
  if (running.length === 1) return [`the role ${ids} still runs in the worktree: stop it first`]

  return [`the roles ${ids} still run in the worktree: stop them first`]
}

/**
 * The reasons /cadre epic done keeps the worktree (D-169, D-171), one line each, in this order: the clean check, the
 * merged check, then the role check. Each names its fix: commit or stash the changes, merge `branch` into `base`, stop
 * the roles in `running`. A check that cannot tell is a reason too, never a pass: a status or merge-base git could not
 * give, no record or no base (`no-record`), and a team that could not be read (`teamRead` false). Empty when every
 * check passed.
 */
export function epicDoneProblems(input: {
  readonly clean: CleanState
  readonly merged: MergedState
  readonly running: readonly string[]
  readonly teamRead: boolean
  readonly branch: string
  readonly base: string | null
}): string[] {
  return [
    ...cleanProblems(input.clean),
    ...mergedProblems(input.merged, input.branch, input.base),
    ...roleProblems(input.running, input.teamRead),
  ]
}

/**
 * The refusal of /cadre epic done when a check fails (D-152, D-169, D-171): a head line with the key, cleaned, that
 * says nothing was removed and that `--force` removes the worktree anyway after one question, then one `- <reason>`
 * line per reason of epicDoneProblems.
 */
export function epicDoneRefusal(key: string, problems: readonly string[]): string {
  const name = reportText(key)
  const head =
    `cadre epic done kept the worktree of the epic ${name} and removed nothing: fix what is below, or run ` +
    `/cadre epic done ${name} --force to remove it anyway after one question.`

  return [head, ...problems.map(problem => `- ${problem}`)].join('\n')
}

/**
 * The process a worktree's lock reason names (D-152, D-170), as `claude --worktree` writes it (`... (pid 99999)`): the
 * number after the whole word `pid` when it is a whole word itself and a positive safe integer; null for a reason that
 * names no such process.
 */
export function lockPid(reason: string): number | null {
  const found = /\bpid (\d+)\b/.exec(reason)
  const pid = found === null ? Number.NaN : Number(found[1])

  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

/**
 * The argv that asks whether the process `pid` still runs (D-170, RESEARCH Standard Stack): `/bin/ps` exits 0 while it
 * does and 1 once it has ended, for any user's process, where `kill -0` would read another user's live one as ended.
 */
export function PS_ARGV(pid: number): readonly string[] {
  return ['/bin/ps', '-p', String(pid), '-o', 'pid=']
}

/** How long the PS_ARGV run of the stale-lock rule may run before it is given up (Pitfall 8). */
const PS_TIMEOUT_MS = 10_000

/** The argv that clears the lock of the worktree at `path` in the repo at `root` (D-170) once its process has ended. */
export function UNLOCK_ARGV(root: string, path: string): readonly string[] {
  return ['git', '-C', root, 'worktree', 'unlock', path]
}

/** The chip of the consent question of /cadre epic done --force (D-152). */
export const EPIC_DONE_HEADER = 'Epic done'

/** The answer to the epic done question that removes the worktree; the other answer keeps it (D-134). */
const REMOVE_OPTION = 'Yes, remove it'

/**
 * The answers to the epic done question, the one that keeps the worktree first (D-134): the dialog starts with its
 * first option focused, so a quick Submit keeps it, and only REMOVE_OPTION removes it.
 */
export const EPIC_DONE_OPTIONS: readonly string[] = Object.freeze(['No, keep it', REMOVE_OPTION])

/** Whether an answer to the epic done question removes the worktree; null when, trimmed, it is no answer label. */
function removesWorktree(answer: string): boolean | null {
  const typed = answer.trim()
  if (!EPIC_DONE_OPTIONS.includes(typed)) return null

  return typed === REMOVE_OPTION
}

/**
 * The consent question of /cadre epic done --force (D-152): whether to remove the epic's worktree, the key shown
 * cleaned, with its links first and its branch kept; with reasons, it asks to remove it anyway and lists them, one
 * `- <reason>` line each, as epicDoneProblems gives them.
 */
export function epicDoneQuestion(key: string, problems: readonly string[]): string {
  const name = reportText(key)
  const steps = 'cadre removes its links first and keeps its branch.'
  if (problems.length === 0) return `Remove the worktree of the epic ${name}? ${steps}`
  const head = `Remove the worktree of the epic ${name} anyway? ${steps} Without --force it stays, as:`

  return [head, ...problems.map(problem => `- ${problem}`)].join('\n')
}

/** The reply when --force finds no dialog to ask in (D-152, D-134): with no yes, nothing is removed. */
export const EPIC_DONE_NO_DIALOG =
  'cadre epic done --force asks before it removes anything, and this session has no dialog, so it removed nothing.'

/** The reply when the --force question gets no yes (D-152, D-134): the worktree is kept; the key is shown cleaned. */
export function epicKeptReply(key: string): string {
  return `cadre epic done kept the worktree of the epic ${reportText(key)}: nothing was removed.`
}

/**
 * The refusal of a worktree whose lock reason names no process (D-152, D-170): cadre cannot tell whether the lock is
 * stale, so it removes nothing, with or without --force. The reason is shown cleaned.
 */
export function epicLockedReply(reason: string): string {
  const lock = reason === '' ? 'locked with no reason' : `locked (${reportText(reason)})`

  return (
    `the epic worktree is ${lock}, and the lock names no process, so cadre epic done cannot tell whether it is ` +
    'stale and removed nothing: run git worktree unlock on it once nothing uses it.'
  )
}

/** The refusal of a worktree locked by a process that still runs (D-152, D-170), with or without --force. */
export function epicLockLiveReply(pid: number): string {
  return `the epic worktree is locked by process ${pid}, which still runs, so cadre epic done removed nothing.`
}

/** The refusal when ps cannot tell whether the lock's process still runs (D-152, D-170): it fails closed. */
export function epicLockUnknownReply(pid: number): string {
  return (
    `the epic worktree is locked by process ${pid}, and cadre could not tell whether it still runs, so cadre epic ` +
    'done removed nothing.'
  )
}

/** The refusal when git cannot clear the lock of a process that has ended (D-170): nothing is removed. */
export function epicUnlockFailedReply(pid: number): string {
  return `git could not unlock the epic worktree, whose lock names the ended process ${pid}, so nothing was removed.`
}

/** An epic worktree as /cadre epic done finds it: its path, the epic branch checked out there and its lock reason. */
type DoneWorktree = {
  readonly path: string
  readonly branch: string
  readonly locked: string | null
}

/**
 * The epic record of the worktree at `path` (D-164), read from the git dir GIT_DIR_ARGV names for it; null when git
 * names no absolute git dir, or the record there is absent, unreadable or not valid (parseEpicRecord).
 */
async function doneRecordOf(io: InitIo, host: HostIo, path: string): Promise<EpicRecord | null> {
  const named = await host.run(GIT_DIR_ARGV(path), { timeoutMs: GIT_TIMEOUT_MS })
  const gitDir = named !== null && named.exitCode === 0 ? named.stdout.trim() : ''
  if (!gitDir.startsWith('/')) return null
  const read = await io.read(epicRecordPath(gitDir), MAX_READ_BYTES)

  return read.state === 'text' ? parseEpicRecord(read.text) : null
}

/** The merged check (D-169): `no-record` with no base to check against, else what a MERGED_ARGV run at `root` tells. */
async function mergedOf(host: HostIo, root: string, branch: string, base: string | null): Promise<MergedState> {
  if (base === null) return 'no-record'

  return mergedStateOf(await host.run(MERGED_ARGV(root, branch, base), { timeoutMs: GIT_TIMEOUT_MS }))
}

/**
 * The ids of the team's roles that read `running` in the epic worktree (D-171), in cadre.json order: the team is read
 * from the main checkout (readTeam), and each role's state is the one /cadre status would report for it with the
 * worktree as the root (roleRunState). Null when the team cannot be read.
 */
async function runningRoles(
  io: InitIo,
  host: HostIo,
  main: InitLocations,
  worktree: string,
): Promise<readonly string[] | null> {
  const team = await readTeam(io, main.root, 'epic', null)
  if (team.kind === 'refuse') return null
  const { state, roles } = team.value
  const locations: InitLocations = { ...main, root: worktree, givenRoot: worktree }
  const running: string[] = []
  for (const { id } of roles) {
    const roleState = await roleRunState(io, host, { locations, id, launchStart: state.launchStart })
    if (roleState === 'running') running.push(id)
  }

  return running
}

/**
 * The consent of --force (D-152, D-134): null once the person answers REMOVE_OPTION to the one epicDoneQuestion, asked
 * with askChoice under EPIC_DONE_HEADER, the keeping answer first; else the reply that keeps the worktree:
 * EPIC_DONE_NO_DIALOG when the session has no dialog, epicKeptReply for the keeping answer, a dismissal or no usable
 * answer.
 */
async function forcedRefusal(io: InitIo, key: string, problems: readonly string[]): Promise<string | null> {
  if ((await io.isInteractive()) !== true) return EPIC_DONE_NO_DIALOG
  const answer = await askChoice(io, {
    question: epicDoneQuestion(key, problems),
    spec: { options: EPIC_DONE_OPTIONS, header: EPIC_DONE_HEADER },
    parse: removesWorktree,
    accepts: quotedLabels(EPIC_DONE_OPTIONS),
  })
  if (answer.kind !== 'answered' || !answer.value) return epicKeptReply(key)

  return null
}

/**
 * The stale-lock rule of /cadre epic done (D-152, D-170), with or without --force: null for a worktree that is not
 * locked, or whose lock names a process PS_ARGV finds ended (exit 1) and UNLOCK_ARGV then clears; else the refusal:
 * epicLockedReply for a lock that names no process (lockPid), epicLockLiveReply for one that still runs (exit 0),
 * epicLockUnknownReply when ps cannot tell (any other exit, or no run), epicUnlockFailedReply when the unlock fails.
 * A lock is never cleared for a process that may still run.
 */
async function lockRefusal(host: HostIo, root: string, worktree: DoneWorktree): Promise<string | null> {
  const { locked } = worktree
  if (locked === null) return null
  const pid = lockPid(locked)
  if (pid === null) return epicLockedReply(locked)
  const ps = await host.run(PS_ARGV(pid), { timeoutMs: PS_TIMEOUT_MS })
  if (ps === null || (ps.exitCode !== 0 && ps.exitCode !== 1)) return epicLockUnknownReply(pid)
  if (ps.exitCode === 0) return epicLockLiveReply(pid)
  const unlocked = await host.run(UNLOCK_ARGV(root, worktree.path), { timeoutMs: GIT_TIMEOUT_MS })
  if (hasRunFailed(unlocked)) return epicUnlockFailedReply(pid)

  return null
}

/**
 * `/cadre epic done <KEY>` in the main checkout's root session (D-152, D-165, D-169 to D-171). Before anything is
 * removed it refuses, in this order: a key epicKeyOf refuses (epicBadKeyReply), before anything runs; the repo
 * refusals of repoGuard, in the epic wording; a root that CHECKOUT_ARGV and checkoutOf do not show as the main
 * checkout (epicNotMainReply or EPIC_UNKNOWN_CHECKOUT); a worktree list git cannot give (EPIC_DONE_NO_LIST); no
 * registered worktree on an epic branch of the key (epicNotFoundReply), or more than one (epicManyWorktreesReply). The
 * epic record is read from the git dir git names for the worktree. Then all three checks run before any change: clean
 * (cleanStateOf of STATUS_ARGV), merged into the recorded base (MERGED_ARGV, `no-record` with no record or no base)
 * and no role of the team, read from the main checkout, reading `running` there (roleRunState, D-171). Without
 * `--force`, any reason of epicDoneProblems keeps the worktree with epicDoneRefusal, which lists them all, a check that
 * cannot tell included. With `--force` one consent question always comes, reasons or not, listing them (forcedRefusal,
 * D-134): only its yes goes on, and no dialog, a dismissal or the keeping answer removes nothing. Then the stale-lock
 * rule (lockRefusal): a lock is cleared only when the process it names has ended, and any other lock refuses, with or
 * without `--force`. The worktree's folders are then listed, and each recorded link epicLinkRemovals keeps (listed as a
 * link, below real folders only) is removed with linkRemoveArgv, in sorted order, never with `-r`; any other recorded
 * path is left to git (03.1-W5 M1), and then the worktree with REMOVE_ARGV, with `--force` only on the forced path; a
 * remove that fails or cannot run gives epicRemoveFailedReply. The branch is never deleted, and the reply is
 * epicRemovedText.
 */
export async function runEpicDone(
  io: InitIo,
  host: HostIo,
  options: { readonly key: string; readonly force: boolean },
): Promise<string> {
  const key = epicKeyOf(options.key)
  const keySlug = key === null ? null : epicSlug(key, '')
  if (key === null || keySlug === null) return epicBadKeyReply(options.key)
  const guard = await repoGuard(io, 'epic')
  if (guard.kind === 'refuse') return guard.text
  const main = guard.locations
  const checkout = checkoutOf(await host.run(CHECKOUT_ARGV(main.root), { timeoutMs: GIT_TIMEOUT_MS }))
  if (checkout.kind === 'linked') return epicNotMainReply(checkout.main)
  if (checkout.kind === 'unknown') return EPIC_UNKNOWN_CHECKOUT
  const listed = await host.run(WORKTREE_LIST_ARGV(main.root), { timeoutMs: GIT_TIMEOUT_MS })
  if (listed === null || listed.exitCode !== 0) return EPIC_DONE_NO_LIST
  const found = parseWorktreeList(listed.stdout).flatMap((entry): DoneWorktree[] =>
    !entry.isMain && entry.branch !== null && isEpicBranchOf(entry.branch, keySlug)
      ? [{ path: entry.path, branch: entry.branch, locked: entry.locked }]
      : [],
  )
  if (found.length > 1) return epicManyWorktreesReply(found.map(entry => entry.path))
  const [worktree] = found
  if (worktree === undefined) return epicNotFoundReply(key)
  const { path, branch } = worktree
  const record = await doneRecordOf(io, host, path)
  const base = record?.base ?? null

  const clean = cleanStateOf(await host.run(STATUS_ARGV(path), { timeoutMs: GIT_TIMEOUT_MS }))
  const merged = await mergedOf(host, main.root, branch, base)
  const running = await runningRoles(io, host, main, path)
  const problems = epicDoneProblems({ clean, merged, running: running ?? [], teamRead: running !== null, branch, base })
  if (problems.length > 0 && !options.force) return epicDoneRefusal(key, problems)
  const kept = options.force ? await forcedRefusal(io, key, problems) : null
  if (kept !== null) return kept
  const locked = await lockRefusal(host, main.root, worktree)
  if (locked !== null) return locked

  const links = sortedUnique(record?.links ?? [])
  const tree = await listingsOf(io, path, sortedUnique(['', ...links.flatMap(foldersAbove)]))
  for (const target of epicLinkRemovals(path, links, tree)) {
    await host.run(linkRemoveArgv(target), { timeoutMs: MIRROR_STEP_TIMEOUT_MS })
  }
  const removed = await host.run(REMOVE_ARGV(main.root, path, options.force), { timeoutMs: REMOVE_TIMEOUT_MS })
  if (hasRunFailed(removed)) return epicRemoveFailedReply(key)

  return epicRemovedText(key, path, branch)
}
