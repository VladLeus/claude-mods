import { describe, expect, test } from 'claude-code/testing'

import { proposeRoles } from '../../roles/propose'
import { AUTOPILOT_THRESHOLD } from '../../roles/template'
import { driven, memIo, memWorld, roleIn, SOURCE_SCAN, stateAt, templateRole, valueOf } from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import { MODEL_EFFORT_OPTIONS, modelEffortRefusal } from '../answers'
import { nextStage } from '../machine'
import { MODEL_DISMISSED_REASON, MODEL_EFFORT_CONTEXT, MODEL_MODE_QUESTION, modelStage, modelStep } from './model'

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

  test('the first model question offers Same for all roles first, then Per role', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'opus + medium'])
    await modelStep(run.io, roles)
    expect(MODEL_MODE_QUESTION).toBe('Model and effort: same for all roles, or per role?')
    expect(run.asked[0]).toBe(MODE_ASKED)
    expect(run.specs[0]).toEqual({ options: ['Same for all roles', 'Per role'], header: 'Model' })
  })

  test('Same for all roles asks once more and gives every role that model family and effort', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'sonnet + high'])
    const modelled = valueOf(await modelStep(run.io, roles))
    expect(modelled.map(role => [role.id, role.model, role.effort])).toEqual(
      roles.map(role => [role.id, 'sonnet', 'high']),
    )
    expect(run.asked).toEqual([MODE_ASKED, MODEL_ALL])
    expect(run.specs[1]).toEqual({ options: ['opus + medium', 'sonnet + medium', 'sonnet + high'], header: 'Model' })
    expect(run.logged).toEqual([])
  })

  test('Per role asks each role by its title and id in role order, each with the three options (A6)', async () => {
    const answers = ['Per role', 'opus + medium', 'sonnet + high', 'sonnet + medium', 'haiku low', 'OPUS+max']
    const run = memIo(memWorld({}), answers)
    const modelled = valueOf(await modelStep(run.io, roles))
    expect(run.asked).toEqual([
      MODE_ASKED,
      ...[
        'Model and effort for PM (pm)?',
        'Model and effort for Team Lead (tl)?',
        'Model and effort for BE (be)?',
        'Model and effort for QA (qa)?',
        'Model and effort for Security (security)?',
      ].map(question => withContext(question, MODEL_EFFORT_CONTEXT)),
    ])
    const each = { options: MODEL_EFFORT_OPTIONS, header: 'Model' }
    expect(run.specs.slice(1)).toEqual([each, each, each, each, each])
    expect(modelled.map(role => `${role.id}: ${role.model} ${role.effort}`)).toEqual([
      'pm: opus medium',
      'tl: sonnet high',
      'be: sonnet medium',
      'qa: haiku low',
      'security: opus max',
    ])
  })

  test('two roles with the same title are told apart by their ids in the per-role questions (A6)', async () => {
    const be = { ...roleIn(roles, 'be'), title: 'Backend' }
    const run = memIo(memWorld({}), ['Per role', 'opus + medium', 'sonnet + high'])
    const modelled = valueOf(await modelStep(run.io, [be, { ...be, id: 'be-api' }]))
    expect(run.asked).toEqual([
      withContext(MODEL_MODE_QUESTION, 'Roles: be, be-api.'),
      withContext('Model and effort for Backend (be)?', MODEL_EFFORT_CONTEXT),
      withContext('Model and effort for Backend (be-api)?', MODEL_EFFORT_CONTEXT),
    ])
    expect(modelled.map(role => [role.id, role.model, role.effort])).toEqual([
      ['be', 'opus', 'medium'],
      ['be-api', 'sonnet', 'high'],
    ])
  })

  test('a model that is no family alias puts the refusal line on top of the next ask (A4)', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'sonet + high', 'high high', 'opus + high'])
    const modelled = valueOf(await modelStep(run.io, roles))
    expect(modelled.map(role => [role.model, role.effort])).toEqual(roles.map(() => ['opus', 'high']))
    expect(run.asked).toEqual([
      MODE_ASKED,
      MODEL_ALL,
      `${modelEffortRefusal('sonet + high')}\n${MODEL_ALL}`,
      `${modelEffortRefusal('high high')}\n${MODEL_ALL}`,
    ])
    expect(run.logged).toEqual([])
  })

  test('MAX_ASKS refused models, a pinned id among them, cancel with no usable answer (A4, D-136)', async () => {
    const refused = ['claude-opus-5-5 high', 'opus', 'sonet high']
    const run = memIo(memWorld({}), ['Same for all roles', ...refused, 'opus + high'])
    expect(await modelStep(run.io, roles)).toEqual({ kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON })
    expect(run.asked).toEqual([
      MODE_ASKED,
      MODEL_ALL,
      `${modelEffortRefusal('claude-opus-5-5 high')}\n${MODEL_ALL}`,
      `${modelEffortRefusal('opus')}\n${MODEL_ALL}`,
    ])
    expect(run.logged).toEqual([])
  })

  test('each role keeps its duration and the threshold 65, asked nowhere, and the input is unchanged', async () => {
    const before = JSON.stringify(roles)
    const modelled = valueOf(await modelStep(memIo(memWorld({}), ['Per role', 'sonnet high']).io, roles.slice(0, 1)))
    expect(modelled.map(role => role.autopilot)).toEqual([{ duration: '90m', threshold: 65, askUser: true }])
    expect(roles.every(role => role.autopilot.threshold === AUTOPILOT_THRESHOLD)).toBe(true)
    expect(AUTOPILOT_THRESHOLD).toBe(65)
    expect(JSON.stringify(roles)).toBe(before)
  })

  test('a dismissal or unlisted answers at any model question cancel with their reason, no roles (A1)', async () => {
    const scripts: readonly (readonly [readonly string[], string])[] = [
      [[], MODEL_DISMISSED_REASON],
      [['Same for all roles'], MODEL_DISMISSED_REASON],
      [['Per role', 'opus + medium'], MODEL_DISMISSED_REASON],
      [['nope', 'nope', 'nope'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of scripts) {
      const run = memIo(memWorld({}), answers)
      expect(await modelStep(run.io, roles)).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(MODEL_DISMISSED_REASON).toBe('A model and effort question was dismissed or not answered.')
  })
})

describe('refusal re-ask (G-02-6b)', () => {
  test('the model loop puts its refusal on top of the next ask; three refused answers cancel (A4)', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'sonet + high', 'opus', 'high high'])
    const roles = [templateRole('pm')]
    expect(await modelStep(run.io, roles)).toEqual({ kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON })
    const all = withContext('Model and effort for all roles?', MODEL_EFFORT_CONTEXT)
    expect(run.asked).toEqual([
      withContext(MODEL_MODE_QUESTION, 'Roles: pm.'),
      all,
      `${modelEffortRefusal('sonet + high')}\n${all}`,
      `${modelEffortRefusal('opus')}\n${all}`,
    ])
    expect(run.logged).toEqual([])
    const dismissed = memIo(memWorld({}), ['Same for all roles', 'sonet + high'])
    expect(await modelStep(dismissed.io, roles)).toEqual({ kind: 'cancelled', reason: MODEL_DISMISSED_REASON })
  })
})

describe('the model stage (D-230)', () => {
  /** PM, Team Lead, BE, QA and Security: the team the model and effort are asked for. */
  const roles = proposeRoles(SOURCE_SCAN).roles

  test('modelStage asks Same for all roles or Per role with the team ids; the open question is that ask', () => {
    const state = modelStage.enter(stateAt('model', { roles }))
    const question = withContext(MODEL_MODE_QUESTION, 'Roles: pm, tl, be, qa, security.')
    const ask = { question, spec: { options: ['Same for all roles', 'Per role'], header: 'Model' } }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
    const all = nextStage(state, { kind: 'answer', text: 'Same for all roles' })
    expect(all.openQuestion?.question).toBe(withContext('Model and effort for all roles?', MODEL_EFFORT_CONTEXT))
  })

  test('Same for all roles, then a pair, ends the stage with every role on that model and effort', () => {
    const run = driven(modelStage.enter(stateAt('model', { roles })), ['Same for all roles', 'sonnet + high'])
    expect(run.state.draft.roles?.map(role => [role.id, role.model, role.effort])).toEqual(
      roles.map(role => [role.id, 'sonnet', 'high']),
    )
  })
})
