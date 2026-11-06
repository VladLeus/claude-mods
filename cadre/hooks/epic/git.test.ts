import { describe, expect, test } from 'claude-code/testing'

import { GLOBAL_EXCLUDES_ARGV } from './git'

describe("the user's global excludes and the reuse mirror (D-147, D-163, D-164)", () => {
  test('the global excludes lookup follows include and includeIf in the global config (03.1-W2 S1)', () => {
    const argv = ['git', '-C', '/repo', 'config', '--includes', '--global', '--path', 'core.excludesFile']

    expect(GLOBAL_EXCLUDES_ARGV('/repo')).toEqual(argv)
  })
})
