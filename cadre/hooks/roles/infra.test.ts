import { describe, expect, test } from 'claude-code/testing'

import {
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

/** The plugin key of claude-security in Anthropic's official marketplace (decision #39). */
const SECURITY_KEY = 'claude-security@claude-plugins-official'

/** The plugin key of security-guidance in Anthropic's official marketplace (decision #39). */
const GUIDANCE_KEY = 'security-guidance@claude-plugins-official'

/** Both security plugin keys, in the order init asks about and installs them (decision #39). */
const SECURITY_KEYS = [SECURITY_KEY, GUIDANCE_KEY]

describe('security plugin installs (decision #39)', () => {
  test('the plugin keys, their order and the review skill the Security role gets are fixed', () => {
    expect([CLAUDE_SECURITY_PLUGIN, SECURITY_GUIDANCE_PLUGIN]).toEqual(SECURITY_KEYS)
    expect(SECURITY_PLUGINS).toEqual(SECURITY_KEYS)
    expect(Object.isFrozen(SECURITY_PLUGINS)).toBe(true)
    expect(CLAUDE_SECURITY_SKILL).toBe('claude-security:claude-security')
  })
})
