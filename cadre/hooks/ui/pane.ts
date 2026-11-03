/**
 * The cadre init side pane, a layer 8 module: the one block its state draws (D-299, D-303), the open question's own
 * context or else the loader of a long step (D-301), its rows wrapped to the columns its body has (D-231), the runs
 * each row is drawn in (D1) and where the terminal seated the pane (D3). It imports core, the locale tables (for the
 * labels it styles) and the types, so register's Pane hook reads it here, and the option preview takes wrapLine from
 * it.
 */
import type { Enforcement, FileOpKind, OpenQuestion, PaneState } from '../../types'
import { isObject } from '../core/json'
import { clean } from '../core/text'
import { ARTIFACT } from '../locales/artifact'
import { keyLabel, labelOf, SCREEN_LIST_WORDS } from '../locales/t'

/** One row the cadre init side pane draws (D-133): its cleaned text, and whether it is a block title (drawn bold). */
export type PaneRow = {
  readonly text: string
  readonly isTitle: boolean
}

/**
 * The one block the cadre init pane draws for its state (D-299, D-301): while a question is open, that question's own
 * context alone, its title and lines, and nothing when it has none, never a block of an earlier step; else, while a
 * long step runs, the loader alone, its label as the title and its summary as the one line when it has one, both
 * cleaned and not cut (clean, UNCUT); else null, which the Pane render draws as its empty frame.
 */
export function paneBlockOf(pane: PaneState): { readonly title: string; readonly lines: readonly string[] } | null {
  const { open, loader } = pane
  if (open !== null) return open.context === null ? null : { title: open.context.title, lines: open.context.lines }
  if (loader === null) return null
  const title = clean(loader.label, UNCUT)

  return loader.summary === null ? { title, lines: [] } : { title, lines: [clean(loader.summary, UNCUT)] }
}

/**
 * The rows a page of the paged review fills on a pane surface (D-233, ASKED #19): a page holds this many less one
 * review lines and its title. The spike measured the docked pane's body at the terminal's rows less one (47 at 48
 * rows, 29 at 30), but the review stage cannot read a pane's rows and the desktop app's are not measured (UAT-04), so
 * the page uses the spike's fallback of 20 rows.
 */
export const PANE_PAGE_ROWS = 20

/** What `$.ui.scroll` is given to bring the start of a pane into view, its top row at the top of the window (D-209). */
export type PaneScroll = {
  readonly to: 'start'
  readonly in: string
  readonly block: 'start'
}

/**
 * Where the cadre init pane `pane` scrolls when cadre opens a question (D-209): back to its start, so the open
 * question's own context shows from its first row wherever the pane is drawn, since a person cannot scroll the pane
 * while a dialog is open; null when the question is cleared or this run has not opened the pane, so nothing is asked.
 */
export function questionScroll(pane: string, open: OpenQuestion | null, isPaneOpen: boolean): PaneScroll | null {
  if (open === null || !isPaneOpen) return null

  return { to: 'start', in: pane, block: 'start' }
}

/**
 * No cap on a row's cleaned text: the pane and the option preview wrap a line to their width instead of cutting it
 * (D-231), and the data from disk in a line was capped where the line was built.
 */
export const UNCUT = Number.POSITIVE_INFINITY

/**
 * Where a row of `points` ends at a space (wrapLine): the last space at or before `columns` that comes after a
 * non-space, so an indent is never a break; null when there is none.
 */
function breakAt(points: readonly string[], columns: number): number | null {
  const firstWord = points.findIndex(point => point !== ' ')
  if (firstWord === -1) return null
  for (let at = columns; at > firstWord; at -= 1) {
    if (points[at] === ' ') return at
  }

  return null
}

/**
 * One line as rows of at most `columns` code points (D-231): a line that fits is one row; a longer one ends its row at
 * the last space at or before the width that comes after a non-space (breakAt), the one space at the break left out,
 * else the row is cut at the width. No other character is dropped, an indent is never a break and '' is one row. A
 * width under one, or not a whole number, keeps the line whole.
 */
export function wrapLine(text: string, columns: number): string[] {
  if (!Number.isInteger(columns) || columns < 1) return [text]
  const rows: string[] = []
  let rest = Array.from(text)
  while (rest.length > columns) {
    const cut = breakAt(rest, columns)
    rows.push(rest.slice(0, cut ?? columns).join(''))
    rest = rest.slice(cut === null ? columns : cut + 1)
  }
  rows.push(rest.join(''))

  return rows
}

/**
 * The rows the side pane draws (D-133): per block its title rows, then the rows of each line, with one empty row
 * between two blocks and none after the last. Every title and line is cleaned (clean, with no cap), so a scanned or
 * typed value cannot add a row or hide text, then wrapped to `columns` (wrapLine, D-231); with no columns, as on a
 * surface whose props carry none, each title and line is one row.
 */
export function paneRows(
  blocks: readonly { readonly title: string; readonly lines: readonly string[] }[],
  columns: number | null,
): PaneRow[] {
  const rowsOf = (text: string, isTitle: boolean): PaneRow[] => {
    const cleaned = clean(text, UNCUT)
    const texts = columns === null ? [cleaned] : wrapLine(cleaned, columns)

    return texts.map(row => ({ text: row, isTitle }))
  }

  return blocks.flatMap((block, at) => [
    ...(at === 0 ? [] : [{ text: '', isTitle: false }]),
    ...rowsOf(block.title, true),
    ...block.lines.flatMap(line => rowsOf(line, false)),
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

/** The label of the plan summary row (plan/text planSummary), whose runs of digits are bold. */
const SUMMARY_LABEL = keyLabel('plan.text.planSummary4')

/** The label of a scope card's title row (scope/card), whose value is bold. */
const SCOPE_CARD_LABEL = labelOf(ARTIFACT.cardTitle)

/** The label of a row of recommended roles, whose value is bold unless no role is recommended. */
const RECOMMENDED_LABEL = keyLabel('ui.instructions.topicRows3')

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
 * The spans of a field's value with the space before it (D1): bold after RECOMMENDED_LABEL unless the value is the
 * screen's none word, bold after SCOPE_CARD_LABEL, each run of digits bold after SUMMARY_LABEL, else plain. Each label
 * is taken from the template that builds its row (labelOf), so no EN wording is matched here (D-225).
 */
function valueSpans(label: string, value: string): PaneSpan[] {
  if (label === SUMMARY_LABEL) {
    const runs = value.split(/(\d+)/).flatMap((run, at): PaneSpan[] => {
      if (run === '') return []

      return at % 2 === 1 ? [{ text: run, bold: true }] : [{ text: run }]
    })

    return [{ text: ' ' }, ...runs]
  }
  const isBold = label === SCOPE_CARD_LABEL || (label === RECOMMENDED_LABEL && value !== SCREEN_LIST_WORDS.none)

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

/**
 * The columns the cadre init pane's body has, read from its render props (D-231): `bodyColumns` when it is a whole
 * number of at least one, else null, as on a surface whose Pane props carry none; paneRows then wraps no row.
 */
export function paneColumns(props: unknown): number | null {
  if (!isObject(props)) return null
  const { bodyColumns } = props
  if (typeof bodyColumns !== 'number' || !Number.isInteger(bodyColumns) || bodyColumns < 1) return null

  return bodyColumns
}
