/**
 * The env files git tracks, a layer 1 module: the git run that lists them at a root and the names a sandbox path may
 * hold from its output. It imports only core and the types, so /cadre start lists them here at launch.
 */
import type { HostRun } from '../../types'
import { sortedUnique } from '../core/text'

/** The argv that lists, NUL-ended, the `.env` and `.env.*` files git tracks at any depth of `root`. */
export function TRACKED_ENV_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'ls-files', '-z', '--', ':(glob)**/.env', ':(glob)**/.env.*']
}

/** A glob or control character, which an exact sandbox path must not hold. */
const UNSAFE_CHARACTER = /[*?\[{\p{Cc}]/u

function isEnvFile(name: string): boolean {
  if (UNSAFE_CHARACTER.test(name)) return false
  if (name.split('/').some(segment => segment === '' || segment === '..')) return false
  const base = name.slice(name.lastIndexOf('/') + 1)

  return base === '.env' || base.startsWith('.env.')
}

/** The env files a TRACKED_ENV_ARGV run gives, sorted and once each; null when the host rejected it or it failed. */
export function envFilesOf(run: HostRun | null): readonly string[] | null {
  if (run === null || run.exitCode !== 0) return null

  return sortedUnique(run.stdout.split('\0').filter(isEnvFile))
}
