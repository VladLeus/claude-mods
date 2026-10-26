import type {
  Choice,
  Detection,
  DetectStatus,
  Enforcement,
  Facts,
  FileOpKind,
  FrameworkAdapter,
  Gate,
  PaneKey,
  ShownBlock,
} from '../types'
import { ADAPTERS, detectAll } from './adapters'
import { countedNoun, pad, reportText } from './core/text'
import { isObject } from './facts'
import { chooseFramework } from './framework'

/** Column widths of the detect table, in code points: the framework name, the status and the version. */
const NAME_WIDTH = 14
const STATUS_WIDTH = 13
const VERSION_WIDTH = 9

/** Column widths of the gate table in the contract view, in code points: the gate id, the type and the human column. */
const GATE_ID_WIDTH = 28
const GATE_TYPE_WIDTH = 15
const GATE_HUMAN_WIDTH = 8

/** The title line of the detect report. It says that nothing was written. */
const TITLE = 'cadre detect  (read-only, nothing was written)'

/** The word each detection status shows in the report. */
export const STATUS_LABEL: Readonly<Record<DetectStatus, string>> = {
  'in-use': 'in use',
  installed: 'installed',
  'not-found': 'not found',
  unsupported: 'unsupported',
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

/**
 * The most characters, by String length, the preview of a dialog option holds (D3): the engine replaces a preview
 * over 2000 characters with a placeholder, and 1900 leaves room.
 */
export const MAX_PREVIEW_CHARS = 1900

/** The last line of a preview that was cut (D3). */
const CUT_LINE = '…'

/** The characters a preview title escapes with a backslash, so the title draws as its own text (D3). */
const TITLE_MARKUP = /[*_`[\]<>#\\~|]/g

/**
 * Where the terminal seated the cadre init pane, read from its render props (D3): `dock` or `inline` when the props
 * say exactly that, else null, as on an engine whose Pane props carry no placement.
 */
export function panePlacement(props: unknown): 'dock' | 'inline' | null {
  if (!isObject(props)) return null
  const { placement } = props

  return placement === 'dock' || placement === 'inline' ? placement : null
}

/** The parts of one block in a preview (D3): its title line, the fence around its lines, and its lines. */
type PreviewBlock = {
  readonly title: string
  readonly fence: string
  readonly lines: readonly string[]
}

/** The longest run of backticks in the lines; 0 when there is none. */
function longestBacktickRun(lines: readonly string[]): number {
  let longest = 0
  for (const line of lines) {
    for (const run of line.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  }

  return longest
}

/**
 * One block as a preview draws it (D3): the title cleaned as a report cell, its markdown characters escaped and set
 * in bold; each line cleaned as a report cell; a fence one backtick longer than the longest run in the lines, and at
 * least three.
 */
function previewBlock(block: ShownBlock): PreviewBlock {
  const lines = block.lines.map(reportText)
  const title = `**${reportText(block.title).replace(TITLE_MARKUP, '\\$&')}**`

  return { title, fence: '`'.repeat(Math.max(3, longestBacktickRun(lines) + 1)), lines }
}

/**
 * The preview of blocks that do not fit whole (D3), kept up to MAX_PREVIEW_CHARS: a line goes in only while it, the
 * closing fence of its block and a final `…` line still fit; a block's title and opening fence go in only with its
 * first line, so no block is left with an opening fence and no line; on the cut the open fence is closed and a `…`
 * line ends the preview.
 */
function cutPreview(parts: readonly PreviewBlock[]): string {
  const out: string[] = []
  let length = 0
  const added = (lines: readonly string[]): number =>
    lines.reduce((sum, line, at) => sum + (out.length === 0 && at === 0 ? 0 : 1) + line.length, 0)
  const fits = (lines: readonly string[], fence: string): boolean =>
    length + added(lines) + 1 + fence.length + 1 + CUT_LINE.length <= MAX_PREVIEW_CHARS
  const push = (lines: readonly string[]): void => {
    length += added(lines)
    out.push(...lines)
  }
  for (const part of parts) {
    const [first, ...rest] = part.lines
    const head = [...(out.length === 0 ? [] : ['']), part.title, part.fence]
    const opening = first === undefined ? head : [...head, first]
    if (!fits(opening, part.fence)) break
    push(opening)
    for (const line of rest) {
      if (!fits([line], part.fence)) {
        push([part.fence, CUT_LINE])

        return out.join('\n')
      }
      push([line])
    }
    push([part.fence])
  }
  push([CUT_LINE])

  return out.join('\n')
}

/**
 * The cadre init side pane as the markdown preview of a dialog option (D3), for the terminal main screen, where the
 * engine hides the pane while a dialog is open. Per block, in the order given (the pane's: newest first), its title in
 * bold, cleaned as a report cell (reportText) with its markdown characters escaped, then its lines, each cleaned as a
 * report cell with its indent kept, in a fence one backtick longer than any backtick run in them and at least three:
 * the fence keeps every scanned or typed value literal, so none can format the preview or end the fence. A blank line
 * parts two blocks. Past MAX_PREVIEW_CHARS the preview is cut after a whole line, its open fence closed, and ends with
 * a `…` line (cutPreview); lengths are String lengths, never fewer than the code points. No blocks give ''.
 */
export function previewMarkdown(blocks: readonly ShownBlock[]): string {
  const parts = blocks.map(previewBlock)
  const whole = parts.flatMap((part, at) => [
    ...(at === 0 ? [] : ['']),
    part.title,
    part.fence,
    ...part.lines,
    part.fence,
  ])
  const text = whole.join('\n')
  if (text.length <= MAX_PREVIEW_CHARS) return text

  return cutPreview(parts)
}

/**
 * A counted suffix at the very end of a header chip (B1): ` <i>/<n>` (ask.ts countedChip) or ` <i> of <n>` (the hunk
 * chip).
 */
const COUNTED_SUFFIX = / (?:\d+\/\d+|\d+ of \d+)$/

/**
 * The topic of a header chip (B1): the chip without one counted suffix at its very end, ` <i>/<n>` as ask.ts
 * countedChip counts a chip, or ` <i> of <n>` as the hunk chip does; any other header is kept as it is.
 */
export function headerTopic(header: string): string {
  return header.replace(COUNTED_SUFFIX, '')
}

/**
 * The pane blocks the preview of a question may show, by the topic of its header chip (B1, headerTopic): the blocks
 * the question is asked after, and the first of them the pane holds wins. A header with no key here, or none of whose
 * blocks the pane holds, gets the newest block (previewBlockFor); claude.json, Git policy and the hunk chips have no
 * block of their own, so no key. The keys mirror ask.ts ASK_HEADERS and its counted chips by their text, because
 * render.ts cannot import ask.ts (ask.ts imports render.ts); a render.test.ts test keeps the two in step.
 */
export const PREVIEW_BLOCKS = Object.freeze<Record<string, readonly PaneKey[]>>({
  History: Object.freeze(['scan']),
  Roles: Object.freeze(['roles']),
  Adjust: Object.freeze(['roles']),
  Describe: Object.freeze(['roles']),
  Framework: Object.freeze(['roles']),
  Duration: Object.freeze(['roles']),
  Model: Object.freeze(['roles']),
  Launch: Object.freeze(['roles']),
  'Launch dir': Object.freeze(['roles']),
  Security: Object.freeze(['recommendations']),
  MCP: Object.freeze(['recommendations']),
  Skills: Object.freeze(['recommendations']),
  Skill: Object.freeze(['skills']),
  Instructions: Object.freeze(['instructions']),
  Topic: Object.freeze(['instructions']),
  Memory: Object.freeze(['instructions']),
  Regen: Object.freeze(['instructions']),
  Env: Object.freeze(['env']),
  Review: Object.freeze(['review']),
  Conflict: Object.freeze(['review']),
  Improver: Object.freeze(['improver', 'instructions']),
})

/**
 * The pane block the preview of a question shows (B1), as a list of one: of the blocks PREVIEW_BLOCKS lists for the
 * topic of its header (headerTopic), read as an own key only, the first one the pane holds; the newest block when the
 * header is not text, its topic has no key, or the pane holds none of its blocks; no block when the pane is empty.
 */
export function previewBlockFor(header: unknown, blocks: readonly ShownBlock[]): ShownBlock[] {
  const [newest] = blocks
  if (newest === undefined) return []
  if (typeof header !== 'string') return [newest]
  const topic = headerTopic(header)
  if (!Object.hasOwn(PREVIEW_BLOCKS, topic)) return [newest]
  for (const key of PREVIEW_BLOCKS[topic] ?? []) {
    const block = blocks.find(shown => shown.key === key)
    if (block !== undefined) return [block]
  }

  return [newest]
}

/**
 * The header chip of the question an AskUserQuestion call asks first (R1), which the cadre init pane draws the block of
 * (previewBlockFor): the `header` of the call's first question when that question is an object with a string header;
 * null for anything else. A tool call's args are untrusted input, so their shape is checked before the header is read.
 */
export function askedHeader(questions: unknown): string | null {
  if (!Array.isArray(questions)) return null
  const first: unknown = questions[0]
  if (!isObject(first) || typeof first.header !== 'string') return null

  return first.header
}

/**
 * An AskUserQuestion question whose shape withPreviews checked (D3): an object with a string `question` and options it
 * may rewrite.
 */
export type CheckedQuestion = Record<string, unknown> & {
  readonly question: string
  readonly options: readonly Record<string, unknown>[]
}

/** Whether a value is an AskUserQuestion option a preview may go on (D3): an object with a string `label`. */
function isPreviewOption(value: unknown): value is Record<string, unknown> {
  return isObject(value) && typeof value.label === 'string'
}

/**
 * Whether a value is an AskUserQuestion question withPreviews may rewrite (D3): an object with a string `question`
 * and one option or more, each one a preview may go on.
 */
function isPreviewQuestion(value: unknown): value is CheckedQuestion {
  if (!isObject(value) || typeof value.question !== 'string') return false
  const { options } = value

  return Array.isArray(options) && options.length > 0 && options.every(isPreviewOption)
}

/**
 * The questions of an AskUserQuestion call with `preview` on each option of each single-select question (D3, B1): the
 * preview `previewOf` makes for that question's `header` value (undefined when it has none). A tool call's args are
 * unknown to the plugin, so their shape is checked before any rewrite, and null means the call passes through
 * unchanged: null for anything but a list of one question or more, each an object with a string `question` and one
 * option or more, each an object with a string `label`, and null when every question is multi-select (`multiSelect`
 * true). The list is new: each question and option is a copy made with a spread, a multi-select question is copied
 * unchanged, and an option with a `preview` key of its own keeps it; the input is never changed.
 */
export function withPreviews(questions: unknown, previewOf: (header: unknown) => string): CheckedQuestion[] | null {
  if (!Array.isArray(questions) || questions.length === 0 || !questions.every(isPreviewQuestion)) return null
  if (questions.every(question => question.multiSelect === true)) return null

  return questions.map(question => {
    if (question.multiSelect === true) return { ...question }
    const preview = previewOf(question.header)
    const options = question.options.map(option =>
      Object.hasOwn(option, 'preview') ? { ...option } : { ...option, preview },
    )

    return { ...question, options }
  })
}

/**
 * The label of the option a previewed question with room for one more option gets, so the person can give an answer
 * of their own (A2, R3): beside a preview the engine draws no Other row, so the person picks it, or presses `n`, and
 * types the answer in the dialog's notes.
 */
export const DESCRIBE_OWN_LABEL = 'Describe your own'

/** What the Describe your own option says under its label (A2): how to type an answer of one's own. */
export const DESCRIBE_OWN_DESCRIPTION = 'Press n, type your answer, then Enter'

/**
 * The last line of every previewed single-select question (R3), with or without room for the Describe your own
 * option: how to type an answer of one's own.
 */
export const OWN_ANSWER_HINT = 'Or press n, type your own answer, then Enter.'

/**
 * The words a question uses for an answer typed in the engine's Other row (R4): beside a preview the engine draws no
 * Other row, so a previewed question says NOTE_WORDING in their place.
 */
export const OTHER_WORDING = 'under Other'

/**
 * What a previewed question says in place of OTHER_WORDING (R4): beside a preview the engine draws no Other row, and
 * the notes field, opened with n, is where a typed answer goes.
 */
export const NOTE_WORDING = 'as a note (press n)'

/** The most options an AskUserQuestion question may have: the tool's schema allows 2 to 4 (A2). */
const MAX_DIALOG_OPTIONS = 4

/**
 * A previewed single-select question with a way to give an answer of one's own (A2, R3, R4), since the engine draws
 * no Other row beside a preview: its text has every OTHER_WORDING replaced by NOTE_WORDING and ends with the line
 * OWN_ANSWER_HINT, added unless the replaced text already ends with it. With fewer than MAX_DIALOG_OPTIONS options and
 * none labelled DESCRIBE_OWN_LABEL, it also gets one last option, DESCRIBE_OWN_LABEL with DESCRIBE_OWN_DESCRIPTION
 * and the given preview; otherwise its options are kept. The result is a new object; the question it is given is
 * never changed.
 */
export function withDescribeOwn(question: CheckedQuestion, preview: string): CheckedQuestion {
  const replaced = question.question.replaceAll(OTHER_WORDING, NOTE_WORDING)
  const text = replaced.endsWith(OWN_ANSWER_HINT) ? replaced : `${replaced}\n${OWN_ANSWER_HINT}`
  const hasOwn = question.options.some(option => option.label === DESCRIBE_OWN_LABEL)
  if (hasOwn || question.options.length >= MAX_DIALOG_OPTIONS) return { ...question, question: text }
  const own = { label: DESCRIBE_OWN_LABEL, description: DESCRIBE_OWN_DESCRIPTION, preview }

  return { ...question, question: text, options: [...question.options, own] }
}

/**
 * One question askRewrite rewrote (A3): `question`, its text as the caller asked it, and `asked`, the text the dialog
 * shows, which the dialog's answers and annotations are keyed by.
 */
export type AskedQuestion = {
  readonly question: string
  readonly asked: string
}

/** The rewrite of an AskUserQuestion call (A1, A2): the questions the dialog shows, and each question it rewrote. */
export type AskRewrite = {
  readonly questions: Record<string, unknown>[]
  readonly asked: readonly AskedQuestion[]
}

/**
 * The rewrite of an AskUserQuestion call while the cadre init pane sits inline on the terminal main screen (A1, A2,
 * D3, R3, R4); null, so the call passes through unchanged, when the pane has no blocks or withPreviews does not
 * rewrite the questions. Each option of each single-select question gets the preview of the one pane block its header
 * needs (previewBlockFor, B1), and each such question then gets NOTE_WORDING for every OTHER_WORDING in its text (R4),
 * the hint line as its last line (R3) and, when it has room, the Describe your own option with that preview
 * (withDescribeOwn), with an AskedQuestion that pairs its text as asked with the text the dialog shows (A3); a
 * multi-select question is copied unchanged, OTHER_WORDING included, and has none.
 */
export function askRewrite(questions: unknown, blocks: readonly ShownBlock[]): AskRewrite | null {
  if (blocks.length === 0) return null
  const previewOf = (header: unknown): string => previewMarkdown(previewBlockFor(header, blocks))
  const previewed = withPreviews(questions, previewOf)
  if (previewed === null) return null
  const pairs = previewed.map(question => {
    const shown = question.multiSelect === true ? null : withDescribeOwn(question, previewOf(question.header))

    return { question, shown }
  })
  const asked = pairs.flatMap(({ question, shown }): AskedQuestion[] =>
    shown === null ? [] : [{ question: question.question, asked: shown.question }],
  )

  return { questions: pairs.map(({ question, shown }) => shown ?? question), asked }
}

/** Whether a value is the answers of an AskUserQuestion result (A3): an object, not an array, of strings only. */
function isAnswers(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every(answer => typeof answer === 'string')
}

/**
 * The notes typed in a dialog for one question (A3), trimmed: the string `notes` of the annotation under the text the
 * dialog showed, read as an own key only; '' when there is none.
 */
function typedNotes(annotations: Record<string, unknown> | undefined, asked: string): string {
  if (annotations === undefined || !Object.hasOwn(annotations, asked)) return ''
  const annotation = annotations[asked]
  if (!isObject(annotation) || typeof annotation.notes !== 'string') return ''

  return annotation.notes.trim()
}

/**
 * What one previewed question answers (A3): the typed notes when there are any, else '' for DESCRIBE_OWN_LABEL picked
 * with nothing typed, else the answer as chosen; undefined when there is neither an answer nor notes.
 */
function ownAnswer(notes: string, answer: string | undefined): string | undefined {
  if (notes !== '') return notes
  if (answer === DESCRIBE_OWN_LABEL) return ''

  return answer
}

/**
 * The answers of an AskUserQuestion result after a dialog askRewrite rewrote (A3), or null to leave the result as it
 * is. $.ui.ask resolves to the answer under the question's text as asked and reads no notes, so for each question in
 * `asked` the notes typed in the dialog, trimmed and not empty, become its answer whatever was chosen; else
 * DESCRIBE_OWN_LABEL becomes '', which cadre's own parsers refuse and ask again; else the answer is kept. That answer
 * is stored under the question's text as asked, and the key of the text the dialog showed is dropped, so $.ui.ask
 * resolves to it as it does to an answer typed under Other. Every other answer is kept as is. The result is untrusted:
 * null unless it is an object whose `answers` is an object of strings and whose `annotations` is absent or an object.
 * Keys are read as own keys only, and the result is never changed.
 */
export function answersFromNotes(asked: readonly AskedQuestion[], result: unknown): Record<string, string> | null {
  if (!isObject(result)) return null
  const { answers, annotations } = result
  if (!isAnswers(answers)) return null
  if (annotations !== undefined && !isObject(annotations)) return null
  const out = new Map(Object.entries(answers))
  for (const entry of asked) {
    const answer = Object.hasOwn(answers, entry.asked) ? answers[entry.asked] : undefined
    const value = ownAnswer(typedNotes(annotations, entry.asked), answer)
    if (value === undefined) continue
    if (entry.asked !== entry.question) out.delete(entry.asked)
    out.set(entry.question, value)
  }

  return Object.fromEntries(out)
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
