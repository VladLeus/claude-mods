import { describe, expect, test } from 'claude-code/testing'

import { proposeRoles } from '../../roles/propose'
import { memIo, memWorld, repoScan, templateRole } from '../../testkit'
import { MAX_ASKS, NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import {
  DURATION_DISMISSED_REASON,
  DURATION_OPTIONS,
  DURATION_QUESTION,
  durationContextLine,
  durationStep,
} from './duration'

describe('durationStep', () => {
  /** PM, Team Lead and Security: the team the duration is asked for. */
  const roles = proposeRoles(repoScan()).roles
  /** The duration question as it is asked: the question, then the ids it applies to (D-136). */
  const ASKED = withContext(DURATION_QUESTION, durationContextLine(roles))

  test('the duration question offers 4h first, then 2h and 8h, and the list is frozen', () => {
    expect(DURATION_QUESTION).toBe('Autopilot duration for roles?')
    expect(DURATION_OPTIONS).toEqual(['4h', '2h', '8h'])
    expect(Object.isFrozen(DURATION_OPTIONS)).toBe(true)
  })

  test('a chosen or typed duration in autopilot grammar is taken, trimmed and lowercased', async () => {
    const cases: readonly (readonly [string, string])[] = [
      ['4h', '4h'],
      ['90m', '90m'],
      [' 8H ', '8h'],
      ['1h30M', '1h30m'],
      ['45', '45'],
    ]
    for (const [answer, duration] of cases) {
      const run = memIo(memWorld({}), [answer])
      expect(await durationStep(run.io, roles)).toEqual({ kind: 'accepted', value: duration })
      expect(run.asked).toEqual([ASKED])
      expect(run.specs).toEqual([{ options: ['4h', '2h', '8h'], header: 'Duration' }])
      expect(run.logged).toEqual([])
    }
  })

  test('zero and more than 168 hours are asked again with why on top, and a duration after them is taken', async () => {
    const run = memIo(memWorld({}), ['0', '200h', '2h'])
    expect(await durationStep(run.io, roles)).toEqual({ kind: 'accepted', value: '2h' })
    const accepts = 'a duration such as 4h, 90m or 1h30m, at most 168h'
    expect(run.asked).toEqual([
      ASKED,
      `'0' isn't one of: ${accepts}.\n${ASKED}`,
      `'200h' isn't one of: ${accepts}.\n${ASKED}`,
    ])
  })

  test('three answers outside the grammar cancel with no usable answer, and nothing is taken (A1)', async () => {
    const run = memIo(memWorld({}), ['soon', 'soon', 'soon', '4h'])
    expect(await durationStep(run.io, roles)).toEqual({ kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON })
    expect(run.asked).toHaveLength(MAX_ASKS)
    expect(run.logged).toEqual([])
  })

  test('a dismissed duration question is cancelled at once with the reason, which the step never prints', async () => {
    const run = memIo(memWorld({}), [])
    expect(await durationStep(run.io, roles)).toEqual({ kind: 'cancelled', reason: DURATION_DISMISSED_REASON })
    expect(run.asked).toEqual([ASKED])
    expect(run.logged).toEqual([])
    expect(DURATION_DISMISSED_REASON).toBe('The autopilot duration question was dismissed or not answered.')
  })
})

describe('question context lines (G-02-1)', () => {
  test('a refusal still goes on top: the refusal, then the question, then its context (D-136)', async () => {
    const run = memIo(memWorld({}), ['soon', '4h'])
    expect(await durationStep(run.io, [templateRole('pm'), templateRole('qa')])).toEqual({
      kind: 'accepted',
      value: '4h',
    })
    const asked = `${DURATION_QUESTION}\nApplies to every role: pm, qa.`
    const refusal = "'soon' isn't one of: a duration such as 4h, 90m or 1h30m, at most 168h."
    expect(run.asked).toEqual([asked, `${refusal}\n${asked}`])
  })
})
