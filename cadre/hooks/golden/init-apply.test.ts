import { describe, expect, test } from 'claude-code/testing'

import { hostWorld, INIT_ANSWERS } from '../testkit'
import { captureApply } from './capture'
import { GOLDEN_INIT_APPLY } from './init-apply'
import { GOLDEN_WORLDS, modeWorld } from './worlds'

describe('golden: plain init writes, runs and manifest (D-219)', () => {
  test('nothing: a git repo where the scan detects nothing, with the INIT_ANSWERS defaults', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    expect(await captureApply(world, answers, hostWorld({}))).toEqual(GOLDEN_INIT_APPLY.nothing)
  })

  test('gsd: a proven user GSD whose accepted mode hunk runs through the host (modeWorld)', async () => {
    expect(await captureApply(modeWorld(), INIT_ANSWERS, hostWorld({}))).toEqual(GOLDEN_INIT_APPLY.gsd)
  })
})
