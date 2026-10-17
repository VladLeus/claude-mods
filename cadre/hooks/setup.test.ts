import { describe, expect, test } from 'claude-code/testing'

import type { SettingsSource, SetupScan } from '../types'
import { projectHooks, projectSettings, scanSetup } from './setup'
import type { SetupContext } from './setup'
import { ABSOLUTE_PATH_MARKERS, leaks, memIo, memWorld, SECRET_FIXTURES } from './testkit'
import type { MemWorld } from './testkit'

/** The session of the fixtures: the repo /repo of a user whose home is /home/u, with no CLAUDE_CONFIG_DIR. */
const CTX: SetupContext = { root: '/repo', givenRoot: '/repo', home: '/home/u', configDir: null }

/** The secret fixtures and the fixture home: nothing of these may survive into a scan. */
const SECRETS: readonly string[] = [...SECRET_FIXTURES, '/home/u']

/** User settings that hold a secret in every place a value can sit: env, the status line and two hook commands. */
function secretUserSettings(): unknown {
  return {
    env: { API_KEY: 'sk-FAKE-SECRET-0123456789', JIRA_URL: 'x' },
    autoCompactWindow: 800000,
    statusLine: {
      type: 'command',
      command: '/home/u/.claude/hooks/gsd-statusline.js --t Bearer FAKE-TOKEN-0123',
    },
    hooks: {
      PreToolUse: [
        {
          hooks: [
            { command: 'SECRET=SENTINEL_SECRET_VALUE node /home/u/.claude/hooks/gsd-secret-read-guard.js' },
            { command: '/home/u/bin/my-hook.sh --key ghp_FAKEFAKEFAKEFAKEFAKE' },
          ],
        },
      ],
    },
  }
}

/** A world whose user settings are the secret ones and whose project and local settings are empty. */
function secretWorld(): MemWorld {
  return memWorld({ settings: { user: secretUserSettings(), project: {}, local: {} } })
}

/** A world whose three settings sources are the given ones. */
function settingsWorld(user: unknown, project: unknown = {}, local: unknown = {}): MemWorld {
  return memWorld({ settings: { user, project, local } })
}

/** A scan of `world` as the person at CTX gets it. */
async function scanOf(world: MemWorld, isClaudeJsonAllowed = false): Promise<SetupScan> {
  return scanSetup(memIo(world, []).io, CTX, isClaudeJsonAllowed)
}

/** The projection of user settings alone. */
function userOnly(value: unknown): ReturnType<typeof projectSettings> {
  return projectSettings([{ source: 'user', value }])
}

/** The settings of one source with a single PreToolUse hook that runs `command`. */
function hookSettings(command: unknown): unknown {
  return { hooks: { PreToolUse: [{ hooks: [{ command }] }] } }
}

describe('setup settings', () => {
  test('the secret world gives the carry facts, the hook basenames and the settings key names', async () => {
    const scan = await scanOf(secretWorld())
    expect(scan.carry).toEqual({
      autoCompactWindow: 800000,
      hasStatusLine: true,
      isGsdStatusline: true,
      envNames: ['API_KEY', 'JIRA_URL'],
    })
    expect(scan.hooks).toEqual([
      { script: 'gsd-secret-read-guard.js', event: 'PreToolUse', source: 'user' },
      { script: 'my-hook.sh', event: 'PreToolUse', source: 'user' },
    ])
    expect(scan.settingsKeys).toEqual([
      { source: 'user', keys: ['autoCompactWindow', 'env', 'hooks', 'statusLine'] },
      { source: 'project', keys: [] },
      { source: 'local', keys: [] },
    ])
  })

  test('no secret fixture and no home path survives into the scan of the secret world', async () => {
    const json = JSON.stringify(await scanOf(secretWorld()))
    expect(leaks(json, SECRETS)).toEqual([])
    expect(leaks(json, ABSOLUTE_PATH_MARKERS)).toEqual([])
  })

  test('settingsKeys lists the user, project and local sources in that order with their names sorted', () => {
    const out = projectSettings([
      { source: 'local', value: { zeta: 1, alpha: 2 } },
      { source: 'user', value: { model: 'x', env: {} } },
      { source: 'project', value: { permissions: {} } },
    ])
    expect(out.settingsKeys).toEqual([
      { source: 'user', keys: ['env', 'model'] },
      { source: 'project', keys: ['permissions'] },
      { source: 'local', keys: ['alpha', 'zeta'] },
    ])
  })

  test('a source that is missing, or whose value is not an object, has no entry in settingsKeys', () => {
    const out = projectSettings([
      { source: 'user', value: { a: 1 } },
      { source: 'project', value: 'not an object' },
      { source: 'local', value: ['a'] },
    ])
    expect(out.settingsKeys).toEqual([{ source: 'user', keys: ['a'] }])
    expect(projectSettings([]).settingsKeys).toEqual([])
  })

  test('at most 100 key names are kept per source, the first 100 in sorted order', () => {
    const keys = Array.from({ length: 150 }, (_, index) => `key${String(index).padStart(3, '0')}`)
    const value = Object.fromEntries(keys.map((key): [string, boolean] => [key, true]))
    const kept = userOnly(value).settingsKeys[0]?.keys ?? []
    expect(kept).toHaveLength(100)
    expect(kept[0]).toBe('key000')
    expect(kept[99]).toBe('key099')
  })

  test('autoCompactWindow is a positive integer of the user settings, else null', () => {
    const cases: readonly (readonly [unknown, number | null])[] = [
      [800000, 800000],
      [1, 1],
      [0, null],
      [-5, null],
      [1.5, null],
      [Number.NaN, null],
      [Number.POSITIVE_INFINITY, null],
      ['800000', null],
      [null, null],
      [undefined, null],
    ]
    const found = cases.map(([value]) => userOnly({ autoCompactWindow: value }).carry.autoCompactWindow)
    expect(found).toEqual(cases.map(([, expected]) => expected))
  })

  test('hasStatusLine is true for a statusLine object, isGsdStatusline only for a gsd-statusline script', () => {
    const cases: readonly (readonly [unknown, boolean, boolean])[] = [
      [{ type: 'command', command: 'node /x/gsd-statusline.js' }, true, true],
      [{ type: 'command', command: '/x/gsd-statusline.cjs --compact' }, true, true],
      [{ type: 'command', command: 'sh "/x/gsd-statusline.sh"' }, true, true],
      [{ type: 'command', command: 'node /x/gsd-statusline.py' }, true, false],
      [{ type: 'command', command: 'node /x/mygsd-statusline.js' }, true, false],
      [{ type: 'command', command: 'node /x/gsd-statusline.js.bak' }, true, false],
      [{ type: 'command' }, true, false],
      [{ type: 'command', command: 5 }, true, false],
      ['gsd-statusline.js', false, false],
      [null, false, false],
      [undefined, false, false],
    ]
    const found = cases.map(([statusLine]) => {
      const { hasStatusLine, isGsdStatusline } = userOnly({ statusLine }).carry

      return [statusLine, hasStatusLine, isGsdStatusline]
    })
    expect(found).toEqual(cases)
  })

  test('envNames are the env keys of the user settings that look like variable names, sorted', () => {
    const env = {
      API_KEY: 'sk-FAKE-SECRET-0123456789',
      JIRA_URL: 'x',
      _PRIVATE: 'y',
      lower: 'z',
      '1BAD': 'a',
      'HAS-DASH': 'b',
      [`A${'B'.repeat(63)}`]: 'longest allowed',
      [`A${'B'.repeat(64)}`]: 'one too long',
    }
    expect(userOnly({ env }).carry.envNames).toEqual([`A${'B'.repeat(63)}`, 'API_KEY', 'JIRA_URL', '_PRIVATE'])
    expect(userOnly({ env: 'not an object' }).carry.envNames).toEqual([])
    expect(leaks(JSON.stringify(userOnly({ env })), SECRET_FIXTURES)).toEqual([])
  })

  test('the carry facts come from the user source only', () => {
    const settings = { autoCompactWindow: 5, statusLine: { command: 'gsd-statusline.js' }, env: { X: '1' } }
    const none = { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] }
    expect(projectSettings([{ source: 'project', value: settings }]).carry).toEqual(none)
    expect(projectSettings([{ source: 'local', value: settings }]).carry).toEqual(none)
    expect(projectSettings([]).carry).toEqual(none)
  })

  test('enabled is the folded true enabledPlugins keys of the three sources, a later source winning', () => {
    const out = projectSettings([
      { source: 'user', value: { enabledPlugins: { 'a@m': true, 'b@m': false, 'c@m': true, 'd@m': 'yes' } } },
      { source: 'project', value: { enabledPlugins: { 'b@m': true } } },
      { source: 'local', value: { enabledPlugins: { 'a@m': false } } },
    ])
    expect(out.enabled).toEqual(['b@m', 'c@m'])
  })

  test('plugin keys compare exactly, so two keys that differ only in case are both kept', async () => {
    const scan = await scanOf(settingsWorld({ enabledPlugins: { 'foo@m': true, 'Foo@m': true } }))
    expect(scan.plugins).toEqual(['Foo@m', 'foo@m'])
  })

  test('the plugins of a scan are the enabled plugin keys of all three sources', async () => {
    const scan = await scanOf(
      settingsWorld(
        { enabledPlugins: { 'z@m': true } },
        { enabledPlugins: { 'a@m': true } },
        { enabledPlugins: { 'z@m': false, 'k@m': true } },
      ),
    )
    expect(scan.plugins).toEqual(['a@m', 'k@m'])
  })

  test('projectHooks keeps every script basename ending .js, .cjs, .mjs, .sh, .py or .ts', () => {
    const scripts = ['a.js', 'b.cjs', 'c.mjs', 'd.sh', 'e.py', 'f.ts']
    const found = projectHooks(hookSettings(scripts.join(' ')), 'project')
    expect(found).toEqual(scripts.map(script => ({ script, event: 'PreToolUse', source: 'project' })))
  })

  test('projectHooks discards the interpreter, the path and the arguments around a script', () => {
    const command = 'SECRET=SENTINEL_SECRET_VALUE node /home/u/.claude/hooks/x.js --token sk-FAKE-SECRET-0123456789'
    const found = projectHooks(hookSettings(command), 'user')
    expect(found).toEqual([{ script: 'x.js', event: 'PreToolUse', source: 'user' }])
    expect(leaks(JSON.stringify(found), SECRETS)).toEqual([])
  })

  test('projectHooks takes no other extension and no name that runs on past the extension', () => {
    const found = projectHooks(hookSettings('run.json notes.md x.js.bak a.jsx lib.tsx v1.2.3 .hidden'), 'user')
    expect(found).toEqual([])
  })

  test('projectHooks takes a basename of 80 characters before the extension and not one of 81', () => {
    expect(projectHooks(hookSettings(`${'a'.repeat(80)}.js`), 'user').map(hook => hook.script)).toEqual([
      `${'a'.repeat(80)}.js`,
    ])
    expect(projectHooks(hookSettings(`${'a'.repeat(81)}.js`), 'user')).toEqual([])
  })

  test('projectHooks lists a script once per event and again for another event', () => {
    const value = {
      hooks: {
        PreToolUse: [{ hooks: [{ command: 'a.sh' }, { command: 'node a.sh' }] }],
        PostToolUse: [{ hooks: [{ command: 'a.sh' }] }],
      },
    }
    expect(projectHooks(value, 'project')).toEqual([
      { script: 'a.sh', event: 'PreToolUse', source: 'project' },
      { script: 'a.sh', event: 'PostToolUse', source: 'project' },
    ])
  })

  test('projectHooks cleans an event name and skips one that cleans to nothing', () => {
    const value = {
      hooks: {
        'Pre\u0007Tool': [{ hooks: [{ command: 'a.sh' }] }],
        '\u0007': [{ hooks: [{ command: 'b.sh' }] }],
      },
    }
    expect(projectHooks(value, 'user')).toEqual([{ script: 'a.sh', event: 'PreTool', source: 'user' }])
  })

  test('projectHooks ignores a hooks block of the wrong shape without throwing', () => {
    const malformed: readonly unknown[] = [
      null,
      'x',
      5,
      [],
      {},
      { hooks: 'x' },
      { hooks: { Pre: 'x' } },
      { hooks: { Pre: [null, 5, { hooks: 'x' }, { hooks: [null, { command: 5 }] }] } },
    ]
    expect(malformed.flatMap(value => projectHooks(value, 'user'))).toEqual([])
  })

  test('a scan lists the hook basenames of the project and local sources too, with their source', async () => {
    const scan = await scanOf(settingsWorld({}, hookSettings('p.sh'), hookSettings('l.py')))
    expect(scan.hooks).toEqual([
      { script: 'p.sh', event: 'PreToolUse', source: 'project' },
      { script: 'l.py', event: 'PreToolUse', source: 'local' },
    ])
  })

  test('with every source empty the scan has empty lists, no carry and no warnings', async () => {
    const scan = await scanOf(memWorld({}))
    expect(scan).toEqual({
      plugins: [],
      skills: [],
      mcp: [],
      agents: [],
      claudeMd: [],
      hasGlobalClaudeMd: false,
      memoryFiles: [],
      settingsKeys: [
        { source: 'user', keys: [] },
        { source: 'project', keys: [] },
        { source: 'local', keys: [] },
      ],
      hooks: [],
      carry: { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] },
      warnings: [],
    })
  })

  test('an unreadable settings source adds a warning and has no entry, the others are still scanned', async () => {
    const scan = await scanOf(memWorld({ settings: { user: { autoCompactWindow: 9 }, local: {} } }))
    expect(scan.warnings).toEqual(['could not read project settings (treated as unknown)'])
    expect(scan.settingsKeys.map(entry => entry.source)).toEqual(['user', 'local'])
    expect(scan.carry.autoCompactWindow).toBe(9)
  })

  test('with no source readable every one is named in a warning, in order, and nothing is invented', async () => {
    const scan = await scanOf(memWorld({ settings: {} }))
    expect(scan.warnings).toEqual([
      'could not read user settings (treated as unknown)',
      'could not read project settings (treated as unknown)',
      'could not read local settings (treated as unknown)',
    ])
    expect(scan.settingsKeys).toEqual([])
    expect(scan.carry.autoCompactWindow).toBeNull()
  })

  test('a settings value that is not an object is as unreadable as a missing one', async () => {
    const sources: readonly SettingsSource[] = ['user', 'project', 'local']
    for (const value of ['text', 5, ['a'], true]) {
      const scan = await scanOf(settingsWorld({}, value, {}))
      expect(scan.warnings).toEqual(['could not read project settings (treated as unknown)'])
      expect(scan.settingsKeys.map(entry => entry.source)).toEqual(sources.filter(source => source !== 'project'))
    }
  })

  test('a settings key with hidden characters is dropped and named once in a warning', async () => {
    const scan = await scanOf(settingsWorld({ 'bad\u202Ekey': 1, good: 2 }))
    expect(scan.settingsKeys[0]).toEqual({ source: 'user', keys: ['good'] })
    expect(scan.warnings).toEqual(['ignored settings key "badkey": its name has hidden characters or is too long'])
  })

  test('a settings key of 120 characters is kept and one of 121 is dropped with a warning', async () => {
    const scan = await scanOf(settingsWorld({ [`k${'x'.repeat(119)}`]: 1, [`k${'x'.repeat(120)}`]: 2 }))
    expect(scan.settingsKeys[0]).toEqual({ source: 'user', keys: [`k${'x'.repeat(119)}`] })
    expect(scan.warnings).toHaveLength(1)
    expect(scan.warnings[0]).toContain('ignored settings key "')
  })

  test('the cap counts code points, so 120 astral characters are kept and 121 are dropped', async () => {
    const kept = '\u{1F600}'.repeat(120)
    const scan = await scanOf(settingsWorld({ [kept]: 1, [`${kept}\u{1F600}`]: 2 }))
    expect(scan.settingsKeys[0]).toEqual({ source: 'user', keys: [kept] })
    expect(scan.warnings).toHaveLength(1)
  })

  test('an enabledPlugins key with a hidden character is dropped from plugins and named in a warning', async () => {
    const scan = await scanOf(settingsWorld({ enabledPlugins: { 'a\u200B@m': true, 'b@m': true } }))
    expect(scan.plugins).toEqual(['b@m'])
    expect(scan.warnings).toEqual(['ignored enabledPlugins key "a@m": its name has hidden characters or is too long'])
  })
})
