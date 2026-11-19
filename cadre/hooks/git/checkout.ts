/**
 * Where a session root sits in git, a layer 1 module: the git top level above it, found by stat alone, whether it is
 * the main checkout or a linked worktree, from one git run, and the main checkout of an epic worktree, read from its
 * files with no git run. It imports only paths and the types, so init, epic and status read the checkout here with no
 * cycle, and none of them reaches into scan.ts for it.
 */
import type { HostRun, InitIo } from '../../types'
import { EPIC_RECORD_FILE, joinedPath, resolveSegments, trimSlash } from '../paths'

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

const GIT_FILE_MAX_BYTES = 4096

const GITDIR_PREFIX = 'gitdir: '

/** Where a linked worktree's git dir lies in the main checkout's git dir. */
const WORKTREES_SEGMENT = '/.git/worktrees/'

/** The git dir a `.git` file names in its one `gitdir:` line, a relative one resolved against the root; else null. */
function gitDirOf(text: string, root: string): string | null {
  const line = text.endsWith('\n') ? text.slice(0, -1) : text
  if (line.includes('\n') || !line.startsWith(GITDIR_PREFIX)) return null
  const path = line.slice(GITDIR_PREFIX.length)
  if (path === '') return null

  return path.startsWith('/') ? path : resolveSegments(joinedPath(root, path))
}

/** The main checkout a worktree git dir belongs to: the part before its last `/.git/worktrees/`; else null. */
function mainOfGitDir(gitDir: string): string | null {
  const at = gitDir.lastIndexOf(WORKTREES_SEGMENT)
  if (at < 0) return null

  return at === 0 ? '/' : gitDir.slice(0, at)
}

/**
 * The main checkout of the epic worktree at `root`, found by stat and one read with no git run: a `.git` file, not a
 * link, whose `gitdir:` line names a worktree git dir holding the epic record as a regular file; null for any other
 * root, a linked worktree cadre did not make included.
 */
export async function epicWorktreeMain(io: InitIo, root: string): Promise<string | null> {
  const gitFile = joinedPath(root, '.git')
  const stat = await io.stat(gitFile)
  if (stat === null || stat.kind !== 'file' || stat.isLink) return null
  const read = await io.read(gitFile, GIT_FILE_MAX_BYTES)
  if (read.state !== 'text') return null
  const gitDir = gitDirOf(read.text, root)
  if (gitDir === null) return null
  const main = mainOfGitDir(gitDir)
  if (main === null) return null
  const record = await io.stat(`${gitDir}/${EPIC_RECORD_FILE}`)
  if (record === null || record.kind !== 'file' || record.isLink) return null

  return main
}
