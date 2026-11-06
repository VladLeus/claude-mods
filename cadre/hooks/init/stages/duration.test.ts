import { describe, expect, test } from 'claude-code/testing'

import type { RoleChange, RoleSpec } from '../../../types'
import { proposeRoles } from '../../roles/propose'
import { driven, repoScan, stateAt, templateRole } from '../../testkit'
import { MAX_ASKS, NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import { proposalLines, rolesContext } from '../../ui/blocks/context'
import { cancelledReply } from '../replies'
import type { InitState } from '../state'
import {
  DURATION_DISMISSED_REASON,
  DURATION_OPTIONS,
  DURATION_QUESTION,
  durationContextLine,
  durationStage,
} from './duration'

/** The duration stage entered for `roles`, with no duration in the draft yet. */
function durationAt(roles: readonly RoleSpec[]): InitState {
  return durationStage.enter(stateAt('duration', { roles }))
}

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

  test('a chosen or typed duration in autopilot grammar is taken, trimmed and lowercased', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['4h', '4h'],
      ['90m', '90m'],
      [' 8H ', '8h'],
      ['1h30M', '1h30m'],
      ['45', '45'],
    ]
    for (const [answer, duration] of cases) {
      const run = driven(durationAt(roles), [answer])
      expect([answer, run.state.draft.duration]).toEqual([answer, duration])
      expect(run.asked).toEqual([ASKED])
      const lines = proposalLines(roles, [])
      const { rows } = rolesContext(roles, [])
      // A pane surface asks the question with the summary of its context (D-310).
      const summary = '3 roles: pm, tl, security'
      const pane = { asked: ASKED, text: withContext(DURATION_QUESTION, summary) }
      const context = { title: 'Roles', lines, kind: 'roles', summary, pane, rows }
      expect(run.specs).toEqual([{ options: ['4h', '2h', '8h'], header: 'Duration', context, acceptsTyped: true }])
      expect(run.outputs).toEqual([])
    }
  })

  test('zero and more than 168 hours are asked again with why on top, and a duration after them is taken', () => {
    const run = driven(durationAt(roles), ['0', '200h', '2h'])
    expect(run.state.draft.duration).toBe('2h')
    const accepts = 'a duration such as 4h, 90m or 1h30m, at most 168h'
    expect(run.asked).toEqual([
      ASKED,
      `'0' isn't one of: ${accepts}.\n${ASKED}`,
      `'200h' isn't one of: ${accepts}.\n${ASKED}`,
    ])
  })

  test('three answers outside the grammar cancel with no usable answer, and nothing is taken (A1)', () => {
    const run = driven(durationAt(roles), ['soon', 'soon', 'soon', '4h'])
    expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(NO_USABLE_ANSWER_REASON) })
    expect(run.asked).toHaveLength(MAX_ASKS)
    expect(run.state.draft.duration).toBeUndefined()
    expect(run.outputs).toEqual([])
  })

  test('a dismissed duration question is cancelled at once with the reason, which the step never prints', () => {
    const run = driven(durationAt(roles), [])
    expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(DURATION_DISMISSED_REASON) })
    expect(run.asked).toEqual([ASKED])
    expect(run.outputs).toEqual([])
    expect(DURATION_DISMISSED_REASON).toBe('The autopilot duration question was dismissed or not answered.')
  })
})

describe('question context lines (G-02-1)', () => {
  test('a refusal still goes on top: the refusal, then the question, then its context (D-136)', () => {
    const run = driven(durationAt([templateRole('pm'), templateRole('qa')]), ['soon', '4h'])
    expect(run.state.draft.duration).toBe('4h')
    const asked = `${DURATION_QUESTION}\nApplies to every role: pm, qa.`
    const refusal = "'soon' isn't one of: a duration such as 4h, 90m or 1h30m, at most 168h."
    expect(run.asked).toEqual([asked, `${refusal}\n${asked}`])
  })
})

describe('the duration stage (D-230)', () => {
  /** PM, Team Lead and Security: the team the duration is asked for. */
  const roles = proposeRoles(repoScan()).roles

  test('the duration question carries the roles with their purposes and the scan changes (D-236)', () => {
    const changes: readonly RoleChange[] = [{ roleId: 'fe', change: 'dropped', reason: 'No web code.', evidence: [] }]
    const state = durationStage.enter(stateAt('duration', { roles, changes }))
    const lines = proposalLines(roles, changes)
    const asked = withContext(DURATION_QUESTION, durationContextLine(roles))
    const summary = '3 roles: pm, tl, security'
    const pane = { asked, text: withContext(DURATION_QUESTION, summary) }
    const { rows } = rolesContext(roles, changes)
    expect(state.openQuestion?.spec.context).toEqual({ title: 'Roles', lines, kind: 'roles', summary, pane, rows })
  })

  test('durationStage asks the duration question with the role ids; the open question is that ask', () => {
    const state = durationStage.enter(stateAt('duration', { roles }))
    const question = withContext(DURATION_QUESTION, durationContextLine(roles))
    const lines = proposalLines(roles, [])
    const { rows } = rolesContext(roles, [])
    const summary = '3 roles: pm, tl, security'
    const pane = { asked: question, text: withContext(DURATION_QUESTION, summary) }
    const context = { title: 'Roles', lines, kind: 'roles', summary, pane, rows }
    const ask = { question, spec: { options: ['4h', '2h', '8h'], header: 'Duration', context, acceptsTyped: true } }
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
