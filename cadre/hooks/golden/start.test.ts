import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_LOCATIONS, hostWorld } from '../testkit'
import { captureStart } from './capture'
import { GOLDEN_START } from './start'
import {
  appliedWorld,
  CLAUDE_OK,
  claudeRule,
  GIT_OK,
  guardedWorld,
  LAUNCHER_PATH,
  repoWorld,
  withoutFile,
} from './worlds'

describe('golden: /cadre start renders and refusals (D-219)', () => {
  test('render: be over the applied world, with claude new enough and git answering', async () => {
    const golden = await captureStart(await appliedWorld(), hostWorld({ runs: [CLAUDE_OK, GIT_OK] }), 'be')
    expect(golden).toEqual(GOLDEN_START.render)
  })

  test('refusalRepo: a session root below the git top level refuses before the team is read', async () => {
    const locations = { ...DEFAULT_LOCATIONS, root: '/repo/app', givenRoot: '/repo/app' }
    const golden = await captureStart(repoWorld({ locations }), hostWorld({ runs: [CLAUDE_OK, GIT_OK] }), 'be')
    expect(golden).toEqual(GOLDEN_START.refusalRepo)
  })

  test('refusalTeam: a git repo with no .cadre/cadre.json refuses before the launcher is checked', async () => {
    const golden = await captureStart(guardedWorld(), hostWorld({ runs: [CLAUDE_OK, GIT_OK] }), 'be')
    expect(golden).toEqual(GOLDEN_START.refusalTeam)
  })

  test('refusalLauncher: a missing launcher refuses before claude is run', async () => {
    const world = withoutFile(await appliedWorld(), LAUNCHER_PATH)
    const golden = await captureStart(world, hostWorld({ runs: [CLAUDE_OK, GIT_OK] }), 'be')
    expect(golden).toEqual(GOLDEN_START.refusalLauncher)
  })

  test('refusalClaude: a claude --version that cannot run refuses before any other run', async () => {
    const golden = await captureStart(await appliedWorld(), hostWorld({ runs: [claudeRule(null), GIT_OK] }), 'be')
    expect(golden).toEqual(GOLDEN_START.refusalClaude)
  })
})
