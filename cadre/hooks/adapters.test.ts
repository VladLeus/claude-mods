import { describe, expect, test } from 'claude-code/testing'

import { ADAPTERS } from './adapters'
import { gateProblems, isDecisionType, missingFields, REQUIRED_FIELDS } from './framework'

describe('ADAPTERS', () => {
  test('lists GSD, superpowers and the built-in fallback in that order', () => {
    expect(ADAPTERS.map(adapter => adapter.id)).toEqual(['gsd', 'superpowers', 'none'])
  })

  test('the list and each adapter in it are frozen, so repeated or concurrent detect runs share one contract', () => {
    expect(Object.isFrozen(ADAPTERS)).toBe(true)
    for (const adapter of ADAPTERS) {
      expect(Object.isFrozen(adapter)).toBe(true)
    }
  })
})

describe('adapter contract (DET-04)', () => {
  test('every adapter declares every required field', () => {
    for (const adapter of ADAPTERS) {
      expect(missingFields(adapter)).toEqual([])
    }
  })

  test('a copy of any adapter with one required field removed reports exactly that field', () => {
    for (const adapter of ADAPTERS) {
      for (const field of REQUIRED_FIELDS) {
        expect(missingFields({ ...adapter, [field]: undefined })).toEqual([field])
      }
    }
  })

  test('every gate table passes the gate contract', () => {
    for (const adapter of ADAPTERS) {
      expect(gateProblems(adapter.humanGates)).toEqual([])
    }
  })

  test('every gate has a shared decision type, or is a standing rule with none', () => {
    for (const adapter of ADAPTERS) {
      for (const gate of adapter.humanGates) {
        const decided = gate.decisionType === null ? gate.kind === 'standing-rule' : isDecisionType(gate.decisionType)
        expect(decided).toBe(true)
      }
    }
  })

  test('every kickoff names the AUTOPILOT_DONE answer', () => {
    for (const adapter of ADAPTERS) {
      expect(adapter.kickoffText({ role: 'BE', specPath: null })).toContain('AUTOPILOT_DONE')
    }
  })
})
