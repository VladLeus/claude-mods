/**
 * The option preview, a layer 8 module: the open question's own context as the markdown preview of a dialog option on
 * the terminal main screen (D3, D-203), its lines wrapped to the width of the preview box (D-231), the rewrite of an
 * AskUserQuestion call with its previews and the Describe your own option (A1, A2, R3, R4), and the answers typed as
 * notes (A3). It imports core, the line wrap of ui/pane and the types, so register's AskUserQuestion hook reads it
 * here.
 */
import type { AskContext, ShownBlock } from '../../types'
import { isObject } from '../core/json'
import { clean } from '../core/text'
import { UNCUT, wrapLine } from './pane'

/**
 * The most characters, by String length, the preview of a dialog option holds (D3): the engine replaces a preview
 * over 2000 characters with a placeholder, and 1900 leaves room.
 */
export const MAX_PREVIEW_CHARS = 1900

/** The last line of a preview that was cut (D3). */
const CUT_LINE = '…'

/** The characters a preview title escapes with a backslash, so the title draws as its own text (D3). */
const TITLE_MARKUP = /[*_`[\]<>#\\~|]/g

/** What a preview draws of one block or context (D3, D-203): its title and its lines. */
type Previewed = Pick<ShownBlock, 'title' | 'lines'>

/**
 * The cells of the terminal's width the dialog's option column and the preview box's frame take (D-231), as the spike
 * measured them on the main screen: the box's lines wrap at 122 cells at 160 columns and at 72 at 110.
 */
const PREVIEW_INSET = 38

/**
 * The columns a dialog option's preview has on the terminal main screen (D-231): the terminal's columns as the command
 * runs (CommandPresentation) less PREVIEW_INSET; null when they are not a whole number or leave no column, as for a
 * command run with no presentation.
 */
export function previewColumns(presentationColumns: unknown): number | null {
  if (typeof presentationColumns !== 'number' || !Number.isInteger(presentationColumns)) return null
  const columns = presentationColumns - PREVIEW_INSET
  if (columns < 1) return null

  return columns
}

/**
 * The rows of context lines a dialog option's preview shows on the TUI default (D-228): the rows the spike measured
 * on the terminal main screen at 48 rows (`rows - 26`). The engine hides a preview's rows past its box, and the
 * terminal's rows are not known to cadre, so this is the one size every TUI-default preview is fitted to.
 */
export const PREVIEW_ROWS = 22

/**
 * What the TUI-default preview shows of a context (D-228): the lines it draws, and whether the context holds more lines
 * than that, so register prints the whole context as transcript rows right above the dialog.
 */
export type FittedPreview = {
  readonly lines: readonly string[]
  readonly isOverflow: boolean
}

/**
 * A context fitted to `rows` lines of a TUI-default preview (D-228): every line when they fit, and nothing overflows;
 * else its first `rows - 1` lines and one last line that counts the lines left out, which register prints above the
 * dialog, and it overflows. The Review is kept whole and never overflows: it is paged instead (D-233). Rows under two
 * leave no room for a line and the count, so the context is kept whole.
 */
export function fitPreview(context: AskContext, rows: number): FittedPreview {
  const { lines } = context
  if (context.kind === 'review' || lines.length <= rows || rows < 2) return { lines, isOverflow: false }
  const shown = lines.slice(0, rows - 1)

  return { lines: [...shown, `+${lines.length - shown.length} more above`], isOverflow: true }
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
 * One block as a preview draws it (D3): the title cleaned, with no cap, its markdown characters escaped and set in
 * bold; each line cleaned, with no cap, then wrapped to `columns` (wrapLine, D-231), or kept whole with no columns; a
 * fence one backtick longer than the longest run in the lines, and at least three.
 */
function previewBlock(block: Previewed, columns: number | null): PreviewBlock {
  const lines = block.lines.flatMap(line => {
    const cleaned = clean(line, UNCUT)

    return columns === null ? [cleaned] : wrapLine(cleaned, columns)
  })
  const title = `**${clean(block.title, UNCUT).replace(TITLE_MARKUP, '\\$&')}**`

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
 * Blocks, such as the open question's own context (D-203), as the markdown preview of a dialog option (D3), for the
 * terminal main screen, where the engine hides the pane while a dialog is open. Per block, in the order given, its
 * title in bold, cleaned with its markdown characters escaped, then its lines, each cleaned with its indent kept and
 * wrapped to `columns` (previewBlock, D-231), in a fence one backtick longer than any backtick run in them and at least
 * three: the fence keeps every scanned or typed value literal, so none can format the preview or end the fence. A
 * blank line parts two blocks. Past MAX_PREVIEW_CHARS the preview is cut after a whole line, its open fence closed,
 * and ends with a `…` line (cutPreview); lengths are String lengths, never fewer than the code points. No blocks give
 * ''.
 */
export function previewMarkdown(blocks: readonly Previewed[], columns: number | null = null): string {
  const parts = blocks.map(block => previewBlock(block, columns))
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
 * D3, R3, R4); null, so the call passes through unchanged and the dialog keeps its Other row, when the open question
 * has no context of its own (D-203) or withPreviews does not rewrite the questions. Each option of each single-select
 * question gets the preview of the open question's own context, its lines wrapped to `columns` (previewMarkdown,
 * D-203, D-231), whatever its header, and each such question then gets NOTE_WORDING for every OTHER_WORDING in its
 * text (R4), the hint line as its last line (R3) and, when it has room, the Describe your own option with that preview
 * (withDescribeOwn), with an AskedQuestion that pairs its text as asked with the text the dialog shows (A3); a
 * multi-select question is copied unchanged, OTHER_WORDING included, and has none. Given `rows`, as on the TUI default,
 * the preview shows the context fitted to them (fitPreview, D-228); with none it shows every line.
 */
export function askRewrite(
  questions: unknown,
  context: AskContext | null,
  columns: number | null = null,
  rows: number | null = null,
): AskRewrite | null {
  if (context === null) return null
  const shown = rows === null ? context : { ...context, lines: fitPreview(context, rows).lines }
  const preview = previewMarkdown([shown], columns)
  const previewed = withPreviews(questions, () => preview)
  if (previewed === null) return null
  const pairs = previewed.map(question => {
    const shown = question.multiSelect === true ? null : withDescribeOwn(question, preview)

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
