import type { AdapterFact, Detection, Facts } from '../types'

/**
 * RED placeholder for Task 1. No test expects these values, so every Task 1 test fails on its assertion.
 * Replaced in the GREEN commit.
 */
export const GSD_HOOK_NOTES: readonly AdapterFact[] = [{ name: 'STUB', note: 'STUB' }]

/** RED placeholder for detectGsd. */
export function detectGsd(facts: Facts): Detection {
  return { id: 'gsd', name: 'STUB', status: 'in-use', version: 'STUB', evidence: ['STUB'] }
}

/** RED placeholder for gsdHookFacts. */
export function gsdHookFacts(facts: Facts): AdapterFact[] {
  return [{ name: 'STUB', note: 'STUB' }]
}
