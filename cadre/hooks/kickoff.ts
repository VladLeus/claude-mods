/** The role name is short and shown once, on the first line. A longer name is cut, counted in code points. */
export const MAX_ROLE_CHARS = 40

/**
 * The spec path cap, counted in code points. It is about the Windows MAX_PATH limit, beyond which a legacy Windows
 * path cannot be opened.
 */
export const MAX_SPEC_PATH_CHARS = 260

/** The role word used when a role name has nothing left after cleaning and trimming. */
export const UNNAMED_ROLE = 'unnamed'

/** Marks text that was cut to its cap. */
const ELLIPSIS = '\u{2026}'

/**
 * Characters that can split a kickoff line or hide text: control, format, surrogate, private-use, and line and
 * paragraph separators. They are removed from any text that comes from outside the adapter.
 */
const UNSAFE_KICKOFF_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu

/**
 * The rule autopilot uses to spot its done marker (isDoneAnswer in autopilot/hooks/autopilot.ts): AUTOPILOT_DONE at
 * the start of a line, after optional spaces or tabs. Tests use it to prove that no kickoff line other than the done
 * line reads as the marker.
 */
export const DONE_MARKER_LINE = /^[ \t]*AUTOPILOT_DONE\b/m

/**
 * Text from outside the adapter, such as a role name or a repo path, as it may appear in a kickoff. Unsafe characters
 * are removed, so the text cannot start a new kickoff line or hide itself. The rest is cut to maxChars code points, and
 * a cut ends in an ellipsis.
 */
export function cleanKickoffText(value: string, maxChars: number): string {
  const stripped = value.replace(UNSAFE_KICKOFF_TEXT, '')
  const points = Array.from(stripped)
  if (points.length <= maxChars) return stripped

  return `${points.slice(0, maxChars - 1).join('')}${ELLIPSIS}`
}

/**
 * Text from outside the adapter cleaned and capped as cleanKickoffText does, or the fallback when nothing is left once
 * cleaned and trimmed, so a kickoff never shows a blank where the text belongs. A role falls back to UNNAMED_ROLE; a
 * spec path falls back to null, which means no spec line.
 */
export function cleanKickoffTextOr<T>(value: string, maxChars: number, fallback: T): string | T {
  const cleaned = cleanKickoffText(value, maxChars)

  return cleaned.trim() === '' ? fallback : cleaned
}
