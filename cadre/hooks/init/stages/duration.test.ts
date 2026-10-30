import { describe, expect, test } from 'claude-code/testing'

import { proposeRoles } from '../../roles/propose'
import { driven, memIo, memWorld, repoScan, stateAt, templateRole } from '../../testkit'
import { MAX_ASKS, NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import type { InitState } from '../state'
import {
  DURATION_DISMISSED_REASON,
  DURATION_OPTIONS,
  DURATION_QUESTION,
  durationContextLine,
  durationStage,
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

describe('the duration stage (D-230)', () => {
  /** PM, Team Lead and Security: the team the duration is asked for. */
  const roles = proposeRoles(repoScan()).roles

  test('durationStage asks the duration question with the role ids; the open question is that ask', () => {
    const state = durationStage.enter(stateAt('duration', { roles }))
    const question = withContext(DURATION_QUESTION, durationContextLine(roles))
    const ask = { question, spec: { options: ['4h', '2h', '8h'], header: 'Duration' } }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
    const run = driven(state, ['90m'])
    expect(run.state.draft.duration).toBe('90m')
    expect(run.state.draft.roles?.map(role => role.autopilot.duration)).toEqual(['90m', '90m', '90m'])
  })

  test('a duration the draft has is kept for every role with nothing asked, except in its own go-back', () => {
    const draft = { roles, duration: '8h' }
    const kept = durationStage.enter(stateAt('duration', draft))
    expect([kept.sub, kept.openQuestion]).toEqual([{ kind: 'done' }, null])
    expect(kept.draft.roles?.map(role => role.autopilot.duration)).toEqual(['8h', '8h', '8h'])
    const roleSteps = { returnTo: 'review', returnAfter: 'improver-install' } satisfies Partial<InitState>
    expect(durationStage.enter(stateAt('duration', draft, roleSteps)).sub).toEqual({ kind: 'done' })
    const again = durationStage.enter(stateAt('duration', draft, { returnTo: 'review', returnAfter: 'duration' }))
    expect(again.openQuestion?.question).toBe(withContext(DURATION_QUESTION, durationContextLine(roles)))
  })
})
