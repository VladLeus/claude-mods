import { describe, expect, test } from 'claude-code/testing'

import type { SetupScan } from '../../../types'
import { t } from '../../locales/t'
import { claudeJsonPathOf, mangledProjectDir, userDirOf } from '../../paths'
import {
  ABSOLUTE_PATH_MARKERS,
  CTX,
  entry,
  leaks,
  memIo,
  memWorld,
  runOf,
  SECRET_FIXTURES,
  secretUserSettings,
} from '../../testkit'
import type { MemWorld } from '../../testkit'
import { MAX_READ_BYTES } from '../facts/normalize'
import { claudeMdPathsOf, projectAncestors } from './claude-md'
import { CLAUDE_JSON_MAX_BYTES, projectClaudeJson, projectMcpJson, projectToolServers } from './mcp'
import type { SetupContext } from './read'
import { hookScriptOf } from './settings'
import { scanSetup } from './setup'
import { projectCommands } from './skills'

/** The secret fixtures and the fixture home: nothing of these may survive into a scan. */
const SECRETS: readonly string[] = [...SECRET_FIXTURES, '/home/u']

/**
 * A scan as JSON with its skills by name and plugin only: the skill purposes, which D-139 keeps in memory by design,
 * are left out, so the leak checks still read every other value of the scan.
 */
function jsonWithoutPurposes(scan: SetupScan): string {
  return JSON.stringify({ ...scan, skills: scan.skills.map(skill => ({ name: skill.name, plugin: skill.plugin })) })
}

/** A scan of `world` as the person at `ctx` gets it. */
async function scanOf(world: MemWorld, isClaudeJsonAllowed = false, ctx: SetupContext = CTX): Promise<SetupScan> {
  return (await runOf(world, isClaudeJsonAllowed, ctx)).scan
}

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
      { name: 'gsd-plan-phase', plugin: null, purpose: 'x' },
      { name: 'superpowers:brainstorming', plugin: 'superpowers', purpose: 'y' },
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

  test('projectCommands keeps a description only as the purpose, and never any other field of a command', () => {
    const found = projectCommands([
      { name: 'one', source: 'user', description: 'Bearer FAKE-TOKEN-0123', argumentHint: 'sk-FAKE-SECRET-0123456789' },
    ])
    expect(found).toEqual([{ name: 'one', plugin: null, purpose: 'Bearer FAKE-TOKEN-0123' }])
    expect(leaks(JSON.stringify(found), SECRETS)).toEqual(['Bearer FAKE-TOKEN-0123'])
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

  test('installedPlugins holds only installed keys, none that a settings file enables (#69 A1)', async () => {
    const official = 'claude-security@claude-plugins-official'
    const project = { enabledPlugins: { [official]: true } }
    const local = { enabledPlugins: { 'k@m': true } }
    const installed = memWorld({
      settings: { user: {}, project, local },
      files: { [INSTALLED_PATH]: INSTALLED_PLUGINS },
    })
    const scan = await scanOf(installed)
    expect(scan.installedPlugins).toEqual(['a@m', 'b@m'])
    expect(scan.plugins).toEqual(['a@m', 'b@m', official, 'k@m'])
    const enabledOnly = await scanOf(memWorld({ settings: { user: {}, project, local: {} } }))
    expect([enabledOnly.plugins, enabledOnly.installedPlugins]).toEqual([[official], []])
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
      { name: 'gsd-plan-phase', plugin: null, purpose: 'Bearer FAKE-TOKEN-0123' },
      { name: 'superpowers:brainstorming', plugin: 'superpowers', purpose: 'x' },
    ])
    expect(scan.mcp.map(server => server.name)).toEqual(['github', 'jira', 'slack'])
    expect(scan.agents).toEqual(['a', 'b', 'c'])
    expect(scan.warnings).toEqual([])
    const json = jsonWithoutPurposes(scan)
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
    expect(CLAUDE_JSON_MAX_BYTES).toBeGreaterThan(MAX_READ_BYTES)
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

  test('userDirOf is CLAUDE_CONFIG_DIR when it is set, else <home>/.claude, and null with neither (IN-02)', () => {
    expect(userDirOf({ ...CTX, configDir: '/cfg' }, [CTX.root], [])).toBe('/cfg')
    expect(userDirOf({ ...CTX, configDir: '/cfg', home: null }, [CTX.root], [])).toBe('/cfg')
    expect(userDirOf(CTX, [CTX.root], [])).toBe('/home/u/.claude')
    expect(userDirOf({ ...CTX, home: null }, [CTX.root], [])).toBeNull()
    expect(userDirOf({ ...CTX, configDir: '/main/.alt' }, [CTX.root, '/main'], [])).toBe('/home/u/.claude')
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
    expect(scan.skills).toEqual([{ name: 'one', plugin: null, purpose: 'Bearer FAKE-TOKEN-0123' }])
    const json = jsonWithoutPurposes(scan)
    expect(leaks(json, [...SECRETS, 'someone@example.com'])).toEqual([])
    expect(leaks(json, ABSOLUTE_PATH_MARKERS)).toEqual([])
  })
})

describe('launch exports', () => {
  test('claudeMdPathsOf gives the CLAUDE.md files of the chain as absolute paths, in order and once each', () => {
    const chain = [
      { dir: '/repo', name: 'CLAUDE.md' },
      { dir: '/', name: 'CLAUDE.md' },
      { dir: '/repo', name: 'AGENTS.md' },
    ]
    expect(claudeMdPathsOf(chain)).toEqual(['/repo/CLAUDE.md', '/CLAUDE.md'])
    const more = [...chain, { dir: '/repo/', name: 'CLAUDE.md' }, { dir: '/repo', name: '.claude/CLAUDE.md' }]
    expect(claudeMdPathsOf(more)).toEqual(['/repo/CLAUDE.md', '/CLAUDE.md', '/repo/.claude/CLAUDE.md'])
  })

  test('claudeMdPathsOf skips an entry without a dir or a name, and anything but a list gives []', () => {
    const entries = [{ name: 'CLAUDE.md' }, { dir: '/repo' }, { dir: 1, name: 'CLAUDE.md' }, null, 'CLAUDE.md']
    expect(claudeMdPathsOf(entries)).toEqual([])
    expect([null, {}, 'CLAUDE.md', 5].map(claudeMdPathsOf)).toEqual([[], [], [], []])
  })

  test('hookScriptOf gives the first script basename of a command that a role.json can hold, else null', () => {
    const guard = 'SECRET=x node /home/u/.claude/hooks/gsd-secret-read-guard.js'
    expect(hookScriptOf(guard)).toBe('gsd-secret-read-guard.js')
    expect(hookScriptOf('echo hi')).toBeNull()
    expect(hookScriptOf('sh /x/a.sh && node /x/b.js')).toBe('a.sh')
    // 81 characters: the pattern finds it, the role.json cap of 80 does not take it, so the next script is the one.
    expect(hookScriptOf(`node /x/${'x'.repeat(78)}.js /x/b.sh`)).toBe('b.sh')
  })

  test('claudeJsonPathOf is the file in CLAUDE_CONFIG_DIR when it is set, else in the home folder, else null', () => {
    expect(claudeJsonPathOf(CTX)).toBe('/home/u/.claude.json')
    expect(claudeJsonPathOf({ ...CTX, configDir: '/cfg' })).toBe('/cfg/.claude.json')
    expect(claudeJsonPathOf({ ...CTX, configDir: '/cfg', home: null })).toBe('/cfg/.claude.json')
    expect(claudeJsonPathOf({ ...CTX, home: null })).toBeNull()
  })
})

/**
 * What the setup scan reads when CLAUDE_CONFIG_DIR is relative or inside the repo (D-238): the value is ignored with
 * the CLAUDE_CONFIG_DIR warning, once, and every user-level source is read below <home>/.claude instead, and
 * `.claude.json` from the home folder (claudeJsonPathOf follows the same rule, SR-1).
 */
describe('unsafe CLAUDE_CONFIG_DIR (D-238)', () => {
  /** A user folder under the fixture home with the plugins file, one agent and an unreadable global CLAUDE.md. */
  function homeWorld(): MemWorld {
    return memWorld({
      files: { '/home/u/.claude/plugins/installed_plugins.json': INSTALLED_PLUGINS },
      dirs: { '/home/u/.claude/agents': [entry('alt-agent.md')] },
      unknownPaths: ['/home/u/.claude/CLAUDE.md'],
    })
  }

  test('a relative value warns once and the user folder is <home>/.claude', async () => {
    const run = memIo(homeWorld(), [])
    const scan = await scanSetup(run.io, { ...CTX, configDir: '.claude-alt' }, true)
    expect(run.reads).toEqual([
      '/home/u/.claude/plugins/installed_plugins.json',
      '/repo/.mcp.json',
      '/home/u/.claude.json',
      '/repo/.claude/agents',
      '/home/u/.claude/CLAUDE.md',
      '/home/u/.claude/projects/-repo/memory',
    ])
    expect(run.listed).toEqual(['/home/u/.claude/agents', '/home/u/.claude/projects/-repo/memory'])
    expect([scan.plugins, scan.agents]).toEqual([['a@m', 'b@m'], ['alt-agent']])
    expect(scan.warnings).toEqual([
      t('paths.configDirWarning'),
      'could not read ~/.claude/CLAUDE.md (treated as unknown)',
    ])
  })

  test('an inside-repo value warns once and the user folder is <home>/.claude', async () => {
    const run = memIo(homeWorld(), [])
    const scan = await scanSetup(run.io, { ...CTX, configDir: '/repo/.claude-alt' }, true)
    expect(run.reads).toEqual([
      '/home/u/.claude/plugins/installed_plugins.json',
      '/repo/.mcp.json',
      '/home/u/.claude.json',
      '/repo/.claude/agents',
      '/home/u/.claude/CLAUDE.md',
      '/home/u/.claude/projects/-repo/memory',
    ])
    expect(run.listed).toEqual(['/home/u/.claude/agents', '/home/u/.claude/projects/-repo/memory'])
    expect([scan.plugins, scan.agents]).toEqual([['a@m', 'b@m'], ['alt-agent']])
    expect(scan.warnings).toEqual([
      t('paths.configDirWarning'),
      'could not read ~/.claude/CLAUDE.md (treated as unknown)',
    ])
  })
})
