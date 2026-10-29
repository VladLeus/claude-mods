import { describe, expect, test } from 'claude-code/testing'

import type { AskSpec, EpicRecord, HostIo, HostRun, ManifestEntry, RoleSpec, TerminalChoice } from '../../types'
import { sha256Hex } from '../core/hash'
import { stableJson } from '../core/json'
import { cadreJsonText, roleJsonText } from '../generate/docs'
import { RUNTIME_KICKOFF_TEST } from '../generate/launcher'
import { CHECKOUT_ARGV } from '../git/checkout'
import { entry, hostWorld, link, memHost, memIo, memWorld, templateRole } from '../testkit'
import type { HostCall, HostRunRule, HostWorld, HostWrite, MemHost, MemWorld } from '../testkit'
import { runEpic } from './create'
import {
  cleanStateOf,
  EPIC_DONE_NO_DIALOG,
  EPIC_DONE_NO_LIST,
  epicDoneProblems,
  epicDoneQuestion,
  epicDoneRefusal,
  epicKeptReply,
  epicLinkRemovals,
  epicLockedReply,
  epicLockLiveReply,
  epicLockUnknownReply,
  epicNotFoundReply,
  epicRemovedText,
  epicRemoveFailedReply,
  epicUnlockFailedReply,
  lockPid,
  mergedStateOf,
  runEpicDone,
} from './done'
import {
  GIT_DIR_ARGV,
  linkRemoveArgv,
  MERGED_ARGV,
  REMOVE_ARGV,
  STATUS_ARGV,
  UNLOCK_ARGV,
  WORKTREE_LIST_ARGV,
} from './git'
import { EPIC_UNKNOWN_CHECKOUT } from './pick'
import { EPIC_RECORD_FILE, epicRecordText } from './record'

/** The worktree `/cadre epic PROJ-1 Add retry` makes in the fixture repo /repo (D-146). */
const WORKTREE = '/repo/.claude/worktrees/proj-1-add-retry'

/** The branch of that worktree (D-146). */
const BRANCH = 'epic/proj-1-add-retry'

/** The git dir of that worktree, where its epic record and its excludes file lie (D-147, D-164). */
const GIT_DIR = '/repo/.git/worktrees/proj-1-add-retry'

/** A fake host rule that answers `argv` with this exit code and output; a null exit code is a run the host rejected. */
function rule(argv: readonly string[], exitCode: number | null, stdout = ''): HostRunRule {
  return { argv, result: exitCode === null ? null : { exitCode, stdout, stderr: '' } }
}

/** The probe of /repo answered as the main checkout: its git dir is the common dir (D-165). */
const MAIN_CHECKOUT = rule(CHECKOUT_ARGV('/repo'), 0, '/repo/.git\n/repo/.git\n')

/** `claude --version` of a claude new enough for cadre (D-107). */
const CLAUDE_OK = rule(['claude', '--version'], 0, '2.1.304 (Claude Code)\n')

/** The rules every epic run falls back to, after its own: the main checkout at /repo and a claude new enough. */
const BASE_RULES: readonly HostRunRule[] = [MAIN_CHECKOUT, CLAUDE_OK]

/** PM and BE, in the order cadre.json lists them in the epic worlds. */
const TEAM: readonly RoleSpec[] = [templateRole('pm'), templateRole('be')]

/**
 * A git repo at /repo; `over` changes the fields it names. It has no dialog, as in `claude -p`, so /cadre epic opens
 * every role without asking (D-166); the role picker specs set `interactive` to ask.
 */
function gitWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ interactive: false, dirs: { '/repo/.git': [] }, ...over })
}

/**
 * The text of a role's launcher in the epic worlds: launcherRead compares only its sha256 with the manifest, and
 * /cadre epic also wants the line that picks the epic kickoff (D-158).
 */
function launcherOf(id: string): string {
  const pick = `${RUNTIME_KICKOFF_TEST}"$root"/.cadre/${id}/kickoff.txt; fi`

  return `#!/bin/sh\n# the launcher of role ${id}\n${pick}\nexit 0\n`
}

/** The manifest entry of a role's launcher, holding the sha256 of launcherOf. */
async function launcherEntry(id: string): Promise<ManifestEntry> {
  return { path: `.cadre/bin/${id}`, sha256: await sha256Hex(launcherOf(id)), mode: 'exec' }
}

/**
 * A git repo at /repo after a plain init of `roles` (PM and BE by default): cadre.json lists them on the built-in
 * default, launched at the git root, recording `readUserMcp` (no consent to read ~/.claude.json by default), each
 * role.json is written from its role, and each launcher lies in `.cadre/bin/` with its sha256 in the manifest.
 */
async function teamWorld(roles: readonly RoleSpec[] = TEAM, readUserMcp = false): Promise<MemWorld> {
  const ids = roles.map(role => role.id)
  const state = cadreJsonText({
    schema: 1,
    cadreVersion: '0.2.0',
    framework: 'none',
    gitPolicy: 'definitions',
    roles: ids,
    launchStart: { kind: 'git-root' },
    readUserMcp,
  })
  const entries = await Promise.all(ids.map(launcherEntry))
  const files: Record<string, string> = {
    '/repo/.cadre/cadre.json': state,
    '/repo/.cadre/manifest.json': stableJson({ schema: 1, cadreVersion: '0.2.0', files: entries }),
  }
  for (const role of roles) {
    files[`/repo/.cadre/${role.id}/role.json`] = roleJsonText(role)
    files[`/repo/.cadre/bin/${role.id}`] = launcherOf(role.id)
  }

  return gitWorld({ files })
}

/** What runEpic replied, and every write and run the fake host was asked for, in call order. */
type EpicRun = {
  readonly reply: string
  readonly writes: readonly HostWrite[]
  readonly calls: readonly HostCall[]
  /** Each write as `write <path>` and each run as its argv joined by spaces, in the order of their shared counter. */
  readonly events: readonly string[]
  /** Every question the run asked, and the dialog spec of each, in order. */
  readonly asked: readonly string[]
  readonly specs: readonly AskSpec[]
}

/** What else an epic run is given: the answers to its questions, the host's environment and the `--terminal` value. */
type EpicExtra = {
  readonly answers?: readonly string[] | Readonly<Record<string, string>>
  readonly env?: HostWorld['env']
  readonly terminal?: Exclude<TerminalChoice, 'none'>
}

/** The fake host of the epic specs and what it was asked: each write and run numbered by one counter they share. */
type EpicHost = MemHost & {
  /** The counter value of each write, by its index in `writes`. */
  readonly writeAt: readonly number[]
  /** The counter value of each run, by its index in `calls`. */
  readonly callAt: readonly number[]
}

/**
 * The fake host of the epic specs, on top of memHost: these run rules first, then BASE_RULES; any other argv exits 0
 * with no output, and `env` holds the variables that are set. Each write and each run also takes the next value of one
 * counter they share, so a spec can tell whether a file was written before a command ran.
 */
function epicHost(runs: readonly HostRunRule[], env: HostWorld['env'] = {}): EpicHost {
  const host = memHost(hostWorld({ runs: [...runs, ...BASE_RULES], env }))
  const writeAt: number[] = []
  const callAt: number[] = []
  let counter = 0
  const io: HostIo = {
    write: async (path, text) => {
      writeAt.push(counter)
      counter += 1

      return host.io.write(path, text)
    },
    run: async (argv, options) => {
      callAt.push(counter)
      counter += 1

      return host.io.run(argv, options)
    },
    env: host.io.env,
  }

  return { ...host, io, writeAt, callAt }
}

/** The writes of `host` as `write <path>` and its runs as their argv joined by spaces, in shared-counter order. */
function eventsOf(host: EpicHost): string[] {
  const writes = host.writes.map((write, index) => ({ at: host.writeAt[index] ?? -1, label: `write ${write.path}` }))
  const calls = host.calls.map((call, index) => ({ at: host.callAt[index] ?? -1, label: call.argv.join(' ') }))

  return [...writes, ...calls].sort((a, b) => a.at - b.at).map(event => event.label)
}

/**
 * runEpic of `key` and `title` (PROJ-1 and Add retry by default) over `world`, with these run rules first and then
 * BASE_RULES; any other argv exits 0 with no output. `extra` gives the answers (none by default, so a question is
 * dismissed), the host's environment and the `--terminal` value (`auto` by default).
 */
async function epic(
  world: MemWorld,
  runs: readonly HostRunRule[],
  key = 'PROJ-1',
  title = 'Add retry',
  extra: EpicExtra = {},
): Promise<EpicRun> {
  const host = epicHost(runs, extra.env)
  const io = memIo(world, extra.answers ?? {})
  const reply = await runEpic(io.io, host.io, { key, title, terminal: extra.terminal ?? 'auto' })

  return { reply, writes: host.writes, calls: host.calls, events: eventsOf(host), asked: io.asked, specs: io.specs }
}

/** The epic record of PROJ-1 Add retry as a new worktree on a branch of `main` writes it. */
const RECORD: EpicRecord = {
  schema: 1,
  key: 'PROJ-1',
  slug: 'proj-1-add-retry',
  title: 'Add retry',
  branch: BRANCH,
  base: 'main',
  createdAt: 1_000_000,
  links: [],
  copies: [],
}

/** The epic record of WORKTREE with the links /cadre epic made there, as /cadre epic done reads it (D-164, D-170). */
const DONE_RECORD = epicRecordText({ ...RECORD, links: ['node_modules', '.cadre/bin/pm'] })

/** git listing the main checkout, then WORKTREE on BRANCH with `lines` (a `locked` line) at the end of its block. */
function listRule(lines = ''): HostRunRule {
  const main = 'worktree /repo\nHEAD a\nbranch refs/heads/main\n\n'
  const block = `worktree ${WORKTREE}\nHEAD b\nbranch refs/heads/${BRANCH}\n${lines}`

  return rule(WORKTREE_LIST_ARGV('/repo'), 0, `${main}${block}`)
}

/** The runs of an epic ready to remove: git lists WORKTREE, names its git dir, finds it clean and BRANCH in main. */
const DONE_RULES: readonly HostRunRule[] = [
  listRule(),
  rule(GIT_DIR_ARGV(WORKTREE), 0, `${GIT_DIR}\n`),
  rule(STATUS_ARGV(WORKTREE), 0),
  rule(MERGED_ARGV('/repo', BRANCH, 'main'), 0),
]

/**
 * A team world whose WORKTREE has DONE_RECORD as its epic record, based on main; the worktree lists node_modules and
 * .cadre/bin/pm as links below real folders.
 */
async function doneWorld(): Promise<MemWorld> {
  const world = await teamWorld()
  const dirs = {
    ...world.dirs,
    [WORKTREE]: [entry('.cadre', 'dir'), link('node_modules')],
    [`${WORKTREE}/.cadre`]: [entry('bin', 'dir')],
    [`${WORKTREE}/.cadre/bin`]: [link('pm')],
  }

  return { ...world, files: { ...world.files, [`${GIT_DIR}/${EPIC_RECORD_FILE}`]: DONE_RECORD }, dirs }
}

/** What else an epic done run is given: its key (PROJ-1 by default), `--force`, and the answers to its question. */
type DoneExtra = {
  readonly key?: string
  readonly force?: boolean
  readonly answers?: readonly string[]
}

/** runEpicDone over `world`, with these run rules first and then BASE_RULES; any other argv exits 0 with no output. */
async function epicDone(world: MemWorld, runs: readonly HostRunRule[], extra: DoneExtra = {}): Promise<EpicRun> {
  const host = epicHost(runs)
  const io = memIo(world, extra.answers ?? [])
  const reply = await runEpicDone(io.io, host.io, { key: extra.key ?? 'PROJ-1', force: extra.force ?? false })

  return { reply, writes: host.writes, calls: host.calls, events: eventsOf(host), asked: io.asked, specs: io.specs }
}

/** The removals an epic done run asked for, in call order: each `/bin/rm` and each `git -C <root> worktree remove`. */
function removals(run: EpicRun): (readonly string[])[] {
  return run.calls.map(call => call.argv).filter(argv => argv[0] === '/bin/rm' || argv[4] === 'remove')
}

/** Whether an argv deletes a branch or removes a folder with all it holds: what /cadre epic done never runs. */
function isDeleting(argv: readonly string[]): boolean {
  const isBranchDelete = argv.includes('branch') && (argv.includes('-d') || argv.includes('-D'))

  return isBranchDelete || (argv[0] === '/bin/rm' && argv.includes('-r'))
}

describe('removing a finished epic worktree (D-152, D-169 to D-171)', () => {
  test('a clean, merged, idle epic loses its recorded links, then its worktree; its branch is kept', async () => {
    const run = await epicDone(await doneWorld(), DONE_RULES)
    const argvs = run.calls.map(call => call.argv)
    const remove = ['git', '-C', '/repo', 'worktree', 'remove', WORKTREE]
    const removeAt = argvs.findIndex(argv => argv.join(' ') === remove.join(' '))
    const rmAt = argvs.flatMap((argv, index) => (argv[0] === '/bin/rm' ? [index] : []))

    expect(removals(run)).toEqual([
      ['/bin/rm', '-f', '--', `${WORKTREE}/.cadre/bin/pm`],
      ['/bin/rm', '-f', '--', `${WORKTREE}/node_modules`],
      remove,
    ])
    expect([rmAt.length, rmAt.every(index => index < removeAt)]).toEqual([2, true])
    expect(argvs.filter(isDeleting)).toEqual([])
    expect(run.reply).toBe(epicRemovedText('PROJ-1', WORKTREE, BRANCH))
    expect(run.reply).toContain(BRANCH)
  })

  test('a key with no worktree on an epic branch of its own is refused, and nothing is removed', async () => {
    const ten = 'worktree /repo/.claude/worktrees/proj-10\nHEAD c\nbranch refs/heads/epic/proj-10\n'
    const listed = rule(WORKTREE_LIST_ARGV('/repo'), 0, `worktree /repo\nHEAD a\nbranch refs/heads/main\n\n${ten}`)
    const run = await epicDone(await doneWorld(), [listed, ...DONE_RULES])

    expect(run.reply).toBe(epicNotFoundReply('PROJ-1'))
    expect(removals(run)).toEqual([])
  })

  test(
    'a recorded link below a folder that became a link, or no longer a link, is left to git; ' +
      'links below real folders are removed (03.1-W5 M1)',
    async () => {
      const world = await doneWorld()
      const linkedBin = { ...world, dirs: { ...world.dirs, [`${WORKTREE}/.cadre`]: [link('bin')] } }
      const fileAt = { ...world, dirs: { ...world.dirs, [`${WORKTREE}/.cadre/bin`]: [entry('pm')] } }
      const tree = new Map([
        ['', [entry('.cadre', 'dir'), link('node_modules')]],
        ['.cadre', [entry('bin', 'dir')]],
        ['.cadre/bin', [link('pm')]],
      ])

      for (const shown of [linkedBin, fileAt]) {
        const run = await epicDone(shown, DONE_RULES)

        expect(removals(run)).toEqual([
          ['/bin/rm', '-f', '--', `${WORKTREE}/node_modules`],
          ['git', '-C', '/repo', 'worktree', 'remove', WORKTREE],
        ])
        expect(run.reply).toBe(epicRemovedText('PROJ-1', WORKTREE, BRANCH))
      }
      expect(epicLinkRemovals(WORKTREE, ['node_modules', '.cadre/bin/pm', 'node_modules'], tree)).toEqual([
        `${WORKTREE}/.cadre/bin/pm`,
        `${WORKTREE}/node_modules`,
      ])
      expect(epicLinkRemovals(WORKTREE, ['.cadre/bin/pm'], new Map())).toEqual([])
    },
  )
})

/** What epicDoneProblems is given: the three checks, and the branch and base its reasons name. */
type DoneChecks = Parameters<typeof epicDoneProblems>[0]

/** The checks of an epic ready to remove: clean, merged into main, no role running, the team read. */
const READY: DoneChecks = {
  clean: 'clean',
  merged: 'merged',
  running: [],
  teamRead: true,
  branch: BRANCH,
  base: 'main',
}

/** `world` without the file at `path`. */
function withoutFile(world: MemWorld, path: string): MemWorld {
  return { ...world, files: Object.fromEntries(Object.entries(world.files).filter(([name]) => name !== path)) }
}

/** `world` with `text` as the file at `path`. */
function withFile(world: MemWorld, path: string, text: string): MemWorld {
  return { ...world, files: { ...world.files, [path]: text } }
}

describe('the refusals of epic done (D-169, D-171)', () => {
  test('epicDoneProblems gives one reason per failed check, the clean one first, then merged, then running', () => {
    const clean = epicDoneProblems({ ...READY, clean: 'unknown' })
    const merged = epicDoneProblems({ ...READY, merged: 'unknown' })
    const running = epicDoneProblems({ ...READY, running: ['pm', 'be'] })
    const all = epicDoneProblems({ ...READY, clean: 'unknown', merged: 'unknown', running: ['pm', 'be'] })

    expect(epicDoneProblems({ ...READY, clean: 'dirty' })).toHaveLength(1)
    expect([clean.length, merged.length, running.length]).toEqual([1, 1, 1])
    expect(all).toEqual([...clean, ...merged, ...running])
    expect(epicDoneProblems(READY)).toEqual([])
  })

  test('a status or merge-base run reads as a state; one that cannot tell is unknown, never clean or merged', () => {
    const ran = (exitCode: number, stdout = ''): HostRun => ({ exitCode, stdout, stderr: '' })

    expect([ran(0), ran(0, ' M src/a.ts\n'), ran(128), null].map(cleanStateOf)).toEqual([
      'clean',
      'dirty',
      'unknown',
      'unknown',
    ])
    expect([ran(0), ran(1), ran(128), null].map(mergedStateOf)).toEqual(['merged', 'not-merged', 'unknown', 'unknown'])
    expect(STATUS_ARGV(WORKTREE)).toEqual(['git', '-C', WORKTREE, 'status', '--porcelain', '--untracked-files=normal'])
  })

  test('a record that is missing, does not parse or has no base refuses as no record, with no merge-base', async () => {
    const world = await doneWorld()
    const path = `${GIT_DIR}/${EPIC_RECORD_FILE}`
    const unbased = epicRecordText({ ...RECORD, base: null, links: ['node_modules'] })
    const worlds = [withoutFile(world, path), ...['not a record', unbased].map(text => withFile(world, path, text))]
    const refusal = epicDoneRefusal('PROJ-1', epicDoneProblems({ ...READY, merged: 'no-record', base: null }))

    for (const shown of worlds) {
      const run = await epicDone(shown, DONE_RULES)

      expect(run.reply).toBe(refusal)
      expect(run.calls.filter(call => call.argv.includes('merge-base'))).toEqual([])
      expect(removals(run)).toEqual([])
    }
    expect(refusal).toContain(EPIC_RECORD_FILE)
  })

  test('a dirty worktree on an unmerged branch is refused once, naming both reasons; nothing is removed', async () => {
    const dirty = rule(STATUS_ARGV(WORKTREE), 0, ' M src/a.ts\n')
    const unmerged = rule(MERGED_ARGV('/repo', BRANCH, 'main'), 1)
    const run = await epicDone(await doneWorld(), [dirty, unmerged, ...DONE_RULES])
    const problems = epicDoneProblems({ ...READY, clean: 'dirty', merged: 'not-merged' })

    expect(problems).toHaveLength(2)
    expect(run.reply).toBe(epicDoneRefusal('PROJ-1', problems))
    expect(removals(run)).toEqual([])
  })

  test('a role that reads running in the worktree refuses, the reason naming it; a run in main does not', async () => {
    const world = await doneWorld()
    const fleet = '/home/u/.claude/fleet'
    const running = JSON.stringify({ isOn: true, phase: 'running', beat: 1_000_000 - 10_000 })
    const beat = (id: string, cwd: string) => JSON.stringify({ id: `s-${id}`, name: `cadre-${id}`, cwd, beatAt: 500 })
    const files = {
      ...world.files,
      [`${fleet}/s-be.json`]: beat('be', WORKTREE),
      [`${fleet}/s-pm.json`]: beat('pm', '/repo'),
      '/home/u/.claude/autopilot/s-be.json': running,
      '/home/u/.claude/autopilot/s-pm.json': running,
    }
    const dirs = { ...world.dirs, [fleet]: [entry('s-be.json'), entry('s-pm.json')] }
    const run = await epicDone({ ...world, files, dirs }, DONE_RULES)

    expect(run.reply).toBe(epicDoneRefusal('PROJ-1', epicDoneProblems({ ...READY, running: ['be'] })))
    expect(run.reply).toContain('role be')
    expect(removals(run)).toEqual([])
  })

  test('a team that cannot be read is a reason, role states unknown, and never reads as no role running', async () => {
    const run = await epicDone(withoutFile(await doneWorld(), '/repo/.cadre/cadre.json'), DONE_RULES)

    expect(run.reply).toBe(epicDoneRefusal('PROJ-1', epicDoneProblems({ ...READY, teamRead: false })))
    expect(run.reply).toContain('role states unknown')
    expect(removals(run)).toEqual([])
  })
})

/** The argv that asks whether the process 42 still runs, as the stale-lock rule runs it (D-170). */
const PS_42 = ['/bin/ps', '-p', '42', '-o', 'pid=']

/** WORKTREE listed with a lock that names the process 42, as `claude --worktree` writes it. */
const LOCKED_42 = listRule('locked claude agent agent-abc (pid 42)\n')

describe('epic done --force and stale locks (D-152, D-170, D-134)', () => {
  test('lockPid reads the number after pid in a lock reason, a whole positive number; else null', () => {
    expect(lockPid('claude agent agent-abc (pid 99999)')).toBe(99999)
    expect(['', 'by hand', 'pid 12a', 'pid 0'].map(lockPid)).toEqual([null, null, null, null])
  })

  test('--force asks one question, keep first, under Epic done; only a yes removes, links first, forced', async () => {
    const world = { ...(await doneWorld()), interactive: true }
    const dirty = [rule(STATUS_ARGV(WORKTREE), 0, ' M src/a.ts\n'), ...DONE_RULES]
    const kept = await epicDone(world, dirty, { force: true, answers: ['No, keep it'] })
    const yes = await epicDone(world, dirty, { force: true, answers: ['Yes, remove it'] })
    const ready = await epicDone(world, DONE_RULES, { force: true, answers: ['Yes, remove it'] })

    expect(yes.asked).toEqual([epicDoneQuestion('PROJ-1', epicDoneProblems({ ...READY, clean: 'dirty' }))])
    expect(yes.specs).toEqual([{ options: ['No, keep it', 'Yes, remove it'], header: 'Epic done' }])
    expect([kept.reply, removals(kept)]).toEqual([epicKeptReply('PROJ-1'), []])
    expect(removals(yes)).toEqual([
      ['/bin/rm', '-f', '--', `${WORKTREE}/.cadre/bin/pm`],
      ['/bin/rm', '-f', '--', `${WORKTREE}/node_modules`],
      ['git', '-C', '/repo', 'worktree', 'remove', '--force', WORKTREE],
    ])
    // --force always asks, also when every check passed (D-152).
    expect(ready.asked).toEqual([epicDoneQuestion('PROJ-1', [])])
  })

  test('with --force, a dismissed question or a session with no dialog removes nothing', async () => {
    const world = await doneWorld()
    const dismissed = await epicDone({ ...world, interactive: true }, DONE_RULES, { force: true })
    const quiet = await epicDone(world, DONE_RULES, { force: true })

    expect([dismissed.reply, quiet.reply]).toEqual([epicKeptReply('PROJ-1'), EPIC_DONE_NO_DIALOG])
    expect(quiet.asked).toEqual([])
    expect([...removals(dismissed), ...removals(quiet)]).toEqual([])
  })

  test('with --force and no record, the yes runs the forced remove and no rm', async () => {
    const world = { ...withoutFile(await doneWorld(), `${GIT_DIR}/${EPIC_RECORD_FILE}`), interactive: true }
    const run = await epicDone(world, DONE_RULES, { force: true, answers: ['Yes, remove it'] })

    expect(removals(run)).toEqual([['git', '-C', '/repo', 'worktree', 'remove', '--force', WORKTREE]])
    expect(run.reply).toBe(epicRemovedText('PROJ-1', WORKTREE, BRANCH))
  })

  test('a lock whose process ps finds gone is unlocked before the links and the worktree are removed', async () => {
    const run = await epicDone(await doneWorld(), [LOCKED_42, rule(PS_42, 1), ...DONE_RULES])
    const unlock = ['git', '-C', '/repo', 'worktree', 'unlock', WORKTREE].join(' ')
    const isRemoval = (event: string) => event.startsWith('/bin/rm ') || event.includes(' worktree remove ')

    expect(run.events.filter(event => event === unlock || isRemoval(event))).toEqual([
      unlock,
      `/bin/rm -f -- ${WORKTREE}/.cadre/bin/pm`,
      `/bin/rm -f -- ${WORKTREE}/node_modules`,
      `git -C /repo worktree remove ${WORKTREE}`,
    ])
    expect(run.reply).toBe(epicRemovedText('PROJ-1', WORKTREE, BRANCH))
  })

  test('a live lock process, one ps cannot tell of, or a lock naming none refuses, --force or not', async () => {
    const world = { ...(await doneWorld()), interactive: true }
    const cases: readonly (readonly [readonly HostRunRule[], boolean, string])[] = [
      [[LOCKED_42, rule(PS_42, 0)], false, epicLockLiveReply(42)],
      [[LOCKED_42, rule(PS_42, 0)], true, epicLockLiveReply(42)],
      [[LOCKED_42, rule(PS_42, null)], false, epicLockUnknownReply(42)],
      [[listRule('locked by hand\n')], true, epicLockedReply('by hand')],
      [[listRule('locked\n')], false, epicLockedReply('')],
    ]
    for (const [rules, force, reply] of cases) {
      const run = await epicDone(world, [...rules, ...DONE_RULES], { force, answers: ['Yes, remove it'] })

      expect([force, run.reply]).toEqual([force, reply])
      expect(run.calls.filter(call => call.argv[4] === 'unlock')).toEqual([])
      expect(removals(run)).toEqual([])
    }
    expect(epicLockLiveReply(42)).toContain('42')
  })
})

/**
 * The failure paths of /cadre epic and /cadre epic done that no other spec pins (A8), each with its exact reply and the
 * host calls up to its last one, so a stop shows that nothing ran after it. A failed record write is pinned as it is
 * today: a warning, after which the roles are still rendered and opened; the user wants it to stop the run later
 * (.planning/todos/pending/epic-record-write-failure-stops.md). A recorded link whose rm fails is not checked today.
 */
describe('safety net: epic failure paths (A8)', () => {
  test('a worktree remove that fails stops done with its reply; the remove is the last host call', async () => {
    const remove = REMOVE_ARGV('/repo', WORKTREE, false)
    const run = await epicDone(await doneWorld(), [rule(remove, 1), ...DONE_RULES])
    expect(run.reply).toBe(
      'git could not remove the epic worktree, so cadre epic done stopped. The links it records were removed first: ' +
        'run /cadre epic PROJ-1 to link them again.',
    )
    expect(run.reply).toBe(epicRemoveFailedReply('PROJ-1'))
    expect(removals(run)).toEqual([
      ['/bin/rm', '-f', '--', `${WORKTREE}/.cadre/bin/pm`],
      ['/bin/rm', '-f', '--', `${WORKTREE}/node_modules`],
      remove,
    ])
    expect([run.events.at(-1), run.writes]).toEqual([remove.join(' '), []])
  })

  test('a recorded link whose rm fails or is rejected is not checked: the worktree is still removed', async () => {
    const pmLink = linkRemoveArgv(`${WORKTREE}/.cadre/bin/pm`)
    const modules = linkRemoveArgv(`${WORKTREE}/node_modules`)
    const run = await epicDone(await doneWorld(), [rule(pmLink, 1), rule(modules, null), ...DONE_RULES])
    expect(removals(run)).toEqual([pmLink, modules, REMOVE_ARGV('/repo', WORKTREE, false)])
    expect(run.reply).toBe(epicRemovedText('PROJ-1', WORKTREE, BRANCH))
  })

  test('an unlock that fails refuses with its reply; nothing is removed after it', async () => {
    const unlock = UNLOCK_ARGV('/repo', WORKTREE)
    const run = await epicDone(await doneWorld(), [LOCKED_42, rule(PS_42, 1), rule(unlock, 1), ...DONE_RULES])
    expect(run.reply).toBe(
      'git could not unlock the epic worktree, whose lock names the ended process 42, so nothing was removed.',
    )
    expect(run.reply).toBe(epicUnlockFailedReply(42))
    expect([run.events.at(-1), removals(run), run.writes]).toEqual([unlock.join(' '), [], []])
  })

  test('a checkout git cannot place stops create and done with one reply, after the checkout probe only', async () => {
    const reply =
      'cadre epic could not tell from git whether this is the main checkout, so it stopped before creating anything.'
    expect(EPIC_UNKNOWN_CHECKOUT).toBe(reply)
    const create = await epic(await teamWorld(), [rule(CHECKOUT_ARGV('/repo'), 128)])
    const done = await epicDone(await doneWorld(), [rule(CHECKOUT_ARGV('/repo'), null), ...DONE_RULES])
    const probe = CHECKOUT_ARGV('/repo').join(' ')
    expect([create.reply, create.events]).toEqual([reply, [probe]])
    expect([done.reply, done.events]).toEqual([reply, [probe]])
  })

  test('done: a worktree list git cannot give removes nothing, the list run last', async () => {
    const list = WORKTREE_LIST_ARGV('/repo')
    const run = await epicDone(await doneWorld(), [rule(list, null), ...DONE_RULES])
    expect(EPIC_DONE_NO_LIST).toBe('cadre epic done could not list the worktrees from git, so it removed nothing.')
    expect([run.reply, run.events]).toEqual([EPIC_DONE_NO_LIST, [CHECKOUT_ARGV('/repo').join(' '), list.join(' ')]])
  })
})
