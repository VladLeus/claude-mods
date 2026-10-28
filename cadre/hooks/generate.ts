import type { InstructionPart } from '../types'
import { reportText, sortedUnique } from './core/text'

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
  return `${reportText(file)} is not tracked by git: its parts are not written to .cadre/`
}

/**
 * The warning when git could not be asked which instruction files it tracks (02-GAPS-B2 M3): no repo part is written,
 * so the check fails closed.
 */
export const GIT_TRACKING_UNKNOWN_WARNING =
  'could not ask git which instruction files it tracks: no repo part is written to .cadre/'

/** The character `git ls-files -z` ends each name with, built at run time. */
const NUL = String.fromCharCode(0)

/** The files `git ls-files -z` named (02-GAPS-B2 M3): its NUL-separated names, an empty name skipped. */
export function trackedFilesOf(stdout: string): ReadonlySet<string> {
  return new Set(stdout.split(NUL).filter(name => name !== ''))
}
