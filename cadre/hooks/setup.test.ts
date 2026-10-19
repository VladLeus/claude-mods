import { describe, expect, test } from 'claude-code/testing'

import type { SettingsSource, SetupScan } from '../types'
import { MAX_READ_BYTES } from './facts'
import {
  CLAUDE_JSON_MAX_BYTES,
  mangledProjectDir,
  projectAncestors,
  projectClaudeJson,
  projectCommands,
  projectHooks,
  projectMcpJson,
  projectSettings,
  projectToolServers,
  scanSetup,
} from './setup'
import type { SetupContext } from './setup'
import {
  ABSOLUTE_PATH_MARKERS,
  BIDI_OVERRIDE,
  entry,
  leaks,
  memIo,
  memWorld,
  SECRET_FIXTURES,
  secretUserSettings,
  secretWorld,
} from './testkit'
import type { MemWorld } from './testkit'

/** The session of the fixtures: the repo /repo of a user whose home is /home/u, with no CLAUDE_CONFIG_DIR. */
const CTX: SetupContext = { root: '/repo', givenRoot: '/repo', home: '/home/u', configDir: null }

/** The secret fixtures and the fixture home: nothing of these may survive into a scan. */
const SECRETS: readonly string[] = [...SECRET_FIXTURES, '/home/u']

/** A world whose three settings sources are the given ones. */
function settingsWorld(user: unknown, project: unknown = {}, local: unknown = {}): MemWorld {
  return memWorld({ settings: { user, project, local } })
}

/** A scan and the paths it read through the port, in order. */
type ScanRun = {
  readonly scan: SetupScan
  readonly reads: readonly string[]
}

/** A scan of `world` as the person at `ctx` gets it, with the paths it read. */
async function runOf(world: MemWorld, isClaudeJsonAllowed = false, ctx: SetupContext = CTX): Promise<ScanRun> {
  const run = memIo(world, [])
  const scan = await scanSetup(run.io, ctx, isClaudeJsonAllowed)

  return { scan, reads: run.reads }
}

/** A scan of `world` as the person at `ctx` gets it. */
async function scanOf(world: MemWorld, isClaudeJsonAllowed = false, ctx: SetupContext = CTX): Promise<SetupScan> {
  return (await runOf(world, isClaudeJsonAllowed, ctx)).scan
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

  test('projectHooks takes a basename of 80 characters, the role.json cap, and not one of 81', () => {
    expect(projectHooks(hookSettings(`${'a'.repeat(77)}.js`), 'user').map(hook => hook.script)).toEqual([
      `${'a'.repeat(77)}.js`,
    ])
    expect(projectHooks(hookSettings(`${'a'.repeat(78)}.js`), 'user')).toEqual([])
    expect(projectHooks(hookSettings(`${'a'.repeat(81)}.js`), 'user')).toEqual([])
  })

  test('a hook script name over the role.json cap is dropped with a warning that names its source only', async () => {
    const long = `${'a'.repeat(78)}.js`
    const scan = await scanOf(settingsWorld(hookSettings(`node ${long}`), hookSettings(`${long} && ok.sh`)))
    expect(scan.hooks).toEqual([{ script: 'ok.sh', event: 'PreToolUse', source: 'project' }])
    expect(scan.warnings).toEqual([
      'ignored 1 hook script name from the user settings that a role.json cannot hold',
      'ignored 1 hook script name from the project settings that a role.json cannot hold',
    ])
    expect(scan.warnings.join('\n')).not.toContain(long)
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

  test('projectHooks caps an event name at 60 characters and ends a cut name with an ellipsis', () => {
    const value = { hooks: { [`${'e'.repeat(70)}`]: [{ hooks: [{ command: 'a.sh' }] }] } }
    expect(projectHooks(value, 'user')[0]?.event).toBe(`${'e'.repeat(59)}\u2026`)
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
      // Without consent ~/.claude.json is not read, so the scan cannot have seen every MCP server (A4).
      isMcpPartial: true,
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

/** installed_plugins.json: a user plugin, one for this repo, one for another repo and one with no usable version. */
const INSTALLED_PLUGINS = JSON.stringify({
  version: 2,
  plugins: {
    'a@m': [{ scope: 'user', installPath: '/home/u/p/a', version: '1.0.0' }],
    'b@m': [{ scope: 'project', projectPath: '/repo', installPath: '/home/u/p/b', version: '2.0.0' }],
    'c@m': [{ scope: 'project', projectPath: '/other', installPath: '/home/u/p/c', version: '3.0.0' }],
    'd@m': [{ scope: 'user', installPath: '/home/u/p/d', version: 'not-a-version' }],
  },
})

/** A .mcp.json whose server entries hold a token and an authorization header. */
const MCP_JSON = JSON.stringify({
  mcpServers: {
    github: { command: 'npx', env: { GITHUB_TOKEN: 'ghp_FAKEFAKEFAKEFAKEFAKE' } },
    jira: { url: 'https://jira.example', headers: { Authorization: 'Bearer FAKE-TOKEN-0123' } },
  },
})

const INSTALLED_PATH = '/home/u/.claude/plugins/installed_plugins.json'
const MCP_JSON_PATH = '/repo/.mcp.json'
const USER_AGENTS = '/home/u/.claude/agents'
const REPO_AGENTS = '/repo/.claude/agents'

/** The tool entries of a session that has the jira and slack servers and the built-in Read tool. */
const SESSION_TOOLS: readonly unknown[] = [
  { name: 'mcp__jira__search', description: 'sk-FAKE-SECRET-0123456789', mcp: true },
  { name: 'mcp__slack__post', description: 'x', mcp: true },
  { name: 'Read', description: 'x', mcp: false },
]

describe('setup sources', () => {
  test('projectCommands keeps the user and plugin commands with their plugin, and drops builtin and mcp ones', () => {
    const found = projectCommands([
      { name: 'gsd-plan-phase', source: 'user', description: 'x' },
      { name: 'superpowers:brainstorming', source: 'plugin', plugin: 'superpowers', description: 'y' },
      { name: 'help', source: 'builtin', description: 'z' },
      { name: 'mcp__x__y', source: 'mcp', description: '' },
    ])
    expect(found).toEqual([
      { name: 'gsd-plan-phase', plugin: null },
      { name: 'superpowers:brainstorming', plugin: 'superpowers' },
    ])
  })

  test('projectCommands keeps a command of any source but builtin and mcp, and drops one with no source', () => {
    const found = projectCommands([
      { name: 'from-project', source: 'project' },
      { name: 'no-source' },
      { name: 'numeric-source', source: 5 },
      { name: 'builtin-one', source: 'builtin' },
      { name: 'mcp-one', source: 'mcp' },
    ])
    expect(found).toEqual([{ name: 'from-project', plugin: null }])
  })

  test('projectCommands sorts by name and lists a name once for each plugin that adds it', () => {
    const found = projectCommands([
      { name: 'b', source: 'user' },
      { name: 'a', source: 'plugin', plugin: 'p2' },
      { name: 'a', source: 'plugin', plugin: 'p1' },
      { name: 'a', source: 'plugin', plugin: 'p1' },
      { name: 'a', source: 'user' },
    ])
    expect(found).toEqual([
      { name: 'a', plugin: null },
      { name: 'a', plugin: 'p1' },
      { name: 'a', plugin: 'p2' },
      { name: 'b', plugin: null },
    ])
  })

  test('projectCommands never keeps a description or any other field of a command', () => {
    const found = projectCommands([
      { name: 'one', source: 'user', description: 'Bearer FAKE-TOKEN-0123', argumentHint: 'sk-FAKE-SECRET-0123456789' },
    ])
    expect(found).toEqual([{ name: 'one', plugin: null }])
    expect(leaks(JSON.stringify(found), SECRETS)).toEqual([])
  })

  test('projectCommands drops a name or a plugin outside the name pattern', () => {
    const bad = ['', ' lead', 'has space', 'a/b', '-dash', ':colon', 'emoji\u{1F600}', 'bell\u0007', 'x'.repeat(101)]
    const found = projectCommands([
      ...bad.map(name => ({ name, source: 'user' })),
      { name: 'ok-plugin-space', source: 'plugin', plugin: 'bad plugin' },
      { name: 'ok-plugin-number', source: 'plugin', plugin: 5 },
      { name: 5, source: 'user' },
      { source: 'user' },
      { name: 'ok.name_1@x-y:z', source: 'user' },
      { name: '1digit', source: 'plugin' },
    ])
    expect(found).toEqual([
      { name: '1digit', plugin: null },
      { name: 'ok.name_1@x-y:z', plugin: null },
    ])
  })

  test('projectCommands keeps a name of 100 characters and drops one of 101', () => {
    const found = projectCommands([
      { name: 'n'.repeat(100), source: 'user' },
      { name: 'n'.repeat(101), source: 'user' },
    ])
    expect(found).toEqual([{ name: 'n'.repeat(100), plugin: null }])
  })

  test('projectCommands of null, or of a value that is not a list, is empty', () => {
    const values: readonly unknown[] = [null, undefined, 'text', 5, {}, { name: 'a', source: 'user' }]
    expect(values.flatMap(value => projectCommands(value))).toEqual([])
    expect(projectCommands([null, 'x', 5, []])).toEqual([])
  })

  test('a scan whose command list cannot be read warns once and still scans the other sources', async () => {
    for (const commands of [null, {}, 'text']) {
      const scan = await scanOf(memWorld({ commands, tools: SESSION_TOOLS }))
      expect(scan.warnings).toEqual(['could not list commands and skills (treated as unknown)'])
      expect(scan.skills).toEqual([])
      expect(scan.mcp.map(server => server.name)).toEqual(['jira', 'slack'])
    }
  })

  test('a command name with a hidden character is dropped and named in a warning', async () => {
    const commands = [
      { name: 'ok', source: 'user', description: '' },
      { name: 'bad\u0007name', source: 'user', description: '' },
    ]
    const scan = await scanOf(memWorld({ commands }))
    expect(scan.skills).toEqual([{ name: 'ok', plugin: null }])
    expect(scan.warnings).toEqual([
      'ignored command or plugin name "badname": its name has hidden characters or is too long',
    ])
  })

  test('projectToolServers gives each mcp server of the tool names once, sorted, as a session server', () => {
    const found = projectToolServers([
      { name: 'mcp__jira__search' },
      { name: 'mcp__jira__get' },
      { name: 'Read' },
      { name: 'mcp__plugin_context7_context7__query-docs' },
    ])
    expect(found).toEqual([
      { name: 'jira', source: 'session' },
      { name: 'plugin_context7_context7', source: 'session' },
    ])
  })

  test('projectToolServers ignores a name that is not mcp__<server>__<tool>, and a value that is not a list', () => {
    const names = ['mcp__x', 'mcp____tool', 'mcp__a__', 'MCP__x__y', 'xmcp__x__y', 'Read', '']
    expect(projectToolServers(names.map(name => ({ name })))).toEqual([])
    expect(projectToolServers([null, 5, 'mcp__x__y', { name: 5 }, {}])).toEqual([])
    expect([null, {}, 'text', 5].flatMap(value => projectToolServers(value))).toEqual([])
  })

  test('a scan whose tool list cannot be read warns and still scans the other sources', async () => {
    const scan = await scanOf(memWorld({ tools: null, files: { [MCP_JSON_PATH]: MCP_JSON } }))
    expect(scan.warnings).toEqual(['could not list session tools (treated as unknown)'])
    expect(scan.mcp.map(server => server.name)).toEqual(['github', 'jira'])
  })

  test('projectMcpJson keeps the names of the mcpServers keys and nothing of their entries', () => {
    const found = projectMcpJson({ mcpServers: { github: { command: 'x', env: { T: 'sk-FAKE-SECRET-0123456789' } } } })
    expect(found).toEqual([{ name: 'github', source: 'project' }])
    expect(leaks(JSON.stringify(found), SECRETS)).toEqual([])
  })

  test('an MCP server name outside the role.json name rule is dropped from every projection', () => {
    const servers = { ok: {}, 'has space': {}, 'a/b': {}, '-dash': {} }
    expect(projectMcpJson({ mcpServers: servers })).toEqual([{ name: 'ok', source: 'project' }])
    expect(projectToolServers([{ name: 'mcp__has space__x' }, { name: 'mcp__ok__x' }])).toEqual([
      { name: 'ok', source: 'session' },
    ])
    expect(projectClaudeJson({ mcpServers: servers }, ['/repo'])).toEqual([{ name: 'ok', source: 'user-config' }])
  })

  test('a scan warns once per source for the MCP server names it drops, and never shows a name', async () => {
    const world = memWorld({
      files: {
        [MCP_JSON_PATH]: JSON.stringify({ mcpServers: { ok: {}, 'has space': {}, 'a/b': {} } }),
        [CLAUDE_JSON_PATH]: JSON.stringify({ mcpServers: { 'x y': {} } }),
      },
      tools: [{ name: 'mcp__bad server__x' }, { name: 'mcp__jira__x' }],
    })
    const scan = await scanOf(world, true)
    expect(scan.mcp.map(server => server.name)).toEqual(['jira', 'ok'])
    expect(scan.warnings).toEqual([
      'ignored 2 MCP server names from <repo>/.mcp.json that a role.json cannot hold',
      'ignored 1 MCP server name from the session tools that a role.json cannot hold',
      'ignored 1 MCP server name from ~/.claude.json that a role.json cannot hold',
    ])
    expect(leaks(scan.warnings.join('\n'), ['has space', 'a/b', 'x y', 'bad server'])).toEqual([])
  })

  test('a .mcp.json whose stat fails is unknown with a warning, never quietly absent', async () => {
    const scan = await scanOf(memWorld({ unknownPaths: [MCP_JSON_PATH] }))
    expect(scan.mcp).toEqual([])
    expect(scan.warnings).toEqual(['could not read <repo>/.mcp.json (treated as unknown)'])
  })

  test('projectMcpJson of a value without an mcpServers object is empty', () => {
    const values: readonly unknown[] = [
      null,
      'text',
      5,
      [],
      {},
      { mcpServers: null },
      { mcpServers: ['a'] },
      { mcpServers: 'a' },
    ]
    expect(values.flatMap(value => projectMcpJson(value))).toEqual([])
  })

  test('the .mcp.json of the repo gives project servers, and no value of it reaches the scan', async () => {
    const { scan, reads } = await runOf(memWorld({ files: { [MCP_JSON_PATH]: MCP_JSON } }))
    expect(scan.mcp).toEqual([
      { name: 'github', source: 'project' },
      { name: 'jira', source: 'project' },
    ])
    expect(reads).toContain(MCP_JSON_PATH)
    expect(leaks(JSON.stringify(scan), SECRETS)).toEqual([])
  })

  test('a .mcp.json that links out of the repo is not read, and the scan says so', async () => {
    const world = memWorld({
      files: { [MCP_JSON_PATH]: MCP_JSON },
      realPaths: { [MCP_JSON_PATH]: '/elsewhere/.mcp.json' },
    })
    const { scan, reads } = await runOf(world)
    expect(reads).not.toContain(MCP_JSON_PATH)
    expect(scan.mcp).toEqual([])
    expect(scan.warnings).toEqual(['could not read <repo>/.mcp.json (treated as unknown)'])
  })

  test('a .mcp.json that is a folder is not read, and the scan says so', async () => {
    const { scan, reads } = await runOf(memWorld({ dirs: { [MCP_JSON_PATH]: [] } }))
    expect(reads).not.toContain(MCP_JSON_PATH)
    expect(scan.warnings).toEqual(['could not read <repo>/.mcp.json (treated as unknown)'])
  })

  test('a missing .mcp.json is quiet, and a broken or oversized one warns without keeping a server', async () => {
    const missing = await runOf(memWorld({}))
    expect(missing.scan.mcp).toEqual([])
    expect(missing.scan.warnings).toEqual([])
    for (const text of ['{ not json', ' '.repeat(MAX_READ_BYTES + 1)]) {
      const scan = await scanOf(memWorld({ files: { [MCP_JSON_PATH]: text } }))
      expect(scan.warnings).toEqual(['could not read <repo>/.mcp.json (treated as unknown)'])
      expect(scan.mcp).toEqual([])
    }
  })

  test('the plugins are the enabled keys and the installed keys for the user or this repo, sorted', async () => {
    const world = memWorld({
      settings: { user: { enabledPlugins: { 'z@m': true, 'a@m': true } }, project: {}, local: {} },
      files: { [INSTALLED_PATH]: INSTALLED_PLUGINS },
    })
    const { scan, reads } = await runOf(world)
    expect(scan.plugins).toEqual(['a@m', 'b@m', 'z@m'])
    expect(reads).toContain(INSTALLED_PATH)
    expect(leaks(JSON.stringify(scan), SECRETS)).toEqual([])
  })

  test('an installed plugin entry for the root as given counts, as one for the root as resolved does', async () => {
    const installed = JSON.stringify({
      plugins: {
        'g@m': [{ scope: 'project', projectPath: '/link/repo/', version: '1.0.0' }],
        'r@m': [{ scope: 'local', projectPath: '/real/repo', version: '1.0.0' }],
        'o@m': [{ scope: 'project', projectPath: '/link/other', version: '1.0.0' }],
      },
    })
    const ctx: SetupContext = { root: '/real/repo', givenRoot: '/link/repo', home: '/home/u', configDir: null }
    const scan = await scanOf(memWorld({ files: { [INSTALLED_PATH]: installed } }), false, ctx)
    expect(scan.plugins).toEqual(['g@m', 'r@m'])
  })

  test('a missing installed_plugins file is quiet, and an unreadable, oversized or broken one warns', async () => {
    const warning = ['could not read ~/.claude/plugins/installed_plugins.json (treated as unknown)']
    expect((await scanOf(memWorld({}))).warnings).toEqual([])
    expect((await scanOf(memWorld({ unknownPaths: [INSTALLED_PATH] }))).warnings).toEqual(warning)
    for (const text of ['{ not json', ' '.repeat(MAX_READ_BYTES + 1)]) {
      expect((await scanOf(memWorld({ files: { [INSTALLED_PATH]: text } }))).warnings).toEqual(warning)
    }
  })

  test('an installed plugin key with a hidden character is dropped and named in a warning', async () => {
    const installed = JSON.stringify({
      plugins: { 'ok@m': [{ scope: 'user', version: '1.0.0' }], 'bad\u0007@m': [{ scope: 'user', version: '1.0.0' }] },
    })
    const scan = await scanOf(memWorld({ files: { [INSTALLED_PATH]: installed } }))
    expect(scan.plugins).toEqual(['ok@m'])
    expect(scan.warnings).toEqual([
      'ignored installed plugin key "bad@m": its name has hidden characters or is too long',
    ])
  })

  test('CLAUDE_CONFIG_DIR is the user folder when it is set, and the home folder is then not read', async () => {
    const ctx: SetupContext = { ...CTX, configDir: '/cfg' }
    const world = memWorld({
      files: { '/cfg/plugins/installed_plugins.json': INSTALLED_PLUGINS, [INSTALLED_PATH]: '{}' },
      dirs: { '/cfg/agents': [entry('cfg-agent.md')], [USER_AGENTS]: [entry('home-agent.md')] },
    })
    const { scan, reads } = await runOf(world, false, ctx)
    expect(scan.plugins).toEqual(['a@m', 'b@m'])
    expect(scan.agents).toEqual(['cfg-agent'])
    expect(reads).not.toContain(INSTALLED_PATH)
  })

  test('a user folder that cannot be read is named in display form under CLAUDE_CONFIG_DIR', async () => {
    const ctx: SetupContext = { ...CTX, configDir: '/cfg' }
    const world = memWorld({ unknownPaths: ['/cfg/plugins/installed_plugins.json'] })
    const scan = await scanOf(world, false, ctx)
    expect(scan.warnings).toEqual([
      'could not read $CLAUDE_CONFIG_DIR/plugins/installed_plugins.json (treated as unknown)',
    ])
  })

  test('with no home and no CLAUDE_CONFIG_DIR the user-level sources are skipped with one warning', async () => {
    const ctx: SetupContext = { root: '/repo', givenRoot: '/repo', home: null, configDir: null }
    const world = memWorld({
      files: { [INSTALLED_PATH]: INSTALLED_PLUGINS },
      dirs: { [USER_AGENTS]: [entry('home-agent.md')], [REPO_AGENTS]: [entry('repo-agent.md')] },
    })
    const { scan, reads } = await runOf(world, false, ctx)
    expect(scan.warnings).toEqual(['HOME is unset: user-level setup was not scanned'])
    expect(scan.plugins).toEqual([])
    expect(scan.agents).toEqual(['repo-agent'])
    expect(reads.filter(path => path.startsWith('/home/'))).toEqual([])
  })

  test('the agents are the .md files of the user and repo agents folders, by name, once and sorted', async () => {
    const world = memWorld({
      dirs: {
        [USER_AGENTS]: [
          entry('b.md'),
          entry('a.md'),
          entry('notes.txt'),
          entry('sub', 'dir'),
          entry('linked.md', 'other', true),
          entry('.md'),
        ],
        [REPO_AGENTS]: [entry('a.md'), entry('c.md'), entry('README.MD')],
      },
    })
    expect((await scanOf(world)).agents).toEqual(['a', 'b', 'c'])
  })

  test('an agents folder that cannot be listed warns, and one that is not there does not', async () => {
    const world = memWorld({ unknownPaths: [USER_AGENTS], dirs: { [REPO_AGENTS]: [entry('r.md')] } })
    const scan = await scanOf(world)
    expect(scan.warnings).toEqual(['could not read ~/.claude/agents (treated as unknown)'])
    expect(scan.agents).toEqual(['r'])
    expect((await scanOf(memWorld({ unknownPaths: [REPO_AGENTS] }))).warnings).toEqual([
      'could not read <repo>/.claude/agents (treated as unknown)',
    ])
    expect((await scanOf(memWorld({}))).warnings).toEqual([])
  })

  test('a repo agents folder that links out of the repo is never listed, and the scan says so', async () => {
    const run = memIo(
      memWorld({
        dirs: { [REPO_AGENTS]: [entry('evil.md')], '/elsewhere/agents': [entry('evil.md')] },
        realPaths: { [REPO_AGENTS]: '/elsewhere/agents' },
      }),
      [],
    )
    const scan = await scanSetup(run.io, CTX, false)
    expect(run.listed).not.toContain(REPO_AGENTS)
    expect(scan.agents).toEqual([])
    expect(scan.warnings).toEqual(['could not read <repo>/.claude/agents (treated as unknown)'])
  })

  test('a repo agents folder that links to a folder inside the repo is listed', async () => {
    const world = memWorld({
      dirs: { [REPO_AGENTS]: [entry('lead.md')] },
      realPaths: { [REPO_AGENTS]: '/repo/shared/agents' },
    })
    const scan = await scanOf(world)
    expect(scan.agents).toEqual(['lead'])
    expect(scan.warnings).toEqual([])
  })

  test('an agent name with a hidden character is dropped and named in a warning', async () => {
    const scan = await scanOf(memWorld({ dirs: { [REPO_AGENTS]: [entry('ok.md'), entry('bad\u0007name.md')] } }))
    expect(scan.agents).toEqual(['ok'])
    expect(scan.warnings).toEqual(['ignored agent name "badname": its name has hidden characters or is too long'])
  })

  test('an agent name of 100 characters is kept and one of 101 is dropped', async () => {
    const dirs = { [REPO_AGENTS]: [entry(`${'n'.repeat(100)}.md`), entry(`${'n'.repeat(101)}.md`)] }
    const scan = await scanOf(memWorld({ dirs }))
    expect(scan.agents).toEqual(['n'.repeat(100)])
    expect(scan.warnings).toHaveLength(1)
  })

  test('an MCP server seen in two sources is listed once, under the first of project and session', async () => {
    const world = memWorld({ files: { [MCP_JSON_PATH]: MCP_JSON }, tools: SESSION_TOOLS })
    const scan = await scanOf(world)
    expect(scan.mcp).toEqual([
      { name: 'github', source: 'project' },
      { name: 'jira', source: 'project' },
      { name: 'slack', source: 'session' },
    ])
  })

  test('MCP server names compare exactly, so two names that differ only in case are both listed', async () => {
    const tools = [{ name: 'mcp__Jira__a' }, { name: 'mcp__jira__a' }]
    const scan = await scanOf(memWorld({ tools }))
    expect(scan.mcp.map(server => server.name)).toEqual(['Jira', 'jira'])
  })

  test('the full source world names every plugin, skill, MCP server and agent, and keeps no secret', async () => {
    const user = { ...secretUserSettings(), enabledPlugins: { 'z@m': true } }
    const world = memWorld({
      settings: { user, project: {}, local: {} },
      files: { [INSTALLED_PATH]: INSTALLED_PLUGINS, [MCP_JSON_PATH]: MCP_JSON },
      dirs: { [USER_AGENTS]: [entry('b.md'), entry('a.md')], [REPO_AGENTS]: [entry('c.md')] },
      commands: [
        { name: 'gsd-plan-phase', source: 'user', description: 'Bearer FAKE-TOKEN-0123' },
        { name: 'superpowers:brainstorming', source: 'plugin', plugin: 'superpowers', description: 'x' },
        { name: 'help', source: 'builtin', description: 'x' },
      ],
      tools: SESSION_TOOLS,
    })
    const scan = await scanOf(world)
    expect(scan.plugins).toEqual(['a@m', 'b@m', 'z@m'])
    expect(scan.skills).toEqual([
      { name: 'gsd-plan-phase', plugin: null },
      { name: 'superpowers:brainstorming', plugin: 'superpowers' },
    ])
    expect(scan.mcp.map(server => server.name)).toEqual(['github', 'jira', 'slack'])
    expect(scan.agents).toEqual(['a', 'b', 'c'])
    expect(scan.warnings).toEqual([])
    const json = JSON.stringify(scan)
    expect(leaks(json, SECRETS)).toEqual([])
    expect(leaks(json, ABSOLUTE_PATH_MARKERS)).toEqual([])
  })
})

const CLAUDE_JSON_PATH = '/home/u/.claude.json'
const MEMORY_DIR = '/home/u/.claude/projects/-repo/memory'

/** A ~/.claude.json whose entries hold secrets and an account block, with servers for this repo and for another one. */
const CLAUDE_JSON = JSON.stringify({
  mcpServers: {
    jira: { type: 'stdio', command: 'x', args: [], env: { JIRA_TOKEN: 'sk-FAKE-SECRET-0123456789' } },
  },
  oauthAccount: { emailAddress: 'someone@example.com', accountUuid: 'SENTINEL_SECRET_VALUE' },
  projects: {
    '/repo': {
      mcpServers: { linear: { env: { T: 'Bearer FAKE-TOKEN-0123' } } },
      history: [{ display: 'ghp_FAKEFAKEFAKEFAKEFAKE' }],
    },
    '/other': { mcpServers: { secret: {} } },
  },
})

/** A ~/.claude.json text of exactly `bytes` ASCII bytes that names the server `jira`. */
function claudeJsonOfSize(bytes: number): string {
  const base = JSON.stringify({ mcpServers: { jira: {} }, pad: '' })

  return JSON.stringify({ mcpServers: { jira: {} }, pad: 'x'.repeat(bytes - base.length) })
}

/** The CLAUDE.md files the host lists for a session in /repo under /home/u/work, with secret content in each. */
const CHAIN: readonly unknown[] = [
  { dir: '/', name: 'CLAUDE.md', content: 'SENTINEL_SECRET_VALUE', parts: [] },
  { dir: '/home/u/work', name: 'CLAUDE.md', content: 'Bearer FAKE-TOKEN-0123', parts: [] },
  { dir: '/repo', name: 'CLAUDE.md', content: 'sk-FAKE-SECRET-0123456789', parts: [] },
  { dir: '/repo', name: '.claude/CLAUDE.md', content: 'x', parts: [] },
  { dir: '/repo', name: 'AGENTS.md', content: 'ghp_FAKEFAKEFAKEFAKEFAKE', parts: [] },
]

describe('setup consent and instructions', () => {
  test('CLAUDE_JSON_MAX_BYTES is the 4 MiB host cap, far above the 256 KiB cap of the detect files', () => {
    expect(CLAUDE_JSON_MAX_BYTES).toBe(4 * 1024 * 1024)
    expect(CLAUDE_JSON_MAX_BYTES > MAX_READ_BYTES).toBe(true)
  })

  test('projectClaudeJson keeps the mcpServers names of the file and of this repo, and nothing else', () => {
    const value = {
      mcpServers: { jira: { env: { T: 'sk-FAKE-SECRET-0123456789' } } },
      oauthAccount: { emailAddress: 'a@b.c' },
      projects: { '/repo': { mcpServers: { linear: {} } }, '/other': { mcpServers: { secret: {} } } },
    }
    const found = projectClaudeJson(value, ['/repo', '/repo'])
    expect(found).toEqual([
      { name: 'jira', source: 'user-config' },
      { name: 'linear', source: 'user-config' },
    ])
    expect(leaks(JSON.stringify(found), [...SECRETS, 'a@b.c'])).toEqual([])
  })

  test('projectClaudeJson matches the project by the root as given or as resolved, ignoring trailing slashes', () => {
    const value = {
      projects: {
        '/link/repo/': { mcpServers: { given: {} } },
        '/real/repo': { mcpServers: { resolved: {} } },
        '/other': { mcpServers: { other: {} } },
        '': { mcpServers: { empty: {} } },
        '/': { mcpServers: { top: {} } },
      },
    }
    const found = projectClaudeJson(value, ['/link/repo', '/real/repo/'])
    expect(found.map(server => server.name)).toEqual(['given', 'resolved'])
    expect(projectClaudeJson(value, ['', '/'])).toEqual([])
    expect(projectClaudeJson(value, [])).toEqual([])
  })

  test('projectClaudeJson of a value of the wrong shape is empty', () => {
    const values: readonly unknown[] = [
      null,
      'text',
      5,
      [],
      {},
      { mcpServers: 5 },
      { projects: 'text' },
      { projects: { '/repo': 'text' } },
      { projects: { '/repo': { mcpServers: ['a'] } } },
    ]
    expect(values.flatMap(value => projectClaudeJson(value, ['/repo']))).toEqual([])
  })

  test('projectClaudeJson drops a server name that clean would change', () => {
    const value = {
      mcpServers: { ok: {}, 'bad\u0007': {} },
      projects: { '/repo': { mcpServers: { 'worse\u0007': {} } } },
    }
    expect(projectClaudeJson(value, ['/repo'])).toEqual([{ name: 'ok', source: 'user-config' }])
  })

  test('without consent the file is neither read nor missed, even when it cannot be read', async () => {
    const found = await runOf(memWorld({ files: { [CLAUDE_JSON_PATH]: CLAUDE_JSON } }), false)
    expect(found.reads).not.toContain(CLAUDE_JSON_PATH)
    expect(found.scan.mcp).toEqual([])
    const unreadable = await runOf(memWorld({ unknownPaths: [CLAUDE_JSON_PATH] }), false)
    expect(unreadable.reads).not.toContain(CLAUDE_JSON_PATH)
    expect(unreadable.scan.warnings).toEqual([])
  })

  test('with consent the file is read once and its server names join the scan as user-config', async () => {
    const { scan, reads } = await runOf(memWorld({ files: { [CLAUDE_JSON_PATH]: CLAUDE_JSON } }), true)
    expect(reads.filter(path => path === CLAUDE_JSON_PATH)).toEqual([CLAUDE_JSON_PATH])
    expect(scan.mcp).toEqual([
      { name: 'jira', source: 'user-config' },
      { name: 'linear', source: 'user-config' },
    ])
    const json = JSON.stringify(scan)
    expect(leaks(json, [...SECRETS, 'someone@example.com'])).toEqual([])
    expect(leaks(json, ABSOLUTE_PATH_MARKERS)).toEqual([])
  })

  test('the file is read with the 4 MiB cap: 300 KiB and exactly 4 MiB are read, one byte more is not', async () => {
    const sizes = [300 * 1024, CLAUDE_JSON_MAX_BYTES, CLAUDE_JSON_MAX_BYTES + 1]
    const found: (readonly string[])[][] = []
    for (const size of sizes) {
      const scan = await scanOf(memWorld({ files: { [CLAUDE_JSON_PATH]: claudeJsonOfSize(size) } }), true)
      found.push([scan.mcp.map(server => server.name), scan.warnings])
    }
    expect(found).toEqual([
      [['jira'], []],
      [['jira'], []],
      [[], ['could not read ~/.claude.json (treated as unknown)']],
    ])
  })

  test('a ~/.claude.json that cannot be read or parsed warns, and one that is not there is quiet', async () => {
    const warning = ['could not read ~/.claude.json (treated as unknown)']
    expect((await scanOf(memWorld({}), true)).warnings).toEqual([])
    expect((await scanOf(memWorld({ unknownPaths: [CLAUDE_JSON_PATH] }), true)).warnings).toEqual(warning)
    expect((await scanOf(memWorld({ files: { [CLAUDE_JSON_PATH]: '{ not json' } }), true)).warnings).toEqual(warning)
  })

  test('the file is looked for in CLAUDE_CONFIG_DIR when it is set, and then not in the home folder', async () => {
    const ctx: SetupContext = { ...CTX, configDir: '/cfg' }
    const world = memWorld({
      files: {
        '/cfg/.claude.json': JSON.stringify({ mcpServers: { cfgserver: {} } }),
        [CLAUDE_JSON_PATH]: JSON.stringify({ mcpServers: { decoy: {} } }),
      },
    })
    const { scan, reads } = await runOf(world, true, ctx)
    expect(scan.mcp).toEqual([{ name: 'cfgserver', source: 'user-config' }])
    expect(reads).not.toContain(CLAUDE_JSON_PATH)
    const unreadable = await scanOf(memWorld({ unknownPaths: ['/cfg/.claude.json'] }), true, ctx)
    expect(unreadable.warnings).toEqual(['could not read $CLAUDE_CONFIG_DIR/.claude.json (treated as unknown)'])
  })

  test('with consent but neither a home folder nor CLAUDE_CONFIG_DIR no config file is looked for', async () => {
    const ctx: SetupContext = { root: '/repo', givenRoot: '/repo', home: null, configDir: null }
    const { scan, reads } = await runOf(memWorld({ files: { [CLAUDE_JSON_PATH]: CLAUDE_JSON } }), true, ctx)
    expect(reads.filter(path => path.endsWith('.claude.json'))).toEqual([])
    expect(scan.warnings).toEqual(['HOME is unset: user-level setup was not scanned'])
  })

  test('a server name with a hidden character is dropped from every source and named in a warning', async () => {
    const world = memWorld({
      files: {
        [MCP_JSON_PATH]: JSON.stringify({ mcpServers: { 'bad\u0007json': {}, ok: {} } }),
        [CLAUDE_JSON_PATH]: JSON.stringify({ mcpServers: { 'bad\u0007cfg': {} } }),
      },
      tools: [{ name: 'mcp__bad\u0007tool__x' }],
    })
    const scan = await scanOf(world, true)
    expect(scan.mcp).toEqual([{ name: 'ok', source: 'project' }])
    expect(scan.warnings).toEqual([
      'ignored MCP server name "badjson": its name has hidden characters or is too long',
      'ignored MCP server name "badtool": its name has hidden characters or is too long',
      'ignored MCP server name "badcfg": its name has hidden characters or is too long',
    ])
  })

  test('a server in the project, session and user config is listed once, under project, then session', async () => {
    const world = memWorld({
      files: { [MCP_JSON_PATH]: MCP_JSON, [CLAUDE_JSON_PATH]: CLAUDE_JSON },
      tools: [{ name: 'mcp__linear__issues' }, { name: 'mcp__jira__search' }],
    })
    const scan = await scanOf(world, true)
    expect(scan.mcp).toEqual([
      { name: 'github', source: 'project' },
      { name: 'jira', source: 'project' },
      { name: 'linear', source: 'session' },
    ])
  })

  test('projectAncestors gives the display form of each CLAUDE.md in the order given, and no content', () => {
    const found = projectAncestors(
      [
        { dir: '/repo', name: 'CLAUDE.md', content: 'SENTINEL_SECRET_VALUE' },
        { dir: '/repo', name: '.claude/CLAUDE.md', content: 'x' },
        { dir: '/home/u/work', name: 'CLAUDE.md', content: 'y' },
        { dir: '/repo', name: 'AGENTS.md', content: 'z' },
      ],
      CTX,
    )
    expect(found).toEqual(['<repo>/CLAUDE.md', '<repo>/.claude/CLAUDE.md', '~/work/CLAUDE.md'])
    expect(leaks(JSON.stringify(found), SECRETS)).toEqual([])
  })

  test('projectAncestors shows a file at the file system root, and a folder of CLAUDE_CONFIG_DIR, as they are', () => {
    const entries = [
      { dir: '/', name: 'CLAUDE.md', content: '' },
      { dir: '/cfg', name: 'CLAUDE.md', content: '' },
      { dir: '/srv/team/', name: 'CLAUDE.md', content: '' },
    ]
    const found = projectAncestors(entries, { ...CTX, configDir: '/cfg' })
    expect(found).toEqual(['/CLAUDE.md', '$CLAUDE_CONFIG_DIR/CLAUDE.md', '/srv/team/CLAUDE.md'])
  })

  test('projectAncestors skips an entry without a dir or a name, and a value that is not a list', () => {
    const entries = [null, 'x', 5, {}, { dir: '/repo' }, { name: 'CLAUDE.md' }, { dir: 5, name: 'CLAUDE.md' }]
    expect(projectAncestors(entries, CTX)).toEqual([])
    expect([null, {}, 'text', 5].flatMap(value => projectAncestors(value, CTX))).toEqual([])
  })

  test('projectAncestors lists a file once', () => {
    const entry = { dir: '/repo', name: 'CLAUDE.md', content: 'x' }
    expect(projectAncestors([entry, entry], CTX)).toEqual(['<repo>/CLAUDE.md'])
  })

  test('the scan asks the host for the CLAUDE.md files of every folder and keeps their display forms', async () => {
    const base = memIo(memWorld({ ancestors: CHAIN }), [])
    const asked: (readonly string[])[] = []
    const io = {
      ...base.io,
      ancestors: async (names: readonly string[]) => {
        asked.push(names)

        return base.io.ancestors(names)
      },
    }
    const scan = await scanSetup(io, CTX, false)
    expect(asked).toEqual([['CLAUDE.md', '.claude/CLAUDE.md']])
    expect(scan.claudeMd).toEqual(['/CLAUDE.md', '~/work/CLAUDE.md', '<repo>/CLAUDE.md', '<repo>/.claude/CLAUDE.md'])
    expect(leaks(JSON.stringify(scan), [...SECRETS, ...ABSOLUTE_PATH_MARKERS])).toEqual([])
  })

  test('a CLAUDE.md chain the host cannot give adds a warning', async () => {
    for (const ancestors of [null, {}, 'text']) {
      const scan = await scanOf(memWorld({ ancestors }))
      expect(scan.warnings).toEqual(['could not read the CLAUDE.md chain (treated as unknown)'])
      expect(scan.claudeMd).toEqual([])
    }
  })

  test('hasGlobalClaudeMd is true for a CLAUDE.md file in the user folder, and its content is not read', async () => {
    const { scan, reads } = await runOf(memWorld({ files: { '/home/u/.claude/CLAUDE.md': 'SENTINEL_SECRET_VALUE' } }))
    expect(scan.hasGlobalClaudeMd).toBe(true)
    expect(reads).not.toContain('/home/u/.claude/CLAUDE.md')
    expect(leaks(JSON.stringify(scan), SECRETS)).toEqual([])
  })

  test('hasGlobalClaudeMd is false for a folder of that name and for a file that is not there', async () => {
    expect((await scanOf(memWorld({ dirs: { '/home/u/.claude/CLAUDE.md': [] } }))).hasGlobalClaudeMd).toBe(false)
    expect((await scanOf(memWorld({}))).hasGlobalClaudeMd).toBe(false)
  })

  test('a global CLAUDE.md whose stat fails is unknown with a warning, never quietly absent', async () => {
    const scan = await scanOf(memWorld({ unknownPaths: ['/home/u/.claude/CLAUDE.md'] }))
    expect(scan.hasGlobalClaudeMd).toBe(false)
    expect(scan.warnings).toEqual(['could not read ~/.claude/CLAUDE.md (treated as unknown)'])
  })

  test('hasGlobalClaudeMd looks in CLAUDE_CONFIG_DIR when it is set, and in no folder when there is none', async () => {
    const ctx: SetupContext = { ...CTX, configDir: '/cfg' }
    const home = memWorld({ files: { '/home/u/.claude/CLAUDE.md': 'x' } })
    expect((await scanOf(home, false, ctx)).hasGlobalClaudeMd).toBe(false)
    expect((await scanOf(memWorld({ files: { '/cfg/CLAUDE.md': 'x' } }), false, ctx)).hasGlobalClaudeMd).toBe(true)
    const none: SetupContext = { root: '/repo', givenRoot: '/repo', home: null, configDir: null }
    expect((await scanOf(home, false, none)).hasGlobalClaudeMd).toBe(false)
  })

  test('mangledProjectDir replaces every character that is not a letter or a digit with a hyphen', () => {
    expect(mangledProjectDir('/repo')).toBe('-repo')
    expect(mangledProjectDir('/Users/me/work/my.repo_v2')).toBe('-Users-me-work-my-repo-v2')
    expect(mangledProjectDir('/a b/c-d')).toBe('-a-b-c-d')
    expect(mangledProjectDir('/caf\u00E9')).toBe('-caf-')
    expect(mangledProjectDir('abc123')).toBe('abc123')
    expect(mangledProjectDir('')).toBe('')
  })

  test('memoryFiles are the .md files of the memory folder of this repo, sorted, with their extension', async () => {
    const dirs = {
      [MEMORY_DIR]: [
        entry('project_x.md'),
        entry('MEMORY.md'),
        entry('notes.txt'),
        entry('sub', 'dir'),
        entry('linked.md', 'other', true),
        entry('feedback_y.md'),
      ],
    }
    const scan = await scanOf(memWorld({ dirs }))
    expect(scan.memoryFiles).toEqual(['MEMORY.md', 'feedback_y.md', 'project_x.md'])
  })

  test('the memory folder of another repo is not listed, and the memory file contents are never read', async () => {
    const dirs = { '/home/u/.claude/projects/-other/memory': [entry('other.md')], [MEMORY_DIR]: [entry('mine.md')] }
    const files = { [`${MEMORY_DIR}/mine.md`]: 'SENTINEL_SECRET_VALUE' }
    const { scan, reads } = await runOf(memWorld({ dirs, files }))
    expect(scan.memoryFiles).toEqual(['mine.md'])
    expect(reads.filter(path => path.startsWith(MEMORY_DIR))).toEqual([])
  })

  test('the memory folders of the root as resolved and as given are both listed, once each', async () => {
    const ctx: SetupContext = { ...CTX, root: '/real/repo' }
    const dirs = {
      '/home/u/.claude/projects/-real-repo/memory': [entry('resolved.md'), entry('both.md')],
      [MEMORY_DIR]: [entry('given.md'), entry('both.md')],
    }
    const run = memIo(memWorld({ dirs }), [])
    const scan = await scanSetup(run.io, ctx, false)
    expect(scan.memoryFiles).toEqual(['both.md', 'given.md', 'resolved.md'])
    const same = memIo(memWorld({ dirs }), [])
    await scanSetup(same.io, CTX, false)
    expect(same.listed.filter(path => path === MEMORY_DIR)).toEqual([MEMORY_DIR])
  })

  test('a memory folder that cannot be listed warns, and one that is not there does not', async () => {
    const unreadable = await scanOf(memWorld({ unknownPaths: [MEMORY_DIR] }))
    expect(unreadable.warnings).toEqual(['could not read ~/.claude/projects/-repo/memory (treated as unknown)'])
    expect(unreadable.memoryFiles).toEqual([])
    expect((await scanOf(memWorld({}))).warnings).toEqual([])
  })

  test('a memory file name with a hidden character is dropped and named in a warning', async () => {
    const scan = await scanOf(memWorld({ dirs: { [MEMORY_DIR]: [entry('ok.md'), entry('bad\u0007.md')] } }))
    expect(scan.memoryFiles).toEqual(['ok.md'])
    expect(scan.warnings).toEqual(['ignored memory file name "bad.md": its name has hidden characters or is too long'])
  })

  test('the full secret world, with consent, keeps no secret fixture and no absolute home path', async () => {
    const world = memWorld({
      settings: { user: { ...secretUserSettings(), enabledPlugins: { 'z@m': true } }, project: {}, local: {} },
      files: {
        [INSTALLED_PATH]: INSTALLED_PLUGINS,
        [MCP_JSON_PATH]: MCP_JSON,
        [CLAUDE_JSON_PATH]: CLAUDE_JSON,
        '/home/u/.claude/CLAUDE.md': 'SENTINEL_SECRET_VALUE',
      },
      dirs: { [USER_AGENTS]: [entry('a.md')], [MEMORY_DIR]: [entry('MEMORY.md')] },
      ancestors: CHAIN,
      commands: [{ name: 'one', source: 'user', description: 'Bearer FAKE-TOKEN-0123' }],
      tools: SESSION_TOOLS,
    })
    const scan = await scanOf(world, true)
    expect(scan.warnings).toEqual([])
    expect(scan.plugins).toEqual(['a@m', 'b@m', 'z@m'])
    expect(scan.mcp.map(server => server.name)).toEqual(['github', 'jira', 'linear', 'slack'])
    expect(scan.claudeMd).toHaveLength(4)
    expect(scan.hasGlobalClaudeMd).toBe(true)
    expect(scan.memoryFiles).toEqual(['MEMORY.md'])
    const json = JSON.stringify(scan)
    expect(leaks(json, [...SECRETS, 'someone@example.com'])).toEqual([])
    expect(leaks(json, ABSOLUTE_PATH_MARKERS)).toEqual([])
  })
})

describe('setup MCP completeness', () => {
  test('isMcpPartial is false when ~/.claude.json was read or is not there and no MCP name was dropped', async () => {
    const world = memWorld({
      files: { [MCP_JSON_PATH]: MCP_JSON, [CLAUDE_JSON_PATH]: CLAUDE_JSON },
      tools: SESSION_TOOLS,
    })
    expect((await scanOf(world, true)).isMcpPartial).toBe(false)
    expect((await scanOf(memWorld({}), true)).isMcpPartial).toBe(false)
  })

  test('isMcpPartial is true when ~/.claude.json is not read: no consent or folder, unreadable or broken', async () => {
    const noFolder: SetupContext = { root: '/repo', givenRoot: '/repo', home: null, configDir: null }
    const tooLarge = claudeJsonOfSize(CLAUDE_JSON_MAX_BYTES + 1)
    const partial = [
      await scanOf(memWorld({ files: { [CLAUDE_JSON_PATH]: CLAUDE_JSON } }), false),
      await scanOf(memWorld({ files: { [CLAUDE_JSON_PATH]: CLAUDE_JSON } }), true, noFolder),
      await scanOf(memWorld({ unknownPaths: [CLAUDE_JSON_PATH] }), true),
      await scanOf(memWorld({ files: { [CLAUDE_JSON_PATH]: '{ not json' } }), true),
      await scanOf(memWorld({ files: { [CLAUDE_JSON_PATH]: tooLarge } }), true),
    ]
    expect(partial.map(scan => scan.isMcpPartial)).toEqual([true, true, true, true, true])
  })

  test('isMcpPartial is true when the scan drops an MCP server name from any source', async () => {
    const long = 'x'.repeat(101)
    const worlds = [
      memWorld({ files: { [MCP_JSON_PATH]: JSON.stringify({ mcpServers: { ok: {}, 'has space': {} } }) } }),
      memWorld({ files: { [MCP_JSON_PATH]: JSON.stringify({ mcpServers: { [`bad${BIDI_OVERRIDE}name`]: {} } }) } }),
      memWorld({ tools: [{ name: 'mcp__jira__x' }, { name: 'mcp__bad server__x' }] }),
      memWorld({ tools: [{ name: `mcp__${long}__x` }] }),
      memWorld({ files: { [CLAUDE_JSON_PATH]: JSON.stringify({ mcpServers: { jira: {}, 'x y': {} } }) } }),
    ]
    const found: boolean[] = []
    for (const world of worlds) found.push((await scanOf(world, true)).isMcpPartial)
    expect(found).toEqual([true, true, true, true, true])
  })
})
