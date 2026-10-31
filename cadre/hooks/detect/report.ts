/**
 * The detect report, a layer 9 module: the read-only report of /cadre detect, its framework table, notes and adapter
 * choice line (D-04), and the adapter contract view of --adapters (D-09). It imports the framework adapters, the
 * status labels of ui/blocks/cards, core and the types, so register, init and the goldens read it here.
 */
import type { Choice, Detection, Facts, FrameworkAdapter, Gate } from '../../types'
import { pad, reportText } from '../core/text'
import { chooseFramework } from '../framework/contract'
import { ADAPTERS, detectAll } from '../framework/registry'
import { t } from '../locales/t'
import { STATUS_LABEL } from '../ui/blocks/cards'

/** Column widths of the detect table, in code points: the framework name, the status and the version. */
const NAME_WIDTH = 14
const STATUS_WIDTH = 13
const VERSION_WIDTH = 9

/** Column widths of the gate table in the contract view, in code points: the gate id, the type and the human column. */
const GATE_ID_WIDTH = 28
const GATE_TYPE_WIDTH = 15
const GATE_HUMAN_WIDTH = 8

/** The title line of the detect report. It says that nothing was written. */
const TITLE = t('detect.report.title')

/**
 * The line that says which adapter the repo gets, or why none is chosen. Only a chosen adapter is named as the one in
 * use; an ambiguous or installed-only repo names its candidates and says init will ask (D-07, D-08, D-29).
 */
export function choiceLine(choice: Choice): string {
  if (choice.kind === 'chosen') return t('detect.report.choiceLine', { id: choice.id, reason: choice.reason })
  if (choice.kind === 'ambiguous') return t('detect.report.choiceLine2', { ids: choice.ids.join(', ') })
  if (choice.kind === 'installed-only') return t('detect.report.choiceLine3', { ids: choice.ids.join(', ') })
  if (choice.kind === 'unsupported') {
    return t('detect.report.choiceLine4', { ids: choice.ids.join(', ') })
  }

  return t('detect.report.choiceLine5')
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

  return [t('detect.report.unsupportedNoteLines', { names: names.join(', ') })]
}

/**
 * One line per adapter with a facts heading and role facts, such as the GSD hooks settings register: the heading, then
 * each fact with what it does to a role (D-05).
 */
function gsdHookLines(facts: Facts): string[] {
  return ADAPTERS.flatMap(adapter => {
    if (adapter.factsHeading === null || adapter.roleFacts === undefined) return []
    const hooks = adapter.roleFacts(facts)
    if (hooks.length === 0) return []
    const items = hooks.map(hook => t('detect.report.gsdHookLines', { name: hook.name, note: hook.note })).join(', ')

    return [t('detect.report.gsdHookLines2', { factsHeading: adapter.factsHeading, items })]
  })
}

/** One line per host warning, with the text cleaned and capped as every report cell is. */
function warningLines(facts: Facts): string[] {
  return facts.warnings.map(warning => t('detect.report.warningLines', { warning: reportText(warning) }))
}

/**
 * The detect report for a repo's facts: a title, a table with one row per framework, the unsupported note, the GSD
 * hooks, the host warnings, and the adapter choice as the last line (D-04). Each untrusted value is cleaned and capped
 * on the way out, so a hostile value cannot add a line or hide text.
 */
export function detectReportLines(facts: Facts): string[] {
  const detections = detectAll(facts)
  const choice = chooseFramework(detections, null)
  const columns = [pad(t('detect.report.framework'), NAME_WIDTH), pad(t('detect.report.status'), STATUS_WIDTH)]
  const header = [...columns, pad(t('detect.report.version'), VERSION_WIDTH), t('detect.report.evidence')].join('')
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
  const type = pad(gate.decisionType ?? t('detect.report.gateRow'), GATE_TYPE_WIDTH)
  const human = pad(gate.needsHuman ? 'yes' : 'no', GATE_HUMAN_WIDTH)

  return `    ${id}${type}${human}${gate.kickoff}`
}

/** The gate table of one adapter: its header, then one row per gate in the order the adapter lists them. */
function gateRows(gates: readonly Gate[]): string[] {
  const columns = [
    pad(t('detect.report.gate'), GATE_ID_WIDTH),
    pad(t('detect.report.type'), GATE_TYPE_WIDTH),
    pad(t('detect.report.human'), GATE_HUMAN_WIDTH),
  ]
  const header = t('detect.report.gateHeader', { columns: columns.join('') })

  return [t('detect.report.gateRows', { header }), ...gates.map(gateRow)]
}

/** The autonomy lines of one adapter: one per setting proposal, or the note that says why it needs no settings. */
function autonomyLines(adapter: FrameworkAdapter): string[] {
  if (adapter.autonomy.length === 0) {
    return [t('detect.report.autonomyNote', { note: adapter.autonomyNote ?? t('detect.report.noAutonomy') })]
  }

  return adapter.autonomy.map(proposal => {
    const requirement = proposal.isRequired ? 'required' : 'optional'

    return t('detect.report.autonomyLines', { key: proposal.key, to: proposal.to, requirement, why: proposal.why })
  })
}

/**
 * The contract block of one adapter, with the same labelled fields for every adapter (D-09). Each kickoff line is
 * indented six spaces, so it reads as one example block; an empty kickoff line stays empty. Text that comes from the
 * adapter (detectRule, startWork, gate and autonomy text, hook notes) is static and printed as is, while values derived
 * from Facts are cleaned and capped by reportText.
 */
function adapterBlock(adapter: FrameworkAdapter): string[] {
  const kickoff = adapter.kickoffText({ title: 'BE', roleId: 'be', specPath: null }).split('\n')
  const { artifact, check } = adapter.doneSignal
  const done = t('detect.report.adapterBlock', { artifact, check })

  return [
    t('detect.report.adapterBlock2', { name: adapter.name, id: adapter.id }),
    t('detect.report.adapterBlock3', { detectRule: adapter.detectRule }),
    t('detect.report.adapterBlock4', { startWork: adapter.startWork.join('; ') }),
    t('detect.report.adapterBlock5', { spec: adapter.locations.spec.join('; ') }),
    t('detect.report.adapterBlock6', { plan: adapter.locations.plan.join('; ') }),
    t('detect.report.adapterBlock7', { verify: adapter.verify.join('; ') }),
    t('detect.report.adapterBlock8', { done }),
    t('detect.report.adapterBlock9'),
    ...autonomyLines(adapter),
    t('detect.report.adapterBlock10'),
    ...kickoff.map(line => (line === '' ? '' : `      ${line}`)),
    t('detect.report.adapterBlock11'),
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
  const contract = ['', t('detect.report.detectText'), ...adaptersReportLines(ADAPTERS)]

  return [...report, ...contract].join('\n')
}
