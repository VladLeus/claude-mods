import type { Detection, Facts } from '../types'

/**
 * RED placeholder for plan 01-07 task 1. It returns values that no expectation can match, so every detectSuperpowers
 * test fails on an assertion. The GREEN commit replaces it with the real detection.
 */
export function detectSuperpowers(facts: Facts): Detection {
  return { id: 'superpowers', name: 'STUB', status: 'in-use', version: 'STUB', evidence: ['STUB'] }
}
