import { describe, expect, test } from 'claude-code/testing'

import type { McpRef, RoleSpec, SkillRef } from '../../types'
import { adapterOf, ADAPTERS } from '../framework/registry'
import {
  INFRA_MCP_SERVERS,
  INFRA_PLUGINS,
  INFRA_SKILLS,
  INFRA_TOOLS,
  MCP_ROLE_ROWS,
  SKILL_ROLE_ROWS,
} from '../roles/infra'
import { PM, role, TL } from '../testkit'
import { assignToRoles, mcpQuestion, parseRoleList, skillGroupQuestion } from './answers'
import { classifyMcp, classifySkills, groupUses, orderGroupsByUse } from './assign-rules'
import type { SkillGroup } from './assign-rules'

const BE = role('be', 'be')
const FE = role('fe', 'fe')
const QA = role('qa', 'qa')
const SECURITY = role('security', 'security')

/** The six template roles in template order. */
const TEAM: readonly RoleSpec[] = [PM, TL, BE, FE, QA, SECURITY]

/** A server the session lists. */
function server(name: string): McpRef {
  return { name, source: 'session' }
}

/** The ids of the roles a name was assigned to, or null when the classifier did not assign it. */
function assignedTo(name: string, roles: readonly RoleSpec[]): readonly string[] | null {
  const found = classifyMcp([server(name)], roles).assigned.find(row => row.name === name)

  return found === undefined ? null : found.roleIds
}

/** A skill the session lists; `plugin` is null for a user or project skill. */
function skill(name: string, plugin: string | null = null): SkillRef {
  return { name, plugin }
}

/** The ids of the roles a skill was assigned to by the table, or null when the classifier did not assign it. */
function skillAssignedTo(name: string, roles: readonly RoleSpec[]): readonly string[] | null {
  const found = classifySkills([skill(name)], roles).assigned.find(row => row.name === name)

  return found === undefined ? null : found.roleIds
}

describe('MCP assignment', () => {
  test('known servers go to the roles the table names, sorted, and only an unknown one is left to ask about', () => {
    const scanned: readonly McpRef[] = [
      { name: 'jira', source: 'session' },
      { name: 'playwright', source: 'project' },
      { name: 'github', source: 'session' },
      { name: 'sentry', source: 'user-config' },
      { name: 'autopilot', source: 'session' },
    ]

    expect(classifyMcp(scanned, TEAM)).toEqual({
      assigned: [
        { name: 'github', roleIds: ['tl'] },
        { name: 'jira', roleIds: ['pm', 'tl'] },
        { name: 'playwright', roleIds: ['fe', 'qa'] },
      ],
      unknown: ['sentry'],
    })
  })

  test('the autopilot server is never assigned and never asked about, with or without roles', () => {
    expect(classifyMcp([server('autopilot')], TEAM)).toEqual({ assigned: [], unknown: [] })
    expect(classifyMcp([server('autopilot')], [])).toEqual({ assigned: [], unknown: [] })
  })

  test('INFRA_MCP_SERVERS names the autopilot server and is frozen', () => {
    expect(INFRA_MCP_SERVERS).toEqual(['autopilot'])
    expect(Object.isFrozen(INFRA_MCP_SERVERS)).toBe(true)
  })

  test('a row whose roles are all absent leaves the server unknown', () => {
    expect(classifyMcp([server('playwright')], [PM, BE])).toEqual({ assigned: [], unknown: ['playwright'] })
  })

  test('only the roles of a row that are present get the server', () => {
    expect(assignedTo('jira', [PM, BE])).toEqual(['pm'])
  })

  test('a custom role is present through its basedOn, and any role through its own id', () => {
    const roles = [PM, role('web', 'fe'), role('tester', 'qa'), role('qa', null)]

    expect(assignedTo('playwright', roles)).toEqual(['qa', 'tester', 'web'])
  })

  test('the table matches whole words of a name in any case', () => {
    const table: readonly (readonly [string, readonly string[] | null])[] = [
      ['jira', ['pm', 'tl']],
      ['Jira-Cloud', ['pm', 'tl']],
      ['mcp_linear', ['pm', 'tl']],
      ['NOTION', ['pm', 'tl']],
      ['atlassian-jira-mcp', ['pm', 'tl']],
      ['playwright', ['fe', 'qa']],
      ['chrome-devtools', ['fe', 'qa']],
      ['DevTools', ['fe', 'qa']],
      ['github', ['tl']],
      ['github-enterprise', ['tl']],
      ['my_github', ['tl']],
      ['jiralike', null],
      ['githubby', null],
      ['notional', null],
      ['sentry', null],
    ]

    for (const [name, expected] of table) expect([name, assignedTo(name, TEAM)]).toEqual([name, expected])
  })

  test('the first matching row wins when a name fits two rows', () => {
    expect(assignedTo('playwright-github', TEAM)).toEqual(['fe', 'qa'])
    expect(assignedTo('github-jira', TEAM)).toEqual(['pm', 'tl'])
  })

  test('a server seen twice is assigned once, and an unknown one is asked once', () => {
    const scanned: readonly McpRef[] = [
      { name: 'jira', source: 'project' },
      { name: 'jira', source: 'session' },
      { name: 'sentry', source: 'project' },
      { name: 'sentry', source: 'user-config' },
    ]

    expect(classifyMcp(scanned, TEAM)).toEqual({
      assigned: [{ name: 'jira', roleIds: ['pm', 'tl'] }],
      unknown: ['sentry'],
    })
  })

  test('names and role ids come out sorted whatever the order of the scan and of the roles', () => {
    const scanned = ['zeta', 'playwright', 'beta', 'jira', 'Alpha', 'github'].map(server)
    const result = classifyMcp(scanned, [TL, QA, PM, FE])

    expect(result.unknown).toEqual(['Alpha', 'beta', 'zeta'])
    expect(result.assigned).toEqual([
      { name: 'github', roleIds: ['tl'] },
      { name: 'jira', roleIds: ['pm', 'tl'] },
      { name: 'playwright', roleIds: ['fe', 'qa'] },
    ])
  })

  test('with no servers there is nothing to assign or ask, and with no roles every server is unknown', () => {
    expect(classifyMcp([], TEAM)).toEqual({ assigned: [], unknown: [] })
    expect(classifyMcp([server('jira'), server('sentry')], [])).toEqual({ assigned: [], unknown: ['jira', 'sentry'] })
  })

  test('MCP_ROLE_ROWS and every row, with its roles, are frozen', () => {
    expect(Object.isFrozen(MCP_ROLE_ROWS)).toBe(true)
    expect(MCP_ROLE_ROWS.every(row => Object.isFrozen(row))).toBe(true)
    expect(MCP_ROLE_ROWS.every(row => Object.isFrozen(row.roles))).toBe(true)
  })

  test('MCP_ROLE_ROWS names the roles of the three rows in order, each with a label', () => {
    expect(MCP_ROLE_ROWS.map(row => row.roles)).toEqual([['pm', 'tl'], ['fe', 'qa'], ['tl']])
    expect(MCP_ROLE_ROWS.every(row => row.label.trim() !== '')).toBe(true)
    expect(new Set(MCP_ROLE_ROWS.map(row => row.label)).size).toBe(MCP_ROLE_ROWS.length)
  })

  test('the whole path: the table assigns what it knows, the answer to the question assigns the rest', () => {
    const scanned = ['jira', 'playwright', 'github', 'sentry', 'autopilot'].map(server)
    const classified = classifyMcp(scanned, TEAM)
    expect(classified.unknown.map(mcpQuestion)).toEqual([
      'Which roles get the sentry MCP server? (e.g. BE, QA, or none)',
    ])

    const answer = parseRoleList('BE, qa', TEAM)
    expect(answer).toEqual(['be', 'qa'])
    const assignments = [...classified.assigned, { name: 'sentry', roleIds: answer ?? [] }]
    const result = assignToRoles(TEAM, assignments, 'mcp')

    expect(result.map(row => [row.id, row.mcp])).toEqual([
      ['pm', ['jira']],
      ['tl', ['github', 'jira']],
      ['be', ['sentry']],
      ['fe', ['playwright']],
      ['qa', ['playwright', 'sentry']],
      ['security', []],
    ])
  })
})

describe('skill assignment', () => {
  test('the infra lists are the ones D-77 names, in order, and frozen', () => {
    expect(INFRA_PLUGINS).toEqual(['autopilot@local-mods', 'agent-fleet@local-mods', 'cadre@local-mods'])
    expect(INFRA_SKILLS).toEqual(['create-handoff-doc', 'resume-handoff-doc'])
    expect(INFRA_TOOLS).toEqual([
      'mcp__autopilot__restart_session',
      'mcp__autopilot__wait_for',
      'mcp__autopilot__queue_question',
      'Skill',
      'PushNotification',
    ])
    expect([INFRA_PLUGINS, INFRA_SKILLS, INFRA_TOOLS].every(list => Object.isFrozen(list))).toBe(true)
  })

  test('the adapters name the start skills of each framework, none for the built-in one, all frozen', () => {
    expect(adapterOf('gsd').startSkills).toEqual([
      'gsd-autonomous',
      'gsd-discuss-phase',
      'gsd-plan-phase',
      'gsd-execute-phase',
      'gsd-validate-phase',
      'gsd-code-review',
    ])
    expect(adapterOf('superpowers').startSkills).toEqual([
      'superpowers:brainstorming',
      'superpowers:writing-plans',
      'superpowers:executing-plans',
      'superpowers:subagent-driven-development',
    ])
    expect(adapterOf('none').startSkills).toEqual([])
    expect(ADAPTERS.every(adapter => Object.isFrozen(adapter) && Object.isFrozen(adapter.startSkills))).toBe(true)
  })

  test('a gsd- skill belongs to gsd, and a superpowers skill to superpowers', () => {
    expect(adapterOf('gsd').ownsSkill(skill('gsd-plan-phase'))).toBe(true)
    expect(adapterOf('superpowers').ownsSkill(skill('superpowers:brainstorming', 'superpowers'))).toBe(true)
    expect(adapterOf('superpowers').ownsSkill(skill('superpowers:brainstorming'))).toBe(true)
    expect(adapterOf('superpowers').ownsSkill(skill('brainstorming', 'superpowers'))).toBe(true)
  })

  test('a skill of one framework is not one of the other, and gsd- must start the name', () => {
    expect(adapterOf('superpowers').ownsSkill(skill('gsd-plan-phase'))).toBe(false)
    expect(adapterOf('gsd').ownsSkill(skill('superpowers:brainstorming', 'superpowers'))).toBe(false)
    expect(adapterOf('gsd').ownsSkill(skill('my-gsd-tool'))).toBe(false)
    expect(adapterOf('gsd').ownsSkill(skill('gsdx'))).toBe(false)
  })

  test('with framework none no skill is a framework skill', () => {
    expect(adapterOf('none').ownsSkill(skill('gsd-plan-phase'))).toBe(false)
    expect(adapterOf('none').ownsSkill(skill('superpowers:brainstorming', 'superpowers'))).toBe(false)
    expect(adapterOf('none').ownsSkill(skill('my-skill'))).toBe(false)
  })

  test('table skills go to their roles, infra and framework skills are skipped, the rest are grouped by plugin', () => {
    const skills = [
      skill('security-review'),
      skill('frontend-design', 'frontend'),
      skill('create-handoff-doc'),
      skill('gsd-plan-phase'),
      skill('superpowers:brainstorming', 'superpowers'),
      skill('codex:rescue', 'codex'),
      skill('codex:setup', 'codex'),
      skill('my-skill'),
    ]

    expect(classifySkills(skills, TEAM)).toEqual({
      assigned: [
        { name: 'frontend-design', roleIds: ['fe'] },
        { name: 'security-review', roleIds: ['security'] },
      ],
      groups: [
        { label: 'codex', plugin: 'codex', names: ['codex:rescue', 'codex:setup'] },
        { label: 'your own', plugin: null, names: ['my-skill'] },
      ],
    })
  })

  test('the handoff skills are neither assigned nor asked about, with or without roles', () => {
    const handoff = [skill('create-handoff-doc'), skill('resume-handoff-doc')]

    expect(classifySkills(handoff, TEAM)).toEqual({ assigned: [], groups: [] })
    expect(classifySkills(handoff, [])).toEqual({ assigned: [], groups: [] })
  })

  test('gsd and superpowers skills are never asked about, whichever framework the roles use', () => {
    const skills = [skill('gsd-plan-phase'), skill('gsd-ns-context'), skill('superpowers:writing-plans', 'superpowers')]

    expect(classifySkills(skills, TEAM)).toEqual({ assigned: [], groups: [] })
  })

  test('the table sends security-review to security and frontend and design skills to fe', () => {
    const table: readonly (readonly [string, readonly string[] | null])[] = [
      ['security-review', ['security']],
      ['pkg:security-review', ['security']],
      ['security-review-extra', null],
      ['frontend-design', ['fe']],
      ['frontend-design:frontend-design', ['fe']],
      ['frontend', ['fe']],
      ['design', ['fe']],
      ['ui-ux', ['fe']],
      ['UI-Design', ['fe']],
      ['web-design-guidelines', ['fe']],
      ['redesign', null],
      ['designer', null],
      ['my-skill', null],
    ]

    for (const [name, expected] of table) expect([name, skillAssignedTo(name, TEAM)]).toEqual([name, expected])
  })

  test('a table skill whose roles are all absent is asked in its group', () => {
    expect(classifySkills([skill('security-review')], [PM, BE])).toEqual({
      assigned: [],
      groups: [{ label: 'your own', plugin: null, names: ['security-review'] }],
    })
    expect(classifySkills([skill('frontend-design', 'frontend')], [PM, BE])).toEqual({
      assigned: [],
      groups: [{ label: 'frontend', plugin: 'frontend', names: ['frontend-design'] }],
    })
  })

  test('a custom role based on fe or security receives the table skills', () => {
    const roles = [PM, role('web', 'fe'), role('auditor', 'security')]

    expect(classifySkills([skill('security-review'), skill('frontend-design')], roles).assigned).toEqual([
      { name: 'frontend-design', roleIds: ['web'] },
      { name: 'security-review', roleIds: ['auditor'] },
    ])
  })

  test('groups are sorted by label with your own last, and the names in a group are sorted', () => {
    const skills = [
      skill('zed', 'zeta'),
      skill('own-b'),
      skill('beta:x', 'beta'),
      skill('own-a'),
      skill('alpha:z', 'alpha'),
      skill('alpha:a', 'alpha'),
    ]

    expect(classifySkills(skills, TEAM).groups).toEqual([
      { label: 'alpha', plugin: 'alpha', names: ['alpha:a', 'alpha:z'] },
      { label: 'beta', plugin: 'beta', names: ['beta:x'] },
      { label: 'zeta', plugin: 'zeta', names: ['zed'] },
      { label: 'your own', plugin: null, names: ['own-a', 'own-b'] },
    ])
  })

  test('user and project skills share one group, and a skill seen twice counts once', () => {
    const skills = ['b-skill', 'a-skill', 'b-skill', 'security-review', 'security-review'].map(name => skill(name))

    expect(classifySkills(skills, [PM, SECURITY])).toEqual({
      assigned: [{ name: 'security-review', roleIds: ['security'] }],
      groups: [{ label: 'your own', plugin: null, names: ['a-skill', 'b-skill'] }],
    })
  })

  test('a skill of the same name from two plugins is asked in both groups, and each group counts it', () => {
    const skills = [skill('lint', 'alpha'), skill('lint', 'beta'), skill('lint', 'alpha'), skill('lint')]

    expect(classifySkills(skills, TEAM).groups).toEqual([
      { label: 'alpha', plugin: 'alpha', names: ['lint'] },
      { label: 'beta', plugin: 'beta', names: ['lint'] },
      { label: 'your own', plugin: null, names: ['lint'] },
    ])
  })

  test('a table skill from two plugins is assigned once by name', () => {
    const skills = [skill('security-review', 'alpha'), skill('security-review', 'beta')]

    expect(classifySkills(skills, TEAM).assigned).toEqual([{ name: 'security-review', roleIds: ['security'] }])
  })

  test('the security-review row ignores case like the other rows', () => {
    expect(classifySkills([skill('Security-Review')], TEAM).assigned).toEqual([
      { name: 'Security-Review', roleIds: ['security'] },
    ])
  })

  test('the security-review row takes security-review as the whole last word, after a plugin or a dash', () => {
    const matching = ['security-review', 'SECURITY-REVIEW', 'acme:security-review', 'my-security-review']
    const other = ['security-reviewer', 'notsecurity-review', 'security-review-x', 'review', '']
    const row = SKILL_ROLE_ROWS[0]

    expect(matching.filter(name => row?.pattern.test(name) !== true)).toEqual([])
    expect(other.filter(name => row?.pattern.test(name) === true)).toEqual([])
  })

  test('an installed claude-security skill goes to Security with no question (decision #39)', () => {
    expect(classifySkills([skill('claude-security:claude-security', 'claude-security')], TEAM)).toEqual({
      assigned: [{ name: 'claude-security:claude-security', roleIds: ['security'] }],
      groups: [],
    })
  })

  test('with no skills there is nothing to assign or ask', () => {
    expect(classifySkills([], TEAM)).toEqual({ assigned: [], groups: [] })
  })

  test('SKILL_ROLE_ROWS and every row, with its roles, are frozen', () => {
    expect(Object.isFrozen(SKILL_ROLE_ROWS)).toBe(true)
    expect(SKILL_ROLE_ROWS.every(row => Object.isFrozen(row))).toBe(true)
    expect(SKILL_ROLE_ROWS.every(row => Object.isFrozen(row.roles))).toBe(true)
  })

  test('SKILL_ROLE_ROWS names the roles of the three rows in order, each with a label', () => {
    expect(SKILL_ROLE_ROWS.map(row => row.roles)).toEqual([['security'], ['security'], ['fe']])
    expect(SKILL_ROLE_ROWS.every(row => row.label.trim() !== '')).toBe(true)
    expect(new Set(SKILL_ROLE_ROWS.map(row => row.label)).size).toBe(SKILL_ROLE_ROWS.length)
  })
})

describe('history hints', () => {
  const CODEX: SkillGroup = { label: 'codex', plugin: 'codex', names: ['codex:rescue', 'codex:setup'] }
  const ALPHA: SkillGroup = { label: 'alpha', plugin: 'alpha', names: ['alpha:x'] }
  const OWN: SkillGroup = { label: 'your own', plugin: null, names: ['my-skill'] }
  /** The three groups in the 02-07 order: by label, with the user's own skills last. */
  const GROUPS: readonly SkillGroup[] = [ALPHA, CODEX, OWN]

  test('groupUses sums the counts of the names in a group; a name the history does not have counts 0', () => {
    const counts = new Map([
      ['codex:rescue', 7],
      ['codex:setup', 5],
      ['other', 9],
    ])
    expect(groupUses(CODEX, counts)).toBe(12)
    expect(groupUses(ALPHA, counts)).toBe(0)
    expect(groupUses(CODEX, new Map())).toBe(0)
  })

  test('skillGroupQuestion shows the uses before the hint; no uses, or 0, keeps the 02-07 text exactly', () => {
    expect(skillGroupQuestion(CODEX, 12)).toBe(
      'Which roles get codex skills (2)? (used 12 times in recent sessions) (e.g. BE, QA, or none)',
    )
    expect(skillGroupQuestion(CODEX)).toBe('Which roles get codex skills (2)? (e.g. BE, QA, or none)')
    expect(skillGroupQuestion(CODEX, 0)).toBe('Which roles get codex skills (2)? (e.g. BE, QA, or none)')
  })

  test('one use is singular', () => {
    expect(skillGroupQuestion(OWN, 1)).toBe(
      'Which roles get your own skills (1)? (used 1 time in recent sessions) (e.g. BE, QA, or none)',
    )
  })

  test('orderGroupsByUse puts the busiest group first, and equal uses keep the 02-07 order', () => {
    const counts = new Map([
      ['my-skill', 5],
      ['codex:rescue', 2],
      ['codex:setup', 1],
    ])
    expect(orderGroupsByUse(GROUPS, counts)).toEqual([OWN, CODEX, ALPHA])
    const tied = new Map([
      ['my-skill', 3],
      ['alpha:x', 3],
    ])
    expect(orderGroupsByUse(GROUPS, tied)).toEqual([ALPHA, OWN, CODEX])
  })

  test('with no counts orderGroupsByUse gives the 02-07 order, and it never changes the list it is given', () => {
    const before = JSON.stringify(GROUPS)
    expect(orderGroupsByUse(GROUPS, new Map())).toEqual([ALPHA, CODEX, OWN])
    expect(orderGroupsByUse(GROUPS, new Map([['my-skill', 9]]))).toEqual([OWN, ALPHA, CODEX])
    expect(JSON.stringify(GROUPS)).toBe(before)
  })

  test('groupUses finds the count of a skill name with capital letters under its lowercase form (WR-02)', () => {
    const mixed: SkillGroup = { label: 'your own', plugin: null, names: ['MySkill'] }
    expect(groupUses(mixed, new Map([['myskill', 10]]))).toBe(10)
  })

  test('orderGroupsByUse puts a busy group first when its skill name has capital letters (WR-02)', () => {
    const mixed: SkillGroup = { label: 'your own', plugin: null, names: ['MySkill'] }
    expect(orderGroupsByUse([ALPHA, CODEX, mixed], new Map([['myskill', 10]]))).toEqual([mixed, ALPHA, CODEX])
  })
})

describe('infra plugins by name (D-252)', () => {
  test('classifySkills skips the skills of an infra plugin under any marketplace; others keep their group', () => {
    const skills = [skill('fleet', 'agent-fleet@elsewhere'), skill('fleet-status', 'agent-fleet@elsewhere')]
    expect(classifySkills([...skills, skill('codex:rescue', 'codex')], TEAM)).toEqual({
      assigned: [],
      groups: [{ label: 'codex', plugin: 'codex', names: ['codex:rescue'] }],
    })
  })
})
