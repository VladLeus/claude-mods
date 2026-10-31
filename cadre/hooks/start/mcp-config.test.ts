import { describe, expect, test } from 'claude-code/testing'

import type { RoleSpec } from '../../types'
import { stableJson } from '../core/json'
import { CLAUDE_JSON_MAX_BYTES } from '../scan/setup/mcp'
import { BIDI_OVERRIDE, DEFAULT_LOCATIONS, leaks, memIo, memWorld, SECRET_FIXTURES, templateRole } from '../testkit'
import { readClaudeJson, runtimeMcpText } from './mcp-config'

/** The user's ~/.claude.json of the fixtures. */
const CLAUDE_JSON = '/home/u/.claude.json'

/** The config of the user's redmine server, with a token that may only ever reach the runtime file. */
const REDMINE = { command: 'r', env: { TOKEN: 'sk-FAKE-SECRET-0123456789' } }

/** CLAUDE_CONFIG_DIR values the D-238 rule ignores: relative, with a `..`, `.` or empty segment, inside the repo. */
const UNSAFE_CONFIG_DIRS = ['.claude-alt', '/cfg/../repo/.claude-alt', '/repo/./.claude-alt', '/repo//.claude-alt',
  '/repo/.claude-alt']

/** The MCP config of a role that gets no server (LNCH-02). */
const NO_SERVERS = stableJson({ mcpServers: {} })

/** The one warning for a role given servers when ~/.claude.json was not read (D-58). */
const NOT_READ =
  '~/.claude.json was not read (no consent at init), so the user-scope MCP servers of this role are not rendered'

/** The warning for a server a role is given that ~/.claude.json does not hold. */
function notInFile(name: string): string {
  return (
    `MCP server ${name} is not in ~/.claude.json: ` +
    'the role gets it only from the repo .mcp.json or a claude.ai connector'
  )
}

/** The BE role given exactly these MCP servers. */
function givenMcp(mcp: readonly string[]): RoleSpec {
  return templateRole('be', { mcp })
}

describe('runtime MCP config (D-93)', () => {
  test('readClaudeJson reads nothing without the stored consent, and gives null (D-58)', async () => {
    const run = memIo(memWorld({ files: { [CLAUDE_JSON]: '{"mcpServers":{}}' } }), {})

    expect(await readClaudeJson(run.io, DEFAULT_LOCATIONS, false)).toBeNull()
    expect(run.reads.filter(path => path.endsWith('.claude.json'))).toEqual([])
  })

  test('readClaudeJson with the consent reads the file claudeJsonPathOf names and gives its parsed value', async () => {
    const value = { mcpServers: { redmine: REDMINE } }
    const run = memIo(memWorld({ files: { [CLAUDE_JSON]: JSON.stringify(value) } }), {})

    expect(await readClaudeJson(run.io, DEFAULT_LOCATIONS, true)).toEqual(value)
    expect(run.reads).toEqual([CLAUDE_JSON])
    const configured = memIo(memWorld({ files: { '/cfg/.claude.json': '{"a":1}', [CLAUDE_JSON]: '{"b":2}' } }), {})
    expect(await readClaudeJson(configured.io, { ...DEFAULT_LOCATIONS, configDir: '/cfg' }, true)).toEqual({ a: 1 })
    expect(configured.reads).toEqual(['/cfg/.claude.json'])
  })

  test('readClaudeJson reads ~/.claude.json for a relative, dotted or inside-repo config dir (SR-1)', async () => {
    const files = { '/repo/.claude-alt/.claude.json': '{"repo":1}', [CLAUDE_JSON]: '{"home":2}' }
    for (const configDir of UNSAFE_CONFIG_DIRS) {
      const run = memIo(memWorld({ files }), {})
      const value = await readClaudeJson(run.io, { ...DEFAULT_LOCATIONS, configDir }, true)
      expect([configDir, value, run.reads]).toEqual([configDir, { home: 2 }, [CLAUDE_JSON]])
    }
  })

  test('readClaudeJson gives null for a file that is absent, unreadable, too large or not JSON', async () => {
    const worlds = [
      memWorld({}),
      memWorld({ files: { [CLAUDE_JSON]: '{}' }, unknownPaths: [CLAUDE_JSON] }),
      memWorld({ files: { [CLAUDE_JSON]: `{"a":"${'x'.repeat(CLAUDE_JSON_MAX_BYTES)}"}` } }),
      memWorld({ files: { [CLAUDE_JSON]: '{' } }),
    ]
    for (const [index, world] of worlds.entries()) {
      expect([index, await readClaudeJson(memIo(world, {}).io, DEFAULT_LOCATIONS, true)]).toEqual([index, null])
    }
    const homeless = { ...DEFAULT_LOCATIONS, home: null }
    expect(await readClaudeJson(memIo(memWorld({}), {}).io, homeless, true)).toBeNull()
  })

  test('runtimeMcpText renders each given server with its config from ~/.claude.json, and no warning', () => {
    const rendered = runtimeMcpText(givenMcp(['redmine']), { mcpServers: { redmine: REDMINE } }, ['/repo'], true)

    expect(rendered).toEqual({ text: stableJson({ mcpServers: { redmine: REDMINE } }), warnings: [] })
  })

  test('the project entry of the root as resolved, then as given, wins over the top level', () => {
    const top = { command: 'top' }
    const own = { command: 'own' }
    const linked = { command: 'linked' }
    const roots = ['/repo', '/link/repo']
    const projects = { '/link/repo': { mcpServers: { redmine: linked } }, '/repo': { mcpServers: { redmine: own } } }
    const textOf = (claudeJson: unknown): string => runtimeMcpText(givenMcp(['redmine']), claudeJson, roots, true).text

    expect(textOf({ mcpServers: { redmine: top }, projects })).toBe(stableJson({ mcpServers: { redmine: own } }))
    const given = { '/link/repo/': { mcpServers: { redmine: linked } } }
    const fromGiven = textOf({ mcpServers: { redmine: top }, projects: given })
    expect(fromGiven).toBe(stableJson({ mcpServers: { redmine: linked } }))
    const other = { '/elsewhere': { mcpServers: { redmine: own } } }
    expect(textOf({ mcpServers: { redmine: top }, projects: other })).toBe(stableJson({ mcpServers: { redmine: top } }))
  })

  test('a given server not in the file, or not an object there, is left out with a warning naming it', () => {
    const claudeJson = { mcpServers: { redmine: REDMINE, broken: 'x', listed: [] } }
    const mcp = ['sentry', 'redmine', 'broken', 'listed', 'constructor']
    const rendered = runtimeMcpText(givenMcp(mcp), claudeJson, ['/repo'], true)

    expect(rendered.text).toBe(stableJson({ mcpServers: { redmine: REDMINE } }))
    expect(rendered.warnings).toEqual(['broken', 'constructor', 'listed', 'sentry'].map(notInFile))
    expect(runtimeMcpText(givenMcp(['redmine']), null, ['/repo'], true)).toEqual({
      text: NO_SERVERS,
      warnings: [notInFile('redmine')],
    })
  })

  test('without the consent a role given servers gets none, and one warning says the file was not read (D-58)', () => {
    const claudeJson = { mcpServers: { redmine: REDMINE } }

    expect(runtimeMcpText(givenMcp(['redmine', 'sentry']), claudeJson, ['/repo'], false)).toEqual({
      text: NO_SERVERS,
      warnings: [NOT_READ],
    })
  })

  test('a role given no MCP server renders no server and no warning, read or not (LNCH-02)', () => {
    for (const isRead of [true, false]) {
      const rendered = runtimeMcpText(givenMcp([]), { mcpServers: { redmine: REDMINE } }, ['/repo'], isRead)

      expect([isRead, rendered]).toEqual([isRead, { text: NO_SERVERS, warnings: [] }])
    }
  })

  test('a server name is shown cleaned, and no warning holds a config value or a secret of the fixtures', () => {
    const linear = { headers: { Authorization: 'Bearer FAKE-TOKEN-0123' } }
    const claudeJson = { mcpServers: { redmine: REDMINE }, projects: { '/repo': { mcpServers: { linear } } } }
    const read = runtimeMcpText(givenMcp(['redmine', 'linear', `sentry${BIDI_OVERRIDE}`]), claudeJson, ['/repo'], true)
    const unread = runtimeMcpText(givenMcp(['redmine', 'linear']), claudeJson, ['/repo'], false)

    expect(read.warnings).toEqual([notInFile('sentry')])
    expect(read.text).toBe(stableJson({ mcpServers: { linear, redmine: REDMINE } }))
    expect(leaks([...read.warnings, ...unread.warnings].join('\n'), SECRET_FIXTURES)).toEqual([])
  })
})
