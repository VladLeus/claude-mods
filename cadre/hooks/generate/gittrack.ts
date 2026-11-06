/**
 * The git tracking check, a layer 6 module: which instruction files git tracks, asked once with `git ls-files -z`
 * through the host at the repo root, so only the parts of tracked files reach a built role file, and a run git cannot
 * answer keeps no repo part (02-GAPS-B2 M3). It imports core and the types, so init and regen check the repo parts
 * here.
 */
import type { HostIo, InstructionPart } from '../../types'
import { reportText, sortedUnique } from '../core/text'
import { t } from '../locales/t'

/**
 * The argv that asks git which of these repo-relative files it tracks (02-GAPS-B2 M3): `git ls-files -z`, with
 * `--literal-pathspecs` so a name is never a pattern and `--` before the names; it runs at the repo root.
 */
export function gitTrackedArgv(files: readonly string[]): readonly string[] {
  return ['git', '--literal-pathspecs', 'ls-files', '-z', '--', ...files]
}

/** The source file of every repo part the roles were given, sorted, once each (02-GAPS-B2 M3): what git is asked. */
export function repoPartFiles(repoParts: ReadonlyMap<string, readonly InstructionPart[]>): string[] {
  const parts = Array.from(repoParts.values()).flat()

  return sortedUnique(parts.filter(part => part.source === 'repo').map(part => part.file))
}

/**
 * The repo parts a built role file may hold (02-GAPS-B2 M3): the same keys, each keeping only the repo parts whose
 * source file is in `tracked`; null, when git could not be asked, keeps none, so a file git does not track never
 * reaches a committed file.
 */
export function trackedRepoParts(
  repoParts: ReadonlyMap<string, readonly InstructionPart[]>,
  tracked: ReadonlySet<string> | null,
): ReadonlyMap<string, readonly InstructionPart[]> {
  const isTracked = (part: InstructionPart): boolean => part.source === 'repo' && tracked?.has(part.file) === true

  return new Map(Array.from(repoParts, ([id, parts]): [string, InstructionPart[]] => [id, parts.filter(isTracked)]))
}

/**
 * The warning for a source file whose repo parts were left out of the built role files because git does not track it
 * (02-GAPS-B2 M3).
 */
export function untrackedPartsWarning(file: string): string {
  return t('generate.gittrack.untrackedPartsWarning', { file: reportText(file) })
}

/**
 * The warning when git could not be asked which instruction files it tracks (02-GAPS-B2 M3): no repo part is written,
 * so the check fails closed.
 */
export const GIT_TRACKING_UNKNOWN_WARNING = t('generate.gittrack.gitTrackingUnknownWarning')

/** The character `git ls-files -z` ends each name with, built at run time. */
const NUL = String.fromCharCode(0)

/** The files `git ls-files -z` named (02-GAPS-B2 M3): its NUL-separated names, an empty name skipped. */
export function trackedFilesOf(stdout: string): ReadonlySet<string> {
  return new Set(stdout.split(NUL).filter(name => name !== ''))
}

/** How long the git tracked-files run may take. */
const GIT_TRACKED_TIMEOUT_MS = 10_000

/**
 * The repo parts a plain init may write, with the warnings of those it leaves out (02-GAPS-B2 M3). With no repo part
 * the map is given back unchanged and git is not asked. Else gitTrackedArgv runs at the repo root through the host:
 * a run the host rejects or that exits non-zero keeps no repo part (trackedRepoParts with null) and warns
 * GIT_TRACKING_UNKNOWN_WARNING, so the check fails closed; else only the parts of the files git named are kept, and
 * each source file it did not name is an untrackedPartsWarning, in file order.
 */
export async function trackedParts(
  host: HostIo,
  root: string,
  repoParts: ReadonlyMap<string, readonly InstructionPart[]>,
): Promise<{
  readonly repoParts: ReadonlyMap<string, readonly InstructionPart[]>
  readonly warnings: readonly string[]
}> {
  const files = repoPartFiles(repoParts)
  if (files.length === 0) return { repoParts, warnings: [] }
  const run = await host.run(gitTrackedArgv(files), { cwd: root, timeoutMs: GIT_TRACKED_TIMEOUT_MS })
  if (run === null || run.exitCode !== 0) {
    return { repoParts: trackedRepoParts(repoParts, null), warnings: [GIT_TRACKING_UNKNOWN_WARNING] }
  }
  const tracked = trackedFilesOf(run.stdout)

  return {
    repoParts: trackedRepoParts(repoParts, tracked),
    warnings: files.filter(file => !tracked.has(file)).map(untrackedPartsWarning),
  }
}
