import { describe, expect, test } from 'claude-code/testing'

import { hostWorld } from '../testkit'
import { captureRegen } from './capture'
import { GOLDEN_REGEN } from './regen'
import { beOnlyWorld, regenWorld } from './worlds'

describe('golden: /cadre regen be, dry and applied (D-219)', () => {
  test('dry: regen be --dry-run with BE as the whole team (beOnlyWorld)', async () => {
    expect(await captureRegen(beOnlyWorld(), {}, { id: 'be', dryRun: true })).toEqual(GOLDEN_REGEN.dry)
  })

  test('dryOnly: regen be --dry-run in the BE and PM team with every file on disk (regenWorld)', async () => {
    expect(await captureRegen(await regenWorld(), {}, { id: 'be', dryRun: true })).toEqual(GOLDEN_REGEN.dryOnly)
  })

  test('applied: plain regen be with BE as the whole team (beOnlyWorld)', async () => {
    const golden = await captureRegen(beOnlyWorld(), {}, { id: 'be', dryRun: false, host: hostWorld({}) })
    expect(golden).toEqual(GOLDEN_REGEN.applied)
  })

  test('appliedOnly: plain regen be in the BE and PM team with every file on disk (regenWorld)', async () => {
    const golden = await captureRegen(await regenWorld(), {}, { id: 'be', dryRun: false, host: hostWorld({}) })
    expect(golden).toEqual(GOLDEN_REGEN.appliedOnly)
  })
})
