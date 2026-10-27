/**
 * The refusals /cadre detect checks before any read, a layer 3 module: a session root that is the home folder or holds
 * it, and the file system root, checked for every pair of root and home forms, as given and as resolved (WR-06).
 * Pure: it reads nothing. It imports paths, so detect, the repo guards and init word these refusals here.
 */
import { trimSlash } from '../paths'

/** Reply when the session root is the home folder or contains it; detection would read the whole home. */
export const HOME_ROOT_REPLY =
  'cadre detect needs a repo root other than your home folder. Open the session in a repo and run /cadre detect again.'
/** Reply when the session root is the file system root; detection would read the whole disk (WR-06). */
export const FILE_SYSTEM_ROOT_REPLY =
  'cadre detect needs a repo root other than the file system root (/). ' +
  'Open the session in a repo and run /cadre detect again.'

/**
 * The reply when the session root is the home folder or contains it, else null. Both paths are compared after
 * trimming a trailing `/`, and the rule applies only when `home` is non-empty. Pure: it reads nothing. detectRefusal
 * applies it to every pair of root and home forms.
 */
export function homeRootRefusal(root: string, home: string | null): string | null {
  if (home === null || home === '') return null
  const trimmedHome = home.replace(/\/+$/, '')
  const trimmedRoot = root.replace(/\/+$/, '')
  if (trimmedRoot === trimmedHome || trimmedHome.startsWith(`${trimmedRoot}/`)) return HOME_ROOT_REPLY

  return null
}

/**
 * The reply that stops `/cadre detect` before any read, else null (WR-06). Any root form that is `/` or trims to
 * empty is refused, whatever HOME is; then every root form (as given and as resolved) is checked against every home
 * form, so a root used as given still meets a home that was resolved, and the other way round.
 */
export function detectRefusal(roots: readonly string[], homes: readonly (string | null)[]): string | null {
  if (roots.some(root => trimSlash(root) === '')) return FILE_SYSTEM_ROOT_REPLY
  for (const root of roots) {
    for (const home of homes) {
      const refusal = homeRootRefusal(root, home)
      if (refusal !== null) return refusal
    }
  }

  return null
}
