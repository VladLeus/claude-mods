import { describe, expect, test } from 'claude-code/testing'

import { mainCheckoutOf } from './common-dir'

describe('the scope of an epic role (RESEARCH Pitfalls 1 and 2, WT-02)', () => {
  test('mainCheckoutOf names the main checkout of a worktree nested in it, else null (03.1-W3 M1)', () => {
    expect(mainCheckoutOf('/repo/.git', '/repo')).toBeNull()
    expect(mainCheckoutOf('/repo/.git', '/repo/.claude/worktrees/proj-1')).toBe('/repo')
    expect(mainCheckoutOf('/data/repo/.git', '/repo')).toBeNull()
    expect(mainCheckoutOf('/repo/.git/modules/sub', '/repo/sub')).toBeNull()
    expect(mainCheckoutOf('/repo/.git', '/repo2/x')).toBeNull()
  })
})
