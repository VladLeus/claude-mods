/**
 * The refusals /cadre detect checks before any read, a layer 3 module: a session root that is the home folder or holds
 * it, and the file system root, checked for every pair of root and home forms, as given and as resolved (WR-06).
 * Pure: it reads nothing. It imports paths, so detect, the repo guards and init word these refusals here.
 */
import { t } from '../locales/t'
import { trimSlash } from '../paths'

/**
 * The reply when the session root is the home folder or contains it, worded for `command`: detect's own, or the
 * command a repo guard runs for (Pitfall 10).
 */
export function homeRootReply(command: string): string {
  return t('guard.refusals.homeRootReply', { command })
}

/** The reply when the session root is the file system root, worded for `command` (WR-06, Pitfall 10). */
export function fileSystemRootReply(command: string): string {
  return t('guard.refusals.fileSystemRootReply', { command })
}

/** Reply when the session root is the home folder or contains it; detection would read the whole home. */
export const HOME_ROOT_REPLY = homeRootReply('detect')
/** Reply when the session root is the file system root; detection would read the whole disk (WR-06). */
export const FILE_SYSTEM_ROOT_REPLY = fileSystemRootReply('detect')

/**
 * The reply when the session root is the home folder or contains it, worded for `command` (detect by default), else
 * null. Both paths are compared after trimming a trailing `/`, and the rule applies only when `home` is non-empty.
 * Pure: it reads nothing. detectRefusal applies it to every pair of root and home forms.
 */
export function homeRootRefusal(root: string, home: string | null, command = 'detect'): string | null {
  if (home === null || home === '') return null
  const trimmedHome = home.replace(/\/+$/, '')
  const trimmedRoot = root.replace(/\/+$/, '')
  if (trimmedRoot === trimmedHome || trimmedHome.startsWith(`${trimmedRoot}/`)) return homeRootReply(command)

  return null
}

/**
 * The reply that stops `/cadre detect` before any read, else null (WR-06), worded for `command` (detect by default; a
 * repo guard passes its own). Any root form that is `/` or trims to empty is refused, whatever HOME is; then every
 * root form (as given and as resolved) is checked against every home form, so a root used as given still meets a home
 * that was resolved, and the other way round.
 */
export function detectRefusal(
  roots: readonly string[],
  homes: readonly (string | null)[],
  command = 'detect',
): string | null {
  if (roots.some(root => trimSlash(root) === '')) return fileSystemRootReply(command)
  for (const root of roots) {
    for (const home of homes) {
      const refusal = homeRootRefusal(root, home, command)
      if (refusal !== null) return refusal
    }
  }

  return null
}
