import type {
  Choice,
  Detection,
  DetectStatus,
  Enforcement,
  Facts,
  FileOpKind,
  FrameworkAdapter,
  Gate,
  ShownBlock,
} from '../types'
import { ADAPTERS, detectAll } from './adapters'
import { clean, countedNoun } from './facts'
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

/** The most code points of a scanned name that a card rule or a warning shows. A scanned name is data, not trusted. */
const MAX_SHOWN_CHARS = 110

/** The most names one card list shows before it counts the rest. */
const MAX_CARD_LIST = 12

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

/**
 * Text from Facts or a detection as the report may show it: unsafe characters removed, then capped at MAX_REPORT_CHARS
 * code points. The plan and card renderers reuse it for every value that comes from outside the code, so a hostile
 * value cannot add a line or hide text.
 */
export function reportText(text: string): string {
  return clean(text, MAX_REPORT_CHARS)
}

/** A scanned name or pattern as a card rule or a warning shows it: unsafe characters removed and the length capped. */
export function shown(text: string): string {
  return clean(text, MAX_SHOWN_CHARS)
}

/**
 * A list as a card line or rule shows it: `none` when empty, else the names, past 12 of them the first 12 and
 * `+N more`. A rule passes each scanned name through `shown` first. A line can still pass the 240 code points a card
 * line keeps, so a rule puts its fixed text before a list, or on its own line, never after it (B6).
 */
export function cardList(names: readonly string[]): string {
  if (names.length === 0) return 'none'
  const rest = names.length - MAX_CARD_LIST
  if (rest <= 0) return names.join(', ')

  return [...names.slice(0, MAX_CARD_LIST), `+${rest} more`].join(', ')
}

/** One row the cadre init side pane draws (D-133): its cleaned text, and whether it is a block title (drawn bold). */
export type PaneRow = {
  readonly text: string
  readonly isTitle: boolean
}

/**
 * The side pane after one more block (D-133): that block first, then every other block in its order, so the pane holds
 * one block per key, a block shown again replaces the old one and moves to the top, and the newest context is first.
 * A notes block shown again keeps the old notes before its own lines, so the notes of a run collect in the order they
 * were noted (batch-1 review S1). The blocks it is given are never changed.
 */
export function paneView(blocks: readonly ShownBlock[], block: ShownBlock): ShownBlock[] {
  const others = blocks.filter(other => other.key !== block.key)
  if (block.key !== 'notes') return [block, ...others]
  const old = blocks.find(other => other.key === 'notes')
  if (old === undefined) return [block, ...others]

  return [{ ...block, lines: [...old.lines, ...block.lines] }, ...others]
}

/**
 * The rows the side pane draws (D-133): per block its title row, then one row per line, with one empty row between two
 * blocks and none after the last. Every title and line is cleaned as a report cell (reportText), so a scanned or typed
 * value cannot add a row or hide text.
 */
export function paneRows(blocks: readonly ShownBlock[]): PaneRow[] {
  return blocks.flatMap((block, at) => [
    ...(at === 0 ? [] : [{ text: '', isTitle: false }]),
    { text: reportText(block.title), isTitle: true },
    ...block.lines.map(line => ({ text: reportText(line), isTitle: false })),
  ])
}

/** The engine theme colour names the init pane uses (D1); each is a ThemeKey, so light and dark themes both work. */
export type PaneColor = 'claude' | 'success' | 'warning' | 'error'

/** One run of a pane row's text and its look (D1): a theme colour, bold or dim, each left out when not set. */
export type PaneSpan = {
  readonly text: string
  readonly color?: PaneColor
  readonly bold?: true
  readonly dim?: true
}

/** The colour of each rule marker of a scope card (D1): hard success, best-effort warning, none error. */
const MARKER_COLOR: Readonly<Record<Enforcement, PaneColor>> = {
  hard: 'success',
  'best-effort': 'warning',
  none: 'error',
}

/** The look of each file op kind in a plan op row (D1): create success, change warning, conflict error, leave dim. */
const OP_LOOK: Readonly<Record<FileOpKind, Omit<PaneSpan, 'text'>>> = {
  create: { color: 'success' },
  change: { color: 'warning' },
  conflict: { color: 'error' },
  leave: { dim: true },
}

/** A scope card rule row (scope.ts scopeCardLines): its indent, its marker, then nothing or a space and the rule. */
const RULE_ROW = /^( +)\[(hard|best-effort|none)\]( .*)?$/

/** A plan op row (plan.ts fileRows): two spaces, a file op kind, the spaces after it, then at least one character. */
const OP_ROW = /^ {2}(create|change|conflict|leave)( +)(.+)$/

/** The column a plan op row's path starts at (plan.ts): two spaces and the kind padded to KIND_WIDTH, 10. */
const OP_COLUMN = 12

/**
 * A field of a pane row (D1): a label of 1 to 5 single-space-separated words of `A-Z a-z 0-9 . / ~ _ + - ,` that
 * starts with a letter, then `: ` and a value that is not empty.
 */
const FIELD = /^([A-Za-z][A-Za-z0-9./~_+\-,]*(?: [A-Za-z0-9./~_+\-,]+){0,4}): (.+)$/

/** The most code points a field label has (D1); a longer one is text, not a label. */
const MAX_LABEL_CHARS = 40

/** The text between two fields of one pane row (D1), as scope cards and scan rows join them. */
const FIELD_SEPARATOR = '; '

/** Whether a word is a key of a look table, so the table can be read at it. */
function hasKey<K extends string>(table: Readonly<Record<K, unknown>>, word: string): word is K {
  return Object.hasOwn(table, word)
}

/** The spans of a scope card rule row (D1): the indent plain, the marker in its colour, the rule plain; else null. */
function ruleSpans(text: string): PaneSpan[] | null {
  const match = RULE_ROW.exec(text)
  if (match === null) return null
  const [, indent = '', enforcement = '', rest = ''] = match
  if (!hasKey(MARKER_COLOR, enforcement)) return null
  const marker: PaneSpan = { text: `[${enforcement}]`, color: MARKER_COLOR[enforcement] }

  return rest === '' ? [{ text: indent }, marker] : [{ text: indent }, marker, { text: rest }]
}

/**
 * The spans of a plan op row (D1): the two spaces plain, the kind in its look, the spaces and the path plain; null
 * when the row is not one, so a kind not padded to OP_COLUMN is never an op.
 */
function opSpans(text: string): PaneSpan[] | null {
  const match = OP_ROW.exec(text)
  if (match === null) return null
  const [, kind = '', spaces = '', rest = ''] = match
  if (!hasKey(OP_LOOK, kind) || 2 + kind.length + spaces.length !== OP_COLUMN) return null

  return [{ text: '  ' }, { text: kind, ...OP_LOOK[kind] }, { text: `${spaces}${rest}` }]
}

/**
 * The spans of a field's value with the space before it (D1): bold after `recommended` unless it is `none`, bold
 * after `Scope card`, each run of digits bold after `Summary`, else plain.
 */
function valueSpans(label: string, value: string): PaneSpan[] {
  if (label === 'Summary') {
    const runs = value.split(/(\d+)/).flatMap((run, at): PaneSpan[] => {
      if (run === '') return []

      return at % 2 === 1 ? [{ text: run, bold: true }] : [{ text: run }]
    })

    return [{ text: ' ' }, ...runs]
  }
  const isBold = label === 'Scope card' || (label === 'recommended' && value !== 'none')

  return isBold ? [{ text: ' ' }, { text: value, bold: true }] : [{ text: ` ${value}` }]
}

/** The spans of one part of a row when it is a field (D1): the label and its colon dim, then the value; else null. */
function fieldSpans(part: string): PaneSpan[] | null {
  const match = FIELD.exec(part)
  if (match === null) return null
  const [, label = '', value = ''] = match
  if (label.length > MAX_LABEL_CHARS) return null

  return [{ text: `${label}:`, dim: true }, ...valueSpans(label, value)]
}

/**
 * The spans of a field row (D1): the indent plain, then each part between `; ` as a field, or plain when it is not
 * one, with the separators plain; null when no part is a field.
 */
function fieldRowSpans(text: string): PaneSpan[] | null {
  const indent = /^ */.exec(text)?.[0] ?? ''
  const parts = text.slice(indent.length).split(FIELD_SEPARATOR)
  const fields = parts.map(fieldSpans)
  if (fields.every(field => field === null)) return null
  const body = parts.flatMap((part, at): PaneSpan[] => {
    const separator = at === 0 ? [] : [{ text: FIELD_SEPARATOR }]
    const plain = part === '' ? [] : [{ text: part }]

    return [...separator, ...(fields[at] ?? plain)]
  })

  return indent === '' ? body : [{ text: indent }, ...body]
}

/**
 * The runs one row of the cadre init side pane is drawn in (D1). Their texts always join to the row's text and none
 * is empty, so a look never adds or hides a character. The first rule that matches wins:
 * - an empty row has no run, and a title row is one run, bold in the `claude` colour;
 * - a scope card rule row (scope.ts scopeCardLines): spaces, `[hard]`, `[best-effort]` or `[none]`, then nothing or a
 *   space and the rule; the marker in success, warning or error;
 * - a plan op row (plan.ts fileRows): two spaces, a kind padded to column 12 and the path; create, change and
 *   conflict in success, warning and error, leave dim, only the kind word styled;
 * - a field row: past its indent, the parts between `; ` that are a label of 1 to 5 words starting with a letter (at
 *   most 40 code points), `: ` and a value draw the label with its colon dim; the value of `recommended` (assign.ts
 *   ownSkillRows) is bold unless it is `none`, that of `Scope card` (scopeCardLines) is bold, and each run of digits
 *   of `Summary` (plan.ts planSummary) is bold;
 * - any other row is one plain run.
 * Role names are bold only after `recommended:` and in a `Scope card:` title; other role lists have no format a rule
 * could tell apart from other text, so they stay plain.
 */
export function paneSpans(row: PaneRow): PaneSpan[] {
  if (row.text === '') return []
  if (row.isTitle) return [{ text: row.text, color: 'claude', bold: true }]

  return ruleSpans(row.text) ?? opSpans(row.text) ?? fieldRowSpans(row.text) ?? [{ text: row.text }]
}

/** One changed line of a line diff (G-02-1f, D-141): a line only the new text has, or one only the old text had. */
export type DiffRow = {
  readonly kind: 'added' | 'removed'
  readonly line: string
}

/** A line diff (G-02-1f, D-141): its changed lines in text order, and how many lines were added and removed. */
export type LineDiff = {
  readonly rows: readonly DiffRow[]
  readonly added: number
  readonly removed: number
}

/**
 * The most cells the table of a line diff may hold, one per pair of lines compared (T-02-77): past it the differing
 * middle of two texts counts as removed, then added, so a huge text cannot stall the session.
 */
const MAX_DIFF_CELLS = 1_000_000

/** The diff that keeps no line: each old line as a removed row, then each new line as an added row. */
function replacedRows(old: readonly string[], now: readonly string[]): DiffRow[] {
  return [
    ...old.map((line): DiffRow => ({ kind: 'removed', line })),
    ...now.map((line): DiffRow => ({ kind: 'added', line })),
  ]
}

/**
 * The rows of the differing middle of two texts (lineDiff): the longest common subsequence over lines is kept and every
 * other line is a row, in text order, the removed lines of a change before its added ones. The table holds, for each
 * pair of positions, the length of the longest common subsequence of the lines from there on; past MAX_DIFF_CELLS cells
 * no table is made and every line is a row (replacedRows).
 */
function middleRows(old: readonly string[], now: readonly string[]): DiffRow[] {
  const width = now.length + 1
  if (old.length === 0 || now.length === 0 || (old.length + 1) * width > MAX_DIFF_CELLS) return replacedRows(old, now)
  const lengths = new Uint32Array((old.length + 1) * width)
  const at = (row: number, column: number): number => lengths[row * width + column] ?? 0
  for (let row = old.length - 1; row >= 0; row -= 1) {
    for (let column = now.length - 1; column >= 0; column -= 1) {
      const isSame = old[row] === now[column]
      lengths[row * width + column] = isSame
        ? at(row + 1, column + 1) + 1
        : Math.max(at(row + 1, column), at(row, column + 1))
    }
  }
  const rows: DiffRow[] = []
  let oldAt = 0
  let nowAt = 0
  while (oldAt < old.length || nowAt < now.length) {
    const removed = old[oldAt]
    const added = now[nowAt]
    if (removed !== undefined && removed === added) {
      oldAt += 1
      nowAt += 1
      continue
    }
    if (removed !== undefined && (added === undefined || at(oldAt + 1, nowAt) >= at(oldAt, nowAt + 1))) {
      rows.push({ kind: 'removed', line: removed })
      oldAt += 1
      continue
    }
    if (added !== undefined) rows.push({ kind: 'added', line: added })
    nowAt += 1
  }

  return rows
}

/**
 * The line diff of two texts (G-02-1f, D-141): each text is split at every `\n`, so two texts that differ always give
 * a row; the lines both texts start and end with are set aside, and over the lines between them the longest common
 * subsequence is kept (middleRows). Every other line is a row; equal texts give none.
 */
export function lineDiff(before: string, after: string): LineDiff {
  const old = before.split('\n')
  const now = after.split('\n')
  let start = 0
  while (start < old.length && start < now.length && old[start] === now[start]) start += 1
  let oldEnd = old.length
  let nowEnd = now.length
  while (oldEnd > start && nowEnd > start && old[oldEnd - 1] === now[nowEnd - 1]) {
    oldEnd -= 1
    nowEnd -= 1
  }
  const rows = middleRows(old.slice(start, oldEnd), now.slice(start, nowEnd))
  const added = rows.filter(row => row.kind === 'added').length

  return { rows, added, removed: rows.length - added }
}

/** The most rows of one file's diff the improver block shows (G-02-1f, D-141). */
const MAX_DIFF_ROWS = 200

/**
 * The pane rows of a line diff (G-02-1f, D-141): `+ <line>` for an added line and `- <line>` for a removed one, in text
 * order, each line cleaned and capped as a report cell is (reportText); past MAX_DIFF_ROWS rows the first ones, then
 * `... <n> more changed lines`.
 */
export function diffLines(diff: LineDiff): string[] {
  const kept = diff.rows.slice(0, MAX_DIFF_ROWS)
  const lines = kept.map(row => `${row.kind === 'added' ? '+' : '-'} ${reportText(row.line)}`)
  const rest = diff.rows.length - kept.length
  if (rest === 0) return lines

  return [...lines, `... ${countedNoun(rest, 'more changed line', 'more changed lines')}`]
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
  const kickoff = adapter.kickoffText({ title: 'BE', roleId: 'be', specPath: null }).split('\n')
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
