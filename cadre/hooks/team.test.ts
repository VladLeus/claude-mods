import { describe, expect, test } from 'claude-code/testing'

import type { CadreState, InitIo, LaunchStart, RoleSpec } from '../types'
import { HOME_ROOT_REPLY } from './facts'
import { commandRefusal, initGuard, repoGuard } from './guards/repo'
import { autopilotReply } from './scan'
import {
  compileTeam,
  noStateReply,
  readTeam,
  REGEN_NO_STATE,
  regenBadRole,
  regenNeedsFramework,
  regenNoRole,
  scopesFor,
} from './team'
import {
  cardOf,
  DEFAULT_LOCATIONS,
  gitWorld,
  memIo,
  memWorld,
  onDisk,
  plannedFiles,
  scansOf,
  stateOf,
  STATUS_PATH,
  templateRole,
  withStats,
} from './testkit'
import type { MemWorld } from './testkit'

describe('repoGuard and readTeam', () => {
  /** BE and PM on the repo default, in the order cadre.json lists them. */
  const team = [templateRole('be'), templateRole('pm')]
  /** BE's role.json in the fixtures. */
  const BE_ROLE = '/repo/.cadre/be/role.json'
  /** PM's role.json in the fixtures. */
  const PM_ROLE = '/repo/.cadre/pm/role.json'
  /** The commands whose refusal of a missing cadre.json is worded for them. */
  const STATE_COMMANDS: readonly ('regen' | 'start' | 'status')[] = ['regen', 'start', 'status']

  /** A git repo at /repo holding every file init writes for `roles` and the state `over`, cadre.json included. */
  async function teamWorld(roles: readonly RoleSpec[] = team, over: Partial<CadreState> = {}): Promise<MemWorld> {
    const files = await plannedFiles(gitWorld(), roles, over)

    return gitWorld({ dirs: { '/repo/.git': [], '/repo/.cadre': [] }, files: onDisk(files) })
  }

  /** `world` with BE's role.json replaced by text that is not JSON. */
  function withBadRole(world: MemWorld): MemWorld {
    return { ...world, files: { ...world.files, [BE_ROLE]: 'not json' } }
  }

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

  test('noStateReply words the missing cadre.json for its command, and regen keeps its text (D-68)', () => {
    expect(noStateReply('start')).toBe('cadre start needs .cadre/cadre.json from /cadre init: run /cadre init first.')
    expect(noStateReply('status')).toBe('cadre status needs .cadre/cadre.json from /cadre init: run /cadre init first.')
    expect(REGEN_NO_STATE).toBe(noStateReply('regen'))
  })

  test('readTeam refuses a missing cadre.json in the wording of its command', async () => {
    for (const command of STATE_COMMANDS) {
      const read = await readTeam(memIo(gitWorld(), {}).io, '/repo', command, 'be')
      expect([command, read]).toEqual([command, { kind: 'refuse', text: noStateReply(command) }])
    }
  })

  test('readTeam refuses an id cadre.json does not list, naming the roles it lists', async () => {
    const read = await readTeam(memIo(await teamWorld(), {}).io, '/repo', 'start', 'qa')
    expect(read).toEqual({ kind: 'refuse', text: regenNoRole('qa', ['be', 'pm']) })
  })

  test("readTeam keeps runRegen's order: the id, then each role.json, then a role with no framework", async () => {
    const badRole = withBadRole(await teamWorld())
    expect(await readTeam(memIo(badRole, {}).io, '/repo', 'start', 'qa')).toEqual({
      kind: 'refuse',
      text: regenNoRole('qa', ['be', 'pm']),
    })
    expect(await readTeam(memIo(badRole, {}).io, '/repo', 'start', 'pm')).toEqual({
      kind: 'refuse',
      text: regenBadRole('be'),
    })
    const unframed = await teamWorld(team, { framework: null })
    expect(await readTeam(memIo(withBadRole(unframed), {}).io, '/repo', 'start', 'pm')).toEqual({
      kind: 'refuse',
      text: regenBadRole('be'),
    })
    expect(await readTeam(memIo(unframed, {}).io, '/repo', 'start', 'pm')).toEqual({
      kind: 'refuse',
      text: regenNeedsFramework('be'),
    })
  })

  test('readTeam gives the state, every listed role in cadre.json order and the text each was read from', async () => {
    const world = await teamWorld()
    const read = await readTeam(memIo(world, {}).io, '/repo', 'start', 'pm')
    if (read.kind !== 'ok') throw new Error(`readTeam refused: ${read.text}`)
    expect(read.value.state).toEqual(stateOf(team))
    expect(read.value.roles.map(role => role.id)).toEqual(['be', 'pm'])
    expect([...read.value.texts]).toEqual([
      ['be', world.files[BE_ROLE]],
      ['pm', world.files[PM_ROLE]],
    ])
  })

  test('compileTeam gathers with the stored consent and compiles every role for the stored launch start', async () => {
    const start: LaunchStart = { kind: 'dir', path: 'apps/web' }
    const world = gitWorld({ files: { '/home/u/.claude.json': '{"mcpServers":{"linear":{"command":"x"}}}' } })
    const run = memIo(world, {})
    const state = stateOf(team, { launchStart: start, readUserMcp: true })
    const { gathered, scopes } = await compileTeam(run.io, DEFAULT_LOCATIONS, state, team)
    expect(gathered).toEqual(await scansOf(world, true))
    expect(run.reads.filter(path => path === '/home/u/.claude.json')).toHaveLength(1)
    expect(scopes).toEqual(scopesFor(team, 'none', gathered, [], start))
    expect(scopes).not.toEqual(scopesFor(team, 'none', gathered, [], { kind: 'git-root' }))
  })

  test('compileTeam judges attended from the config on disk, as regen does (D-70, D-72)', async () => {
    const config = '/repo/.planning/config.json'
    const cases: readonly (readonly [string | null, boolean])[] = [
      [null, true],
      ['{"mode":"interactive","workflow":{"text_mode":false}}', true],
      ['{"mode":"yolo","workflow":{"text_mode":false}}', false],
    ]
    for (const [text, isAttended] of cases) {
      const world = text === null ? gitWorld() : gitWorld({ files: { [config]: text } })
      const state = stateOf(team, { framework: 'gsd' })
      const { scopes } = await compileTeam(memIo(world, {}).io, DEFAULT_LOCATIONS, state, team)
      // BE has Bash, so only the config decides; a GSD role without Bash, such as PM, is always attended.
      expect([text, cardOf(scopes, 'be').isAttended]).toEqual([text, isAttended])
    }
  })
})
