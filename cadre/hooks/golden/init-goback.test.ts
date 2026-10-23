import { describe, expect, test } from 'claude-code/testing'

import { captureQueued } from './capture'
import { GOLDEN_INIT_GOBACK } from './init-goback'
import { GOLDEN_WORLDS } from './worlds'

describe('golden: init review go-backs (D-219)', () => {
  test('Change roles, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureQueued(world, { ...answers, 'Review the plan': ['Change roles', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_INIT_GOBACK.roles)
  })

  test('Change git policy, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureQueued(world, { ...answers, 'Review the plan': ['Change git policy', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_INIT_GOBACK.policy)
  })

  test('Change launcher start, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureQueued(world, { ...answers, 'Review the plan': ['Change launcher start', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_INIT_GOBACK.launch)
  })

  test('duration typed, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureQueued(world, { ...answers, 'Review the plan': ['duration', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_INIT_GOBACK.duration)
  })

  test('model typed, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureQueued(world, { ...answers, 'Review the plan': ['model', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_INIT_GOBACK.model)
  })

  test('assignments typed, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureQueued(world, { ...answers, 'Review the plan': ['assignments', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_INIT_GOBACK.assignments)
  })

  test('memory typed, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureQueued(world, { ...answers, 'Review the plan': ['memory', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_INIT_GOBACK.memory)
  })

  test('env typed, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureQueued(world, { ...answers, 'Review the plan': ['env', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_INIT_GOBACK.env)
  })

  test('hunks typed, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureQueued(world, { ...answers, 'Review the plan': ['hunks', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_INIT_GOBACK.hunks)
  })
})
