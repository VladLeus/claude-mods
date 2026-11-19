/**
 * The copy-back of /cadre epic done, a layer 11 module: copyBackPlan gives the steps that move what the roles wrote in
 * the epic worktree's copied and walked folders into the main checkout, and the paths it cannot move back safely. It
 * is pure and imports core, paths and epic/mirror; epic done runs it.
 */
import type { PortEntry } from '../../types'
import { compareText, sortedUnique } from '../core/text'
import { foldersAbove } from '../paths'
import { COPY_TEMP_SUFFIX, listedEntry, parentOf } from './mirror'
import type { EpicStep } from './mirror'

/** The steps of a copy-back, in order, and the repo-relative paths it cannot move back safely, sorted, once each. */
export type CopyBack = {
  readonly steps: readonly EpicStep[]
  readonly unsafe: readonly string[]
}

export function isRealDir(entry: PortEntry | undefined): boolean {
  return entry !== undefined && entry.kind === 'dir' && !entry.isLink
}

/**
 * The copy-back of the recorded `copies` and `walked` folders. One the worktree lists as a file, a link or not at all
 * is skipped; one whose folder the worktree cannot list is unsafe, as is a copy `included` (the paths main's
 * .worktreeinclude names now) lacks and a walked folder no included path lies below. Each other copied folder's files
 * are compared against its own copy time in `copiedAt`, else `since`: each regular file written after it that main
 * lacks or holds in another size or time is moved over main's; directly in each other walked folder, each regular file
 * main's listing lacks is moved, but never a copy temp file. A folder main lacks is made just before the first move
 * below it. A link or another kind in main at any depth, a folder a listing lacks, `since <= 0` or a copy time
 * `<= 0` is unsafe. A move is `mv -f`: the rename replaces a link in main instead of writing through it, keeps mode and
 * time, and never prompts; `-T` and `-h` are not portable between GNU and BSD mv.
 */
export function copyBackPlan(input: {
  readonly root: string
  readonly worktree: string
  readonly copies: readonly string[]
  readonly walked: readonly string[]
  readonly included: readonly string[]
  readonly since: number
  readonly copiedAt?: ReadonlyMap<string, number>
  readonly main: ReadonlyMap<string, readonly PortEntry[]>
  readonly tree: ReadonlyMap<string, readonly PortEntry[]>
}): CopyBack {
  const { root, worktree, included, since, main, tree } = input
  const copiedAt = input.copiedAt ?? new Map<string, number>()
  const sortOut = (paths: readonly string[], isNamed: (path: string) => boolean) => {
    const listed = sortedUnique(paths)
    const real = listed.filter(path => isRealDir(listedEntry(tree, path)))
    const unlisted = listed.filter(path => tree.get(parentOf(path)) === undefined)

    return { kept: real.filter(isNamed), refused: [...unlisted, ...real.filter(path => !isNamed(path))] }
  }
  const copied = sortOut(input.copies, copy => included.includes(copy))
  const walked = sortOut(input.walked, folder => included.some(path => path.startsWith(`${folder}/`)))
  const unsafe: string[] = [...copied.refused, ...walked.refused]
  if (since <= 0) return { steps: [], unsafe: sortedUnique([...unsafe, ...copied.kept, ...walked.kept]) }
  const steps: EpicStep[] = []
  const made = new Set<string>()

  const move = (path: string, missing: readonly string[]): void => {
    for (const folder of missing.filter(folder => !made.has(folder))) {
      steps.push({ kind: 'mkdir', path: `${root}/${folder}` })
      made.add(folder)
    }
    steps.push({ kind: 'move', path: `${root}/${path}`, source: `${worktree}/${path}`, overwrite: true })
  }
  const bothListings = (folder: string, missing: readonly string[]) => {
    const listing = tree.get(folder)
    const shownIn = missing.length > 0 ? [] : main.get(folder)
    if (listing === undefined || shownIn === undefined) {
      unsafe.push(folder)
      return null
    }

    return { listing: [...listing].sort((a, b) => compareText(a.name, b.name)), shownIn }
  }
  const walk = (folder: string, missing: readonly string[], since: number): void => {
    const listings = bothListings(folder, missing)
    if (listings === null) return
    for (const child of listings.listing) {
      const shown = listings.shownIn.find(entry => entry.name === child.name)
      visit(child, `${folder}/${child.name}`, shown, missing, since)
    }
  }
  const visit = (
    child: PortEntry,
    path: string,
    shown: PortEntry | undefined,
    missing: readonly string[],
    since: number,
  ): void => {
    if (child.isLink || (child.kind !== 'file' && child.kind !== 'dir')) return
    if (shown !== undefined && (shown.isLink || shown.kind !== child.kind)) {
      unsafe.push(path)
      return
    }
    if (child.kind === 'dir') {
      walk(path, shown === undefined ? [...missing, path] : missing, since)
      return
    }
    if (child.mtimeMs <= since) return
    if (shown !== undefined && shown.size === child.size && shown.mtimeMs === child.mtimeMs) return
    move(path, missing)
  }
  const moveNew = (folder: string, missing: readonly string[]): void => {
    const listings = bothListings(folder, missing)
    if (listings === null) return
    const isNew = (child: PortEntry) => !listings.shownIn.some(entry => entry.name === child.name)
    const isMoved = (child: PortEntry) =>
      child.kind === 'file' && !child.isLink && !child.name.endsWith(COPY_TEMP_SUFFIX) && isNew(child)
    for (const child of listings.listing.filter(isMoved)) {
      move(`${folder}/${child.name}`, missing)
    }
  }
  // The folders main lacks from the first one on the way to `folder`; null once a path on the way is unsafe.
  const missingOf = (folder: string): readonly string[] | null => {
    const chain = [...foldersAbove(folder), folder]
    for (const [at, path] of chain.entries()) {
      if (main.get(parentOf(path)) === undefined) {
        unsafe.push(path)
        return null
      }
      const shown = listedEntry(main, path)
      if (shown === undefined) return chain.slice(at)
      if (shown.isLink || shown.kind !== 'dir') {
        unsafe.push(path)
        return null
      }
    }

    return []
  }
  for (const folder of copied.kept) {
    const own = copiedAt.get(folder) ?? since
    if (own <= 0) {
      unsafe.push(folder)
      continue
    }
    const missing = missingOf(folder)
    if (missing !== null) walk(folder, missing, own)
  }
  for (const folder of walked.kept) {
    const missing = missingOf(folder)
    if (missing !== null) moveNew(folder, missing)
  }

  return { steps, unsafe: sortedUnique(unsafe) }
}
