import { describe, expect, test } from 'claude-code/testing'

import type { EpicRecord, HostRun, ManifestEntry, RoleSpec } from '../types'
import {
  BASE_BRANCH_ARGV,
  BASE_COMMIT_ARGV,
  EPIC_BRANCHES_ARGV,
  EPIC_NO_PM,
  epicAddFailedReply,
  epicBadKeyReply,
  epicCreatedText,
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
  GIT_DIR_ARGV,
  parseEpicRecord,
  parseWorktreeList,
  runEpic,
  WORKTREE_LIST_ARGV,
} from './epic'
import type { WorktreeEntry } from './epic'
import { cadreJsonText, roleJsonText } from './generate'
import { sha256Hex } from './hash'
import { readTeam, regenNoRole } from './init'
import { stableJson } from './plan'
import { CHECKOUT_ARGV, checkoutOf } from './scan'
import { claudeTooOldReply, launcherChangedReply } from './start'
import { DEFAULT_LOCATIONS, hostWorld, memHost, memIo, memWorld, templateRole } from './testkit'
import type { HostCall, HostRunRule, HostWrite, MemWorld } from './testkit'

/** The worktree `/cadre epic PROJ-1 Add retry` makes in the fixture repo /repo (D-146). */
const WORKTREE = '/repo/.claude/worktrees/proj-1-add-retry'

/** The branch of that worktree (D-146). */
const BRANCH = 'epic/proj-1-add-retry'

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
  const host = memHost(hostWorld({ runs: [...runs, ...BASE_RULES] }))
  const reply = await runEpic(memIo(world, {}).io, host.io, { key, title, terminal: 'auto' })

  return { reply, writes: host.writes, calls: host.calls }
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
    const run = await epic(await teamWorld(), [rule(ADD_ARGV, 0)])

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

/** The git dir of the new worktree of PROJ-1 Add retry, where its epic record lies (D-164). */
const GIT_DIR = '/repo/.git/worktrees/proj-1-add-retry'

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
    const run = await epic(await teamWorld(), [branches, rule(readd, 0)])

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
    const reply = { key: 'PROJ-1', title: 'Old title', path, branch: 'epic/proj-1-x', warnings: [] }

    expect(addRuns(run)).toEqual([])
    expect(run.reply).toBe(epicCreatedText({ ...reply, outcome: 'reused' }))
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

    expect(created.calls.map(call => call.argv).filter(argv => argv.includes('--absolute-git-dir'))).toEqual([
      GIT_DIR_ARGV(WORKTREE),
    ])
    expect(created.writes).toEqual([
      { path: `${GIT_DIR}/cadre-epic.json`, text: epicRecordText(RECORD), isWritten: true },
    ])
    expect(detached.writes.map(write => parseEpicRecord(write.text)?.base)).toEqual(['abc123'])
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
