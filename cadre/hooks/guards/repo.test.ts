import { describe, expect, test } from 'claude-code/testing'

import type { InitIo } from '../../types'
import { HOME_ROOT_REPLY, MAX_READ_BYTES } from '../facts'
import { INIT_FILE_SYSTEM_ROOT_REPLY, INIT_HOME_ROOT_REPLY, INIT_ROOT_UNKNOWN_REPLY } from '../init'
import { autopilotReply } from '../scan'
import { DEFAULT_LOCATIONS, gitWorld, memIo, memWorld, withStats } from '../testkit'
import { commandRefusal, initGuard, NOT_INTERACTIVE_REPLY } from './repo'

/** The status file autopilot keeps for session s1 of the fixture user. */
const STATUS_PATH = '/home/u/.claude/autopilot/s1.json'

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
