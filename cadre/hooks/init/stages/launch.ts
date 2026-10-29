/**
 * The launcher start stage of init (A2, A1, D-136), a layer 10 module: where the role launchers start, asked once per
 * repo with the role ids on its second line (launchContextLine): the git root, the folder a launcher is run from, or
 * another folder of the repo, which the folder question asks for and checks is a folder inside the repo
 * (launchDirStep); launchStartStep, which asks it; and launchLine, the line of the review and the init reply that says
 * where the launchers start. Pure: it asks and stats through the InitIo port it is given, imports core, paths, ui/ask
 * and init/stages/duration, and never imports init.ts, which imports it, or init/run.
 */
import type { InitIo, LaunchStart, RoleSpec } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { reportText, shown } from '../../core/text'
import { isRepoFolder, isSafeRelativePath } from '../../paths'
import {
  accepted,
  ASK_HEADERS,
  askChoice,
  askedText,
  askOnce,
  cancelled,
  choiceResult,
  MAX_ASKS,
  quotedLabels,
  withContext,
} from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import { idsOf } from './duration'

/** The question init asks once per repo, right after the git policy: where the role launchers start (A2). */
export const LAUNCH_START_QUESTION = 'Where should the role launchers start their sessions? (asked once for this repo)'

/** The context line of the launcher start question (D-136): the launcher of each role, by its id, starts there. */
export function launchContextLine(roles: readonly RoleSpec[]): string {
  return `The launcher of each role (${idsOf(roles)}) starts its session there.`
}

/** What the launcher start question picks: the git root, the folder a launcher is run from, or a typed folder. */
type LaunchChoice = 'git-root' | 'here' | 'dir'

/** Each launcher start with its dialog label and the word a person may type under "Other" (A2). */
type LaunchStartEntry = {
  readonly label: string
  readonly word: string
  readonly choice: LaunchChoice
}

const LAUNCH_STARTS: readonly LaunchStartEntry[] = Object.freeze([
  { label: 'Git root of this repo', word: 'git root', choice: 'git-root' },
  { label: 'The folder I run it from', word: 'in here', choice: 'here' },
  { label: 'Another folder in this repo', word: 'other', choice: 'dir' },
])

/**
 * The answers to the launcher start question, in the order git root, here, another folder: the dialog focuses the
 * first option; the order is fixed.
 */
export const LAUNCH_START_OPTIONS: readonly string[] = Object.freeze(LAUNCH_STARTS.map(entry => entry.label))

/** Each launcher start dialog label with what it picks. */
const LAUNCH_START_LABELS: readonly Labelled<LaunchChoice>[] = Object.freeze(
  LAUNCH_STARTS.map(entry => ({ label: entry.label, value: entry.choice })),
)

/** Each launcher start word a person may type under "Other", as a label with what it picks. */
const LAUNCH_START_WORDS: readonly Labelled<LaunchChoice>[] = Object.freeze(
  LAUNCH_STARTS.map(entry => ({ label: entry.word, value: entry.choice })),
)

/** The free-text question for the folder the launchers start in, after `Another folder in this repo` (A2). */
export const LAUNCH_DIR_QUESTION =
  'Type the folder the launchers start in, relative to the repo root (for example apps/web).'

/** The context line of the launcher folder question (D-136): which folders can be used. */
export const LAUNCH_DIR_CONTEXT = 'It must be a folder inside this repo; a link that leads out is refused.'

/** The one button of the folder question, which ends init; the folder itself is typed in the text field. */
const LAUNCH_DIR_CHOICES: readonly Labelled<'cancel'>[] = Object.freeze([{ label: 'Cancel init', value: 'cancel' }])

/** The buttons of the folder question. */
export const LAUNCH_DIR_OPTIONS: readonly string[] = Object.freeze(LAUNCH_DIR_CHOICES.map(entry => entry.label))

/** Why init cancels when the launcher start question is dismissed; unread answers give NO_USABLE_ANSWER_REASON. */
export const LAUNCH_START_DISMISSED_REASON = 'The launcher start question was dismissed or not answered.'

/** Why init cancels when the folder question is dismissed or `Cancel init` is chosen there. */
export const LAUNCH_DIR_CANCELLED_REASON = 'The launcher folder question was dismissed or cancelled.'

/** Why init cancels when no typed folder could be used after MAX_ASKS tries. */
export const LAUNCH_DIR_ROUNDS_REASON = `No usable launcher folder after ${MAX_ASKS} tries: nothing was chosen.`

/** The problem with a typed folder that isSafeRelativePath refuses. */
const UNSAFE_LAUNCH_DIR = 'use a folder inside this repo: letters, digits, . _ @ - and /, with no .. and no leading /'

/** The problem with a typed folder whose real path is not a folder inside the repo. */
const NOT_A_LAUNCH_DIR = 'it is not a folder in this repo'

/** The line of the init reply that says where the role launchers start (A2). */
export function launchLine(start: LaunchStart): string {
  if (start.kind === 'git-root') return 'Launchers start in: the git root'
  if (start.kind === 'here') return 'Launchers start in: the folder they are run from'

  return `Launchers start in: ${start.path}/ under the git root`
}

/** The launcher start an answer picks, by its label or its word, trimmed and in any case; else null. */
function parseLaunchChoice(answer: string): LaunchChoice | null {
  return labelled(LAUNCH_START_LABELS, answer) ?? labelled(LAUNCH_START_WORDS, answer)
}

/**
 * What is wrong with a typed launcher folder, or null when it can be used: the path must pass isSafeRelativePath, and
 * it must be a folder inside the repo (isRepoFolder), so a link anywhere in the path that leads out is refused, and so
 * is a folder whose real path the host could not give.
 */
async function launchDirProblem(io: InitIo, root: string, path: string): Promise<string | null> {
  if (!isSafeRelativePath(path)) return UNSAFE_LAUNCH_DIR
  if (!(await isRepoFolder(io, root, path))) return NOT_A_LAUNCH_DIR

  return null
}

/**
 * The folder question (A2), with LAUNCH_DIR_CONTEXT on its second line (D-136), asked at most MAX_ASKS times: `Cancel
 * init` or a dismissal cancels. An answer is trimmed and loses one trailing `/`; one that launchDirProblem refuses
 * puts `Cannot use <typed>: <problem>.`, cleaned as a report cell, on top of the next ask, and after MAX_ASKS refused
 * answers nothing is chosen (LAUNCH_DIR_ROUNDS_REASON). It keeps its own loop, not askChoice: its check is
 * asynchronous (isRepoFolder) and its refusal names the problem that check found.
 */
async function launchDirStep(io: InitIo, root: string): Promise<StepResult<LaunchStart>> {
  const spec = { options: LAUNCH_DIR_OPTIONS, header: ASK_HEADERS.launchDir }
  const question = withContext(LAUNCH_DIR_QUESTION, LAUNCH_DIR_CONTEXT)
  let refusal: string | null = null
  for (let asked = 0; asked < MAX_ASKS; asked += 1) {
    const answer = await askOnce(io, askedText(question, refusal), spec)
    const isCancel = answer === null || labelled(LAUNCH_DIR_CHOICES, answer) === 'cancel'
    if (isCancel) return cancelled(LAUNCH_DIR_CANCELLED_REASON)
    const trimmed = answer.trim()
    const path = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
    const problem = await launchDirProblem(io, root, path)
    if (problem === null) return accepted({ kind: 'dir', path })
    refusal = reportText(`Cannot use ${shown(answer)}: ${problem}.`)
  }

  return cancelled(LAUNCH_DIR_ROUNDS_REASON)
}

/** What the launcher start question takes, as its refusal lists it: a button or its word (A2, D-136). */
const LAUNCH_START_ACCEPTS = `${quotedLabels(LAUNCH_START_OPTIONS)} (or type git root, in here or other)`

/**
 * Where the role launchers start (A2), asked once per repo right after the git policy, with the ids of `roles` on its
 * second line (launchContextLine, D-136): `Git root of this repo`, `The folder I run it from`, or `Another folder in
 * this repo`, which asks for a folder relative to the repo root (launchDirStep). The labels and the words `git root`,
 * `in here` and `other` match trimmed and in any case, and any other answer is asked again with why on top. Only an
 * explicit answer gives a start: a dismissal (LAUNCH_START_DISMISSED_REASON), MAX_ASKS unlisted answers
 * (NO_USABLE_ANSWER_REASON) or no usable folder is cancelled with a reason, so nothing the person did not confirm is
 * used (A1).
 */
export async function launchStartStep(
  io: InitIo,
  root: string,
  roles: readonly RoleSpec[],
): Promise<StepResult<LaunchStart>> {
  const ask = {
    question: withContext(LAUNCH_START_QUESTION, launchContextLine(roles)),
    spec: { options: LAUNCH_START_OPTIONS, header: ASK_HEADERS.launch },
    parse: parseLaunchChoice,
    accepts: LAUNCH_START_ACCEPTS,
  }
  const picked = choiceResult(await askChoice(io, ask), LAUNCH_START_DISMISSED_REASON)
  if (picked.kind === 'cancelled') return picked
  const choice = picked.value
  if (choice === 'dir') return launchDirStep(io, root)

  return accepted({ kind: choice })
}
