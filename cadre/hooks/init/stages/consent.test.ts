import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_LOCATIONS, memIo, memWorld, stateAt } from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import { nextStage } from '../machine'
import {
  CLAUDE_JSON_CONTEXT,
  CLAUDE_JSON_OPTIONS,
  CLAUDE_JSON_QUESTION,
  CONSENT_DISMISSED_REASON,
  consentStage,
  consentStep,
} from './consent'

/** What the scans after the consent are entered with: the session's locations. */
const CONSENT_DRAFT = { locations: DEFAULT_LOCATIONS }

describe('runInit', () => {
  test('consentStep accepts yes or no; a dismissal or unknown answers cancel with their reasons (A1)', async () => {
    const yes = memIo(memWorld({}), ['Yes, read names only'])
    expect(await consentStep(yes.io)).toEqual({ kind: 'accepted', value: true })
    expect(yes.asked).toEqual([withContext(CLAUDE_JSON_QUESTION, CLAUDE_JSON_CONTEXT)])
    expect(yes.specs).toEqual([{ options: CLAUDE_JSON_OPTIONS, header: 'claude.json' }])
    expect(await consentStep(memIo(memWorld({}), [' no, SKIP it ']).io)).toEqual({ kind: 'accepted', value: false })
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], CONSENT_DISMISSED_REASON],
      [['maybe', 'maybe', 'maybe'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(memWorld({}), answers)
      expect(await consentStep(run.io)).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(CONSENT_DISMISSED_REASON).toBe('The ~/.claude.json question was dismissed or not answered.')
  })
})

describe('consent declines first (G-02-11)', () => {
  test('the ~/.claude.json question lists No, skip it first, so a quick Submit declines; labels unchanged', () => {
    expect(CLAUDE_JSON_OPTIONS[0]).toBe('No, skip it')
    expect([...CLAUDE_JSON_OPTIONS].sort()).toEqual(['No, skip it', 'Yes, read names only'])
  })

  test('option 0 of the ~/.claude.json question declines and option 1 consents (T-02-51)', async () => {
    const [first = '', second = ''] = CLAUDE_JSON_OPTIONS
    expect(await consentStep(memIo(memWorld({}), [first]).io)).toEqual({ kind: 'accepted', value: false })
    expect(await consentStep(memIo(memWorld({}), [second]).io)).toEqual({ kind: 'accepted', value: true })
  })
})

describe('the consent stage (D-230)', () => {
  test('consentStage asks the ~/.claude.json question with its context and chip; the open question is that ask', () => {
    const state = consentStage.enter(stateAt('consent', CONSENT_DRAFT))
    const ask = {
      question: withContext(CLAUDE_JSON_QUESTION, CLAUDE_JSON_CONTEXT),
      spec: { options: CLAUDE_JSON_OPTIONS, header: 'claude.json' },
    }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
  })

  test('an answer finishes the stage with the consent in the draft and enters the scans with it', () => {
    const state = consentStage.enter(stateAt('consent', CONSENT_DRAFT))
    const next = nextStage(state, { kind: 'answer', text: 'Yes, read names only' })
    expect(next.stage).toBe('scan')
    expect(next.draft.readUserMcp).toBe(true)
    expect(next.effect).toEqual({ kind: 'io', call: { id: 'scan', locations: DEFAULT_LOCATIONS, readUserMcp: true } })
  })
})
