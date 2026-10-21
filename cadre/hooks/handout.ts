/**
 * The shared hand-out of G-02-1f (instruction parts) and G-02-1b (own skills): an entry question that accepts the
 * model's recommendations, asks each item one by one, or keeps the whole-group questions, and gives each item the roles
 * the person chose. Pure: it asks through the InitIo port it is given, and it never imports init.ts, which imports it.
 */
import type { InitIo, RoleSpec } from '../types'
import { accepted, askChoice, choiceResult, quotedLabels, withContext } from './ask'
import type { StepResult } from './ask'

/**
 * One item a hand-out may give to roles (G-02-1f, G-02-1b): its id, its question with the context line and chip it is
 * asked with, and the role ids recommended for it, which Accept gives it.
 */
export type HandoutItem = {
  readonly id: string
  readonly question: string
  readonly context: string
  readonly header: string
  readonly recommended: readonly string[]
}

/**
 * The entry question of a hand-out (G-02-1f Entry choices): its text, context line and chip, and the labels of its
 * three answers in the order the dialog shows them: accept the recommendations, go one by one, or the whole group.
 */
export type HandoutEntry = {
  readonly question: string
  readonly context: string
  readonly header: string
  readonly accept: string
  readonly oneByOne: string
  readonly whole: string
}

/**
 * What a hand-out gave (G-02-1f): every item's id with the role ids it was given, [] for an item no role takes, or the
 * whole-group questions instead.
 */
export type HandoutOutcome =
  | { readonly kind: 'given'; readonly given: ReadonlyMap<string, readonly string[]> }
  | { readonly kind: 'whole' }

/** An answer to the entry question: accept the recommendations, go one by one, or the whole group. */
type EntryChoice = 'accept' | 'oneByOne' | 'whole'

/** An entry answer's label with what it picks. */
type EntryLabel = {
  readonly label: string
  readonly value: EntryChoice
}

/** The entry answers with what each picks, in the order the dialog shows them. */
function entryLabels(entry: HandoutEntry): readonly EntryLabel[] {
  return [
    { label: entry.accept, value: 'accept' },
    { label: entry.oneByOne, value: 'oneByOne' },
    { label: entry.whole, value: 'whole' },
  ]
}

/** The entry answer an answer names, trimmed and in any case; null when it names none, so it is asked again. */
function parseEntry(labels: readonly EntryLabel[], answer: string): EntryChoice | null {
  const wanted = answer.trim().toLowerCase()
  const found = labels.find(entry => entry.label.toLowerCase() === wanted)

  return found === undefined ? null : found.value
}

/** Every item's id with the roles recommended for it, in item order (G-02-1f Entry choices: Accept). */
function recommendedOf(items: readonly HandoutItem[]): ReadonlyMap<string, readonly string[]> {
  return new Map(items.map((item): [string, readonly string[]] => [item.id, item.recommended]))
}

/**
 * The hand-out (G-02-1f Entry choices). It asks the entry question with its context line on the second line, its chip
 * and its three answers in the order accept, one by one, whole, and asks any other answer again with why on top
 * (askChoice). Accept gives every item its recommended roles, an item with none to no role; the whole answer gives the
 * whole-group outcome, so the caller asks its whole-group questions. A dismissal is cancelled with `dismissedReason`
 * and MAX_ASKS answers it cannot read with NO_USABLE_ANSWER_REASON, so no answer the person did not give hands anything
 * out (A1). It only asks: the roles and the items it is given never change.
 */
export async function handoutStep(
  io: InitIo,
  entry: HandoutEntry,
  items: readonly HandoutItem[],
  roles: readonly RoleSpec[],
  dismissedReason: string,
): Promise<StepResult<HandoutOutcome>> {
  const labels = entryLabels(entry)
  const options = labels.map(label => label.label)
  const ask = {
    question: withContext(entry.question, entry.context),
    spec: { options, header: entry.header },
    parse: (answer: string): EntryChoice | null => parseEntry(labels, answer),
    accepts: quotedLabels(options),
  }
  const choice = choiceResult(await askChoice(io, ask), dismissedReason)
  if (choice.kind === 'cancelled') return choice
  if (choice.value === 'whole') return accepted({ kind: 'whole' })

  return accepted({ kind: 'given', given: recommendedOf(items) })
}
