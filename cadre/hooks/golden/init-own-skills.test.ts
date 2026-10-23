import { describe, expect, test } from 'claude-code/testing'

import { captureInit } from './capture'
import { GOLDEN_INIT_OWN_SKILLS } from './init-own-skills'
import { OWN_ACCEPTED, ownSkillsWorld } from './worlds'

describe('golden: init own skills with a model recommendation (D-219)', () => {
  test('accepted: the model recommends deploy-notes to security and tl, answered Accept recommendations', async () => {
    const world = ownSkillsWorld(['{"skills":{"S1":["security","tl"],"S2":[]}}'])
    expect(await captureInit(world, OWN_ACCEPTED)).toEqual(GOLDEN_INIT_OWN_SKILLS.accepted)
  })
})
