/**
 * The cadre init side pane, a layer 8 module: the pane's view and rows (D-133), the runs each row is drawn in (D1) and
 * where the terminal seated the pane (D3). It imports core and the types, so register's Pane hook reads it here.
 */
import type { Enforcement, FileOpKind, ShownBlock } from '../../types'
import { isObject } from '../core/json'
import { reportText } from '../core/text'

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

/**
 * Where the terminal seated the cadre init pane, read from its render props (D3): `dock` or `inline` when the props
 * say exactly that, else null, as on an engine whose Pane props carry no placement.
 */
export function panePlacement(props: unknown): 'dock' | 'inline' | null {
  if (!isObject(props)) return null
  const { placement } = props

  return placement === 'dock' || placement === 'inline' ? placement : null
}
