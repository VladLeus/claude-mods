import type { Detection, Facts, FrameworkAdapter } from '../types'
import { BUILTIN_ADAPTER } from './builtin'
import { detectUnsupported } from './framework'
import { GSD_ADAPTER } from './gsd'
import { SUPERPOWERS_ADAPTER } from './superpowers'

/**
 * The adapters cadre drives, in report order: GSD, superpowers, then the built-in fallback (D-17). The built-in
 * fallback is listed for the contract view, but it never gives a detection row. The list and each adapter are frozen,
 * so no caller can change the contract at runtime (T-01-27). The freeze is shallow: the gate and autonomy tables
 * inside an adapter are readonly by type only.
 */
export const ADAPTERS: readonly FrameworkAdapter[] = Object.freeze([
  Object.freeze(GSD_ADAPTER),
  Object.freeze(SUPERPOWERS_ADAPTER),
  Object.freeze(BUILTIN_ADAPTER),
])

/**
 * One detection per adapter except the built-in fallback, in ADAPTERS order, then one detection per unsupported marker
 * (D-02). Detection reads only the Facts, so the same Facts always give the same detections.
 */
export function detectAll(facts: Facts): Detection[] {
  const adapterDetections = ADAPTERS.filter(adapter => adapter.id !== 'none').map(adapter => adapter.detect(facts))

  return [...adapterDetections, ...detectUnsupported(facts)]
}
