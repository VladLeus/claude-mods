import { describe, expect, test } from 'claude-code/testing'

import { captureInit } from './capture'
import { GOLDEN_INIT_DRY } from './init-dry'
import { GOLDEN_WORLDS } from './worlds'

describe('golden: init --dry-run (D-219)', () => {
  test('nothing: a git repo where the scan detects nothing, with the INIT_ANSWERS defaults', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    expect(await captureInit(world, answers)).toEqual(GOLDEN_INIT_DRY.nothing)
  })
})
