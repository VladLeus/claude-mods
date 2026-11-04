import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, AskSpec, RoleSpec } from '../../types'
import { templateRole } from '../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../ui/ask'
import { handoutAnswer, handoutEnter, handoutItemsEnter } from './handout'
import type { HandoutEntry, HandoutItem, HandoutNext } from './handout'

/** The team of the hand-out cases: PM, Team Lead and Security, in that order. */
const ROLES: readonly RoleSpec[] = [templateRole('pm'), templateRole('tl'), templateRole('security')]

/** The own context of the entry question of the cases (D-300), with its summary (D-310). */
const ENTRY_CONTEXT: AskContext = {
  title: 'Instruction parts',
  lines: ['2 topics from 1 file'],
  kind: 'instructions',
  summary: '2 topics, 0 memories, 1 recommended',
}

/** The entry question of the cases, with the three labels of the instruction parts flow (G-02-1f). */
const ENTRY: HandoutEntry = {
  question: 'How do you want to hand out the instruction parts?',
  contextLine: '2 topics from 1 file; the pane shows each with the roles it is recommended for.',
  header: 'Instructions',
  accept: 'Accept recommendations',
  oneByOne: 'Go part by part',
  whole: 'Whole files',
  context: ENTRY_CONTEXT,
}

/** The own context of the question of the topic titled `title` (D-300), with its summary (D-310). */
function topicContextOf(title: string): AskContext {
  return { title, lines: [`${title} only`], kind: 'topic', summary: `${title} summary` }
}

/** Two items: the first recommended to Security, the second to no role. */
const ITEMS: readonly HandoutItem[] = [
  {
    id: 'T1',
    question: 'Which roles get "Security rules"?',
    contextLine: 'How secrets stay out of the repo.',
    header: 'Topic 1/2',
    recommended: ['security'],
    context: topicContextOf('Security rules'),
  },
  {
    id: 'T2',
    question: 'Which roles get "Git and commits"?',
    contextLine: 'How commits are made.',
    header: 'Topic 2/2',
    recommended: [],
    context: topicContextOf('Git and commits'),
  },
]

/**
 * A context as a hand-out question carries it (D-300, D-310): with what a pane surface asks, the question with the
 * context's summary in place of its context line.
 */
function withPane(
  context: AskContext,
  question: { readonly question: string; readonly contextLine: string },
): AskContext {
  const asked = withContext(question.question, question.contextLine)

  return { ...context, pane: { asked, text: withContext(question.question, context.summary) } }
}

/** The reason the cases cancel with when the entry question is dismissed. */
const DISMISSED = 'A question on which roles get instruction parts was dismissed or not answered.'

/** The entry question as it is asked: the question, then its context line (D-136). */
const ENTRY_ASKED = withContext(ENTRY.question, ENTRY.contextLine)

/** A hand-out as the cursor asked it: every question and spec, in order, and how it ended. */
type HandedOut = {
  readonly asked: string[]
  readonly specs: AskSpec[]
  readonly end: HandoutNext
}

/**
 * The hand-out of ENTRY with `items` to ROLES, driven through the cursor as init/run asks it: each question gets the
 * next of `answers` (null, or none left, is a dismissal), and `reason` is what a dismissal cancels with.
 */
function handedOut(
  items: readonly HandoutItem[],
  answers: readonly (string | null)[],
  reason: string = DISMISSED,
): HandedOut {
  const asked: string[] = []
  const specs: AskSpec[] = []
  let next = handoutEnter(ENTRY, items, ROLES, reason)
  for (let at = 0; next.kind === 'ask'; at += 1) {
    asked.push(next.question)
    specs.push(next.spec)
    next = handoutAnswer(next.cursor, answers[at] ?? null)
  }

  return { asked, specs, end: next }
}

/** The given map of a hand-out's end as entries, so a test compares plain arrays; null for whole or a cancel. */
function givenOf(end: HandoutNext): (readonly [string, readonly string[]])[] | null {
  if (end.kind !== 'done' || end.outcome.kind === 'whole') return null

  return [...end.outcome.given.entries()]
}

describe('handoutStep', () => {
  test('asks the entry question once, with its context line, the three answers in order and its chip', () => {
    const run = handedOut(ITEMS, ['Accept recommendations'])
    expect(run.asked).toEqual([ENTRY_ASKED])
    const options = ['Accept recommendations', 'Go part by part', 'Whole files']
    // Paged on a pane surface, the entry keeps one by one and the whole group on every page (D-306).
    const pageOptions = { always: ['Go part by part', 'Whole files'], dropped: [] }
    expect(run.specs).toEqual([
      { options, header: 'Instructions', pageOptions, context: withPane(ENTRY_CONTEXT, ENTRY) },
    ])
  })

  test('Accept gives each item its recommended roles, one with none to no role, and asks nothing more', () => {
    const run = handedOut(ITEMS, ['Accept recommendations'])
    expect(givenOf(run.end)).toEqual([
      ['T1', ['security']],
      ['T2', []],
    ])
    expect(run.asked).toHaveLength(1)
  })

  test('the entry answers are read trimmed and in any case', () => {
    expect(givenOf(handedOut(ITEMS, ['  accept RECOMMENDATIONS '], '').end)).toEqual([
      ['T1', ['security']],
      ['T2', []],
    ])
    expect(handedOut(ITEMS, [' whole files'], '').end).toEqual({ kind: 'done', outcome: { kind: 'whole' } })
  })

  test('Whole gives the whole-group outcome and asks nothing more', () => {
    const run = handedOut(ITEMS, ['Whole files'])
    expect(run.end).toEqual({ kind: 'done', outcome: { kind: 'whole' } })
    expect(run.asked).toEqual([ENTRY_ASKED])
  })

  test('a dismissed entry question cancels with the reason it is given, and asks nothing more (A1)', () => {
    const run = handedOut(ITEMS, [])
    expect(run.end).toEqual({ kind: 'cancelled', reason: DISMISSED })
    expect(run.asked).toEqual([ENTRY_ASKED])
  })

  test('three answers it cannot read cancel with no usable answer; the refusal lists the three answers', () => {
    const run = handedOut(ITEMS, ['maybe', 'maybe', 'maybe', 'Accept recommendations'])
    expect(run.end).toEqual({ kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON })
    const refusal = `'maybe' isn't one of: "Accept recommendations", "Go part by part", "Whole files".`
    expect(run.asked).toEqual([ENTRY_ASKED, `${refusal}\n${ENTRY_ASKED}`, `${refusal}\n${ENTRY_ASKED}`])
  })

  test('the roles and items it is given never change', () => {
    const before = JSON.stringify([ROLES, ITEMS])
    handedOut(ITEMS, ['Accept recommendations'])
    expect(JSON.stringify([ROLES, ITEMS])).toBe(before)
  })
})

/** A topic item with this id, title, chip and recommended roles; its context line names the title. */
function topicItem(id: string, title: string, header: string, recommended: readonly string[]): HandoutItem {
  const context = topicContextOf(title)

  return { id, question: `Which roles get "${title}"?`, contextLine: `About ${title}.`, header, recommended, context }
}

/** Three items: the first recommended to Security, the second to the Team Lead, the third to no role. */
const THREE_ITEMS: readonly HandoutItem[] = [
  topicItem('T1', 'Security rules', 'Topic 1/3', ['security']),
  topicItem('T2', 'Git and commits', 'Topic 2/3', ['tl']),
  topicItem('T3', 'Release notes', 'Topic 3/3', []),
]

/** An item question as it is asked: the question, then its context line (D-136). */
function itemAsked(item: HandoutItem | undefined): string {
  return item === undefined ? 'missing item' : withContext(item.question, item.contextLine)
}

/** The refusal on top of an item question asked again after the answer `cto` (D-136). */
const CTO_REFUSAL = `'cto' isn't one of: "Yes", "No", or role ids from: pm, tl, security.`

describe('handoutStep one by one', () => {
  test('Go part by part asks each item once, in order, with its context line, its chip and Yes / No', () => {
    const run = handedOut(ITEMS, ['Go part by part', 'Yes', 'No'])
    expect(run.asked).toEqual([ENTRY_ASKED, itemAsked(ITEMS[0]), itemAsked(ITEMS[1])])
    const [first, second] = ITEMS.map(item => withPane(item.context, item))
    expect(run.specs.slice(1)).toEqual([
      { options: ['Yes', 'No'], header: 'Topic 1/2', acceptsTyped: true, context: first },
      { options: ['Yes', 'No'], header: 'Topic 2/2', acceptsTyped: true, context: second },
    ])
  })

  test('Yes gives an item its recommended roles, No none, and a typed role list gives that list', () => {
    expect(givenOf(handedOut(THREE_ITEMS, ['Go part by part', 'Yes', 'No', 'tl, security']).end)).toEqual([
      ['T1', ['security']],
      ['T2', []],
      ['T3', ['tl', 'security']],
    ])
  })

  test('Yes on an item recommended to no role gives it none; none and all work as they do elsewhere', () => {
    expect(givenOf(handedOut(THREE_ITEMS, ['Go part by part', ' NO ', 'all', 'yes']).end)).toEqual([
      ['T1', []],
      ['T2', ['pm', 'tl', 'security']],
      ['T3', []],
    ])
    expect(givenOf(handedOut(ITEMS, ['Go part by part', 'None', 'Yes']).end)).toEqual([
      ['T1', []],
      ['T2', []],
    ])
  })

  test('an answer it cannot read is asked again with why on top: Yes, No or the role ids', () => {
    const run = handedOut(ITEMS, ['Go part by part', 'cto', 'Security', 'No'])
    expect(givenOf(run.end)).toEqual([
      ['T1', ['security']],
      ['T2', []],
    ])
    expect(run.asked.slice(1, 3)).toEqual([itemAsked(ITEMS[0]), `${CTO_REFUSAL}\n${itemAsked(ITEMS[0])}`])
  })

  test('a dismissed item cancels with the reason given; three unreadable answers with no usable answer', () => {
    const dismissed = handedOut(ITEMS, ['Go part by part', 'Yes'])
    expect(dismissed.end).toEqual({ kind: 'cancelled', reason: DISMISSED })
    expect(dismissed.asked).toHaveLength(3)
    const exhausted = handedOut(ITEMS, ['Go part by part', 'cto', 'cto', 'cto', 'Yes'])
    expect(exhausted.end).toEqual({ kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON })
    expect(exhausted.asked).toHaveLength(4)
  })

  test('with no item, Go part by part asks nothing more and gives every item, none, its roles', () => {
    const run = handedOut([], ['Go part by part'])
    expect(givenOf(run.end)).toEqual([])
    expect(run.asked).toEqual([ENTRY_ASKED])
  })
})

describe('the hand-out cursor (D-230)', () => {
  test('handoutEnter asks the entry question with its context line, the three answers in order and its chip', () => {
    const first = handoutEnter(ENTRY, ITEMS, ROLES, DISMISSED)
    const options = ['Accept recommendations', 'Go part by part', 'Whole files']
    const pageOptions = { always: ['Go part by part', 'Whole files'], dropped: [] }
    expect(first.kind === 'ask' ? [first.question, first.spec] : first).toEqual([
      ENTRY_ASKED,
      { options, header: 'Instructions', pageOptions, context: withPane(ENTRY_CONTEXT, ENTRY) },
    ])
  })

  test('Go part by part asks each item in turn, and the last answer ends it with the roles of every item', () => {
    const entry = handoutEnter(ENTRY, ITEMS, ROLES, DISMISSED)
    if (entry.kind !== 'ask') throw new Error('no entry question')
    const first = handoutAnswer(entry.cursor, 'Go part by part')
    if (first.kind !== 'ask') throw new Error('no first item question')
    const context = ITEMS[0] === undefined ? null : withPane(ITEMS[0].context, ITEMS[0])
    const typed = { options: ['Yes', 'No'], header: 'Topic 1/2', acceptsTyped: true, context }
    expect([first.question, first.spec]).toEqual([itemAsked(ITEMS[0]), typed])
    const second = handoutAnswer(first.cursor, 'Yes')
    if (second.kind !== 'ask') throw new Error('no second item question')
    const done = handoutAnswer(second.cursor, 'tl')
    expect(done.kind === 'done' && done.outcome.kind === 'given' ? [...done.outcome.given.entries()] : done).toEqual([
      ['T1', ['security']],
      ['T2', ['tl']],
    ])
  })

  test('every entry and item puts its own context in its dialog spec (D-203, D-300)', () => {
    const parts: AskContext = { ...ENTRY_CONTEXT, lines: ['2 topics from 1 file'] }
    const topic: AskContext = { ...topicContextOf('Topic 1 of 2'), lines: ['Security rules only'] }
    const first = { ...topicItem('T1', 'Security rules', 'Topic 1/2', ['security']), context: topic }
    const entry = handoutEnter({ ...ENTRY, context: parts }, [first, ...ITEMS.slice(1)], ROLES, DISMISSED)
    if (entry.kind !== 'ask') throw new Error('no entry question')
    const one = handoutAnswer(entry.cursor, 'Go part by part')
    if (one.kind !== 'ask') throw new Error('no first item question')
    const two = handoutAnswer(one.cursor, 'Yes')
    if (two.kind !== 'ask') throw new Error('no second item question')
    const second = ITEMS[1] === undefined ? null : withPane(ITEMS[1].context, ITEMS[1])
    const contexts = [entry.spec.context, one.spec.context, two.spec.context]
    expect(contexts).toEqual([withPane(parts, ENTRY), withPane(topic, first), second])
    expect([entry.question, one.question]).toEqual([ENTRY_ASKED, itemAsked(first)])
  })

  test('the summary of its context takes the place of the context line in what a pane surface asks (D-310)', () => {
    const topic: AskContext = { ...topicContextOf('Topic 1 of 2'), summary: 'Recommended: security' }
    const first = { ...topicItem('T1', 'Security rules', 'Topic 1/2', ['security']), context: topic }
    const parts: AskContext = { ...ENTRY_CONTEXT, summary: '2 topics' }
    const entry = handoutEnter({ ...ENTRY, context: parts }, [first], ROLES, DISMISSED)
    if (entry.kind !== 'ask') throw new Error('no entry question')
    const one = handoutAnswer(entry.cursor, 'Go part by part')
    if (one.kind !== 'ask') throw new Error('no item question')
    const entryPane = { asked: ENTRY_ASKED, text: withContext(ENTRY.question, '2 topics') }
    const itemPane = { asked: itemAsked(first), text: withContext(first.question, 'Recommended: security') }
    const contexts = [entry.spec.context, one.spec.context]
    expect(contexts).toEqual([{ ...parts, pane: entryPane }, { ...topic, pane: itemPane }])
  })
})

describe('Accept only where something is recommended (D-279)', () => {
  /** ITEMS with no recommendation at all. */
  const UNRECOMMENDED: readonly HandoutItem[] = ITEMS.map(item => ({ ...item, recommended: [] }))

  test('an entry whose items all have no recommendation offers only one by one and the whole group', () => {
    const { specs } = handedOut(UNRECOMMENDED, [])
    expect(specs[0]?.options).toEqual(['Go part by part', 'Whole files'])
  })

  test('Accept typed at such an entry is refused like any label it does not list', () => {
    const { asked, end } = handedOut(UNRECOMMENDED, ['Accept recommendations', 'Whole files'])
    expect(asked[1]).toBe(`'Accept recommendations' isn't one of: "Go part by part", "Whole files".\n${ENTRY_ASKED}`)
    expect(end).toEqual({ kind: 'done', outcome: { kind: 'whole' } })
  })

  test('with one recommended item the entry offers all three answers in their order', () => {
    const { specs } = handedOut(ITEMS, [])
    expect(specs[0]?.options).toEqual(['Accept recommendations', 'Go part by part', 'Whole files'])
  })
})

describe('handoutItemsEnter (D-251)', () => {
  test('asks the first item with no entry question, then each item; the outcome gives each its roles', () => {
    let next = handoutItemsEnter(ITEMS, ROLES, DISMISSED)
    const asked: string[] = []
    for (const answer of ['Yes', 'tl']) {
      if (next.kind !== 'ask') break
      asked.push(next.question)
      next = handoutAnswer(next.cursor, answer)
    }
    expect(asked).toEqual([
      withContext(ITEMS[0]?.question ?? '', ITEMS[0]?.contextLine ?? ''),
      withContext(ITEMS[1]?.question ?? '', ITEMS[1]?.contextLine ?? ''),
    ])
    const given = new Map([
      ['T1', ['security']],
      ['T2', ['tl']],
    ])
    expect(next).toEqual({ kind: 'done', outcome: { kind: 'given', given } })
  })

  test('with no item it is done at once and gives none; a dismissal cancels with its reason', () => {
    const empty = { kind: 'done', outcome: { kind: 'given', given: new Map() } }
    expect(handoutItemsEnter([], ROLES, DISMISSED)).toEqual(empty)
    const first = handoutItemsEnter(ITEMS, ROLES, DISMISSED)
    const end = first.kind === 'ask' ? handoutAnswer(first.cursor, null) : first
    expect(end).toEqual({ kind: 'cancelled', reason: DISMISSED })
  })
})
