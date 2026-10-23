import { describe, expect, test } from 'claude-code/testing'

import { adapterOf, ADAPTERS } from './adapters'
import { BUILTIN_ADAPTER } from './builtin'
import { gateProblems, isDecisionType, missingFields, REQUIRED_FIELDS } from './framework'
import { GSD_ADAPTER } from './gsd'
import { SUPERPOWERS_ADAPTER } from './superpowers'

describe('ADAPTERS', () => {
  test('lists GSD, superpowers and the built-in fallback in that order', () => {
    expect(ADAPTERS.map(adapter => adapter.id)).toEqual(['gsd', 'superpowers', 'none'])
  })

  test('the list is frozen, so repeated or concurrent detect runs share one contract', () => {
    expect(Object.isFrozen(ADAPTERS)).toBe(true)
  })

  test('each adapter is deep-frozen: its object, its tables and every row in them', () => {
    for (const adapter of ADAPTERS) {
      expect(Object.isFrozen(adapter)).toBe(true)
      expect(Object.isFrozen(adapter.humanGates)).toBe(true)
      for (const gate of adapter.humanGates) {
        expect(Object.isFrozen(gate)).toBe(true)
      }
      expect(Object.isFrozen(adapter.autonomy)).toBe(true)
      for (const proposal of adapter.autonomy) {
        expect(Object.isFrozen(proposal)).toBe(true)
        expect(Object.isFrozen(proposal.write)).toBe(true)
        expect(Object.isFrozen(proposal.write.args)).toBe(true)
      }
      expect(Object.isFrozen(adapter.startWork)).toBe(true)
      expect(Object.isFrozen(adapter.verify)).toBe(true)
      expect(Object.isFrozen(adapter.locations)).toBe(true)
      expect(Object.isFrozen(adapter.locations.spec)).toBe(true)
      expect(Object.isFrozen(adapter.locations.plan)).toBe(true)
      expect(Object.isFrozen(adapter.doneSignal)).toBe(true)
    }
  })
})

describe('adapterOf', () => {
  test('gives the adapter of each framework: GSD, superpowers, and the built-in fallback for none', () => {
    expect(adapterOf('gsd').name).toBe('GSD')
    expect(adapterOf('gsd')).toBe(GSD_ADAPTER)
    expect(adapterOf('superpowers')).toBe(SUPERPOWERS_ADAPTER)
    expect(adapterOf('none')).toBe(BUILTIN_ADAPTER)
  })

  test('gives for each id the adapter ADAPTERS lists with it', () => {
    expect(ADAPTERS.map(adapter => adapterOf(adapter.id))).toEqual([...ADAPTERS])
    expect(ADAPTERS.map(adapter => adapterOf(adapter.id).name)).toEqual(['GSD', 'superpowers', 'built-in'])
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
      expect(adapter.kickoffText({ title: 'BE', roleId: 'be', specPath: null })).toContain('AUTOPILOT_DONE')
    }
  })
})

/**
 * Which startWork entries each adapter's kickoff names word for word today (A8): GSD two of three, as it never names
 * /gsd-new-project; superpowers one of two, as it words the writing-plans start its own way; the built-in fallback
 * none, as it words both entries its own way. The gap is logged in .planning/todos/pending/gsd-kickoff-new-project.md,
 * so a later fix shows as a diff here.
 */
describe('safety net: kickoff names startWork (A8)', () => {
  test('for a fixed context each kickoff holds these startWork entries word for word, and not the others', () => {
    const context = { title: 'BE', roleId: 'be', specPath: null }
    const matched = ADAPTERS.map(adapter => {
      const kickoff = adapter.kickoffText(context)

      return [adapter.id, adapter.startWork.map(entry => kickoff.includes(entry))]
    })
    expect(matched).toEqual([
      ['gsd', [true, true, false]],
      ['superpowers', [false, true]],
      ['none', [false, false]],
    ])
  })
})
