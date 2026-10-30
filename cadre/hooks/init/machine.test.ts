import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_LOCATIONS, stateAt, TEMPLATE_ROLES } from '../testkit'
import { initialState, nextStage } from './machine'
import { INIT_CANCELLED } from './replies'
import type { InitState } from './state'
import { policyStage } from './stages/policy'

/** What the launcher start stage after the git policy is entered with: the session's locations and the roles. */
const POLICY_DRAFT = { locations: DEFAULT_LOCATIONS, roles: TEMPLATE_ROLES }

/**
 * The init state with its own objects frozen (the state, its draft, cursor, effect, open question and outputs), so a
 * transition that writes into its input throws; the shared fixtures the draft points to are left as they are.
 */
function frozen(state: InitState): InitState {
  const parts: readonly unknown[] = [state.draft, state.sub, state.effect, state.openQuestion, state.outputs]
  for (const part of parts) Object.freeze(part)

  return Object.freeze(state)
}

describe('init stage machine (D-230)', () => {
  test('initialState starts at the guard with its effect out, no open question and nothing to show', () => {
    const state = initialState(true)
    expect(state.stage).toBe('guard')
    expect(state.dryRun).toBe(true)
    expect(state.effect.kind).not.toBe('ask')
    expect(state.effect.kind).not.toBe('end')
    expect(state.openQuestion).toBeNull()
    expect(state.outputs).toEqual([])
    expect(state.returnTo).toBeNull()
    expect(initialState(false).dryRun).toBe(false)
  })

  test('an answer whose kind does not match the open effect cancels init with the cancel reply (fail closed)', () => {
    const state = nextStage(initialState(true), { kind: 'answer', text: 'Commit all' })
    expect(state.stage).toBe('cancelled')
    expect(state.effect).toEqual({ kind: 'end', reply: INIT_CANCELLED })
    expect(state.openQuestion).toBeNull()
  })

  test('any answer once init is done or cancelled cancels it with the cancel reply (fail closed)', () => {
    const done = stateAt('done', {}, { effect: { kind: 'end', reply: 'cadre init --dry-run' } })
    const cancelled = nextStage(initialState(true), { kind: 'answer', text: 'yes' })
    for (const state of [done, cancelled]) {
      const next = nextStage(state, { kind: 'answer', text: 'yes' })
      expect(next.stage).toBe('cancelled')
      expect(next.effect).toEqual({ kind: 'end', reply: INIT_CANCELLED })
      expect(next.openQuestion).toBeNull()
    }
  })

  test('nextStage gives a new state and leaves the state it was given as it was', () => {
    const state = frozen(policyStage.enter(stateAt('policy', POLICY_DRAFT)))
    const next = nextStage(state, { kind: 'answer', text: 'Commit all' })
    expect(next).not.toBe(state)
    expect(state.stage).toBe('policy')
    expect(state.draft.policy).toBeUndefined()
    expect(state.effect.kind).toBe('ask')
    expect(next.draft.policy).toBe('all')
  })
})
