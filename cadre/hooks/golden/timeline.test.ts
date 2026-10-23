import { describe, expect, test } from 'claude-code/testing'

import { hostWorld, INIT_ANSWERS } from '../testkit'
import { captureTimeline, captureTimelineApply, captureTimelineQueued } from './capture'
import { GOLDEN_TIMELINE } from './timeline'
import { GOLDEN_WORLDS, modeWorld } from './worlds'

describe('golden: the event order of init runs (WA-S1, D-219)', () => {
  test('dryNothing: a git repo where the scan detects nothing, with the INIT_ANSWERS defaults', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureTimeline(world, answers)
    expect(golden).toEqual(GOLDEN_TIMELINE.dryNothing)
  })

  test('dryGsd: six roles with a proven user GSD that is in use, with the INIT_ANSWERS defaults', async () => {
    const { world, answers } = GOLDEN_WORLDS.gsd
    const golden = await captureTimeline(world, answers)
    expect(golden).toEqual(GOLDEN_TIMELINE.dryGsd)
  })

  test('drySuperpowers: six roles with superpowers in use, with the INIT_ANSWERS defaults', async () => {
    const { world, answers } = GOLDEN_WORLDS.superpowers
    const golden = await captureTimeline(world, answers)
    expect(golden).toEqual(GOLDEN_TIMELINE.drySuperpowers)
  })

  test('dryEveryStep: two frameworks in use and the secret world, with the instruction parts declined', async () => {
    const { world, answers } = GOLDEN_WORLDS.everyStep
    const golden = await captureTimeline(world, answers)
    expect(golden).toEqual(GOLDEN_TIMELINE.dryEveryStep)
  })

  test('dryParts: instruction parts and two memories handed out by the model recommendations', async () => {
    const { world, answers } = GOLDEN_WORLDS.parts
    const golden = await captureTimeline(world, answers)
    expect(golden).toEqual(GOLDEN_TIMELINE.dryParts)
  })

  test('gobackRoles: Change roles, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureTimelineQueued(world, { ...answers, 'Review the plan': ['Change roles', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_TIMELINE.gobackRoles)
  })

  test('gobackPolicy: Change git policy, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureTimelineQueued(world, {
      ...answers,
      'Review the plan': ['Change git policy', 'Confirm'],
    })
    expect(golden).toEqual(GOLDEN_TIMELINE.gobackPolicy)
  })

  test('gobackLaunch: Change launcher start, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureTimelineQueued(world, {
      ...answers,
      'Review the plan': ['Change launcher start', 'Confirm'],
    })
    expect(golden).toEqual(GOLDEN_TIMELINE.gobackLaunch)
  })

  test('gobackDuration: duration typed, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureTimelineQueued(world, { ...answers, 'Review the plan': ['duration', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_TIMELINE.gobackDuration)
  })

  test('gobackModel: model typed, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureTimelineQueued(world, { ...answers, 'Review the plan': ['model', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_TIMELINE.gobackModel)
  })

  test('gobackAssignments: assignments typed, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureTimelineQueued(world, { ...answers, 'Review the plan': ['assignments', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_TIMELINE.gobackAssignments)
  })

  test('gobackMemory: memory typed, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureTimelineQueued(world, { ...answers, 'Review the plan': ['memory', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_TIMELINE.gobackMemory)
  })

  test('gobackEnv: env typed, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureTimelineQueued(world, { ...answers, 'Review the plan': ['env', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_TIMELINE.gobackEnv)
  })

  test('gobackHunks: hunks typed, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureTimelineQueued(world, { ...answers, 'Review the plan': ['hunks', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_TIMELINE.gobackHunks)
  })

  test('gobackFullAssignments: assignments typed over everyStep, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.everyStep
    const golden = await captureTimelineQueued(world, { ...answers, 'Review the plan': ['assignments', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_TIMELINE.gobackFullAssignments)
  })

  test('gobackFullMemory: memory typed over everyStep, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.everyStep
    const golden = await captureTimelineQueued(world, { ...answers, 'Review the plan': ['memory', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_TIMELINE.gobackFullMemory)
  })

  test('gobackFullEnv: env typed over everyStep, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.everyStep
    const golden = await captureTimelineQueued(world, { ...answers, 'Review the plan': ['env', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_TIMELINE.gobackFullEnv)
  })

  test('gobackFullHunks: hunks typed over everyStep, then Confirm', async () => {
    const { world, answers } = GOLDEN_WORLDS.everyStep
    const golden = await captureTimelineQueued(world, { ...answers, 'Review the plan': ['hunks', 'Confirm'] })
    expect(golden).toEqual(GOLDEN_TIMELINE.gobackFullHunks)
  })

  test('applyNothing: a git repo where the scan detects nothing, with the INIT_ANSWERS defaults', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    const golden = await captureTimelineApply(world, answers, hostWorld({}))
    expect(golden).toEqual(GOLDEN_TIMELINE.applyNothing)
  })

  test('applyGsd: a proven user GSD whose accepted mode hunk runs through the host (modeWorld)', async () => {
    const golden = await captureTimelineApply(modeWorld(), INIT_ANSWERS, hostWorld({}))
    expect(golden).toEqual(GOLDEN_TIMELINE.applyGsd)
  })
})
