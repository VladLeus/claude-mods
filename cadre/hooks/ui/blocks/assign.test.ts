import { describe, expect, test } from 'claude-code/testing'

import type { McpRef } from '../../../types'
import {
  mcpGroupContext,
  mcpServerContext,
  mcpSourceText,
  mcpToolNamesOf,
  ownSkillsContext,
  skillContext,
  skillGroupContext,
} from './assign'
import type { SkillLine } from './assign'

/** A server of the repo's `.mcp.json`. */
const GITHUB: McpRef = { name: 'github', source: 'project' }

/** The session's tool names: two of github, one of another server, and a built-in tool. */
const TOOLS = ['mcp__github__list_prs', 'mcp__github__create_issue', 'mcp__gitlab__merge', 'Read']

describe('MCP server contexts (D-211)', () => {
  test('each source is named as the person knows it; a claude_ai_ session server is a claude.ai connector', () => {
    const refs: readonly McpRef[] = [
      GITHUB,
      { name: 'jira', source: 'user-config' },
      { name: 'claude_ai_Gmail', source: 'session' },
      { name: 'sentry', source: 'session' },
    ]
    expect(refs.map(mcpSourceText)).toEqual(['.mcp.json', '~/.claude.json', 'claude.ai', 'session'])
  })

  test("mcpToolNamesOf keeps one server's tool names without the prefix, cleaned and capped, once each", () => {
    expect(mcpToolNamesOf([...TOOLS, 'mcp__github__list_prs', 'mcp__github__', 42], 'github')).toEqual([
      'create_issue',
      'list_prs',
    ])
    const bidi = String.fromCodePoint(0x202e)
    expect(mcpToolNamesOf([`mcp__github__ev${bidi}il`, `mcp__github__${'t'.repeat(200)}`], 'github')).toEqual([
      'evil',
      `${'t'.repeat(109)}…`,
    ])
    expect([mcpToolNamesOf(null, 'github'), mcpToolNamesOf({ name: 'mcp__github__x' }, 'github')]).toEqual([[], []])
  })

  test('a .mcp.json server lists its source, its tool names and the recommended roles, and nothing else', () => {
    expect(mcpServerContext(GITHUB, TOOLS, ['be', 'qa'])).toEqual({
      title: 'MCP: github',
      lines: ['Source: .mcp.json', 'Tools: 2 (create_issue, list_prs)', 'Recommended: be, qa'],
      kind: 'mcp-server',
    })
  })

  test('a server the session lists no tool for says so, and no recommendation reads none', () => {
    expect(mcpServerContext({ name: 'sentry', source: 'session' }, TOOLS, []).lines).toEqual([
      'Source: session',
      'Tools: none listed',
      'Recommended: none',
    ])
  })

  test('50 tools show 12 names, then how many more (T-02.1-73); a name never adds a line (T-02.1-71)', () => {
    const many = Array.from({ length: 50 }, (_, at) => `mcp__big__t${String(at).padStart(2, '0')}`)
    const tools = mcpServerContext({ name: 'big', source: 'session' }, many, []).lines[1]
    expect(tools).toBe('Tools: 50 (t00, t01, t02, t03, t04, t05, t06, t07, t08, t09, t10, t11, +38 more)')
    const newline = String.fromCodePoint(10)
    const forged = mcpServerContext({ name: `x${newline}y`, source: 'project' }, [], [])
    expect([forged.title, forged.lines.length]).toEqual(['MCP: xy', 3])
  })
})

/** Two skills of a group: one with a description and uses, one with the fallback text and no uses. */
const SKILLS: readonly SkillLine[] = [
  { name: 'codex:rescue', purpose: 'Delegate a stuck task', uses: '3 times in the last 50 sessions', recommended: [] },
  { name: 'codex:setup', purpose: 'No description.', uses: '', recommended: ['be'] },
]

describe('skill contexts (D-211)', () => {
  test('a skill group lists one line per skill: name, description, uses and the recommended roles', () => {
    expect(skillGroupContext('codex', SKILLS)).toEqual({
      title: 'Skills: codex',
      lines: [
        'codex:rescue: Delegate a stuck task. Used 3 times in the last 50 sessions. Recommended: none.',
        'codex:setup: No description. Recommended: be.',
      ],
      kind: 'skill-group',
    })
  })

  test("one own skill's context holds that skill only, titled by its place", () => {
    const [first, second] = SKILLS
    expect(first === undefined ? null : skillContext(first, 1, 2)).toEqual({
      title: 'Skill 1 of 2',
      lines: ['codex:rescue: Delegate a stuck task. Used 3 times in the last 50 sessions. Recommended: none.'],
      kind: 'skill',
    })
    expect(second === undefined ? null : skillContext(second, 2, 2).lines).toEqual([
      'codex:setup: No description. Recommended: be.',
    ])
  })

  test('every skill value is cleaned; a long name is cut to 60 code points (T-02.1-71)', () => {
    const bidi = String.fromCodePoint(0x202e)
    const line = { name: `${'n'.repeat(70)}${bidi}`, purpose: `Do${bidi} it`, uses: '', recommended: ['qa'] }
    expect(skillGroupContext(`own${bidi}`, [line])).toEqual({
      title: 'Skills: own',
      lines: [`${'n'.repeat(59)}…: Do it. Recommended: qa.`],
      kind: 'skill-group',
    })
  })

  test('a secret-like span of a description is hidden; only the description is read for one (E1)', () => {
    const skills: readonly SkillLine[] = [
      { name: 'codex:rescue', purpose: 'Bearer FAKE-TOKEN-0123', uses: '', recommended: [] },
      { name: 'keys:rotate', purpose: 'Rotate with sk-FAKE-SECRET-0123456789', uses: '', recommended: ['be'] },
      { name: 'token-count', purpose: '2 ways to count tokens', uses: '', recommended: [] },
    ]
    const lines = [
      'codex:rescue: Bearer [hidden]. Recommended: none.',
      'keys:rotate: Rotate with [hidden]. Recommended: be.',
      'token-count: 2 ways to count tokens. Recommended: none.',
    ]
    expect(skillGroupContext('codex', skills).lines).toEqual(lines)
    expect(skills.map((skill, at) => skillContext(skill, at + 1, skills.length).lines)).toEqual(lines.map(l => [l]))
  })

  test('the own-skills entry context is the own-skills block, each line cleaned as a report cell', () => {
    const bidi = String.fromCodePoint(0x202e)
    expect(ownSkillsContext(['Skills with no plugin:', `  mine: Do${bidi} it.`])).toEqual({
      title: 'Your own skills',
      lines: ['Skills with no plugin:', '  mine: Do it.'],
      kind: 'skills',
    })
  })
})

describe('own skill lines and their caps (#163)', () => {
  test('the own-skills context keeps a line whole, never cut at 240 code points', () => {
    const wide = 'w'.repeat(300)
    expect(ownSkillsContext([wide]).lines).toEqual([wide])
  })

  test('a purpose is redacted before its 120 cap: a key across the cap shows no prefix of it', () => {
    const key = ['sk', 'FAKE0123456789abcdef'].join('-')
    const skill: SkillLine = { name: 'deploy', purpose: `${'x'.repeat(110)} ${key} tail`, uses: '', recommended: [] }
    const [line = ''] = skillContext(skill, 1, 1).lines
    expect([line.includes(key.slice(0, 8)), line.includes('[hidden]')]).toEqual([false, true])
  })
})

describe('mcpGroupContext (D-250)', () => {
  test('the question for all the servers lists each with its source, its tool count and its recommended roles', () => {
    const lines = [
      { name: 'github', source: 'session', tools: 2, recommended: ['tl'] },
      { name: 'sentry', source: '.mcp.json', tools: 0, recommended: [] },
    ]
    expect(mcpGroupContext(lines)).toEqual({
      title: 'MCP servers',
      lines: ['github: session, 2 tools. Recommended: tl.', 'sentry: .mcp.json, 0 tools. Recommended: none.'],
      kind: 'mcp-server',
    })
  })
})
