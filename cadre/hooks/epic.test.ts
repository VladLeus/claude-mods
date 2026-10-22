import { describe, expect, test } from 'claude-code/testing'

import type { HostRun, ManifestEntry, RoleSpec } from '../types'
import {
  EPIC_NO_PM,
  epicAddFailedReply,
  epicBadKeyReply,
  epicKeyOf,
  epicManyPmReply,
  epicNotMainReply,
  epicPmOf,
  epicSlug,
  runEpic,
} from './epic'
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
