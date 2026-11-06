/**
 * The git common dir of the repo, a layer 1 module: the git run that asks for it and how long it may take, the dir
 * with its SHA-256 that name the role memory folders, and the main checkout of a linked worktree nested in it. It
 * imports only core and the types, so /cadre start and init both look the dir up here, and init no longer imports
 * start for it.
 */
import type { HostIo, InitIo } from '../../types'
import { sha256Hex } from '../core/hash'

/** The argv that asks git for the repo's common dir as an absolute path; it runs at the repo root (D-98, D-91). */
export const GIT_COMMON_DIR_ARGV: readonly string[] = Object.freeze([
  'git',
  'rev-parse',
  '--path-format=absolute',
  '--git-common-dir',
])

/** How long the git run may take before it is given up. */
const GIT_COMMON_DIR_TIMEOUT_MS = 10_000

/**
 * The git common dir of the repo with its SHA-256, which name the role memory folders (roleMemoryDir, D-20, D-91):
 * GIT_COMMON_DIR_ARGV run at the repo root gives it, its output without the final line break, which must start with
 * `/`; it is then the realpath of its stat when the host resolves it, else as git gave it. Null when the host rejects
 * the run, it exits non-zero or its output is not an absolute path. /cadre start and apply both look the folders up
 * through it (G-02-1f, D-140 q2-a), so they always name the same ones.
 */
export async function gitCommonDirOf(
  io: InitIo,
  host: HostIo,
  root: string,
): Promise<{ readonly gitCommonDir: string; readonly commonDirHash: string } | null> {
  const run = await host.run(GIT_COMMON_DIR_ARGV, { cwd: root, timeoutMs: GIT_COMMON_DIR_TIMEOUT_MS })
  if (run === null || run.exitCode !== 0) return null
  if (!run.stdout.startsWith('/')) return null
  const given = run.stdout.endsWith('\n') ? run.stdout.slice(0, -1) : run.stdout
  const gitCommonDir = (await io.stat(given))?.realPath ?? given

  return { gitCommonDir, commonDirHash: await sha256Hex(gitCommonDir) }
}

/**
 * The main checkout of a linked worktree nested in it (D-20, D-157, 03.1-W3 M1): the folder of the git common dir when
 * it is `<main>/.git` and the root lies below `<main>/`, as `.claude/worktrees/<slug>` does; null for the main
 * checkout, a common dir elsewhere, or a submodule's.
 */
export function mainCheckoutOf(gitCommonDir: string, root: string): string | null {
  if (!gitCommonDir.endsWith('/.git')) return null
  const main = gitCommonDir.slice(0, -'/.git'.length)

  return root.startsWith(`${main}/`) ? main : null
}
