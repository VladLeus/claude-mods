import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, ContextRow, McpRef, RoleSpec } from '../../../types'
import { SCREEN_LIST_WORDS } from '../../locales/t'
import { templateRole } from '../../testkit'
import { paneDrawn } from '../pane'
import {
  mcpGroupContext,
  mcpServerContext,
  mcpSourceText,
  mcpToolNamesOf,
  ownSkillsContext,
  skillContext,
  skillGroupContext,
  skillItemRows,
} from './assign'
import type { McpLine, SkillLine } from './assign'

/** A server of the repo's `.mcp.json`. */
const GITHUB: McpRef = { name: 'github', source: 'project' }

/** The session's tool names: two of github, one of another server, and a built-in tool. */
const TOOLS = ['mcp__github__list_prs', 'mcp__github__create_issue', 'mcp__gitlab__merge', 'Read']

/** The item rows of one skill or server (D-311): `name → roles`, then its description or the placeholder. */
function itemOf(name: string, roles: string, description: string | null): ContextRow[] {
  const about: ContextRow =
    description === null
      ? { role: 'placeholder', text: 'no description', indent: 4 }
      : { role: 'description', text: description, indent: 4 }

  return [{ role: 'item', label: name, text: roles, indent: 2 }, about]
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

  test('a server the session lists no tool for reads not connected, and no recommendation reads none (D-317)', () => {
    const sentry = mcpServerContext({ name: 'sentry', source: 'session' }, TOOLS, [], SCREEN_LIST_WORDS)
    expect(sentry.lines).toEqual(['Source: session', 'Tools: not connected, tools unknown', 'Recommended: none'])
    expect(sentry).toMatchObject({ summary: 'Recommended: none' })
    expect(sentry.rows?.[0]?.rows[1]).toEqual({
      role: 'field',
      label: 'Tools',
      text: 'not connected, tools unknown',
      indent: 0,
    })
  })

  test('a claude_ai_ server reads claude.ai whatever list found it (D-317, D-331)', () => {
    const refs: readonly McpRef[] = [
      { name: 'claude_ai_Gmail', source: 'user-config' },
      { name: 'claude_ai_Notion', source: 'project' },
      { name: 'claude_ai_Slack', source: 'session' },
    ]
    expect(refs.map(mcpSourceText)).toEqual(['claude.ai', 'claude.ai', 'claude.ai'])
    const gmail = mcpServerContext({ name: 'claude_ai_Gmail', source: 'user-config' }, TOOLS, [], SCREEN_LIST_WORDS)
    expect(gmail.lines).toEqual(['Source: claude.ai', 'Tools: not connected, tools unknown', 'Recommended: none'])
  })

  test('the not-connected tools row and line keep their text, the row built from its own value (N-06)', () => {
    const jira = mcpServerContext({ name: 'jira', source: 'user-config' }, [], [], SCREEN_LIST_WORDS)
    expect(jira.rows?.[0]?.rows[1]).toEqual({
      role: 'field',
      label: 'Tools',
      text: 'not connected, tools unknown',
      indent: 0,
    })
    expect(jira.lines[1]).toBe('Tools: not connected, tools unknown')
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

/** Two skills of a group: one with a description and uses, one with no description (a null purpose) and no uses. */
const SKILLS: readonly SkillLine[] = [
  { name: 'codex:rescue', purpose: 'Delegate a stuck task', uses: '3 times in the last 50 sessions', recommended: [] },
  { name: 'codex:setup', purpose: null, uses: '', recommended: ['be'] },
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
      rows: [
        {
          title: null,
          rows: [
            ...itemOf('codex:rescue', 'none', 'Delegate a stuck task. Used 3 times in the last 50 sessions.'),
            ...itemOf('codex:setup', 'be', null),
          ],
        },
      ],
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
      rows: [
        {
          title: null,
          rows: itemOf('codex:rescue', 'none', 'Delegate a stuck task. Used 3 times in the last 50 sessions.'),
        },
      ],
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
      rows: [{ title: null, rows: itemOf(`${'n'.repeat(59)}…`, 'qa', 'Do it.') }],
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

  test('a purpose of 230 characters is shown whole in the line and the rows, a key in it hidden (D-312, D-330)', () => {
    const key = ['sk', 'FAKE0123456789abcdef'].join('-')
    const words = 'word '.repeat(40)
    const purpose = `${words}${key} sevens`
    const skill: SkillLine = { name: 'deploy', purpose, uses: '', recommended: [] }
    const shownPurpose = `${words}[hidden] sevens.`
    const context = skillContext(skill, 1, 1)
    expect([Array.from(purpose).length, context.lines]).toEqual([
      230,
      [`deploy: ${shownPurpose} Recommended: none.`],
    ])
    expect(context.rows?.[0]?.rows[1]).toEqual({ role: 'description', text: shownPurpose, indent: 4 })
  })

  test('the pane wraps a long description under its item with a hanging indent, never cutting it (D-312)', () => {
    const purpose = 'word '.repeat(46).trim()
    const rows = skillContext({ name: 'deploy', purpose, uses: '', recommended: [] }, 1, 1).rows ?? []
    const drawn = paneDrawn({ title: 'T', summary: null, rows, lines: [] }, 60)
      .slice(2)
      .map(row => row.spans.map(span => span.text).join(''))
    expect(drawn.every(row => row.startsWith('    ') && Array.from(row).length <= 60)).toBe(true)
    expect(drawn.join(' ').split(' ').filter(word => word !== '')).toEqual(`${purpose}.`.split(' '))
  })
})

describe('mcpGroupContext (D-250, D-309, D-333)', () => {
  /** BE, FE and QA. */
  const ROLES: readonly RoleSpec[] = [templateRole('be'), templateRole('fe'), templateRole('qa')]

  /** A server of the list as an item row with no roles, which the pane draws as its name alone (D-309). */
  const listed = (label: string): ContextRow => ({ role: 'item', label, text: '', indent: 2 })

  /** An MCP line of `name`, connected with one tool and no recommendation unless `over` says otherwise. */
  const line = (name: string, over: Partial<McpLine> = {}): McpLine => ({
    name,
    source: 'session',
    tools: 1,
    recommended: [],
    isConnected: true,
    isConnector: false,
    ...over,
  })

  test('the question for all the servers lists each with its source, its tool count and its recommended roles', () => {
    const lines = [
      line('github', { tools: 2, recommended: ['tl'] }),
      line('sentry', { source: '.mcp.json', tools: 0, isConnected: false }),
      line('jira', { source: 'claude.ai', isConnector: true }),
    ]
    const texts = [
      'github: session, 2 tools. Recommended: tl.',
      'sentry: .mcp.json, 0 tools. Recommended: none.',
      'jira: claude.ai, 1 tool. Recommended: none.',
    ]
    expect(mcpGroupContext(lines, [...ROLES, templateRole('tl')])).toEqual({
      title: 'MCP servers',
      lines: texts,
      kind: 'mcp-server',
      summary: '3 servers, 1 recommended',
      rows: [
        { title: 'tl: Team Lead', rows: [listed('github')] },
        { title: 'Not recommended', rows: [listed('sentry (not connected)'), listed('jira (claude.ai)')] },
      ],
    })
  })

  test('a section per role in team order holds each server recommended for it, then Not recommended', () => {
    const lines = [
      line('a', { recommended: ['be', 'fe'] }),
      line('b'),
      line('c', { recommended: ['qa'] }),
      line('d', { tools: 0, isConnected: false }),
    ]
    expect(mcpGroupContext(lines, ROLES).rows).toEqual([
      { title: 'be: BE', rows: [listed('a')] },
      { title: 'fe: FE', rows: [listed('a')] },
      { title: 'qa: QA', rows: [listed('c')] },
      { title: 'Not recommended', rows: [listed('b'), listed('d (not connected)')] },
    ])
    const recommended = mcpGroupContext([line('a', { recommended: ['fe'] })], ROLES).rows
    expect(recommended).toEqual([{ title: 'fe: FE', rows: [listed('a')] }])
  })

  test('a connector is tagged claude.ai, also not connected when the session lists no tool for it', () => {
    const lines = [
      line('claude_ai_Gmail', { isConnector: true }),
      line('claude_ai_Notion', { isConnector: true, tools: 0, isConnected: false }),
      line('jira'),
    ]
    expect(mcpGroupContext(lines, ROLES).rows).toEqual([
      {
        title: 'Not recommended',
        rows: [
          listed('claude_ai_Gmail (claude.ai)'),
          listed('claude_ai_Notion (claude.ai, not connected)'),
          listed('jira'),
        ],
      },
    ])
  })

  test('the pane draws each server of the list as its name alone, under its section titles', () => {
    const lines = [line('a', { recommended: ['be'] }), line('d', { tools: 0, isConnected: false })]
    const drawn = drawnLines(mcpGroupContext(lines, ROLES))
    expect(drawn).toEqual(['be: BE', '  a', '', 'Not recommended', '  d (not connected)'])
  })

  test("a role section's title hides a secret-like span of the role title (N-05, E1)", () => {
    const ops: RoleSpec = { ...templateRole('be'), title: 'Ops ghp_FAKEFAKEFAKEFAKEFAKE' }
    const rows = mcpGroupContext([line('a', { recommended: ['be'] })], [ops]).rows ?? []
    expect(rows[0]?.title).toBe('be: Ops [hidden]')
    expect(JSON.stringify(rows)).not.toContain('ghp_FAKE')
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
  test('a server question draws as rows the same words its lines hold, a row per line', () => {
    const contexts = [
      mcpServerContext(GITHUB, TOOLS, ['be', 'qa'], SCREEN_LIST_WORDS),
      mcpServerContext({ name: 'sentry', source: 'session' }, TOOLS, [], SCREEN_LIST_WORDS),
    ]
    for (const context of contexts) expect(drawnLines(context)).toEqual(context.lines)
  })
})

describe('skills and servers as item rows (D-311)', () => {
  test('a skill with no description has the placeholder, then its uses on a row of their own', () => {
    const used = { name: 'codex:setup', purpose: null, uses: '2 times in the last 50 sessions' }
    const skill: SkillLine = { ...used, recommended: [] }
    expect(skillContext(skill, 1, 1).rows).toEqual([
      {
        title: null,
        rows: [
          ...itemOf('codex:setup', 'none', null),
          { role: 'description', text: 'Used 2 times in the last 50 sessions.', indent: 4 },
        ],
      },
    ])
  })

  test('the pane draws a group as `name → roles` rows, each description under its item, uncut', () => {
    const drawn = drawnLines(skillGroupContext('codex', SKILLS))
    expect(drawn).toEqual([
      '  codex:rescue → none',
      '    Delegate a stuck task. Used 3 times in the last 50 sessions.',
      '  codex:setup → be',
      '    no description',
    ])
  })
})

describe('skillItemRows (S-03)', () => {
  test('a name over 60 code points is cut to 60 in its item row', () => {
    const [item] = skillItemRows({ name: 'x'.repeat(70), purpose: 'Do it.', uses: '', recommended: [] })
    expect(item).toEqual({ role: 'item', label: `${'x'.repeat(59)}…`, text: 'none', indent: 2 })
  })

  test('a null purpose has the placeholder, then its uses on a row of their own', () => {
    const skill: SkillLine = {
      name: 'mine',
      purpose: null,
      uses: '2 times in the last 50 sessions',
      recommended: ['be'],
    }
    expect(skillItemRows(skill)).toEqual([
      { role: 'item', label: 'mine', text: 'be', indent: 2 },
      { role: 'placeholder', text: 'no description', indent: 4 },
      { role: 'description', text: 'Used 2 times in the last 50 sessions.', indent: 4 },
    ])
  })

  test('a real description reading No description. draws as a description, not the placeholder', () => {
    const skill: SkillLine = { name: 'mine', purpose: 'No description.', uses: '', recommended: [] }
    expect(skillItemRows(skill)).toEqual(itemOf('mine', 'none', 'No description.'))
  })

  test('a secret-like span of a description is hidden (E1)', () => {
    const skill: SkillLine = { name: 'mine', purpose: 'Calls with ghp_FAKEFAKEFAKEFAKEFAKE', uses: '', recommended: [] }
    expect(skillItemRows(skill)).toEqual(itemOf('mine', 'none', 'Calls with [hidden].'))
  })
})
