/**
 * The autopilot duration stage of init (D-51, D-87, D-136), a layer 10 module: the duration question, asked once for
 * every role with their ids on its second line (durationContextLine), its buttons 4h, 2h and 8h, durationStep, which
 * takes a duration in autopilot's grammar, and withDuration, which gives it to every role; and idsOf, the team's role
 * ids as a question's refusal or context line names them, which the other stages read. Pure: it asks through the
 * InitIo port it is given, imports roles and ui/ask, and never imports init.ts, which imports it, or init/run.
 */
import type { InitIo, RoleSpec } from '../../../types'
import { isAutopilotDuration } from '../../roles/validate'
import { ASK_HEADERS, askChoice, choiceResult, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'

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
 * The duration question (D-51), asked once for every role, with the ids of `roles` on its second line
 * (durationContextLine, D-136): 4h, 2h or 8h, or any duration typed under "Other". Only an answer in autopilot's
 * grammar, above zero and at most 168 hours, is a duration; any other is asked again with why on top, MAX_ASKS asks in
 * all. A dismissal gives the cancel reason DURATION_DISMISSED_REASON and MAX_ASKS answers that are no duration
 * NO_USABLE_ANSWER_REASON, so nothing is taken (A1). The context threshold is never asked: every role keeps
 * AUTOPILOT_THRESHOLD (D-87).
 */
export async function durationStep(io: InitIo, roles: readonly RoleSpec[]): Promise<StepResult<string>> {
  const ask = {
    question: withContext(DURATION_QUESTION, durationContextLine(roles)),
    spec: { options: DURATION_OPTIONS, header: ASK_HEADERS.duration },
    parse: parseDuration,
    accepts: DURATION_ACCEPTS,
  }

  return choiceResult(await askChoice(io, ask), DURATION_DISMISSED_REASON)
}

/** The roles with this autopilot duration; every other autopilot value, the threshold included, stays as it was. */
export function withDuration(roles: readonly RoleSpec[], duration: string): RoleSpec[] {
  return roles.map(role => ({ ...role, autopilot: { ...role.autopilot, duration } }))
}
