/**
 * The runs of /cadre epic and /cadre epic done (D-146, D-147, D-163, D-164, D-169, D-170), a layer 11 module: the epic
 * worktree's path below WORKTREES_DIR, and the argv of their git runs and of their printenv, link rm and ps runs, each
 * run with no shell, with the timeouts of the long runs; the mirror steps are epic/mirror's. It imports nothing, so the
 * epic modules that run something read it here.
 */

/** The folder below the main checkout's root that holds every epic worktree (D-146), as `claude --worktree` uses. */
export const WORKTREES_DIR = '.claude/worktrees'

/** How long `git worktree add` may run before it is given up: a big checkout with its hooks takes long (Pitfall 8). */
export const GIT_ADD_TIMEOUT_MS = 120_000

/** The absolute path of the epic worktree `name` in the main checkout at `root` (D-146). */
export function worktreePathOf(root: string, name: string): string {
  return `${root}/${WORKTREES_DIR}/${name}`
}

/**
 * The `git worktree add` argv run at `root` (D-147), with no shell: a new branch, `-b <branch>` from the current HEAD,
 * or, for a branch that is kept (D-163), the worktree added on that branch without `-b`.
 */
export function worktreeAddArgv(root: string, path: string, branch: string, isNew: boolean): readonly string[] {
  if (isNew) return ['git', '-C', root, 'worktree', 'add', '-b', branch, path, 'HEAD']

  return ['git', '-C', root, 'worktree', 'add', path, branch]
}

/** The argv that lists the worktrees of the repo at `root` in git's porcelain format, main checkout first (D-163). */
export function WORKTREE_LIST_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'worktree', 'list', '--porcelain']
}

/** The argv that lists the short names of the repo's local `epic/` branches at `root`, one per line (D-163). */
export function EPIC_BRANCHES_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/epic/']
}

/**
 * The argv that names the branch checked out at `root`, the base of a new epic worktree (D-164). On a detached HEAD it
 * exits 1 with no output, and BASE_COMMIT_ARGV names the commit instead.
 */
export function BASE_BRANCH_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'symbolic-ref', '--short', '-q', 'HEAD']
}

/** The argv that names the commit checked out at `root`, the base when no branch is checked out there (D-164). */
export function BASE_COMMIT_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'rev-parse', 'HEAD']
}

/**
 * The argv that names, as an absolute path, the git dir of the worktree at `path`, where its epic record lies (D-164).
 * git may name that folder unlike the worktree's own folder, so it is always asked, never derived (RESEARCH Pattern 3).
 */
export function GIT_DIR_ARGV(path: string): readonly string[] {
  return ['git', '-C', path, 'rev-parse', '--absolute-git-dir']
}

/**
 * The argv that lists what git does not track and does not ignore in the main checkout at `root` (D-147, RESEARCH
 * Pattern 3): with `-z`, so each name comes raw and NUL-ended, never octal-quoted, and with `--directory`, so a folder
 * git does not track at all is one entry.
 */
export function LS_OTHERS_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'ls-files', '-z', '--others', '--directory', '--exclude-standard']
}

/** The argv that lists what git ignores in the main checkout at `root` (D-147), NUL-ended as LS_OTHERS_ARGV lists. */
export function LS_IGNORED_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'ls-files', '-z', '--others', '--ignored', '--directory', '--exclude-standard']
}

/**
 * The argv that names the user's global excludes file (D-147): git's `core.excludesFile` as a path, with `~` expanded;
 * it exits 1 with no output when the key is not set. The global config is the same everywhere, so `-C <root>` only
 * keeps the argv apart from the others. `--includes` follows the global file's include and includeIf, which a given
 * scope otherwise skips, so a key set in an included file is found (03.1-W2 S1).
 */
export function GLOBAL_EXCLUDES_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'config', '--includes', '--global', '--path', 'core.excludesFile']
}

/**
 * The argv that prints XDG_CONFIG_HOME, below which git finds its default global excludes file (D-147, RESEARCH
 * Alternatives Considered); it exits 1 when the variable is not set. It is a run, so the host's env reader keeps its
 * own few names (HostEnvName).
 */
export const XDG_ARGV: readonly string[] = Object.freeze(['/usr/bin/printenv', 'XDG_CONFIG_HOME'])

/** The argv that gives each worktree of the repo at `root` a config of its own (D-147); it sets the shared config. */
export function WORKTREE_CONFIG_ARGV(root: string): readonly string[] {
  return ['git', '-C', root, 'config', 'extensions.worktreeConfig', 'true']
}

/** The argv that makes `file` the excludes file of the worktree at `path`, in that worktree's own config (D-147). */
export function EXCLUDES_CONFIG_ARGV(path: string, file: string): readonly string[] {
  return ['git', '-C', path, 'config', '--worktree', 'core.excludesFile', file]
}

/**
 * The argv that asks git what changed in the worktree at `path` (D-169): it is clean when the run exits 0 silent.
 * `--untracked-files=normal` overrides a `status.showUntrackedFiles=no` config, so untracked work always shows
 * (03.1-W5 S1).
 */
export function STATUS_ARGV(path: string): readonly string[] {
  return ['git', '-C', path, 'status', '--porcelain', '--untracked-files=normal']
}

/**
 * The argv that asks git, at `root`, whether `branch` is merged into `base` (D-169): it exits 0 when it is, 1 when it
 * is not, and 128 for a name git does not know (RESEARCH Pattern 3).
 */
export function MERGED_ARGV(root: string, branch: string, base: string): readonly string[] {
  return ['git', '-C', root, 'merge-base', '--is-ancestor', branch, base]
}

/**
 * The argv that removes the worktree at `path` from the repo at `root` (D-170), its folder and the copies in it, with
 * `--force` only on the forced path; git leaves the targets of the links in it alone (RESEARCH Pattern 3).
 */
export function REMOVE_ARGV(root: string, path: string, force: boolean): readonly string[] {
  return ['git', '-C', root, 'worktree', 'remove', ...(force ? ['--force'] : []), path]
}

/** How long `git worktree remove` may run before it is given up: a big worktree takes long to delete (Pitfall 8). */
export const REMOVE_TIMEOUT_MS = 120_000

/**
 * The argv that removes one link cadre recorded in the worktree (D-170): `/bin/rm -f --` and never `-r`, so it removes
 * the link itself and never what the link points at in the main checkout.
 */
export function linkRemoveArgv(path: string): readonly string[] {
  return ['/bin/rm', '-f', '--', path]
}

/**
 * The argv that asks whether the process `pid` still runs (D-170, RESEARCH Standard Stack): `/bin/ps` exits 0 while it
 * does and 1 once it has ended, for any user's process, where `kill -0` would read another user's live one as ended.
 */
export function PS_ARGV(pid: number): readonly string[] {
  return ['/bin/ps', '-p', String(pid), '-o', 'pid=']
}

/** How long the PS_ARGV run of the stale-lock rule may run before it is given up (Pitfall 8). */
export const PS_TIMEOUT_MS = 10_000

/** The argv that clears the lock of the worktree at `path` in the repo at `root` (D-170) once its process has ended. */
export function UNLOCK_ARGV(root: string, path: string): readonly string[] {
  return ['git', '-C', root, 'worktree', 'unlock', path]
}
