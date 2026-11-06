import { describe, expect, test } from 'claude-code/testing'

import type { PluginVersion } from '../../../types'
import {
  foldEnabledPlugins,
  hookScriptsMatching,
  isPluginKey,
  parseEnabledPlugins,
  parseHookScripts,
  parseInstalledPlugins,
} from './settings'

/** A value planted in settings env and in a hook command; it must never reach Facts. */
const SENTINEL = 'SENTINEL_SECRET_123'

/** parseInstalledPlugins with the root as given equal to the resolved root, unless told otherwise. */
function installedPluginsOf(value: unknown, root: string, givenRoot: string = root): PluginVersion[] {
  return parseInstalledPlugins(value, root, givenRoot)
}

describe('isPluginKey (D-267)', () => {
  test('a key is name@marketplace: one @, two non-empty parts, no whitespace, no part ending in punctuation', () => {
    const kept = ['autopilot@local-mods', 'superpowers@claude-plugins-official']
    const refused = ['autopilot@local-mods.', 'a b@m', '@m', 'a@', 'a@b@c', 'a.@m', '']
    expect([kept.map(key => isPluginKey(key)), refused.map(key => isPluginKey(key))]).toEqual([
      kept.map(() => true),
      refused.map(() => false),
    ])
  })

  test('both plugin parsers drop autopilot@local-mods. and keep autopilot@local-mods', () => {
    const value = { enabledPlugins: { 'autopilot@local-mods': true, 'autopilot@local-mods.': true } }
    const entries = [{ scope: 'user', version: '0.5.0' }]
    const plugins = { plugins: { 'autopilot@local-mods': entries, 'autopilot@local-mods.': entries } }
    const enabled = parseEnabledPlugins(value, 'user').map(flag => flag.key)
    const installed = installedPluginsOf(plugins, '/repo').map(plugin => plugin.key)
    expect([enabled, installed]).toEqual([['autopilot@local-mods'], ['autopilot@local-mods']])
  })
})

describe('parseEnabledPlugins', () => {
  test('keeps boolean flags only, each with the settings source it came from', () => {
    const value = {
      enabledPlugins: { 'superpowers@claude-plugins-official': true, 'x@y': 'yes' },
      env: { K: SENTINEL },
    }
    expect(parseEnabledPlugins(value, 'user')).toEqual([
      { key: 'superpowers@claude-plugins-official', source: 'user', value: true },
    ])
  })

  test('drops a malformed key and a key with bidi or line-break characters (WR-03, D-267)', () => {
    const value = { enabledPlugins: { 'superpowers@x.': true, 'tool\u202E@a\nb': false, 'superpowers@x': true } }
    expect(parseEnabledPlugins(value, 'project')).toEqual([{ key: 'superpowers@x', source: 'project', value: true }])
  })

  test('a key longer than 120 code points is dropped, and a key of exactly 120 is kept (WR-03 decision)', () => {
    const [long, kept] = [`${'k'.repeat(60)}@${'m'.repeat(60)}`, `${'j'.repeat(60)}@${'m'.repeat(59)}`]
    const keys = parseEnabledPlugins({ enabledPlugins: { [long]: true, [kept]: true } }, 'user').map(flag => flag.key)
    expect(keys).toEqual([kept])
  })

  test('gives no flags for null, for an array, or for an object without enabledPlugins', () => {
    expect(parseEnabledPlugins(null, 'user')).toEqual([])
    expect(parseEnabledPlugins([{ enabledPlugins: { 'a@b': true } }], 'user')).toEqual([])
    expect(parseEnabledPlugins({ other: { 'a@b': true } }, 'user')).toEqual([])
  })
})

describe('foldEnabledPlugins', () => {
  test('a later source replaces the value and the source of an earlier flag, keeping the first position', () => {
    expect(
      foldEnabledPlugins([
        { key: 'a@b', source: 'user', value: true },
        { key: 'c@d', source: 'user', value: true },
        { key: 'a@b', source: 'project', value: false },
      ]),
    ).toEqual([
      { key: 'a@b', source: 'project', value: false },
      { key: 'c@d', source: 'user', value: true },
    ])
  })
})

describe('parseHookScripts', () => {
  test('keeps only the basename of a gsd- script, with the event and the source', () => {
    const value = {
      hooks: {
        PostToolUse: [
          { hooks: [{ type: 'command', command: '"$(x)" "/Users/someone/.claude/hooks/gsd-context-monitor.js"' }] },
        ],
      },
    }
    expect(parseHookScripts(value, 'user')).toEqual([
      { script: 'gsd-context-monitor.js', event: 'PostToolUse', source: 'user' },
    ])
  })

  test('keeps the .sh and .cjs script forms as well as .js', () => {
    const value = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'bash "/x/gsd-check.sh"' },
              { type: 'command', command: 'node /x/gsd-tools.cjs' },
            ],
          },
        ],
      },
    }
    expect(parseHookScripts(value, 'local')).toEqual([
      { script: 'gsd-check.sh', event: 'Stop', source: 'local' },
      { script: 'gsd-tools.cjs', event: 'Stop', source: 'local' },
    ])
  })

  test('a command with no gsd- script gives nothing, and neither does a name that only contains gsd-', () => {
    const value = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'node /Users/someone/hooks/other.js' },
              { type: 'command', command: 'node /x/mygsd-helper.js' },
              { type: 'command', command: 'node /x/gsd-helper.js.bak' },
            ],
          },
        ],
      },
    }
    expect(parseHookScripts(value, 'user')).toEqual([])
  })

  test('a basename with an 80-character stem is reported and one with an 81-character stem is not', () => {
    const value = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: `node /x/gsd-${'a'.repeat(80)}.js` },
              { type: 'command', command: `node /x/gsd-${'b'.repeat(81)}.js` },
            ],
          },
        ],
      },
    }
    expect(parseHookScripts(value, 'user').map(hook => hook.script)).toEqual([`gsd-${'a'.repeat(80)}.js`])
  })

  test('an event name longer than 60 code points is cut to 60 with an ellipsis', () => {
    const value = { hooks: { [`${'e'.repeat(61)}`]: [{ hooks: [{ type: 'command', command: 'node /x/gsd-x.js' }] }] } }
    expect(parseHookScripts(value, 'user')[0]?.event).toBe(`${'e'.repeat(59)}\u2026`)
  })

  test('a script named twice for the same event and source appears once', () => {
    const value = {
      hooks: {
        PostToolUse: [
          {
            hooks: [
              { type: 'command', command: 'node /a/gsd-x.js' },
              { type: 'command', command: 'node /b/gsd-x.js' },
            ],
          },
          { hooks: [{ type: 'command', command: 'node /a/gsd-x.js' }] },
        ],
      },
    }
    expect(parseHookScripts(value, 'user')).toEqual([{ script: 'gsd-x.js', event: 'PostToolUse', source: 'user' }])
  })

  test('a hook whose type is missing or is not exactly command gives nothing (#54 A4)', () => {
    const value = {
      hooks: {
        Stop: [
          {
            hooks: [
              { command: 'node /x/gsd-untyped.js' },
              { type: 'prompt', command: 'node /x/gsd-prompt.js' },
              { type: 'Command', command: 'node /x/gsd-cased.js' },
              { type: 'command', command: 'node /x/gsd-typed.js' },
            ],
          },
        ],
      },
    }
    expect(parseHookScripts(value, 'user')).toEqual([{ script: 'gsd-typed.js', event: 'Stop', source: 'user' }])
  })
})

describe('parseInstalledPlugins', () => {
  test('a key longer than 120 code points is dropped (WR-03 decision)', () => {
    const installed = installedPluginsOf(
      { plugins: { [`${'k'.repeat(121)}`]: [{ scope: 'user', version: '1.0.0' }] } },
      '/repo',
    )
    expect(installed).toEqual([])
  })

  test('gives the key and the version only, and the install path is never returned', () => {
    const installed = installedPluginsOf(
      {
        version: 2,
        plugins: {
          'superpowers@claude-plugins-official': [{ scope: 'user', version: '6.4.1', installPath: '/Users/x' }],
        },
      },
      '/repo',
    )
    expect(installed).toEqual([{ key: 'superpowers@claude-plugins-official', version: '6.4.1' }])
    expect(JSON.stringify(installed)).not.toContain('installPath')
  })

  test('the first entry with a usable version wins, and an entry without one is skipped', () => {
    const installed = installedPluginsOf(
      {
        version: 2,
        plugins: {
          'superpowers@claude-plugins-official': [
            { scope: 'user', version: 'latest' },
            { scope: 'project', projectPath: '/repo', version: '6.4.1' },
          ],
        },
      },
      '/repo',
    )
    expect(installed).toEqual([{ key: 'superpowers@claude-plugins-official', version: '6.4.1' }])
  })

  test('a user entry wins over an earlier project entry for the same repo (WR-04)', () => {
    const installed = installedPluginsOf(
      {
        plugins: {
          'superpowers@x': [
            { scope: 'project', projectPath: '/repo', version: '1.0.0' },
            { scope: 'user', version: '2.0.0' },
          ],
        },
      },
      '/repo',
    )
    expect(installed).toEqual([{ key: 'superpowers@x', version: '2.0.0' }])
  })

  test("another project's entry is ignored, so its version never shows for this repo (WR-04)", () => {
    const installed = installedPluginsOf(
      { plugins: { 'superpowers@x': [{ scope: 'project', projectPath: '/other', version: '9.9.9' }] } },
      '/repo',
    )
    expect(installed).toEqual([])
  })

  // Guard: passes before the fix by design; it proves the WR-04 scoping keeps this repo's local entry.
  test('a local entry whose projectPath is the repo root counts, trailing slashes ignored (WR-04)', () => {
    const installed = installedPluginsOf(
      { plugins: { 'superpowers@x': [{ scope: 'local', projectPath: '/repo/', version: '3.0.0' }] } },
      '/repo',
    )
    expect(installed).toEqual([{ key: 'superpowers@x', version: '3.0.0' }])
  })

  test('a project entry whose projectPath is the root as given counts when the resolved root differs', () => {
    const value = { plugins: { 'superpowers@x': [{ scope: 'project', projectPath: '/tmp/repo', version: '4.0.0' }] } }
    expect(installedPluginsOf(value, '/private/tmp/repo', '/tmp/repo')).toEqual([
      { key: 'superpowers@x', version: '4.0.0' },
    ])
    expect(installedPluginsOf(value, '/private/tmp/repo')).toEqual([])
  })

  // Guard: passes before the fix by design; it pins that an empty root form matches no entry.
  test('a root that trims to nothing never matches an entry, as given or as resolved', () => {
    const value = { plugins: { 'a@b': [{ scope: 'project', projectPath: '/', version: '1.0.0' }] } }
    expect(installedPluginsOf(value, '/', '//')).toEqual([])
  })

  test('an entry with no scope or an unknown scope is ignored (WR-04)', () => {
    const installed = installedPluginsOf(
      { plugins: { 'a@b': [{ version: '1.0.0' }], 'c@d': [{ scope: 'managed', version: '1.0.0' }] } },
      '/repo',
    )
    expect(installed).toEqual([])
  })

  test('a key with hidden characters is dropped (WR-03)', () => {
    const installed = installedPluginsOf(
      { plugins: { 'superpowers@x\u200B': [{ scope: 'user', version: '1.0.0' }] } },
      '/repo',
    )
    expect(installed).toEqual([])
  })
})

describe('safety net: hookScriptsMatching (A8)', () => {
  test('hookScriptsMatching: each matched basename of a command hook, once per event, with its source', () => {
    const settings = {
      hooks: {
        PreToolUse: [
          { hooks: [{ type: 'command', command: 'bash /x/a.sh --then b.sh' }, { type: 'prompt', command: 'c.sh' }] },
          { hooks: [{ type: 'command', command: 'a.sh again' }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'b.sh' }] }],
        [String.fromCodePoint(0x202e)]: [{ hooks: [{ type: 'command', command: 'd.sh' }] }],
        Notification: 'not a list',
      },
    }
    expect(hookScriptsMatching(settings, 'project', /[a-z]+\.sh/g)).toEqual([
      { script: 'a.sh', event: 'PreToolUse', source: 'project' },
      { script: 'b.sh', event: 'PreToolUse', source: 'project' },
      { script: 'b.sh', event: 'Stop', source: 'project' },
    ])
    const none = [hookScriptsMatching(null, 'user', /a/g), hookScriptsMatching({ hooks: [] }, 'user', /a/g)]
    expect(none).toEqual([[], []])
  })
})
