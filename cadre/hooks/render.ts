import type { Choice, DetectStatus, Facts } from '../types'

/** RED placeholder for plan 01-08 Task 1: no status label is defined yet. */
export const STATUS_LABEL: Readonly<Record<DetectStatus, string>> = {
  'in-use': '',
  installed: '',
  'not-found': '',
  unsupported: '',
}

/** RED placeholder: pads nothing, so the width tests fail on their assertions. */
export function pad(_text: string, _width: number): string {
  return ''
}

/** RED placeholder: an empty choice line, so the choice tests fail on their assertions. */
export function choiceLine(_choice: Choice): string {
  return ''
}

/** RED placeholder: an empty report, so the report tests fail on their assertions. */
export function detectReportLines(_facts: Facts): string[] {
  return []
}
