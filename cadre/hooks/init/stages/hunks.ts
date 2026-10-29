/**
 * The hunk questions of init (ROLE-04), a layer 10 module: the dialog for one hunk, a config change an adapter proposes
 * (hunkQuestion: the file and key, the before and after values, why, and whether autonomy requires it, with the
 * buttons Accept and Decline), and parseHunkAnswer, which reads the answer; the proposals and their ops are
 * framework/gsd/hunks'. Pure: it builds what init asks through the InitIo port, imports core and framework/gsd/hunks,
 * and never imports init.ts, which imports it, or init/run.
 */
import type { AskSpec } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { reportText } from '../../core/text'
import { targetText } from '../../framework/gsd/hunks'
import type { HunkCandidate } from '../../framework/gsd/hunks'

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
