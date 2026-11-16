/**
 * The copy-back of /cadre epic done, a layer 11 module: copyBackPlan gives the steps that bring what the roles wrote in
 * the epic worktree's copied folders back into the main checkout, and the paths it cannot copy back safely. It is pure
 * and imports core, paths and epic/mirror; epic done runs it.
 */
import type { PortEntry } from '../../types'
import { compareText, sortedUnique } from '../core/text'
import { foldersAbove } from '../paths'
import { listedEntry, parentOf } from './mirror'
import type { EpicStep } from './mirror'

/** The steps of a copy-back, in order, and the repo-relative paths it cannot copy back safely, sorted, once each. */
export type CopyBack = {
  readonly steps: readonly EpicStep[]
  readonly unsafe: readonly string[]
}

export function isRealDir(entry: PortEntry | undefined): boolean {
  return entry !== undefined && entry.kind === 'dir' && !entry.isLink
}

/**
 * The copy-back of the recorded `copies`. A copy the worktree lists as a file, a link or not at all is skipped. A copy
 * whose folder the worktree cannot list, or that `included` (the paths main's .worktreeinclude names now) lacks, is
 * unsafe. Each regular file of the other copied folders written after `since` that main lacks or holds in another
 * size or time is copied over main's, a folder main lacks made just before the first copy below it. A link or another
 * kind in main at any depth, a folder a listing lacks, or `since <= 0` is unsafe.
 */
export function copyBackPlan(input: {
  readonly root: string
  readonly worktree: string
  readonly copies: readonly string[]
  readonly included: readonly string[]
  readonly since: number
  readonly main: ReadonlyMap<string, readonly PortEntry[]>
  readonly tree: ReadonlyMap<string, readonly PortEntry[]>
}): CopyBack {
  const { root, worktree, included, since, main, tree } = input
  const copies = sortedUnique(input.copies)
  const unlisted = copies.filter(copy => tree.get(parentOf(copy)) === undefined)
  const real = copies.filter(copy => isRealDir(listedEntry(tree, copy)))
  const folders = real.filter(copy => included.includes(copy))
  const unsafe: string[] = [...unlisted, ...real.filter(copy => !included.includes(copy))]
  if (since <= 0) return { steps: [], unsafe: sortedUnique([...unsafe, ...folders]) }
  const steps: EpicStep[] = []
  const made = new Set<string>()

  const copy = (path: string, missing: readonly string[]): void => {
    for (const folder of missing.filter(folder => !made.has(folder))) {
      steps.push({ kind: 'mkdir', path: `${root}/${folder}` })
      made.add(folder)
    }
    steps.push({ kind: 'copy', path: `${root}/${path}`, source: `${worktree}/${path}` })
  }
  const walk = (folder: string, missing: readonly string[]): void => {
    const listing = tree.get(folder)
    const shownIn = missing.length > 0 ? [] : main.get(folder)
    if (listing === undefined || shownIn === undefined) {
      unsafe.push(folder)
      return
    }
    for (const child of [...listing].sort((a, b) => compareText(a.name, b.name))) {
      visit(child, `${folder}/${child.name}`, shownIn.find(entry => entry.name === child.name), missing)
    }
  }
  const visit = (child: PortEntry, path: string, shown: PortEntry | undefined, missing: readonly string[]): void => {
    if (child.isLink || (child.kind !== 'file' && child.kind !== 'dir')) return
    if (shown !== undefined && (shown.isLink || shown.kind !== child.kind)) {
      unsafe.push(path)
      return
    }
    if (child.kind === 'dir') {
      walk(path, shown === undefined ? [...missing, path] : missing)
      return
    }
    if (child.mtimeMs <= since) return
    if (shown !== undefined && shown.size === child.size && shown.mtimeMs === child.mtimeMs) return
    copy(path, missing)
  }
  const start = (folder: string): void => {
    const chain = [...foldersAbove(folder), folder]
    for (const [at, path] of chain.entries()) {
      if (main.get(parentOf(path)) === undefined) {
        unsafe.push(path)
        return
      }
      const shown = listedEntry(main, path)
      if (shown === undefined) {
        walk(folder, chain.slice(at))
        return
      }
      if (shown.isLink || shown.kind !== 'dir') {
        unsafe.push(path)
        return
      }
    }
    walk(folder, [])
  }
  for (const folder of folders) start(folder)

  return { steps, unsafe: sortedUnique(unsafe) }
}
