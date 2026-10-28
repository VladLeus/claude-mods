import { describe, expect, test } from 'claude-code/testing'

import type { RoleSpec } from '../types'
import { handoutStep } from './handout'
import type { HandoutEntry, HandoutItem, HandoutOutcome } from './handout'
import { memIo, memWorld, templateRole } from './testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from './ui/ask'
import type { StepResult } from './ui/ask'

/** The team of the hand-out cases: PM, Team Lead and Security, in that order. */
const ROLES: readonly RoleSpec[] = [templateRole('pm'), templateRole('tl'), templateRole('security')]

/** The entry question of the cases, with the three labels of the instruction parts flow (G-02-1f). */
const ENTRY: HandoutEntry = {
  question: 'How do you want to hand out the instruction parts?',
  context: '2 topics from 1 file; the pane shows each with the roles it is recommended for.',
  header: 'Instructions',
  accept: 'Accept recommendations',
  oneByOne: 'Go part by part',
  whole: 'Whole files',
}

/** Two items: the first recommended to Security, the second to no role. */
const ITEMS: readonly HandoutItem[] = [
  {
    id: 'T1',
    question: 'Which roles get "Security rules"?',
    context: 'How secrets stay out of the repo.',
    header: 'Topic 1/2',
    recommended: ['security'],
  },
  {
    id: 'T2',
    question: 'Which roles get "Git and commits"?',
    context: 'How commits are made.',
    header: 'Topic 2/2',
    recommended: [],
  },
]

/** The reason the cases cancel with when the entry question is dismissed. */
const DISMISSED = 'A question on which roles get instruction parts was dismissed or not answered.'

/** The entry question as it is asked: the question, then its context line (D-136). */
const ENTRY_ASKED = withContext(ENTRY.question, ENTRY.context)

/** The given map of an outcome as entries, so a test compares plain arrays; null for whole or a cancel. */
function givenOf(result: StepResult<HandoutOutcome>): (readonly [string, readonly string[]])[] | null {
  if (result.kind === 'cancelled' || result.value.kind === 'whole') return null

  return [...result.value.given.entries()]
}

describe('handoutStep', () => {
  test('asks the entry question once, with its context line, the three answers in order and its chip', async () => {
    const run = memIo(memWorld({}), ['Accept recommendations'])
    await handoutStep(run.io, ENTRY, ITEMS, ROLES, DISMISSED)
    expect(run.asked).toEqual([ENTRY_ASKED])
    expect(run.specs).toEqual([
      { options: ['Accept recommendations', 'Go part by part', 'Whole files'], header: 'Instructions' },
    ])
    expect(run.logged).toEqual([])
  })

  test('Accept gives each item its recommended roles, one with none to no role, and asks nothing more', async () => {
    const run = memIo(memWorld({}), ['Accept recommendations'])
    const result = await handoutStep(run.io, ENTRY, ITEMS, ROLES, DISMISSED)
    expect(givenOf(result)).toEqual([
      ['T1', ['security']],
      ['T2', []],
    ])
    expect(run.asked).toHaveLength(1)
  })

  test('the entry answers are read trimmed and in any case', async () => {
    const accept = await handoutStep(memIo(memWorld({}), ['  accept RECOMMENDATIONS ']).io, ENTRY, ITEMS, ROLES, '')
    expect(givenOf(accept)).toEqual([
      ['T1', ['security']],
      ['T2', []],
    ])
    const whole = await handoutStep(memIo(memWorld({}), [' whole files']).io, ENTRY, ITEMS, ROLES, '')
    expect(whole).toEqual({ kind: 'accepted', value: { kind: 'whole' } })
  })

  test('Whole gives the whole-group outcome and asks nothing more', async () => {
    const run = memIo(memWorld({}), ['Whole files'])
    expect(await handoutStep(run.io, ENTRY, ITEMS, ROLES, DISMISSED)).toEqual({
      kind: 'accepted',
      value: { kind: 'whole' },
    })
    expect(run.asked).toEqual([ENTRY_ASKED])
  })

  test('a dismissed entry question cancels with the reason it is given, and asks nothing more (A1)', async () => {
    const run = memIo(memWorld({}), [])
    expect(await handoutStep(run.io, ENTRY, ITEMS, ROLES, DISMISSED)).toEqual({
      kind: 'cancelled',
      reason: DISMISSED,
    })
    expect(run.asked).toEqual([ENTRY_ASKED])
    expect(run.logged).toEqual([])
  })

  test('three answers it cannot read cancel with no usable answer; the refusal lists the three answers', async () => {
    const run = memIo(memWorld({}), ['maybe', 'maybe', 'maybe', 'Accept recommendations'])
    expect(await handoutStep(run.io, ENTRY, ITEMS, ROLES, DISMISSED)).toEqual({
      kind: 'cancelled',
      reason: NO_USABLE_ANSWER_REASON,
    })
    const refusal = `'maybe' isn't one of: "Accept recommendations", "Go part by part", "Whole files".`
    expect(run.asked).toEqual([ENTRY_ASKED, `${refusal}\n${ENTRY_ASKED}`, `${refusal}\n${ENTRY_ASKED}`])
  })

  test('the roles and items it is given never change', async () => {
    const before = JSON.stringify([ROLES, ITEMS])
    await handoutStep(memIo(memWorld({}), ['Accept recommendations']).io, ENTRY, ITEMS, ROLES, DISMISSED)
    expect(JSON.stringify([ROLES, ITEMS])).toBe(before)
  })
})

/** A topic item with this id, title, chip and recommended roles; its context line names the title. */
function topicItem(id: string, title: string, header: string, recommended: readonly string[]): HandoutItem {
  return { id, question: `Which roles get "${title}"?`, context: `About ${title}.`, header, recommended }
}

/** Three items: the first recommended to Security, the second to the Team Lead, the third to no role. */
const THREE_ITEMS: readonly HandoutItem[] = [
  topicItem('T1', 'Security rules', 'Topic 1/3', ['security']),
  topicItem('T2', 'Git and commits', 'Topic 2/3', ['tl']),
  topicItem('T3', 'Release notes', 'Topic 3/3', []),
]

/** An item question as it is asked: the question, then its context line (D-136). */
function itemAsked(item: HandoutItem | undefined): string {
  return item === undefined ? 'missing item' : withContext(item.question, item.context)
}

/** The refusal on top of an item question asked again after the answer `cto` (D-136). */
const CTO_REFUSAL = `'cto' isn't one of: "Yes", "No", or role ids from: pm, tl, security.`

describe('handoutStep one by one', () => {
  test('Go part by part asks each item once, in order, with its context line, its chip and Yes / No', async () => {
    const run = memIo(memWorld({}), ['Go part by part', 'Yes', 'No'])
    await handoutStep(run.io, ENTRY, ITEMS, ROLES, DISMISSED)
    expect(run.asked).toEqual([ENTRY_ASKED, itemAsked(ITEMS[0]), itemAsked(ITEMS[1])])
    expect(run.specs.slice(1)).toEqual([
      { options: ['Yes', 'No'], header: 'Topic 1/2' },
      { options: ['Yes', 'No'], header: 'Topic 2/2' },
    ])
    expect(run.logged).toEqual([])
  })

  test('Yes gives an item its recommended roles, No none, and a typed role list gives that list', async () => {
    const run = memIo(memWorld({}), ['Go part by part', 'Yes', 'No', 'tl, security'])
    const result = await handoutStep(run.io, ENTRY, THREE_ITEMS, ROLES, DISMISSED)
    expect(givenOf(result)).toEqual([
      ['T1', ['security']],
      ['T2', []],
      ['T3', ['tl', 'security']],
    ])
  })

  test('Yes on an item recommended to no role gives it none; none and all work as they do elsewhere', async () => {
    const run = memIo(memWorld({}), ['Go part by part', ' NO ', 'all', 'yes'])
    const result = await handoutStep(run.io, ENTRY, THREE_ITEMS, ROLES, DISMISSED)
    expect(givenOf(result)).toEqual([
      ['T1', []],
      ['T2', ['pm', 'tl', 'security']],
      ['T3', []],
    ])
    const none = memIo(memWorld({}), ['Go part by part', 'None', 'Yes'])
    expect(givenOf(await handoutStep(none.io, ENTRY, ITEMS, ROLES, DISMISSED))).toEqual([
      ['T1', []],
      ['T2', []],
    ])
  })

  test('an answer it cannot read is asked again with why on top: Yes, No or the role ids', async () => {
    const run = memIo(memWorld({}), ['Go part by part', 'cto', 'Security', 'No'])
    const result = await handoutStep(run.io, ENTRY, ITEMS, ROLES, DISMISSED)
    expect(givenOf(result)).toEqual([
      ['T1', ['security']],
      ['T2', []],
    ])
    expect(run.asked.slice(1, 3)).toEqual([itemAsked(ITEMS[0]), `${CTO_REFUSAL}\n${itemAsked(ITEMS[0])}`])
  })

  test('a dismissed item cancels with the reason given; three unreadable answers with no usable answer', async () => {
    const dismissed = memIo(memWorld({}), ['Go part by part', 'Yes'])
    expect(await handoutStep(dismissed.io, ENTRY, ITEMS, ROLES, DISMISSED)).toEqual({
      kind: 'cancelled',
      reason: DISMISSED,
    })
    expect(dismissed.asked).toHaveLength(3)
    const exhausted = memIo(memWorld({}), ['Go part by part', 'cto', 'cto', 'cto', 'Yes'])
    expect(await handoutStep(exhausted.io, ENTRY, ITEMS, ROLES, DISMISSED)).toEqual({
      kind: 'cancelled',
      reason: NO_USABLE_ANSWER_REASON,
    })
    expect(exhausted.asked).toHaveLength(4)
  })

  test('with no item, Go part by part asks nothing more and gives every item, none, its roles', async () => {
    const run = memIo(memWorld({}), ['Go part by part'])
    expect(givenOf(await handoutStep(run.io, ENTRY, [], ROLES, DISMISSED))).toEqual([])
    expect(run.asked).toEqual([ENTRY_ASKED])
  })
})
