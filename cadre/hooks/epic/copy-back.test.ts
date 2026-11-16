import { describe, expect, test } from 'claude-code/testing'

import type { PortEntry } from '../../types'
import { BARE_WORKTREE, entry, entryAt, link } from '../testkit'
import { copyBackPlan } from './copy-back'
import type { CopyBack } from './copy-back'
import type { EpicStep } from './mirror'

/** Listings keyed by repo-relative folder, as listingsOf keys them. */
type Listings = ReadonlyMap<string, readonly PortEntry[]>

/** A regular file the listing shows written at `mtimeMs`, `size` bytes long. */
function fileAt(name: string, mtimeMs: number, size = 1): PortEntry {
  return { ...entryAt(name, 'file', mtimeMs), size }
}

/** Main's root listing thoughts as a real folder, then the listings `rest` names. */
function mainOf(rest: readonly (readonly [string, readonly PortEntry[]])[]): Listings {
  return new Map<string, readonly PortEntry[]>([['', [entry('thoughts', 'dir')]], ...rest])
}

/** The worktree's root listing thoughts as a real folder, then the listings `rest` names. */
function treeOf(rest: readonly (readonly [string, readonly PortEntry[]])[]): Listings {
  return new Map<string, readonly PortEntry[]>([['', [entry('thoughts', 'dir')]], ...rest])
}

/**
 * copyBackPlan of the recorded copy thoughts, which .worktreeinclude names, from BARE_WORKTREE into /repo, the copy
 * made at `since`; a tree with no root listing gets one that shows thoughts as a real folder.
 */
function planOf(main: Listings, tree: Listings, since = 1000): CopyBack {
  const listed = tree.has('') ? tree : treeOf([...tree])
  const input = { copies: ['thoughts'], included: ['thoughts'], since, main, tree: listed }

  return copyBackPlan({ root: '/repo', worktree: BARE_WORKTREE, ...input })
}

/** copyBackPlan of the recorded `copies` from BARE_WORKTREE into /repo, the copy made at 1000 unless `since` says. */
function backOf(
  copies: readonly string[],
  included: readonly string[],
  main: Listings,
  tree: Listings,
  since = 1000,
): CopyBack {
  return copyBackPlan({ root: '/repo', worktree: BARE_WORKTREE, copies, included, since, main, tree })
}

/** The step that copies the worktree's file at `path` over main's. */
function copyOf(path: string): EpicStep {
  return { kind: 'copy', path: `/repo/${path}`, source: `${BARE_WORKTREE}/${path}` }
}

describe('copying back what the roles wrote in a copied folder at epic done', () => {
  test('a file written after the copy that main lacks is copied back into main', () => {
    const plan = planOf(mainOf([['thoughts', []]]), new Map([['thoughts', [fileAt('x.md', 2000)]]]))

    expect(plan).toEqual({
      steps: [{ kind: 'copy', path: '/repo/thoughts/x.md', source: `${BARE_WORKTREE}/thoughts/x.md` }],
      unsafe: [],
    })
  })

  test('a newer file main holds in another version is copied over it, changed in the worktree only or in both', () => {
    const main = mainOf([['thoughts', [fileAt('both.md', 1500, 2), fileAt('mine.md', 500, 2)]]])
    const tree = new Map([['thoughts', [fileAt('both.md', 2000), fileAt('mine.md', 2000)]]])

    expect(planOf(main, tree)).toEqual({ steps: [copyOf('thoughts/both.md'), copyOf('thoughts/mine.md')], unsafe: [] })
  })

  test('a file not written since the copy, or equal in size and time to main, gives no step', () => {
    const main = mainOf([['thoughts', [fileAt('kept.md', 500, 2), fileAt('same.md', 2000)]]])
    const tree = new Map([['thoughts', [fileAt('gone.md', 500), fileAt('kept.md', 500), fileAt('same.md', 2000)]]])

    expect(planOf(main, tree)).toEqual({ steps: [], unsafe: [] })
  })

  test('a folder main lacks gets one mkdir, from the top, just before the first copy below it', () => {
    const tree = new Map([
      ['thoughts', [entry('moved', 'dir'), entry('new', 'dir')]],
      ['thoughts/moved', [fileAt('old.md', 500)]],
      ['thoughts/new', [entry('deep', 'dir'), fileAt('z.md', 2000)]],
      ['thoughts/new/deep', [fileAt('a.md', 2000)]],
    ])
    const gone = planOf(new Map([['', []]]), new Map([['thoughts', [fileAt('x.md', 2000)]]]))

    expect(planOf(mainOf([['thoughts', []]]), tree).steps).toEqual([
      { kind: 'mkdir', path: '/repo/thoughts/new' },
      { kind: 'mkdir', path: '/repo/thoughts/new/deep' },
      copyOf('thoughts/new/deep/a.md'),
      copyOf('thoughts/new/z.md'),
    ])
    expect(gone.steps).toEqual([{ kind: 'mkdir', path: '/repo/thoughts' }, copyOf('thoughts/x.md')])
  })

  test('a link or an entry of another kind in the copy gives nothing', () => {
    const odd = [link('a'), entryAt('b.md', 'file', 2000, true), entry('c', 'dir', true), entryAt('d', 'other', 2000)]

    expect(planOf(mainOf([['thoughts', []]]), new Map([['thoughts', odd]]))).toEqual({ steps: [], unsafe: [] })
  })

  test('a file at a path main holds as a link, a folder or another kind is unsafe, newer or not', () => {
    const held = [link('a.md'), entry('b.md', 'dir'), entry('c.md', 'other')]
    const tree = new Map([['thoughts', [fileAt('a.md', 2000), fileAt('b.md', 500), fileAt('c.md', 2000)]]])

    expect(planOf(mainOf([['thoughts', held]]), tree)).toEqual({
      steps: [],
      unsafe: ['thoughts/a.md', 'thoughts/b.md', 'thoughts/c.md'],
    })
  })

  test('a worktree folder main lists as a link or a non-folder is unsafe at any depth, and not walked', () => {
    const main = mainOf([
      ['thoughts', [entry('a', 'dir')]],
      ['thoughts/a', [link('b'), entry('c')]],
    ])
    const tree = new Map([
      ['thoughts', [entry('a', 'dir')]],
      ['thoughts/a', [entry('b', 'dir'), entry('c', 'dir')]],
      ['thoughts/a/b', [fileAt('x.md', 2000)]],
      ['thoughts/a/c', [fileAt('y.md', 2000)]],
    ])

    expect(planOf(main, tree)).toEqual({ steps: [], unsafe: ['thoughts/a/b', 'thoughts/a/c'] })
  })

  test('a copied folder main holds as a link or not as a folder is unsafe whole', () => {
    const tree = new Map([['thoughts', [fileAt('x.md', 2000)]]])

    for (const shown of [link('thoughts'), entry('thoughts')]) {
      expect(planOf(new Map([['', [shown]]]), tree)).toEqual({ steps: [], unsafe: ['thoughts'] })
    }
  })

  test('a folder above a copied folder that main holds as a link is unsafe, so nothing is written through it', () => {
    const main = new Map([
      ['', [link('thoughts')]],
      ['thoughts', [entry('shared', 'dir')]],
    ])
    const tree = treeOf([
      ['thoughts', [entry('shared', 'dir')]],
      ['thoughts/shared', [fileAt('x.md', 2000)]],
    ])

    expect(backOf(['thoughts/shared'], ['thoughts/shared'], main, tree)).toEqual({ steps: [], unsafe: ['thoughts'] })
  })

  test('a worktree folder the listings do not hold, or a real folder of main they do not hold, is unsafe', () => {
    const tree = new Map([
      ['thoughts', [entry('a', 'dir'), entry('b', 'dir')]],
      ['thoughts/b', [fileAt('x.md', 2000)]],
    ])
    const main = mainOf([['thoughts', [entry('b', 'dir')]]])

    expect(planOf(main, tree).unsafe).toEqual(['thoughts/a', 'thoughts/b'])
    expect(planOf(mainOf([['thoughts', []]]), new Map()).unsafe).toEqual(['thoughts'])
  })

  test('with no real creation time no step is planned and every copied folder is unsafe', () => {
    const main = mainOf([['thoughts', []]])
    const tree = new Map([
      ['', [entry('docs', 'dir'), entry('thoughts', 'dir')]],
      ['thoughts', [fileAt('x.md', 2000)]],
    ])
    const copies = ['thoughts', 'docs']

    for (const since of [0, -1]) {
      expect(planOf(main, tree, since)).toEqual({ steps: [], unsafe: ['thoughts'] })
      expect(backOf(copies, copies, main, tree, since)).toEqual({ steps: [], unsafe: ['docs', 'thoughts'] })
    }
  })
})

describe('what epic done may copy back', () => {
  test('a recorded copy whose folder the worktree cannot list is unsafe, named, and not walked', () => {
    const main = mainOf([['thoughts', [entry('shared', 'dir')]]])
    const shared = treeOf([['thoughts/shared', [fileAt('x.md', 2000)]]])

    expect(backOf(['thoughts/shared'], ['thoughts/shared'], main, shared)).toEqual({
      steps: [],
      unsafe: ['thoughts/shared'],
    })
    expect(backOf(['thoughts'], ['thoughts'], main, new Map([['thoughts', [fileAt('x.md', 2000)]]]))).toEqual({
      steps: [],
      unsafe: ['thoughts'],
    })
  })

  test('a recorded copy the worktree lists as a file, a link or not at all gives nothing, included or not', () => {
    const tree = new Map([['', [fileAt('.env', 2000), link('docs')]]])
    const copies = ['.env', 'docs', 'gone']

    for (const included of [[], copies]) {
      expect(backOf(copies, included, mainOf([]), tree)).toEqual({ steps: [], unsafe: [] })
    }
  })

  test('a recorded copied folder the include file does not name now is unsafe, named, and not walked', () => {
    const folders = [entry('node_modules', 'dir'), entry('thoughts', 'dir')]
    const main = new Map([
      ['', folders],
      ['node_modules', []],
      ['thoughts', []],
    ])
    const tree = new Map([
      ['', folders],
      ['node_modules', [fileAt('x.js', 2000)]],
      ['thoughts', [fileAt('x.md', 2000)]],
    ])
    const copies = ['node_modules', 'thoughts']

    expect(backOf(copies, ['thoughts'], main, tree)).toEqual({
      steps: [copyOf('thoughts/x.md')],
      unsafe: ['node_modules'],
    })
    expect(backOf(copies, [], main, tree)).toEqual({ steps: [], unsafe: ['node_modules', 'thoughts'] })
  })

  test('with no real creation time the unsafe copies and every copied folder are unsafe, a skipped one not', () => {
    const tree = new Map([
      ['', [fileAt('.env', 2000), entry('docs', 'dir'), entry('node_modules', 'dir'), entry('thoughts', 'dir')]],
      ['thoughts', [fileAt('x.md', 2000)]],
    ])
    const copies = ['.env', 'a/b', 'docs', 'node_modules', 'thoughts']

    expect(backOf(copies, ['.env', 'a/b', 'docs', 'thoughts'], mainOf([]), tree, 0)).toEqual({
      steps: [],
      unsafe: ['a/b', 'docs', 'node_modules', 'thoughts'],
    })
  })

  test('a path above or at a copied folder whose parent main cannot list is unsafe, nothing below it walked', () => {
    const tree = treeOf([
      ['thoughts', [entry('shared', 'dir')]],
      ['thoughts/shared', [fileAt('x.md', 2000)]],
    ])
    const rootOnly = new Map([['', [entry('thoughts', 'dir')]]])

    expect(backOf(['thoughts/shared'], ['thoughts/shared'], rootOnly, tree)).toEqual({
      steps: [],
      unsafe: ['thoughts/shared'],
    })
    expect(backOf(['thoughts'], ['thoughts'], new Map(), tree)).toEqual({ steps: [], unsafe: ['thoughts'] })
  })
})
