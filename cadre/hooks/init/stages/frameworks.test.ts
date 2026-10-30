import { describe, expect, test } from 'claude-code/testing'

import type { Choice, RepoEntry, RoleSpec } from '../../../types'
import { choiceLine } from '../../detect/report'
import { proposeRoles } from '../../roles/propose'
import { resolvedFramework } from '../../team'
import { driven, emptySetupScan, facts, firstLines, repoScan, stateAt, wholeDraft, withFramework } from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import { nextStage } from '../machine'
import { cancelledReply } from '../replies'
import type { InitState } from '../state'
import {
  FRAMEWORK_ALL_QUESTION,
  FRAMEWORK_DISMISSED_REASON,
  FRAMEWORK_LABELS,
  FRAMEWORK_QUESTION_PREFIX,
  frameworkReason,
  frameworkRoleQuestion,
  frameworksStage,
} from './frameworks'
import { teamContextLine } from './model'

/** The framework options when GSD and superpowers are offered: SUPPORTED_IDS order, then the built-in fallback. */
const BOTH_OPTIONS = ['GSD', 'superpowers', 'none (built-in)']

/** The detection evidence of a repo where nothing was found, as each framework question carries it (D-236). */
const GSD_LINE = 'GSD: not found (no .planning/; no gsd-core install proven)'
const DETECTED = {
  title: 'Frameworks',
  lines: [GSD_LINE, 'superpowers: not found (no docs/superpowers/ or .superpowers/; no enabled superpowers@ plugin)'],
  kind: 'detection',
}

/** The frameworks stage entered for `choice` and `roles`, the rest of a whole draft set. */
function frameworksAt(choice: Choice, roles: readonly RoleSpec[]): InitState {
  return frameworksStage.enter(stateAt('frameworks', wholeDraft({ choice, roles })))
}

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

  test('with one framework in use nothing is asked, overrides stay, and that framework is the default', () => {
    const chosen: Choice = { kind: 'chosen', id: 'gsd', pickedBy: 'only-one-in-use', reason: 'only gsd is in use' }
    const overridden = roles.map(role => (role.id === 'tl' ? withFramework(role, 'superpowers') : role))
    for (const team of [overridden, roles]) {
      const state = frameworksAt(chosen, team)
      expect([state.sub, state.draft.roles, state.draft.repoDefault]).toEqual([{ kind: 'done' }, team, 'gsd'])
      expect([state.openQuestion, state.outputs]).toEqual([null, []])
    }
  })

  test('ambiguous: Same for all roles asks once more and gives every role that framework, no default', () => {
    const run = driven(frameworksAt(ambiguous, roles), ['Same for all roles', 'superpowers'])
    expect(run.state.draft.roles).toEqual(roles.map(role => withFramework(role, 'superpowers')))
    expect(run.state.draft.repoDefault).toBeNull()
    expect(firstLines(run.asked)).toEqual([AMBIGUOUS_QUESTION, FRAMEWORK_ALL_QUESTION])
    expect(run.specs).toEqual([
      { options: ['Same for all roles', 'Per role'], header: 'Framework', context: DETECTED },
      { options: BOTH_OPTIONS, header: 'Framework', context: DETECTED },
    ])
  })

  test('ambiguous: Per role asks each role by title and id, in role order, with both frameworks and none', () => {
    const run = driven(frameworksAt(ambiguous, roles), ['Per role', 'GSD', 'none (built-in)', 'superpowers'])
    expect(run.state.draft.roles?.map(role => role.framework)).toEqual(['gsd', 'none', 'superpowers'])
    expect(run.state.draft.repoDefault).toBeNull()
    expect(firstLines(run.asked)).toEqual([
      AMBIGUOUS_QUESTION,
      'Framework for PM (pm)?',
      'Framework for Team Lead (tl)?',
      'Framework for Security (security)?',
    ])
    const each = { options: BOTH_OPTIONS, header: 'Framework', context: DETECTED }
    expect(run.specs.slice(1)).toEqual([each, each, each])
  })

  test('installed-only asks with the installed framework and none, and says why it asks', () => {
    const run = driven(frameworksAt(installedOnly, roles), ['Same for all roles', 'GSD'])
    expect(run.state.draft.roles?.map(role => role.framework)).toEqual(['gsd', 'gsd', 'gsd'])
    expect(firstLines(run.asked)).toEqual([INSTALLED_QUESTION, FRAMEWORK_ALL_QUESTION])
    expect(run.specs[1]).toEqual({ options: ['GSD', 'none (built-in)'], header: 'Framework', context: DETECTED })
  })

  test('every framework question carries the detection evidence: each framework, a marker only found (D-236)', () => {
    const repoEntries: readonly RepoEntry[] = [{ name: 'aidlc', kind: 'dir', isLink: false }]
    const setup = emptySetupScan()
    const gathered = { facts: { facts: facts({ repoEntries }), gsdUserDir: null }, repo: repoScan(), setup }
    const state = frameworksStage.enter(stateAt('frameworks', wholeDraft({ choice: ambiguous, roles, gathered })))
    const context = state.openQuestion?.spec.context
    expect([context?.title, context?.kind, context?.lines.length, context?.lines[0]]).toEqual([
      'Frameworks',
      'detection',
      3,
      GSD_LINE,
    ])
    expect(context?.lines[2]?.startsWith('AI-DLC: unsupported (aidlc/ present; detected but unsupported: ')).toBe(true)
  })

  test('a typed framework that is not offered is asked again with why on top; an offered id counts', () => {
    const run = driven(frameworksAt(installedOnly, roles), ['Same for all roles', 'superpowers', ' NONE '])
    expect(run.state.draft.roles?.map(role => role.framework)).toEqual(['none', 'none', 'none'])
    const refusal = "'superpowers' isn't one of: GSD, none - a role runs one framework."
    const all = withContext(FRAMEWORK_ALL_QUESTION, teamContextLine(roles))
    expect(firstLines(run.asked)[0]).toBe(INSTALLED_QUESTION)
    expect(run.asked.slice(1)).toEqual([all, `${refusal}\n${all}`])
  })

  test('a dismissed or unread framework question is never a choice: the step is cancelled (A1)', () => {
    const scripts: readonly (readonly [readonly string[], string])[] = [
      [[], FRAMEWORK_DISMISSED_REASON],
      [['Same for all roles'], FRAMEWORK_DISMISSED_REASON],
      [['Per role', 'GSD'], FRAMEWORK_DISMISSED_REASON],
      [['what', 'ever', 'else'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of scripts) {
      const run = driven(frameworksAt(ambiguous, roles), answers)
      expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(reason) })
      expect(run.outputs).toEqual([{ kind: 'log', text: reason }])
    }
    expect(FRAMEWORK_DISMISSED_REASON).toBe('A framework question was dismissed or not answered.')
  })

  test('unsupported and none ask nothing and give the built-in default; unsupported says what was found', () => {
    const unsupported: Choice = { kind: 'unsupported', ids: ['aidlc'] }
    const run = frameworksAt(unsupported, roles)
    expect([run.sub, run.draft.roles, run.draft.repoDefault]).toEqual([{ kind: 'done' }, roles, 'none'])
    expect(run.outputs).toEqual([{ kind: 'note', line: choiceLine(unsupported) }])
    const none = frameworksAt({ kind: 'none' }, roles)
    expect([none.sub, none.draft.roles, none.draft.repoDefault]).toEqual([{ kind: 'done' }, roles, 'none'])
    expect([none.openQuestion, none.outputs]).toEqual([null, []])
  })

  test('options keep SUPPORTED_IDS order then none for each role, 2 to 4 of them, in any choice order', () => {
    const reversed: Choice = { kind: 'ambiguous', ids: ['superpowers', 'gsd'] }
    const run = driven(frameworksAt(reversed, roles), ['Per role', 'GSD', 'GSD', 'GSD'])
    const each = { options: BOTH_OPTIONS, header: 'Framework', context: DETECTED }
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

  test('the framework question for all roles carries the team too', () => {
    const ambiguous: Choice = { kind: 'ambiguous', ids: ['gsd', 'superpowers'] }
    const run = driven(frameworksAt(ambiguous, proposeRoles(repoScan()).roles), ['Same for all roles', 'GSD'])
    expect(run.asked[1]).toBe(`${FRAMEWORK_ALL_QUESTION}\nRoles: ${TEAM}.`)
  })
})

describe('the frameworks stage (D-230)', () => {
  /** PM, Team Lead and Security: the template roles a repo with no source keeps. */
  const roles = proposeRoles(repoScan()).roles

  test('frameworksStage asks nothing for one framework in use, an unsupported one or none', () => {
    const chosen: Choice = { kind: 'chosen', id: 'gsd', pickedBy: 'only-one-in-use', reason: 'only gsd is in use' }
    const unsupported: Choice = { kind: 'unsupported', ids: ['aidlc'] }
    const cases: readonly (readonly [Choice, string, readonly unknown[]])[] = [
      [chosen, 'gsd', []],
      [unsupported, 'none', [{ kind: 'note', line: choiceLine(unsupported) }]],
      [{ kind: 'none' }, 'none', []],
    ]
    for (const [choice, repoDefault, notes] of cases) {
      const state = frameworksStage.enter(stateAt('frameworks', wholeDraft({ choice, roles, repoDefault: null })))
      expect([state.sub, state.draft.repoDefault, state.draft.roles, state.outputs]).toEqual([
        { kind: 'done' },
        repoDefault,
        roles,
        notes,
      ])
    }
  })

  test('an ambiguous choice asks Same for all roles or Per role with the team ids as the open question', () => {
    const choice: Choice = { kind: 'ambiguous', ids: ['gsd', 'superpowers'] }
    const state = frameworksStage.enter(stateAt('frameworks', wholeDraft({ choice, roles })))
    const prefix = `${FRAMEWORK_QUESTION_PREFIX} (asked because more than one framework is in use)`
    const question = withContext(prefix, 'Roles: pm, tl, security.')
    const spec = { options: ['Same for all roles', 'Per role'], header: 'Framework', context: DETECTED }
    const ask = { question, spec }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
    const all = nextStage(state, { kind: 'answer', text: 'Same for all roles' })
    expect(all.openQuestion?.question).toBe(withContext(FRAMEWORK_ALL_QUESTION, 'Roles: pm, tl, security.'))
  })
})
