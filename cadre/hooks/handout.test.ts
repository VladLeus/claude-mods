import { describe, expect, test } from 'claude-code/testing'

import type { RoleSpec } from '../types'
import { NO_USABLE_ANSWER_REASON, withContext } from './ask'
import type { StepResult } from './ask'
import { handoutStep } from './handout'
import type { HandoutEntry, HandoutItem, HandoutOutcome } from './handout'
import { memIo, memWorld, templateRole } from './testkit'

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
