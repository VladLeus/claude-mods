/**
 * Where a session root sits in git, a layer 1 module: the git top level above it, found by stat alone, and whether it
 * is the main checkout or a linked worktree, from one git run. It imports only paths and the types, so init, epic and
 * status read the checkout here with no cycle, and none of them reaches into scan.ts for it.
 */
import type { HostRun, InitIo } from '../../types'
import { trimSlash } from '../paths'

/** The root and each folder above it, nearest first, then the file system root as the empty string. */
function folderChain(root: string): string[] {
  const chain: string[] = []
  let folder = trimSlash(root)
  while (folder !== '') {
    chain.push(folder)
    folder = folder.slice(0, folder.lastIndexOf('/'))
  }
  chain.push('')

  return chain
}

/**
 * The git top level above the session root (D-56): the nearest folder, the root itself included, that has a `.git` file
 * or folder (a linked worktree has a file), found by statting `<folder>/.git` up to `/`, with no process call. A
 * `.git` that cannot be statted is passed over; if none is found, or the root is not an absolute path, the answer is
 * `none`, and the caller refuses.
 */
export async function findGitTop(
  io: InitIo,
  root: string,
): Promise<{ readonly state: 'found'; readonly top: string } | { readonly state: 'none' }> {
  if (!root.startsWith('/')) return { state: 'none' }
  for (const folder of folderChain(root)) {
    const stat = await io.stat(`${folder}/.git`)
    if (stat === null) continue
    if (stat.kind === 'file' || stat.kind === 'dir') return { state: 'found', top: folder === '' ? '/' : folder }
  }

  return { state: 'none' }
}

/**
 * The argv that asks git, at `root`, for its git dir and its common dir, both as absolute paths (D-165): the two are
 * the same in the main checkout and differ in a linked worktree. /cadre epic and /cadre status both run it.
 */
export function CHECKOUT_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']
}

/**
 * Which checkout a session root is (D-165): the main checkout, a linked worktree with the main checkout's path when git
 * names it, or unknown.
 */
export type Checkout =
  | { readonly kind: 'main' }
  | { readonly kind: 'linked'; readonly main: string | null }
  | { readonly kind: 'unknown' }

/** The end of a main checkout's git dir, which a linked worktree's common dir has too. */
const GIT_DIR_END = '/.git'

/**
 * The checkout a run of CHECKOUT_ARGV tells (D-165), failing closed: a run that exits 0 with exactly two non-empty
 * lines, both absolute paths, is the main checkout when they are equal, else a linked worktree whose main checkout is
 * the common dir without its trailing `/.git` (null when it does not end so); anything else, a run the host rejected
 * included, is unknown.
 */
export function checkoutOf(run: HostRun | null): Checkout {
  if (run === null || run.exitCode !== 0) return { kind: 'unknown' }
  const lines = run.stdout.split('\n').filter(line => line !== '')
  const [gitDir, commonDir] = lines
  if (lines.length !== 2 || gitDir === undefined || commonDir === undefined) return { kind: 'unknown' }
  if (!gitDir.startsWith('/') || !commonDir.startsWith('/')) return { kind: 'unknown' }
  if (gitDir === commonDir) return { kind: 'main' }
  if (!commonDir.endsWith(GIT_DIR_END)) return { kind: 'linked', main: null }

  return { kind: 'linked', main: commonDir.slice(0, -GIT_DIR_END.length) }
}
