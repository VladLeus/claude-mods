import { describe, expect, test } from 'claude-code/testing'

import { CLAUDE_MD_PLUGIN, INFRA_PLUGINS, SECURITY_PLUGINS } from './infra'

describe('the improver plugin (G-02-1f, D-141)', () => {
  test('CLAUDE_MD_PLUGIN is the exact key in claude-plugins-official; no role is given it as infra or security', () => {
    expect(CLAUDE_MD_PLUGIN).toBe('claude-md-management@claude-plugins-official')
    expect([...SECURITY_PLUGINS, ...INFRA_PLUGINS]).not.toContain(CLAUDE_MD_PLUGIN)
  })
})
