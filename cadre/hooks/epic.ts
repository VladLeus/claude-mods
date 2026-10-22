/**
 * `/cadre epic <KEY> [title]` (D-143 to D-147, D-162 to D-164): the key and slug rules, the worktree path, the
 * `git worktree add` argv, the lookup of an epic by its key and the epic record as pure functions, and runEpic, the
 * command itself, which checks the repo and runs git through the HostIo port only, as runStart does. An epic is a
 * tracker epic that the PM role fetches (D-143): cadre takes the key as typed and slugs it for names. The epic's
 * worktree is `<root>/.claude/worktrees/<slug>` in the main checkout, on the branch `epic/<slug>` made from the current
 * HEAD (D-146). Tracked state such as `.planning/` comes with the branch and is never linked (D-150).
 */
import type { EpicRecord, HostIo, InitIo, RoleSpec, TemplateRoleId, TerminalChoice } from '../types'
import { allOrNull, isObject, MAX_READ_BYTES, parseJsonValue } from './facts'
import { readTeam, repoGuard } from './init'
import { stableJson } from './plan'
import { reportText } from './render'
import { standsFor } from './roles'
import { CHECKOUT_ARGV, checkoutOf } from './scan'
import { claudeRefusal, launcherRead } from './start'

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
 * The warning line when the new worktree got no epic record (D-164): git gave no absolute git dir for it, or the write
 * failed. The worktree stays and the run goes on; the key is shown cleaned.
 */
export function epicNoRecordWarning(key: string): string {
  return (
    `cadre could not write ${EPIC_RECORD_FILE} for the epic ${reportText(key)}: git gave no git dir for its ` +
    'worktree, or the write failed.'
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
 * title, the line of outcomeLine with the worktree path and its branch, then one `warning: ` line per warning. The key,
 * title, path and branch are shown cleaned.
 */
export function epicCreatedText(input: {
  readonly key: string
  readonly title: string
  readonly path: string
  readonly branch: string
  readonly outcome: 'created' | 'reused' | 're-added'
  readonly warnings: readonly string[]
}): string {
  return [
    `cadre epic ${reportText(input.key)}`,
    ...(input.title === '' ? [] : [`Title: ${reportText(input.title)}`]),
    outcomeLine(input.outcome, reportText(input.path), reportText(input.branch)),
    ...input.warnings.map(warning => `warning: ${warning}`),
  ].join('\n')
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
 * adds nothing, and the reply shows the title of its epic record, else the title typed. Otherwise the worktree
 * `<root>/.claude/worktrees/<name>` is added back on the kept branch, named for it, or made on the new branch
 * `epic/<slug>` from the current HEAD: a name isEpicSlug refuses, or a path that already exists (epicPathExistsReply),
 * stops it before the one `git worktree add` through the host; an add that fails or cannot start gives
 * epicAddFailedReply, and the branch is never deleted. The worktree then gets its epic record in its git dir (D-164):
 * the key, its name as the slug, the title typed, the branch, the base (the branch checked out at the root, else its
 * commit, else null) and the time; a git dir git does not name as an absolute path, or a write that fails, adds the
 * epicNoRecordWarning line and the run goes on. Running /cadre epic is the consent to these steps (D-165), so it asks
 * nothing. The reply is epicCreatedText. `options.terminal` is where the roles will open (D-167).
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

  if (lookup.kind === 'reuse') {
    const asked = await host.run(GIT_DIR_ARGV(lookup.path), { timeoutMs: GIT_TIMEOUT_MS })
    const recordDir = asked !== null && asked.exitCode === 0 ? asked.stdout.trim() : ''
    const read = recordDir.startsWith('/') ? await io.read(epicRecordPath(recordDir), MAX_READ_BYTES) : null
    const record = read !== null && read.state === 'text' ? parseEpicRecord(read.text) : null
    const title = record === null ? options.title : record.title

    return epicCreatedText({ key, title, path: lookup.path, branch: lookup.branch, outcome: 'reused', warnings: [] })
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
  const isRecorded = gitDir.startsWith('/') && (await host.write(epicRecordPath(gitDir), epicRecordText(record)))
  const warnings = isRecorded ? [] : [epicNoRecordWarning(key)]

  return epicCreatedText({ key, title: options.title, path, branch, outcome: isNew ? 'created' : 're-added', warnings })
}
