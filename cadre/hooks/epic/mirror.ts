/**
 * The mirror plan of an epic worktree, a layer 11 module: from the main checkout's untracked and ignored entries, the
 * paths its .worktreeinclude names and the listings of the main checkout and the worktree, mirrorPlan gives the
 * ordered steps that make the worktree like main (real folders for `.cadre` and its protected folders and above a
 * named path, a copy for a named path and for env and git files, a link for the rest) with a warning for each entry it
 * leaves alone, and epicStepArgv and epicStepTimeoutMs give the argv and the time limit of a step. It is pure and
 * imports core, paths and epic/git; the mirror run reads it.
 */
import type { PortEntry } from '../../types'
import { reportText, sortedUnique } from '../core/text'
import { t } from '../locales/t'
import { foldersAbove, SIZING_RUBRIC_PATH } from '../paths'
import { WORKTREES_DIR } from './git'

/**
 * One step of the mirror into the epic worktree, in the order runEpic runs it; every path is absolute:
 * - `mkdir`: make a real folder in the worktree, and the folders above it;
 * - `link`: make `path` a symbolic link to `target` in the main checkout, never over something that is there;
 * - `copy`: copy `source` of the main checkout, a regular file or a real folder, to `path`, keeping modes and times.
 */
export type EpicStep =
  | { readonly kind: 'mkdir'; readonly path: string }
  | { readonly kind: 'link'; readonly path: string; readonly target: string }
  | { readonly kind: 'copy'; readonly path: string; readonly source: string }

/** How long a mkdir or link step may run before it is given up. */
export const MIRROR_STEP_TIMEOUT_MS = 10_000

/** How long a copy step may run before it is given up: a whole folder may take long to copy. */
export const MIRROR_COPY_TIMEOUT_MS = 120_000

/** How long a step may run: MIRROR_COPY_TIMEOUT_MS for a copy, MIRROR_STEP_TIMEOUT_MS for a mkdir or a link. */
export function epicStepTimeoutMs(step: EpicStep): number {
  if (step.kind === 'copy') return MIRROR_COPY_TIMEOUT_MS

  return MIRROR_STEP_TIMEOUT_MS
}

/**
 * The argv that runs a mirror step, absolute and with no shell, `--` before the paths: `/bin/mkdir -p --` for a
 * folder; `/bin/ln -s --` for a link, with no `-f`, so it never replaces what is there; `/bin/cp -pR --` for a copy,
 * which copies a regular file or a real folder whole.
 */
export function epicStepArgv(step: EpicStep): readonly string[] {
  if (step.kind === 'mkdir') return ['/bin/mkdir', '-p', '--', step.path]
  if (step.kind === 'link') return ['/bin/ln', '-s', '--', step.target, step.path]

  return ['/bin/cp', '-pR', '--', step.source, step.path]
}

/** The folder of cadre's own files, which the worktree gets as a real folder and never as one link (D-156). */
const CADRE_DIR = '.cadre'

/** The folder whose children the mirror links one by one, all but `worktrees` (D-147). */
const CLAUDE_DIR = '.claude'

/** The child of CLAUDE_DIR that holds the epic worktrees, never linked (D-147). */
const CLAUDE_WORKTREES_CHILD = 'worktrees'

/** The start of the last segment of a file the mirror copies instead of linking (D-148, D-172). */
const ENV_PREFIX = '.env'

/**
 * The last segments of the files git never reads through a link in a work tree (git 2.32+), so the mirror copies them,
 * as it copies env files, and hides each copy (03.1 S1).
 */
const GIT_FILE_NAMES: readonly string[] = ['.gitattributes', '.gitignore', '.mailmap']

/** Whether the last segment of a repo-relative path is one of GIT_FILE_NAMES (03.1 S1). */
export function isGitFile(path: string): boolean {
  return GIT_FILE_NAMES.includes(path.slice(path.lastIndexOf('/') + 1))
}

/** Whether a mirror copy is hidden from git by the excludes: a copy of a git file or of the sizing rubric. */
export function isHiddenCopy(path: string): boolean {
  return isGitFile(path) || path === SIZING_RUBRIC_PATH
}

/** A C0 control character or DEL: no gitignore line can hold a name with one (03.1-W2 S2). */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

/**
 * The folders the mirror makes real in the worktree and never links whole (D-156): `.cadre`, `.cadre/bin` and
 * `.cadre/<id>` for each role id. A launcher in a real `.cadre/bin/` finds the worktree as its root, and a render
 * writes the worktree's own `.cadre/<id>/.runtime/`, never main's.
 */
function protectedFolders(roleIds: readonly string[]): string[] {
  return [CADRE_DIR, `${CADRE_DIR}/bin`, ...roleIds.map(id => `${CADRE_DIR}/${id}`)]
}

/** The repo-relative folder a path lies in, '' for the root. */
function parentOf(path: string): string {
  const at = path.lastIndexOf('/')

  return at === -1 ? '' : path.slice(0, at)
}

/** Whether a repo-relative path is `folder` itself or lies below it. */
function isAtOrUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`)
}

/** What the listing of its folder in `listings` shows for a repo-relative path; undefined when it shows nothing. */
export function listedEntry(listings: ReadonlyMap<string, readonly PortEntry[]>, path: string): PortEntry | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1)

  return listings.get(parentOf(path))?.find(entry => entry.name === name)
}

/**
 * The folders runEpic lists for mirrorPlan, repo-relative and '' for the root, each list sorted and once each: every
 * folder the rules read. In the main checkout (`main`): the protected folders (`.cadre`, `.cadre/bin` and `.cadre/<id>`
 * for each role id) and `.claude`, whose children the mirror walks, the folder of each entry, which shows whether it
 * is a file, and the folders above each named path (`included`), which the mirror may walk. In the worktree (`tree`):
 * the root, `.claude`, each protected folder and the folders above it, and the folders above each entry and each named
 * path, which show what the worktree holds already and which of its folders are links.
 */
export function mirrorPaths(
  entries: readonly string[],
  roleIds: readonly string[],
  included: readonly string[],
): { readonly main: readonly string[]; readonly tree: readonly string[] } {
  const kept = protectedFolders(roleIds)
  const walked = included.flatMap(foldersAbove)
  const main = sortedUnique([...kept, CLAUDE_DIR, ...entries.map(parentOf), ...walked])
  const above = [...kept.flatMap(folder => [...foldersAbove(folder), folder]), ...entries.flatMap(foldersAbove)]

  return { main, tree: sortedUnique(['', CLAUDE_DIR, ...above, ...walked]) }
}

/**
 * The mirror of the main checkout into the epic worktree. `main` and `tree` hold the listing of each repo-relative
 * folder ('' for the root) in the main checkout and in the worktree, as mirrorPaths names them; a folder with no
 * listing counts as empty, and a target the worktree lists, a dangling link included, is there. `included` holds the
 * paths the main checkout's .worktreeinclude names that git ignores (the named paths). The entries are taken sorted,
 * and each, then each child it hands on, gets the first rule that fits:
 * - (a) `.claude/worktrees` and anything below it: nothing;
 * - (b) anything at or below `.cadre/<id>/.runtime` for a role id: nothing, as each worktree renders its own;
 * - (c) a path already planned or already in the worktree's listing, or below either: nothing, so no step lands in the
 *   main checkout and a reuse plans no more than the first run did;
 * - (d) a path below a folder the worktree lists as a link (a tracked link in HEAD): nothing, and the
 *   mirrorLinkedParentWarning line;
 * - (e) a protected folder (`.cadre`, `.cadre/bin`, `.cadre/<id>`) or a folder above one: a mkdir step, then each
 *   child of its main listing, by these same rules;
 * - (f) `.claude`: each child of its main listing but `worktrees`, by these same rules;
 * - (g) a path whose name holds a control character, a line break included: nothing, nothing below it, and the
 *   mirrorUnhideableWarning line, as no excludes line can hide it;
 * - (h) a path that is not named but holds a named path deeper down, when the main listing of its folder shows a real
 *   folder (not a link): a mkdir step, then each child of its main listing, by these same rules;
 * - (i) a named path the main listing of its folder shows as a regular file or a real folder, or a file whose last
 *   segment starts with `.env`, or is `.gitignore`, `.gitattributes` or `.mailmap` (GIT_FILE_NAMES, which git never
 *   reads through a link), as that listing shows (a regular file, not a link): a copy step;
 * - (j) anything else: a link step to the main checkout's path;
 * - (k) once the entries are done, `.cadre/sizing.md` (SIZING_RUBRIC_PATH) when the main listing of `.cadre` shows
 *   it as a regular file, not a link: the rules above apply first, as for an entry, and then it gets a copy step,
 *   never a link, so a rubric main has and the worktree lacks is copied into it.
 * A step below a folder the worktree does not list gets a mkdir step for each such folder from the top first, once
 * each. The result holds the steps in order (absolute paths), the repo-relative paths linked and copied, and the
 * warnings.
 */
export function mirrorPlan(input: {
  readonly root: string
  readonly worktree: string
  readonly entries: readonly string[]
  readonly roleIds: readonly string[]
  readonly main: ReadonlyMap<string, readonly PortEntry[]>
  readonly tree: ReadonlyMap<string, readonly PortEntry[]>
  readonly included: readonly string[]
}): {
  readonly steps: readonly EpicStep[]
  readonly links: readonly string[]
  readonly copies: readonly string[]
  readonly warnings: readonly string[]
} {
  const { root, worktree, main, tree, included } = input
  const kept = protectedFolders(input.roleIds)
  const runtimes = input.roleIds.map(id => `${CADRE_DIR}/${id}/.runtime`)
  const steps: EpicStep[] = []
  const links: string[] = []
  const copies: string[] = []
  const warnings: string[] = []
  const made = new Set<string>()
  const placed = new Set<string>()
  const mkdir = (folder: string) => {
    steps.push({ kind: 'mkdir', path: `${worktree}/${folder}` })
    made.add(folder)
  }
  const childrenOf = (folder: string) => sortedUnique((main.get(folder) ?? []).map(entry => entry.name))

  const visit = (path: string, isCopy = false): void => {
    if (isAtOrUnder(path, WORKTREES_DIR)) return
    if (runtimes.some(runtime => isAtOrUnder(path, runtime))) return
    const above = foldersAbove(path)
    if (made.has(path) || placed.has(path) || above.some(folder => placed.has(folder))) return
    if (above.some(folder => listedEntry(tree, folder)?.isLink === true)) {
      warnings.push(mirrorLinkedParentWarning(path))
      return
    }
    const missing = above.filter(folder => !made.has(folder) && listedEntry(tree, folder) === undefined)
    if (kept.some(folder => isAtOrUnder(folder, path))) {
      for (const folder of [...missing, path]) mkdir(folder)
      for (const child of childrenOf(path)) visit(`${path}/${child}`)
      return
    }
    if (path === CLAUDE_DIR) {
      for (const child of childrenOf(path).filter(name => name !== CLAUDE_WORKTREES_CHILD)) visit(`${path}/${child}`)
      return
    }
    if (listedEntry(tree, path) !== undefined) {
      // A target that is there is placed, so nothing below it is mirrored, as below a planned link (rule c).
      placed.add(path)
      return
    }
    if (CONTROL_CHARACTER.test(path)) {
      placed.add(path)
      warnings.push(mirrorUnhideableWarning(path))
      return
    }
    const shown = listedEntry(main, path)
    const isNamed = included.includes(path)
    const isReal = shown !== undefined && !shown.isLink
    const holdsNamed = included.some(named => named.startsWith(`${path}/`))
    if (isReal && shown.kind === 'dir' && !isNamed && holdsNamed) {
      for (const folder of [...missing, path]) mkdir(folder)
      for (const child of childrenOf(path)) visit(`${path}/${child}`)
      return
    }
    for (const folder of missing) mkdir(folder)
    placed.add(path)
    const name = path.slice(path.lastIndexOf('/') + 1)
    const isCopied = isCopy || isNamed || name.startsWith(ENV_PREFIX) || GIT_FILE_NAMES.includes(name)
    if (isCopied && isReal && (shown.kind === 'file' || (isNamed && shown.kind === 'dir'))) {
      steps.push({ kind: 'copy', path: `${worktree}/${path}`, source: `${root}/${path}` })
      copies.push(path)
      return
    }
    steps.push({ kind: 'link', path: `${worktree}/${path}`, target: `${root}/${path}` })
    links.push(path)
  }
  for (const entry of sortedUnique(input.entries)) visit(entry)
  const rubric = listedEntry(main, SIZING_RUBRIC_PATH)
  if (rubric !== undefined && rubric.kind === 'file' && !rubric.isLink) visit(SIZING_RUBRIC_PATH, true)

  return { steps, links, copies, warnings }
}

/**
 * The warning line for an entry the mirror leaves out because a folder above it in the worktree is a link (D-147,
 * T-03.1-05): a step there would land in the link's target. The repo-relative path is shown cleaned.
 */
export function mirrorLinkedParentWarning(path: string): string {
  return t('epic.mirror.mirrorLinkedParentWarning', { path: reportText(path) })
}

/**
 * The warning line for an entry the mirror leaves out because its name holds a control character, a line break
 * included (03.1-W2 S2): no excludes line can hide a link to it from git, so it gets no step. The repo-relative path
 * is shown cleaned.
 */
export function mirrorUnhideableWarning(path: string): string {
  return t('epic.mirror.mirrorUnhideableWarning', { path: reportText(path) })
}
