import { describe, expect, test } from 'claude-code/testing'

import type { RoleChange, RoleSpec } from '../../../types'
import { REDACTED } from '../../core/redact'
import { proposeRoles } from '../../roles/propose'
import { AUTOPILOT_THRESHOLD } from '../../roles/template'
import { driven, roleIn, SOURCE_SCAN, stateAt, templateRole } from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import { proposalLines } from '../../ui/blocks/context'
import { MODEL_EFFORT_OPTIONS, modelEffortRefusal } from '../answers'
import { nextStage } from '../machine'
import { cancelledReply } from '../replies'
import type { InitState } from '../state'
import { MODEL_DISMISSED_REASON, MODEL_EFFORT_CONTEXT, MODEL_MODE_QUESTION, modelStage } from './model'

/** The model stage entered for `roles`. */
function modelAt(roles: readonly RoleSpec[]): InitState {
  return modelStage.enter(stateAt('model', { roles }))
}

describe('modelStep', () => {
  /** PM, Team Lead, BE, QA and Security, each with the 90m run the duration step gave them. */
  const roles = proposeRoles(SOURCE_SCAN).roles.map(role => ({
    ...role,
    autopilot: { ...role.autopilot, duration: '90m' },
  }))
  /** The one model question after `Same for all roles`, as asked: with every family and effort under it (D-136). */
  const MODEL_ALL_LINE = 'Model and effort for all roles?'
  const MODEL_ALL = withContext(MODEL_ALL_LINE, MODEL_EFFORT_CONTEXT)
  /** The first model question as asked for these five roles: their ids under it (D-136). */
  const MODE_ASKED = withContext(MODEL_MODE_QUESTION, 'Roles: pm, tl, be, qa, security.')
  /** Every model question's own context: the roles with their purposes (D-236). */
  const lines = proposalLines(roles, [])
  /** The summary of every model question's context: the five roles and their ids (D-310). */
  const summary = '5 roles: pm, tl, be, qa, security'
  /** The context of the question `asked` of `sentence`: a pane surface asks its summary in place (D-310). */
  const contextOf = (asked: string, sentence: string): unknown => ({
    title: 'Roles',
    lines,
    kind: 'roles',
    summary,
    pane: { asked, text: withContext(sentence, summary) },
  })

  test('the first model question offers Same for all roles first, then Per role', () => {
    const run = driven(modelAt(roles), ['Same for all roles', 'opus + medium'])
    expect(MODEL_MODE_QUESTION).toBe('Model and effort: same for all roles, or per role?')
    expect(run.asked[0]).toBe(MODE_ASKED)
    const context = contextOf(MODE_ASKED, MODEL_MODE_QUESTION)
    expect(run.specs[0]).toEqual({ options: ['Same for all roles', 'Per role'], header: 'Model', context })
  })

  test('Same for all roles asks once more and gives every role that model family and effort', () => {
    const run = driven(modelAt(roles), ['Same for all roles', 'sonnet + high'])
    expect(run.state.draft.roles?.map(role => [role.id, role.model, role.effort])).toEqual(
      roles.map(role => [role.id, 'sonnet', 'high']),
    )
    expect(run.asked).toEqual([MODE_ASKED, MODEL_ALL])
    const options = ['opus + medium', 'sonnet + medium', 'sonnet + high']
    const context = contextOf(MODEL_ALL, MODEL_ALL_LINE)
    expect(run.specs[1]).toEqual({ options, header: 'Model', context, acceptsTyped: true })
    expect(run.outputs).toEqual([])
  })

  test('Per role asks each role by its title and id in role order, each with the three options (A6)', () => {
    const answers = ['Per role', 'opus + medium', 'sonnet + high', 'sonnet + medium', 'haiku low', 'OPUS+max']
    const run = driven(modelAt(roles), answers)
    const questions = [
      'Model and effort for PM (pm)?',
      'Model and effort for Team Lead (tl)?',
      'Model and effort for BE (be)?',
      'Model and effort for QA (qa)?',
      'Model and effort for Security (security)?',
    ]
    expect(run.asked).toEqual([MODE_ASKED, ...questions.map(question => withContext(question, MODEL_EFFORT_CONTEXT))])
    const each = questions.map(question => ({
      options: MODEL_EFFORT_OPTIONS,
      header: 'Model',
      context: contextOf(withContext(question, MODEL_EFFORT_CONTEXT), question),
      acceptsTyped: true,
    }))
    expect(run.specs.slice(1)).toEqual(each)
    expect(run.state.draft.roles?.map(role => `${role.id}: ${role.model} ${role.effort}`)).toEqual([
      'pm: opus medium',
      'tl: sonnet high',
      'be: sonnet medium',
      'qa: haiku low',
      'security: opus max',
    ])
  })

  test('two roles with the same title are told apart by their ids in the per-role questions (A6)', () => {
    const be = { ...roleIn(roles, 'be'), title: 'Backend' }
    const run = driven(modelAt([be, { ...be, id: 'be-api' }]), ['Per role', 'opus + medium', 'sonnet + high'])
    expect(run.asked).toEqual([
      withContext(MODEL_MODE_QUESTION, 'Roles: be, be-api.'),
      withContext('Model and effort for Backend (be)?', MODEL_EFFORT_CONTEXT),
      withContext('Model and effort for Backend (be-api)?', MODEL_EFFORT_CONTEXT),
    ])
    expect(run.state.draft.roles?.map(role => [role.id, role.model, role.effort])).toEqual([
      ['be', 'opus', 'medium'],
      ['be-api', 'sonnet', 'high'],
    ])
  })

  test('a model that is no family alias puts the refusal line on top of the next ask (A4)', () => {
    const run = driven(modelAt(roles), ['Same for all roles', 'sonet + high', 'high high', 'opus + high'])
    expect(run.state.draft.roles?.map(role => [role.model, role.effort])).toEqual(roles.map(() => ['opus', 'high']))
    expect(run.asked).toEqual([
      MODE_ASKED,
      MODEL_ALL,
      `${modelEffortRefusal('sonet + high')}\n${MODEL_ALL}`,
      `${modelEffortRefusal('high high')}\n${MODEL_ALL}`,
    ])
    expect(run.outputs).toEqual([])
  })

  test('MAX_ASKS refused models, a pinned id among them, cancel with no usable answer (A4, D-136)', () => {
    const refused = ['claude-opus-5-5 high', 'opus', 'sonet high']
    const run = driven(modelAt(roles), ['Same for all roles', ...refused, 'opus + high'])
    expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(NO_USABLE_ANSWER_REASON) })
    expect(run.asked).toEqual([
      MODE_ASKED,
      MODEL_ALL,
      `${modelEffortRefusal('claude-opus-5-5 high')}\n${MODEL_ALL}`,
      `${modelEffortRefusal('opus')}\n${MODEL_ALL}`,
    ])
    expect(run.outputs).toEqual([{ kind: 'log', text: NO_USABLE_ANSWER_REASON }])
  })

  test('each role keeps its duration and the threshold 65, asked nowhere, and the input is unchanged', () => {
    const before = JSON.stringify(roles)
    const modelled = driven(modelAt(roles.slice(0, 1)), ['Per role', 'sonnet high']).state.draft.roles
    expect(modelled?.map(role => role.autopilot)).toEqual([{ duration: '90m', threshold: 65, askUser: true }])
    expect(roles.every(role => role.autopilot.threshold === AUTOPILOT_THRESHOLD)).toBe(true)
    expect(AUTOPILOT_THRESHOLD).toBe(65)
    expect(JSON.stringify(roles)).toBe(before)
  })

  test('a dismissal or unlisted answers at any model question cancel with their reason, no roles (A1)', () => {
    const scripts: readonly (readonly [readonly string[], string])[] = [
      [[], MODEL_DISMISSED_REASON],
      [['Same for all roles'], MODEL_DISMISSED_REASON],
      [['Per role', 'opus + medium'], MODEL_DISMISSED_REASON],
      [['nope', 'nope', 'nope'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of scripts) {
      const run = driven(modelAt(roles), answers)
      expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(reason) })
      expect(run.state.draft.roles).toEqual(roles)
      expect(run.outputs).toEqual([{ kind: 'log', text: reason }])
    }
    expect(MODEL_DISMISSED_REASON).toBe('A model and effort question was dismissed or not answered.')
  })
})

describe('refusal re-ask (G-02-6b)', () => {
  test('the model loop puts its refusal on top of the next ask; three refused answers cancel (A4)', () => {
    const roles = [templateRole('pm')]
    const run = driven(modelAt(roles), ['Same for all roles', 'sonet + high', 'opus', 'high high'])
    expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(NO_USABLE_ANSWER_REASON) })
    const all = withContext('Model and effort for all roles?', MODEL_EFFORT_CONTEXT)
    expect(run.asked).toEqual([
      withContext(MODEL_MODE_QUESTION, 'Roles: pm.'),
      all,
      `${modelEffortRefusal('sonet + high')}\n${all}`,
      `${modelEffortRefusal('opus')}\n${all}`,
    ])
    expect(run.outputs).toEqual([{ kind: 'log', text: NO_USABLE_ANSWER_REASON }])
    const dismissed = driven(modelAt(roles), ['Same for all roles', 'sonet + high'])
    expect(dismissed.state.effect).toEqual({ kind: 'end', reply: cancelledReply(MODEL_DISMISSED_REASON) })
  })
})

describe('the model stage (D-230)', () => {
  /** PM, Team Lead, BE, QA and Security: the team the model and effort are asked for. */
  const roles = proposeRoles(SOURCE_SCAN).roles

  test('modelStage asks Same for all roles or Per role with the team ids; the open question is that ask', () => {
    const state = modelStage.enter(stateAt('model', { roles }))
    const question = withContext(MODEL_MODE_QUESTION, 'Roles: pm, tl, be, qa, security.')
    const lines = proposalLines(roles, [])
    // A pane surface asks the question with the summary of its context (D-310).
    const summary = '5 roles: pm, tl, be, qa, security'
    const pane = { asked: question, text: withContext(MODEL_MODE_QUESTION, summary) }
    const context = { title: 'Roles', lines, kind: 'roles', summary, pane }
    const ask = { question, spec: { options: ['Same for all roles', 'Per role'], header: 'Model', context } }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
    const all = nextStage(state, { kind: 'answer', text: 'Same for all roles' })
    expect(all.openQuestion?.question).toBe(withContext('Model and effort for all roles?', MODEL_EFFORT_CONTEXT))
  })

  test('every model question carries the roles with their purposes and the scan changes (D-236)', () => {
    const changes = [{ roleId: 'fe', change: 'dropped', reason: 'No web code.', evidence: [] }] satisfies RoleChange[]
    const run = driven(modelStage.enter(stateAt('model', { roles, changes })), ['Per role'])
    const lines = proposalLines(roles, changes)
    const asks = [
      [withContext(MODEL_MODE_QUESTION, 'Roles: pm, tl, be, qa, security.'), MODEL_MODE_QUESTION],
      [withContext('Model and effort for PM (pm)?', MODEL_EFFORT_CONTEXT), 'Model and effort for PM (pm)?'],
    ]
    const summary = '5 roles: pm, tl, be, qa, security'
    const contexts = asks.map(([asked = '', sentence = '']) => ({
      title: 'Roles',
      lines,
      kind: 'roles',
      summary,
      pane: { asked, text: withContext(sentence, summary) },
    }))
    expect(run.specs.map(spec => spec.context)).toEqual(contexts)
  })

  test('Same for all roles, then a pair, ends the stage with every role on that model and effort', () => {
    const run = driven(modelStage.enter(stateAt('model', { roles })), ['Same for all roles', 'sonnet + high'])
    expect(run.state.draft.roles?.map(role => [role.id, role.model, role.effort])).toEqual(
      roles.map(role => [role.id, 'sonnet', 'high']),
    )
  })
})

describe('role title redaction (WD-S5, #163)', () => {
  test('a secret-like span of a role title is hidden in its model question and the roles context', () => {
    const roles = proposeRoles(SOURCE_SCAN).roles
    const [first] = roles
    const title = `Lead ${['token', 'ab12cd34ef56'].join('=')}`
    const titled = roles.map((role, at) => (at === 0 ? { ...role, title } : role))
    const run = driven(modelStage.enter(stateAt('model', { roles: titled })), ['Per role'])
    expect(run.asked[1]?.split('\n')[0]).toBe(`Model and effort for Lead token=${REDACTED} (${first?.id})?`)
    expect(JSON.stringify([run.asked, run.specs])).not.toContain('ab12cd34ef56')
  })
})
