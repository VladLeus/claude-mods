import { describe, expect, test } from 'claude-code/testing'

import { epicLookup, epicManyBranchesReply, epicManyWorktreesReply, parseWorktreeList } from './lookup'
import type { WorktreeEntry } from './lookup'

/** A registered worktree that is not the main checkout, on `branch`, not locked. */
function linkedEntry(path: string, branch: string): WorktreeEntry {
  return { path, branch, locked: null, isMain: false }
}

describe('finding an epic by its key (D-163)', () => {
  test('parseWorktreeList reads each porcelain block: path, branch, lock reason, the first block as main', () => {
    const porcelain =
      'worktree /repo\nHEAD a\nbranch refs/heads/main\n\n' +
      'worktree /repo/.claude/worktrees/proj-1-x\nHEAD b\nbranch refs/heads/epic/proj-1-x\n' +
      'locked claude agent (pid 42)\n\nworktree /w2\nHEAD c\ndetached\n'

    expect(parseWorktreeList(porcelain)).toEqual([
      { path: '/repo', branch: 'main', locked: null, isMain: true },
      { ...linkedEntry('/repo/.claude/worktrees/proj-1-x', 'epic/proj-1-x'), locked: 'claude agent (pid 42)' },
      { path: '/w2', branch: null, locked: null, isMain: false },
    ])
    expect(parseWorktreeList('worktree /repo\nHEAD a\n\nworktree /w\nHEAD b\ndetached\nlocked\n')[1]?.locked).toBe('')
  })

  test('one worktree on epic/<key> or epic/<key>-... is reused, one kept branch is re-added, else new', () => {
    const main: WorktreeEntry = { path: '/repo', branch: 'epic/proj-1', locked: null, isMain: true }
    const x = linkedEntry('/w/x', 'epic/proj-1-x')
    const exact = linkedEntry('/w/e', 'epic/proj-1')
    const ten = linkedEntry('/w/t', 'epic/proj-10')
    const lookup = (worktrees: readonly WorktreeEntry[], branches: readonly string[] = []) =>
      epicLookup({ worktrees, branches, keySlug: 'proj-1' })
    const two = lookup([x, exact])
    const twoText = two.kind === 'refuse' ? two.text : ''

    expect(lookup([main, x, ten])).toEqual({ kind: 'reuse', path: '/w/x', branch: 'epic/proj-1-x' })
    expect(two).toEqual({ kind: 'refuse', text: epicManyWorktreesReply(['/w/x', '/w/e']) })
    expect(['/w/x', '/w/e'].filter(path => twoText.includes(path))).toHaveLength(2)
    expect(lookup([main])).toEqual({ kind: 'new' })
    expect(lookup([main, ten], ['epic/proj-10'])).toEqual({ kind: 'new' })
    expect(lookup([], ['epic/proj-1-old'])).toEqual({ kind: 'readd', branch: 'epic/proj-1-old', name: 'proj-1-old' })
    expect(lookup([], ['epic/proj-1-a', 'epic/proj-1-b'])).toEqual({
      kind: 'refuse',
      text: epicManyBranchesReply(['epic/proj-1-a', 'epic/proj-1-b']),
    })
    expect(lookup([])).toEqual({ kind: 'new' })
  })
})
