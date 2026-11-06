/**
 * The file classification, a layer 5 module: the manifest path, and what the plan does to one generated file from its
 * desired hash, the hash the manifest recorded and what is on disk (D-66, D-67, PLAN-04). It imports the types, so
 * the file plan, apply, /cadre start and the goldens read it here.
 */
import type { FileOpKind } from '../../types'

/**
 * The repo-relative path of the manifest, which records every file cadre generated with its hash. Re-runs, regen and a
 * later uninstall find the generated files through it (D-66, D-67).
 */
export const MANIFEST_PATH = '.cadre/manifest.json'

/** A file on disk as classifyFile sees it: not there, unreadable, or there with the SHA-256 of its text. */
export type DiskHash =
  | { readonly state: 'absent' }
  | { readonly state: 'unknown' }
  | { readonly state: 'present'; readonly hash: string }

/**
 * What the plan does to one generated file (D-67). A file that is not there is created. A file that already holds the
 * desired content is left, which also settles an untracked file that happens to match. A file that still holds what the
 * manifest recorded, while the desired content differs, was not edited, so it is changed. Any other file, one the user
 * edited, one with no manifest entry that differs, or one that cannot be read, is a conflict and is kept as it is
 * (PLAN-04): an unreadable file counts as edited, never as absent.
 */
export function classifyFile(desiredHash: string, manifestHash: string | null, disk: DiskHash): FileOpKind {
  if (disk.state === 'absent') return 'create'
  if (disk.state === 'unknown') return 'conflict'
  if (disk.hash === desiredHash) return 'leave'
  if (disk.hash === manifestHash) return 'change'

  return 'conflict'
}
