/**
 * The detect status labels, a layer 8 block module: the word each detection status shows in a report row. It imports
 * the types, so the detect report reads the labels here.
 */
import type { DetectStatus } from '../../../types'

/** The word each detection status shows in the report. */
export const STATUS_LABEL: Readonly<Record<DetectStatus, string>> = {
  'in-use': 'in use',
  installed: 'installed',
  'not-found': 'not found',
  unsupported: 'unsupported',
}
