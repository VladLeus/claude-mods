import { describe, expect, test } from 'claude-code/testing'

import type { FactsPort, IdentityRunResult, SettingsSource } from '../../../types'
import { DEFAULT_LOCATIONS } from '../../testkit'
import { collectFacts } from './collect'

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

  test('only the user-level candidate with a built runtime is run, with its GSD folder as cwd', async () => {
    const built = [USER_GSD, `${USER_GSD}/bin/lib/cli-exit.cjs`, PROJECT_GSD, `${PROJECT_GSD}/bin/lib/cli-exit.cjs`]
    const calls: IdentityCall[] = []

    await collectFacts(fakePort(built, calls), DEFAULT_LOCATIONS)

    const argv = ['node', `${USER_GSD}/bin/gsd-tools.cjs`, 'runtime-identity', '--raw']
    expect(calls).toEqual([{ argv, cwd: USER_GSD }])

    const unbuilt: IdentityCall[] = []
    const notBuilt = [USER_GSD, PROJECT_GSD, `${PROJECT_GSD}/bin/lib/cli-exit.cjs`]
    await collectFacts(fakePort(notBuilt, unbuilt), DEFAULT_LOCATIONS)
    expect(unbuilt).toEqual([])
  })

  test('a settings source that throws is skipped with a warning', async () => {
    // The port maps a host throw to null, so a null is what the collector sees of a source that threw.
    const settings = async (source: SettingsSource): Promise<unknown> => (source === 'project' ? null : {})
    const { raw } = await collectFacts(fakePort([], [], { settings }), DEFAULT_LOCATIONS)

    expect(raw.settings.map(entry => entry.source)).toEqual(['user', 'local'])
    expect(raw.warnings).toContain('could not read project settings (treated as unknown)')
  })
})
