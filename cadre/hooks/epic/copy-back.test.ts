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
  const input = { copies: ['thoughts'], walked: [], included: ['thoughts'], since, main, tree: listed }

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
  return copyBackPlan({ root: '/repo', worktree: BARE_WORKTREE, copies, walked: [], included, since, main, tree })
}

/** copyBackPlan of the recorded walked folders and no copy, from BARE_WORKTREE into /repo, the copy made at `since`. */
function walkedOf(
  walked: readonly string[],
  included: readonly string[],
  main: Listings,
  tree: Listings,
  since = 1000,
): CopyBack {
  return copyBackPlan({ root: '/repo', worktree: BARE_WORKTREE, copies: [], walked, included, since, main, tree })
}

/** The step that moves the worktree's file at `path` into main, over main's. */
function moveOf(path: string): EpicStep {
  return { kind: 'move', path: `/repo/${path}`, source: `${BARE_WORKTREE}/${path}`, overwrite: true }
}

describe('copying back what the roles wrote in a copied folder at epic done', () => {
  test('a file written after the copy that main lacks is moved into main', () => {
    const plan = planOf(mainOf([['thoughts', []]]), new Map([['thoughts', [fileAt('x.md', 2000)]]]))
    const source = `${BARE_WORKTREE}/thoughts/x.md`

    expect(plan).toEqual({
      steps: [{ kind: 'move', path: '/repo/thoughts/x.md', source, overwrite: true }],
      unsafe: [],
    })
  })

  test('a newer file main holds in another version is moved over it, changed in the worktree only or in both', () => {
    const main = mainOf([['thoughts', [fileAt('both.md', 1500, 2), fileAt('mine.md', 500, 2)]]])
    const tree = new Map([['thoughts', [fileAt('both.md', 2000), fileAt('mine.md', 2000)]]])

    expect(planOf(main, tree)).toEqual({ steps: [moveOf('thoughts/both.md'), moveOf('thoughts/mine.md')], unsafe: [] })
  })

  test('a file not written since the copy, or equal in size and time to main, gives no step', () => {
    const main = mainOf([['thoughts', [fileAt('kept.md', 500, 2), fileAt('same.md', 2000)]]])
    const tree = new Map([['thoughts', [fileAt('gone.md', 500), fileAt('kept.md', 500), fileAt('same.md', 2000)]]])

    expect(planOf(main, tree)).toEqual({ steps: [], unsafe: [] })
  })

  test('a folder main lacks gets one mkdir, from the top, just before the first move below it', () => {
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
      moveOf('thoughts/new/deep/a.md'),
      moveOf('thoughts/new/z.md'),
    ])
    expect(gone.steps).toEqual([{ kind: 'mkdir', path: '/repo/thoughts' }, moveOf('thoughts/x.md')])
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

describe('each copied folder compared against its own copy time', () => {
  /** docs/local copied at 2000, after the record was made at 1000. */
  const COPIED_AT: ReadonlyMap<string, number> = new Map([['docs/local', 2000]])

  /** Main's real folders docs, docs/local and thoughts; a.md in docs/local was changed at 3000 to 2 bytes. */
  const MAIN: Listings = new Map<string, readonly PortEntry[]>([
    ['', [entry('docs', 'dir'), entry('thoughts', 'dir')]],
    ['docs', [entry('local', 'dir')]],
    ['docs/local', [fileAt('a.md', 3000, 2)]],
    ['thoughts', []],
  ])

  /** The worktree's real folders docs, docs/local holding `files`, and thoughts holding x.md written at 2000. */
  function treeWith(...files: PortEntry[]): Listings {
    return new Map<string, readonly PortEntry[]>([
      ['', [entry('docs', 'dir'), entry('thoughts', 'dir')]],
      ['docs', [entry('local', 'dir')]],
      ['docs/local', files],
      ['thoughts', [fileAt('x.md', 2000)]],
    ])
  }

  /** copyBackPlan of the recorded and included `copies` from BARE_WORKTREE into MAIN, the record made at 1000. */
  function ownOf(copies: readonly string[], tree: Listings, copiedAt: ReadonlyMap<string, number>): CopyBack {
    const input = { copies, walked: [], included: copies, since: 1000, copiedAt, main: MAIN, tree }

    return copyBackPlan({ root: '/repo', worktree: BARE_WORKTREE, ...input })
  }

  test("a file at its copy's own time is not moved over main's change; without a copy time it is", () => {
    const tree = treeWith(fileAt('a.md', 2000))

    expect(ownOf(['docs/local'], tree, COPIED_AT)).toEqual({ steps: [], unsafe: [] })
    expect(backOf(['docs/local'], ['docs/local'], MAIN, tree)).toEqual({
      steps: [moveOf('docs/local/a.md')],
      unsafe: [],
    })
  })

  test('a file written after its copy time is moved', () => {
    const tree = treeWith(fileAt('a.md', 2000), fileAt('b.md', 2500))

    expect(ownOf(['docs/local'], tree, COPIED_AT)).toEqual({ steps: [moveOf('docs/local/b.md')], unsafe: [] })
  })

  test('a copy time at or below 0 makes that folder unsafe; another copied folder is still copied back', () => {
    const tree = treeWith(fileAt('a.md', 2500))

    for (const time of [0, -1]) {
      expect(ownOf(['docs/local', 'thoughts'], tree, new Map([['docs/local', time]]))).toEqual({
        steps: [moveOf('thoughts/x.md')],
        unsafe: ['docs/local'],
      })
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
      steps: [moveOf('thoughts/x.md')],
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

describe('moving the new files of a walked folder into main at epic done', () => {
  /** The worktree's walked folder thoughts holding a file new.md. */
  const TREE = treeOf([['thoughts', [fileAt('new.md', 2000)]]])

  test('each new regular file directly in a walked folder is moved, new since the copy or not; the rest stays', () => {
    const children = [
      fileAt('idea.md', 500),
      fileAt('kept.md', 2000),
      fileAt('new.md', 2000),
      link('notes.md'),
      entry('shared', 'dir'),
      entryAt('sock', 'other', 2000),
    ]
    const main = mainOf([['thoughts', [entry('kept.md'), entry('shared', 'dir')]]])

    expect(walkedOf(['thoughts'], ['thoughts/shared'], main, treeOf([['thoughts', children]]))).toEqual({
      steps: [moveOf('thoughts/idea.md'), moveOf('thoughts/new.md')],
      unsafe: [],
    })
  })

  test('a walked folder below which the include file names nothing now is unsafe, named', () => {
    for (const included of [[], ['thoughts'], ['thoughts2/x']]) {
      expect(walkedOf(['thoughts'], included, mainOf([['thoughts', []]]), TREE)).toEqual({
        steps: [],
        unsafe: ['thoughts'],
      })
    }
  })

  test('a walked folder whose folder the worktree cannot list is unsafe; a non-folder one gives nothing', () => {
    const main = mainOf([['thoughts', []]])
    const walked = ['gone', 'thoughts']

    expect(walkedOf(['a/b'], ['a/b/c'], main, TREE)).toEqual({ steps: [], unsafe: ['a/b'] })
    for (const shown of [fileAt('thoughts', 2000), link('thoughts')]) {
      const tree = new Map([['', [shown]]])

      expect(walkedOf(walked, ['gone/x', 'thoughts/shared'], main, tree)).toEqual({ steps: [], unsafe: [] })
    }
  })

  test('with no real creation time a walked folder is unsafe and nothing is moved', () => {
    for (const since of [0, -1]) {
      expect(walkedOf(['thoughts'], ['thoughts/shared'], mainOf([['thoughts', []]]), TREE, since)).toEqual({
        steps: [],
        unsafe: ['thoughts'],
      })
    }
  })

  test("main's way to a walked folder is checked as for a copy: a link, a non-folder or no listing is unsafe", () => {
    const linked = new Map([['', [link('thoughts')]]])
    const file = new Map([['', [entry('thoughts')]]])

    for (const main of [linked, file, new Map()]) {
      expect(walkedOf(['thoughts'], ['thoughts/shared'], main, TREE)).toEqual({ steps: [], unsafe: ['thoughts'] })
    }
  })

  test('a copy temp file in a walked folder is never moved', () => {
    const tree = treeOf([['thoughts', [fileAt('x.md', 2000), fileAt('y.cadre-copy', 2000)]]])

    expect(walkedOf(['thoughts'], ['thoughts/shared'], mainOf([['thoughts', []]]), tree)).toEqual({
      steps: [moveOf('thoughts/x.md')],
      unsafe: [],
    })
  })

  test('a walked folder main lacks is made before the first move into it', () => {
    expect(walkedOf(['thoughts'], ['thoughts/shared'], new Map([['', []]]), TREE)).toEqual({
      steps: [{ kind: 'mkdir', path: '/repo/thoughts' }, moveOf('thoughts/new.md')],
      unsafe: [],
    })
  })

  test('a walked folder the worktree cannot list, or main cannot list where it shows it, is unsafe', () => {
    expect(walkedOf(['thoughts'], ['thoughts/shared'], mainOf([['thoughts', []]]), treeOf([]))).toEqual({
      steps: [],
      unsafe: ['thoughts'],
    })
    expect(walkedOf(['thoughts'], ['thoughts/shared'], mainOf([]), TREE)).toEqual({ steps: [], unsafe: ['thoughts'] })
  })

  test('a copy and a walked folder share the mkdir of a folder main lacks, made once, the copies first', () => {
    const tree = treeOf([
      ['thoughts', [fileAt('idea.md', 2000), entry('shared', 'dir')]],
      ['thoughts/shared', [fileAt('x.md', 2000)]],
    ])
    const input = { copies: ['thoughts/shared'], walked: ['thoughts'], included: ['thoughts/shared'], since: 1000 }
    const main = new Map([['', []]])

    expect(copyBackPlan({ root: '/repo', worktree: BARE_WORKTREE, ...input, main, tree })).toEqual({
      steps: [
        { kind: 'mkdir', path: '/repo/thoughts' },
        { kind: 'mkdir', path: '/repo/thoughts/shared' },
        moveOf('thoughts/shared/x.md'),
        moveOf('thoughts/idea.md'),
      ],
      unsafe: [],
    })
  })
})
