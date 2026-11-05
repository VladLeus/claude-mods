/**
 * The launcher start stage of init (A2, A1, D-136, D-230), a layer 10 module: where the role launchers start, asked
 * once per repo with the role ids on its second line (launchContextLine): the git root, the folder a launcher is run
 * from, or another folder of the repo, which the folder question asks for and has checked to be a folder inside the
 * repo (the launch-dir-check io effect); launchStage, the pure stage that asks them; and launchLine, the line of the
 * review and the init reply that says where the launchers start. Pure: it gives states and never performs an effect,
 * imports core, paths, ui/ask, init/state and init/stages/duration, and never imports init/machine or init/run.
 */
import type { LaunchStart, RoleSpec } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { reportText, shown } from '../../core/text'
import type { ListWords } from '../../core/text'
import { t } from '../../locales/t'
import { isSafeRelativePath } from '../../paths'
import { ASK_HEADERS, askedText, choiceAnswer, MAX_ASKS, orList, paneQuestionOf, quotedLabels } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import { launchContext, launchDirContext } from '../../ui/blocks/context'
import { asking, stageCancelled, stageDone, stageFailed, withEffect } from '../state'
import type { Answer, InitState, StageDef } from '../state'
import { idsOf } from './duration'

/** The question init asks once per repo, right after the git policy: where the role launchers start (A2). */
export const LAUNCH_START_QUESTION = t('init.launch.launchStartQuestion')

/** The context line of the launcher start question (D-136): the launcher of each role, by its id, starts there. */
export function launchContextLine(roles: readonly RoleSpec[]): string {
  return t('init.launch.launchContextLine', { ids: idsOf(roles) })
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
  { label: t('init.launch.startGitRoot'), word: 'git root', choice: 'git-root' },
  { label: t('init.launch.startHere'), word: 'in here', choice: 'here' },
  { label: t('init.launch.startOther'), word: 'other', choice: 'dir' },
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
export const LAUNCH_DIR_QUESTION = t('init.launch.launchDirQuestion')

/** The context line of the launcher folder question (D-136): which folders can be used. */
export const LAUNCH_DIR_CONTEXT = t('init.launch.launchDirContext')

/**
 * The buttons of the folder question (D-268): `Type a folder`, which reads as an empty answer when nothing was typed,
 * and `Cancel init`, which ends init; the folder itself is typed as a note or under Other.
 */
const LAUNCH_DIR_CHOICES: readonly Labelled<'type' | 'cancel'>[] = Object.freeze([
  { label: t('init.launch.dirType'), value: 'type' },
  { label: t('init.launch.dirCancel'), value: 'cancel' },
])

/**
 * The buttons of the folder question, `Type a folder` before `Cancel init` (D-268): two real choices, so the engine
 * never pads the dialog with Yes/No; the folder itself is typed as a note or under Other.
 */
export const LAUNCH_DIR_OPTIONS: readonly string[] = Object.freeze(LAUNCH_DIR_CHOICES.map(entry => entry.label))

/** The folder question's option that ends it, Cancel init, whose pick stands over any typed note (D-350). */
const LAUNCH_DIR_ENDING: readonly string[] = Object.freeze(
  LAUNCH_DIR_CHOICES.filter(entry => entry.value === 'cancel').map(entry => entry.label),
)

/** Why init cancels when the launcher start question is dismissed; unread answers give NO_USABLE_ANSWER_REASON. */
export const LAUNCH_START_DISMISSED_REASON = t('init.launch.launchStartDismissedReason')

/** Why init cancels when the folder question is dismissed or `Cancel init` is chosen there. */
export const LAUNCH_DIR_CANCELLED_REASON = t('init.launch.launchDirCancelledReason')

/** Why init cancels when no typed folder could be used after MAX_ASKS tries. */
export const LAUNCH_DIR_ROUNDS_REASON = t('init.launch.launchDirRoundsReason', { maxAsks: MAX_ASKS })

/** The problem with a typed folder that isSafeRelativePath refuses. */
const UNSAFE_LAUNCH_DIR = t('init.launch.unsafeLaunchDir')

/** The problem with a typed folder whose real path is not a folder inside the repo. */
const NOT_A_LAUNCH_DIR = t('init.launch.notALaunchDir')

/** The line of the init reply that says where the role launchers start (A2). */
export function launchLine(start: LaunchStart): string {
  if (start.kind === 'git-root') return t('init.launch.lineGitRoot')
  if (start.kind === 'here') return t('init.launch.lineHere')

  return t('init.launch.lineDir', { path: start.path })
}

/** The launcher start an answer picks, by its label or its word, trimmed and in any case; else null. */
function parseLaunchChoice(answer: string): LaunchChoice | null {
  return labelled(LAUNCH_START_LABELS, answer) ?? labelled(LAUNCH_START_WORDS, answer)
}

/** What the launcher start question takes, as its refusal lists it: a button or its word (A2, D-136). */
const LAUNCH_START_ACCEPTS = t('init.launch.launchStartAccepts', {
  quotedLabels: quotedLabels(LAUNCH_START_OPTIONS),
  words: orList(LAUNCH_STARTS.map(entry => entry.word)),
})

/**
 * The dialog of the folder question: its two buttons, Type a folder and Cancel init, with the Launch dir chip; a note
 * typed in it is the folder on every surface, a docked pane included (takesNote, D-270, D-348); Cancel init ends it,
 * even with a note typed (endingLabels, D-350).
 */
const LAUNCH_DIR_SPEC = Object.freeze({
  options: LAUNCH_DIR_OPTIONS,
  header: ASK_HEADERS.launchDir,
  takesNote: true,
  endingLabels: LAUNCH_DIR_ENDING,
})

/**
 * The launcher start question as the stage asks it (A2, D-136): LAUNCH_START_QUESTION with the ids of `roles` on its
 * second line (launchContextLine), the three starts with the Launch chip and what the git root and the run folder
 * mean as its own context (launchContext, its launcher map as `words` allows it, D-236, D-256), whose summary a pane
 * surface asks in place of that line (D-310), parseLaunchChoice, what its refusal lists, and the reason a dismissal
 * cancels with.
 */
function launchStartAsk(
  roles: readonly RoleSpec[],
  words: ListWords,
): ChoiceAsk<LaunchChoice> & { readonly dismissedReason: string } {
  const context = launchContext(roles, words)
  const contextLine = launchContextLine(roles)
  const pane = paneQuestionOf(LAUNCH_START_QUESTION, contextLine, context.summary)

  return {
    question: pane.asked,
    spec: { options: LAUNCH_START_OPTIONS, header: ASK_HEADERS.launch, context: { ...context, pane } },
    parse: parseLaunchChoice,
    accepts: LAUNCH_START_ACCEPTS,
    dismissedReason: LAUNCH_START_DISMISSED_REASON,
  }
}

/**
 * The folder question asked (A2), with LAUNCH_DIR_CONTEXT on its second line, `refusal` on top and the folders the
 * repo scan found code in as its own context (launchDirContext, D-236), whose summary a pane surface asks in place of
 * LAUNCH_DIR_CONTEXT (D-310), `tries` so far.
 */
function dirAsked(state: InitState, tries: number, refusal: string | null): InitState {
  const context = launchDirContext(state.draft.gathered?.repo.codeDirs ?? [], state.surface.listWords)
  const pane = paneQuestionOf(LAUNCH_DIR_QUESTION, LAUNCH_DIR_CONTEXT, context.summary)
  const question = askedText(pane.asked, refusal)
  const sub: InitState['sub'] = { kind: 'launch-dir', tries }
  const spec = { ...LAUNCH_DIR_SPEC, context: { ...context, pane } }

  return withEffect({ ...state, sub }, { kind: 'ask', question, spec })
}

/**
 * A typed folder refused with `problem`: `Cannot use <typed>: <problem>.`, cleaned as a report cell, goes on top of the
 * next ask; after MAX_ASKS refused answers nothing is chosen (LAUNCH_DIR_ROUNDS_REASON).
 */
function dirRefused(state: InitState, tries: number, answer: string, problem: string): InitState {
  if (tries >= MAX_ASKS) return stageCancelled(state, LAUNCH_DIR_ROUNDS_REASON)

  return dirAsked(state, tries + 1, reportText(t('init.launch.dirRefused', { answer: shown(answer), problem })))
}

/**
 * The answer to the launcher start question (choiceAnswer): the git root or the folder a launcher is run from ends the
 * stage with that start; `Another folder in this repo` asks for the folder. Any other answer is asked again with why on
 * top; a dismissal cancels with LAUNCH_START_DISMISSED_REASON and MAX_ASKS unlisted answers with
 * NO_USABLE_ANSWER_REASON (A1).
 */
function afterStart(state: InitState, answer: string | null): InitState {
  const { roles } = state.draft
  if (state.sub.kind !== 'ask' || roles === undefined) return stageFailed(state)
  const ask = launchStartAsk(roles, state.surface.listWords)
  const next = choiceAnswer(ask, state.sub, answer)
  if (next.kind === 'again') return asking(state, next.question, ask.spec, next.sub.tries)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  const choice = next.value
  if (choice === 'dir') return dirAsked(state, 1, null)

  return stageDone({ ...state, draft: { ...state.draft, launchStart: { kind: choice } } })
}

/**
 * The answer to the folder question (A2): `Cancel init` or a dismissal cancels with LAUNCH_DIR_CANCELLED_REASON.
 * `Type a folder` with nothing typed as a note or under Other is an empty answer, refused and asked again, counting a
 * try (D-268, the Describe-your-own pattern of D-234). An answer is trimmed and loses one trailing `/`; one
 * isSafeRelativePath refuses is asked again at once, and a safe one is checked to be a folder inside the repo (the
 * launch-dir-check io effect, isRepoFolder), so a link anywhere in the path that leads out is refused, and so is a
 * folder whose real path the host could not give.
 */
function afterDir(state: InitState, answer: string | null): InitState {
  const { locations } = state.draft
  if (state.sub.kind !== 'launch-dir' || locations === undefined) return stageFailed(state)
  const choice = answer === null ? null : labelled(LAUNCH_DIR_CHOICES, answer)
  if (answer === null || choice === 'cancel') return stageCancelled(state, LAUNCH_DIR_CANCELLED_REASON)
  const { tries } = state.sub
  const typed = choice === 'type' ? '' : answer
  const trimmed = typed.trim()
  const path = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
  if (!isSafeRelativePath(path)) return dirRefused(state, tries, typed, UNSAFE_LAUNCH_DIR)
  const sub: InitState['sub'] = { kind: 'launch-check', tries, answer: typed, path }

  return withEffect({ ...state, sub }, { kind: 'io', call: { id: 'launch-dir-check', root: locations.root, path } })
}

/** After the folder check: a folder inside the repo ends the stage with it; else it is asked again with why on top. */
function afterCheck(state: InitState, isFolder: boolean): InitState {
  if (state.sub.kind !== 'launch-check') return stageFailed(state)
  const { tries, answer, path } = state.sub
  if (isFolder) return stageDone({ ...state, draft: { ...state.draft, launchStart: { kind: 'dir', path } } })

  return dirRefused(state, tries, answer, NOT_A_LAUNCH_DIR)
}

/** The answer to the effect the launch stage has out: the start question, the folder question, or the check. */
function launchAnswer(state: InitState, answer: Answer): InitState {
  if (answer.kind === 'io' && answer.result.id === 'launch-dir-check') return afterCheck(state, answer.result.result)
  if (answer.kind !== 'answer') return stageFailed(state)
  if (state.sub.kind === 'launch-dir') return afterDir(state, answer.text)

  return afterStart(state, answer.text)
}

/**
 * Where the role launchers start (A2, D-230), asked once per repo right after the git policy, with the ids of the
 * roles on its second line (D-136): `Git root of this repo`, `The folder I run it from`, or `Another folder in this
 * repo`, which asks for a folder relative to the repo root (afterDir, afterCheck). Only an explicit answer gives a
 * start: a dismissal, MAX_ASKS unlisted answers or no usable folder is cancelled with a reason, so nothing the person
 * did not confirm is used (A1).
 */
export const launchStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { roles } = state.draft
    if (roles === undefined) return stageFailed(state)
    const ask = launchStartAsk(roles, state.surface.listWords)

    return asking(state, ask.question, ask.spec, 1)
  },
  answer: launchAnswer,
})
