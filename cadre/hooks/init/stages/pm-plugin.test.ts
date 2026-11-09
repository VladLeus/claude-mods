import { describe, expect, test } from 'claude-code/testing'

import type { RoleSpec } from '../../../types'
import { GRILL_SKILLS, MATTPOCOCK_PLUGIN } from '../../roles/infra'
import { INSTALL_COMMANDS } from '../../roles/recommend'
import { driven, emptySetupScan, stateAt, templateRole, wholeDraft } from '../../testkit'
import { paneQuestionOf, withContext } from '../../ui/ask'
import { rolesContext } from '../../ui/blocks/context'
import type { InitState } from '../state'
import { PM_PLUGIN_CONTEXT, PM_PLUGIN_DECLINED, PM_PLUGIN_QUESTION, pmPluginStage } from './pm-plugin'

/** PM, given one other mattpocock skill in the assignments, then TL and BE. */
const TEAM: readonly RoleSpec[] = [
  templateRole('pm', { skills: ['mattpocock-skills:tdd'] }),
  templateRole('tl'),
  templateRole('be'),
]

/** The PM plugin stage entered for `roles`, with these plugins installed for the repo. */
function pmPluginAt(roles: readonly RoleSpec[], installed: readonly string[] = []): InitState {
  const gathered = { ...wholeDraft().gathered, setup: emptySetupScan({ installedPlugins: installed }) }

  return pmPluginStage.enter(stateAt('pm-plugin', wholeDraft({ roles, gathered })))
}

/** The PM plugin stage entered for `roles` after a Yes earlier in this run, the plugin still missing. */
function afterYesAt(roles: readonly RoleSpec[]): InitState {
  const gathered = { ...wholeDraft().gathered, setup: emptySetupScan() }
  const draft = wholeDraft({ roles, gathered, projectPluginInstalls: [MATTPOCOCK_PLUGIN] })

  return pmPluginStage.enter(stateAt('pm-plugin', draft))
}

/** The skills of the role `id` the run ended with. */
function skillsOf(state: InitState, id: string): readonly string[] | undefined {
  return state.draft.roles?.find(role => role.id === id)?.skills
}

describe('the PM grill plugin stage', () => {
  test('the question names the plugin, the grill skills and the exact command; the declined line the command', () => {
    expect(PM_PLUGIN_QUESTION).toContain('mattpocock-skills')
    for (const skill of GRILL_SKILLS) expect(PM_PLUGIN_QUESTION).toContain(skill)
    expect(PM_PLUGIN_CONTEXT).toContain(INSTALL_COMMANDS.mattpocock)
    expect(PM_PLUGIN_DECLINED).toContain(INSTALL_COMMANDS.mattpocock)
  })

  test('with the plugin installed it asks nothing and gives every PM the grill skills once', () => {
    const grilled = TEAM.map(role =>
      role.id === 'pm' ? { ...role, skills: [...role.skills, 'mattpocock-skills:grilling'] } : role,
    )
    const run = driven(pmPluginAt(grilled, [MATTPOCOCK_PLUGIN]), [])

    expect([run.asked, run.outputs, run.state.sub]).toEqual([[], [], { kind: 'done' }])
    expect(skillsOf(run.state, 'pm')).toEqual(['mattpocock-skills:tdd', ...GRILL_SKILLS])
    expect(run.state.draft.roles?.slice(1)).toEqual(TEAM.slice(1))
    expect(run.state.draft.projectPluginInstalls ?? []).toEqual([])
  })

  test('with the plugin missing it asks one question, the declining answer first, with the Skills chip', () => {
    const state = pmPluginAt(TEAM)
    const question = withContext(PM_PLUGIN_QUESTION, PM_PLUGIN_CONTEXT)
    const context = rolesContext(TEAM, [])
    const pane = paneQuestionOf(PM_PLUGIN_QUESTION, PM_PLUGIN_CONTEXT, context.summary)
    const spec = { options: ['No', 'Yes, install it'], header: 'Skills', context: { ...context, pane } }

    expect(state.effect).toEqual({ kind: 'ask', question, spec })
  })

  test('Yes records the project install in the draft and gives PM the grill skills', () => {
    const run = driven(pmPluginAt(TEAM), ['Yes, install it'])

    expect([run.asked.length, run.outputs, run.state.stage]).toEqual([1, [], 'instructions'])
    expect(run.state.draft.projectPluginInstalls).toEqual([MATTPOCOCK_PLUGIN])
    expect(skillsOf(run.state, 'pm')).toEqual(['mattpocock-skills:tdd', ...GRILL_SKILLS])
  })

  test('No or a dismissal installs nothing, keeps the assigned skills and prints the command', () => {
    for (const answers of [['No'], [null], []]) {
      const run = driven(pmPluginAt(TEAM), answers)

      expect([run.state.stage, run.state.draft.roles]).toEqual(['instructions', TEAM])
      expect(run.state.draft.projectPluginInstalls ?? []).toEqual([])
      expect(run.outputs).toEqual([{ kind: 'note', line: PM_PLUGIN_DECLINED }])
    }
  })

  test('after an earlier Yes, No or a dismissal takes the grill skills off PM and installs nothing', () => {
    const grilled = [templateRole('pm', { skills: ['mattpocock-skills:tdd', ...GRILL_SKILLS] }), ...TEAM.slice(1)]
    for (const answers of [['No'], [null], []]) {
      const run = driven(afterYesAt(grilled), answers)

      expect(skillsOf(run.state, 'pm')).toEqual(['mattpocock-skills:tdd'])
      expect(run.state.draft.roles?.slice(1)).toEqual(TEAM.slice(1))
      expect(run.state.draft.projectPluginInstalls).toEqual([])
      expect(run.outputs).toEqual([{ kind: 'note', line: PM_PLUGIN_DECLINED }])
    }
  })

  test('with no earlier Yes, a No keeps a grill skill handed in assign', () => {
    const handed = [
      templateRole('pm', { skills: ['mattpocock-skills:tdd', 'mattpocock-skills:grilling'] }),
      ...TEAM.slice(1),
    ]
    const run = driven(pmPluginAt(handed), ['No'])

    expect(run.state.draft.roles).toEqual(handed)
    expect(run.state.draft.projectPluginInstalls).toEqual([])
    expect(run.outputs).toEqual([{ kind: 'note', line: PM_PLUGIN_DECLINED }])
  })

  test('Yes, then the stage entered again on a go-back and answered No, leaves PM without the grill skills', () => {
    const yes = driven(pmPluginAt(TEAM), ['Yes, install it'])
    const again = driven(pmPluginStage.enter(stateAt('pm-plugin', yes.state.draft)), ['No'])

    expect(yes.state.draft.projectPluginInstalls).toEqual([MATTPOCOCK_PLUGIN])
    expect(skillsOf(again.state, 'pm')).toEqual(['mattpocock-skills:tdd'])
    expect(again.state.draft.projectPluginInstalls).toEqual([])
  })

  test('a role based on pm loses the grill skills on a No after an earlier Yes too', () => {
    const product = templateRole('pm', { id: 'product', title: 'Product', skills: [...GRILL_SKILLS] })
    const run = driven(afterYesAt([product, templateRole('tl')]), ['No'])

    expect(skillsOf(run.state, 'product')).toEqual([])
    expect(run.state.draft.projectPluginInstalls).toEqual([])
  })

  test('an answer that is neither is asked again with why on top', () => {
    const run = driven(pmPluginAt(TEAM), ['maybe', 'Yes, install it'])
    const question = withContext(PM_PLUGIN_QUESTION, PM_PLUGIN_CONTEXT)

    expect(run.asked.length).toBe(2)
    expect([run.asked[1]?.startsWith("'maybe'"), run.asked[1]?.endsWith(question)]).toEqual([true, true])
    expect(run.state.draft.projectPluginInstalls).toEqual([MATTPOCOCK_PLUGIN])
  })

  test('a role based on pm stands for PM; a team with no PM is asked nothing and keeps its roles', () => {
    const product = templateRole('pm', { id: 'product', title: 'Product' })
    const based = driven(pmPluginAt([product, templateRole('tl')]), ['Yes, install it'])
    const team = [templateRole('tl'), templateRole('be')]
    const none = driven(pmPluginAt(team), [])

    expect(skillsOf(based.state, 'product')).toEqual([...GRILL_SKILLS])
    expect([none.asked, none.outputs, none.state.draft.roles]).toEqual([[], [], team])
    expect(none.state.draft.projectPluginInstalls ?? []).toEqual([])
  })

  test('a lookalike key of another marketplace is not the plugin: the question is still asked', () => {
    expect(pmPluginAt(TEAM, ['mattpocock-skills@other-market']).effect.kind).toBe('ask')
  })
})
