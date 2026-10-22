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
  epicListFailedReply,
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
  epicStepFailedReply,
  EXCLUDES_CONFIG_ARGV,
  EXCLUDES_FILE,
  excludesText,
  GIT_DIR_ARGV,
  GLOBAL_EXCLUDES_ARGV,
  globalExcludesPath,
  globalExcludesWarning,
  LS_IGNORED_ARGV,
  LS_OTHERS_ARGV,
  mirrorLinkedParentWarning,
  mirrorPaths,
  mirrorPlan,
  mirrorUnhideableWarning,
  parseEpicRecord,
  parseWorktreeList,
  runEpic,
  untrackedEntries,
  WORKTREE_CONFIG_ARGV,
  WORKTREE_LIST_ARGV,
} from './epic'
import type { EpicStep, WorktreeEntry } from './epic'
import { isObject, MAX_READ_BYTES, parseJsonValue } from './facts'
import { cadreJsonText, roleJsonText } from './generate'
import { sha256Hex } from './hash'
import { readTeam, regenNoRole } from './init'
import { stableJson } from './plan'
import { CHECKOUT_ARGV, checkoutOf } from './scan'
import {
  claudeTooOldReply,
  COPIED_LINE,
  GIT_COMMON_DIR_ARGV,
  launcherChangedReply,
  runStart,
  worktreeClaudeMd,
} from './start'
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
    const created = epicCreatedText({ ...reply, outcome: 'reused', warnings: [] })

    expect(addRuns(run)).toEqual([])
    // The role lines of the render stage follow it (D-157).
    expect(run.reply.slice(0, created.length)).toBe(created)
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

  test('excludesText escapes the special characters and trailing spaces of each link line (03.1-W2 S2)', () => {
    expect(excludesText('', ['app/[id]', 'a*b?', 'back\\slash', 'notes  '])).toBe(
      '# cadre links (cadre epic)\n/a\\*b\\?\n/app/\\[id]\n/back\\\\slash\n/notes\\ \\ \n/.cadre/*/.runtime/\n',
    )
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
      GLOBAL_EXCLUDES_ARGV('/repo').join(' '),
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

  test('a failed step stops the mirror there, and the record keeps only the links that ran (03.1-W2 S4)', async () => {
    const failed = rule(['/bin/ln', '-s', '--', '/repo/node_modules', `${BARE_WORKTREE}/node_modules`], 1)
    const ignored = rule(LS_IGNORED_ARGV('/repo'), 0, 'dist/\0node_modules/\0thoughts/\0')
    const gitDir = rule(GIT_DIR_ARGV(BARE_WORKTREE), 0, `${BARE_GIT_DIR}\n`)
    const run = await epic(await teamWorld(), [failed, ignored, gitDir], 'PROJ-1', '')

    expect(run.reply).toBe(epicStepFailedReply('node_modules'))
    expect(stepRuns(run)).toEqual(['link dist', 'link node_modules'])
    expect(parseEpicRecord(lastWrite(run, BARE_RECORD) ?? '')?.links).toEqual(['dist'])
  })

  test('a failed or rejected ls-files run stops before the excludes file and any step (03.1-W2 S4)', async () => {
    const failures = [
      rule(LS_OTHERS_ARGV('/repo'), 128),
      rule(LS_OTHERS_ARGV('/repo'), null),
      rule(LS_IGNORED_ARGV('/repo'), 128),
    ]
    for (const failure of failures) {
      const run = await epic(await teamWorld(), [failure, ...NODE_MODULES_RULES], 'PROJ-1', '')

      expect(run.reply).toBe(epicListFailedReply('PROJ-1'))
      expect(run.writes.filter(write => write.path === BARE_EXCLUDES)).toEqual([])
      expect(run.calls.filter(call => (call.argv[0] ?? '').startsWith('/bin/'))).toEqual([])
    }
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

  test('a reuse plans nothing below a target the worktree lists, and warns of nothing (03.1-W2 S3)', () => {
    const main = new Map([
      ['', [entry('thoughts', 'dir')]],
      ['thoughts', [entry('x.log')]],
    ])
    const plan = planOf(['thoughts', 'thoughts/x.log'], main, new Map([['', [link('thoughts')]]]))

    expect(plan.steps).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  test('nothing is planned below a planned link, while an entry below a real folder is still linked', () => {
    const tree = new Map([['', [entry('web', 'dir')]]])

    expect(planOf(['thoughts', 'thoughts/shared'], new Map(), new Map()).steps.map(stepLine)).toEqual(['link thoughts'])
    expect(planOf(['thoughts', 'thoughts/shared', 'web/dist'], new Map(), tree).steps.map(stepLine)).toEqual([
      'link thoughts',
      'link web/dist',
    ])
  })

  test('a name with a line break or another control character gets no step, nor anything below it (03.1-W2 S2)', () => {
    const main = new Map([['', [entry('a\n*'), entry('b\rc'), entry('node_modules', 'dir')]]])
    const plan = planOf(['a\n*', 'a\n*/x', 'b\rc', 'node_modules'], main, new Map())

    expect(plan.steps.map(stepLine)).toEqual(['link node_modules'])
    expect(plan.links).toEqual(['node_modules'])
    expect(plan.copies).toEqual([])
    expect(plan.warnings).toEqual([mirrorUnhideableWarning('a\n*'), mirrorUnhideableWarning('b\rc')])
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

/** The user's global excludes file, as `git config --global --path core.excludesFile` names it in the specs. */
const GLOBAL_EXCLUDES = '/home/u/.gitignore_global'

/** git naming GLOBAL_EXCLUDES as the user's global excludes file. */
const GLOBAL_RULE = rule(GLOBAL_EXCLUDES_ARGV('/repo'), 0, `${GLOBAL_EXCLUDES}\n`)

/** The worktree of PROJ-1 that git lists on the branch epic/proj-1-x, so /cadre epic PROJ-1 reuses it (D-163). */
const KEPT_WORKTREE = '/repo/.claude/worktrees/proj-1-x'

/** The git dir of KEPT_WORKTREE, where its epic record and its excludes file lie. */
const KEPT_GIT_DIR = '/repo/.git/worktrees/proj-1-x'

/**
 * git listing the main checkout and KEPT_WORKTREE, naming KEPT_WORKTREE's git dir, and ignoring `.env`, `dist/` and
 * `node_modules/` in the main checkout.
 */
const KEPT_RULES: readonly HostRunRule[] = [
  rule(
    WORKTREE_LIST_ARGV('/repo'),
    0,
    'worktree /repo\nHEAD a\nbranch refs/heads/main\n\n' +
      `worktree ${KEPT_WORKTREE}\nHEAD b\nbranch refs/heads/epic/proj-1-x\n`,
  ),
  rule(GIT_DIR_ARGV(KEPT_WORKTREE), 0, `${KEPT_GIT_DIR}\n`),
  rule(LS_IGNORED_ARGV('/repo'), 0, '.env\0dist/\0node_modules/\0'),
]

/** A team world whose KEPT_WORKTREE lists node_modules (a link) and .env (a copy) and has `record` as its record. */
async function keptWorld(record: string): Promise<MemWorld> {
  const world = await teamWorld()

  return {
    ...world,
    files: { ...world.files, [`${KEPT_GIT_DIR}/${EPIC_RECORD_FILE}`]: record },
    dirs: { ...world.dirs, [KEPT_WORKTREE]: [link('node_modules'), entry('.env')] },
  }
}

/** The text of the last write to `path` in an epic run; undefined when the run wrote none there. */
function lastWrite(run: EpicRun, path: string): string | undefined {
  return run.writes.filter(write => write.path === path).at(-1)?.text
}

describe("the user's global excludes and the reuse mirror (D-147, D-163, D-164)", () => {
  test('the global excludes file is core.excludesFile, else under XDG_CONFIG_HOME, else ~/.config/git/ignore', () => {
    const run = (exitCode: number, stdout: string): HostRun => ({ exitCode, stdout, stderr: '' })
    const unset = run(1, '')

    expect(globalExcludesPath(run(0, `${GLOBAL_EXCLUDES}\n`), unset, '/home/u')).toBe(GLOBAL_EXCLUDES)
    expect(globalExcludesPath(unset, run(0, '/x\n'), '/home/u')).toBe('/x/git/ignore')
    expect(globalExcludesPath(unset, unset, '/home/u')).toBe('/home/u/.config/git/ignore')
    expect(globalExcludesPath(unset, unset, null)).toBeNull()
    expect(globalExcludesPath(run(0, 'relative/ignore\n'), null, '/home/u')).toBe('/home/u/.config/git/ignore')
  })

  test('the global excludes lookup follows include and includeIf in the global config (03.1-W2 S1)', () => {
    const argv = ['git', '-C', '/repo', 'config', '--includes', '--global', '--path', 'core.excludesFile']

    expect(GLOBAL_EXCLUDES_ARGV('/repo')).toEqual(argv)
  })

  test('the text of the global excludes file heads the excludes file; an absent one gives an empty head', async () => {
    const world = await teamWorld()
    const withGlobal = { ...world, files: { ...world.files, [GLOBAL_EXCLUDES]: '*.log\n' } }
    const read = await epic(withGlobal, [GLOBAL_RULE, ...NODE_MODULES_RULES], 'PROJ-1', '')
    const absent = await epic(world, [GLOBAL_RULE, ...NODE_MODULES_RULES], 'PROJ-1', '')

    expect(lastWrite(read, BARE_EXCLUDES)).toBe(excludesText('*.log\n', ['node_modules']))
    expect(lastWrite(absent, BARE_EXCLUDES)).toBe(excludesText('', ['node_modules']))
    expect([read.reply, absent.reply].filter(reply => reply.includes('warning: '))).toEqual([])
  })

  test('an unreadable or too-large global excludes file gives an empty head and one warning', async () => {
    const world = await teamWorld()
    const big = { ...world, files: { ...world.files, [GLOBAL_EXCLUDES]: '#'.repeat(MAX_READ_BYTES + 1) } }
    const rules = [GLOBAL_RULE, ...NODE_MODULES_RULES]
    const unreadable = await epic({ ...world, unknownPaths: [GLOBAL_EXCLUDES] }, rules, 'PROJ-1', '')
    const runs = [unreadable, await epic(big, rules, 'PROJ-1', '')]
    const warning = `warning: ${globalExcludesWarning(GLOBAL_EXCLUDES)}`

    for (const run of runs) {
      expect(lastWrite(run, BARE_EXCLUDES)).toBe(excludesText('', ['node_modules']))
      expect(run.reply.split('\n').filter(line => line.startsWith('warning: '))).toEqual([warning])
    }
  })

  test('a reuse links only what is missing, and its excludes file and record keep what was recorded', async () => {
    const recorded = { ...RECORD, slug: 'proj-1-x', branch: 'epic/proj-1-x', links: ['node_modules'], copies: ['.env'] }
    const kept = await keptWorld(epicRecordText(recorded))
    // main shows a regular .env too, so a copy over the worktree's own .env would run /bin/cp (03.1-W2 S4).
    const world = {
      ...kept,
      files: { ...kept.files, '/repo/.env': 'MAIN=1\n' },
      dirs: { ...kept.dirs, '/repo': [entry('.env')] },
    }
    const run = await epic(world, KEPT_RULES)
    const excludes = `${KEPT_GIT_DIR}/${EXCLUDES_FILE}`
    const isConfig = (argv: readonly string[]) => argv.includes('--worktree') || argv.includes('true')
    const configs = run.calls.map(call => call.argv).filter(isConfig)

    expect(linkRuns(run)).toEqual([['/bin/ln', '-s', '--', '/repo/dist', `${KEPT_WORKTREE}/dist`]])
    expect(run.calls.filter(call => call.argv[0] === '/bin/cp')).toEqual([])
    expect(lastWrite(run, excludes)).toBe(excludesText('', ['dist', 'node_modules']))
    expect(configs).toEqual([WORKTREE_CONFIG_ARGV('/repo'), EXCLUDES_CONFIG_ARGV(KEPT_WORKTREE, excludes)])
    expect(parseEpicRecord(lastWrite(run, `${KEPT_GIT_DIR}/${EPIC_RECORD_FILE}`) ?? '')).toEqual({
      ...recorded,
      links: ['dist', 'node_modules'],
      copies: ['.env'],
    })
  })

  test('a reuse with an unreadable record still mirrors, and records only what this run made', async () => {
    const run = await epic(await keptWorld('not a record'), KEPT_RULES)

    expect(linkRuns(run)).toEqual([['/bin/ln', '-s', '--', '/repo/dist', `${KEPT_WORKTREE}/dist`]])
    expect(parseEpicRecord(lastWrite(run, `${KEPT_GIT_DIR}/${EPIC_RECORD_FILE}`) ?? '')).toEqual({
      schema: 1,
      key: 'PROJ-1',
      slug: 'proj-1-x',
      title: 'Add retry',
      branch: 'epic/proj-1-x',
      base: null,
      createdAt: 1_000_000,
      links: ['dist'],
      copies: [],
    })
  })
})

/** git naming the repo's common dir, the same from the main checkout and from a worktree (WT-02, Pattern 1). */
const COMMON_DIR = rule(GIT_COMMON_DIR_ARGV, 0, '/repo/.git\n')

/** A new PROJ-1 worktree whose git dir git names, with the common dir named too, so each role renders there. */
const RENDER_RULES: readonly HostRunRule[] = [rule(GIT_DIR_ARGV(BARE_WORKTREE), 0, `${BARE_GIT_DIR}\n`), COMMON_DIR]

/**
 * The team world of `roles` (PM and BE by default) and `readUserMcp` with each role folder a real folder in the main
 * checkout and in BARE_WORKTREE, as the mirror makes them there (D-156), so a render in either finds its role folder.
 */
async function renderWorld(roles: readonly RoleSpec[] = TEAM, readUserMcp = false): Promise<MemWorld> {
  const world = await teamWorld(roles, readUserMcp)
  const folders = roles.flatMap(role => [`/repo/.cadre/${role.id}`, `${BARE_WORKTREE}/.cadre/${role.id}`])

  return { ...world, dirs: { ...world.dirs, ...Object.fromEntries(folders.map(folder => [folder, []])) } }
}

/** The command the epic reply gives role `id` of BARE_WORKTREE (D-167): `cd -- <worktree> && <launcher>`. */
function epicCommand(id: string): string {
  return `cd -- ${BARE_WORKTREE} && ${BARE_WORKTREE}/.cadre/bin/${id}`
}

/** What an epic run copied to the clipboard: the stdin of each pbcopy run, in order. */
function copiedTexts(run: EpicRun): (string | undefined)[] {
  return run.calls.filter(call => call.argv[0] === '/usr/bin/pbcopy').map(call => call.options.stdin)
}

/** The refusal of a render of the role be whose `.runtime` is a link, as /cadre start words it. */
const BE_RUNTIME_REFUSAL =
  '.cadre/be/.runtime/ or a folder in it is a link or not a folder: remove it and run /cadre start be again'

describe('rendering each role into the epic worktree (D-157, D-102)', () => {
  test('a new epic renders each role into its worktree, never main, and prints and copies each command', async () => {
    const run = await epic(await renderWorld(), RENDER_RULES, 'PROJ-1', '')
    const paths = run.writes.map(write => write.path)

    expect(paths).toContain(`${BARE_WORKTREE}/.cadre/pm/.runtime/settings.json`)
    expect(paths).toContain(`${BARE_WORKTREE}/.cadre/be/.runtime/stamp`)
    expect(paths.filter(path => path.startsWith('/repo/.cadre/'))).toEqual([])
    expect(run.reply.split('\n').slice(-3)).toEqual([
      `  pm: ${epicCommand('pm')}`,
      `  be: ${epicCommand('be')}`,
      COPIED_LINE,
    ])
    expect(copiedTexts(run)).toEqual([`${epicCommand('pm')}\n${epicCommand('be')}`])
  })

  test('a role whose .runtime in the worktree is a link is refused on its line, and the others render', async () => {
    const world = await renderWorld()
    const runtime = `${BARE_WORKTREE}/.cadre/be/.runtime`
    const realPaths = { [runtime]: '/repo/.cadre/be/.runtime' }
    const run = await epic({ ...world, dirs: { ...world.dirs, [runtime]: [] }, realPaths }, RENDER_RULES, 'PROJ-1', '')

    expect(run.reply.split('\n').slice(-3)).toEqual([
      `  pm: ${epicCommand('pm')}`,
      `  be: ${BE_RUNTIME_REFUSAL}`,
      COPIED_LINE,
    ])
    expect(run.writes.filter(write => write.path.startsWith(`${runtime}/`))).toEqual([])
    expect(copiedTexts(run)).toEqual([epicCommand('pm')])
  })
})

/** The settings.json the host was asked to write for role `id` under `root`, parsed; {} when none was written. */
function settingsAt(writes: readonly HostWrite[], root: string, id: string): Readonly<Record<string, unknown>> {
  const path = `${root}/.cadre/${id}/.runtime/settings.json`
  const value = parseJsonValue(writes.filter(write => write.path === path).at(-1)?.text ?? '')?.value

  return isObject(value) ? value : {}
}

/** The fixture user's `~/.claude.json`, recording the server jira for the main checkout's project only. */
const PROJECT_JIRA = JSON.stringify({ projects: { '/repo': { mcpServers: { jira: { command: 'jira-mcp' } } } } })

describe('the scope of an epic role (RESEARCH Pitfalls 1 and 2, WT-02)', () => {
  test('worktreeClaudeMd adds the CLAUDE.md files of the worktree, sorted and once each (Pitfall 1)', () => {
    expect(worktreeClaudeMd(['/repo/CLAUDE.md'], '/repo/.claude/worktrees/x')).toEqual([
      '/repo/.claude/worktrees/x/.claude/CLAUDE.md',
      '/repo/.claude/worktrees/x/CLAUDE.md',
      '/repo/CLAUDE.md',
    ])
  })

  test('a parts-flow epic role excludes the worktree CLAUDE.md files; one given project-claude-md none', async () => {
    const team = [templateRole('pm'), templateRole('be', { instructions: ['project-claude-md'] })]
    const run = await epic(await renderWorld(team), RENDER_RULES, 'PROJ-1', '')
    const excludes = (id: string) => settingsAt(run.writes, BARE_WORKTREE, id).claudeMdExcludes

    expect(excludes('pm')).toContain(`${BARE_WORKTREE}/CLAUDE.md`)
    expect(excludes('pm')).toContain(`${BARE_WORKTREE}/.claude/CLAUDE.md`)
    expect(excludes('be')).toEqual([])
  })

  test('an epic role keeps the memory folder /cadre start renders for it in main (WT-02)', async () => {
    const world = await renderWorld()
    const host = epicHost([COMMON_DIR])
    await runStart(memIo(world, {}).io, host.io, { id: 'pm', terminal: 'none' })
    const inMain = settingsAt(host.writes, '/repo', 'pm').autoMemoryDirectory
    const run = await epic(world, RENDER_RULES, 'PROJ-1', '')
    const inEpic = settingsAt(run.writes, BARE_WORKTREE, 'pm').autoMemoryDirectory

    expect(typeof inMain).toBe('string')
    expect(inEpic).toBe(inMain)
    expect(String(inEpic)).not.toContain('.claude/worktrees')
  })

  test("an epic role gets the MCP servers ~/.claude.json records for the main checkout's project", async () => {
    const team = [templateRole('pm', { mcp: ['jira'] }), templateRole('be')]
    const world = await renderWorld(team, true)
    const withJson = { ...world, files: { ...world.files, '/home/u/.claude.json': PROJECT_JIRA } }
    const run = await epic(withJson, RENDER_RULES, 'PROJ-1', '')

    expect(lastWrite(run, `${BARE_WORKTREE}/.cadre/pm/.runtime/mcp.json`)).toBe(
      stableJson({ mcpServers: { jira: { command: 'jira-mcp' } } }),
    )
    expect(run.reply).not.toContain('is not in ~/.claude.json')
  })

  test("an epic role's settings deny main's code dirs as well as the worktree's (03.1-W3 S2, Pitfall 2)", async () => {
    const world = await renderWorld([templateRole('pm', { hasBash: false }), templateRole('be')])
    const dirs = {
      ...world.dirs,
      '/repo': [...(world.dirs['/repo'] ?? []), entry('src', 'dir')],
      '/repo/src': [entry('a.ts')],
    }
    const run = await epic({ ...world, dirs }, RENDER_RULES, 'PROJ-1', '')
    const permissions = settingsAt(run.writes, BARE_WORKTREE, 'pm').permissions
    const deny = isObject(permissions) ? permissions.deny : undefined

    expect(deny).toContain('Read(//repo/src/**)')
    expect(deny).toContain('Edit(//repo/src/**)')
    expect(deny).toContain('Read(//repo/.claude/worktrees/proj-1/src/**)')
    expect(deny).toContain('Edit(//repo/.claude/worktrees/proj-1/src/**)')
  })
})
