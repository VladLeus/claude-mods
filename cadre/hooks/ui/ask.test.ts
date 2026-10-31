import { describe, expect, test } from 'claude-code/testing'

import type { GitPolicy } from '../../types'
import { CLAUDE_JSON_OPTIONS, CONSENT_DISMISSED_REASON } from '../init/stages/consent'
import { FRAMEWORK_DISMISSED_REASON } from '../init/stages/frameworks'
import { GIT_POLICY_OPTIONS, GIT_POLICY_QUESTION, parseGitPolicy } from '../init/stages/policy'
import { REVIEW_DISMISSED_REASON } from '../init/stages/review'
import { BIDI_OVERRIDE, memIo, memWorld } from '../testkit'
import {
  ASK_HEADERS,
  askChoice,
  choiceAnswer,
  MAX_ASKS,
  NO_USABLE_ANSWER_REASON,
  orList,
  PANE_TITLES,
  quotedLabels,
  refusalLine,
  showBlock,
  withContext,
} from './ask'
import type { ChoiceAsk } from './ask'

/** The question of the refuse cases: its parser takes only the answer `ok`. */
const QUESTION = 'Pick one?'

/** The answers the question takes in words, as the default refusal lists them. */
const ACCEPTS = '"ok"'

/** The parser of the question: `ok` is the only answer it takes. */
function parseOk(answer: string): string | null {
  return answer === 'ok' ? answer : null
}

/** The question as an askChoice ask, with no refuse of its own. */
const OK_ASK = { question: QUESTION, spec: { options: ['ok', 'not ok'] }, parse: parseOk, accepts: ACCEPTS }

/** A refuse text a test can tell apart from refusalLine: `R:` and the answer. */
function refuseWith(answer: string): string {
  return `R:${answer}`
}

describe('askChoice refuse (N5)', () => {
  test('an answer the parser does not take puts its refuse text on top of the next ask', async () => {
    const run = memIo(memWorld({}), ['bad', 'ok'])
    const ask = { ...OK_ASK, refuse: refuseWith }
    expect(await askChoice(run.io, ask)).toEqual({ kind: 'answered', value: 'ok' })
    expect(run.asked).toEqual([QUESTION, `R:bad\n${QUESTION}`])
  })

  test(`${MAX_ASKS} refused answers give exhausted after ${MAX_ASKS} asks, each led by the answer before`, async () => {
    const run = memIo(memWorld({}), ['a', 'b', 'c', 'ok'])
    const ask = { ...OK_ASK, refuse: refuseWith }
    expect(await askChoice(run.io, ask)).toEqual({ kind: 'exhausted' })
    expect(run.asked).toEqual([QUESTION, `R:a\n${QUESTION}`, `R:b\n${QUESTION}`])
    expect(run.asked).toHaveLength(MAX_ASKS)
  })

  test('a dismissal on the first ask gives dismissed after one ask, and refuse is never called', async () => {
    const refused: string[] = []
    const run = memIo(memWorld({}), [])
    const ask = {
      ...OK_ASK,
      refuse: (answer: string) => {
        refused.push(answer)

        return refuseWith(answer)
      },
    }
    expect(await askChoice(run.io, ask)).toEqual({ kind: 'dismissed' })
    expect(run.asked).toEqual([QUESTION])
    expect(refused).toEqual([])
  })

  test('without a refuse, the next ask starts with the refusalLine of the answer, as before', async () => {
    const run = memIo(memWorld({}), ['bad', 'ok'])
    expect(await askChoice(run.io, OK_ASK)).toEqual({ kind: 'answered', value: 'ok' })
    expect(run.asked).toEqual([QUESTION, `${refusalLine('bad', ACCEPTS)}\n${QUESTION}`])
  })
})

describe('init helpers', () => {
  test('askChoice gives dismissed after exactly two asks for an invalid answer followed by a dismissal', async () => {
    const run = memIo(memWorld({}), ['nonsense'])
    const ask = { question: 'Git policy?', spec: { options: GIT_POLICY_OPTIONS }, parse: parseGitPolicy, accepts: 'x' }
    expect(await askChoice(run.io, ask)).toEqual({ kind: 'dismissed' })
    expect(run.asked).toEqual(['Git policy?', "'nonsense' isn't one of: x.\nGit policy?"])
  })
})

describe('init pane (G-02-1)', () => {
  test('PANE_TITLES names the bold title of each kind of block, and is frozen (D-133)', () => {
    expect(PANE_TITLES).toEqual({
      scan: 'Scan',
      history: 'Session history',
      roles: 'Roles',
      recommendations: 'Recommendations',
      review: 'Review',
      env: 'Env variables',
      notes: 'Notes',
      instructions: 'Instruction parts',
      skills: 'Your own skills',
      improver: 'Improver changes',
    })
    expect(Object.isFrozen(PANE_TITLES)).toBe(true)
  })
})

describe('refusal re-ask (G-02-6b)', () => {
  /** The git policy question as an askChoice ask, with the words its refusal lists. */
  const POLICY: ChoiceAsk<GitPolicy> = {
    question: GIT_POLICY_QUESTION,
    spec: { options: GIT_POLICY_OPTIONS },
    parse: parseGitPolicy,
    accepts: 'definitions, all, ignore',
  }
  /** The refusal of the framework question when GSD and superpowers are offered: the user's own example (D-136). */
  const BOTH_REFUSAL = "'both' isn't one of: GSD, superpowers, none - a role runs one framework."

  test('askChoice gives the answer parse takes as answered, asked once with the question as it is', async () => {
    const run = memIo(memWorld({}), ['Commit all'])
    expect(await askChoice(run.io, POLICY)).toEqual({ kind: 'answered', value: 'all' })
    expect(run.asked).toEqual([GIT_POLICY_QUESTION])
    expect(run.specs).toEqual([POLICY.spec])
  })

  test('askChoice gives dismissed at once for a dismissal, and asks nothing after it', async () => {
    const run = memIo(memWorld({}), [])
    expect(await askChoice(run.io, POLICY)).toEqual({ kind: 'dismissed' })
    expect(run.asked).toEqual([GIT_POLICY_QUESTION])
  })

  test('an answer parse does not take is asked again: the refusal on the first line, then the question', async () => {
    const run = memIo(memWorld({}), ['nonsense', 'Commit all'])
    expect(await askChoice(run.io, POLICY)).toEqual({ kind: 'answered', value: 'all' })
    expect(run.asked).toEqual([
      GIT_POLICY_QUESTION,
      `'nonsense' isn't one of: definitions, all, ignore.\n${GIT_POLICY_QUESTION}`,
    ])
    expect(run.logged).toEqual([])
  })

  test(`${MAX_ASKS} answers parse does not take give exhausted, with no fourth ask (A1)`, async () => {
    const run = memIo(memWorld({}), ['a', 'b', 'c', 'Commit all'])
    expect(await askChoice(run.io, POLICY)).toEqual({ kind: 'exhausted' })
    expect(run.asked).toEqual([
      GIT_POLICY_QUESTION,
      `'a' isn't one of: definitions, all, ignore.\n${GIT_POLICY_QUESTION}`,
      `'b' isn't one of: definitions, all, ignore.\n${GIT_POLICY_QUESTION}`,
    ])
    expect(MAX_ASKS).toBe(3)
  })

  test('an empty answer is refused with its own words, and is never a choice', async () => {
    const run = memIo(memWorld({}), ['   ', 'ignore'])
    expect(await askChoice(run.io, POLICY)).toEqual({ kind: 'answered', value: 'ignore' })
    expect(run.asked[1]).toBe(`An empty answer isn't one of: definitions, all, ignore.\n${GIT_POLICY_QUESTION}`)
    for (const answer of ['', '   ', String.fromCharCode(7)]) {
      expect([answer, refusalLine(answer, 'x')]).toEqual([answer, "An empty answer isn't one of: x."])
    }
  })

  test("refusalLine says why: the user's own example for both at a framework question", () => {
    expect(refusalLine('both', 'GSD, superpowers, none - a role runs one framework')).toBe(BOTH_REFUSAL)
    expect(refusalLine('  both  ', 'x')).toBe("'both' isn't one of: x.")
  })

  test('the typed answer is trimmed, cleaned and cut to 40 code points, so it cannot forge a line (T-02-54)', () => {
    const escape = String.fromCharCode(27)
    const hostile = `a\nwarning: forged${escape}[2J${BIDI_OVERRIDE}b`
    const line = refusalLine(hostile, 'x')
    expect(line).toBe("'awarning: forged[2Jb' isn't one of: x.")
    expect(line.includes('\n') || line.includes(escape) || line.includes(BIDI_OVERRIDE)).toBe(false)
    expect(refusalLine('y'.repeat(60), 'x')).toBe(`'${'y'.repeat(39)}…' isn't one of: x.`)
  })

  test('quotedLabels puts each option label in double quotes, joined with a comma', () => {
    expect(quotedLabels(['Same for all roles', 'Per role'])).toBe('"Same for all roles", "Per role"')
    expect(quotedLabels(CLAUDE_JSON_OPTIONS)).toBe('"No, skip it", "Yes, read names only"')
    expect(quotedLabels([])).toBe('')
  })

  test('orList names one word alone, two with or, and more with commas before the or', () => {
    expect(orList(['a'])).toBe('a')
    expect(orList(['a', 'b'])).toBe('a or b')
    expect(orList(['a', 'b', 'c'])).toBe('a, b or c')
  })

  test('running out of tries has its own reason, distinct from every dismissed reason (D-136)', () => {
    expect(NO_USABLE_ANSWER_REASON).toBe('No usable answer after 3 tries.')
    const dismissed = [CONSENT_DISMISSED_REASON, FRAMEWORK_DISMISSED_REASON, REVIEW_DISMISSED_REASON]
    expect(dismissed).not.toContain(NO_USABLE_ANSWER_REASON)
  })
})

describe('question chips (G-02-3c)', () => {
  test('ASK_HEADERS names the chip of each kind of question, at most 12 characters each, and is frozen', () => {
    expect(ASK_HEADERS).toEqual({
      claudeJson: 'claude.json',
      history: 'History',
      roles: 'Roles',
      adjust: 'Adjust',
      describe: 'Describe',
      framework: 'Framework',
      security: 'Security',
      duration: 'Duration',
      model: 'Model',
      mcp: 'MCP',
      skills: 'Skills',
      memory: 'Memory',
      instructions: 'Instructions',
      env: 'Env',
      launch: 'Launch',
      launchDir: 'Launch dir',
      gitPolicy: 'Git policy',
      review: 'Review',
      conflict: 'Conflict',
      improver: 'Improver',
    })
    expect(Object.isFrozen(ASK_HEADERS)).toBe(true)
    expect(Object.values(ASK_HEADERS).filter(chip => Array.from(chip).length > 12)).toEqual([])
  })
})

describe('question context lines (G-02-1)', () => {
  test('withContext puts the context, cleaned and cut at 400 code points, on the next line (T-02-55, N2)', () => {
    expect(withContext('Use these roles?', 'Proposed: PM (pm).')).toBe('Use these roles?\nProposed: PM (pm).')
    expect(withContext('Q?', `a\nb${BIDI_OVERRIDE}c`)).toBe('Q?\nabc')
    expect(withContext('Q?', 'x'.repeat(400))).toBe(`Q?\n${'x'.repeat(400)}`)
    expect(withContext('Q?', 'x'.repeat(500))).toBe(`Q?\n${'x'.repeat(399)}…`)
  })
})

describe('choiceAnswer (D-230)', () => {
  /** Why the question of the refuse cases is cancelled when it is dismissed. */
  const DISMISSED = 'The pick question was dismissed.'

  /** The question of the refuse cases as a pure stage asks it: OK_ASK with the reason a dismissal cancels with. */
  const STAGE_ASK = { ...OK_ASK, dismissedReason: DISMISSED }

  test('choiceAnswer gives the value of an answer the parser takes', () => {
    expect(choiceAnswer(STAGE_ASK, { tries: 1 }, 'ok')).toEqual({ kind: 'value', value: 'ok' })
    expect(choiceAnswer(STAGE_ASK, { tries: MAX_ASKS }, 'ok')).toEqual({ kind: 'value', value: 'ok' })
  })

  test('an answer it cannot read asks again with the refusal or the own refuse text on top, and the next try', () => {
    expect(choiceAnswer(STAGE_ASK, { tries: 1 }, 'nope')).toEqual({
      kind: 'again',
      question: `${refusalLine('nope', ACCEPTS)}\n${QUESTION}`,
      sub: { tries: 2 },
    })
    expect(choiceAnswer({ ...STAGE_ASK, refuse: refuseWith }, { tries: 2 }, 'nope')).toEqual({
      kind: 'again',
      question: `R:nope\n${QUESTION}`,
      sub: { tries: 3 },
    })
  })

  test('the MAX_ASKS-th answer it cannot read cancels with NO_USABLE_ANSWER_REASON', () => {
    const exhausted = { kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON }
    expect(choiceAnswer(STAGE_ASK, { tries: MAX_ASKS }, 'nope')).toEqual(exhausted)
    expect(choiceAnswer(STAGE_ASK, { tries: MAX_ASKS }, '')).toEqual(exhausted)
  })

  test("a dismissal cancels with the question's own dismissed reason at any try", () => {
    expect(choiceAnswer(STAGE_ASK, { tries: 1 }, null)).toEqual({ kind: 'cancelled', reason: DISMISSED })
    expect(choiceAnswer(STAGE_ASK, { tries: MAX_ASKS }, null)).toEqual({ kind: 'cancelled', reason: DISMISSED })
  })
})

describe('showBlock (#163)', () => {
  test('each line is cleaned and kept whole, never cut at 240 code points; the pane wraps it (D-231)', async () => {
    const run = memIo(memWorld({}), [])
    const wide = 'w'.repeat(300)
    await showBlock(run.io, 'notes', [wide, `a${BIDI_OVERRIDE}b`])
    expect(run.shown.map(block => block.lines)).toEqual([[wide, 'ab']])
  })
})
