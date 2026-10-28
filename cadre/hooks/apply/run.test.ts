import { describe, expect, test } from 'claude-code/testing'

import type { DesiredFile } from '../../types'
import { planWithManifest } from '../plan/plan'
import { DEFAULT_LOCATIONS, hostWorld, memHost, memIo, memWorld } from '../testkit'
import { improverArgv } from './improver'
import type { BuiltFile } from './improver'
import type { ApplyInput } from './private'
import { writeImproved, writeSteps, writeWithImprover } from './run'
import { applySteps } from './steps'

/** BE's built CLAUDE.md, repo-relative, as the plan and the reply name it. */
const BE_CLAUDE_MD = '.cadre/be/CLAUDE.md'

/** BE's built CLAUDE.md as an absolute path under the fixture repo /repo. */
const BE_CLAUDE_MD_PATH = `/repo/${BE_CLAUDE_MD}`

/** The text apply writes to BE's built CLAUDE.md: its header line, then one repo part. */
const BE_BUILT = '<!-- cadre: instructions for role be -->\n\n# Rules\nRun the tests before a commit.\n'

/** The one desired file of the fixture apply: BE's built CLAUDE.md. */
const DESIRED: readonly DesiredFile[] = [{ path: BE_CLAUDE_MD, content: BE_BUILT, mode: 'file' }]

/** BE's built CLAUDE.md as the improver pass gets it, watching nothing else and with no flags. */
const BE_BUILT_FILE: BuiltFile = {
  path: BE_CLAUDE_MD_PATH,
  repoPath: BE_CLAUDE_MD,
  text: BE_BUILT,
  watched: [],
  runFlags: [],
}

/** The apply input of DESIRED planned over an empty repo with no manifest: no conflict and no private file. */
async function fixtureInput(): Promise<ApplyInput> {
  const planned = await planWithManifest({
    desired: DESIRED,
    disk: new Map(),
    manifest: null,
    manifestState: 'absent',
    carried: [],
    gitignore: null,
    hunks: [],
    cadreVersion: '0.2.0',
  })

  return { ...planned, desired: DESIRED, gitignore: null, choices: new Map() }
}

describe('writeWithImprover', () => {
  test('with no built file offered it writes the steps as writeSteps does, and runs no improver', async () => {
    const input = await fixtureInput()
    const steps = await applySteps(input)
    const allowed: ReadonlySet<string> = new Set()
    const helper = memHost(hostWorld({}))
    const direct = memHost(hostWorld({}))
    const args = { locations: DEFAULT_LOCATIONS, input, steps, offered: [], allowed }
    const outcome = await writeWithImprover(memIo(memWorld({}), {}).io, helper.io, args)

    expect(outcome).toEqual(await writeSteps(memIo(memWorld({}), {}).io, direct.io, DEFAULT_LOCATIONS, steps, allowed))
    expect(helper.writes).toEqual(direct.writes)
    expect(helper.calls.filter(call => call.argv[0] === 'claude')).toEqual([])
  })

  test('with a built file offered it runs the improver pass as writeImproved does', async () => {
    const input = await fixtureInput()
    const steps = await applySteps(input)
    const world = memWorld({ files: { [BE_CLAUDE_MD_PATH]: BE_BUILT } })
    const helper = memHost(hostWorld({}))
    const direct = memHost(hostWorld({}))
    const args = { locations: DEFAULT_LOCATIONS, input, steps, offered: [BE_BUILT_FILE], allowed: new Set<string>() }
    const outcome = await writeWithImprover(memIo(world, {}).io, helper.io, args)

    expect(outcome).toEqual(await writeImproved(memIo(world, {}).io, direct.io, args))
    expect(helper.writes).toEqual(direct.writes)
    expect(helper.calls.filter(call => call.argv[0] === 'claude').map(call => call.argv)).toEqual([
      improverArgv(BE_CLAUDE_MD_PATH),
    ])
  })
})
