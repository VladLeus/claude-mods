/**
 * The security plugins stage of init (decision #39, D-136), a layer 10 module: the question that names each missing
 * security plugin with one note for each (securityInstallQuestion), its context line that nothing is installed before
 * Confirm, the Install and Not now answers both install offers use (INSTALL_CHOICES, INSTALL_OPTIONS),
 * securityInstallStep, which asks it, and withSecuritySkill, which gives the claude-security review skill or takes it
 * away. Pure: it asks through the InitIo port it is given, imports core, roles, scope and ui/ask, and never imports
 * init.ts, which imports it, or init/run.
 */
import type { InitIo, RoleSpec } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { reportText } from '../../core/text'
import { CLAUDE_SECURITY_SKILL } from '../../roles/infra'
import { standsFor } from '../../roles/template'
import { pluginName } from '../../scope/lint'
import { accepted, ASK_HEADERS, askChoice, choiceResult, quotedLabels, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'

/** The start of the security plugins question, which init asks right after the recommendations (decision #39). */
export const SECURITY_INSTALL_PREFIX = 'Install from claude-plugins-official after you confirm the plan:'

/** The context line of the security plugins question (D-136): nothing is installed before Confirm or in a dry run. */
export const SECURITY_INSTALL_CONTEXT =
  'Nothing is installed before you confirm the final review, and a --dry-run installs nothing.'

/** What each security plugin does, by the plugin name before its `@`, as the question tells it (decision #39). */
const SECURITY_PLUGIN_NOTES: ReadonlyMap<string, string> = new Map([
  [
    'claude-security',
    'claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and ' +
      'writes CLAUDE-SECURITY-<time>/ report folders into the repo.',
  ],
  ['security-guidance', 'security-guidance adds hooks that warn about risky edits.'],
])

/**
 * The security plugins question (decision #39): SECURITY_INSTALL_PREFIX, the names of the missing plugins joined with
 * `and`, then one note for each, so the person knows before answering that claude-security needs Python 3.9 or newer
 * and writes report folders into the repo. `keys` are the plugin keys missingSecurityPlugins gives, each named by
 * pluginName (#72 B3) and shown cleaned and capped as a report cell is, like every printed key (decision #69 B7).
 */
export function securityInstallQuestion(keys: readonly string[]): string {
  const names = keys.map(pluginName)
  const notes = names.flatMap(name => SECURITY_PLUGIN_NOTES.get(name) ?? [])

  return `${SECURITY_INSTALL_PREFIX} ${names.map(reportText).join(' and ')}? ${notes.join(' ')}`
}

/**
 * Each answer to an install question with whether it installs: only Install does. It serves both install offers, the
 * security plugins (decision #39) and claude-md-management (D-141; 02-GAPS-B3 N6).
 */
export const INSTALL_CHOICES: readonly Labelled<boolean>[] = Object.freeze([
  { label: 'Install', value: true },
  { label: 'Not now', value: false },
])

/**
 * The answers to an install question, Install first: the dialog focuses the first option; the order is fixed
 * (decision #39). It serves both install offers, the security plugins and claude-md-management (D-141; 02-GAPS-B3 N6).
 */
export const INSTALL_OPTIONS: readonly string[] = Object.freeze(INSTALL_CHOICES.map(entry => entry.label))

/** Why init cancels when the security plugins question is dismissed or not answered (decision #39, A1, D-45). */
export const SECURITY_INSTALL_DISMISSED_REASON = 'The security plugins question was dismissed or not answered.'

/**
 * The security plugins step (decision #39, LNCH-01). With no key it asks nothing and is accepted with none. Else it
 * asks securityInstallQuestion, with SECURITY_INSTALL_CONTEXT on its second line (D-136), and the buttons
 * INSTALL_OPTIONS: Install, trimmed and in any case, is accepted with every key, and Not now with none; any other
 * answer is asked again with why on top. A dismissal is cancelled with SECURITY_INSTALL_DISMISSED_REASON and
 * MAX_ASKS answers that are neither with NO_USABLE_ANSWER_REASON (A1, D-45). It installs nothing itself: the keys are
 * installed only after Confirm, never in --dry-run (applyConfirmed).
 */
export async function securityInstallStep(
  io: InitIo,
  keys: readonly string[],
): Promise<StepResult<readonly string[]>> {
  if (keys.length === 0) return accepted([])
  const ask = {
    question: withContext(securityInstallQuestion(keys), SECURITY_INSTALL_CONTEXT),
    spec: { options: INSTALL_OPTIONS, header: ASK_HEADERS.security },
    parse: (answer: string): boolean | null => labelled(INSTALL_CHOICES, answer),
    accepts: quotedLabels(INSTALL_OPTIONS),
  }
  const isWanted = choiceResult(await askChoice(io, ask), SECURITY_INSTALL_DISMISSED_REASON)
  if (isWanted.kind === 'cancelled') return isWanted

  return accepted(isWanted.value ? keys : [])
}

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
