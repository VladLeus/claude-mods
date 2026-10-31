/**
 * `/cadre epic <KEY> [title]` (D-143 to D-148, D-157, D-162 to D-167), a layer 11 module: runEpic, the command itself,
 * checks the repo, the team, the launchers and claude, finds or adds the epic's worktree by its key (epic/lookup),
 * mirrors the main checkout into it (epic/mirror-run), writes its record (epic/record), and renders each picked role
 * into the worktree with renderRole (D-157) and opens it there, through the InitIo and HostIo ports only, as runStart
 * does. An epic is a tracker epic that the PM role fetches (D-143): cadre takes the key as typed and slugs it for
 * names. The epic's worktree is `<root>/.claude/worktrees/<slug>` in the main checkout, on the branch `epic/<slug>`
 * made from the current HEAD (D-146). Tracked state such as `.planning/` comes with the branch and is never linked
 * (D-150). It imports core, generate/launcher, git, guards/repo, host/steps, paths, roles/template, scan, start, team,
 * ui and the epic modules; register and the goldens run it.
 */
import type { CadreState, EpicRecord, HostIo, InitIo, InitLocations, RoleSpec, TerminalChoice } from '../../types'
import { reportText, sortedUnique } from '../core/text'
import { hasRuntimeKickoff, shQuote } from '../generate/launcher'
import { GIT_TIMEOUT_MS } from '../git/argv'
import { CHECKOUT_ARGV, checkoutOf } from '../git/checkout'
import { repoGuard } from '../guards/repo'
import { hasRunFailed } from '../host/steps'
import { t } from '../locales/t'
import { launcherPath } from '../paths'
import { standIn } from '../roles/template'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { claudeRefusal } from '../start/claude-version'
import { launcherRead } from '../start/launcher-check'
import { renderRole } from '../start/render'
import { compileTeam, readTeam, regenBadRole } from '../team'
import { terminalHostOf } from '../ui/open'
import {
  clipboardRun,
  COPIED_LINE,
  launcherCommand,
  NOT_COPIED_LINE,
  TERMINAL_OPEN_TIMEOUT_MS,
  terminalPlan,
} from '../ui/terminal'
import type { TerminalPlan } from '../ui/terminal'
import {
  BASE_BRANCH_ARGV,
  BASE_COMMIT_ARGV,
  EPIC_BRANCHES_ARGV,
  GIT_ADD_TIMEOUT_MS,
  GIT_DIR_ARGV,
  WORKTREE_LIST_ARGV,
  worktreeAddArgv,
  worktreePathOf,
} from './git'
import { epicBadKeyReply, epicBadNameReply, epicKeyOf, epicSlug, isEpicSlug } from './key'
import { epicKickoffText } from './kickoff'
import type { EpicWorktree } from './kickoff'
import { epicWorktreeLauncherCheck } from './launcher'
import { EPIC_NO_WORKTREE_LIST, epicLookup, parseWorktreeList } from './lookup'
import { epicExcludesFailedReply, mirrorSteps } from './mirror-run'
import {
  EPIC_CANCELLED,
  EPIC_UNKNOWN_CHECKOUT,
  epicNotMainReply,
  epicOldLauncherReply,
  epicParentOf,
  epicPickedRoles,
  epicPmOf,
  TL_ROLE,
} from './pick'
import { EPIC_BRANCH_PREFIX, EPIC_RECORD_FILE, epicRecordPath, epicRecordText, readEpicRecord } from './record'

/**
 * The reply when `git worktree add` fails or cannot run (RESEARCH Pitfall 3), naming the branch cleaned. With `-b`,
 * git may have made the new branch before it failed: the reply says the branch may now exist and is kept, since cadre
 * never deletes a branch.
 */
export function epicAddFailedReply(branch: string, isNew: boolean): string {
  const name = reportText(branch)
  if (!isNew) return t('epic.create.epicAddFailedReply', { name })

  return t('epic.create.epicAddFailedReply2', { name })
}

/**
 * The refusal when the worktree path already exists and git does not list a worktree of the key there (D-147, D-163):
 * cadre adds no worktree over it. The path is shown cleaned.
 */
export function epicPathExistsReply(path: string): string {
  return t('epic.create.epicPathExistsReply', { path: reportText(path) })
}

/**
 * The warning line when the new worktree got no epic record (D-164): the write of the record to the worktree's git dir
 * failed. The worktree stays and the run goes on; the key is shown cleaned.
 */
export function epicNoRecordWarning(key: string): string {
  return t('epic.create.epicNoRecordWarning', { epicRecordFile: EPIC_RECORD_FILE, key: reportText(key) })
}

/** The line that says how the epic came by its worktree: made on a new branch, reused, or added back on a kept one. */
function outcomeLine(outcome: 'created' | 'reused' | 're-added', path: string, branch: string): string {
  if (outcome === 'created') return t('epic.create.outcomeLine', { path, branch })
  if (outcome === 'reused') return t('epic.create.outcomeLine2', { path, branch })

  return t('epic.create.outcomeLine3', { path, branch })
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
    t('epic.create.epicCreatedText', { key: reportText(input.key) }),
    ...(input.title === '' ? [] : [t('epic.create.epicCreatedText2', { title: reportText(input.title) })]),
    outcomeLine(input.outcome, reportText(input.path), reportText(input.branch)),
    t('epic.create.epicCreatedText3', { linked: input.linked, copied: input.copied }),
    ...input.warnings.map(warning => t('epic.create.epicCreatedText4', { warning })),
  ].join('\n')
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

  return { line: t('epic.create.openedRole', { name: plan.name }), command: null, refusal: null }
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
      lines.push(t('epic.create.openedLines', { id, line }))
      continue
    }
    const launcher = launcherCommand(worktree, id)
    const plan = terminalPlan({ choice: terminal, tmux, termProgram, isMacOs, id, root: worktree, command: launcher })
    const opened = await openedRole(host, plan, `cd -- ${shQuote(worktree)} && ${launcher}`)
    lines.push(t('epic.create.openedLines2', { id, line: opened.line }))
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
    warnings.push(...render.warnings.map(warning => t('epic.create.renderedLines', { id, warning })))
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
  // Defensive: a key that passed EPIC_KEY_PATTERN starts with a letter or digit, so neither slug is null.
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
    const parsed = await readEpicRecord(io, host, lookup.path)
    const asked = await host.run(GIT_DIR_ARGV(lookup.path), { timeoutMs: GIT_TIMEOUT_MS })
    const recordDir = asked !== null && asked.exitCode === 0 ? asked.stdout.trim() : ''
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
