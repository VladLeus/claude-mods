import type { Detection, Facts, Gate, KickoffContext } from '../types'

/**
 * RED placeholder for plan 01-07 task 3: a detection no expectation matches, so every built-in test fails on an
 * assertion. The GREEN commit replaces it with the real detection.
 */
export function detectBuiltin(facts: Facts): Detection {
  return { id: 'none', name: 'STUB', status: 'in-use', version: 'STUB', evidence: ['STUB'] }
}

/**
 * RED placeholder for plan 01-07 task 3: a gate row no expectation matches. The GREEN commit replaces it with the
 * built-in gate table.
 */
export const BUILTIN_GATES: readonly Gate[] = [
  {
    id: 'STUB',
    where: 'STUB',
    kind: 'chat',
    decisionType: null,
    needsHuman: false,
    handling: 'escalate',
    kickoff: 'STUB',
  },
]

/** RED placeholder for plan 01-07 task 3: a kickoff no expectation matches. */
export function builtinKickoffText(ctx: KickoffContext): string {
  return 'STUB'
}

/**
 * RED placeholder for plan 01-07 task 3: an adapter that declares none of the real fields, so every adapter test fails
 * on an assertion. The GREEN commit replaces it with the complete adapter.
 */
export const BUILTIN_ADAPTER = { id: 'STUB' }
