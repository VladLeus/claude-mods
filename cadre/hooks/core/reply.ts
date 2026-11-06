/**
 * The checks every model reply shares (D-83): the fence a reply may be wrapped in, the error cap and the errors sent
 * back with the next prompt. It holds no prompt text: the caller passes the words, which are PROMPTS text (D-221). It
 * imports no other module, so roles.ts, assign.ts and instructions.ts can all import it with no cycle (02-GAPS-B2 S7).
 */

/** The code fence a reply may be wrapped in. */
const CODE_FENCE = '```'

/** The most errors a reply check lists before it says there are more. */
export const MAX_REPLY_ERRORS = 20

/** The reply without the one code fence that may surround it, with or without a `json` tag, trimmed. */
export function unfenced(text: string): string {
  const trimmed = text.trim()
  const isFenced =
    trimmed.length >= 2 * CODE_FENCE.length && trimmed.startsWith(CODE_FENCE) && trimmed.endsWith(CODE_FENCE)
  if (!isFenced) return trimmed

  return trimmed.slice(CODE_FENCE.length, -CODE_FENCE.length).replace(/^json/i, '').trim()
}

/**
 * The errors of a reply check as it lists them: at most MAX_REPLY_ERRORS, then the caller's `more` line, which says
 * there are more.
 */
export function cappedErrors(errors: readonly string[], more: string): string[] {
  if (errors.length <= MAX_REPLY_ERRORS) return [...errors]

  return [...errors.slice(0, MAX_REPLY_ERRORS), more]
}

/** The prompt lines, then, after a failed reply, the caller's `intro` line and the errors, one per line. */
export function withReplyErrors(lines: readonly string[], errors: readonly string[], intro: string): string {
  if (errors.length === 0) return lines.join('\n')

  return [...lines, intro, ...errors.map(error => `- ${error}`)].join('\n')
}
