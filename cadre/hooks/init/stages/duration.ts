/**
 * The autopilot duration stage of init (D-51, D-87, D-136, D-230), a layer 10 module: the duration question, asked
 * once for every role with their ids on its second line (durationContextLine), its buttons 4h, 2h and 8h,
 * durationStage, the pure stage that takes a duration in autopilot's grammar, and withDuration, which gives it to every
 * role; and idsOf, the team's role ids as a question's refusal or context line names them, which the other stages
 * read. Pure: it gives states and never performs an effect, imports roles, ui/ask and init/state, and never imports
 * init/machine or init/run.
 */
import type { RoleChange, RoleSpec } from '../../../types'
import { isAutopilotDuration } from '../../roles/validate'
import { ASK_HEADERS, choiceAnswer, withContext } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import { rolesContext } from '../../ui/blocks/context'
import { asking, stageCancelled, stageDone, stageFailed } from '../state'
import type { Answer, InitState, StageDef } from '../state'

/** The role ids of a team in role order, joined with `, `, as a question's refusal or context line names them. */
export function idsOf(roles: readonly RoleSpec[]): string {
  return roles.map(role => role.id).join(', ')
}

/** The question init asks once for every role: how long each autopilot run lasts (D-51). */
export const DURATION_QUESTION = 'Autopilot duration for roles?'

/** The context line of the duration question (D-136): the answer applies to every role, named by its id. */
export function durationContextLine(roles: readonly RoleSpec[]): string {
  return `Applies to every role: ${idsOf(roles)}.`
}

/** The duration buttons, 4h first; any other duration is typed under "Other" (D-51). */
export const DURATION_OPTIONS: readonly string[] = Object.freeze(['4h', '2h', '8h'])

/** Why init cancels when the duration question is dismissed (A1, D-45); unread answers give NO_USABLE_ANSWER_REASON. */
export const DURATION_DISMISSED_REASON = 'The autopilot duration question was dismissed or not answered.'

/** A duration answer, trimmed and lowercased, when it is in autopilot's grammar (isAutopilotDuration); else null. */
function parseDuration(answer: string): string | null {
  const duration = answer.trim().toLowerCase()

  return isAutopilotDuration(duration) ? duration : null
}

/** What the duration question takes, as its refusal lists it (D-51, D-136). */
const DURATION_ACCEPTS = 'a duration such as 4h, 90m or 1h30m, at most 168h'

/**
 * The duration question as the stage asks it (D-51, D-136): DURATION_QUESTION with the ids of `roles` on its second
 * line (durationContextLine), the buttons with the Duration chip and the roles with their purposes and scan `changes`
 * as its own context (rolesContext, D-236), parseDuration, what its refusal lists, and the reason a dismissal cancels
 * with.
 */
function durationAsk(
  roles: readonly RoleSpec[],
  changes: readonly RoleChange[],
): ChoiceAsk<string> & { readonly dismissedReason: string } {
  return {
    question: withContext(DURATION_QUESTION, durationContextLine(roles)),
    spec: { options: DURATION_OPTIONS, header: ASK_HEADERS.duration, context: rolesContext(roles, changes) },
    parse: parseDuration,
    accepts: DURATION_ACCEPTS,
    dismissedReason: DURATION_DISMISSED_REASON,
  }
}

/** The roles with this autopilot duration; every other autopilot value, the threshold included, stays as it was. */
export function withDuration(roles: readonly RoleSpec[], duration: string): RoleSpec[] {
  return roles.map(role => ({ ...role, autopilot: { ...role.autopilot, duration } }))
}

/** The stage done with `duration` in the draft and given to every role (withDuration). */
function durationDone(state: InitState, roles: readonly RoleSpec[], duration: string): InitState {
  return stageDone({ ...state, draft: { ...state.draft, duration, roles: withDuration(roles, duration) } })
}

/** The answer to the duration question (choiceAnswer): a duration ends the stage with it. */
function durationAnswer(state: InitState, answer: Answer): InitState {
  const { roles, changes } = state.draft
  if (answer.kind !== 'answer' || state.sub.kind !== 'ask' || roles === undefined) return stageFailed(state)
  const ask = durationAsk(roles, changes ?? [])
  const next = choiceAnswer(ask, state.sub, answer.text)
  if (next.kind === 'again') return asking(state, next.question, ask.spec, next.sub.tries)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)

  return durationDone(state, roles, next.value)
}

/**
 * The duration stage (D-51, D-87, D-230), asked once for every role, with the ids of the roles on its second line
 * (durationContextLine, D-136): 4h, 2h or 8h, or any duration typed under "Other". Only an answer in autopilot's
 * grammar, above zero and at most 168 hours, is a duration; any other is asked again with why on top, MAX_ASKS asks in
 * all. A dismissal is cancelled with DURATION_DISMISSED_REASON and MAX_ASKS answers that are no duration with
 * NO_USABLE_ANSWER_REASON, so nothing is taken (A1). A duration the draft already has is kept for every role with
 * nothing asked, as when Change roles runs the role steps again, except in the duration's own go-back from the review
 * (D-204), which asks it again. The context threshold is never asked: every role keeps AUTOPILOT_THRESHOLD (D-87).
 */
export const durationStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const { roles, changes, duration } = state.draft
    if (roles === undefined) return stageFailed(state)
    const isKept = duration !== undefined && state.returnAfter !== 'duration'
    if (isKept) return durationDone(state, roles, duration)
    const ask = durationAsk(roles, changes ?? [])

    return asking(state, ask.question, ask.spec, 1)
  },
  answer: durationAnswer,
})
