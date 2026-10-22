import { describe, expect, test } from 'claude-code/testing'

import type { EpicRecord, HostIo, HostRun, ManifestEntry, PortEntry, RoleSpec } from '../types'
import {
  BASE_BRANCH_ARGV,
  BASE_COMMIT_ARGV,
  EPIC_BRANCHES_ARGV,
  EPIC_NO_PM,
  EPIC_RECORD_FILE,
  epicAddFailedReply,
  epicBadKeyReply,
  epicCreatedText,
  epicExcludesFailedReply,
  epicKeyOf,
  epicLookup,
  epicManyBranchesReply,
  epicManyPmReply,
  epicManyWorktreesReply,
  epicNotMainReply,
  epicPathExistsReply,
  epicPmOf,
  epicRecordText,
  epicSlug,
  epicStepArgv,
  EXCLUDES_CONFIG_ARGV,
  EXCLUDES_FILE,
  excludesText,
  GIT_DIR_ARGV,
  LS_IGNORED_ARGV,
  LS_OTHERS_ARGV,
  mirrorLinkedParentWarning,
  mirrorPaths,
  mirrorPlan,
  parseEpicRecord,
  parseWorktreeList,
  runEpic,
  untrackedEntries,
  WORKTREE_CONFIG_ARGV,
  WORKTREE_LIST_ARGV,
} from './epic'
import type { EpicStep, WorktreeEntry } from './epic'
import { cadreJsonText, roleJsonText } from './generate'
import { sha256Hex } from './hash'
import { readTeam, regenNoRole } from './init'
import { stableJson } from './plan'
import { CHECKOUT_ARGV, checkoutOf } from './scan'
import { claudeTooOldReply, launcherChangedReply } from './start'
import { DEFAULT_LOCATIONS, entry, hostWorld, link, memHost, memIo, memWorld, templateRole } from './testkit'
import type { HostCall, HostRunRule, HostWrite, MemHost, MemWorld } from './testkit'

/** The worktree `/cadre epic PROJ-1 Add retry` makes in the fixture repo /repo (D-146). */
const WORKTREE = '/repo/.claude/worktrees/proj-1-add-retry'

/** The branch of that worktree (D-146). */
const BRANCH = 'epic/proj-1-add-retry'

/** The git dir of that worktree, where its epic record and its excludes file lie (D-147, D-164). */
const GIT_DIR = '/repo/.git/worktrees/proj-1-add-retry'

/** The add of that worktree on a new branch from the current HEAD (D-147). */
const ADD_ARGV = ['git', '-C', '/repo', 'worktree', 'add', '-b', BRANCH, WORKTREE, 'HEAD']

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

/** A git repo at /repo; `over` changes the fields it names. */
function gitWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ dirs: { '/repo/.git': [] }, ...over })
}

/** The text of a role's launcher in the epic worlds: launcherRead compares only its sha256 with the manifest. */
function launcherOf(id: string): string {
  return `#!/bin/sh\n# the launcher of role ${id}\nexit 0\n`
}

/** The manifest entry of a role's launcher, holding the sha256 of launcherOf. */
async function launcherEntry(id: string): Promise<ManifestEntry> {
  return { path: `.cadre/bin/${id}`, sha256: await sha256Hex(launcherOf(id)), mode: 'exec' }
}

/**
 * A git repo at /repo after a plain init of `roles` (PM and BE by default): cadre.json lists them on the built-in
 * default, launched at the git root, each role.json is written from its role, and each launcher lies in `.cadre/bin/`
 * with its sha256 in the manifest.
 */
async function teamWorld(roles: readonly RoleSpec[] = TEAM): Promise<MemWorld> {
  const ids = roles.map(role => role.id)
  const state = cadreJsonText({
    schema: 1,
    cadreVersion: '0.2.0',
    framework: 'none',
    gitPolicy: 'definitions',
    roles: ids,
    launchStart: { kind: 'git-root' },
    readUserMcp: false,
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
 * with no output. Each write and each run also takes the next value of one counter they share, so a spec can tell
 * whether a file was written before a command ran.
 */
function epicHost(runs: readonly HostRunRule[]): EpicHost {
  const host = memHost(hostWorld({ runs: [...runs, ...BASE_RULES] }))
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
 * BASE_RULES; any other argv exits 0 with no output.
 */
async function epic(
  world: MemWorld,
  runs: readonly HostRunRule[],
  key = 'PROJ-1',
  title = 'Add retry',
): Promise<EpicRun> {
  const host = epicHost(runs)
  const reply = await runEpic(memIo(world, {}).io, host.io, { key, title, terminal: 'auto' })

  return { reply, writes: host.writes, calls: host.calls, events: eventsOf(host) }
}

/** The argv of every `git worktree add` the run asked for. */
function addRuns(run: EpicRun): (readonly string[])[] {
  return run.calls.map(call => call.argv).filter(argv => argv[3] === 'worktree' && argv[4] === 'add')
}

/** The argv of every `git -C <path> worktree ...` run the run asked for: a refusal before creation asks for none. */
function worktreeRuns(run: EpicRun): (readonly string[])[] {
  return run.calls.map(call => call.argv).filter(argv => argv[3] === 'worktree')
}

describe('runEpic', () => {
  test('PROJ-1 Add retry adds the worktree on a new epic branch from HEAD and names both (D-145, D-146)', async () => {
    const run = await epic(await teamWorld(), [rule(ADD_ARGV, 0), rule(GIT_DIR_ARGV(WORKTREE), 0, `${GIT_DIR}\n`)])

    expect(addRuns(run)).toEqual([ADD_ARGV])
    expect(run.reply).toContain(WORKTREE)
    expect(run.reply).toContain(BRANCH)
  })

  test('a key that is not 1-32 letters, digits, - or _ refuses before anything runs (D-162)', async () => {
    const run = await epic(await teamWorld(), [rule(ADD_ARGV, 0)], '../x')

    expect(run.reply).toBe(epicBadKeyReply('../x'))
    expect(run.calls).toEqual([])
  })

  test('an add that fails says the new branch may now exist and is kept, and deletes nothing (Pitfall 3)', async () => {
    const run = await epic(await teamWorld(), [rule(ADD_ARGV, 128)])

    expect(run.reply).toBe(epicAddFailedReply(BRANCH, true))
    expect(run.reply).toContain(BRANCH)
    expect(run.calls.filter(call => call.argv[3] === 'branch')).toEqual([])
  })
})

describe('epic keys and slugs (D-162)', () => {
  test('a key drops one leading #, then is 1-32 letters, digits, - or _ starting with a letter or digit', () => {
    expect(epicKeyOf('#123')).toBe('123')
    expect(epicKeyOf('PROJ-1')).toBe('PROJ-1')
    expect(epicKeyOf('A'.repeat(33))).toBeNull()
    expect(epicKeyOf('a/b')).toBeNull()
    expect(epicKeyOf('-x')).toBeNull()
  })

  test('the slug is the key and title lowercased with one - per gap, cut at a - to at most 48 characters', () => {
    expect(epicSlug('PROJ-1', 'Add retry')).toBe('proj-1-add-retry')
    expect(epicSlug('PLATFORM-ENGINEERING', 'add retry to all outbound call')).toBe(
      'platform-engineering-add-retry-to-all-outbound',
    )
    expect(epicSlug('PROJ-1', 'ÉÀÜ éàü')).toBe('proj-1')
  })
})

describe('where /cadre epic runs and what it needs (D-161, D-165)', () => {
  test('checkoutOf reads the main checkout and a linked worktree from git; anything else is unknown', () => {
    const run = (exitCode: number, stdout: string): HostRun => ({ exitCode, stdout, stderr: '' })

    expect(checkoutOf(run(0, '/repo/.git\n/repo/.git\n'))).toEqual({ kind: 'main' })
    expect(checkoutOf(run(0, '/repo/.git/worktrees/x\n/repo/.git\n'))).toEqual({ kind: 'linked', main: '/repo' })
    expect(checkoutOf(null)).toEqual({ kind: 'unknown' })
    expect(checkoutOf(run(128, '/repo/.git\n/repo/.git\n'))).toEqual({ kind: 'unknown' })
    expect(checkoutOf(run(0, '/repo/.git\n'))).toEqual({ kind: 'unknown' })
  })

  test('in a linked worktree it refuses and names the main checkout, before anything is created', async () => {
    const linked = '/repo/.claude/worktrees/x'
    const world = memWorld({
      locations: { ...DEFAULT_LOCATIONS, root: linked, givenRoot: linked },
      files: { [`${linked}/.git`]: 'gitdir: /repo/.git/worktrees/x\n' },
    })
    const run = await epic(world, [rule(CHECKOUT_ARGV(linked), 0, '/repo/.git/worktrees/x\n/repo/.git\n')])

    expect(run.reply).toBe(epicNotMainReply('/repo'))
    expect(worktreeRuns(run)).toEqual([])
  })

  test('readTeam with no id reads the whole team for cadre epic; with an id it refuses an unlisted one', async () => {
    const io = memIo(await teamWorld(), {}).io
    const read = await readTeam(io, '/repo', 'epic', null)

    expect(read.kind === 'ok' ? read.value.roles.map(role => role.id) : read.text).toEqual(['pm', 'be'])
    expect(await readTeam(io, '/repo', 'epic', 'qa')).toEqual({ kind: 'refuse', text: regenNoRole('qa', ['pm', 'be']) })
  })

  test('the PM is the role with id pm, else the one role based on pm; none or several refuse', () => {
    expect(epicPmOf([{ id: 'product', basedOn: 'pm' }, { id: 'pm', basedOn: null }])).toEqual({ kind: 'ok', id: 'pm' })
    expect(epicPmOf([{ id: 'be', basedOn: 'be' }, { id: 'product', basedOn: 'pm' }])).toEqual({
      kind: 'ok',
      id: 'product',
    })
    expect(epicPmOf([{ id: 'be', basedOn: 'be' }])).toEqual({ kind: 'refuse', text: EPIC_NO_PM })
    expect(epicPmOf([{ id: 'a', basedOn: 'pm' }, { id: 'b', basedOn: 'pm' }])).toEqual({
      kind: 'refuse',
      text: epicManyPmReply(['a', 'b']),
    })
  })

  test('a team with no PM refuses before anything is created', async () => {
    const run = await epic(await teamWorld([templateRole('be')]), [rule(ADD_ARGV, 0)])

    expect(run.reply).toBe(EPIC_NO_PM)
    expect(worktreeRuns(run)).toEqual([])
  })

  test('a launcher that differs from its manifest entry refuses before anything is created', async () => {
    const world = await teamWorld()
    const changed = { ...world, files: { ...world.files, '/repo/.cadre/bin/be': 'changed\n' } }
    const run = await epic(changed, [rule(ADD_ARGV, 0)])

    expect(run.reply).toBe(launcherChangedReply('be'))
    expect(worktreeRuns(run)).toEqual([])
  })

  test('a claude older than 2.1.295 refuses before anything is created (D-107)', async () => {
    const old = rule(['claude', '--version'], 0, '2.1.294 (Claude Code)\n')
    const run = await epic(await teamWorld(), [rule(ADD_ARGV, 0), old])

    expect(run.reply).toBe(claudeTooOldReply('2.1.294 (Claude Code)'))
    expect(worktreeRuns(run)).toEqual([])
  })
})

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

/** A registered worktree that is not the main checkout, on `branch`, not locked. */
function linkedEntry(path: string, branch: string): WorktreeEntry {
  return { path, branch, locked: null, isMain: false }
}

describe('finding an epic by its key (D-163)', () => {
  test('parseWorktreeList reads each porcelain block: path, branch, lock reason, the first block as main', () => {
    const porcelain =
      'worktree /repo\nHEAD a\nbranch refs/heads/main\n\n' +
      'worktree /repo/.claude/worktrees/proj-1-x\nHEAD b\nbranch refs/heads/epic/proj-1-x\n' +
      'locked claude agent (pid 42)\n\nworktree /w2\nHEAD c\ndetached\n'

    expect(parseWorktreeList(porcelain)).toEqual([
      { path: '/repo', branch: 'main', locked: null, isMain: true },
      { ...linkedEntry('/repo/.claude/worktrees/proj-1-x', 'epic/proj-1-x'), locked: 'claude agent (pid 42)' },
      { path: '/w2', branch: null, locked: null, isMain: false },
    ])
    expect(parseWorktreeList('worktree /repo\nHEAD a\n\nworktree /w\nHEAD b\ndetached\nlocked\n')[1]?.locked).toBe('')
  })

  test('one worktree on epic/<key> or epic/<key>-... is reused, one kept branch is re-added, else new', () => {
    const main: WorktreeEntry = { path: '/repo', branch: 'epic/proj-1', locked: null, isMain: true }
    const x = linkedEntry('/w/x', 'epic/proj-1-x')
    const exact = linkedEntry('/w/e', 'epic/proj-1')
    const ten = linkedEntry('/w/t', 'epic/proj-10')
    const lookup = (worktrees: readonly WorktreeEntry[], branches: readonly string[] = []) =>
      epicLookup({ worktrees, branches, keySlug: 'proj-1' })
    const two = lookup([x, exact])
    const twoText = two.kind === 'refuse' ? two.text : ''

    expect(lookup([main, x, ten])).toEqual({ kind: 'reuse', path: '/w/x', branch: 'epic/proj-1-x' })
    expect(two).toEqual({ kind: 'refuse', text: epicManyWorktreesReply(['/w/x', '/w/e']) })
    expect(['/w/x', '/w/e'].filter(path => twoText.includes(path))).toHaveLength(2)
    expect(lookup([main])).toEqual({ kind: 'new' })
    expect(lookup([main, ten], ['epic/proj-10'])).toEqual({ kind: 'new' })
    expect(lookup([], ['epic/proj-1-old'])).toEqual({ kind: 'readd', branch: 'epic/proj-1-old', name: 'proj-1-old' })
    expect(lookup([], ['epic/proj-1-a', 'epic/proj-1-b'])).toEqual({
      kind: 'refuse',
      text: epicManyBranchesReply(['epic/proj-1-a', 'epic/proj-1-b']),
    })
    expect(lookup([])).toEqual({ kind: 'new' })
  })

  test('a kept epic branch with no worktree is added back on that branch, without -b', async () => {
    const kept = '/repo/.claude/worktrees/proj-1-old'
    const readd = ['git', '-C', '/repo', 'worktree', 'add', kept, 'epic/proj-1-old']
    const branches = rule(EPIC_BRANCHES_ARGV('/repo'), 0, 'epic/proj-1-old\n')
    const gitDir = rule(GIT_DIR_ARGV(kept), 0, '/repo/.git/worktrees/proj-1-old\n')
    const run = await epic(await teamWorld(), [branches, rule(readd, 0), gitDir])

    expect(addRuns(run)).toEqual([readd])
    expect(run.reply).toContain(kept)
  })

  test('a registered worktree of the key is reused: nothing is added, and its record names the title', async () => {
    const path = '/repo/.claude/worktrees/proj-1-x'
    const gitDir = '/repo/.git/worktrees/proj-1-x'
    const porcelain =
      'worktree /repo\nHEAD a\nbranch refs/heads/main\n\n' +
      `worktree ${path}\nHEAD b\nbranch refs/heads/epic/proj-1-x\n`
    const record = epicRecordText({ ...RECORD, slug: 'proj-1-x', title: 'Old title', branch: 'epic/proj-1-x' })
    const world = await teamWorld()
    const reused = { ...world, files: { ...world.files, [`${gitDir}/cadre-epic.json`]: record } }
    const run = await epic(reused, [
      rule(WORKTREE_LIST_ARGV('/repo'), 0, porcelain),
      rule(GIT_DIR_ARGV(path), 0, `${gitDir}\n`),
    ])
    const reply = { key: 'PROJ-1', title: 'Old title', path, branch: 'epic/proj-1-x', linked: 0, copied: 0 }

    expect(addRuns(run)).toEqual([])
    expect(run.reply).toBe(epicCreatedText({ ...reply, outcome: 'reused', warnings: [] }))
  })

  test('a folder at the worktree path that git does not list refuses before anything is added (D-147)', async () => {
    const world = await teamWorld()
    const run = await epic({ ...world, dirs: { ...world.dirs, [WORKTREE]: [] } }, [rule(ADD_ARGV, 0)])

    expect(run.reply).toBe(epicPathExistsReply(WORKTREE))
    expect(addRuns(run)).toEqual([])
  })
})

describe('the epic record (D-164)', () => {
  test('after the add the record goes to <worktree git dir>/cadre-epic.json, based on branch or commit', async () => {
    const created = await epic(await teamWorld(), [
      rule(ADD_ARGV, 0),
      rule(BASE_BRANCH_ARGV('/repo'), 0, 'main\n'),
      rule(GIT_DIR_ARGV(WORKTREE), 0, `${GIT_DIR}\n`),
    ])
    const detached = await epic(await teamWorld(), [
      rule(ADD_ARGV, 0),
      rule(BASE_BRANCH_ARGV('/repo'), 1),
      rule(BASE_COMMIT_ARGV('/repo'), 0, 'abc123\n'),
      rule(GIT_DIR_ARGV(WORKTREE), 0, `${GIT_DIR}\n`),
    ])
    const records = (run: EpicRun) => run.writes.filter(write => write.path === `${GIT_DIR}/${EPIC_RECORD_FILE}`)

    expect(created.calls.map(call => call.argv).filter(argv => argv.includes('--absolute-git-dir'))).toEqual([
      GIT_DIR_ARGV(WORKTREE),
    ])
    expect(records(created)).toEqual([
      { path: `${GIT_DIR}/cadre-epic.json`, text: epicRecordText(RECORD), isWritten: true },
    ])
    expect(records(detached).map(write => parseEpicRecord(write.text)?.base)).toEqual(['abc123'])
  })

  test('parseEpicRecord reads back what epicRecordText wrote and refuses a bad shape or an unsafe path', () => {
    const record: EpicRecord = { ...RECORD, links: ['node_modules', '.claude/settings.local.json'], copies: ['.envrc'] }
    const bad = (over: Readonly<Record<string, unknown>>) => parseEpicRecord(JSON.stringify({ ...record, ...over }))

    expect(parseEpicRecord(epicRecordText(record))).toEqual(record)
    expect([bad({ title: undefined }), bad({ schema: 2 }), bad({ branch: 'epic/other' })]).toEqual([null, null, null])
    for (const path of ['/etc/x', '', 'a/../b', '..', 'a//b', 'a/']) {
      expect([path, bad({ links: [path] }), bad({ copies: [path] })]).toEqual([path, null, null])
    }
  })
})

/** The worktree `/cadre epic PROJ-1` makes with no title words (D-146), and its git dir (D-164). */
const BARE_WORKTREE = '/repo/.claude/worktrees/proj-1'

/** The git dir of BARE_WORKTREE, as git names it. */
const BARE_GIT_DIR = '/repo/.git/worktrees/proj-1'

/** The excludes file of BARE_WORKTREE, in its git dir (D-147). */
const BARE_EXCLUDES = `${BARE_GIT_DIR}/${EXCLUDES_FILE}`

/** The epic record of BARE_WORKTREE, in its git dir (D-164). */
const BARE_RECORD = `${BARE_GIT_DIR}/${EPIC_RECORD_FILE}`

/** A new PROJ-1 worktree whose main checkout ignores node_modules/ and has nothing else git does not track. */
const NODE_MODULES_RULES: readonly HostRunRule[] = [
  rule(LS_IGNORED_ARGV('/repo'), 0, 'node_modules/\0'),
  rule(GIT_DIR_ARGV(BARE_WORKTREE), 0, `${BARE_GIT_DIR}\n`),
]

/** The `/bin/ln` runs of an epic run: a run that stops before its links has none. */
function linkRuns(run: EpicRun): (readonly string[])[] {
  return run.calls.map(call => call.argv).filter(argv => argv[0] === '/bin/ln')
}

/** Whether an event of EpicRun.events belongs to the mirror: a write, a git config run, or a `/bin/` step. */
function isMirrorEvent(event: string): boolean {
  return event.startsWith('write ') || event.includes(' config ') || event.startsWith('/bin/')
}

describe('mirroring the main checkout into the epic worktree (D-147, D-148)', () => {
  test('untrackedEntries reads both NUL-ended listings: each entry once, sorted, without its trailing /', () => {
    expect(untrackedEntries('node_modules/\0', '.cadre/\0node_modules/\0')).toEqual(['.cadre', 'node_modules'])
    expect(untrackedEntries('', '')).toEqual([])
  })

  test('excludesText keeps the global excludes, then one /<path> line per link, sorted, and the runtime line', () => {
    const tail = '# cadre links (cadre epic)\n/node_modules\n/.cadre/*/.runtime/\n'

    expect(excludesText('*.log\n', ['node_modules'])).toBe(`*.log\n${tail}`)
    expect(excludesText('*.log', ['node_modules'])).toBe(`*.log\n${tail}`)
    expect(excludesText('', ['node_modules'])).toBe(tail)
    expect(excludesText('', ['thoughts', 'node_modules'])).toContain('\n/node_modules\n/thoughts\n')
  })

  test('each mirror step runs as one absolute argv with no shell, and a link never replaces what is there', () => {
    const linkStep: EpicStep = { kind: 'link', path: '/w/a', target: '/repo/a' }
    const copyStep: EpicStep = { kind: 'copy', path: '/w/.env', source: '/repo/.env' }

    expect(epicStepArgv({ kind: 'mkdir', path: '/w/a' })).toEqual(['/bin/mkdir', '-p', '--', '/w/a'])
    expect(epicStepArgv(linkStep)).toEqual(['/bin/ln', '-s', '--', '/repo/a', '/w/a'])
    expect(epicStepArgv(copyStep)).toEqual(['/bin/cp', '-p', '--', '/repo/.env', '/w/.env'])
  })

  test('an ignored node_modules/ becomes a link in the new worktree, hidden from git before it is made', async () => {
    const run = await epic(await teamWorld(), NODE_MODULES_RULES, 'PROJ-1', '')
    const ln = ['/bin/ln', '-s', '--', '/repo/node_modules', `${BARE_WORKTREE}/node_modules`]
    const record = run.writes.filter(write => write.path === BARE_RECORD).at(-1)

    expect(run.writes.find(write => write.path === BARE_EXCLUDES)?.text).toBe(excludesText('', ['node_modules']))
    expect(run.events.filter(isMirrorEvent)).toEqual([
      `write ${BARE_EXCLUDES}`,
      WORKTREE_CONFIG_ARGV('/repo').join(' '),
      EXCLUDES_CONFIG_ARGV(BARE_WORKTREE, BARE_EXCLUDES).join(' '),
      ln.join(' '),
      `write ${BARE_RECORD}`,
    ])
    expect(parseEpicRecord(record?.text ?? '')?.links).toEqual(['node_modules'])
    expect(run.reply).toContain('Linked 1, copied 0.')
  })

  test('a failed excludes setup, or no git dir to hold it, stops before any link and says none was made', async () => {
    const failed = rule(EXCLUDES_CONFIG_ARGV(BARE_WORKTREE, BARE_EXCLUDES), 1)
    const config = await epic(await teamWorld(), [failed, ...NODE_MODULES_RULES], 'PROJ-1', '')
    const noGitDir = await epic(await teamWorld(), [rule(LS_IGNORED_ARGV('/repo'), 0, 'node_modules/\0')], 'PROJ-1', '')
    const failure = epicExcludesFailedReply('PROJ-1')

    expect([config.reply, noGitDir.reply]).toEqual([failure, failure])
    expect(config.reply).toContain('made no links')
    expect([...linkRuns(config), ...linkRuns(noGitDir)]).toEqual([])
  })
})

/** A mirror step as `<kind> <path below BARE_WORKTREE>`, the form the mirror rule specs compare. */
function stepLine(step: EpicStep): string {
  return `${step.kind} ${step.path.slice(BARE_WORKTREE.length + 1)}`
}

/** The kind of mirror step each `/bin/` command of a mirror makes. */
const STEP_KINDS: ReadonlyMap<string, string> = new Map([
  ['/bin/mkdir', 'mkdir'],
  ['/bin/ln', 'link'],
  ['/bin/cp', 'copy'],
])

/** The mirror steps an epic run ran, each as stepLine writes it: its kind and its path below BARE_WORKTREE. */
function stepRuns(run: EpicRun): string[] {
  return run.calls.flatMap(call => {
    const kind = STEP_KINDS.get(call.argv[0] ?? '')
    const path = call.argv.at(-1)

    return kind === undefined || path === undefined ? [] : [`${kind} ${path.slice(BARE_WORKTREE.length + 1)}`]
  })
}

/** What the scratch repo of RESEARCH Pattern 4 holds that git does not track, as untrackedEntries gives it. */
const SCRATCH_ENTRIES: readonly string[] = [
  '.cadre',
  '.claude',
  '.claude/worktrees',
  '.env',
  '.env.local',
  'node_modules',
  'thoughts',
  'web/.env',
]

/** The scratch repo's main checkout: the listing of each folder the mirror reads, '' for the root. */
const SCRATCH_MAIN: ReadonlyMap<string, readonly PortEntry[]> = new Map([
  [
    '',
    [
      entry('.cadre', 'dir'),
      entry('.claude', 'dir'),
      entry('.env'),
      entry('.env.local'),
      entry('node_modules', 'dir'),
      entry('thoughts', 'dir'),
      entry('web', 'dir'),
    ],
  ],
  ['.cadre', [entry('bin', 'dir'), entry('pm', 'dir'), entry('cadre.json'), entry('manifest.json')]],
  ['.cadre/bin', [entry('pm')]],
  ['.cadre/pm', [entry('.runtime', 'dir'), entry('ROLE.md'), entry('role.json')]],
  ['.claude', [entry('settings.local.json'), entry('skills', 'dir'), entry('worktrees', 'dir')]],
  ['web', [entry('.env')]],
])

/** A worktree of the scratch repo whose root lists only `web`, a tracked folder. */
const SCRATCH_TREE: ReadonlyMap<string, readonly PortEntry[]> = new Map([['', [entry('web', 'dir')]]])

/** The steps the scratch repo's mirror plans for the role pm into a worktree that lists only `web` (D-156, D-172). */
const SCRATCH_STEPS: readonly string[] = [
  'mkdir .cadre',
  'mkdir .cadre/bin',
  'link .cadre/bin/pm',
  'link .cadre/cadre.json',
  'link .cadre/manifest.json',
  'mkdir .cadre/pm',
  'link .cadre/pm/ROLE.md',
  'link .cadre/pm/role.json',
  'mkdir .claude',
  'link .claude/settings.local.json',
  'link .claude/skills',
  'copy .env',
  'copy .env.local',
  'link node_modules',
  'link thoughts',
  'copy web/.env',
]

/** mirrorPlan of `entries` for the role pm from /repo into BARE_WORKTREE, over these listings. */
function planOf(
  entries: readonly string[],
  main: ReadonlyMap<string, readonly PortEntry[]>,
  tree: ReadonlyMap<string, readonly PortEntry[]>,
): ReturnType<typeof mirrorPlan> {
  return mirrorPlan({ root: '/repo', worktree: BARE_WORKTREE, entries, roleIds: ['pm'], main, tree })
}

describe('the mirror rules (D-147, D-148, D-149, D-156, D-172)', () => {
  test('the scratch listing mirrors .cadre as real folders, links the rest, copies env files, skips .runtime', () => {
    const plan = planOf(SCRATCH_ENTRIES, SCRATCH_MAIN, SCRATCH_TREE)

    expect(plan.steps.map(stepLine)).toEqual(SCRATCH_STEPS)
    expect(plan.links).toEqual([
      '.cadre/bin/pm',
      '.cadre/cadre.json',
      '.cadre/manifest.json',
      '.cadre/pm/ROLE.md',
      '.cadre/pm/role.json',
      '.claude/settings.local.json',
      '.claude/skills',
      'node_modules',
      'thoughts',
    ])
    expect(plan.copies).toEqual(['.env', '.env.local', 'web/.env'])
    expect(plan.warnings).toEqual([])
    expect(plan.steps.filter(step => step.kind !== 'mkdir').slice(0, 1)).toEqual([
      { kind: 'link', path: `${BARE_WORKTREE}/.cadre/bin/pm`, target: '/repo/.cadre/bin/pm' },
    ])
    expect(plan.steps.find(step => step.kind === 'copy')).toEqual({
      kind: 'copy',
      path: `${BARE_WORKTREE}/.env`,
      source: '/repo/.env',
    })
  })

  test('a target the worktree lists already, as a link or as a file, gets no step', () => {
    const tree = new Map([
      ['', [entry('web', 'dir'), link('node_modules')]],
      ['.cadre/pm', [entry('role.json')]],
    ])
    const kept = SCRATCH_STEPS.filter(step => step !== 'link node_modules' && step !== 'link .cadre/pm/role.json')

    expect(planOf(SCRATCH_ENTRIES, SCRATCH_MAIN, tree).steps.map(stepLine)).toEqual(kept)
  })

  test('an entry below a folder the worktree lists as a link gets no step and one warning naming it', () => {
    const main = new Map([['vendor', [entry('cache', 'dir')]]])
    const plan = planOf(['vendor/cache'], main, new Map([['', [link('vendor')]]]))

    expect(plan.steps).toEqual([])
    expect(plan.warnings).toEqual([mirrorLinkedParentWarning('vendor/cache')])
    expect(plan.warnings[0]).toContain('vendor/cache')
  })

  test('nothing is planned below a planned link, while an entry below a real folder is still linked', () => {
    const tree = new Map([['', [entry('web', 'dir')]]])

    expect(planOf(['thoughts', 'thoughts/shared'], new Map(), new Map()).steps.map(stepLine)).toEqual(['link thoughts'])
    expect(planOf(['thoughts', 'thoughts/shared', 'web/dist'], new Map(), tree).steps.map(stepLine)).toEqual([
      'link thoughts',
      'link web/dist',
    ])
  })

  test('mirrorPaths names every folder the rules read, in the main checkout and in the worktree, sorted', () => {
    expect(mirrorPaths(['.cadre', 'a/b/c', 'web/.env'], ['pm'])).toEqual({
      main: ['', '.cadre', '.cadre/bin', '.cadre/pm', '.claude', 'a/b', 'web'],
      tree: ['', '.cadre', '.cadre/bin', '.cadre/pm', '.claude', 'a', 'a/b', 'web'],
    })
  })

  test('an untracked whole .cadre is mirrored as an ignored one is: real folders and one link per child', async () => {
    const world = await teamWorld()
    const dirs = {
      ...world.dirs,
      '/repo/.cadre': [
        entry('be', 'dir'),
        entry('bin', 'dir'),
        entry('cadre.json'),
        entry('manifest.json'),
        entry('pm', 'dir'),
      ],
      '/repo/.cadre/be': [entry('role.json')],
      '/repo/.cadre/bin': [entry('be'), entry('pm')],
      '/repo/.cadre/pm': [entry('role.json')],
    }
    const gitDir = rule(GIT_DIR_ARGV(BARE_WORKTREE), 0, `${BARE_GIT_DIR}\n`)
    const mirrorOf = async (listing: HostRunRule) =>
      stepRuns(await epic({ ...world, dirs }, [listing, gitDir], 'PROJ-1', ''))
    const untracked = await mirrorOf(rule(LS_OTHERS_ARGV('/repo'), 0, '.cadre/\0'))

    expect(untracked).toEqual(await mirrorOf(rule(LS_IGNORED_ARGV('/repo'), 0, '.cadre/\0')))
    expect(untracked).toEqual([
      'mkdir .cadre',
      'mkdir .cadre/be',
      'link .cadre/be/role.json',
      'mkdir .cadre/bin',
      'link .cadre/bin/be',
      'link .cadre/bin/pm',
      'link .cadre/cadre.json',
      'link .cadre/manifest.json',
      'mkdir .cadre/pm',
      'link .cadre/pm/role.json',
    ])
  })
})
