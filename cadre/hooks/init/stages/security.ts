/**
 * The security plugins stage of init (decision #39, ROLE-03, D-136, D-230), a layer 10 module: the question that names
 * each missing security plugin with one note for each (securityInstallQuestion), its context line that nothing is
 * installed before Confirm, the Install and Not now answers both install offers use (INSTALL_CHOICES,
 * INSTALL_OPTIONS), withSecuritySkill, which gives the claude-security review skill or takes it away, and
 * securityStage, the pure stage that shows the recommendations for the team and asks it. Pure: it gives states and
 * never performs an effect, imports core, roles, scope, team, ui and init/state, and never imports init/machine or
 * init/run.
 */
import type { RoleSpec, SetupScan } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { reportText } from '../../core/text'
import { t } from '../../locales/t'
import { CLAUDE_SECURITY_PLUGIN, CLAUDE_SECURITY_SKILL } from '../../roles/infra'
import { missingSecurityPlugins, recommend } from '../../roles/recommend'
import { standsFor } from '../../roles/template'
import { pluginName } from '../../scope/lint'
import { resolvedFramework } from '../../team'
import { ASK_HEADERS, choiceAnswer, paneQuestionOf, quotedLabels } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import { SECURITY_PLUGIN_NOTES, securityContext } from '../../ui/blocks/context'
import { recommendationLines } from '../../ui/blocks/recommendations'
import { asking, stageCancelled, stageDone, stageFailed, withOutputs } from '../state'
import type { Answer, InitState, StageDef } from '../state'

/** The start of the security plugins question, which init asks right after the recommendations (decision #39). */
export const SECURITY_INSTALL_PREFIX = t('init.security.securityInstallPrefix')

/** The context line of the security plugins question (D-136): nothing is installed before Confirm or in a dry run. */
export const SECURITY_INSTALL_CONTEXT = t('init.security.securityInstallContext')

/**
 * The security plugins question (decision #39): SECURITY_INSTALL_PREFIX, the names of the missing plugins joined with
 * `and`, then one note for each, so the person knows before answering that claude-security needs Python 3.9 or newer
 * and writes report folders into the repo. `keys` are the plugin keys missingSecurityPlugins gives, each named by
 * pluginName (#72 B3) and shown cleaned and capped as a report cell is, like every printed key (decision #69 B7).
 */
export function securityInstallQuestion(keys: readonly string[]): string {
  const names = keys.map(pluginName)
  const notes = names.flatMap(name => SECURITY_PLUGIN_NOTES.get(name) ?? [])

  const shown = names.map(reportText).join(t('init.security.namesJoin'))

  return t('init.security.installQuestion', { prefix: SECURITY_INSTALL_PREFIX, names: shown, notes: notes.join(' ') })
}

/**
 * Each answer to an install question with whether it installs: only Install does. It serves both install offers, the
 * security plugins (decision #39) and claude-md-management (D-141; 02-GAPS-B3 N6).
 */
export const INSTALL_CHOICES: readonly Labelled<boolean>[] = Object.freeze([
  { label: t('init.security.choiceInstall'), value: true },
  { label: t('init.security.choiceNotNow'), value: false },
])

/**
 * The answers to an install question, Install first: the dialog focuses the first option; the order is fixed
 * (decision #39). It serves both install offers, the security plugins and claude-md-management (D-141; 02-GAPS-B3 N6).
 */
export const INSTALL_OPTIONS: readonly string[] = Object.freeze(INSTALL_CHOICES.map(entry => entry.label))

/** Why init cancels when the security plugins question is dismissed or not answered (decision #39, A1, D-45). */
export const SECURITY_INSTALL_DISMISSED_REASON = t('init.security.securityInstallDismissedReason')

/**
 * The roles with the claude-security review skill given or taken away (decision #39): each role that stands for
 * Security, by its id or its `basedOn`, has CLAUDE_SECURITY_SKILL once, last in its skills, when `isWanted`, and not at
 * all when not; every other role is kept as it is. The roles given are not changed.
 */
export function withSecuritySkill(roles: readonly RoleSpec[], isWanted: boolean): RoleSpec[] {
  return roles.map(role => {
    if (!standsFor(role, 'security')) return role
    const skills = role.skills.filter(skill => skill !== CLAUDE_SECURITY_SKILL)

    return { ...role, skills: isWanted ? [...skills, CLAUDE_SECURITY_SKILL] : skills }
  })
}

/**
 * The security plugins question as the stage asks it (decision #39, D-136): securityInstallQuestion for `keys`, with
 * SECURITY_INSTALL_CONTEXT on its second line, the buttons INSTALL_OPTIONS with the Security chip and the missing
 * plugins as its own context (securityContext, D-236), which a pane surface asks with its first line in place of that
 * line (D-255), Install or Not now trimmed and in any case, what its refusal lists, and the reason a dismissal cancels
 * with.
 */
function securityAsk(keys: readonly string[]): ChoiceAsk<boolean> & { readonly dismissedReason: string } {
  const context = securityContext(keys)
  const line = context.lines[0] ?? SECURITY_INSTALL_CONTEXT
  const pane = paneQuestionOf(securityInstallQuestion(keys), SECURITY_INSTALL_CONTEXT, line)

  return {
    question: pane.asked,
    spec: { options: INSTALL_OPTIONS, header: ASK_HEADERS.security, context: { ...context, pane } },
    parse: (answer: string): boolean | null => labelled(INSTALL_CHOICES, answer),
    accepts: quotedLabels(INSTALL_OPTIONS),
    dismissedReason: SECURITY_INSTALL_DISMISSED_REASON,
  }
}

/**
 * The stage done with `installs`, the plugins to install after Confirm: when claude-security was asked about, every
 * role that stands for Security gets its review skill on Install and loses it on Not now (withSecuritySkill).
 */
function installsDone(
  state: InitState,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  installs: readonly string[],
): InitState {
  const isSkillAsked = missingSecurityPlugins(roles, setup).includes(CLAUDE_SECURITY_PLUGIN)
  const team = isSkillAsked ? withSecuritySkill(roles, installs.includes(CLAUDE_SECURITY_PLUGIN)) : roles

  return stageDone({ ...state, draft: { ...state.draft, roles: team, pluginInstalls: installs } })
}

/** The answer to the security plugins question (choiceAnswer): Install gives every missing key, Not now none. */
function securityAnswer(state: InitState, answer: Answer): InitState {
  const { roles, gathered } = state.draft
  const isOpen = answer.kind === 'answer' && state.sub.kind === 'ask'
  if (!isOpen || roles === undefined || gathered === undefined) return stageFailed(state)
  const keys = missingSecurityPlugins(roles, gathered.setup)
  const ask = securityAsk(keys)
  const next = choiceAnswer(ask, state.sub, answer.text)
  if (next.kind === 'again') return asking(state, next.question, ask.spec, next.sub.tries)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)

  return installsDone(state, roles, gathered.setup, next.value ? keys : [])
}

/**
 * The security plugins stage (decision #39, ROLE-03, LNCH-01, D-230): the recommendations block for the team in the
 * side pane first, then, for the plugins a team with a Security role misses (missingSecurityPlugins), the security
 * plugins question (securityAsk): Install gives every missing key and Not now none; any other answer is asked again
 * with why on top. With no key it asks nothing and installs nothing. A dismissal is cancelled with
 * SECURITY_INSTALL_DISMISSED_REASON and MAX_ASKS answers that are neither with NO_USABLE_ANSWER_REASON (A1, D-45). It
 * installs nothing itself: the keys are installed only after Confirm, never in --dry-run (applyConfirmed).
 */
export const securityStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { roles, repoDefault, gathered } = state.draft
    if (roles === undefined || repoDefault === undefined || gathered === undefined) return stageFailed(state)
    const frameworks = roles.map(role => resolvedFramework(role, repoDefault))
    const recommendations = recommend({ roles, frameworks, scan: gathered.repo, setup: gathered.setup })
    const lines = recommendationLines(recommendations, roles)
    const shown = withOutputs(state, [{ kind: 'show', block: { key: 'recommendations', lines } }])
    const keys = missingSecurityPlugins(roles, gathered.setup)
    if (keys.length === 0) return installsDone(shown, roles, gathered.setup, [])
    const ask = securityAsk(keys)

    return asking(shown, ask.question, ask.spec, 1)
  },
  answer: securityAnswer,
})
