import { describe, expect, test } from 'claude-code/testing'

import type { McpRef, RoleSpec, SkillRef, TemplateRoleId } from '../types'
import {
  ALL_OPTION,
  assignToRoles,
  classifyMcp,
  classifySkills,
  FRAMEWORK_START_SKILLS,
  INFRA_MCP_SERVERS,
  INFRA_PLUGINS,
  INFRA_SKILLS,
  INFRA_TOOLS,
  isFrameworkSkill,
  MCP_ROLE_ROWS,
  mcpQuestion,
  NONE_OPTION,
  parseRoleList,
  SKILL_ROLE_ROWS,
  skillGroupQuestion,
} from './assign'
import type { SkillGroup } from './assign'

/** A role as init builds it: nothing assigned, every other field a default. `over` changes the fields it names. */
function role(id: string, basedOn: TemplateRoleId | null, over: Partial<RoleSpec> = {}): RoleSpec {
  return {
    id,
    title: id.toUpperCase(),
    purpose: 'p',
    basedOn,
    model: 'opus',
    effort: 'medium',
    permissionMode: 'auto',
    autopilot: { duration: '4h', threshold: 65, askUser: false },
    hasBash: true,
    mcp: [],
    skills: [],
    instructions: [],
    carry: { autoCompactWindow: false, statusLine: false, env: [], hooks: [] },
    ...over,
  }
}

const PM = role('pm', 'pm')
const TL = role('tl', 'tl', { title: 'Team Lead' })
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

  test('mcpQuestion words the question for one server', () => {
    expect(mcpQuestion('sentry')).toBe('Which roles get the sentry MCP server? (e.g. BE, QA, or none)')
  })

  test('mcpQuestion cleans a name with a bidi override or a line break', () => {
    const name = `sen${String.fromCodePoint(0x202e)}try\n`

    expect(mcpQuestion(name)).toBe('Which roles get the sentry MCP server? (e.g. BE, QA, or none)')
  })

  test('mcpQuestion cuts a name to 60 code points and ends it with an ellipsis', () => {
    expect(mcpQuestion('x'.repeat(100))).toBe(
      `Which roles get the ${'x'.repeat(59)}… MCP server? (e.g. BE, QA, or none)`,
    )
  })

  test('assignToRoles adds a name to exactly the roles it lists and leaves the other roles as they were', () => {
    const result = assignToRoles(TEAM, [{ name: 'jira', roleIds: ['pm', 'tl'] }], 'mcp')

    expect(result.map(row => [row.id, row.mcp])).toEqual([
      ['pm', ['jira']],
      ['tl', ['jira']],
      ['be', []],
      ['fe', []],
      ['qa', []],
      ['security', []],
    ])
    expect(result.slice(2)).toEqual([BE, FE, QA, SECURITY])
  })

  test('assignToRoles fills the field it is given and leaves the other field alone', () => {
    const roles = [role('security', 'security', { mcp: ['vault'] }), BE]

    const bySkills = assignToRoles(roles, [{ name: 'security-review', roleIds: ['security'] }], 'skills')
    expect(bySkills[0]?.skills).toEqual(['security-review'])
    expect(bySkills[0]?.mcp).toEqual(['vault'])

    const byMcp = assignToRoles(roles, [{ name: 'sentry', roleIds: ['be'] }], 'mcp')
    expect(byMcp[1]?.mcp).toEqual(['sentry'])
    expect(byMcp[1]?.skills).toEqual([])
  })

  test('assignToRoles never changes its input', () => {
    const roles = [PM, role('tl', 'tl', { mcp: ['notion'] })]
    const before = JSON.stringify(roles)

    assignToRoles(roles, [{ name: 'jira', roleIds: ['pm', 'tl'] }], 'mcp')

    expect(JSON.stringify(roles)).toBe(before)
  })

  test('a server assigned to two roles is in both lists, and no name moves from one role to another', () => {
    const roles = [PM, TL, role('be', 'be', { mcp: ['jira'] })]

    const result = assignToRoles(roles, [{ name: 'jira', roleIds: ['pm', 'tl'] }], 'mcp')

    expect(result.map(row => row.mcp)).toEqual([['jira'], ['jira'], ['jira']])
  })

  test('assignToRoles keeps each list sorted and without repeats, old names included', () => {
    const roles = [role('pm', 'pm', { mcp: ['mid', 'jira'] })]
    const assignments = [
      { name: 'zeta', roleIds: ['pm'] },
      { name: 'alpha', roleIds: ['pm'] },
      { name: 'jira', roleIds: ['pm'] },
      { name: 'alpha', roleIds: ['pm'] },
    ]

    expect(assignToRoles(roles, assignments, 'mcp')[0]?.mcp).toEqual(['alpha', 'jira', 'mid', 'zeta'])
  })

  test('assignToRoles ignores a role id that no role has, and with nothing to assign returns the same roles', () => {
    expect(assignToRoles(TEAM, [{ name: 'jira', roleIds: ['cto'] }], 'mcp')).toEqual(TEAM)
    expect(assignToRoles(TEAM, [], 'skills')).toEqual(TEAM)
    expect(assignToRoles([], [{ name: 'jira', roleIds: ['pm'] }], 'mcp')).toEqual([])
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

describe('parseRoleList', () => {
  test('NONE_OPTION and ALL_OPTION are the labels of the two buttons', () => {
    expect(NONE_OPTION).toBe('None')
    expect(ALL_OPTION).toBe('All roles')
  })

  test('role ids and titles in any case, separated by commas or spaces, give the role ids', () => {
    expect(parseRoleList('BE, qa', TEAM)).toEqual(['be', 'qa'])
    expect(parseRoleList('be qa', TEAM)).toEqual(['be', 'qa'])
    expect(parseRoleList('  Be ,QA,  security ', TEAM)).toEqual(['be', 'qa', 'security'])
    expect(parseRoleList('SECURITY', TEAM)).toEqual(['security'])
  })

  test('a multi-word title is matched on the whole answer, before the answer is split', () => {
    expect(parseRoleList('Team Lead', TEAM)).toEqual(['tl'])
    expect(parseRoleList(' team lead ', TEAM)).toEqual(['tl'])
    expect(parseRoleList('team', TEAM)).toBeNull()
  })

  test('none and the None button are no roles', () => {
    expect(parseRoleList('none', TEAM)).toEqual([])
    expect(parseRoleList('None', TEAM)).toEqual([])
    expect(parseRoleList(` ${NONE_OPTION.toUpperCase()} `, TEAM)).toEqual([])
  })

  test('all and the All roles button are every role id, in role order', () => {
    const roles = [TL, PM, BE]

    expect(parseRoleList('all', roles)).toEqual(['tl', 'pm', 'be'])
    expect(parseRoleList('All roles', roles)).toEqual(['tl', 'pm', 'be'])
    expect(parseRoleList('ALL ROLES', roles)).toEqual(['tl', 'pm', 'be'])
  })

  test('an unknown word, an empty answer or only separators is null, so the question is asked again', () => {
    expect(parseRoleList('be, cto', TEAM)).toBeNull()
    expect(parseRoleList('', TEAM)).toBeNull()
    expect(parseRoleList('   ', TEAM)).toBeNull()
    expect(parseRoleList(' , , ', TEAM)).toBeNull()
    expect(parseRoleList('everyone', TEAM)).toBeNull()
  })

  test('none or all mixed into a list of roles is null', () => {
    expect(parseRoleList('none, be', TEAM)).toBeNull()
    expect(parseRoleList('all, be', TEAM)).toBeNull()
  })

  test('a role named twice, or in another order, comes back once in role order', () => {
    expect(parseRoleList('qa, be, BE', TEAM)).toEqual(['be', 'qa'])
    expect(parseRoleList('security tl pm', TEAM)).toEqual(['pm', 'tl', 'security'])
  })

  test('a single-word title of a custom role matches that role, and an id wins over another role title', () => {
    const roles = [role('api', null, { title: 'Backend' }), role('tester', null, { title: 'qa' }), role('qa', null)]

    expect(parseRoleList('backend', roles)).toEqual(['api'])
    expect(parseRoleList('qa', roles)).toEqual(['qa'])
    expect(parseRoleList('tester, api', roles)).toEqual(['api', 'tester'])
  })

  test('with no roles, none and all give no roles and any role word is null', () => {
    expect(parseRoleList('none', [])).toEqual([])
    expect(parseRoleList('all', [])).toEqual([])
    expect(parseRoleList('be', [])).toBeNull()
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

  test('FRAMEWORK_START_SKILLS names the start skills of each framework, none for the built-in one, all frozen', () => {
    expect(FRAMEWORK_START_SKILLS.gsd).toEqual([
      'gsd-autonomous',
      'gsd-discuss-phase',
      'gsd-plan-phase',
      'gsd-execute-phase',
      'gsd-validate-phase',
      'gsd-code-review',
    ])
    expect(FRAMEWORK_START_SKILLS.superpowers).toEqual([
      'superpowers:brainstorming',
      'superpowers:writing-plans',
      'superpowers:executing-plans',
      'superpowers:subagent-driven-development',
    ])
    expect(FRAMEWORK_START_SKILLS.none).toEqual([])
    expect(Object.isFrozen(FRAMEWORK_START_SKILLS)).toBe(true)
    expect(Object.values(FRAMEWORK_START_SKILLS).every(list => Object.isFrozen(list))).toBe(true)
  })

  test('a gsd- skill belongs to gsd, and a superpowers skill to superpowers', () => {
    expect(isFrameworkSkill(skill('gsd-plan-phase'), 'gsd')).toBe(true)
    expect(isFrameworkSkill(skill('superpowers:brainstorming', 'superpowers'), 'superpowers')).toBe(true)
    expect(isFrameworkSkill(skill('superpowers:brainstorming'), 'superpowers')).toBe(true)
    expect(isFrameworkSkill(skill('brainstorming', 'superpowers'), 'superpowers')).toBe(true)
  })

  test('a skill of one framework is not one of the other, and gsd- must start the name', () => {
    expect(isFrameworkSkill(skill('gsd-plan-phase'), 'superpowers')).toBe(false)
    expect(isFrameworkSkill(skill('superpowers:brainstorming', 'superpowers'), 'gsd')).toBe(false)
    expect(isFrameworkSkill(skill('my-gsd-tool'), 'gsd')).toBe(false)
    expect(isFrameworkSkill(skill('gsdx'), 'gsd')).toBe(false)
  })

  test('with framework none no skill is a framework skill', () => {
    expect(isFrameworkSkill(skill('gsd-plan-phase'), 'none')).toBe(false)
    expect(isFrameworkSkill(skill('superpowers:brainstorming', 'superpowers'), 'none')).toBe(false)
    expect(isFrameworkSkill(skill('my-skill'), 'none')).toBe(false)
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

  test('with no skills there is nothing to assign or ask', () => {
    expect(classifySkills([], TEAM)).toEqual({ assigned: [], groups: [] })
  })

  test('skillGroupQuestion words the question with the label and the number of skills', () => {
    const group: SkillGroup = { label: 'codex', plugin: 'codex', names: ['codex:rescue', 'codex:setup'] }

    expect(skillGroupQuestion(group)).toBe('Which roles get codex skills (2)? (e.g. BE, QA, or none)')
    expect(skillGroupQuestion({ label: 'your own', plugin: null, names: ['my-skill'] })).toBe(
      'Which roles get your own skills (1)? (e.g. BE, QA, or none)',
    )
  })

  test('skillGroupQuestion cleans a label with a bidi override', () => {
    const label = `co${String.fromCodePoint(0x202e)}dex`
    const group: SkillGroup = { label, plugin: 'codex', names: ['codex:rescue'] }

    expect(skillGroupQuestion(group)).toBe('Which roles get codex skills (1)? (e.g. BE, QA, or none)')
  })

  test('SKILL_ROLE_ROWS and every row, with its roles, are frozen', () => {
    expect(Object.isFrozen(SKILL_ROLE_ROWS)).toBe(true)
    expect(SKILL_ROLE_ROWS.every(row => Object.isFrozen(row))).toBe(true)
    expect(SKILL_ROLE_ROWS.every(row => Object.isFrozen(row.roles))).toBe(true)
  })

  test('SKILL_ROLE_ROWS names the roles of the two rows in order, each with a label', () => {
    expect(SKILL_ROLE_ROWS.map(row => row.roles)).toEqual([['security'], ['fe']])
    expect(SKILL_ROLE_ROWS.every(row => row.label.trim() !== '')).toBe(true)
    expect(new Set(SKILL_ROLE_ROWS.map(row => row.label)).size).toBe(SKILL_ROLE_ROWS.length)
  })
})
