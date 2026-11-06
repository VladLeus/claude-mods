import { describe, expect, test } from 'claude-code/testing'

import { SECURITY_KEYS } from '../testkit'
import {
  CADRE_TOOLS,
  CLAUDE_MD_PLUGIN,
  CLAUDE_SECURITY_PLUGIN,
  CLAUDE_SECURITY_SKILL,
  INFRA_PLUGINS,
  SECURITY_GUIDANCE_PLUGIN,
  SECURITY_PLUGINS,
} from './infra'

describe('the improver plugin (G-02-1f, D-141)', () => {
  test('CLAUDE_MD_PLUGIN is the exact key in claude-plugins-official; no role is given it as infra or security', () => {
    expect(CLAUDE_MD_PLUGIN).toBe('claude-md-management@claude-plugins-official')
    expect([...SECURITY_PLUGINS, ...INFRA_PLUGINS]).not.toContain(CLAUDE_MD_PLUGIN)
  })
})

describe('security plugin installs (decision #39)', () => {
  test('the plugin keys, their order and the review skill the Security role gets are fixed', () => {
    expect([CLAUDE_SECURITY_PLUGIN, SECURITY_GUIDANCE_PLUGIN]).toEqual(SECURITY_KEYS)
    expect(SECURITY_PLUGINS).toEqual(SECURITY_KEYS)
    expect(Object.isFrozen(SECURITY_PLUGINS)).toBe(true)
    expect(CLAUDE_SECURITY_SKILL).toBe('claude-security:claude-security')
  })
})

describe('the cadre inbox tools', () => {
  test('CADRE_TOOLS holds the full names of the three inbox tools and is frozen', () => {
    expect(CADRE_TOOLS).toEqual(['mcp__cadre__inbox_send', 'mcp__cadre__inbox_read', 'mcp__cadre__inbox_mark'])
    expect(Object.isFrozen(CADRE_TOOLS)).toBe(true)
  })
})
