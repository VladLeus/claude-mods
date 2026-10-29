import { describe, expect, test } from 'claude-code/testing'

import type { RunState } from '../scan/autopilot'
import { lastLogText, runOutcomeOf, statusStateOf } from './autopilot-files'

/** An autopilot log whose run ended done: the final handoff request, then the finished line (D-111). */
const DONE_LOG =
  '2026-10-20T01:00:00.000Z  final handoff requested (done)\n' +
  '2026-10-20T01:01:00.000Z  finished (done): handed back to the person\n'

/** An autopilot log of a run that has not ended: no finished line. */
const RUNNING_LOG = '2026-10-20T01:00:00.000Z  availability mode none -> asking\n'

/** An autopilot log of a done run that was revived, then ended for its time limit. */
const TIME_LOG =
  '2026-10-20T01:00:00.000Z  finished (done): handed back to the person\n' +
  '2026-10-20T01:05:00.000Z  revived after finishing (done) by extend: to 03:05\n' +
  '2026-10-20T02:00:00.000Z  finished (time): handed back to the person\n'

/** The state statusStateOf gives a run state and an outcome, with a status file and a log there unless told. */
function stateOf(
  runState: RunState,
  outcome: 'done' | 'stopped' | 'none',
  hasStatusFile = true,
  hasLog = true,
): string {
  return statusStateOf({ runState, outcome, hasStatusFile, hasLog })
}

describe('status states (D-111)', () => {
  test('statusStateOf: an active run is running, an unknown one unknown, an off one told by its finished line', () => {
    expect(stateOf('active', 'done')).toBe('running')
    expect(stateOf('active', 'none', false, false)).toBe('running')
    expect(stateOf('unknown', 'done')).toBe('unknown')
    expect(stateOf('none', 'done')).toBe('done')
    expect(stateOf('none', 'stopped')).toBe('stopped')
    expect(stateOf('none', 'none', false, false)).toBe('not started')
    expect(stateOf('none', 'none', true, false)).toBe('stopped')
    expect(stateOf('none', 'none', false, true)).toBe('stopped')
    expect(stateOf('none', 'none')).toBe('stopped')
  })

  test('the last finished line decides, and a line is one record whatever separator its text holds', () => {
    expect(runOutcomeOf(DONE_LOG)).toBe('done')
    expect(runOutcomeOf(TIME_LOG)).toBe('stopped')
    expect(runOutcomeOf(`${TIME_LOG}${DONE_LOG}`)).toBe('done')
    expect(runOutcomeOf(RUNNING_LOG)).toBe('none')
    expect(runOutcomeOf('')).toBe('none')
    expect(runOutcomeOf('2026-10-20T01:00:00.000Z  finished (done): handed\u2029back\n')).toBe('done')
  })

  test('lastLogText shows the last line after its stamp, cleaned and at most 160 characters (T-03-35)', () => {
    const long = `2026-10-20T01:00:00.000Z  the session reported its work complete: ${'x'.repeat(300)}\n`
    const shown = lastLogText(`${DONE_LOG}${long}`) ?? ''
    expect(Array.from(shown)).toHaveLength(160)
    expect(shown.startsWith('the session reported its work complete: xxx')).toBe(true)
    expect(shown.endsWith('\u2026')).toBe(true)
    expect(lastLogText('2026-10-20T01:00:00.000Z  a\u0007b\u202Ec\u2028d\n')).toBe('abcd')
    expect(lastLogText(DONE_LOG)).toBe('finished (done): handed back to the person')
    expect(lastLogText('')).toBeNull()
    expect(lastLogText('no stamp here\n')).toBeNull()
  })
})
