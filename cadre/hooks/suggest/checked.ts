/**
 * The checked model call, a layer 7 module: one model call with its retries, and the reply-check helpers every
 * suggest/ module shares (D-46, D-83; 02-GAPS-B2 S7). It imports core and the types, so init and the suggest/ modules
 * call the model here.
 */
import type { InitIo } from '../../types'
import { cappedErrors } from '../core/reply'

/** The most model calls one description gets: the first try and two retries with the exact errors (D-46, D-83). */
export const MAX_PROPOSE_ATTEMPTS = 3

/** The error the next prompt and the fallback line give when the model answered with no text. */
const NO_TEXT_ERROR = 'the model gave no text'

/** A model reply as a reply check of checkedCompletion takes it: the value it gives, or every error found. */
export type Checked<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'invalid'; readonly errors: readonly string[] }

/**
 * One model call with its retries (D-83; 02-GAPS-B2 S7: one home for the four of init): each reply goes through
 * `parse`, and a reply it cannot take, or no text at all (NO_TEXT_ERROR), is sent back through `prompt` with its exact
 * errors, MAX_PROPOSE_ATTEMPTS calls in all. Then it gives `fallback` of the last errors.
 */
export async function checkedCompletion<T>(
  io: InitIo,
  system: string,
  prompt: (errors: readonly string[]) => string,
  parse: (reply: string) => Checked<T>,
  fallback: (errors: readonly string[]) => T,
): Promise<T> {
  let errors: readonly string[] = []
  for (let attempt = 0; attempt < MAX_PROPOSE_ATTEMPTS; attempt += 1) {
    const reply = await io.complete(prompt(errors), system)
    const checked = reply === null ? null : parse(reply)
    if (checked?.kind === 'ok') return checked.value
    errors = checked === null ? [NO_TEXT_ERROR] : checked.errors
  }

  return fallback(errors)
}

/** The error every reply check gives a model reply that is not JSON. */
export const NOT_JSON_ERROR = 'the reply is not JSON'

/** A failed reply check with its errors, capped as every reply check caps them (cappedErrors). */
export function invalidReply(
  errors: readonly string[],
): { readonly kind: 'invalid'; readonly errors: readonly string[] } {
  return { kind: 'invalid', errors: cappedErrors(errors) }
}

/** The line that introduces the roles in the skills and the recommendation prompts. */
export const ROLES_INTRO = 'The roles of the team, one per line: id | title | purpose.'
