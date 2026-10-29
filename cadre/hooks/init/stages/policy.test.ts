import { describe, expect, test } from 'claude-code/testing'

import { memIo, memWorld } from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import {
  GIT_POLICY_CONTEXT,
  GIT_POLICY_DISMISSED_REASON,
  GIT_POLICY_OPTIONS,
  GIT_POLICY_QUESTION,
  gitPolicyStep,
  parseGitPolicy,
  policyLine,
} from './policy'

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

  test('gitPolicyStep accepts a policy; a dismissal or unknown answers are cancelled with its reason', async () => {
    const run = memIo(memWorld({}), ['Commit all'])
    expect(await gitPolicyStep(run.io)).toEqual({ kind: 'accepted', value: 'all' })
    expect(run.asked).toEqual([withContext(GIT_POLICY_QUESTION, GIT_POLICY_CONTEXT)])
    expect(run.specs).toEqual([{ options: GIT_POLICY_OPTIONS, header: 'Git policy' }])
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], GIT_POLICY_DISMISSED_REASON],
      [['whatever', 'whatever', 'whatever'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const dismissed = memIo(memWorld({}), answers)
      expect(await gitPolicyStep(dismissed.io)).toEqual({ kind: 'cancelled', reason })
      expect(dismissed.asked).toHaveLength(Math.max(1, answers.length))
      expect(dismissed.logged).toEqual([])
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
