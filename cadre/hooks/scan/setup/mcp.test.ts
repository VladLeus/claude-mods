import { describe, expect, test } from 'claude-code/testing'

import type { SetupScan } from '../../../types'
import { BIDI_OVERRIDE, memIo, memWorld } from '../../testkit'
import type { MemWorld } from '../../testkit'
import {
  CLAUDE_JSON_MAX_BYTES,
  connectorServerNames,
  isDesktopConnectorName,
  projectClaudeJson,
  projectToolServers,
} from './mcp'
import type { SetupContext } from './read'
import { scanSetup } from './setup'

/** The session of the fixtures: the repo /repo of a user whose home is /home/u, with no CLAUDE_CONFIG_DIR. */
const CTX: SetupContext = { root: '/repo', givenRoot: '/repo', home: '/home/u', configDir: null }

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

/** A .mcp.json whose server entries hold a token and an authorization header. */
const MCP_JSON = JSON.stringify({
  mcpServers: {
    github: { command: 'npx', env: { GITHUB_TOKEN: 'ghp_FAKEFAKEFAKEFAKEFAKE' } },
    jira: { url: 'https://jira.example', headers: { Authorization: 'Bearer FAKE-TOKEN-0123' } },
  },
})

const MCP_JSON_PATH = '/repo/.mcp.json'

/** The tool entries of a session that has the jira and slack servers and the built-in Read tool. */
const SESSION_TOOLS: readonly unknown[] = [
  { name: 'mcp__jira__search', description: 'sk-FAKE-SECRET-0123456789', mcp: true },
  { name: 'mcp__slack__post', description: 'x', mcp: true },
  { name: 'Read', description: 'x', mcp: false },
]

const CLAUDE_JSON_PATH = '/home/u/.claude.json'

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

/** A claude.ai connector as a desktop-app session names its SDK MCP server: by a UUID (R2). */
const CONNECTOR_UUID = 'bffcbad4-dacc-4759-8f45-f8c9abe5e705'

/** Another desktop app connector's UUID (R2). */
const OTHER_CONNECTOR_UUID = '0f3c2a91-7d4e-4b6a-9c1d-2e5f8a7b6c3d'

describe('desktop app connectors (R2)', () => {
  test('isDesktopConnectorName is true for a UUID in either case, and false for any other name', () => {
    expect(isDesktopConnectorName(CONNECTOR_UUID)).toBe(true)
    expect(isDesktopConnectorName(CONNECTOR_UUID.toUpperCase())).toBe(true)
    const others = [
      'jira',
      'claude_ai_Gmail',
      `x${CONNECTOR_UUID}`,
      `${CONNECTOR_UUID}x`,
      'bffcbad4-dacc-4759-8f45-f8c9abe5e70',
      'bffcbad4dacc47598f45f8c9abe5e705',
    ]
    for (const name of others) expect(isDesktopConnectorName(name)).toBe(false)
  })

  test('projectToolServers leaves out every server named by a UUID', () => {
    const tools = [
      { name: `mcp__${CONNECTOR_UUID}__append_values` },
      { name: `mcp__${OTHER_CONNECTOR_UUID}__x` },
      { name: 'mcp__jira__search' },
    ]
    expect(projectToolServers(tools)).toEqual([{ name: 'jira', source: 'session' }])
  })

  test('a scan leaves the connectors out with one line that counts each server once, and stays complete', async () => {
    const tools = [
      { name: `mcp__${CONNECTOR_UUID}__append_values` },
      { name: `mcp__${CONNECTOR_UUID}__read_values` },
      { name: `mcp__${OTHER_CONNECTOR_UUID}__x` },
      { name: 'mcp__jira__search' },
    ]
    const scan = await scanOf(memWorld({ tools, files: { [CLAUDE_JSON_PATH]: '{}' } }), true)
    expect(scan.mcp).toEqual([{ name: 'jira', source: 'session' }])
    expect(scan.warnings).toEqual([
      'left out 2 desktop app connectors (role sessions run in the terminal, where connectors are claude_ai_* servers)',
    ])
    expect(scan.isMcpPartial).toBe(false)
  })

  test('one connector is counted in the singular, and a session with none gets no such line', async () => {
    const one = await scanOf(memWorld({ tools: [{ name: `mcp__${CONNECTOR_UUID}__x` }] }), true)
    expect(one.warnings).toEqual([
      'left out 1 desktop app connector (role sessions run in the terminal, where connectors are claude_ai_* servers)',
    ])
    expect(one.mcp).toEqual([])
    const none = await scanOf(memWorld({ tools: [{ name: 'mcp__jira__x' }] }), true)
    expect(none.warnings).toEqual([])
  })
})

describe('claude.ai connectors in ~/.claude.json (R2)', () => {
  /** The four connectors of the fixture account, as `claudeAiMcpEverConnected` names them. */
  const EVER_CONNECTED = [
    'claude.ai Gmail',
    'claude.ai Google Calendar',
    'claude.ai Atlassian Rovo',
    'claude.ai Notion',
  ]

  test('projectClaudeJson names each connector as the terminal names its server, sorted, as user-config', () => {
    expect(projectClaudeJson({ claudeAiMcpEverConnected: EVER_CONNECTED }, ['/repo'])).toEqual([
      { name: 'claude_ai_Atlassian_Rovo', source: 'user-config' },
      { name: 'claude_ai_Gmail', source: 'user-config' },
      { name: 'claude_ai_Google_Calendar', source: 'user-config' },
      { name: 'claude_ai_Notion', source: 'user-config' },
    ])
    const both = { claudeAiMcpEverConnected: EVER_CONNECTED, mcpServers: { jira: {} } }
    expect(projectClaudeJson(both, ['/repo']).map(server => server.name)).toEqual([
      'claude_ai_Atlassian_Rovo',
      'claude_ai_Gmail',
      'claude_ai_Google_Calendar',
      'claude_ai_Notion',
      'jira',
    ])
  })

  test('connectorServerNames skips every entry but a claude.ai name, and a list it cannot read', () => {
    const ever = [3, null, {}, 'Gmail', 'claude.aiX', 'claude.ai ', 'claude.ai A.b/c']
    expect(connectorServerNames({ claudeAiMcpEverConnected: ever })).toEqual(['claude_ai_A_b_c'])
    const unread: readonly unknown[] = [
      { claudeAiMcpEverConnected: 'x' },
      { claudeAiMcpEverConnected: {} },
      Object.create({ claudeAiMcpEverConnected: ['claude.ai Gmail'] }),
      ['claude.ai Gmail'],
      'x',
      null,
    ]
    expect(unread.flatMap(value => connectorServerNames(value))).toEqual([])
  })

  test('only the first 100 entries of the list are read', () => {
    const ever = Array.from({ length: 101 }, (_, at) => `claude.ai C${at}`)
    const names = connectorServerNames({ claudeAiMcpEverConnected: ever })
    expect(names).toHaveLength(100)
    expect([names[0], names.at(-1)]).toEqual(['claude_ai_C0', 'claude_ai_C99'])
  })

  test('with consent the connectors join the scan once by name, a session server keeping its source', async () => {
    const claudeJson = JSON.stringify({ claudeAiMcpEverConnected: ['claude.ai Gmail', 'claude.ai Notion'] })
    const world = memWorld({ tools: [{ name: 'mcp__claude_ai_Gmail__x' }], files: { [CLAUDE_JSON_PATH]: claudeJson } })
    const consented = await scanOf(world, true)
    expect(consented.mcp).toEqual([
      { name: 'claude_ai_Gmail', source: 'session' },
      { name: 'claude_ai_Notion', source: 'user-config' },
    ])
    expect(consented.isMcpPartial).toBe(false)
    const refused = await runOf(world, false)
    expect(refused.reads).not.toContain(CLAUDE_JSON_PATH)
    expect(refused.scan.mcp).toEqual([{ name: 'claude_ai_Gmail', source: 'session' }])
  })
})
