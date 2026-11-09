/**
 * The framework ids, a layer 0 leaf: the supported adapter ids, every framework id cadre stores, the check every
 * reader of a framework id uses, and the frameworks of a repo. It imports only the types, so framework, roles, team,
 * epic and state/cadre-files can all import it with no cycle.
 */
import type { FrameworkId } from '../../types'

/**
 * The supported adapter ids, in the order every ambiguous and installed-only list is shown. `none` is the built-in
 * fallback, not a framework found in the repo, so it is never ranked here.
 */
export const SUPPORTED_IDS: readonly FrameworkId[] = ['gsd', 'superpowers']

/**
 * Every framework id cadre stores for a repo or a role: the supported frameworks, then `none`, the built-in fallback.
 * Role parsing and the `.cadre/cadre.json` reader both check against this one list.
 */
export const FRAMEWORK_IDS: readonly FrameworkId[] = Object.freeze([...SUPPORTED_IDS, 'none'])

/** Whether a value is one of FRAMEWORK_IDS; anything that is not such a string is not. */
export function isFrameworkId(value: unknown): value is FrameworkId {
  return FRAMEWORK_IDS.some(id => id === value)
}

/**
 * The frameworks of a repo: those cadre.json records, else its stored single framework when that is a supported one
 * (a setup from before the list was recorded), else none.
 */
export function repoFrameworks(state: {
  readonly framework: FrameworkId | null
  readonly frameworks?: readonly FrameworkId[]
}): readonly FrameworkId[] {
  if (state.frameworks !== undefined) return state.frameworks
  const { framework } = state
  if (framework === null || !SUPPORTED_IDS.includes(framework)) return []

  return [framework]
}
