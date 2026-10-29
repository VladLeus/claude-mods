import { describe, expect, test } from 'claude-code/testing'

import type { Plan } from '../../../types'
import type { Gathered } from '../../scan/gather'
import { scopeCardLines } from '../../scope/card'
import { scopesFor } from '../../team'
import { cardOf, EMPTY_FACTS, emptySetupScan, repoScan, session, templateRole, withFramework } from '../../testkit'
import type { ReviewItem } from '../flow'
import {
  cardLines,
  improverRunLine,
  MAX_REVIEW_ROUNDS,
  parseReviewItem,
  PRIVATE_FILES_HEADING,
  privateFilesRow,
  REVIEW_DISMISSED_REASON,
  REVIEW_OPTIONS,
  REVIEW_QUESTION,
  REVIEW_ROUNDS_REASON,
  REVIEW_TYPE_HINT,
  reviewContextLine,
  reviewQuestion,
} from './review'

describe('what Confirm writes outside the repo (02-GAPS-B3 S4)', () => {
  test('the private files row, its heading and the improver line are fixed', () => {
    expect(privateFilesRow('be')).toBe(
      '    private files: <config dir>/cadre/<repo>-<hash8>/be/instructions/CLAUDE.md and instructions.json ' +
        '(outside the repo, never committed)',
    )
    expect(PRIVATE_FILES_HEADING).toBe('Private files per role (written after Confirm):')
    expect([improverRunLine(1), improverRunLine(2)]).toEqual([
      'After Confirm, claude-md-improver runs on up to 1 built file (claude -p, acceptEdits, up to 5 minutes each); ' +
        'you accept or keep each change.',
      'After Confirm, claude-md-improver runs on up to 2 built files (claude -p, acceptEdits, up to 5 minutes each); ' +
        'you accept or keep each change.',
    ])
  })
})

describe('question context lines (G-02-1)', () => {
  test('reviewContextLine is the plan summary, the git policy line and the launcher line', () => {
    const plan: Plan = { ops: [{ kind: 'create', path: '.cadre/bin/be', mode: 'exec', note: null }], warnings: [] }
    expect(reviewContextLine(plan, 'definitions', { kind: 'git-root' })).toBe(
      'Summary: 1 create, 0 change, 0 leave, 0 conflict, 0 hunks; ' +
        'Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root',
    )
    expect(reviewContextLine(plan, 'ignore', { kind: 'dir', path: 'apps/web' })).toBe(
      'Summary: 1 create, 0 change, 0 leave, 0 conflict, 0 hunks; ' +
        'Git policy: ignore all of .cadre/; Launchers start in: apps/web/ under the git root',
    )
  })
})

describe('init plan', () => {
  /** The scans of a session with nothing detected, a framework-free team on the built-in default. */
  const gathered: Gathered = {
    facts: { facts: EMPTY_FACTS, gsdUserDir: null },
    repo: repoScan({ codeDirs: ['src'] }),
    setup: emptySetupScan({ mcp: [session('jira')] }),
  }
  /** PM on the repo default, Team Lead on superpowers by its own framework, BE on the repo default. */
  const roles = [templateRole('pm'), withFramework(templateRole('tl'), 'superpowers'), templateRole('be')]

  test("cardLines gives the lines of every role's card in role order, and none for a role with no scope", () => {
    const scopes = scopesFor(roles, 'gsd', gathered, [], { kind: 'git-root' })
    expect(cardLines(roles, scopes)).toEqual(roles.flatMap(role => scopeCardLines(cardOf(scopes, role.id))))
    expect(cardLines([...roles, templateRole('qa')], scopes)).toEqual(cardLines(roles, scopes))
  })
})

describe('reviewStep', () => {
  test('the review question, its four buttons and the round cap are fixed (D-43, A2)', () => {
    expect(REVIEW_QUESTION).toBe(
      'Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.',
    )
    expect(REVIEW_OPTIONS).toEqual(['Confirm', 'Change roles', 'Change git policy', 'Change launcher start'])
    expect(Object.isFrozen(REVIEW_OPTIONS)).toBe(true)
    expect(MAX_REVIEW_ROUNDS).toBe(10)
    expect(REVIEW_DISMISSED_REASON).toBe('The review question was dismissed or not answered.')
    expect(REVIEW_ROUNDS_REASON).toBe('The review question was asked 10 times without "Confirm": nothing was chosen.')
  })

  test('parseReviewItem reads a button or a typed item, trimmed and in any case; anything else is null', () => {
    const cases: readonly (readonly [string, ReviewItem | null])[] = [
      ['Confirm', 'confirm'],
      [' confirm ', 'confirm'],
      ['Change roles', 'roles'],
      ['roles', 'roles'],
      ['Change git policy', 'policy'],
      ['GIT POLICY', 'policy'],
      ['Change launcher start', 'launch'],
      ['launcher start', 'launch'],
      ['duration', 'duration'],
      ['Model', 'model'],
      ['assignments', 'assignments'],
      ['mcp', 'assignments'],
      ['skills', 'assignments'],
      ['memory', 'memory'],
      ['env', 'env'],
      [' hunks', 'hunks'],
      ['', null],
      ['yes', null],
      ['policy', null],
      ['change the model', null],
    ]
    for (const [answer, item] of cases) expect([answer, parseReviewItem(answer)]).toEqual([answer, item])
  })
})

describe('review question hint (G-02-7)', () => {
  test('reviewQuestion(null) is the question, then the typed-item hint on its own last line', () => {
    expect(REVIEW_TYPE_HINT).toBe(
      'Use a button, or type duration, model, assignments, memory, env or hunks under Other.',
    )
    expect(reviewQuestion(null)).toBe(
      'Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.\n' +
        'Use a button, or type duration, model, assignments, memory, env or hunks under Other.',
    )
    expect(reviewQuestion(null)).toBe(`${REVIEW_QUESTION}\n${REVIEW_TYPE_HINT}`)
  })

  test('a context line sits on its own line between the question and the hint, which always ends the text', () => {
    const context = 'Roles: PM, Team Lead, Security; 22 files planned.'
    expect(reviewQuestion(context).split('\n')).toEqual([REVIEW_QUESTION, context, REVIEW_TYPE_HINT])
    for (const given of [null, context]) expect(reviewQuestion(given).endsWith(`\n${REVIEW_TYPE_HINT}`)).toBe(true)
  })
})
