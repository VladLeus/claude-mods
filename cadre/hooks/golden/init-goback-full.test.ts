import { describe, expect, test } from 'claude-code/testing'

import { captureQueued } from './capture'
import { GOLDEN_INIT_GOBACK_FULL } from './init-goback-full'
import { GOLDEN_WORLDS } from './worlds'

describe('golden: init review go-backs with content (D-219)', () => {
  test('assignments typed over everyStep, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.everyStep
    const golden = await captureQueued(world, { ...answers, 'Review the plan': ['assignments', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_INIT_GOBACK_FULL.assignments)
  })

  test('memory typed over everyStep, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.everyStep
    const golden = await captureQueued(world, { ...answers, 'Review the plan': ['memory', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_INIT_GOBACK_FULL.memory)
  })

  test('env typed over everyStep, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.everyStep
    const golden = await captureQueued(world, { ...answers, 'Review the plan': ['env', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_INIT_GOBACK_FULL.env)
  })

  test('hunks typed over everyStep, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.everyStep
    const golden = await captureQueued(world, { ...answers, 'Review the plan': ['hunks', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_INIT_GOBACK_FULL.hunks)
  })
})
