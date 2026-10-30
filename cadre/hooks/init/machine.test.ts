import { describe, expect, test } from 'claude-code/testing'

import type { GuardResult } from '../guards/repo'
import { scanWarnings } from '../scan/gather'
import { DEFAULT_LOCATIONS, gitWorld, scansOf, stateAt, TEMPLATE_ROLES } from '../testkit'
import { scanSummaryLines, scanWarningLines } from '../ui/blocks/scan'
import { initialState, nextStage, STAGES } from './machine'
import { INIT_CANCELLED } from './replies'
import type { Answer, InitState } from './state'
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

describe('the guard and scan stages (D-230)', () => {
  test('the guard is an io effect: a refusal is the whole reply and logs nothing, else consent is next', () => {
    const state = initialState(true)
    expect(state.effect).toEqual({ kind: 'io', call: { id: 'guard' } })
    const refusal = { kind: 'io', result: { id: 'guard', result: { kind: 'refuse', text: 'no' } } } satisfies Answer
    const refused = nextStage(state, refusal)
    expect(refused.stage).toBe('done')
    expect(refused.effect).toEqual({ kind: 'end', reply: 'no' })
    expect(refused.outputs).toEqual([])
    const ok = { kind: 'ok', locations: DEFAULT_LOCATIONS } satisfies GuardResult
    const passed = nextStage(state, { kind: 'io', result: { id: 'guard', result: ok } })
    expect(passed.stage).toBe('consent')
    expect(passed.draft.locations).toBe(DEFAULT_LOCATIONS)
  })

  test('the scans are an io effect with the consent answer; the scan block shows before the history ask', async () => {
    const draft = { locations: DEFAULT_LOCATIONS, readUserMcp: false }
    const state = STAGES.scan.enter(stateAt('scan', draft))
    const call = { id: 'scan', locations: DEFAULT_LOCATIONS, readUserMcp: false }
    expect(state.effect).toEqual({ kind: 'io', call })
    const gathered = await scansOf(gitWorld())
    const next = nextStage(state, { kind: 'io', result: { id: 'scan', result: gathered } })
    const warnings = scanWarningLines(scanWarnings(DEFAULT_LOCATIONS, gathered))
    const lines = [...scanSummaryLines(gathered.repo, gathered.setup), ...warnings]
    expect(next.stage).toBe('history')
    expect(next.draft.gathered).toBe(gathered)
    expect(next.outputs).toEqual([{ kind: 'show', block: { key: 'scan', lines } }])
  })
})
