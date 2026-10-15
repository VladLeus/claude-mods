import type { Choice, Detection, DetectStatus, Facts } from '../types'
import { detectAll } from './adapters'
import { clean } from './facts'
import { chooseFramework } from './framework'

/** Column widths of the detect table, in code points: the framework name, the status and the version. */
const NAME_WIDTH = 14
const STATUS_WIDTH = 13
const VERSION_WIDTH = 9

/**
 * The most code points one report cell keeps, the ellipsis included. It is the same cap facts.ts gives a host warning,
 * so no untrusted text reaches the report longer than a warning may be.
 */
const MAX_REPORT_CHARS = 240

/** The title line of the detect report. It says that nothing was written. */
const TITLE = 'cadre detect  (read-only, nothing was written)'

/** The word each detection status shows in the report. */
export const STATUS_LABEL: Readonly<Record<DetectStatus, string>> = {
  'in-use': 'in use',
  installed: 'installed',
  'not-found': 'not found',
  unsupported: 'unsupported',
}

/**
 * The text padded with spaces to a column width in code points. A text already at the width or longer gets one
 * trailing space, so two columns never run together.
 */
export function pad(text: string, width: number): string {
  const length = Array.from(text).length
  if (length >= width) return `${text} `

  return `${text}${' '.repeat(width - length)}`
}

/** Text from Facts or a detection as the report may show it: unsafe characters removed, then capped. */
function reportText(text: string): string {
  return clean(text, MAX_REPORT_CHARS)
}

/**
 * The line that says which adapter the repo gets, or why none is chosen. Only a chosen adapter is named as the one in
 * use; an ambiguous or installed-only repo names its candidates and says init will ask (D-07, D-08, D-29).
 */
export function choiceLine(choice: Choice): string {
  if (choice.kind === 'chosen') return `Adapter: ${choice.id} (${choice.reason})`
  if (choice.kind === 'ambiguous') return `Adapter: ambiguous: ${choice.ids.join(', ')}; init will ask`
  if (choice.kind === 'installed-only') return `Adapter: installed-only: ${choice.ids.join(', ')}; init will ask`
  if (choice.kind === 'unsupported') {
    return `Adapter: none usable: ${choice.ids.join(', ')} detected but unsupported; init will ask`
  }

  return 'Adapter: none (built-in); nothing detected, init will recommend GSD or superpowers'
}

/** One framework row, with the same column widths as the header. An unknown version shows as a dash. */
function detectionRow(detection: Detection): string {
  const version = detection.version === null ? '-' : reportText(detection.version)
  const evidence = detection.evidence.map(reportText).join('; ')

  const name = pad(detection.name, NAME_WIDTH)
  const status = pad(STATUS_LABEL[detection.status], STATUS_WIDTH)

  return `${name}${status}${pad(version, VERSION_WIDTH)}${evidence}`
}

/**
 * The detect report for a repo's facts: a title, a table with one row per framework, and the adapter choice as the
 * last line (D-04). Each untrusted value is cleaned and capped on the way out, so a hostile value cannot add a line or
 * hide text.
 */
export function detectReportLines(facts: Facts): string[] {
  const detections = detectAll(facts)
  const choice = chooseFramework(detections, null)
  const header = `${pad('Framework', NAME_WIDTH)}${pad('Status', STATUS_WIDTH)}${pad('Version', VERSION_WIDTH)}Evidence`
  const lines = [TITLE, '', header, ...detections.map(detectionRow), '']

  return [...lines, choiceLine(choice)]
}
