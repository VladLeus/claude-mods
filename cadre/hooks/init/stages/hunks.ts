/**
 * The hunk stage of init (ROLE-04, D-70, D-71, D-72), a layer 10 module: the dialog for one hunk, a config change an
 * adapter proposes (hunkQuestion: the file and key, the before and after values, why, and whether autonomy requires
 * it, with the buttons Accept and Decline), parseHunkAnswer, which reads the answer, and hunkStep, which asks each
 * hunk the adapters of the team's frameworks offer and records each answer as an op; the proposals and their ops are
 * framework/gsd/hunks'. Pure: it asks and reads through the InitIo port it is given, imports core, framework, scan,
 * team and ui/ask, and never imports init.ts, which imports it, or init/run.
 */
import type { AskSpec, FrameworkId, HunkOp, InitIo, InitLocations, RoleSpec } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { reportText } from '../../core/text'
import { attendedNote, hunkCandidates, hunkOp, isUnmetHunk, targetText } from '../../framework/gsd/hunks'
import type { HunkCandidate } from '../../framework/gsd/hunks'
import { provenUserDir } from '../../framework/gsd/identity'
import { resolveToolCommand } from '../../framework/gsd/tools'
import { ADAPTERS } from '../../framework/registry'
import { MAX_READ_BYTES } from '../../scan/facts/normalize'
import type { Gathered } from '../../scan/gather'
import { readRepoFile } from '../../scan/port-read'
import { resolvedFramework } from '../../team'
import { accepted, askChoice, choiceResult, noteLine, quotedLabels } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'

/** The dialog button that accepts a hunk; a typed answer of the same word counts the same, in any case. */
const ACCEPT_OPTION = 'Accept'

/** The dialog button that declines a hunk; a typed answer of the same word counts the same, in any case. */
const DECLINE_OPTION = 'Decline'

/** The buttons of a hunk question, in this order: the dialog focuses the first option; the order is fixed. */
const HUNK_OPTIONS: readonly string[] = Object.freeze([ACCEPT_OPTION, DECLINE_OPTION])

/** Each hunk answer with whether it accepts the hunk: only Accept does (ROLE-04). */
const HUNK_ANSWERS: readonly Labelled<boolean>[] = Object.freeze([
  { label: ACCEPT_OPTION, value: true },
  { label: DECLINE_OPTION, value: false },
])

/** The last line of a hunk question for a change autonomy cannot work without. */
const REQUIRED_NOTE = 'Required for unattended GSD roles.'

/** The last line of a hunk question for a change that only helps. */
const OPTIONAL_NOTE = 'Optional.'

/**
 * The dialog for one hunk (ROLE-04): the file and key, the before and after values, why, and whether autonomy requires
 * it, under the header `Hunk <index> of <total>` with the buttons Accept and Decline. `index` counts from 1 in the
 * order of the candidates. GSD has three proposals at most, so the header stays within the 12-character chip a dialog
 * allows. Every value is cleaned and capped as a report cell is, so none can add a line or hide text.
 */
export function hunkQuestion(
  candidate: HunkCandidate,
  index: number,
  total: number,
): { readonly question: string; readonly spec: AskSpec } {
  const { proposal, before } = candidate
  const question = [
    `${reportText(proposal.file)}: ${reportText(proposal.key)}`,
    `  before: ${reportText(before)}`,
    `  after:  ${reportText(targetText(proposal))}`,
    `Why: ${reportText(proposal.why)}`,
    proposal.isRequired ? REQUIRED_NOTE : OPTIONAL_NOTE,
  ].join('\n')

  return { question, spec: { options: HUNK_OPTIONS, header: `Hunk ${index} of ${total}` } }
}

/**
 * The answer to a hunk question: true for Accept, false for Decline, in any case and trimmed, else null. Only the word
 * Accept accepts a hunk (ROLE-04): any other answer is null, so it is asked again and then cancels the run.
 */
export function parseHunkAnswer(answer: string): boolean | null {
  return labelled(HUNK_ANSWERS, answer)
}

/** Why init cancels when a hunk question is dismissed (A1, ROLE-04); unread answers give NO_USABLE_ANSWER_REASON. */
export const HUNK_DISMISSED_REASON = 'A hunk question was dismissed or not answered.'

/**
 * The autonomy hunk step (ROLE-04, D-70, D-71, D-72). The framework adapters decide the file and the proposals (A5):
 * for each adapter in ADAPTERS order whose framework a role runs on (resolvedFramework), autonomyHunks(setup) gives
 * the config file its hunks change and the proposals to offer, or null when the framework has no config file to
 * change. Each such file is read through readRepoFile, so a file that links out of the repo is unknown and never read.
 * When no adapter offers a hunk, nothing is asked and there are no hunks. Otherwise each hunk hunkCandidates offers is
 * asked one by one, in that order under `Hunk <i> of <n>`, as its before and after with Accept or Decline
 * (hunkQuestion, parseHunkAnswer). Each op records the answer, the exact command and whether cadre can run it, which
 * only a proven user-level GSD allows (provenUserDir, resolveToolCommand); nothing runs here. When a required hunk is
 * declined or cannot run (isUnmetHunk), the roles stay attended and the attended note names those keys. An answer that
 * is neither Accept nor Decline is asked again with why on top (D-136). A dismissal gives the cancel reason
 * HUNK_DISMISSED_REASON, and MAX_ASKS answers that are neither NO_USABLE_ANSWER_REASON, so no hunk counts as accepted
 * (A1).
 */
export async function hunkStep(
  io: InitIo,
  input: {
    readonly roles: readonly RoleSpec[]
    readonly repoDefault: FrameworkId | null
    readonly gathered: Gathered
    readonly locations: InitLocations
  },
): Promise<StepResult<readonly HunkOp[]>> {
  const { roles, repoDefault, gathered, locations } = input
  const inUse = roles.map(role => resolvedFramework(role, repoDefault))
  const candidates: HunkCandidate[] = []
  for (const adapter of ADAPTERS) {
    if (!inUse.includes(adapter.id)) continue
    const offered = adapter.autonomyHunks(gathered.setup)
    if (offered === null) continue
    const config = await readRepoFile(io, locations.root, offered.file, MAX_READ_BYTES)
    candidates.push(...hunkCandidates(offered.proposals, config))
  }
  if (candidates.length === 0) return accepted([])

  const gsd = {
    userDir: provenUserDir(gathered.facts),
    home: locations.home,
    root: locations.root,
    configDir: locations.configDir,
  }
  const hunks: HunkOp[] = []
  for (const [index, candidate] of candidates.entries()) {
    const { question, spec } = hunkQuestion(candidate, index + 1, candidates.length)
    const ask = { question, spec, parse: parseHunkAnswer, accepts: quotedLabels(spec.options) }
    const isAccepted = choiceResult(await askChoice(io, ask), HUNK_DISMISSED_REASON)
    if (isAccepted.kind === 'cancelled') return isAccepted
    hunks.push(hunkOp(candidate, isAccepted.value, resolveToolCommand(candidate.proposal.write, gsd)))
  }
  const unmet = hunks.filter(isUnmetHunk).map(hunk => hunk.key)
  if (unmet.length > 0) await noteLine(io, attendedNote(unmet))

  return accepted(hunks)
}
