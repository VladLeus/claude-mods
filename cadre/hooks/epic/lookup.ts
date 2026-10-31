/**
 * The epic lookup of /cadre epic (D-163), a layer 11 module: the worktrees git lists in its porcelain format
 * (parseWorktreeList), and epicLookup, which decides by the key, never by the title, whether the epic's worktree is
 * reused, added back on a kept branch or new, with the refusals of a key that has more than one. It is pure and
 * imports core and epic/record; epic/create and epic/done read it.
 */
import { reportText } from '../core/text'
import { t } from '../locales/t'
import { EPIC_BRANCH_PREFIX } from './record'

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
export const EPIC_NO_WORKTREE_LIST = t('epic.lookup.epicNoWorktreeList')

/**
 * The refusal of a key with more than one worktree on its epic branches (D-163): cadre reuses one and does not pick
 * it, so the reply names them all, cleaned.
 */
export function epicManyWorktreesReply(paths: readonly string[]): string {
  return t('epic.lookup.epicManyWorktreesReply') +
  reportText(paths.join(', '))
}

/**
 * The refusal of a key with no worktree and more than one kept epic branch (D-163): cadre adds the worktree back on one
 * and does not pick it, so the reply names them all, cleaned.
 */
export function epicManyBranchesReply(branches: readonly string[]): string {
  return t('epic.lookup.epicManyBranchesReply', { branches: reportText(branches.join(', ')) })
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
