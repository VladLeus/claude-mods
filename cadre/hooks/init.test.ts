import { describe, expect, test } from 'claude-code/testing'

import type { PortStat } from '../types'
import { FILE_SYSTEM_ROOT_REPLY, HOME_ROOT_REPLY } from './facts'
import {
  askChoice,
  commandRefusal,
  GIT_POLICY_OPTIONS,
  INIT_CANCELLED,
  INIT_FILE_SYSTEM_ROOT_REPLY,
  INIT_HOME_ROOT_REPLY,
  NOT_INTERACTIVE_REPLY,
  parseGitPolicy,
  pluginVersionOf,
  policyLine,
  portProbeOf,
  portTextOf,
} from './init'
import { memIo, memWorld } from './testkit'

describe('init helpers', () => {
  test('commandRefusal names the given command wherever a detect refusal names detect', () => {
    expect(commandRefusal(HOME_ROOT_REPLY, 'init')).toBe(
      'cadre init needs a repo root other than your home folder. ' +
        'Open the session in a repo and run /cadre init again.',
    )
    expect(commandRefusal(FILE_SYSTEM_ROOT_REPLY, 'regen')).toBe(
      'cadre regen needs a repo root other than the file system root (/). ' +
        'Open the session in a repo and run /cadre regen again.',
    )
    expect(commandRefusal('no command is named here', 'init')).toBe('no command is named here')
  })

  test('the init refusals use the init wording and the detect refusals keep their own, byte for byte', () => {
    expect(INIT_HOME_ROOT_REPLY).toBe(commandRefusal(HOME_ROOT_REPLY, 'init'))
    expect(INIT_FILE_SYSTEM_ROOT_REPLY).toBe(commandRefusal(FILE_SYSTEM_ROOT_REPLY, 'init'))
    expect(INIT_HOME_ROOT_REPLY).not.toContain('detect')
    expect(INIT_FILE_SYSTEM_ROOT_REPLY).not.toContain('detect')
    expect(HOME_ROOT_REPLY).toBe(
      'cadre detect needs a repo root other than your home folder. ' +
        'Open the session in a repo and run /cadre detect again.',
    )
    expect(FILE_SYSTEM_ROOT_REPLY).toBe(
      'cadre detect needs a repo root other than the file system root (/). ' +
        'Open the session in a repo and run /cadre detect again.',
    )
  })

  test('the non-interactive and cancelled replies state what happened and that nothing was written', () => {
    expect(NOT_INTERACTIVE_REPLY).toBe(
      'cadre init needs an interactive session to ask its questions. ' +
        'Run /cadre init in a terminal session, not with claude -p.',
    )
    expect(INIT_CANCELLED).toBe('init cancelled, nothing written')
  })

  test('parseGitPolicy maps the three labels, trimmed and in any case', () => {
    expect(parseGitPolicy('Commit definitions (default)')).toBe('definitions')
    expect(parseGitPolicy('Commit all')).toBe('all')
    expect(parseGitPolicy('Ignore all of .cadre/')).toBe('ignore')
    expect(parseGitPolicy('  commit ALL ')).toBe('all')
    expect(parseGitPolicy('IGNORE ALL OF .CADRE/')).toBe('ignore')
  })

  test('parseGitPolicy also maps the words definitions, all and ignore', () => {
    expect(parseGitPolicy('definitions')).toBe('definitions')
    expect(parseGitPolicy('All')).toBe('all')
    expect(parseGitPolicy(' ignore ')).toBe('ignore')
  })

  test('parseGitPolicy gives null for an empty, unknown or half-matching answer', () => {
    expect(parseGitPolicy('')).toBeNull()
    expect(parseGitPolicy('   ')).toBeNull()
    expect(parseGitPolicy('whatever')).toBeNull()
    expect(parseGitPolicy('commit')).toBeNull()
    expect(parseGitPolicy('commit all of it')).toBeNull()
  })

  test('the git policy options are listed default, all, ignore, frozen, and each parses to its own policy', () => {
    expect(GIT_POLICY_OPTIONS).toEqual(['Commit definitions (default)', 'Commit all', 'Ignore all of .cadre/'])
    expect(Object.isFrozen(GIT_POLICY_OPTIONS)).toBe(true)
    expect(GIT_POLICY_OPTIONS.map(option => parseGitPolicy(option))).toEqual(['definitions', 'all', 'ignore'])
  })

  test('policyLine states each policy and what stays out of git', () => {
    expect(policyLine('definitions')).toBe('Git policy: commit definitions (.cadre/*/.runtime/ ignored)')
    expect(policyLine('all')).toBe(
      'Git policy: commit all (only per-user rendered files in .cadre/*/.runtime/ ignored)',
    )
    expect(policyLine('ignore')).toBe('Git policy: ignore all of .cadre/')
  })

  test('pluginVersionOf reads a plain x.y.z version from plugin.json', () => {
    expect(pluginVersionOf('{"name":"cadre","version":"0.1.18"}')).toBe('0.1.18')
    expect(pluginVersionOf('{"version":"10.20.30"}')).toBe('10.20.30')
  })

  test('pluginVersionOf gives null for text that is not JSON, not an object, or has no plain version', () => {
    const bad = [
      '',
      'not json',
      '[]',
      'null',
      '"0.1.18"',
      '{}',
      '{"version":18}',
      '{"version":"1.2"}',
      '{"version":"v1.2.3"}',
      '{"version":"1.2.3-beta"}',
      '{"version":"1.2.3\\n"}',
    ]
    for (const text of bad) {
      expect(pluginVersionOf(text)).toBeNull()
    }
  })

  test('askChoice gives null after exactly two asks for an invalid answer followed by a dismissal', async () => {
    const run = memIo(memWorld({}), ['nonsense'])
    const policy = await askChoice(run.io, 'Git policy?', { options: GIT_POLICY_OPTIONS }, parseGitPolicy)
    expect(policy).toBeNull()
    expect(run.asked).toEqual(['Git policy?', 'Git policy?'])
  })

  describe('the init port read decisions', () => {
    const MAX = 10
    const file = (size: number): PortStat => ({ kind: 'file', size, isLink: false, realPath: '/repo/a' })

    test('portProbeOf is absent only when the probe says the path is not there', () => {
      expect(portProbeOf(false, null, MAX)).toEqual({ state: 'absent' })
      expect(portProbeOf(false, file(1), MAX)).toEqual({ state: 'absent' })
    })

    test('portProbeOf is unknown when the probe failed', () => {
      expect(portProbeOf(null, null, MAX)).toEqual({ state: 'unknown' })
    })

    test('portProbeOf is unknown for a null stat and for a stat that is not a file', () => {
      expect(portProbeOf(true, null, MAX)).toEqual({ state: 'unknown' })
      expect(portProbeOf(true, { kind: 'dir', size: 1, isLink: false }, MAX)).toEqual({ state: 'unknown' })
      expect(portProbeOf(true, { kind: 'other', size: 1, isLink: false }, MAX)).toEqual({ state: 'unknown' })
    })

    test('portProbeOf reads a link to a regular file', () => {
      expect(portProbeOf(true, { kind: 'file', size: 1, isLink: true, realPath: '/repo/real' }, MAX)).toBeNull()
    })

    test('portProbeOf is too-large by the stat size and null (go on and read) at the limit', () => {
      expect(portProbeOf(true, file(MAX + 1), MAX)).toEqual({ state: 'too-large', bytes: MAX + 1 })
      expect(portProbeOf(true, file(MAX), MAX)).toBeNull()
    })

    test('portTextOf is unknown for a non-string, too-large by the UTF-8 bytes, else the text', () => {
      expect(portTextOf(null, MAX)).toEqual({ state: 'unknown' })
      expect(portTextOf(42, MAX)).toEqual({ state: 'unknown' })
      expect(portTextOf('€€€€', MAX)).toEqual({ state: 'too-large', bytes: 12 })
      expect(portTextOf('€€€', MAX)).toEqual({ state: 'text', text: '€€€' })
      expect(portTextOf('abcdefghij', MAX)).toEqual({ state: 'text', text: 'abcdefghij' })
    })
  })
})
