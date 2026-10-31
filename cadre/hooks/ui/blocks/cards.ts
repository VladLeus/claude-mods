/**
 * The detect status labels, a layer 8 block module: the word each detection status shows in a report row. It imports
 * the types, so the detect report reads the labels here.
 */
import type { DetectStatus } from '../../../types'
import { t } from '../../locales/t'

/** The word each detection status shows in the report. */
export const STATUS_LABEL: Readonly<Record<DetectStatus, string>> = {
  'in-use': t('ui.cards.statusLabelInUse'),
  installed: 'installed',
  'not-found': t('ui.cards.statusLabelNotFound'),
  unsupported: 'unsupported',
}
