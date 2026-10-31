import { describe, expect, test } from 'claude-code/testing'

import type { FactsPort, IdentityRunResult, SettingsSource } from '../../../types'
import { DEFAULT_LOCATIONS } from '../../testkit'
import { collectFacts, collectGsdIdentity } from './collect'

/** One runtime identity call the fake port was asked for. */
type IdentityCall = {
  readonly argv: readonly string[]
  readonly cwd: string
}

/** The user-level and the repo-local GSD folders of the fixture session (DEFAULT_LOCATIONS). */
const USER_GSD = '/home/u/.claude/gsd-core'
const PROJECT_GSD = '/repo/.claude/gsd-core'

/**
 * A FactsPort over the fixture session: a path exists only when it is in `present`, every listing is empty, nothing
 * can be read or stat'd, every settings source is an empty object, and each identity call is recorded in `calls` and
 * answers no stdout. `over` replaces any member.
 */
function fakePort(present: readonly string[], calls: IdentityCall[], over: Partial<FactsPort> = {}): FactsPort {
  return {
    exists: async path => present.includes(path),
    list: async () => [],
    read: async () => null,
    stat: async () => null,
    env: async () => null,
    settings: async () => ({}),
    runIdentity: async (argv, cwd): Promise<IdentityRunResult> => {
      calls.push({ argv, cwd })

      return { stdout: null, problem: null }
    },
    ...over,
  }
}

describe('collectFacts', () => {
  test('a root that cannot be listed gives the treated as unknown warning', async () => {
    const { raw } = await collectFacts(fakePort([], [], { list: async () => null }), DEFAULT_LOCATIONS)

    expect(raw.repoEntries).toBeNull()
    expect(raw.warnings).toContain('could not list the repo root (treated as unknown)')
  })

  test('collectFacts never runs the identity call, not even for a built user-level candidate (D-243)', async () => {
    const built = [USER_GSD, `${USER_GSD}/bin/lib/cli-exit.cjs`, PROJECT_GSD, `${PROJECT_GSD}/bin/lib/cli-exit.cjs`]
    const calls: IdentityCall[] = []

    const { raw } = await collectFacts(fakePort(built, calls), DEFAULT_LOCATIONS)

    expect(calls).toEqual([])
    expect(raw.gsd.map(candidate => [candidate.location, candidate.runtimeTried])).toEqual([
      ['user', false],
      ['project', false],
    ])
  })

  test('a probe the port cannot answer counts as present, so the read is tried and warns (fail open)', async () => {
    const exists = async (path: string): Promise<boolean | null> =>
      path === `${USER_GSD}/VERSION` ? null : path === USER_GSD
    const { raw } = await collectFacts(fakePort([], [], { exists }), DEFAULT_LOCATIONS)

    expect(raw.warnings).toContain('could not read ~/.claude/gsd-core/VERSION (treated as unknown)')
  })

  test('collectGsdIdentity runs only a built user-level candidate, in its GSD folder (D-243)', async () => {
    const built = [USER_GSD, `${USER_GSD}/bin/lib/cli-exit.cjs`, PROJECT_GSD, `${PROJECT_GSD}/bin/lib/cli-exit.cjs`]
    const calls: IdentityCall[] = []
    const probed = await collectGsdIdentity(fakePort(built, calls), DEFAULT_LOCATIONS)
    const argv = ['node', `${USER_GSD}/bin/gsd-tools.cjs`, 'runtime-identity', '--raw']
    const unbuilt: IdentityCall[] = []
    const skipped = await collectGsdIdentity(fakePort([USER_GSD], unbuilt), DEFAULT_LOCATIONS)
    const homeless = await collectGsdIdentity(fakePort(built, []), { ...DEFAULT_LOCATIONS, home: null })

    expect([calls, probed?.location, probed?.runtimeTried]).toEqual([[{ argv, cwd: USER_GSD }], 'user', true])
    expect([unbuilt, skipped?.runtimeTried, skipped?.runtimeProblem, homeless]).toEqual([[], false, 'not-built', null])
  })

  test('a GSD folder whose probe the port cannot answer counts as present', async () => {
    const built = `${USER_GSD}/bin/lib/cli-exit.cjs`
    const exists = async (path: string): Promise<boolean | null> => (path === USER_GSD ? null : path === built)

    const { raw } = await collectFacts(fakePort([], [], { exists }), DEFAULT_LOCATIONS)

    expect(raw.gsd.find(candidate => candidate.location === 'user')?.isPresent).toBe(true)
  })

  test('a settings source that throws is skipped with a warning', async () => {
    // The port maps a host throw to null, so a null is what the collector sees of a source that threw.
    const settings = async (source: SettingsSource): Promise<unknown> => (source === 'project' ? null : {})
    const { raw } = await collectFacts(fakePort([], [], { settings }), DEFAULT_LOCATIONS)

    expect(raw.settings.map(entry => entry.source)).toEqual(['user', 'local'])
    expect(raw.warnings).toContain('could not read project settings (treated as unknown)')
  })
})
