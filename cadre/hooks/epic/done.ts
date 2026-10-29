/**
 * `/cadre epic done <key>` (D-152, D-165, D-169 to D-171), a layer 11 module: runEpicDone finds the epic's worktree by
 * its key in the main checkout and removes it only when it is clean, merged into its recorded base and no role there
 * reads running (roleRunState), each failed check named and `--force` asking once; it clears a lock only when its
 * process has ended, removes the links the record names, then the worktree, and never deletes the branch. It runs
 * through the InitIo and HostIo ports and imports core, git, guards/repo, host/steps, paths, status, team, ui/ask and
 * the epic modules below it; register and the goldens run it.
 */
import type { HostIo, HostRun, InitIo, InitLocations, PortEntry } from '../../types'
import { reportText, sortedUnique } from '../core/text'
import { GIT_TIMEOUT_MS } from '../git/argv'
import { CHECKOUT_ARGV, checkoutOf } from '../git/checkout'
import { repoGuard } from '../guards/repo'
import { hasRunFailed } from '../host/steps'
import { foldersAbove } from '../paths'
import { roleRunState } from '../status/autopilot-files'
import { readTeam } from '../team'
import { askChoice, quotedLabels } from '../ui/ask'
import {
  linkRemoveArgv,
  MERGED_ARGV,
  PS_ARGV,
  PS_TIMEOUT_MS,
  REMOVE_ARGV,
  REMOVE_TIMEOUT_MS,
  STATUS_ARGV,
  UNLOCK_ARGV,
  WORKTREE_LIST_ARGV,
} from './git'
import { epicBadKeyReply, epicKeyOf, epicSlug } from './key'
import { epicManyWorktreesReply, isEpicBranchOf, parseWorktreeList } from './lookup'
import { listedEntry, MIRROR_STEP_TIMEOUT_MS } from './mirror'
import { listingsOf } from './mirror-run'
import { EPIC_UNKNOWN_CHECKOUT, epicNotMainReply } from './pick'
import { EPIC_RECORD_FILE, readEpicRecord } from './record'

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
  const record = await readEpicRecord(io, host, path)
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
