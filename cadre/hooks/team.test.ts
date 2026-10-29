import { describe, expect, test } from 'claude-code/testing'

import type { CadreState, LaunchStart, ManifestEntry, RoleSpec } from '../types'
import { sha256Hex } from './core/hash'
import { stableJson } from './core/json'
import { cadreJsonText, roleJsonText } from './generate/docs'
import { RUNTIME_KICKOFF_TEST } from './generate/launcher'
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
  onDisk,
  plannedFiles,
  scansOf,
  stateOf,
  templateRole,
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

/** PM and BE, in the order cadre.json lists them in the epic worlds. */
const TEAM: readonly RoleSpec[] = [templateRole('pm'), templateRole('be')]

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

describe('where /cadre epic runs and what it needs (D-161, D-165)', () => {
  test('readTeam with no id reads the whole team for cadre epic; with an id it refuses an unlisted one', async () => {
    const io = memIo(await teamWorld(), {}).io
    const read = await readTeam(io, '/repo', 'epic', null)

    expect(read.kind === 'ok' ? read.value.roles.map(role => role.id) : read.text).toEqual(['pm', 'be'])
    expect(await readTeam(io, '/repo', 'epic', 'qa')).toEqual({ kind: 'refuse', text: regenNoRole('qa', ['pm', 'be']) })
  })
})
