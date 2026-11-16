/**
 * The mirror run of /cadre epic (D-147, D-148, D-163), a layer 11 module: mirrorSteps lists the main checkout's
 * untracked and ignored entries with git, plans the mirror (epic/mirror), writes the worktree's excludes file in its
 * git dir and points git at it, then runs each step through the HostIo port and stops at the first that fails, with
 * the replies of a failed listing, excludes setup or step and the warning of an unreadable global excludes file. It
 * imports core, git/argv, host/steps, scan and the epic modules below it; epic/create runs it, and epic/done reads its
 * listings and its included paths.
 */
import type { HostIo, InitIo, PortEntry } from '../../types'
import { reportText, sortedUnique } from '../core/text'
import { GIT_TIMEOUT_MS } from '../git/argv'
import { hasRunFailed } from '../host/steps'
import { t } from '../locales/t'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { EXCLUDES_FILE, excludesText, globalExcludesPath, includedEntries, untrackedEntries } from './excludes'
import {
  EXCLUDES_CONFIG_ARGV,
  GLOBAL_EXCLUDES_ARGV,
  INCLUDED_ARGV,
  LS_IGNORED_ARGV,
  LS_OTHERS_ARGV,
  WORKTREE_CONFIG_ARGV,
  WORKTREE_INCLUDE_FILE,
  XDG_ARGV,
} from './git'
import { epicStepArgv, epicStepTimeoutMs, isHiddenCopy, mirrorPaths, mirrorPlan } from './mirror'
import type { EpicStep } from './mirror'

/**
 * The warning line when the user's global excludes file cannot be read or is over the read cap (D-147): the worktree's
 * own excludes file, which git reads in its place there, starts without its patterns. The path is shown cleaned.
 */
export function globalExcludesWarning(path: string): string {
  return t('epic.mirrorRun.globalExcludesWarning', { path: reportText(path) })
}

/**
 * The reply when git cannot list what the main checkout does not track or ignores (D-147): nothing is linked or copied.
 * The worktree stays, and the reply says to run /cadre epic with the key, cleaned, again.
 */
export function epicListFailedReply(key: string): string {
  return t('epic.mirrorRun.epicListFailedReply', { key: reportText(key) })
}

/**
 * The reply when the excludes file that hides the links from git cannot be set up (D-147): git named no git dir for the
 * worktree, the file could not be written, or a `git config` of it failed. It comes before any step, so no link was
 * made; the worktree stays, and the reply says to run /cadre epic with the key, cleaned, again.
 */
export function epicExcludesFailedReply(key: string): string {
  return t('epic.mirrorRun.epicExcludesFailedReply', { key: reportText(key) })
}

/**
 * The reply when a mirror mkdir or link step fails: the mirror stops at that step, named by its path below the
 * worktree root, cleaned. What ran before it stays and is recorded, and the next /cadre epic run of the key makes the
 * rest.
 */
export function epicStepFailedReply(path: string): string {
  return t('epic.mirrorRun.epicStepFailedReply', { path: reportText(path) })
}

/**
 * The reply when a mirror copy, or the move that places it, fails: the mirror stops there, and the reply names the
 * repo-relative path and its temporary sibling, cleaned, which the user removes before running /cadre epic again.
 */
export function epicCopyFailedReply(path: string, temp: string): string {
  return t('epic.mirrorRun.epicCopyFailedReply', { path: reportText(path), temp: reportText(temp) })
}

/** The reply of a failed step: a copy or a move names the copied path and its temporary sibling, else the path. */
function stepFailedReply(step: EpicStep, root: string, worktree: string): string {
  const inWorktree = (path: string) => path.slice(worktree.length + 1)
  if (step.kind === 'copy') return epicCopyFailedReply(step.source.slice(root.length + 1), inWorktree(step.path))
  if (step.kind === 'move') return epicCopyFailedReply(inWorktree(step.path), inWorktree(step.source))

  return epicStepFailedReply(inWorktree(step.path))
}

/** What the mirror stage of runEpic did: the reply it stopped with (else null), what it made, and its warnings. */
export type Mirrored = {
  readonly failure: string | null
  /** The repo-relative paths of the links whose step ran. */
  readonly links: readonly string[]
  /** The repo-relative paths of the copies whose move into place ran. */
  readonly copies: readonly string[]
  /** The repo-relative folders the plan walked whose mkdir step ran. */
  readonly walked: readonly string[]
  readonly warnings: readonly string[]
}

/** The listing of each folder `rels` names below `base` ('' for `base` itself); a folder it cannot list is left out. */
export async function listingsOf(
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
 * The paths of the main checkout at `root` that its WORKTREE_INCLUDE_FILE names and git ignores (includedEntries over
 * the INCLUDED_ARGV run and `ignored`, the LS_IGNORED_ARGV output): [] with no such file, null when the run fails. The
 * mirror copies these paths, and epic done copies back only the recorded copies among them.
 */
export async function includedOf(
  io: InitIo,
  host: HostIo,
  root: string,
  ignored: string,
): Promise<readonly string[] | null> {
  const include = await io.read(`${root}/${WORKTREE_INCLUDE_FILE}`, MAX_READ_BYTES)
  if (include.state === 'absent') return []
  const named = await host.run(INCLUDED_ARGV(root), { timeoutMs: GIT_TIMEOUT_MS })
  if (named === null || named.exitCode !== 0) return null

  return includedEntries(named.stdout, ignored)
}

/**
 * The mirror of the main checkout at `root` into the worktree, whose git dir `gitDir` is absolute: the two ls-files
 * runs and, when the main checkout has a WORKTREE_INCLUDE_FILE, a third that lists the paths it names, which the mirror
 * copies (includedOf); a run that fails or cannot start stops it with epicListFailedReply. Then the folders
 * mirrorPaths names listed in both checkouts, and mirrorPlan. The excludes file is then written in the git dir: the
 * user's global excludes text (globalExcludesOf), then the links `recorded` holds and the plan's own, and each hidden
 * copy (isHiddenCopy: a copy of a git file or of the sizing rubric), recorded (`recordedCopies`) or planned, once each.
 * The worktree is pointed at it with WORKTREE_CONFIG_ARGV, then EXCLUDES_CONFIG_ARGV, on every run, as both are
 * idempotent: a write or run that fails stops it with epicExcludesFailedReply, before any step. Each step then runs
 * with its epicStepArgv and epicStepTimeoutMs, and the first one that fails stops it: epicCopyFailedReply for a copy
 * or its move, else epicStepFailedReply. What ran before the stop is in the result, a copy only once its move ran and
 * a walked folder once its mkdir ran.
 */
export async function mirrorSteps(
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
  const listFailed: Mirrored = { failure: epicListFailedReply(key), links: [], copies: [], walked: [], warnings: [] }
  const others = await host.run(LS_OTHERS_ARGV(root), { timeoutMs: GIT_TIMEOUT_MS })
  if (others === null || others.exitCode !== 0) return listFailed
  const ignored = await host.run(LS_IGNORED_ARGV(root), { timeoutMs: GIT_TIMEOUT_MS })
  if (ignored === null || ignored.exitCode !== 0) return listFailed
  const included = await includedOf(io, host, root, ignored.stdout)
  if (included === null) return listFailed
  const entries = untrackedEntries(others.stdout, ignored.stdout)
  const paths = mirrorPaths(entries, input.roleIds, included)
  const main = await listingsOf(io, root, paths.main)
  const tree = await listingsOf(io, worktree, paths.tree)
  const plan = mirrorPlan({ root, worktree, entries, roleIds: input.roleIds, main, tree, included })
  const global = await globalExcludesOf(io, host, root, input.home)
  const warnings = [...plan.warnings, ...global.warnings]

  const file = `${input.gitDir}/${EXCLUDES_FILE}`
  const excludesFailed: Mirrored = {
    failure: epicExcludesFailedReply(key),
    links: [],
    copies: [],
    walked: [],
    warnings,
  }
  const hiddenCopies = [...input.recordedCopies, ...plan.copies].filter(isHiddenCopy)
  const hidden = sortedUnique([...input.recorded, ...plan.links, ...hiddenCopies])
  if (!(await host.write(file, excludesText(global.text, hidden)))) return excludesFailed
  for (const argv of [WORKTREE_CONFIG_ARGV(root), EXCLUDES_CONFIG_ARGV(worktree, file)]) {
    const configured = await host.run(argv, { timeoutMs: GIT_TIMEOUT_MS })
    if (hasRunFailed(configured)) return excludesFailed
  }

  const ran: EpicStep[] = []
  const made = (kind: EpicStep['kind']) =>
    ran.filter(step => step.kind === kind).map(step => step.path.slice(worktree.length + 1))
  const walked = () => plan.walked.filter(folder => made('mkdir').includes(folder))
  for (const step of plan.steps) {
    const done = await host.run(epicStepArgv(step), { timeoutMs: epicStepTimeoutMs(step) })
    if (hasRunFailed(done)) {
      const failure = stepFailedReply(step, root, worktree)

      return { failure, links: made('link'), copies: made('move'), walked: walked(), warnings }
    }
    ran.push(step)
  }

  return { failure: null, links: made('link'), copies: made('move'), walked: walked(), warnings }
}
