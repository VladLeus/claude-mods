import { describe, expect, test } from 'claude-code/testing'

import type { InitIo } from '../../types'
import { INIT_FILE_SYSTEM_ROOT_REPLY, INIT_HOME_ROOT_REPLY, INIT_ROOT_UNKNOWN_REPLY } from '../init/replies'
import { autopilotReply } from '../scan/autopilot'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { BIDI_OVERRIDE, DEFAULT_LOCATIONS, gitWorld, memIo, memWorld, STATUS_PATH, withStats } from '../testkit'
import { HOME_ROOT_REPLY } from './refusals'
import { commandRefusal, gitRootRefusal, initGuard, NOT_INTERACTIVE_REPLY, notGitRepoReply, repoGuard } from './repo'

describe('initGuard', () => {
  test('a session nobody can be asked in is refused first, before any stat or read', async () => {
    for (const interactive of [false, null]) {
      const run = memIo(gitWorld({ interactive }), {})
      const { io, stats } = withStats(run)
      expect(await initGuard(io, 'init')).toEqual({ kind: 'refuse', text: NOT_INTERACTIVE_REPLY })
      expect(run.reads).toEqual([])
      expect(stats).toEqual([])
    }
  })

  test('an unreadable session root is refused next, before any stat or read', async () => {
    const run = memIo(gitWorld({ locations: null }), {})
    const { io, stats } = withStats(run)
    expect(await initGuard(io, 'init')).toEqual({ kind: 'refuse', text: INIT_ROOT_UNKNOWN_REPLY })
    expect(run.reads).toEqual([])
    expect(stats).toEqual([])
  })

  test('the home folder and the file system root are refused in init wording, before any stat or read', async () => {
    const cases = [
      { root: '/home/u', text: INIT_HOME_ROOT_REPLY },
      { root: '/', text: INIT_FILE_SYSTEM_ROOT_REPLY },
    ]
    for (const { root, text } of cases) {
      const run = memIo(gitWorld({ locations: { ...DEFAULT_LOCATIONS, root, givenRoot: root } }), {})
      const { io, stats } = withStats(run)
      expect(await initGuard(io, 'init')).toEqual({ kind: 'refuse', text })
      expect(run.reads).toEqual([])
      expect(stats).toEqual([])
    }
  })

  test('a root with no git repo above it is refused with the git init wording, before any read', async () => {
    const run = memIo(memWorld({}), {})
    const { io, stats } = withStats(run)
    expect(await initGuard(io, 'init')).toEqual({
      kind: 'refuse',
      text: 'cadre init needs a git repo: run git init first',
    })
    expect(stats).toEqual(['/repo/.git', '/.git'])
    expect(run.reads).toEqual([])
  })

  test('a root below the git top level is refused with the top level named, before any read', async () => {
    const locations = { ...DEFAULT_LOCATIONS, root: '/repo/app', givenRoot: '/repo/app' }
    const run = memIo(gitWorld({ locations }), {})
    const { io, stats } = withStats(run)
    expect(await initGuard(io, 'init')).toEqual({ kind: 'refuse', text: 'run /cadre init from the repo root: /repo' })
    expect(stats).toEqual(['/repo/app/.git', '/repo/.git'])
    expect(run.reads).toEqual([])
  })

  test('an active autopilot run in this session is refused after the git check', async () => {
    const files = { [STATUS_PATH]: '{"isOn":true,"phase":"running","beat":1000000}' }
    const run = memIo(gitWorld({ files }), {})
    expect(await initGuard(run.io, 'init')).toEqual({ kind: 'refuse', text: autopilotReply('active', 'init') })
    expect(run.reads).toEqual([STATUS_PATH])
  })

  test('a status file over the read cap or unreadable refuses with the unknown text', async () => {
    const unknown = { kind: 'refuse', text: autopilotReply('unknown', 'init') }
    const tooLarge = memIo(gitWorld({ files: { [STATUS_PATH]: 'x'.repeat(MAX_READ_BYTES + 1) } }), {})
    expect(await initGuard(tooLarge.io, 'init')).toEqual(unknown)
    const unreadable = memIo(gitWorld({ unknownPaths: [STATUS_PATH] }), {})
    expect(await initGuard(unreadable.io, 'init')).toEqual(unknown)
  })

  test('no HOME as given, no usable session id or no clock refuses as unknown, reading nothing', async () => {
    const unknown = { kind: 'refuse', text: autopilotReply('unknown', 'init') }
    const worlds = [
      gitWorld({ locations: { ...DEFAULT_LOCATIONS, givenHome: null } }),
      gitWorld({ sessionId: null }),
      gitWorld({ now: null }),
      gitWorld({ sessionId: '../s1' }),
    ]
    for (const world of worlds) {
      const run = memIo(world, {})
      expect(await initGuard(run.io, 'init')).toEqual(unknown)
      expect(run.reads).toEqual([])
    }
  })

  test('with the repo top level and no live autopilot run the guard goes on with the locations', async () => {
    const stale = '{"isOn":true,"phase":"running","beat":1}'
    for (const files of [{}, { [STATUS_PATH]: '{"isOn":false}' }, { [STATUS_PATH]: stale }]) {
      const run = memIo(gitWorld({ files }), {})
      expect(await initGuard(run.io, 'init')).toEqual({ kind: 'ok', locations: DEFAULT_LOCATIONS })
    }
  })

  test('regen skips the interactive check (D-99): in claude -p it goes on and never asks the host', async () => {
    const run = memIo(gitWorld({ interactive: false }), {})
    const io: InitIo = {
      ...run.io,
      isInteractive: async () => {
        throw new Error('the regen guard must not ask whether anyone is there')
      },
    }
    expect(await initGuard(io, 'regen')).toEqual({ kind: 'ok', locations: DEFAULT_LOCATIONS })
  })

  test('regen is refused in the regen wording at the home folder and for every later check', async () => {
    const home = memIo(gitWorld({ locations: { ...DEFAULT_LOCATIONS, root: '/home/u', givenRoot: '/home/u' } }), {})
    expect(await initGuard(home.io, 'regen')).toEqual({
      kind: 'refuse',
      text: commandRefusal(HOME_ROOT_REPLY, 'regen'),
    })
    const noRoot = memIo(gitWorld({ locations: null }), {})
    expect(await initGuard(noRoot.io, 'regen')).toEqual({
      kind: 'refuse',
      text: 'cadre regen could not read the session root, so it stopped before reading anything.',
    })
    const noGit = memIo(memWorld({}), {})
    expect(await initGuard(noGit.io, 'regen')).toEqual({
      kind: 'refuse',
      text: 'cadre regen needs a git repo: run git init first',
    })
    const active = memIo(gitWorld({ files: { [STATUS_PATH]: '{"isOn":true,"beat":1000000}' } }), {})
    expect(await initGuard(active.io, 'regen')).toEqual({ kind: 'refuse', text: autopilotReply('active', 'regen') })
  })
})

describe('repoGuard', () => {
  test('repoGuard refuses in the start wording, in the order of initGuard: root, home, git, top level', async () => {
    const noRoot = memIo(gitWorld({ locations: null }), {})
    expect(await repoGuard(noRoot.io, 'start')).toEqual({
      kind: 'refuse',
      text: 'cadre start could not read the session root, so it stopped before reading anything.',
    })
    const home = withStats(memIo(memWorld({ locations: { ...DEFAULT_LOCATIONS, root: '/home/u' } }), {}))
    expect(await repoGuard(home.io, 'start')).toEqual({
      kind: 'refuse',
      text: commandRefusal(HOME_ROOT_REPLY, 'start'),
    })
    expect(home.stats).toEqual([])
    const noGit = memIo(memWorld({}), {})
    expect(await repoGuard(noGit.io, 'start')).toEqual({
      kind: 'refuse',
      text: 'cadre start needs a git repo: run git init first',
    })
    const appLocations = { ...DEFAULT_LOCATIONS, root: '/repo/app', givenRoot: '/repo/app' }
    const below = memIo(gitWorld({ locations: appLocations }), {})
    expect(await repoGuard(below.io, 'start')).toEqual({
      kind: 'refuse',
      text: 'run /cadre start from the repo root: /repo',
    })
  })

  test('repoGuard never asks whether anyone is there and never reads the autopilot status file', async () => {
    const files = { [STATUS_PATH]: '{"isOn":true,"phase":"running","beat":1000000}' }
    const run = memIo(gitWorld({ interactive: false, files }), {})
    const io: InitIo = {
      ...run.io,
      isInteractive: async () => {
        throw new Error('repoGuard must not ask whether anyone is there')
      },
    }
    expect(await repoGuard(io, 'start')).toEqual({ kind: 'ok', locations: DEFAULT_LOCATIONS })
    expect(run.reads).toEqual([])
    // The same world stops the regen guard, so the pass above is repoGuard leaving the autopilot check out.
    expect(await initGuard(memIo(gitWorld({ files }), {}).io, 'regen')).toEqual({
      kind: 'refuse',
      text: autopilotReply('active', 'regen'),
    })
  })
})

const ELLIPSIS = String.fromCharCode(0x2026)

describe('gitRootRefusal and notGitRepoReply', () => {
  test('a root that is the top level has no refusal, with or without a trailing slash', () => {
    expect(gitRootRefusal('/repo', '/repo', 'init')).toBeNull()
    expect(gitRootRefusal('/repo/', '/repo', 'init')).toBeNull()
    expect(gitRootRefusal('/repo', '/repo/', 'init')).toBeNull()
    expect(gitRootRefusal('/repo//', '/repo/', 'regen')).toBeNull()
  })

  test('a root below the top level is refused with the top level named', () => {
    expect(gitRootRefusal('/repo/sub', '/repo', 'init')).toBe('run /cadre init from the repo root: /repo')
    expect(gitRootRefusal('/repo/sub', '/repo', 'regen')).toBe('run /cadre regen from the repo root: /repo')
    expect(gitRootRefusal('/repo-other', '/repo', 'init')).toBe('run /cadre init from the repo root: /repo')
  })

  test('the top level is shown cleaned and capped at 240 code points', () => {
    const hidden = gitRootRefusal('/x/sub', `/re${BIDI_OVERRIDE}po`, 'init')
    const long = gitRootRefusal('/x/sub', `/${'a'.repeat(300)}`, 'init')
    const prefix = 'run /cadre init from the repo root: '

    expect(hidden).toBe(`${prefix}/repo`)
    expect(long?.startsWith(prefix)).toBe(true)
    expect(Array.from(long?.slice(prefix.length) ?? '')).toHaveLength(240)
    expect(long?.endsWith(ELLIPSIS)).toBe(true)
  })

  test('no git repo above the root is refused with the locked wording', () => {
    expect(notGitRepoReply('init')).toBe('cadre init needs a git repo: run git init first')
    expect(notGitRepoReply('regen')).toBe('cadre regen needs a git repo: run git init first')
  })
})
