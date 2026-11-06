import { describe, expect, test } from 'claude-code/testing'

import { captureInit } from './capture'
import { GOLDEN_INIT_DRY } from './init-dry'
import { GOLDEN_WORLDS } from './worlds'

describe('golden: init --dry-run (D-219)', () => {
  test('nothing: a git repo where the scan detects nothing, with the INIT_ANSWERS defaults', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    expect(await captureInit(world, answers)).toEqual(GOLDEN_INIT_DRY.nothing)
  })

  test('gsd: six roles with a proven user GSD that is in use, with the INIT_ANSWERS defaults', async () => {
    const { world, answers } = GOLDEN_WORLDS.gsd
    expect(await captureInit(world, answers)).toEqual(GOLDEN_INIT_DRY.gsd)
  })

  test('superpowers: six roles with superpowers in use, with the INIT_ANSWERS defaults', async () => {
    const { world, answers } = GOLDEN_WORLDS.superpowers
    expect(await captureInit(world, answers)).toEqual(GOLDEN_INIT_DRY.superpowers)
  })

  test('everyStep: two frameworks in use and the secret world, with the instruction parts declined', async () => {
    const { world, answers } = GOLDEN_WORLDS.everyStep
    expect(await captureInit(world, answers)).toEqual(GOLDEN_INIT_DRY.everyStep)
  })

  test('parts: instruction parts and two memories handed out by the model recommendations', async () => {
    const { world, answers } = GOLDEN_WORLDS.parts
    expect(await captureInit(world, answers)).toEqual(GOLDEN_INIT_DRY.parts)
  })
})
