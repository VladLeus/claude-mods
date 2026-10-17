import type { Choice, Detection, DetectStatus, Facts, FrameworkAdapter, Gate } from '../types'
import { ADAPTERS, detectAll } from './adapters'
import { clean } from './facts'
import { chooseFramework } from './framework'

/** Column widths of the detect table, in code points: the framework name, the status and the version. */
const NAME_WIDTH = 14
const STATUS_WIDTH = 13
const VERSION_WIDTH = 9

/** Column widths of the gate table in the contract view, in code points: the gate id, the type and the human column. */
const GATE_ID_WIDTH = 28
const GATE_TYPE_WIDTH = 15
const GATE_HUMAN_WIDTH = 8

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
  const gsd = ADAPTERS.find(adapter => adapter.id === 'gsd')
  if (gsd === undefined) return []
  const hooks = gsd.roleFacts?.(facts) ?? []
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

/**
 * One gate row of the contract view: the id, the decision type or standing rule, whether a human is needed, and the
 * kickoff that answers the gate.
 */
function gateRow(gate: Gate): string {
  const id = pad(gate.id, GATE_ID_WIDTH)
  const type = pad(gate.decisionType ?? 'standing rule', GATE_TYPE_WIDTH)
  const human = pad(gate.needsHuman ? 'yes' : 'no', GATE_HUMAN_WIDTH)

  return `    ${id}${type}${human}${gate.kickoff}`
}

/** The gate table of one adapter: its header, then one row per gate in the order the adapter lists them. */
function gateRows(gates: readonly Gate[]): string[] {
  const header = `    ${pad('gate', GATE_ID_WIDTH)}${pad('type', GATE_TYPE_WIDTH)}${pad('human?', GATE_HUMAN_WIDTH)}`

  return [`${header}how the kickoff handles it`, ...gates.map(gateRow)]
}

/** The autonomy lines of one adapter: one per setting proposal, or the note that says why it needs no settings. */
function autonomyLines(adapter: FrameworkAdapter): string[] {
  if (adapter.autonomy.length === 0) return [`    ${adapter.autonomyNote ?? 'no autonomy settings'}`]

  return adapter.autonomy.map(proposal => {
    const requirement = proposal.isRequired ? 'required' : 'optional'

    return `    ${proposal.key} -> ${proposal.to} (${requirement}): ${proposal.why}`
  })
}

/**
 * The contract block of one adapter, with the same labelled fields for every adapter (D-09). Each kickoff line is
 * indented six spaces, so it reads as one example block; an empty kickoff line stays empty. Text that comes from the
 * adapter (detectRule, startWork, gate and autonomy text, hook notes) is static and printed as is, while values derived
 * from Facts are cleaned and capped by reportText.
 */
function adapterBlock(adapter: FrameworkAdapter): string[] {
  const kickoff = adapter.kickoffText({ role: 'BE', roleId: 'be', specPath: null }).split('\n')
  const { artifact, check } = adapter.doneSignal
  const done = `${artifact}: ${check}; then a line that starts with AUTOPILOT_DONE`

  return [
    `${adapter.name} (${adapter.id})`,
    `  detect:       ${adapter.detectRule}`,
    `  start work:   ${adapter.startWork.join('; ')}`,
    `  spec files:   ${adapter.locations.spec.join('; ')}`,
    `  plan files:   ${adapter.locations.plan.join('; ')}`,
    `  verify:       ${adapter.verify.join('; ')}`,
    `  done signal:  ${done}`,
    '  autonomy:',
    ...autonomyLines(adapter),
    '  kickoff (example for role BE):',
    ...kickoff.map(line => (line === '' ? '' : `      ${line}`)),
    '  human gates:',
    ...gateRows(adapter.humanGates),
  ]
}

/**
 * The contract view of the given adapters: one block per adapter, with a blank line between blocks. It is rendered from
 * the adapter objects themselves, so the view cannot drift from the code (D-09, T-01-28).
 */
export function adaptersReportLines(adapters: readonly FrameworkAdapter[]): string[] {
  const lines: string[] = []
  for (const adapter of adapters) {
    if (lines.length > 0) lines.push('')
    lines.push(...adapterBlock(adapter))
  }

  return lines
}

/**
 * The text the detect command prints: the report alone, or, with the --adapters flag, the report followed by the
 * contract view after a blank line and a heading.
 */
export function detectText(facts: Facts, isAdapters: boolean): string {
  const report = detectReportLines(facts)
  if (!isAdapters) return report.join('\n')
  const contract = ['', 'Adapter contract (the same fields for every adapter):', ...adaptersReportLines(ADAPTERS)]

  return [...report, ...contract].join('\n')
}
