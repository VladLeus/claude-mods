/**
 * The shared hand-out of G-02-1f (instruction parts) and G-02-1b (own skills): an entry question that accepts the
 * model's recommendations, asks each item one by one, or keeps the whole-group questions, and gives each item the roles
 * the person chose. It is a pure cursor (D-230): handoutEnter asks the entry question and handoutAnswer takes each
 * answer, so a stage asks it from its own StageDef. Pure: it imports core, ui/ask and init/answers, and never imports
 * init/machine or init/run.
 */
import type { AskSpec, RoleSpec } from '../../types'
import { labelled } from '../core/labelled'
import { choiceAnswer, quotedLabels, withContext } from '../ui/ask'
import type { ChoiceAsk } from '../ui/ask'
import { parseRoleList } from './answers'

/**
 * The entry answer that gives every item its recommended roles (G-02-1f Entry choices, G-02-1b), the same for the
 * instruction parts and the own skills (02-GAPS-B2 S7).
 */
export const ACCEPT_RECOMMENDATIONS = 'Accept recommendations'

/**
 * One item a hand-out may give to roles (G-02-1f, G-02-1b): its id, its question with the context line and chip it is
 * asked with, and the role ids recommended for it, which Accept gives it.
 */
export type HandoutItem = {
  readonly id: string
  readonly question: string
  readonly contextLine: string
  readonly header: string
  readonly recommended: readonly string[]
}

/**
 * The entry question of a hand-out (G-02-1f Entry choices): its text, context line and chip, and the labels of its
 * three answers in the order the dialog shows them: accept the recommendations, go one by one, or the whole group.
 */
export type HandoutEntry = {
  readonly question: string
  readonly contextLine: string
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
  return labelled(labels, answer)
}

/** Every item's id with the roles recommended for it, in item order (G-02-1f Entry choices: Accept). */
function recommendedOf(items: readonly HandoutItem[]): ReadonlyMap<string, readonly string[]> {
  return new Map(items.map((item): [string, readonly string[]] => [item.id, item.recommended]))
}

/** The item answer that gives an item its recommended roles (G-02-1f Part by part). */
const YES_LABEL = 'Yes'

/** The item answer that gives an item to no role (G-02-1f Part by part). */
const NO_LABEL = 'No'

/** The buttons of an item question; a role list is typed under "Other" (G-02-1f Part by part). */
const ITEM_OPTIONS: readonly string[] = Object.freeze([YES_LABEL, NO_LABEL])

/** What an item question takes, as its refusal lists it: Yes, No or the team's role ids (D-136). */
function itemAccepts(roles: readonly RoleSpec[]): string {
  return `${quotedLabels(ITEM_OPTIONS)}, or role ids from: ${roles.map(role => role.id).join(', ')}`
}

/**
 * The roles an answer to an item question gives the item (G-02-1f Part by part): Yes its recommended roles, No none,
 * else the role list parseRoleList reads (none, all, or role ids and titles); null when it reads none, so it is asked
 * again. Yes and No keep their meaning whatever a role is called.
 */
function itemRoles(answer: string, item: HandoutItem, roles: readonly RoleSpec[]): readonly string[] | null {
  const word = answer.trim().toLowerCase()
  if (word === YES_LABEL.toLowerCase()) return item.recommended
  if (word === NO_LABEL.toLowerCase()) return []

  return parseRoleList(answer, roles)
}

/**
 * Where a hand-out is (G-02-1f, D-230): at the entry question, or at the item at `index`, asked `tries` times so far,
 * with the roles each item before it was given; the entry, the items, the team and the reason a dismissal cancels
 * with stay with it.
 */
export type HandoutCursor = {
  readonly entry: HandoutEntry
  readonly items: readonly HandoutItem[]
  readonly roles: readonly RoleSpec[]
  readonly dismissedReason: string
  readonly mode: 'entry' | 'item'
  readonly index: number
  readonly tries: number
  readonly given: ReadonlyMap<string, readonly string[]>
}

/** What a hand-out does next: ask `question` with `spec` and wait at `cursor`, end with its outcome, or cancel. */
export type HandoutNext =
  | { readonly kind: 'ask'; readonly question: string; readonly spec: AskSpec; readonly cursor: HandoutCursor }
  | { readonly kind: 'done'; readonly outcome: HandoutOutcome }
  | { readonly kind: 'cancelled'; readonly reason: string }

/** A question of the hand-out as the cursor asks it: a ChoiceAsk with the reason a dismissal cancels with. */
type HandoutAsk<T> = ChoiceAsk<T> & { readonly dismissedReason: string }

/**
 * The entry question (G-02-1f Entry choices): its question with its context line on the second line, its chip and its
 * three answers in the order accept, one by one, whole, read trimmed and in any case.
 */
function entryAsk(cursor: HandoutCursor): HandoutAsk<EntryChoice> {
  const labels = entryLabels(cursor.entry)
  const options = labels.map(label => label.label)

  return {
    question: withContext(cursor.entry.question, cursor.entry.contextLine),
    spec: { options, header: cursor.entry.header },
    parse: (answer: string): EntryChoice | null => parseEntry(labels, answer),
    accepts: quotedLabels(options),
    dismissedReason: cursor.dismissedReason,
  }
}

/**
 * An item question (G-02-1f Part by part): its question with its context line on the second line, its chip and the
 * buttons Yes and No, a role list typed under "Other" (itemRoles).
 */
function itemAsk(cursor: HandoutCursor, item: HandoutItem): HandoutAsk<readonly string[]> {
  return {
    question: withContext(item.question, item.contextLine),
    spec: { options: ITEM_OPTIONS, header: item.header },
    parse: (answer: string): readonly string[] | null => itemRoles(answer, item, cursor.roles),
    accepts: itemAccepts(cursor.roles),
    dismissedReason: cursor.dismissedReason,
  }
}

/** The hand-out asking `ask` at `cursor`; `question` is the ask's text after a refusal. */
function asked<T>(cursor: HandoutCursor, ask: HandoutAsk<T>, question: string | null): HandoutNext {
  return { kind: 'ask', question: question ?? ask.question, spec: ask.spec, cursor }
}

/** The item at `index` asked the first time, or, after the last item, the hand-out done with what each was given. */
function itemAt(cursor: HandoutCursor, index: number, given: ReadonlyMap<string, readonly string[]>): HandoutNext {
  const item = cursor.items[index]
  if (item === undefined) return { kind: 'done', outcome: { kind: 'given', given } }
  const at: HandoutCursor = { ...cursor, mode: 'item', index, tries: 1, given }

  return asked(at, itemAsk(at, item), null)
}

/**
 * The hand-out at its entry question (G-02-1f Entry choices), with `items` to hand out to `roles`; a dismissal of any
 * of its questions cancels with `dismissedReason` (handoutAnswer). It only asks: the roles and items never change.
 */
export function handoutEnter(
  entry: HandoutEntry,
  items: readonly HandoutItem[],
  roles: readonly RoleSpec[],
  dismissedReason: string,
): HandoutNext {
  const given = new Map<string, readonly string[]>()
  const cursor: HandoutCursor = { entry, items, roles, dismissedReason, mode: 'entry', index: 0, tries: 1, given }

  return asked(cursor, entryAsk(cursor), null)
}

/**
 * The answer to the question the hand-out has out (choiceAnswer). At the entry question, Accept gives every item its
 * recommended roles, an item with none to no role; one by one asks each item once, in item order; the whole answer
 * gives the whole-group outcome, so the stage asks its whole-group questions. At an item, Yes gives it its recommended
 * roles, No none, and a typed role list that list; after the last item the hand-out is done. Any other answer is asked
 * again with why on top; a dismissal cancels with the hand-out's reason, and MAX_ASKS answers it cannot read at one
 * question with NO_USABLE_ANSWER_REASON, so no answer the person did not give hands anything out (A1).
 */
export function handoutAnswer(cursor: HandoutCursor, answer: string | null): HandoutNext {
  if (cursor.mode === 'entry') {
    const ask = entryAsk(cursor)
    const next = choiceAnswer(ask, cursor, answer)
    if (next.kind === 'again') return asked({ ...cursor, tries: next.sub.tries }, ask, next.question)
    if (next.kind === 'cancelled') return next
    if (next.value === 'whole') return { kind: 'done', outcome: { kind: 'whole' } }
    if (next.value === 'oneByOne') return itemAt(cursor, 0, new Map())

    return { kind: 'done', outcome: { kind: 'given', given: recommendedOf(cursor.items) } }
  }
  const item = cursor.items[cursor.index]
  if (item === undefined) return { kind: 'cancelled', reason: cursor.dismissedReason }
  const ask = itemAsk(cursor, item)
  const next = choiceAnswer(ask, cursor, answer)
  if (next.kind === 'again') return asked({ ...cursor, tries: next.sub.tries }, ask, next.question)
  if (next.kind === 'cancelled') return next

  return itemAt(cursor, cursor.index + 1, new Map([...cursor.given, [item.id, next.value]]))
}
