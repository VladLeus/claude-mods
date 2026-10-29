import { describe, expect, test } from 'claude-code/testing'

import { worktreeClaudeMd } from './render'

describe('the scope of an epic role (RESEARCH Pitfalls 1 and 2, WT-02)', () => {
  test('worktreeClaudeMd adds the CLAUDE.md files of the worktree, sorted and once each (Pitfall 1)', () => {
    expect(worktreeClaudeMd(['/repo/CLAUDE.md'], '/repo/.claude/worktrees/x')).toEqual([
      '/repo/.claude/worktrees/x/.claude/CLAUDE.md',
      '/repo/.claude/worktrees/x/CLAUDE.md',
      '/repo/CLAUDE.md',
    ])
  })
})
