/**
 * The cadre init side pane, a layer 8 module: the one block its state draws (D-299, D-303), the open question's own
 * context or else the loader of a long step (D-301), drawn by one renderer (paneDrawn, D-313): a context's structured
 * rows, each looking as its role says and wrapped with a hanging indent to the columns its body has (D-231, D-312),
 * else the Review's and the loader's lines with the Review's own styling (D-322); and where the terminal seated the
 * pane (D3). It imports core, the locale tables (for the labels it styles and the item arrow) and the types, so
 * register's Pane hook reads it here, and the option preview takes wrapLine from it.
 */
import type {
  AskContext,
  ContextRow,
  ContextRowRole,
  ContextSection,
  Enforcement,
  FileOpKind,
  OpenQuestion,
  PaneState,
} from '../../types'
import { isObject } from '../core/json'
import { clean } from '../core/text'
import { ARTIFACT } from '../locales/artifact'
import { keyLabel, labelOf, SCREEN_LIST_WORDS, t } from '../locales/t'
import type { Surface } from './surface'

/** One row the cadre init side pane draws (D-133): its cleaned text, and whether it is a block title (drawn bold). */
export type PaneRow = {
  readonly text: string
  readonly isTitle: boolean
}

/**
 * The block the cadre init pane draws (paneDrawn): its title; the summary of a question's context with rows, drawn
 * under the title (D-310), else null; the context's sections of structured rows (D-313), else null; and the lines it
 * draws when there are no rows: the Review's lines (D-322) or the loader's summary line (D-301).
 */
export type PaneBlock = {
  readonly title: string
  readonly summary: string | null
  readonly rows: readonly ContextSection[] | null
  readonly lines: readonly string[]
  /** The page of a paged context (D-306), whose marker the pane draws as the frame's last row (D-334). */
  readonly page?: { readonly index: number; readonly count: number }
}

/**
 * The block of a question's context (D-313, D-322, D-334): with rows, its title, summary, rows and page when it is
 * paged; without them, as on the Review, its title and lines alone.
 */
function contextBlock(context: AskContext): PaneBlock {
  const { title, lines, rows } = context
  if (rows === undefined) return { title, summary: null, rows: null, lines }

  const block = { title, summary: context.summary, rows, lines }

  return context.page === undefined ? block : { ...block, page: context.page }
}

/**
 * The one block the cadre init pane draws for its state (D-299, D-301, D-313): while a question is open, that
 * question's own context alone (contextBlock), and nothing when it has none, never a block of an earlier step; else,
 * while a long step runs, the loader alone, its label as the title and its summary as the one line when it has one,
 * both cleaned and not cut (clean, UNCUT); else null, which the Pane render draws as its empty frame.
 */
export function paneBlockOf(pane: PaneState): PaneBlock | null {
  const { open, loader } = pane
  if (open !== null) return open.context === null ? null : contextBlock(open.context)
  if (loader === null) return null
  const title = clean(loader.label, UNCUT)
  const lines = loader.summary === null ? [] : [clean(loader.summary, UNCUT)]

  return { title, summary: null, rows: null, lines }
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

/** Where one wrapped row's own text starts and ends among the code points of its line (wrapHanging). */
type RowRange = {
  readonly start: number
  readonly end: number
}

/**
 * The spaces a continuation row of wrapHanging starts with (D-312): `indent` when it is a whole number under the
 * width, else as many as leave one column for text, and none when there is no width.
 */
function hangOf(columns: number | null, indent: number): number {
  if (columns === null || !Number.isInteger(columns) || columns < 1 || !Number.isInteger(indent)) return 0

  return Math.min(Math.max(0, indent), columns - 1)
}

/**
 * Where wrapHanging cuts a line of `points` (D-231, D-312): the first row holds at most `columns` code points and
 * every later one `columns` less the hanging indent `hang`; a row ends at the last space breakAt finds, which is left
 * out, else at its width. With no width, or one under one or not whole, the line is one row.
 */
function hangingRanges(points: readonly string[], columns: number | null, hang: number): RowRange[] {
  if (columns === null || !Number.isInteger(columns) || columns < 1) return [{ start: 0, end: points.length }]
  const ranges: RowRange[] = []
  let start = 0
  let room = columns
  while (points.length - start > room) {
    const cut = breakAt(points.slice(start), room)
    ranges.push({ start, end: start + (cut ?? room) })
    start += cut === null ? room : cut + 1
    room = columns - hang
  }
  ranges.push({ start, end: points.length })

  return ranges
}

/**
 * One text as rows of at most `columns` code points with a hanging indent (D-312): wrapLine's breaks, each row after
 * the first starting with `indent` spaces (fewer when the width leaves no room for them), so a wrapped description
 * stays under its row. No character but the one space at each break is dropped, and an indent is never a break. With
 * no width (null), or one under one or not whole, the text is one row. The pane draws (paneDrawn) and counts its rows
 * with this one wrap.
 */
export function wrapHanging(text: string, columns: number | null, indent: number): string[] {
  const points = Array.from(text)
  const hang = hangOf(columns, indent)
  const pad = ' '.repeat(hang)

  return hangingRanges(points, columns, hang).map(
    (range, at) => `${at === 0 ? '' : pad}${points.slice(range.start, range.end).join('')}`,
  )
}

/**
 * The rows the side pane draws (D-133): per block its title rows, then the rows of each line, with one empty row
 * between two blocks and none after the last. Every title and line is cleaned (clean, with no cap), so a scanned or
 * typed value cannot add a row or hide text, then wrapped to `columns` (wrapLine, D-231); with no columns, as on a
 * surface whose props carry none, each title and line is one row. paneDrawn draws a block with no rows through it.
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

/** The look of a span: its colour, bold and dim (PaneSpan without its text). */
type Look = Omit<PaneSpan, 'text'>

/** One row the cadre init pane draws (paneDrawn): its runs, none for an empty row. */
export type DrawnRow = {
  readonly spans: readonly PaneSpan[]
}

/**
 * The look of the text of each row role (D-313), taken from the role alone, never from the text: a heading bold, an
 * item's roles bold, a description, a field's value and plain text plain, the recommended roles bold and a
 * placeholder dim. An item's name is plain and a field's label dim (rowSpans); roles that are the screen's none word
 * are dim.
 */
const ROW_LOOK: Readonly<Record<ContextRowRole, Look>> = {
  heading: { bold: true },
  item: { bold: true },
  description: {},
  field: {},
  recommended: { bold: true },
  placeholder: { dim: true },
  plain: {},
}

/** The look of a field's label with its `: ` (D-313). */
const LABEL_LOOK: Look = { dim: true }

/** The look of the title row of a block: bold in the `claude` colour (D1). */
const TITLE_LOOK: Look = { color: 'claude', bold: true }

/** The look of a context's summary row under its title (D-310, D-313). */
const SUMMARY_LOOK: Look = { dim: true }

/** The look of a section's title row (D-313). */
const SECTION_LOOK: Look = { bold: true }

/** The look of the page marker, the last row of a paged frame (D-334). */
const PAGE_MARKER_LOOK: Look = { dim: true }

/** What an item row draws between its name and its roles (D-311, D-313). */
const ITEM_ARROW = t('ui.item.arrow')

/** Whether two looks are the same: the same colour, bold and dim. */
function isSameLook(a: Look, b: Look): boolean {
  return a.color === b.color && a.bold === b.bold && a.dim === b.dim
}

/** A span of `text` in `look`, with only the look's set fields. */
function spanOf(text: string, look: Look): PaneSpan {
  return { text, ...look }
}

/**
 * The runs of each row `parts` wrap to (D-312, D-313): the parts' texts joined are wrapped by wrapHanging's cut
 * (hangingRanges) with the hanging indent `indent`, and each wrapped row draws its code points in the look of the
 * part each came from, so a continuation row keeps its part's look; each continuation row starts with its indent,
 * plain, and runs of the same look are one span. An empty text is one row with no span.
 */
function wrappedRows(parts: readonly PaneSpan[], columns: number | null, indent: number): DrawnRow[] {
  const points = parts.flatMap(part => Array.from(part.text).map(point => ({ point, look: lookOf(part) })))
  const hang = hangOf(columns, indent)
  const ranges = hangingRanges(
    points.map(entry => entry.point),
    columns,
    hang,
  )

  return ranges.map((range, at) => {
    const pad = at === 0 || hang === 0 ? [] : [{ point: ' '.repeat(hang), look: {} }]
    const spans: PaneSpan[] = []
    for (const { point, look } of [...pad, ...points.slice(range.start, range.end)]) {
      const last = spans.at(-1)
      if (last === undefined || !isSameLook(lookOf(last), look)) {
        spans.push(spanOf(point, look))
        continue
      }
      spans[spans.length - 1] = spanOf(last.text + point, look)
    }

    return { spans }
  })
}

/** The look of a span: its colour, bold and dim as set. */
function lookOf(span: PaneSpan): Look {
  return {
    ...(span.color === undefined ? {} : { color: span.color }),
    ...(span.bold === true ? { bold: true } : {}),
    ...(span.dim === true ? { dim: true } : {}),
  }
}

/**
 * The look of an item's or the recommended field's roles (D-313): its role's look, or dim when the roles are the
 * screen's none word, the whole text and nothing else.
 */
function rolesLook(role: 'item' | 'recommended', text: string): Look {
  return text === SCREEN_LIST_WORDS.none ? { dim: true } : ROW_LOOK[role]
}

/**
 * The parts of one structured row (D-313), its look taken from its role only (ROW_LOOK): its indent, then for an item
 * its name, the arrow and its roles; for a field its label with `: ` dim and its value; for the recommended field its
 * label dim and its roles; else its text. Every label and text is cleaned (clean, UNCUT) first, so no value can add a
 * row or hide text.
 */
function rowParts(row: ContextRow): PaneSpan[] {
  const indent = ' '.repeat(Number.isInteger(row.indent) ? Math.max(0, row.indent) : 0)
  const text = clean(row.text, UNCUT)
  const label = clean(row.label ?? '', UNCUT)
  switch (row.role) {
    case 'item':
      return [spanOf(`${indent}${label}${ITEM_ARROW}`, {}), spanOf(text, rolesLook('item', text))]
    case 'field':
      return [spanOf(indent, {}), spanOf(`${label}: `, LABEL_LOOK), spanOf(text, ROW_LOOK.field)]
    case 'recommended':
      return [spanOf(indent, {}), spanOf(`${label}: `, LABEL_LOOK), spanOf(text, rolesLook('recommended', text))]
    case 'heading':
    case 'description':
    case 'placeholder':
    case 'plain':
      return [spanOf(indent, {}), spanOf(text, ROW_LOOK[row.role])]
    default: {
      const unreachable: never = row.role
      return unreachable
    }
  }
}

/** The drawn rows of one text in one look (paneDrawn): cleaned, then wrapped with no hanging indent. */
function textRows(text: string, look: Look, columns: number | null): DrawnRow[] {
  return wrappedRows([spanOf(clean(text, UNCUT), look)], columns, 0)
}

/**
 * The rows the cadre init pane draws for `block` (D-313, D-322), its one renderer. A block with rows draws its title
 * (bold, `claude`), its summary (dim), then each section: its title bold when it has one, then each row in the look
 * of its role alone (rowParts), never one taken from its text, one empty row between two sections. Each row is
 * wrapped to `columns` with a hanging indent of the row's indent (wrapHanging), its look chosen before the wrap so a
 * continuation row keeps it. A block with no rows, the Review or the loader, draws its title and lines through
 * paneRows (wrapLine) with the Review's own styling (paneSpans). With no columns no row is wrapped. A paged block ends
 * with its page marker, `page i of n`, dim, as the frame's last row (D-334).
 */
export function paneDrawn(block: PaneBlock, columns: number | null): DrawnRow[] {
  const { page } = block
  const marker =
    page === undefined
      ? []
      : textRows(t('ui.paging.marker', { number: page.index + 1, count: page.count }), PAGE_MARKER_LOOK, columns)
  if (block.rows === null) return [...paneRows([block], columns).map(row => ({ spans: paneSpans(row) })), ...marker]
  const head = [
    ...textRows(block.title, TITLE_LOOK, columns),
    ...(block.summary === null ? [] : textRows(block.summary, SUMMARY_LOOK, columns)),
  ]
  const sections = block.rows.flatMap((section, at): DrawnRow[] => [
    ...(at === 0 ? [] : [{ spans: [] }]),
    ...(section.title === null ? [] : textRows(section.title, SECTION_LOOK, columns)),
    ...section.rows.flatMap(row => wrappedRows(rowParts(row), columns, row.indent)),
  ])

  return [...head, ...sections, ...marker]
}

/**
 * The most rows one pane frame draws (D-305): wrapped rows, counted as paneDrawn draws them. On the desktop a frame of
 * 108 rows and 4,248 characters drew and one of 448 rows and 19,159 characters was dropped without a word (UF-08), so
 * every frame stays under this cap and MAX_PANE_FRAME_CHARS, and a larger context is paged (D-306).
 */
export const MAX_PANE_FRAME_ROWS = 100

/**
 * The most characters, in code points, one pane frame draws (D-305): the UF-08 desktop run drew a frame of 4,248
 * characters (108 rows) and dropped one of 19,159 (448 rows) without a word, so a frame stays under this cap.
 */
export const MAX_PANE_FRAME_CHARS = 4_000

/**
 * The columns a frame is counted and paged at when no width is known (D-305): the narrowest pane body seen, 60 inline
 * and 62 on the desktop, so a frame counted here is never wider than one the pane draws.
 */
export const PANE_FALLBACK_COLUMNS = 60

/**
 * How large a pane frame of `block` is (D-305): the rows paneDrawn draws for it and their characters in code points,
 * at `columns`, or PANE_FALLBACK_COLUMNS when no width is known, wrapped by the same wrapHanging cut the pane draws
 * with, so the counter and the renderer never disagree.
 */
export function frameSize(block: PaneBlock, columns: number | null): { readonly rows: number; readonly chars: number } {
  const drawn = paneDrawn(block, columns ?? PANE_FALLBACK_COLUMNS)
  const chars = drawn.reduce((sum, row) => sum + row.spans.reduce((n, span) => n + Array.from(span.text).length, 0), 0)

  return { rows: drawn.length, chars }
}

/** Rows a page keeps together (contextPages): an item with the rows under it, else one row, and its section. */
type RowUnit = {
  readonly section: number
  readonly rows: readonly ContextRow[]
}

/**
 * The units of `sections` in order (D-306): an item row and every row after it that is indented deeper and is no item
 * (its description and fields), else one row; a section with no rows is one unit of none, so its title still shows.
 */
function rowUnits(sections: readonly ContextSection[]): RowUnit[] {
  return sections.flatMap((section, at) => {
    if (section.rows.length === 0) return [{ section: at, rows: [] }]
    const units: ContextRow[][] = []
    let itemIndent: number | null = null
    for (const row of section.rows) {
      const last = units.at(-1)
      if (itemIndent !== null && last !== undefined && row.role !== 'item' && row.indent > itemIndent) {
        last.push(row)
        continue
      }
      itemIndent = row.role === 'item' ? row.indent : null
      units.push([row])
    }

    return units.map(rows => ({ section: at, rows }))
  })
}

/**
 * The pages of a context's rows on a pane surface at `columns` (D-305, D-306): one page when its whole frame fits
 * MAX_PANE_FRAME_ROWS and MAX_PANE_FRAME_CHARS, else pages filled in order, each as large as fits with the title, the
 * summary and the page marker row reserved (frameSize). An item and the rows under it are never split, a page that
 * goes on with a section repeats that section's title, and a unit larger than a page alone gets a page of its own.
 */
export function contextPages(context: AskContext, columns: number | null): (readonly ContextSection[])[] {
  const sections = context.rows ?? []
  const block = { title: context.title, summary: context.summary, lines: [] }
  const fits = (rows: readonly ContextSection[], page: PaneBlock['page']): boolean => {
    const size = frameSize(page === undefined ? { ...block, rows } : { ...block, rows, page }, columns)

    return size.rows <= MAX_PANE_FRAME_ROWS && size.chars <= MAX_PANE_FRAME_CHARS
  }
  if (fits(sections, undefined)) return [sections]
  const units = rowUnits(sections)
  // The widest marker any page could carry, so a page never overflows once its marker is drawn (D-334).
  const widest = { index: units.length - 1, count: units.length }
  const pages: (readonly ContextSection[])[] = []
  let page: { readonly section: number; readonly rows: readonly ContextRow[] }[] = []
  const sectionsOf = (parts: typeof page): ContextSection[] =>
    parts.map(part => ({ title: sections[part.section]?.title ?? null, rows: part.rows }))
  for (const unit of units) {
    const last = page.at(-1)
    const next =
      last !== undefined && last.section === unit.section
        ? [...page.slice(0, -1), { section: unit.section, rows: [...last.rows, ...unit.rows] }]
        : [...page, { section: unit.section, rows: unit.rows }]
    if (page.length === 0 || fits(sectionsOf(next), widest)) {
      page = next
      continue
    }
    pages.push(sectionsOf(page))
    page = [{ section: unit.section, rows: unit.rows }]
  }
  pages.push(sectionsOf(page))

  return pages
}

/** The colour of each rule marker of a scope card (D1): hard success, best-effort warning, none error. */
const MARKER_COLOR: Readonly<Record<Enforcement, PaneColor>> = {
  hard: 'success',
  'best-effort': 'warning',
  none: 'error',
}

/** The look of each file op kind in a plan op row (D1): create success, change warning, conflict error, leave dim. */
const OP_LOOK: Readonly<Record<FileOpKind, Look>> = {
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

/** The label of the plan summary row (plan/text planSummary), whose runs of digits are bold. */
const SUMMARY_LABEL = keyLabel('plan.text.planSummary4')

/** The label of a scope card's title row (scope/card), whose value is bold. */
const SCOPE_CARD_LABEL = labelOf(ARTIFACT.cardTitle)

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
 * The spans of the Review's plan summary row and a scope card's title row (D1, D-322), the only Review rows styled by
 * a label: a row that starts with SUMMARY_LABEL or SCOPE_CARD_LABEL and `: ` draws the label with its colon dim, then
 * each run of digits of the summary bold, or the scope card's role bold; else null. Each label is taken from the
 * template that builds its row (labelOf), so no EN wording is matched here (D-225).
 */
function reviewLabelSpans(text: string): PaneSpan[] | null {
  const label = [SUMMARY_LABEL, SCOPE_CARD_LABEL].find(word => text.startsWith(`${word}: `))
  if (label === undefined) return null
  const value = text.slice(label.length + 2)
  if (value === '') return null
  const head: PaneSpan[] = [{ text: `${label}:`, dim: true }, { text: ' ' }]
  if (label === SCOPE_CARD_LABEL) return [...head, { text: value, bold: true }]
  const runs = value.split(/(\d+)/).flatMap((run, at): PaneSpan[] => {
    if (run === '') return []

    return at % 2 === 1 ? [{ text: run, bold: true }] : [{ text: run }]
  })

  return [...head, ...runs]
}

/**
 * The runs one row of the Review or the loader is drawn in (D1, D-322). Their texts always join to the row's text and
 * none is empty, so a look never adds or hides a character. The first rule that matches wins:
 * - an empty row has no run, and a title row is one run, bold in the `claude` colour;
 * - a scope card rule row (scope.ts scopeCardLines): spaces, `[hard]`, `[best-effort]` or `[none]`, then nothing or a
 *   space and the rule; the marker in success, warning or error;
 * - a plan op row (plan.ts fileRows): two spaces, a kind padded to column 12 and the path; create, change and
 *   conflict in success, warning and error, leave dim, only the kind word styled;
 * - the plan summary row and a scope card's title row (reviewLabelSpans): the label with its colon dim, the summary's
 *   runs of digits or the card's role bold;
 * - any other row is one plain run.
 * Rows of a context with structured rows never come here: paneDrawn draws them by their roles (D-313).
 */
export function paneSpans(row: PaneRow): PaneSpan[] {
  if (row.text === '') return []
  if (row.isTitle) return [{ text: row.text, color: 'claude', bold: true }]

  return ruleSpans(row.text) ?? opSpans(row.text) ?? reviewLabelSpans(row.text) ?? [{ text: row.text }]
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
 * The columns a page of the pane is drawn at (D-292), as a run reads them before each step: the dialog's preview
 * columns on the TUI default and for a pane seated inline, which the dialog's preview draws (U-15); the pane body's
 * columns for a docked pane and for a pane with no placement, as on the desktop; null on a surface that shows no
 * context.
 */
export function pageColumnsOf(
  surface: Surface,
  placement: 'dock' | 'inline' | null,
  preview: number | null,
  body: number | null,
): number | null {
  if (surface === 'none') return null
  if (surface === 'tui-default' || placement === 'inline') return preview

  return body
}

/**
 * The columns the cadre init pane's body has, read from its render props (D-231): `bodyColumns` when it is a whole
 * number of at least one, else null, as on a surface whose Pane props carry none; paneDrawn then wraps no row.
 */
export function paneColumns(props: unknown): number | null {
  if (!isObject(props)) return null
  const { bodyColumns } = props
  if (typeof bodyColumns !== 'number' || !Number.isInteger(bodyColumns) || bodyColumns < 1) return null

  return bodyColumns
}
