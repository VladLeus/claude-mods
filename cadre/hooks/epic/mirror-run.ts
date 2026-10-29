/**
 * The mirror run of /cadre epic (D-147, D-148, D-163), a layer 11 module: mirrorSteps lists the main checkout's
 * untracked and ignored entries with git, plans the mirror (epic/mirror), writes the worktree's excludes file in its
 * git dir and points git at it, then runs each step through the HostIo port and stops at the first that fails, with
 * the replies of a failed listing, excludes setup or step and the warning of an unreadable global excludes file. It
 * imports core, git/argv, host/steps, scan and the epic modules below it; epic/create runs it, and epic/done reads its
 * listings.
 */
import type { HostIo, InitIo, PortEntry } from '../../types'
import { reportText, sortedUnique } from '../core/text'
import { GIT_TIMEOUT_MS } from '../git/argv'
import { hasRunFailed } from '../host/steps'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { EXCLUDES_FILE, excludesText, globalExcludesPath, untrackedEntries } from './excludes'
import {
  EXCLUDES_CONFIG_ARGV,
  GLOBAL_EXCLUDES_ARGV,
  LS_IGNORED_ARGV,
  LS_OTHERS_ARGV,
  WORKTREE_CONFIG_ARGV,
  XDG_ARGV,
} from './git'
import { epicStepArgv, isGitFile, MIRROR_STEP_TIMEOUT_MS, mirrorPaths, mirrorPlan } from './mirror'
import type { EpicStep } from './mirror'

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
 * The mirror of the main checkout at `root` into the worktree (D-147, D-148), whose git dir `gitDir` is absolute: the
 * two ls-files runs (a run that fails or cannot start stops it with epicListFailedReply), the folders mirrorPaths
 * names listed in both checkouts, and mirrorPlan. The excludes file is then written in the git dir: the user's global
 * excludes text (globalExcludesOf), then the links `recorded` holds and the plan's own, and each copy of a
 * GIT_FILE_NAMES file, recorded (`recordedCopies`) or planned, once each (D-163, 03.1 S1). The worktree is pointed at
 * it with WORKTREE_CONFIG_ARGV, then EXCLUDES_CONFIG_ARGV, on every run, as both are idempotent: a write or run that
 * fails stops it with epicExcludesFailedReply, before any step. Each step then runs with its epicStepArgv, and the
 * first one that fails stops it with epicStepFailedReply. What ran before the stop is in the result.
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
