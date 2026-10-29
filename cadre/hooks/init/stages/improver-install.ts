/**
 * The improver install stage of init (G-02-1f, D-141, D-136), a layer 10 module: the claude-md-management question,
 * worded like the security plugins question, with its context line of what Not now leaves; hasBuiltPart, whether a
 * hand-out gives some role a built file with a part; and improverInstallStep, which asks it only then and only when
 * the plugin is missing, with the Install and Not now answers of init/stages/security. Pure: it asks through the
 * InitIo port it is given, imports core, roles, ui/ask and init/stages/security, and never imports init.ts, which
 * imports it, or init/run.
 */
import type { InitIo, InstructionHandout, SetupScan } from '../../../types'
import { labelled } from '../../core/labelled'
import { CLAUDE_MD_PLUGIN } from '../../roles/infra'
import { accepted, ASK_HEADERS, askChoice, choiceResult, quotedLabels, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import { INSTALL_CHOICES, INSTALL_OPTIONS } from './security'

/**
 * The improver install question (G-02-1f, D-141), worded like the security plugins question: init asks it after that
 * question, when a role got a built file and claude-md-management is missing (improverInstallStep).
 */
export const IMPROVER_INSTALL_QUESTION =
  'Install claude-md-management from claude-plugins-official after you confirm the plan? Its claude-md-improver ' +
  "tidies each role's built CLAUDE.md, and you accept or keep each change."

/**
 * The context line of the improver install question (D-136, D-141): what Not now leaves, and that a dry run installs
 * nothing.
 */
export const IMPROVER_INSTALL_CONTEXT =
  'Without it the built files stay as cadre wrote them; a --dry-run installs nothing.'

/** Why init cancels when the improver install question is dismissed or not answered (D-141, A1, D-45). */
export const IMPROVER_INSTALL_DISMISSED_REASON = 'The claude-md-management question was dismissed or not answered.'

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
 * The improver install step (G-02-1f, D-141). When the hand-out gives no role a built file with a part (hasBuiltPart),
 * or claude-md-management is installed (CLAUDE_MD_PLUGIN among the setup's installed plugins), it asks nothing and is
 * accepted with no key. Else it asks IMPROVER_INSTALL_QUESTION, with IMPROVER_INSTALL_CONTEXT on its second line
 * (D-136), the buttons of both install questions (INSTALL_OPTIONS) and the Improver chip: Install is accepted with
 * CLAUDE_MD_PLUGIN, and Not now with none, so no improver runs; any other answer is asked again with why on top. A
 * dismissal is cancelled with IMPROVER_INSTALL_DISMISSED_REASON and MAX_ASKS answers that are neither with
 * NO_USABLE_ANSWER_REASON (A1, D-45). It installs nothing itself: the key is installed only after Confirm, with the
 * other keys answered Install, never in --dry-run (applyConfirmed).
 */
export async function improverInstallStep(
  io: InitIo,
  handout: InstructionHandout,
  setup: SetupScan,
): Promise<StepResult<readonly string[]>> {
  if (!hasBuiltPart(handout) || setup.installedPlugins.includes(CLAUDE_MD_PLUGIN)) return accepted([])
  const ask = {
    question: withContext(IMPROVER_INSTALL_QUESTION, IMPROVER_INSTALL_CONTEXT),
    spec: { options: INSTALL_OPTIONS, header: ASK_HEADERS.improver },
    parse: (answer: string): boolean | null => labelled(INSTALL_CHOICES, answer),
    accepts: quotedLabels(INSTALL_OPTIONS),
  }
  const isWanted = choiceResult(await askChoice(io, ask), IMPROVER_INSTALL_DISMISSED_REASON)
  if (isWanted.kind === 'cancelled') return isWanted

  return accepted(isWanted.value ? [CLAUDE_MD_PLUGIN] : [])
}
