import { describe, expect, test } from 'claude-code/testing'

import type { Plan } from '../../../types'
import { proposeRoles } from '../../roles/propose'
import type { Gathered } from '../../scan/gather'
import { scopeCardLines } from '../../scope/card'
import { scopesFor } from '../../team'
import {
  cardOf,
  DEFAULT_LOCATIONS,
  EMPTY_FACTS,
  emptySetupScan,
  gitWorld,
  memIo,
  repoScan,
  session,
  stateAt,
  templateRole,
  withFramework,
} from '../../testkit'
import { contextText } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import type { Draft, PlanResult } from '../draft'
import { initReplyText } from '../initapply'
import { planStep } from '../initplan'
import { nextStage } from '../machine'
import { cancelledReply } from '../replies'
import type { Answer, InitState, ReviewItem } from '../state'
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
  reviewStage,
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

/** A whole draft of a dry run over the testkit repo: the template team on the built-in default, nothing handed out. */
const REVIEW_DRAFT: Draft = {
  locations: DEFAULT_LOCATIONS,
  gathered: { facts: { facts: EMPTY_FACTS, gsdUserDir: null }, repo: repoScan(), setup: emptySetupScan() },
  readUserMcp: false,
  installed: ['none'],
  choice: { kind: 'none' },
  proposal: proposeRoles(repoScan()),
  hints: new Map(),
  duration: '4h',
  roles: proposeRoles(repoScan()).roles,
  changes: [],
  repoDefault: 'none',
  hunks: [],
  pluginInstalls: [],
  instructions: { kind: 'none' },
  policy: 'definitions',
  launchStart: { kind: 'git-root' },
}

/** The review stage entered with REVIEW_DRAFT (`over` changes the draft fields it names): its plan effect out. */
function reviewAt(over: Partial<Draft> = {}, state: Partial<InitState> = {}): InitState {
  return reviewStage.enter(stateAt('review', { ...REVIEW_DRAFT, ...over }, state))
}

/** The plan of the plan effect `state` has out, made by planStep over the testkit git world. */
async function plannedFor(state: InitState): Promise<PlanResult> {
  const { effect } = state
  if (effect.kind !== 'legacy' || effect.step.id !== 'plan') throw new Error('no plan effect is out')

  return planStep(memIo(gitWorld(), {}).io, effect.step.input)
}

/** The answer to the plan effect: the plan made. */
function planAnswer(planned: PlanResult): Answer {
  return { kind: 'legacy', result: { id: 'plan', result: planned } }
}

describe('the review stage (D-230)', () => {
  test('reviewStage plans the whole draft first, then shows the review block and asks; the open question', async () => {
    const state = reviewAt()
    expect(state.openQuestion).toBeNull()
    const planned = await plannedFor(state)
    const asking = nextStage(state, planAnswer(planned))
    const context = contextText(reviewContextLine(planned.plan, 'definitions', { kind: 'git-root' }))
    const ask = { question: reviewQuestion(context), spec: { options: REVIEW_OPTIONS, header: 'Review' } }
    expect(asking.effect).toEqual({ kind: 'ask', ...ask })
    expect(asking.openQuestion).toEqual(ask)
    const blocks = asking.outputs.flatMap(output => (output.kind === 'show' ? [output.block] : []))
    expect(blocks.map(block => [block.key, block.lines[0]])).toEqual([['review', 'Roles:']])
  })

  test('Confirm on a --dry-run replies with the plan and the private files of each role; nothing written', async () => {
    const state = reviewAt()
    const planned = await plannedFor(state)
    const done = nextStage(nextStage(state, planAnswer(planned)), { kind: 'answer', text: 'Confirm' })
    const rows = [PRIVATE_FILES_HEADING, ...REVIEW_DRAFT.roles.map(role => privateFilesRow(role.id))]
    const reply = initReplyText(planned.plan, 'definitions', { kind: 'git-root' }, null, rows)
    expect([done.stage, done.effect]).toEqual(['done', { kind: 'end', reply }])
  })

  test('Confirm on a plain init sets the apply of the confirmed draft and the plan just shown', async () => {
    const state = reviewAt({}, { dryRun: false })
    const planned = await plannedFor(state)
    const applying = nextStage(nextStage(state, planAnswer(planned)), { kind: 'answer', text: 'Confirm' })
    const reviewed = { draft: REVIEW_DRAFT, planned }
    expect(applying.effect).toEqual({ kind: 'legacy', step: { id: 'apply', reviewed } })
    expect(applying.openQuestion).toBeNull()
  })

  test('a go-back goes through the legacy go-back, and its new draft is planned again the next round', async () => {
    const state = reviewAt()
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const going = nextStage(asking, { kind: 'answer', text: 'Change git policy' })
    expect(going.effect).toEqual({ kind: 'legacy', step: { id: 'go-back', draft: REVIEW_DRAFT, item: 'policy' } })
    const changed = { ...REVIEW_DRAFT, policy: 'all' } satisfies Draft
    const result = { kind: 'accepted', value: changed } satisfies StepResult<Draft>
    const back = nextStage(going, { kind: 'legacy', result: { id: 'go-back', result } })
    expect([back.stage, back.rounds, back.draft.policy]).toEqual(['review', 1, 'all'])
    expect((await plannedFor(back)).state.gitPolicy).toBe('all')
  })

  test('a go-back picked at the last round cancels with REVIEW_ROUNDS_REASON and asks nothing more (A3)', async () => {
    const state = reviewAt({}, { rounds: MAX_REVIEW_ROUNDS - 1 })
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const ended = nextStage({ ...asking, outputs: [] }, { kind: 'answer', text: 'Change git policy' })
    expect(ended.effect).toEqual({ kind: 'end', reply: cancelledReply(REVIEW_ROUNDS_REASON) })
    expect(ended.outputs).toEqual([{ kind: 'log', text: REVIEW_ROUNDS_REASON }])
  })
})
