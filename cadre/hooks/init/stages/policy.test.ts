import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_LOCATIONS, driven, stateAt, TEMPLATE_ROLES } from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import { nextStage } from '../machine'
import { cancelledReply } from '../replies'
import {
  GIT_POLICY_CONTEXT,
  GIT_POLICY_DISMISSED_REASON,
  GIT_POLICY_OPTIONS,
  GIT_POLICY_QUESTION,
  parseGitPolicy,
  policyLine,
  policyStage,
} from './policy'

/** What the launcher start stage after the git policy is entered with: the session's locations and the roles. */
const POLICY_DRAFT = { locations: DEFAULT_LOCATIONS, roles: TEMPLATE_ROLES }

/**
 * The git policy question's own context (D-203): what each policy commits, one line per policy; a pane surface asks
 * the question with its summary, the default policy recommended, in place of GIT_POLICY_CONTEXT (D-310).
 */
const POLICY_CONTEXT = {
  title: 'Git policy',
  lines: [
    'Commit definitions: .cadre/ is committed except .cadre/*/.runtime/.',
    'Commit all: only per-user files are ignored.',
    'Ignore all: nothing in .cadre/ is committed.',
  ],
  kind: 'git-policy',
  summary: 'Recommended: commit definitions',
  pane: {
    asked: withContext(GIT_POLICY_QUESTION, GIT_POLICY_CONTEXT),
    text: withContext(GIT_POLICY_QUESTION, 'Recommended: commit definitions'),
  },
}

describe('init helpers', () => {
  test('parseGitPolicy maps the three labels, trimmed and in any case', () => {
    expect(parseGitPolicy('Commit definitions (default)')).toBe('definitions')
    expect(parseGitPolicy('Commit all')).toBe('all')
    expect(parseGitPolicy('Ignore all of .cadre/')).toBe('ignore')
    expect(parseGitPolicy('  commit ALL ')).toBe('all')
    expect(parseGitPolicy('IGNORE ALL OF .CADRE/')).toBe('ignore')
  })

  test('parseGitPolicy also maps the words definitions, all and ignore', () => {
    expect(parseGitPolicy('definitions')).toBe('definitions')
    expect(parseGitPolicy('All')).toBe('all')
    expect(parseGitPolicy(' ignore ')).toBe('ignore')
  })

  test('parseGitPolicy gives null for an empty, unknown or half-matching answer', () => {
    expect(parseGitPolicy('')).toBeNull()
    expect(parseGitPolicy('   ')).toBeNull()
    expect(parseGitPolicy('whatever')).toBeNull()
    expect(parseGitPolicy('commit')).toBeNull()
    expect(parseGitPolicy('commit all of it')).toBeNull()
  })

  test('pin: parseGitPolicy takes a label or a word, trimmed and in any case, and nothing else (B6)', () => {
    const answers = ['Commit all', ' COMMIT ALL ', 'ignore', 'definitions', 'DEFINITIONS', ' All ', '', 'nope', 'al']
    expect(answers.map(answer => parseGitPolicy(answer))).toEqual([
      'all',
      'all',
      'ignore',
      'definitions',
      'definitions',
      'all',
      null,
      null,
      null,
    ])
  })

  test('the git policy options are listed default, all, ignore, frozen, and each parses to its own policy', () => {
    expect(GIT_POLICY_OPTIONS).toEqual(['Commit definitions (default)', 'Commit all', 'Ignore all of .cadre/'])
    expect(Object.isFrozen(GIT_POLICY_OPTIONS)).toBe(true)
    expect(GIT_POLICY_OPTIONS.map(option => parseGitPolicy(option))).toEqual(['definitions', 'all', 'ignore'])
  })

  test('policyStage accepts a policy; a dismissal or unknown answers are cancelled with its reason', () => {
    const run = driven(policyStage.enter(stateAt('policy', POLICY_DRAFT)), ['Commit all'])
    expect(run.state.draft.policy).toBe('all')
    expect(run.asked).toEqual([withContext(GIT_POLICY_QUESTION, GIT_POLICY_CONTEXT)])
    expect(run.specs).toEqual([{ options: GIT_POLICY_OPTIONS, header: 'Git policy', context: POLICY_CONTEXT }])
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], GIT_POLICY_DISMISSED_REASON],
      [['whatever', 'whatever', 'whatever'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const dismissed = driven(policyStage.enter(stateAt('policy', POLICY_DRAFT)), answers)
      expect(dismissed.state.effect).toEqual({ kind: 'end', reply: cancelledReply(reason) })
      expect(dismissed.asked).toHaveLength(Math.max(1, answers.length))
      expect(dismissed.outputs).toEqual([{ kind: 'log', text: reason }])
    }
    expect(GIT_POLICY_DISMISSED_REASON).toBe('The git policy question was dismissed or not answered.')
  })

  test('policyLine states each policy and what stays out of git', () => {
    expect(policyLine('definitions')).toBe('Git policy: commit definitions (.cadre/*/.runtime/ ignored)')
    expect(policyLine('all')).toBe(
      'Git policy: commit all (only per-user rendered files in .cadre/*/.runtime/ ignored)',
    )
    expect(policyLine('ignore')).toBe('Git policy: ignore all of .cadre/')
  })
})

describe('the git policy stage (D-230)', () => {
  test('policyStage asks the git policy question with its context line and chip; the open question is that ask', () => {
    const state = policyStage.enter(stateAt('policy', POLICY_DRAFT))
    const ask = {
      question: withContext(GIT_POLICY_QUESTION, GIT_POLICY_CONTEXT),
      spec: { options: GIT_POLICY_OPTIONS, header: 'Git policy', context: POLICY_CONTEXT },
    }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
  })

  test('the git policy question carries its own context: what each policy commits, one line per policy (D-203)', () => {
    const state = policyStage.enter(stateAt('policy', POLICY_DRAFT))
    expect(state.effect.kind === 'ask' ? state.effect.spec.context : null).toEqual(POLICY_CONTEXT)
    expect(state.openQuestion?.spec.context).toEqual(POLICY_CONTEXT)
    expect(POLICY_CONTEXT.lines.join(' ')).toBe(GIT_POLICY_CONTEXT)
  })

  test('a policy label finishes the stage with that policy in the draft and enters the launcher start stage', () => {
    const state = nextStage(policyStage.enter(stateAt('policy', POLICY_DRAFT)), { kind: 'answer', text: 'Commit all' })
    expect(state.stage).toBe('launch')
    expect(state.draft.policy).toBe('all')
    expect(state.draft.roles).toBe(TEMPLATE_ROLES)
  })
})
