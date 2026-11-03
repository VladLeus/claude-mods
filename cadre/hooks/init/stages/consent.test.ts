import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_LOCATIONS, driven, stateAt } from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import { nextStage } from '../machine'
import { cancelledReply } from '../replies'
import {
  CLAUDE_JSON_CONTEXT,
  CLAUDE_JSON_OPTIONS,
  CLAUDE_JSON_QUESTION,
  CONSENT_DISMISSED_REASON,
  consentStage,
} from './consent'

/** What the scans after the consent are entered with: the session's locations. */
const CONSENT_DRAFT = { locations: DEFAULT_LOCATIONS }

/** The consent question as every surface but a pane asks it: the question, then its context line (D-136). */
const CONSENT_ASKED = withContext(CLAUDE_JSON_QUESTION, CLAUDE_JSON_CONTEXT)

/** The summary of the consent's context: the one file it reads, and only the MCP server names in it (D-310). */
const CONSENT_SUMMARY = '1 file, MCP server names only'

/**
 * The dialog spec of the consent: its two answers, its chip and its own context, the one line stating what is read
 * (D-287, D-300), with its summary, which a pane surface asks under the question (D-310).
 */
const CONSENT_SPEC = {
  options: CLAUDE_JSON_OPTIONS,
  header: 'claude.json',
  context: {
    title: 'Read ~/.claude.json?',
    lines: [CLAUDE_JSON_CONTEXT],
    kind: 'consent',
    summary: CONSENT_SUMMARY,
    pane: { asked: CONSENT_ASKED, text: withContext(CLAUDE_JSON_QUESTION, CONSENT_SUMMARY) },
  },
}

describe('runInit', () => {
  test('consentStage accepts yes or no; a dismissal or unknown answers cancel with their reasons (A1)', () => {
    const start = consentStage.enter(stateAt('consent', CONSENT_DRAFT))
    const yes = driven(start, ['Yes, read names only'])
    expect(yes.state.draft.readUserMcp).toBe(true)
    expect(yes.asked).toEqual([CONSENT_ASKED])
    expect(yes.specs).toEqual([CONSENT_SPEC])
    expect(driven(start, [' no, SKIP it ']).state.draft.readUserMcp).toBe(false)
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], CONSENT_DISMISSED_REASON],
      [['maybe', 'maybe', 'maybe'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = driven(start, answers)
      expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(reason) })
      expect(run.outputs).toEqual([{ kind: 'log', text: reason }])
    }
    expect(CONSENT_DISMISSED_REASON).toBe('The ~/.claude.json question was dismissed or not answered.')
  })
})

describe('consent declines first (G-02-11)', () => {
  test('the ~/.claude.json question lists No, skip it first, so a quick Submit declines; labels unchanged', () => {
    expect(CLAUDE_JSON_OPTIONS[0]).toBe('No, skip it')
    expect([...CLAUDE_JSON_OPTIONS].sort()).toEqual(['No, skip it', 'Yes, read names only'])
  })

  test('option 0 of the ~/.claude.json question declines and option 1 consents (T-02-51)', () => {
    const [first = '', second = ''] = CLAUDE_JSON_OPTIONS
    const start = consentStage.enter(stateAt('consent', CONSENT_DRAFT))
    expect(driven(start, [first]).state.draft.readUserMcp).toBe(false)
    expect(driven(start, [second]).state.draft.readUserMcp).toBe(true)
  })
})

describe('the consent stage (D-230)', () => {
  test('consentStage asks the ~/.claude.json question with its context and chip; the open question is that ask', () => {
    const state = consentStage.enter(stateAt('consent', CONSENT_DRAFT))
    const ask = { question: CONSENT_ASKED, spec: CONSENT_SPEC }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
  })

  test('the consent carries a one-line context: what is read, and only after a yes (D-287, D-300)', () => {
    const state = consentStage.enter(stateAt('consent', CONSENT_DRAFT))
    const context = state.openQuestion?.spec.context
    const shown = [context?.title, context?.lines, context?.kind]
    expect(shown).toEqual(['Read ~/.claude.json?', [CLAUDE_JSON_CONTEXT], 'consent'])
  })

  test('an answer finishes the stage with the consent in the draft and enters the scans with it', () => {
    const state = consentStage.enter(stateAt('consent', CONSENT_DRAFT))
    const next = nextStage(state, { kind: 'answer', text: 'Yes, read names only' })
    expect(next.stage).toBe('scan')
    expect(next.draft.readUserMcp).toBe(true)
    expect(next.effect).toEqual({ kind: 'io', call: { id: 'scan', locations: DEFAULT_LOCATIONS, readUserMcp: true } })
  })
})
