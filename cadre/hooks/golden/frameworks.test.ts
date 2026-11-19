import { describe, expect, test } from 'claude-code/testing'

import { hostWorld } from '../testkit'
import { captureFrameworks } from './capture'
import { GOLDEN_FRAMEWORKS } from './frameworks'
import { frameworksWorld } from './worlds'

/** The answers of a frameworks run that keeps GSD, accepts its hunks and confirms the review. */
const ANSWERS = {
  'Which frameworks does this team use? Found: GSD.': 'Keep GSD (Recommended)',
  '.planning/config.json:': 'Accept',
  'Review the framework changes': 'Confirm',
}

describe('golden: /cadre frameworks, dry and applied', () => {
  test('dry: frameworks --dry-run over an applied team that stores None while GSD is in use', async () => {
    const world = await frameworksWorld()
    const golden = await captureFrameworks(world, ANSWERS, { dryRun: true })
    expect(golden).toEqual(GOLDEN_FRAMEWORKS.dry)
  })

  test('applied: plain frameworks over the same team, its review answered Confirm', async () => {
    const world = await frameworksWorld()
    const golden = await captureFrameworks(world, ANSWERS, { dryRun: false, host: hostWorld({}) })
    expect(golden).toEqual(GOLDEN_FRAMEWORKS.applied)
  })
})
