import { describe, expect, test } from 'claude-code/testing'

import type { HostRun, PortEntry, RoleSpec } from '../../types'
import { stableJson } from '../core/json'
import { cadreJsonText, roleJsonText } from '../generate/docs'
import { CHECKOUT_ARGV } from '../git/checkout'
import {
  BRANCH,
  entry,
  entryAt,
  epic,
  epicHost,
  eventsOf,
  launcherEntry,
  launcherOf,
  link,
  memIo,
  memWorld,
  RECORD,
  rule,
  templateRole,
} from '../testkit'
import type { EpicRun, HostRunRule, MemWorld } from '../testkit'
import {
  cleanStateOf,
  EPIC_DONE_NO_DIALOG,
  EPIC_DONE_NO_LIST,
  epicCopyBackFailedReply,
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
  INCLUDED_ARGV,
  linkRemoveArgv,
  LS_IGNORED_ARGV,
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

/** The git dir of that worktree, where its epic record and its excludes file lie (D-147, D-164). */
const GIT_DIR = '/repo/.git/worktrees/proj-1-add-retry'

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

/** new.md as WORKTREE's copy of thoughts holds it: written by a role at 2000, after the copy at 1000. */
const NEW_MD: PortEntry = { ...entryAt('new.md', 'file', 2000), size: 5 }

/** The move of new.md from WORKTREE's copy of thoughts into the main checkout, over main's. */
const COPY_NEW: readonly string[] = ['/bin/mv', '-f', '--', `${WORKTREE}/thoughts/new.md`, '/repo/thoughts/new.md']

/** The include file of main naming thoughts, a folder done may copy back. */
const INCLUDE_FILE = '/repo/.worktreeinclude'

/** git listing what main ignores and what its .worktreeinclude names: thoughts both times. */
const INCLUDE_RULES: readonly HostRunRule[] = [
  rule(LS_IGNORED_ARGV('/repo'), 0, 'thoughts/\0'),
  rule(INCLUDED_ARGV('/repo'), 0, 'thoughts/\0'),
]

/**
 * A done world whose record copied thoughts into WORKTREE at `createdAt`, whose worktree lists thoughts as a real
 * folder holding NEW_MD, and whose main checkout lists thoughts as a real folder holding `held` and, unless `isNamed`
 * is false, has a .worktreeinclude naming thoughts; `dirs` adds or replaces listings.
 */
async function copyBackWorld(
  held: readonly PortEntry[] = [],
  createdAt = 1000,
  dirs: Readonly<Record<string, readonly PortEntry[]>> = {},
  isNamed = true,
): Promise<MemWorld> {
  const world = await doneWorld()
  const links = ['node_modules', '.cadre/bin/pm']
  const record = epicRecordText({ ...RECORD, createdAt, links, copies: ['thoughts'] })
  const include = isNamed ? { [INCLUDE_FILE]: 'thoughts/\n' } : {}
  const listings = {
    ...world.dirs,
    [WORKTREE]: [entry('.cadre', 'dir'), link('node_modules'), entry('thoughts', 'dir')],
    [`${WORKTREE}/thoughts`]: [NEW_MD],
    '/repo': [entry('thoughts', 'dir')],
    '/repo/thoughts': held,
    ...dirs,
  }
  const files = { ...world.files, [`${GIT_DIR}/${EPIC_RECORD_FILE}`]: record, ...include }

  return { ...world, files, dirs: listings }
}

/**
 * `world` whose epic record copied `copies` into WORKTREE at 1000 and walked `walked`, with the links of
 * copyBackWorld.
 */
function copiedWorld(world: MemWorld, copies: readonly string[], walked: readonly string[] = []): MemWorld {
  const links = ['node_modules', '.cadre/bin/pm']
  const record = epicRecordText({ ...RECORD, createdAt: 1000, links, copies, ...(walked.length > 0 ? { walked } : {}) })

  return withFile(world, `${GIT_DIR}/${EPIC_RECORD_FILE}`, record)
}

/** The `/bin/mv` runs of an epic done run, in call order: the moves of the copy-back. */
function copyRuns(run: EpicRun): (readonly string[])[] {
  return run.calls.map(call => call.argv).filter(argv => argv[0] === '/bin/mv')
}

describe('epic done copies back what the roles wrote in the copied folders', () => {
  test('a file a role wrote in a copied folder is moved into main before any link or the worktree goes', async () => {
    const run = await epicDone(await copyBackWorld(), [...INCLUDE_RULES, ...DONE_RULES])
    const copyAt = run.events.indexOf(COPY_NEW.join(' '))
    const rmAt = run.events.findIndex(event => event.startsWith('/bin/rm '))
    const removeAt = run.events.indexOf(REMOVE_ARGV('/repo', WORKTREE, false).join(' '))

    expect(run.reply).toBe(epicRemovedText('PROJ-1', WORKTREE, BRANCH))
    expect(copyRuns(run)).toEqual([COPY_NEW])
    expect([copyAt >= 0, copyAt < rmAt, copyAt < removeAt]).toEqual([true, true, true])
  })

  test("a file changed in main too is overwritten by the worktree's version, no reason, no question", async () => {
    const world = await copyBackWorld([{ ...entryAt('new.md', 'file', 1500), size: 9 }])
    const run = await epicDone(world, [...INCLUDE_RULES, ...DONE_RULES])

    expect(run.reply).toBe(epicRemovedText('PROJ-1', WORKTREE, BRANCH))
    expect([copyRuns(run), run.asked]).toEqual([[COPY_NEW], []])
    expect(removals(run).at(-1)).toEqual(REMOVE_ARGV('/repo', WORKTREE, false))
  })

  test("a file at its folder's recorded copy time is not moved over main's change", async () => {
    const changed = await copyBackWorld([{ ...entryAt('new.md', 'file', 3000), size: 9 }])
    const links = ['node_modules', '.cadre/bin/pm']
    const record = { ...RECORD, createdAt: 1000, links, copies: ['thoughts'], copiedAt: { thoughts: 2000 } }
    const world = withFile(changed, `${GIT_DIR}/${EPIC_RECORD_FILE}`, epicRecordText(record))
    const run = await epicDone(world, [...INCLUDE_RULES, ...DONE_RULES])

    expect(run.reply).toBe(epicRemovedText('PROJ-1', WORKTREE, BRANCH))
    expect(copyRuns(run)).toEqual([])
  })

  test('a file main holds as a link stops done naming it, with no copy, no rm and no worktree remove', async () => {
    const run = await epicDone(await copyBackWorld([link('new.md')]), [...INCLUDE_RULES, ...DONE_RULES])

    expect(run.reply).toBe(epicCopyBackFailedReply('PROJ-1', 'thoughts/new.md'))
    expect([copyRuns(run), removals(run)]).toEqual([[], []])
  })

  test('a folder main holds as a link deeper in a copied folder stops done naming it, removing nothing', async () => {
    const dirs = {
      [`${WORKTREE}/thoughts`]: [entry('a', 'dir')],
      [`${WORKTREE}/thoughts/a`]: [entry('b', 'dir')],
      [`${WORKTREE}/thoughts/a/b`]: [NEW_MD],
    }
    const run = await epicDone(await copyBackWorld([link('a')], 1000, dirs), [...INCLUDE_RULES, ...DONE_RULES])

    expect(run.reply).toBe(epicCopyBackFailedReply('PROJ-1', 'thoughts/a'))
    expect([copyRuns(run), removals(run)]).toEqual([[], []])
  })

  test('a record with no real creation time stops done naming the copied folder, removing nothing', async () => {
    const run = await epicDone(await copyBackWorld([], 0), [...INCLUDE_RULES, ...DONE_RULES])

    expect(run.reply).toBe(epicCopyBackFailedReply('PROJ-1', 'thoughts'))
    expect([copyRuns(run), removals(run)]).toEqual([[], []])
  })

  test('a copy-back step that fails or cannot run stops done naming its path, removing nothing after it', async () => {
    for (const failed of [rule(COPY_NEW, 1), rule(COPY_NEW, null)]) {
      const run = await epicDone(await copyBackWorld(), [failed, ...INCLUDE_RULES, ...DONE_RULES])

      expect(run.reply).toBe(epicCopyBackFailedReply('PROJ-1', 'thoughts/new.md'))
      expect([run.events.at(-1), removals(run)]).toEqual([COPY_NEW.join(' '), []])
    }
  })
})

describe("epic done copies back only the folders main's .worktreeinclude names now", () => {
  test('a recorded folder the include file does not name refuses naming it, and nothing is removed', async () => {
    const jest = (mtimeMs: number, size: number): PortEntry => ({ ...entryAt('jest.js', 'file', mtimeMs), size })
    const dirs = {
      [WORKTREE]: [entry('.cadre', 'dir'), entry('node_modules', 'dir'), entry('thoughts', 'dir')],
      [`${WORKTREE}/node_modules`]: [entry('jest', 'dir')],
      [`${WORKTREE}/node_modules/jest`]: [entry('bin', 'dir')],
      [`${WORKTREE}/node_modules/jest/bin`]: [jest(2000, 5)],
      '/repo': [entry('node_modules', 'dir'), entry('thoughts', 'dir')],
      '/repo/node_modules': [entry('jest', 'dir')],
      '/repo/node_modules/jest': [entry('bin', 'dir')],
      '/repo/node_modules/jest/bin': [jest(500, 3)],
    }
    const world = copiedWorld(await copyBackWorld([], 1000, dirs), ['node_modules', 'thoughts'])
    const run = await epicDone(world, [...INCLUDE_RULES, ...DONE_RULES])

    expect(run.reply).toBe(epicCopyBackFailedReply('PROJ-1', 'node_modules'))
    expect([copyRuns(run), removals(run)]).toEqual([[], []])
  })

  test('with no .worktreeinclude in main a recorded copied folder stops done the same way', async () => {
    const run = await epicDone(await copyBackWorld([], 1000, {}, false), [...INCLUDE_RULES, ...DONE_RULES])

    expect(run.reply).toBe(epicCopyBackFailedReply('PROJ-1', 'thoughts'))
    expect([copyRuns(run), removals(run)]).toEqual([[], []])
  })

  test('a copy whose folder the worktree cannot list refuses naming the copy, and nothing is removed', async () => {
    const dirs = {
      [`${WORKTREE}/thoughts`]: [entry('shared', 'dir')],
      [`${WORKTREE}/thoughts/shared`]: [NEW_MD],
      '/repo/thoughts': [entry('shared', 'dir')],
      '/repo/thoughts/shared': [],
    }
    const copied = copiedWorld(await copyBackWorld([], 1000, dirs), ['thoughts/shared'])
    const world = { ...withFile(copied, INCLUDE_FILE, 'thoughts/shared/\n'), unknownPaths: [`${WORKTREE}/thoughts`] }
    const named = [
      rule(LS_IGNORED_ARGV('/repo'), 0, 'thoughts/\0'),
      rule(INCLUDED_ARGV('/repo'), 0, 'thoughts/shared/\0'),
    ]
    const run = await epicDone(world, [...named, ...DONE_RULES])

    expect(run.reply).toBe(epicCopyBackFailedReply('PROJ-1', 'thoughts/shared'))
    expect([copyRuns(run), removals(run)]).toEqual([[], []])
  })

  test('a record with no copies makes no listing of what is ignored or what the include file names', async () => {
    const world = withFile(await doneWorld(), INCLUDE_FILE, 'thoughts/\n')
    const run = await epicDone(world, [...INCLUDE_RULES, ...DONE_RULES])
    const listings = [LS_IGNORED_ARGV('/repo'), INCLUDED_ARGV('/repo')].map(argv => argv.join(' '))

    expect(run.reply).toBe(epicRemovedText('PROJ-1', WORKTREE, BRANCH))
    expect(run.events.filter(event => listings.includes(event))).toEqual([])
  })
})

describe('epic done moves the new files directly in a walked folder into main', () => {
  /** git listing the ignored thoughts and naming thoughts/shared below it, as .worktreeinclude lists it. */
  const SHARED_RULES: readonly HostRunRule[] = [
    rule(LS_IGNORED_ARGV('/repo'), 0, 'thoughts/\0'),
    rule(INCLUDED_ARGV('/repo'), 0, 'thoughts/shared/\0'),
  ]

  test('only a new regular file directly in a walked folder is moved, before any rm and the remove', async () => {
    const idea: PortEntry = { ...entryAt('idea.md', 'file', 2000), size: 3 }
    const dirs = {
      [`${WORKTREE}/thoughts`]: [idea, link('notes.md'), entry('shared', 'dir')],
      [`${WORKTREE}/thoughts/shared`]: [],
      '/repo/thoughts/shared': [],
    }
    const held = [entry('notes.md'), entry('shared', 'dir')]
    const copied = copiedWorld(await copyBackWorld(held, 1000, dirs), ['thoughts/shared'], ['thoughts'])
    const run = await epicDone(withFile(copied, INCLUDE_FILE, 'thoughts/shared/\n'), [...SHARED_RULES, ...DONE_RULES])
    const move = ['/bin/mv', '-f', '--', `${WORKTREE}/thoughts/idea.md`, '/repo/thoughts/idea.md']
    const moveAt = run.events.indexOf(move.join(' '))
    const rmAt = run.events.findIndex(event => event.startsWith('/bin/rm '))
    const removeAt = run.events.indexOf(REMOVE_ARGV('/repo', WORKTREE, false).join(' '))

    expect(run.reply).toBe(epicRemovedText('PROJ-1', WORKTREE, BRANCH))
    expect(copyRuns(run)).toEqual([move])
    expect([moveAt >= 0, moveAt < rmAt, moveAt < removeAt]).toEqual([true, true, true])
  })

  test('a walked folder below which the include file names nothing refuses naming it, removing nothing', async () => {
    const run = await epicDone(copiedWorld(await copyBackWorld(), [], ['thoughts']), [...INCLUDE_RULES, ...DONE_RULES])

    expect(run.reply).toBe(epicCopyBackFailedReply('PROJ-1', 'thoughts'))
    expect([copyRuns(run), removals(run)]).toEqual([[], []])
  })
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
