import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, ContextRow, McpRef } from '../../../types'
import { SCREEN_LIST_WORDS } from '../../locales/t'
import { paneDrawn } from '../pane'
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

/** One untitled section holding each line as one plain row (D-313). */
function plainRows(lines: readonly string[]): unknown {
  return [{ title: null, rows: lines.map(text => ({ role: 'plain', text, indent: 0 })) }]
}

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
    expect(mcpServerContext(GITHUB, TOOLS, ['be', 'qa'], SCREEN_LIST_WORDS)).toEqual({
      title: 'MCP: github',
      lines: ['Source: .mcp.json', 'Tools: 2 (create_issue, list_prs)', 'Recommended: be, qa'],
      kind: 'mcp-server',
      summary: 'Recommended: be, qa',
      rows: [
        {
          title: null,
          rows: [
            { role: 'field', label: 'Source', text: '.mcp.json', indent: 0 },
            { role: 'plain', text: 'Tools: 2 (create_issue, list_prs)', indent: 0 },
            { role: 'recommended', label: 'Recommended', text: 'be, qa', indent: 0 },
          ],
        },
      ],
    })
  })

  test('a server the session lists no tool for says so, and no recommendation reads none', () => {
    const sentry = mcpServerContext({ name: 'sentry', source: 'session' }, TOOLS, [], SCREEN_LIST_WORDS)
    expect(sentry.lines).toEqual(['Source: session', 'Tools: none listed', 'Recommended: none'])
    expect(sentry).toMatchObject({ summary: 'Recommended: none' })
  })

  test('50 tools show 12 names, then how many more (T-02.1-73); a name never adds a line (T-02.1-71)', () => {
    const many = Array.from({ length: 50 }, (_, at) => `mcp__big__t${String(at).padStart(2, '0')}`)
    const tools = mcpServerContext({ name: 'big', source: 'session' }, many, [], SCREEN_LIST_WORDS).lines[1]
    expect(tools).toBe('Tools: 50 (t00, t01, t02, t03, t04, t05, t06, t07, t08, t09, t10, t11, +38 more)')
    const newline = String.fromCodePoint(10)
    const forged = mcpServerContext({ name: `x${newline}y`, source: 'project' }, [], [], SCREEN_LIST_WORDS)
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
    const lines = [
      'codex:rescue: Delegate a stuck task. Used 3 times in the last 50 sessions. Recommended: none.',
      'codex:setup: No description. Recommended: be.',
    ]
    expect(skillGroupContext('codex', SKILLS)).toEqual({
      title: 'Skills: codex',
      lines,
      kind: 'skill-group',
      summary: '2 skills. Recommended: none',
      rows: plainRows(lines),
    })
  })

  test("one own skill's context holds that skill only, titled by its place", () => {
    const [first, second] = SKILLS
    const line = 'codex:rescue: Delegate a stuck task. Used 3 times in the last 50 sessions. Recommended: none.'
    expect(first === undefined ? null : skillContext(first, 1, 2)).toEqual({
      title: 'Skill 1 of 2',
      lines: [line],
      kind: 'skill',
      summary: 'Recommended: none',
      rows: plainRows([line]),
    })
    expect(second === undefined ? null : skillContext(second, 2, 2).lines).toEqual([
      'codex:setup: No description. Recommended: be.',
    ])
    expect(second === undefined ? null : skillContext(second, 2, 2)).toMatchObject({ summary: 'Recommended: be' })
  })

  test('every skill value is cleaned; a long name is cut to 60 code points (T-02.1-71)', () => {
    const bidi = String.fromCodePoint(0x202e)
    const line = { name: `${'n'.repeat(70)}${bidi}`, purpose: `Do${bidi} it`, uses: '', recommended: ['qa'] }
    expect(skillGroupContext(`own${bidi}`, [line])).toEqual({
      title: 'Skills: own',
      lines: [`${'n'.repeat(59)}…: Do it. Recommended: qa.`],
      kind: 'skill-group',
      summary: '1 skill. Recommended: none',
      rows: plainRows([`${'n'.repeat(59)}…: Do it. Recommended: qa.`]),
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
    expect(skillGroupContext('codex', skills, ['be', 'qa'])).toMatchObject({ summary: '3 skills. Recommended: be, qa' })
    expect(skills.map((skill, at) => skillContext(skill, at + 1, skills.length).lines)).toEqual(lines.map(l => [l]))
  })

  test('the own-skills entry context is the own-skills block, each line cleaned; its summary counts them', () => {
    const bidi = String.fromCodePoint(0x202e)
    const rows = [{ role: 'field', label: 'mine', text: 'Do it.', indent: 2 }] satisfies ContextRow[]
    expect(ownSkillsContext(['Skills with no plugin:', `  mine: Do${bidi} it.`], rows, 1, 0)).toEqual({
      title: 'Your own skills',
      lines: ['Skills with no plugin:', '  mine: Do it.'],
      kind: 'skills',
      summary: '1 skill, 0 recommended',
      rows: [{ title: null, rows }],
    })
    expect(ownSkillsContext([], [], 14, 3)).toMatchObject({ summary: '14 skills, 3 recommended' })
  })
})

describe('own skill lines and their caps (#163)', () => {
  test('the own-skills context keeps a line whole, never cut at 240 code points', () => {
    const wide = 'w'.repeat(300)
    expect(ownSkillsContext([wide], [], 1, 0).lines).toEqual([wide])
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
      { name: 'jira', source: 'claude.ai', tools: 1, recommended: [] },
    ]
    const texts = [
      'github: session, 2 tools. Recommended: tl.',
      'sentry: .mcp.json, 0 tools. Recommended: none.',
      'jira: claude.ai, 1 tool. Recommended: none.',
    ]
    expect(mcpGroupContext(lines)).toEqual({
      title: 'MCP servers',
      lines: texts,
      kind: 'mcp-server',
      summary: '3 servers, 1 recommended',
      rows: plainRows(texts),
    })
  })
})

/** The texts the pane draws for the rows of `context`, its title left out (paneDrawn, D-313). */
function drawnLines(context: AskContext): string[] {
  const block = { title: context.title, summary: null, rows: context.rows ?? [], lines: [] }

  return paneDrawn(block, null)
    .slice(1)
    .map(row => row.spans.map(span => span.text).join(''))
}

describe('rows from the same data as lines (D-313, D-323)', () => {
  test('every assignment context draws as rows the same words its lines hold, a row per line', () => {
    const contexts = [
      mcpServerContext(GITHUB, TOOLS, ['be', 'qa'], SCREEN_LIST_WORDS),
      mcpServerContext({ name: 'sentry', source: 'session' }, TOOLS, [], SCREEN_LIST_WORDS),
      skillGroupContext('codex', SKILLS),
      ...SKILLS.map((skill, at) => skillContext(skill, at + 1, SKILLS.length)),
      mcpGroupContext([{ name: 'github', source: 'session', tools: 2, recommended: ['tl'] }]),
    ]
    for (const context of contexts) expect(drawnLines(context)).toEqual(context.lines)
  })
})
