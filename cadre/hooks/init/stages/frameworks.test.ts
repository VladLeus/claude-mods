import { describe, expect, test } from 'claude-code/testing'

import type { Choice, FrameworkId, RoleSpec } from '../../../types'
import { choiceLine } from '../../detect/report'
import { proposeRoles } from '../../roles/propose'
import { resolvedFramework } from '../../team'
import { firstLines, memIo, memWorld, repoScan } from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import {
  FRAMEWORK_ALL_QUESTION,
  FRAMEWORK_DISMISSED_REASON,
  FRAMEWORK_LABELS,
  FRAMEWORK_QUESTION_PREFIX,
  frameworkReason,
  frameworkRoleQuestion,
  frameworkStep,
} from './frameworks'
import { teamContextLine } from './model'

/** The value of an accepted step result; a cancelled one stops the test with its reason. */
function valueOf<T>(result: StepResult<T>): T {
  if (result.kind === 'cancelled') throw new Error(`the step was cancelled: ${result.reason}`)

  return result.value
}

/** A role with its framework set, as the framework step or an Adjust override sets it. */
function withFramework(role: RoleSpec, framework: FrameworkId): RoleSpec {
  return { ...role, framework }
}

/** The framework options when GSD and superpowers are offered: SUPPORTED_IDS order, then the built-in fallback. */
const BOTH_OPTIONS = ['GSD', 'superpowers', 'none (built-in)']

describe('frameworkStep', () => {
  /** PM, Team Lead and Security: the template roles a repo with no source keeps. */
  const roles = proposeRoles(repoScan()).roles
  const ambiguous: Choice = { kind: 'ambiguous', ids: ['gsd', 'superpowers'] }
  const installedOnly: Choice = { kind: 'installed-only', ids: ['gsd'] }
  const AMBIGUOUS_QUESTION = 'Which framework do the roles use? (asked because more than one framework is in use)'
  const INSTALLED_QUESTION =
    'Which framework do the roles use? (asked because none is in use here, but some are installed for you)'

  test('the framework labels and the question texts are fixed, with no option marked as a default', () => {
    expect(FRAMEWORK_LABELS).toEqual({ gsd: 'GSD', superpowers: 'superpowers', none: 'none (built-in)' })
    expect(Object.isFrozen(FRAMEWORK_LABELS)).toBe(true)
    expect(FRAMEWORK_QUESTION_PREFIX).toBe('Which framework do the roles use?')
    expect(FRAMEWORK_ALL_QUESTION).toBe('Framework for all roles?')
    expect(frameworkRoleQuestion({ id: 'tl', title: 'Team Lead' })).toBe('Framework for Team Lead (tl)?')
    expect(frameworkRoleQuestion({ id: 'be-api', title: 'Backend' })).toBe('Framework for Backend (be-api)?')
  })

  test('frameworkReason says why the question is asked, and what a choice that asks nothing found', () => {
    expect(frameworkReason(ambiguous)).toBe('more than one framework is in use')
    expect(frameworkReason(installedOnly)).toBe('none is in use here, but some are installed for you')
    const chosen: Choice = { kind: 'chosen', id: 'gsd', pickedBy: 'only-one-in-use', reason: 'only gsd is in use' }
    expect(frameworkReason(chosen)).toBe('only gsd is in use')
    expect(frameworkReason({ kind: 'unsupported', ids: ['aidlc'] })).toBe(
      'only frameworks cadre does not support were found',
    )
    expect(frameworkReason({ kind: 'none' })).toBe('no framework was found')
  })

  test('with one framework in use nothing is asked, overrides stay, and that framework is the default', async () => {
    const chosen: Choice = { kind: 'chosen', id: 'gsd', pickedBy: 'only-one-in-use', reason: 'only gsd is in use' }
    const overridden = roles.map(role => (role.id === 'tl' ? withFramework(role, 'superpowers') : role))
    const run = memIo(memWorld({}), {})
    expect(await frameworkStep(run.io, chosen, overridden)).toEqual({
      kind: 'accepted',
      value: { roles: overridden, repoDefault: 'gsd' },
    })
    expect(await frameworkStep(run.io, chosen, roles)).toEqual({
      kind: 'accepted',
      value: { roles, repoDefault: 'gsd' },
    })
    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([])
  })

  test('ambiguous: Same for all roles asks once more and gives every role that framework, no default', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'superpowers'])
    expect(await frameworkStep(run.io, ambiguous, roles)).toEqual({
      kind: 'accepted',
      value: { roles: roles.map(role => withFramework(role, 'superpowers')), repoDefault: null },
    })
    expect(firstLines(run.asked)).toEqual([AMBIGUOUS_QUESTION, FRAMEWORK_ALL_QUESTION])
    expect(run.specs).toEqual([
      { options: ['Same for all roles', 'Per role'], header: 'Framework' },
      { options: BOTH_OPTIONS, header: 'Framework' },
    ])
  })

  test('ambiguous: Per role asks each role by title and id, in role order, with both frameworks and none', async () => {
    const run = memIo(memWorld({}), ['Per role', 'GSD', 'none (built-in)', 'superpowers'])
    const result = valueOf(await frameworkStep(run.io, ambiguous, roles))
    expect(result.roles.map(role => role.framework)).toEqual(['gsd', 'none', 'superpowers'])
    expect(result.repoDefault).toBeNull()
    expect(firstLines(run.asked)).toEqual([
      AMBIGUOUS_QUESTION,
      'Framework for PM (pm)?',
      'Framework for Team Lead (tl)?',
      'Framework for Security (security)?',
    ])
    const each = { options: BOTH_OPTIONS, header: 'Framework' }
    expect(run.specs.slice(1)).toEqual([each, each, each])
  })

  test('installed-only asks with the installed framework and none, and says why it asks', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'GSD'])
    const result = valueOf(await frameworkStep(run.io, installedOnly, roles))
    expect(result.roles.map(role => role.framework)).toEqual(['gsd', 'gsd', 'gsd'])
    expect(firstLines(run.asked)).toEqual([INSTALLED_QUESTION, FRAMEWORK_ALL_QUESTION])
    expect(run.specs[1]).toEqual({ options: ['GSD', 'none (built-in)'], header: 'Framework' })
  })

  test('a typed framework that is not offered is asked again with why on top; an offered id counts', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'superpowers', ' NONE '])
    const result = valueOf(await frameworkStep(run.io, installedOnly, roles))
    expect(result.roles.map(role => role.framework)).toEqual(['none', 'none', 'none'])
    const refusal = "'superpowers' isn't one of: GSD, none - a role runs one framework."
    const all = withContext(FRAMEWORK_ALL_QUESTION, teamContextLine(roles))
    expect(firstLines(run.asked)[0]).toBe(INSTALLED_QUESTION)
    expect(run.asked.slice(1)).toEqual([all, `${refusal}\n${all}`])
  })

  test('a dismissed or unread framework question is never a choice: the step is cancelled (A1)', async () => {
    const scripts: readonly (readonly [readonly string[], string])[] = [
      [[], FRAMEWORK_DISMISSED_REASON],
      [['Same for all roles'], FRAMEWORK_DISMISSED_REASON],
      [['Per role', 'GSD'], FRAMEWORK_DISMISSED_REASON],
      [['what', 'ever', 'else'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of scripts) {
      const run = memIo(memWorld({}), answers)
      expect(await frameworkStep(run.io, ambiguous, roles)).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(FRAMEWORK_DISMISSED_REASON).toBe('A framework question was dismissed or not answered.')
  })

  test('unsupported and none ask nothing and give the built-in default; unsupported says what was found', async () => {
    const unsupported: Choice = { kind: 'unsupported', ids: ['aidlc'] }
    const builtIn = { kind: 'accepted', value: { roles, repoDefault: 'none' } }
    const run = memIo(memWorld({}), {})
    expect(await frameworkStep(run.io, unsupported, roles)).toEqual(builtIn)
    expect(run.logged).toEqual([choiceLine(unsupported)])
    expect(run.shown).toEqual([{ key: 'notes', title: 'Notes', lines: [choiceLine(unsupported)] }])
    const none = memIo(memWorld({}), {})
    expect(await frameworkStep(none.io, { kind: 'none' }, roles)).toEqual(builtIn)
    expect(none.asked).toEqual([])
    expect(none.logged).toEqual([])
  })

  test('options keep SUPPORTED_IDS order then none for each role, 2 to 4 of them, in any choice order', async () => {
    const reversed: Choice = { kind: 'ambiguous', ids: ['superpowers', 'gsd'] }
    const run = memIo(memWorld({}), ['Per role', 'GSD', 'GSD', 'GSD'])
    await frameworkStep(run.io, reversed, roles)
    const each = { options: BOTH_OPTIONS, header: 'Framework' }
    expect(run.specs.slice(1)).toEqual([each, each, each])
    for (const spec of run.specs) {
      expect(spec.options.length).toBeGreaterThanOrEqual(2)
      expect(spec.options.length).toBeLessThanOrEqual(4)
      expect(spec.options.some(option => option.includes('(default)'))).toBe(false)
    }
  })

  test("resolvedFramework is the role's own framework, else the repo default, else none", () => {
    const [role] = roles
    if (role === undefined) throw new Error('no template role')
    expect(resolvedFramework(withFramework(role, 'superpowers'), 'gsd')).toBe('superpowers')
    expect(resolvedFramework(role, 'gsd')).toBe('gsd')
    expect(resolvedFramework(role, null)).toBe('none')
  })
})

describe('question context lines (G-02-1)', () => {
  /** The roles of the git fixture worlds, which hold no source: PM, Team Lead and Security. */
  const TEAM = 'pm, tl, security'

  test('the framework question for all roles carries the team too', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'GSD'])
    await frameworkStep(run.io, { kind: 'ambiguous', ids: ['gsd', 'superpowers'] }, proposeRoles(repoScan()).roles)
    expect(run.asked[1]).toBe(`${FRAMEWORK_ALL_QUESTION}\nRoles: ${TEAM}.`)
  })
})
