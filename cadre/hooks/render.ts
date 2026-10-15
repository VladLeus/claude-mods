import type { Choice, Detection, DetectStatus, Facts, FrameworkAdapter } from '../types'
import { detectAll } from './adapters'
import { clean } from './facts'
import { chooseFramework } from './framework'
import { GSD_ADAPTER } from './gsd'

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
 * The note that names unsupported markers found beside a chosen framework (D-02). When the choice is itself
 * unsupported, the choice line already names them, so no note is added.
 */
function unsupportedNoteLines(detections: readonly Detection[], choice: Choice): string[] {
  if (choice.kind === 'unsupported') return []
  const names = detections.filter(detection => detection.status === 'unsupported').map(detection => detection.name)
  if (names.length === 0) return []

  return [`Warning: also detected but unsupported: ${names.join(', ')}`]
}

/** The one line that lists the GSD hooks settings register, each with what it does to a role (D-05). */
function gsdHookLines(facts: Facts): string[] {
  const hooks = GSD_ADAPTER.roleFacts?.(facts) ?? []
  if (hooks.length === 0) return []
  const items = hooks.map(hook => `${hook.name} (${hook.note})`).join(', ')

  return [`GSD hooks registered (activation depends on GSD config): ${items}`]
}

/** One line per host warning, with the text cleaned and capped as every report cell is. */
function warningLines(facts: Facts): string[] {
  return facts.warnings.map(warning => `Warning: ${reportText(warning)}`)
}

/**
 * The detect report for a repo's facts: a title, a table with one row per framework, the unsupported note, the GSD
 * hooks, the host warnings, and the adapter choice as the last line (D-04). Each untrusted value is cleaned and capped
 * on the way out, so a hostile value cannot add a line or hide text.
 */
export function detectReportLines(facts: Facts): string[] {
  const detections = detectAll(facts)
  const choice = chooseFramework(detections, null)
  const header = `${pad('Framework', NAME_WIDTH)}${pad('Status', STATUS_WIDTH)}${pad('Version', VERSION_WIDTH)}Evidence`
  const lines = [TITLE, '', header, ...detections.map(detectionRow), '']
  const notes = [...unsupportedNoteLines(detections, choice), ...gsdHookLines(facts), ...warningLines(facts)]
  if (notes.length > 0) lines.push(...notes, '')

  return [...lines, choiceLine(choice)]
}

/** RED placeholder for plan 01-08 Task 3: no contract view is rendered yet, so its tests fail on assertions. */
export function adaptersReportLines(_adapters: readonly FrameworkAdapter[]): string[] {
  return []
}

/** RED placeholder: an empty text, so the detectText tests fail on their assertions. */
export function detectText(_facts: Facts, _isAdapters: boolean): string {
  return ''
}
