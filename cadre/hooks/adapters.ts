import type { Detection, Facts, FrameworkAdapter } from '../types'

/** RED placeholder for plan 01-08 Task 1: no adapter is listed yet, so the detection tests fail on assertions. */
export const ADAPTERS: readonly FrameworkAdapter[] = []

/** RED placeholder: returns no detections, so the detection tests fail on their assertions. */
export function detectAll(_facts: Facts): Detection[] {
  return []
}
