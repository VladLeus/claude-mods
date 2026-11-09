/**
 * The PM plugin stage of init, a layer 10 module: the question that offers PM's grill plugin, mattpocock-skills, for
 * install at project scope after Confirm, the declining answer first, and pmPluginStage, the pure stage that gives
 * every role standing for PM the grill skills when the plugin is installed and asks only while it is missing. A
 * decline after an earlier Yes takes the grill skills off again, so a go-back that declines leaves PM without them.
 * Pure: it gives states and never performs an effect, imports core, roles, ui/ask, ui/blocks/context and init/state,
 * and never imports init/machine or init/run.
 */
import type { AskSpec, RoleSpec } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { t } from '../../locales/t'
import { GRILL_SKILLS, MATTPOCOCK_PLUGIN } from '../../roles/infra'
import { INSTALL_COMMANDS, missingPmPlugins } from '../../roles/recommend'
import { standsFor } from '../../roles/template'
import {
  ASK_HEADERS,
  choiceAnswer,
  NO_USABLE_ANSWER_REASON,
  paneQuestionOf,
  quotedLabels,
  withContext,
} from '../../ui/ask'
import { rolesContext } from '../../ui/blocks/context'
import { asking, stageCancelled, stageDone, stageFailed, withOutputs } from '../state'
import type { Answer, InitState, Output, StageDef } from '../state'

/** The question that offers PM's grill plugin: it names the plugin and the grill skills it gives PM. */
export const PM_PLUGIN_QUESTION = t('init.pmPlugin.question', {
  skills: GRILL_SKILLS.join(t('init.pmPlugin.skillsJoin')),
})

/** The context line of that question: the exact command, run from the repo root after Confirm. */
export const PM_PLUGIN_CONTEXT = t('init.pmPlugin.context', { command: INSTALL_COMMANDS.mattpocock })

/** The line printed when the plugin is declined: PM runs without the grill skills, and the command that adds them. */
export const PM_PLUGIN_DECLINED = t('init.pmPlugin.declined', { command: INSTALL_COMMANDS.mattpocock })

/** Each answer with whether it installs, the declining one first. */
const PM_PLUGIN_ANSWERS: readonly Labelled<boolean>[] = Object.freeze([
  { label: t('init.pmPlugin.no'), value: false },
  { label: t('init.pmPlugin.yes'), value: true },
])

/** The answers as the dialog offers them. */
const PM_PLUGIN_OPTIONS: readonly string[] = Object.freeze(PM_PLUGIN_ANSWERS.map(answer => answer.label))

/** The question as the stage asks it; a dismissal declines, so only answers it cannot read cancel the run. */
const PM_PLUGIN_ASK = Object.freeze({
  question: withContext(PM_PLUGIN_QUESTION, PM_PLUGIN_CONTEXT),
  spec: Object.freeze({ options: PM_PLUGIN_OPTIONS, header: ASK_HEADERS.skills }),
  parse: (answer: string): boolean | null => labelled(PM_PLUGIN_ANSWERS, answer),
  accepts: quotedLabels(PM_PLUGIN_OPTIONS),
  dismissedReason: NO_USABLE_ANSWER_REASON,
})

/**
 * The dialog spec of the question: PM_PLUGIN_ASK's, with the team as its own context (rolesContext), whose summary a
 * pane surface asks in place of PM_PLUGIN_CONTEXT.
 */
function pmPluginSpec(state: InitState, roles: readonly RoleSpec[]): AskSpec {
  const context = rolesContext(roles, state.draft.changes ?? [])
  const pane = paneQuestionOf(PM_PLUGIN_QUESTION, PM_PLUGIN_CONTEXT, context.summary)

  return { ...PM_PLUGIN_ASK.spec, context: { ...context, pane } }
}

/** The roles with every role standing for PM given the grill skills once, last in its skills. */
function withGrillSkills(roles: readonly RoleSpec[]): RoleSpec[] {
  return roles.map(role => {
    if (!standsFor(role, 'pm')) return role
    const skills = role.skills.filter(skill => !GRILL_SKILLS.includes(skill))

    return { ...role, skills: [...skills, ...GRILL_SKILLS] }
  })
}

/** The roles with each grill skill taken off every role standing for PM, its other skills in order. */
function withoutGrillSkills(roles: readonly RoleSpec[]): RoleSpec[] {
  return roles.map(role => {
    if (!standsFor(role, 'pm')) return role

    return { ...role, skills: role.skills.filter(skill => !GRILL_SKILLS.includes(skill)) }
  })
}

/** The stage done with these roles and the project plugin installs to run after Confirm. */
function pmPluginDone(state: InitState, roles: readonly RoleSpec[], installs: readonly string[]): InitState {
  return stageDone({ ...state, draft: { ...state.draft, roles, projectPluginInstalls: installs } })
}

/**
 * The stage done with no install, printing the command that adds the grill skills. When an earlier Yes in this run
 * gave PM the grill skills, they are taken off again; skills handed in assign stand.
 */
function declined(state: InitState, roles: readonly RoleSpec[]): InitState {
  const note: Output[] = [{ kind: 'note', line: PM_PLUGIN_DECLINED }]
  const isAfterYes = (state.draft.projectPluginInstalls ?? []).includes(MATTPOCOCK_PLUGIN)
  if (!isAfterYes) return withOutputs(pmPluginDone(state, roles, []), note)

  return withOutputs(pmPluginDone(state, withoutGrillSkills(roles), []), note)
}

/**
 * The answer to the question: Yes records MATTPOCOCK_PLUGIN to install and gives PM the grill skills; No or a
 * dismissal declines, and takes off the grill skills an earlier Yes gave. An answer that is neither is asked again
 * with why on top.
 */
function pmPluginAnswer(state: InitState, answer: Answer): InitState {
  const { roles } = state.draft
  if (answer.kind !== 'answer' || state.sub.kind !== 'ask' || roles === undefined) return stageFailed(state)
  if (answer.text === null) return declined(state, roles)
  const next = choiceAnswer(PM_PLUGIN_ASK, state.sub, answer.text)
  if (next.kind === 'again') return asking(state, next.question, pmPluginSpec(state, roles), next.sub.tries)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  if (!next.value) return declined(state, roles)

  return pmPluginDone(state, withGrillSkills(roles), [MATTPOCOCK_PLUGIN])
}

/**
 * The PM plugin stage. A team with no role standing for PM is asked nothing. With mattpocock-skills installed for the
 * repo, every PM gets the grill skills and nothing is asked; while it is missing (missingPmPlugins) the question is
 * asked. It installs nothing itself: a recorded key is installed only after Confirm, never in --dry-run.
 */
export const pmPluginStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { roles, gathered } = state.draft
    if (roles === undefined || gathered === undefined) return stageFailed(state)
    if (!roles.some(role => standsFor(role, 'pm'))) return pmPluginDone(state, roles, [])
    if (missingPmPlugins(roles, gathered.setup).length === 0) return pmPluginDone(state, withGrillSkills(roles), [])

    return asking(state, PM_PLUGIN_ASK.question, pmPluginSpec(state, roles), 1)
  },
  answer: pmPluginAnswer,
})
