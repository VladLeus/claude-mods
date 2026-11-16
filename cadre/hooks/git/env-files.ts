/**
 * The env files git tracks, a layer 1 module: the git run that lists them at a root with their modes, and the regular
 * files among them whose paths an exact sandbox path may hold. It imports only core and the types, so /cadre start
 * lists them here at launch.
 */
import type { HostRun } from '../../types'
import { sortedUnique } from '../core/text'

/** The argv that lists, NUL-ended with mode, object and stage, the `.env` and `.env.*` files git tracks in `root`. */
export function TRACKED_ENV_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'ls-files', '-z', '-s', '--', ':(glob)**/.env', ':(glob)**/.env.*']
}

/** An `ls-files -s` entry of a regular file (mode 100644 or 100755): mode, object, stage, a tab, then the path. */
const REGULAR_ENTRY = /^(100644|100755) [0-9a-f]+ [0-3]\t(.+)$/

/** A path segment an exact sandbox path may hold: letters, digits, dot, dash and underscore only. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

function isSafeSegment(segment: string): boolean {
  return SAFE_SEGMENT.test(segment) && segment !== '.' && segment !== '..'
}

/** Whether a tracked path is an env file: every segment safe, the last one `.env` or starting with `.env.`. */
function isEnvFile(path: string): boolean {
  const segments = path.split('/')
  if (!segments.every(isSafeSegment)) return false
  const base = segments.at(-1) ?? ''

  return base === '.env' || base.startsWith('.env.')
}

/**
 * The env files a TRACKED_ENV_ARGV run gives: the paths of its regular-file entries that isEnvFile keeps, sorted and
 * once each; null when the host rejected the run or it failed.
 */
export function envFilesOf(run: HostRun | null): readonly string[] | null {
  if (run === null || run.exitCode !== 0) return null
  const paths = run.stdout.split('\0').flatMap(entry => {
    const path = REGULAR_ENTRY.exec(entry)?.[2]

    return path === undefined ? [] : [path]
  })

  return sortedUnique(paths.filter(isEnvFile))
}
