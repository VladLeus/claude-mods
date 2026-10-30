/**
 * The hunk stage of init (ROLE-04, D-70, D-71, D-72, D-230), a layer 10 module: the dialog for one hunk, a config
 * change an adapter proposes (hunkQuestion: the file and key, the before and after values, why, and whether autonomy
 * requires it, with the buttons Accept and Decline), parseHunkAnswer, which reads the answer, and hunksStage, the pure
 * stage that has the config of each framework the roles run on read, asks each hunk its adapter offers and records
 * each answer as an op; the proposals and their ops are framework/gsd/hunks'. Pure: it gives states and never performs
 * an effect, imports core, framework, scan, team, ui/ask and init/state, and never imports init/machine or init/run.
 */
import type { AskSpec, AutonomyHunks, FrameworkId, HunkOp, PortRead, RoleSpec, SetupScan } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { reportText } from '../../core/text'
import { attendedNote, hunkCandidates, hunkOp, isUnmetHunk, targetText } from '../../framework/gsd/hunks'
import type { HunkCandidate } from '../../framework/gsd/hunks'
import { provenUserDir } from '../../framework/gsd/identity'
import { resolveToolCommand } from '../../framework/gsd/tools'
import type { GsdToolContext } from '../../framework/gsd/tools'
import { ADAPTERS } from '../../framework/registry'
import { MAX_READ_BYTES } from '../../scan/facts/normalize'
import { resolvedFramework } from '../../team'
import { choiceAnswer, quotedLabels } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import { stageCancelled, stageDone, stageFailed, withEffect, withOutputs } from '../state'
import type { Answer, InitState, StageDef } from '../state'

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
 * The config file and the proposals each framework adapter offers for the team (A5): for each adapter in ADAPTERS
 * order whose framework a role runs on (resolvedFramework), autonomyHunks(setup), skipped when the framework has no
 * config file to change.
 */
function offersOf(roles: readonly RoleSpec[], repoDefault: FrameworkId | null, setup: SetupScan): AutonomyHunks[] {
  const inUse = roles.map(role => resolvedFramework(role, repoDefault))

  return ADAPTERS.flatMap(adapter => {
    if (!inUse.includes(adapter.id)) return []
    const offered = adapter.autonomyHunks(setup)

    return offered === null ? [] : [offered]
  })
}

/** What the hunk stage works from: the offers for the team, the repo root, and where cadre finds the GSD tools. */
type HunkInput = {
  readonly offers: readonly AutonomyHunks[]
  readonly root: string
  readonly gsd: GsdToolContext
}

/**
 * The HunkInput of a state: the offers of the frameworks its roles run on, and the GSD tools of a proven user-level
 * GSD only (provenUserDir, D-71, D-72); null while a draft field it needs is not set.
 */
function hunkInput(state: InitState): HunkInput | null {
  const { roles, repoDefault, gathered, locations } = state.draft
  const isReady = roles !== undefined && repoDefault !== undefined && gathered !== undefined
  if (!isReady || locations === undefined) return null
  const { home, root, configDir } = locations

  return {
    offers: offersOf(roles, repoDefault, gathered.setup),
    root,
    gsd: { userDir: provenUserDir(gathered.facts), home, root, configDir },
  }
}

/** The hunks the offers give, in their order: each config read so far gives the candidates of its offer. */
function candidatesOf(offers: readonly AutonomyHunks[], reads: readonly PortRead[]): HunkCandidate[] {
  return offers.flatMap((offer, at) => {
    const read = reads[at]

    return read === undefined ? [] : hunkCandidates(offer.proposals, read)
  })
}

/** Where the hunk questions are: the configs read, the hunks answered so far, and how often the next one was asked. */
type HunkCursor = {
  readonly tries: number
  readonly reads: readonly PortRead[]
  readonly done: readonly HunkOp[]
}

/** A hunk question as the stage asks it (hunkQuestion): Accept or Decline, and the reason a dismissal cancels with. */
function hunkAsk(
  candidate: HunkCandidate,
  index: number,
  total: number,
): ChoiceAsk<boolean> & { readonly dismissedReason: string } {
  const { question, spec } = hunkQuestion(candidate, index, total)

  const accepts = quotedLabels(spec.options)

  return { question, spec, parse: parseHunkAnswer, accepts, dismissedReason: HUNK_DISMISSED_REASON }
}

/**
 * The stage done with `hunks`. When a required hunk is declined or cannot run (isUnmetHunk), the roles stay attended
 * and the attended note names those keys.
 */
function hunksDone(state: InitState, hunks: readonly HunkOp[]): InitState {
  const unmet = hunks.filter(isUnmetHunk).map(hunk => hunk.key)
  const noted = unmet.length === 0 ? state : withOutputs(state, [{ kind: 'note', line: attendedNote(unmet) }])

  return stageDone({ ...noted, draft: { ...noted.draft, hunks } })
}

/**
 * The question of the hunk after the ones `cursor` answered, under `Hunk <i> of <n>` (`question` is its text after a
 * refusal), or the stage done once each is answered; with no hunk offered nothing is asked and there are no hunks.
 */
function hunkAsked(state: InitState, input: HunkInput, cursor: HunkCursor, question: string | null): InitState {
  const candidates = candidatesOf(input.offers, cursor.reads)
  const index = cursor.done.length
  const candidate = candidates[index]
  if (candidate === undefined) return hunksDone(state, cursor.done)
  const ask = hunkAsk(candidate, index + 1, candidates.length)
  const asking: InitState = { ...state, sub: { kind: 'hunk', ...cursor } }

  return withEffect(asking, { kind: 'ask', question: question ?? ask.question, spec: ask.spec })
}

/**
 * The read of the config the next offer changes, after the ones in `reads` (the read-repo-file io effect, readRepoFile,
 * so a file that links out of the repo is unknown and never read), or, once each is read, the first hunk question.
 */
function nextRead(state: InitState, input: HunkInput, reads: readonly PortRead[]): InitState {
  const offer = input.offers[reads.length]
  if (offer === undefined) return hunkAsked(state, input, { tries: 1, reads, done: [] }, null)
  const reading: InitState = { ...state, sub: { kind: 'hunk-read', reads } }

  return withEffect(reading, {
    kind: 'io',
    call: { id: 'read-repo-file', root: input.root, path: offer.file, maxBytes: MAX_READ_BYTES },
  })
}

/**
 * The answer to a hunk question (choiceAnswer): its op records the answer, the exact command and whether cadre can
 * run it, which only a proven user-level GSD allows (resolveToolCommand); nothing runs here. An answer that is
 * neither Accept nor Decline is asked again with why on top (D-136); a dismissal cancels with HUNK_DISMISSED_REASON
 * and MAX_ASKS answers that are neither with NO_USABLE_ANSWER_REASON, so no hunk counts as accepted (A1).
 */
function afterHunk(state: InitState, input: HunkInput, cursor: HunkCursor, answer: string | null): InitState {
  const candidates = candidatesOf(input.offers, cursor.reads)
  const index = cursor.done.length
  const candidate = candidates[index]
  if (candidate === undefined) return stageFailed(state)
  const next = choiceAnswer(hunkAsk(candidate, index + 1, candidates.length), cursor, answer)
  if (next.kind === 'again') return hunkAsked(state, input, { ...cursor, tries: next.sub.tries }, next.question)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  const op = hunkOp(candidate, next.value, resolveToolCommand(candidate.proposal.write, input.gsd))

  return hunkAsked(state, input, { tries: 1, reads: cursor.reads, done: [...cursor.done, op] }, null)
}

/** The answer to the effect the hunk stage has out: a config read, or a hunk question. */
function hunkAnswer(state: InitState, answer: Answer): InitState {
  const input = hunkInput(state)
  if (input === null) return stageFailed(state)
  const { sub } = state
  const isRead = answer.kind === 'io' && answer.result.id === 'read-repo-file'
  if (isRead && sub.kind === 'hunk-read') return nextRead(state, input, [...sub.reads, answer.result.result])
  if (answer.kind !== 'answer' || sub.kind !== 'hunk') return stageFailed(state)

  return afterHunk(state, input, sub, answer.text)
}

/**
 * The autonomy hunk stage (ROLE-04, D-70, D-71, D-72, D-230). The framework adapters decide the file and the proposals
 * (A5, offersOf), and each such file is read first (nextRead). When no adapter offers a hunk, nothing is asked and
 * there are no hunks. Otherwise each hunk hunkCandidates offers is asked one by one, in that order under
 * `Hunk <i> of <n>`, as its before and after with Accept or Decline (hunkQuestion, parseHunkAnswer, afterHunk), and the
 * attended note names the required hunks left unmet (hunksDone).
 */
export const hunksStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const input = hunkInput(state)
    if (input === null) return stageFailed(state)

    return nextRead(state, input, [])
  },
  answer: hunkAnswer,
})
