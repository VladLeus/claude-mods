import type { DecisionType, Detection, Facts, UnsupportedMarker } from '../types'

/**
 * RED placeholder for plan 01-05 Task 1. Every value is wrong on purpose, so the tests load and fail on their
 * assertions. The GREEN commit replaces each export below.
 */
export const DECISION_TYPES: readonly DecisionType[] = []

/** RED placeholder: empty on purpose. Replaced in the GREEN commit. */
export const UNSUPPORTED_MARKERS: readonly UnsupportedMarker[] = []

/** RED placeholder: returns no detections on purpose. Replaced in the GREEN commit. */
export function detectUnsupported(facts: Facts): Detection[] {
  return []
}
