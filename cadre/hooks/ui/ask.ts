/**
 * The ask machinery every init step shares (D-45, D-133, D-136): one ask, the refusal loop and its pure twin for the
 * stages of the init machine (choiceAnswer, D-230), context lines, pane blocks, notes and step results. init.ts and
 * history.ts both import it, and it imports neither, so the two never
 * import each other.
 * ui/ask is a layer 8 module: the init stages, regen, apply and epic import it.
 */
import type { AskContext, AskSpec, InitIo, PaneKey, PaneQuestion } from '../../types'
import { clean, reportText } from '../core/text'
import { t } from '../locales/t'
import { UNCUT } from './pane'

/** The total number of asks one question gets: an answer that is not a listed choice is asked again, up to this many. */
export const MAX_ASKS = 3

/**
 * Why init cancels when one question got MAX_ASKS answers it could not read (D-136). Esc keeps the question's own
 * dismissed reason (D-45); both cancel, and nothing is written (A1).
 */
export const NO_USABLE_ANSWER_REASON = t('ui.ask.noUsableAnswer', { maxAsks: MAX_ASKS })

/**
 * The chip set of G-02-3c (D-136): the header chip of each kind of init question, a name of 12 characters at most (the
 * engine's limit for a chip), so no init dialog falls back to the engine's generic chip. A hunk question keeps its own
 * `Hunk i of n` chip (hunkQuestion).
 */
export const ASK_HEADERS = Object.freeze({
  claudeJson: t('ui.chip.claudeJson'),
  history: t('ui.chip.history'),
  roles: t('ui.chip.roles'),
  adjust: t('ui.chip.adjust'),
  describe: t('ui.chip.describe'),
  framework: t('ui.chip.framework'),
  security: t('ui.chip.security'),
  duration: t('ui.chip.duration'),
  model: t('ui.chip.model'),
  mcp: t('ui.chip.mcp'),
  skills: t('ui.chip.skills'),
  memory: t('ui.chip.memory'),
  instructions: t('ui.chip.instructions'),
  env: t('ui.chip.env'),
  launch: t('ui.chip.launch'),
  launchDir: t('ui.chip.launchDir'),
  gitPolicy: t('ui.chip.gitPolicy'),
  review: t('ui.chip.review'),
  conflict: t('ui.chip.conflict'),
  improver: t('ui.chip.improver'),
})

/** The most code points the engine shows in a question's chip. */
export const MAX_CHIP_CHARS = 12

/** A counted chip (G-02-3c): `<word> <i>/<n>`, or just the word when that would be over MAX_CHIP_CHARS code points. */
export function countedChip(word: string, position: number, count: number): string {
  const chip = t('ui.ask.countedChip', { word, position, count })

  return Array.from(chip).length > MAX_CHIP_CHARS ? word : chip
}

/**
 * What every init step gives (A1, D-45): only an explicit confirming answer is accepted, with the value it chose; a
 * dismissal or a cap is cancelled with the reason runInit prints, and holds no value.
 */
export type StepResult<T> =
  | { readonly kind: 'accepted'; readonly value: T }
  | { readonly kind: 'cancelled'; readonly reason: string }

/** A step result accepted with the value the person confirmed. */
export function accepted<T>(value: T): StepResult<T> {
  return { kind: 'accepted', value }
}

/** A step result cancelled with the reason runInit prints; the step itself prints nothing (A1). */
export function cancelled(reason: string): StepResult<never> {
  return { kind: 'cancelled', reason }
}

/** Asks once; null when the dialog is dismissed. The rejection is never read, so its text cannot reach a reply. */
export async function askOnce(io: InitIo, question: string, spec: AskSpec): Promise<string | null> {
  try {
    return await io.ask(question, spec)
  } catch {
    return null
  }
}

/**
 * What one question gave (D-136): the value of an answer its parser took, a dismissal, or MAX_ASKS answers it could
 * not read. Only `answered` holds a choice (A1).
 */
export type AskResult<T> =
  | { readonly kind: 'answered'; readonly value: T }
  | { readonly kind: 'dismissed' }
  | { readonly kind: 'exhausted' }

/**
 * One question as askChoice asks it (D-136): its text and dialog spec, the parser that reads an answer (null when it
 * reads none), and the answers it takes in words, which the default refusal lists.
 */
export type ChoiceAsk<T> = {
  readonly question: string
  readonly spec: AskSpec
  readonly parse: (answer: string) => T | null
  readonly accepts: string
  /**
   * The first line an answer the parser does not take puts on top of the next ask; refusalLine(answer, accepts) when
   * absent (D-136).
   */
  readonly refuse?: (answer: string) => string
}

/** The most code points of a typed answer a refusal echoes, so the answer cannot push the rest out (T-02-54). */
const MAX_REFUSED_CHARS = 40

/**
 * The first line of a question asked again after an answer it could not read (D-136): the answer, trimmed, cleaned
 * and cut to MAX_REFUSED_CHARS code points, so a typed line break or control character cannot forge a line of the
 * dialog (T-02-54), then the answers the question takes. An answer that is empty once cleaned is named an empty answer.
 */
export function refusalLine(answer: string, accepts: string): string {
  const typed = clean(answer.trim(), MAX_REFUSED_CHARS)
  if (typed === '') return t('ui.ask.refusalEmpty', { accepts })

  return t('ui.ask.refusalTyped', { typed, accepts })
}

/** Option labels as a refusal lists them (D-136): each in double quotes, joined with `, `. */
export function quotedLabels(options: readonly string[]): string {
  return options.map(label => `"${label}"`).join(', ')
}

/**
 * Words as a hint lists them for a person to type (D-225): one word alone, else the others joined with `, ` and the
 * last after `or` (ui.ask.orList); empty for none. A hint fills them from the tokens its parser reads.
 */
export function orList(words: readonly string[]): string {
  const last = words.at(-1) ?? ''
  if (words.length <= 1) return last

  return t('ui.ask.orList', { head: words.slice(0, -1).join(', '), last })
}

/** A question as it is asked (D-136): after a refusal, the refusal on its own first line, then the question. */
export function askedText(question: string, refusal: string | null): string {
  return refusal === null ? question : `${refusal}\n${question}`
}

/**
 * The most code points of a question's context line, the ellipsis included (batch-1 review N2): room for twelve roles
 * or a polyglot scan line.
 */
const MAX_CONTEXT_CHARS = 400

/**
 * A context line as a question carries it: unsafe characters removed, then capped at MAX_CONTEXT_CHARS code points
 * (T-02-55).
 */
export function contextText(text: string): string {
  return clean(text, MAX_CONTEXT_CHARS)
}

/**
 * A question with its short context line (G-02-1, D-136): the question, then on the next line the context, cleaned
 * and capped as a context line (contextText), so the dialog reads on its own on a surface where the side pane is not
 * drawn and a scanned or typed value in it cannot add a line or hide text (T-02-55). A pane surface asks the one line
 * its ask site chose in place of this line, through the context's `pane` (paneQuestionOf, D-255); MAX_CONTEXT_CHARS
 * stays the safety cap of both.
 */
export function withContext(question: string, context: string): string {
  return `${question}\n${contextText(context)}`
}

/**
 * A question as both surfaces ask it (D-255): `asked`, the sentence with its context line as the TUI default asks it
 * (withContext), and `text`, the sentence with the one line the ask site chose for a pane surface, which holds the
 * rest of the context in the pane.
 */
export function paneQuestionOf(sentence: string, contextLine: string, line: string): PaneQuestion {
  return { asked: withContext(sentence, contextLine), text: withContext(sentence, line) }
}

/**
 * What a pane surface asks for `question` (D-255): the pane text of the question's context when the question is its
 * asked text, or that text with the refusal line on top when the question is a refusal, a newline and the asked text
 * (askedText), the refusal kept as it is; a question with no context, a context with no pane text, or a question that
 * does not end with the asked text is asked as given.
 */
export function paneQuestionText(question: string, context: AskContext | null): string {
  const pane = context?.pane
  if (pane === undefined) return question
  if (question === pane.asked) return pane.text
  if (!question.endsWith(`\n${pane.asked}`)) return question

  return `${question.slice(0, question.length - pane.asked.length)}${pane.text}`
}

/**
 * Asks `ask.question` and gives what `ask.parse` makes of the answer (D-45, D-136). An answer the parser does not take
 * is asked again with its refusalLine on top of the question, up to MAX_ASKS asks in all; after MAX_ASKS such answers
 * it gives `exhausted` and asks no more. A question with its own `refuse` puts that text on top instead. A dismissed
 * dialog gives `dismissed` at once and is not asked again. A dismissal, an empty answer and an unknown answer are never
 * taken as the person's choice (A1).
 */
export async function askChoice<T>(io: InitIo, ask: ChoiceAsk<T>): Promise<AskResult<T>> {
  let refusal: string | null = null
  for (let asked = 0; asked < MAX_ASKS; asked += 1) {
    const answer = await askOnce(io, askedText(ask.question, refusal), ask.spec)
    if (answer === null) return { kind: 'dismissed' }
    const value = ask.parse(answer)
    if (value !== null) return { kind: 'answered', value }
    refusal = ask.refuse === undefined ? refusalLine(answer, ask.accepts) : ask.refuse(answer)
  }

  return { kind: 'exhausted' }
}

/**
 * A question's result as a step result (A1, D-45, D-136): an answer is accepted with its value, a dismissal is
 * cancelled with that question's `dismissedReason`, and MAX_ASKS answers it could not read with
 * NO_USABLE_ANSWER_REASON.
 */
export function choiceResult<T>(result: AskResult<T>, dismissedReason: string): StepResult<T> {
  if (result.kind === 'answered') return accepted(result.value)
  if (result.kind === 'dismissed') return cancelled(dismissedReason)

  return cancelled(NO_USABLE_ANSWER_REASON)
}

/**
 * What one answer to a question of a pure init stage gives (D-230, D-136): the value its parser took, the question to
 * ask again with the try it will be, or a cancel with its reason. Only `value` holds a choice (A1).
 */
export type ChoiceAnswer<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'again'; readonly question: string; readonly sub: { readonly tries: number } }
  | { readonly kind: 'cancelled'; readonly reason: string }

/**
 * askChoice and choiceResult as one pure step (D-230, D-136, D-45), for a question asked `sub.tries` times so far: an
 * answer the parser takes gives its value; one it does not take gives the question again with the refusal on top (the
 * question's own refuse text, else refusalLine) and the next try, until the MAX_ASKS-th such answer, which cancels with
 * NO_USABLE_ANSWER_REASON; a dismissal (null) cancels at once with the question's `dismissedReason`. A dismissal, an
 * empty answer and an unknown answer are never taken as the person's choice (A1).
 */
export function choiceAnswer<T>(
  ask: ChoiceAsk<T> & { readonly dismissedReason: string },
  sub: { readonly tries: number },
  answer: string | null,
): ChoiceAnswer<T> {
  if (answer === null) return { kind: 'cancelled', reason: ask.dismissedReason }
  const value = ask.parse(answer)
  if (value !== null) return { kind: 'value', value }
  if (sub.tries >= MAX_ASKS) return { kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON }
  const refusal = ask.refuse === undefined ? refusalLine(answer, ask.accepts) : ask.refuse(answer)

  return { kind: 'again', question: askedText(ask.question, refusal), sub: { tries: sub.tries + 1 } }
}

/**
 * Logs one note to the transcript as one line and shows it in the side pane's notes block (D-133; batch-1 review S1:
 * the desktop app does not draw ui.log rows), cleaned as a report cell (reportText), so a scanned or typed value cannot
 * add a line or hide text. A block of lines goes to the side pane (showBlock) instead.
 */
export async function noteLine(io: InitIo, line: string): Promise<void> {
  io.log(reportText(line))
  await showBlock(io, 'notes', [line])
}

/**
 * The side-pane titles of D-133 and D-135, the notes block of the batch-1 review S1, the instruction parts block of
 * G-02-1f, the own-skills block of G-02-1b, the improver's diff block of D-141 and the loader of D-257: the bold title
 * of each kind of block the cadre init pane shows. The loader block itself is titled with its step's label
 * (withLoader).
 */
export const PANE_TITLES: Readonly<Record<PaneKey, string>> = Object.freeze({
  scan: t('ui.paneTitle.scan'),
  history: t('ui.paneTitle.history'),
  roles: t('ui.paneTitle.roles'),
  recommendations: t('ui.paneTitle.recommendations'),
  review: t('ui.paneTitle.review'),
  env: t('ui.paneTitle.env'),
  notes: t('ui.paneTitle.notes'),
  instructions: t('ui.paneTitle.instructions'),
  skills: t('ui.paneTitle.skills'),
  improver: t('ui.paneTitle.improver'),
  loader: t('ui.paneTitle.loader'),
})

/**
 * Shows lines as one side-pane block (D-133): each line cleaned, not cut (clean with UNCUT, #163), so a scanned or
 * typed value cannot add a row or hide text, and the pane wraps a long line to its width (D-231).
 */
export async function showBlock(io: InitIo, key: PaneKey, lines: readonly string[]): Promise<void> {
  await io.show({ key, title: PANE_TITLES[key], lines: lines.map(line => clean(line, UNCUT)) })
}
