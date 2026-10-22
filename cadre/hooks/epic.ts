/**
 * `/cadre epic <KEY> [title]` (D-143 to D-147, D-162): the key and slug rules, the worktree path and the
 * `git worktree add` argv as pure functions, and runEpic, the command itself, which checks the repo and runs git
 * through the HostIo port only, as runStart does. An epic is a tracker epic that the PM role fetches (D-143): cadre
 * takes the key as typed and slugs it for names. The epic's worktree is `<root>/.claude/worktrees/<slug>` in the main
 * checkout, on the branch `epic/<slug>` made from the current HEAD (D-146). Tracked state such as `.planning/` comes
 * with the branch and is never linked (D-150).
 */
import type { HostIo, InitIo, TerminalChoice } from '../types'
import { repoGuard } from './init'
import { reportText } from './render'

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
 * `/cadre epic <KEY> [title]` in the main checkout's root session (D-145, D-146, D-147). It refuses, in this order: a
 * key epicKeyOf refuses (epicBadKeyReply), before anything runs; the repo refusals of repoGuard, in the epic wording;
 * and a slug isEpicSlug refuses. It then adds the worktree `<root>/.claude/worktrees/<slug>` on the new branch
 * `epic/<slug>` from the current HEAD with one `git worktree add -b` through the host; a run that fails or cannot start
 * gives epicAddFailedReply, and the branch is never deleted. Running /cadre epic is the consent to these steps
 * (D-165), so it asks nothing. The reply is epicCreatedText. `options.terminal` is where the roles will open (D-167).
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
  const { root } = guard.locations
  const slug = epicSlug(key, options.title)
  if (slug === null) return epicBadKeyReply(options.key)
  if (!isEpicSlug(slug)) return epicBadNameReply(slug)
  const branch = `${EPIC_BRANCH_PREFIX}${slug}`
  const path = worktreePathOf(root, slug)
  const added = await host.run(worktreeAddArgv(root, path, branch, true), { timeoutMs: GIT_ADD_TIMEOUT_MS })
  if (added === null || added.exitCode !== 0) return epicAddFailedReply(branch, true)

  return epicCreatedText({ key, title: options.title, path, branch, outcome: 'created', warnings: [] })
}
