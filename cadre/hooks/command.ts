import type { CadreCommand } from '../types'

/** RED placeholder: the usage lines are not written yet, so the help text stays empty. */
export const USAGE_LINES: readonly string[] = []

/** RED placeholder: returns a wrong value so the tests load and fail on their assertions. */
export function parseCommand(_args: string): CadreCommand {
  return { kind: 'help', unknown: '' }
}

/** RED placeholder: returns empty text so the tests load and fail on their assertions. */
export function helpText(_unknown: string | null): string {
  return ''
}
