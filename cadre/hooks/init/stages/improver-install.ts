/**
 * The improver install stage of init (G-02-1f, D-141, D-136, D-230), a layer 10 module: the claude-md-management
 * question, worded like the security plugins question, with its context line of what Not now leaves; hasBuiltPart,
 * whether a hand-out gives some role a built file with a part; and improverInstallStage, the pure stage that asks it
 * only then and only when the plugin is missing, with the Install and Not now answers of init/stages/security. Pure:
 * it gives states and never performs an effect, imports core, roles, ui/ask, init/state and init/stages/security, and
 * never imports init/machine or init/run.
 */
import type { AskSpec, InstructionHandout } from '../../../types'
import { labelled } from '../../core/labelled'
import { t } from '../../locales/t'
import { CLAUDE_MD_PLUGIN } from '../../roles/infra'
import { ASK_HEADERS, choiceAnswer, paneQuestionOf, quotedLabels, withContext } from '../../ui/ask'
import { improverInstallContext } from '../../ui/blocks/context'
import { asking, stageCancelled, stageDone, stageFailed } from '../state'
import type { Answer, InitState, StageDef } from '../state'
import { INSTALL_CHOICES, INSTALL_OPTIONS } from './security'

/**
 * The improver install question (G-02-1f, D-141), worded like the security plugins question: init asks it after that
 * question, when a role got a built file and claude-md-management is missing (improverInstallStage).
 */
export const IMPROVER_INSTALL_QUESTION = t('init.improverInstall.improverInstallQuestion')

/**
 * The context line of the improver install question (D-136, D-141): what Not now leaves, and that a dry run installs
 * nothing.
 */
export const IMPROVER_INSTALL_CONTEXT = t('init.improverInstall.improverInstallContext')

/** Why init cancels when the improver install question is dismissed or not answered (D-141, A1, D-45). */
export const IMPROVER_INSTALL_DISMISSED_REASON = t('init.improverInstall.improverInstallDismissedReason')

/**
 * Whether a hand-out gives some role a built file with a part (G-02-1f, D-141): a parts hand-out with a topic that
 * holds a part and is given to a role. Memories alone build no file, and the whole-file questions or none build none.
 */
function hasBuiltPart(handout: InstructionHandout): boolean {
  if (handout.kind !== 'parts') return false
  const { topics, given } = handout

  return topics.some(topic => topic.partIds.length > 0 && (given.get(topic.id) ?? []).length > 0)
}

/**
 * The improver install question as the stage asks it (D-136, D-141): IMPROVER_INSTALL_QUESTION with
 * IMPROVER_INSTALL_CONTEXT on its second line, the buttons of both install questions (INSTALL_OPTIONS) with the
 * Improver chip, Install or Not now trimmed and in any case, what its refusal lists, and the reason a dismissal
 * cancels with.
 */
const IMPROVER_ASK = Object.freeze({
  question: withContext(IMPROVER_INSTALL_QUESTION, IMPROVER_INSTALL_CONTEXT),
  spec: Object.freeze({ options: INSTALL_OPTIONS, header: ASK_HEADERS.improver }),
  parse: (answer: string): boolean | null => labelled(INSTALL_CHOICES, answer),
  accepts: quotedLabels(INSTALL_OPTIONS),
  dismissedReason: IMPROVER_INSTALL_DISMISSED_REASON,
})

/**
 * The ids of the roles a hand-out gives a built file with a part (hasBuiltPart), in the order of `roleIds`: each role
 * given a topic that holds a part.
 */
function builtRoleIds(handout: InstructionHandout, roleIds: readonly string[]): string[] {
  if (handout.kind !== 'parts') return []
  const { topics, given } = handout
  const built = topics.filter(topic => topic.partIds.length > 0).flatMap(topic => given.get(topic.id) ?? [])

  return roleIds.filter(id => built.includes(id))
}

/**
 * The dialog spec of the improver install question: IMPROVER_ASK's, with the roles the hand-out gives a built file as
 * its own context (improverInstallContext, D-236), whose summary a pane surface asks in place of
 * IMPROVER_INSTALL_CONTEXT (D-310).
 */
function improverSpec(state: InitState): AskSpec {
  const { instructions, roles } = state.draft
  const roleIds = (roles ?? []).map(role => role.id)
  const built = instructions === undefined ? [] : builtRoleIds(instructions, roleIds)
  const context = improverInstallContext(built)
  const pane = paneQuestionOf(IMPROVER_INSTALL_QUESTION, IMPROVER_INSTALL_CONTEXT, context.summary)

  return { ...IMPROVER_ASK.spec, context: { ...context, pane } }
}

/** The stage done with `installs` after the plugins answered Install before it, the security plugins first. */
function improverDone(state: InitState, installs: readonly string[]): InitState {
  const { pluginInstalls } = state.draft
  if (pluginInstalls === undefined) return stageFailed(state)

  return stageDone({ ...state, draft: { ...state.draft, pluginInstalls: [...pluginInstalls, ...installs] } })
}

/** The answer to the improver install question (choiceAnswer): Install adds CLAUDE_MD_PLUGIN, Not now nothing. */
function improverAnswer(state: InitState, answer: Answer): InitState {
  if (answer.kind !== 'answer' || state.sub.kind !== 'ask') return stageFailed(state)
  const next = choiceAnswer(IMPROVER_ASK, state.sub, answer.text)
  if (next.kind === 'again') return asking(state, next.question, improverSpec(state), next.sub.tries)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)

  return improverDone(state, next.value ? [CLAUDE_MD_PLUGIN] : [])
}

/**
 * The improver install stage (G-02-1f, D-141, D-230). When the hand-out gives no role a built file with a part
 * (hasBuiltPart), or claude-md-management is installed (CLAUDE_MD_PLUGIN among the setup's installed plugins), it asks
 * nothing and adds no key. Else it asks IMPROVER_ASK: Install adds CLAUDE_MD_PLUGIN after the plugins answered
 * Install before it, and Not now adds none, so no improver runs; any other answer is asked again with why on top. A
 * dismissal is cancelled with IMPROVER_INSTALL_DISMISSED_REASON and MAX_ASKS answers that are neither with
 * NO_USABLE_ANSWER_REASON (A1, D-45). It installs nothing itself: the key is installed only after Confirm, with the
 * other keys answered Install, never in --dry-run (applyConfirmed).
 */
export const improverInstallStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { instructions, gathered } = state.draft
    if (instructions === undefined || gathered === undefined) return stageFailed(state)
    const isMissing = !gathered.setup.installedPlugins.includes(CLAUDE_MD_PLUGIN)
    if (!hasBuiltPart(instructions) || !isMissing) return improverDone(state, [])

    return asking(state, IMPROVER_ASK.question, improverSpec(state), 1)
  },
  answer: improverAnswer,
})
