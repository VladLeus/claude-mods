import { describe, expect, test } from 'claude-code/testing'

import { hostWorld } from '../testkit'
import { captureStatus } from './capture'
import { GOLDEN_STATUS } from './status'
import { DONE_LOG, onStatus, S9_TITLED, s9World, TIME_LOG } from './worlds'

describe('golden: /cadre status, one reply per state (D-219)', () => {
  test('done: an off run whose log ends finished (done)', async () => {
    const golden = await captureStatus(s9World('{"isOn":false}', DONE_LOG), hostWorld({ runs: [S9_TITLED] }), 'be')
    expect(golden).toEqual(GOLDEN_STATUS.done)
  })

  test('running: a status file on with a fresh beat, whatever the log says', async () => {
    const golden = await captureStatus(s9World(onStatus(10_000), DONE_LOG), hostWorld({ runs: [S9_TITLED] }), 'be')
    expect(golden).toEqual(GOLDEN_STATUS.running)
  })

  test('not started: a session with neither a status file nor a log', async () => {
    const golden = await captureStatus(s9World(null, null), hostWorld({ runs: [S9_TITLED] }), 'be')
    expect(golden).toEqual(GOLDEN_STATUS['not started'])
  })

  test('stopped: a stale beat with a log that ends finished (time)', async () => {
    const golden = await captureStatus(s9World(onStatus(120_000), TIME_LOG), hostWorld({ runs: [S9_TITLED] }), 'be')
    expect(golden).toEqual(GOLDEN_STATUS.stopped)
  })

  test('unknown: a status file that is not JSON', async () => {
    const golden = await captureStatus(s9World('{', DONE_LOG), hostWorld({ runs: [S9_TITLED] }), 'be')
    expect(golden).toEqual(GOLDEN_STATUS.unknown)
  })
})
