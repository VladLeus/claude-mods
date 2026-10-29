import { describe, expect, test } from 'claude-code/testing'

import type { RoleSpec, SkillRef, TemplateRoleId } from '../../types'
import {
  AUTOPILOT_THRESHOLD,
  DEFAULT_DURATION,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  DEFAULT_PERMISSION_MODE,
  EMPTY_CARRY,
} from '../roles/template'
import { HISTORY_MAX_SESSIONS } from '../scan/history'
import { BIDI_OVERRIDE } from '../testkit'
import {
  ALL_ENV_OPTION,
  ALL_OPTION,
  assignToRoles,
  cappedNames,
  EFFORTS,
  envQuestion,
  INSTRUCTION_LABELS,
  mcpQuestion,
  memoryQuestion,
  MODEL_EFFORT_OPTIONS,
  modelEffortRefusal,
  NO_SKILL_PURPOSE,
  NONE_OPTION,
  ownSkillLines,
  parseEnvNames,
  parseModelEffort,
  parseRoleList,
  PER_ROLE,
  SAME_FOR_ALL,
  skillGroupQuestion,
  skillUsesText,
} from './answers'
import type { SkillGroup } from './assign-rules'

/** A role as init builds it: nothing assigned, every other field a default. `over` changes the fields it names. */
function role(id: string, basedOn: TemplateRoleId | null, over: Partial<RoleSpec> = {}): RoleSpec {
  return {
    id,
    title: id.toUpperCase(),
    purpose: 'p',
    basedOn,
    model: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT,
    permissionMode: DEFAULT_PERMISSION_MODE,
    autopilot: { duration: DEFAULT_DURATION, threshold: AUTOPILOT_THRESHOLD, askUser: false },
    hasBash: true,
    mcp: [],
    skills: [],
    instructions: [],
    carry: EMPTY_CARRY,
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

describe('MCP assignment', () => {
  test('mcpQuestion words the question for one server', () => {
    expect(mcpQuestion('sentry')).toBe('Which roles get the sentry MCP server? (e.g. BE, QA, or none)')
  })

  test('mcpQuestion cleans a name with a bidi override or a line break', () => {
    const name = `sen${BIDI_OVERRIDE}try\n`

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

  test('each comma part may be a whole multi-word title, and a part that is not falls back to its words', () => {
    expect(parseRoleList('Team Lead, QA', TEAM)).toEqual(['tl', 'qa'])
    expect(parseRoleList('qa,team lead', TEAM)).toEqual(['tl', 'qa'])
    expect(parseRoleList('tl be', TEAM)).toEqual(['tl', 'be'])
    expect(parseRoleList('Team Lead, be qa', TEAM)).toEqual(['tl', 'be', 'qa'])
    expect(parseRoleList('Team Lead QA', TEAM)).toBeNull()
  })

  test('all and none keep their meaning inside a list, even when a role is titled so', () => {
    const roles = [role('x', null, { title: 'None' }), role('y', null, { title: 'All' }), BE]

    expect(parseRoleList('be, none', roles)).toBeNull()
    expect(parseRoleList('be all', roles)).toBeNull()
    expect(parseRoleList('be, all roles', roles)).toBeNull()
    expect(parseRoleList('none', roles)).toEqual([])
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
  test('skillGroupQuestion words the question with the label and the number of skills', () => {
    const group: SkillGroup = { label: 'codex', plugin: 'codex', names: ['codex:rescue', 'codex:setup'] }

    expect(skillGroupQuestion(group)).toBe('Which roles get codex skills (2)? (e.g. BE, QA, or none)')
    expect(skillGroupQuestion({ label: 'your own', plugin: null, names: ['my-skill'] })).toBe(
      'Which roles get your own skills (1)? (e.g. BE, QA, or none)',
    )
  })

  test('skillGroupQuestion cleans a label with a bidi override', () => {
    const label = `co${BIDI_OVERRIDE}dex`
    const group: SkillGroup = { label, plugin: 'codex', names: ['codex:rescue'] }

    expect(skillGroupQuestion(group)).toBe('Which roles get codex skills (1)? (e.g. BE, QA, or none)')
  })
})

describe('ownSkillLines', () => {
  /** Two of the user's own skills: one the engine described, one it did not (D-139). */
  const OWN_SKILLS: readonly SkillRef[] = [
    { name: 'deploy-notes', plugin: null, purpose: 'Write the release notes for a deploy.' },
    { name: 'my-skill', plugin: null },
  ]
  /** The first row of the block: what giving a skill means (G-02-1b). */
  const HEADING =
    'Skills with no plugin (a role given a skill can run it in its session; a role not given it cannot):'
  /** S1 (deploy-notes) recommended to BE and QA, S2 (my-skill) to no role. */
  const RECOMMENDED: ReadonlyMap<string, readonly string[]> = new Map([
    ['S1', ['be', 'qa']],
    ['S2', []],
  ])
  /** The rows of OWN_SKILLS and RECOMMENDED when no skill was used. */
  const UNUSED_ROWS = [
    HEADING,
    '  deploy-notes: Write the release notes for a deploy.',
    '    recommended: be, qa',
    '  my-skill: No description.',
    '    recommended: none',
  ]

  test('each skill shows its purpose, its own use count and the roles recommended for it, after the heading', () => {
    const uses = new Map([
      ['deploy-notes', 3],
      ['my-skill', 1],
    ])
    expect(ownSkillLines(OWN_SKILLS, uses, RECOMMENDED)).toEqual([
      HEADING,
      '  deploy-notes: Write the release notes for a deploy.',
      '    used 3 times in the last 50 sessions; recommended: be, qa',
      '  my-skill: No description.',
      '    used 1 time in the last 50 sessions; recommended: none',
    ])
  })

  test('the used part is left out for a count of 0 and when the history was not scanned', () => {
    expect(ownSkillLines(OWN_SKILLS, new Map(), RECOMMENDED)).toEqual(UNUSED_ROWS)
    expect(ownSkillLines(OWN_SKILLS, new Map([['deploy-notes', 0]]), RECOMMENDED)).toEqual(UNUSED_ROWS)
  })

  test("a skill's count is found under its name in ASCII lower case, the form the history scan keeps", () => {
    const mixed: readonly SkillRef[] = [{ name: 'MySkill', plugin: null }]
    expect(ownSkillLines(mixed, new Map([['myskill', 4]]), new Map([['S1', []]]))).toEqual([
      HEADING,
      '  MySkill: No description.',
      '    used 4 times in the last 50 sessions; recommended: none',
    ])
  })

  test('with no usable recommendation, an empty map, every skill shows none and a last row says so', () => {
    expect(ownSkillLines(OWN_SKILLS, new Map(), new Map())).toEqual([
      HEADING,
      '  deploy-notes: Write the release notes for a deploy.',
      '    recommended: none',
      '  my-skill: No description.',
      '    recommended: none',
      'The model gave no usable recommendation: no role gets a skill unless you pick one.',
    ])
  })

  test('the skills are S1, S2 by their place; a skill a usable map leaves out shows none, with no fallback row', () => {
    expect(ownSkillLines(OWN_SKILLS, new Map(), new Map([['S1', ['be', 'qa']]]))).toEqual(UNUSED_ROWS)
  })

  test('a skill with no description reads NO_SKILL_PURPOSE; the sessions named are those the history reads', () => {
    expect(NO_SKILL_PURPOSE).toBe('No description.')
    expect(skillUsesText(1)).toBe(`1 time in the last ${HISTORY_MAX_SESSIONS} sessions`)
    expect(skillUsesText(2)).toBe(`2 times in the last ${HISTORY_MAX_SESSIONS} sessions`)
  })
})

/** The question memoryQuestion words for the auto-memories, with `shown` between the brackets. */
function autoMemoryAsk(shown: string): string {
  return `Which roles get the auto-memories for this repo (${shown})? (e.g. PM, TL, or none)`
}

describe('answer parsers', () => {
  test('the model and effort options, the two shortcuts and the efforts are fixed and frozen', () => {
    expect(MODEL_EFFORT_OPTIONS).toEqual(['opus + medium', 'sonnet + medium', 'sonnet + high'])
    expect(SAME_FOR_ALL).toBe('Same for all roles')
    expect(PER_ROLE).toBe('Per role')
    expect(EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(Object.isFrozen(MODEL_EFFORT_OPTIONS)).toBe(true)
    expect(Object.isFrozen(EFFORTS)).toBe(true)
  })

  test('every model and effort button reads back as the model and effort it shows', () => {
    expect(MODEL_EFFORT_OPTIONS.map(option => parseModelEffort(option))).toEqual([
      { model: 'opus', effort: 'medium' },
      { model: 'sonnet', effort: 'medium' },
      { model: 'sonnet', effort: 'high' },
    ])
  })

  test('parseModelEffort reads a family alias and an effort, split by a plus or spaces, in any case', () => {
    expect(parseModelEffort('opus + medium')).toEqual({ model: 'opus', effort: 'medium' })
    expect(parseModelEffort('sonnet high')).toEqual({ model: 'sonnet', effort: 'high' })
    expect(parseModelEffort('haiku+low')).toEqual({ model: 'haiku', effort: 'low' })
    expect(parseModelEffort(' Opus + MEDIUM ')).toEqual({ model: 'opus', effort: 'medium' })
    expect(parseModelEffort('fable max')).toEqual({ model: 'fable', effort: 'max' })
    expect(parseModelEffort('opus  +  xhigh')).toEqual({ model: 'opus', effort: 'xhigh' })
  })

  test('parseModelEffort takes only a family alias: a typo, an effort or any other word is refused (A4)', () => {
    expect(parseModelEffort('sonet + high')).toBeNull()
    expect(parseModelEffort('high high')).toBeNull()
    expect(parseModelEffort('none + low')).toBeNull()
    expect(parseModelEffort('my-alias high')).toBeNull()
    expect(parseModelEffort(`${'a'.repeat(24)} low`)).toBeNull()
    expect(parseModelEffort('haiku+low')).toEqual({ model: 'haiku', effort: 'low' })
    expect(parseModelEffort('OPUS+max')).toEqual({ model: 'opus', effort: 'max' })
  })

  test('parseModelEffort refuses a pinned model id, which has digits', () => {
    expect(parseModelEffort('claude-opus-5-5 medium')).toBeNull()
    expect(parseModelEffort('opus5 high')).toBeNull()
  })

  test('parseModelEffort refuses an effort outside low, medium, high, xhigh and max', () => {
    expect(parseModelEffort('opus extreme')).toBeNull()
    expect(parseModelEffort('opus 3')).toBeNull()
    expect(parseModelEffort('opus none')).toBeNull()
  })

  test('parseModelEffort refuses a model alone, an effort alone, empty text and extra words', () => {
    expect(parseModelEffort('opus')).toBeNull()
    expect(parseModelEffort('medium')).toBeNull()
    expect(parseModelEffort('')).toBeNull()
    expect(parseModelEffort('opus + ')).toBeNull()
    expect(parseModelEffort('+ medium')).toBeNull()
    expect(parseModelEffort('opus medium high')).toBeNull()
    expect(parseModelEffort('opus++medium')).toBeNull()
    expect(parseModelEffort('-opus medium')).toBeNull()
  })

  test('modelEffortRefusal names the answer, an example pair, every model and every effort (A4)', () => {
    expect(modelEffortRefusal('sonet + high')).toBe(
      'Cannot use sonet + high: type a model and an effort, such as opus + high. ' +
        'Models: opus, sonnet, haiku, fable. Efforts: low, medium, high, xhigh, max.',
    )
  })

  test('modelEffortRefusal shows the answer cleaned and capped, so it cannot add a line or hide text (A4)', () => {
    const refusal = (shown: string): string =>
      `Cannot use ${shown}: type a model and an effort, such as opus + high. ` +
      'Models: opus, sonnet, haiku, fable. Efforts: low, medium, high, xhigh, max.'
    expect(modelEffortRefusal(`so${BIDI_OVERRIDE}net\nhigh`)).toBe(refusal('sonethigh'))
    expect(modelEffortRefusal('x'.repeat(61))).toBe(refusal(`${'x'.repeat(59)}…`))
  })

  test('modelEffortRefusal shows the answer trimmed, as every parser reads it (B1)', () => {
    expect(modelEffortRefusal('  sonet + high ')).toBe(modelEffortRefusal('sonet + high'))
    expect(modelEffortRefusal('  sonet + high ')).toBe(
      'Cannot use sonet + high: type a model and an effort, such as opus + high. ' +
        'Models: opus, sonnet, haiku, fable. Efforts: low, medium, high, xhigh, max.',
    )
  })

  test('parseEnvNames keeps the scanned names, sorted and once each, whatever the order and separators', () => {
    const scanned = ['API_KEY', 'JIRA_URL', 'TOKEN']

    expect(parseEnvNames('JIRA_URL, API_KEY', scanned)).toEqual(['API_KEY', 'JIRA_URL'])
    expect(parseEnvNames('TOKEN JIRA_URL', scanned)).toEqual(['JIRA_URL', 'TOKEN'])
    expect(parseEnvNames('API_KEY, API_KEY', scanned)).toEqual(['API_KEY'])
  })

  test('parseEnvNames reads none as no names, and all or the All of them button as every scanned name, sorted', () => {
    const scanned = ['TOKEN', 'API_KEY']

    expect(parseEnvNames('None', scanned)).toEqual([])
    expect(parseEnvNames('none', scanned)).toEqual([])
    expect(parseEnvNames('All of them', scanned)).toEqual(['API_KEY', 'TOKEN'])
    expect(parseEnvNames('all', scanned)).toEqual(['API_KEY', 'TOKEN'])
    expect(parseEnvNames('ALL OF THEM', scanned)).toEqual(['API_KEY', 'TOKEN'])
    expect(ALL_ENV_OPTION).toBe('All of them')
  })

  test('parseEnvNames gives null for a name that was not scanned, a name in the wrong case, or an empty answer', () => {
    const scanned = ['API_KEY', 'JIRA_URL']

    expect(parseEnvNames('HOME', scanned)).toBeNull()
    expect(parseEnvNames('jira_url', scanned)).toBeNull()
    expect(parseEnvNames('API_KEY, HOME', scanned)).toBeNull()
    expect(parseEnvNames('', scanned)).toBeNull()
    expect(parseEnvNames(' , ', scanned)).toBeNull()
    expect(parseEnvNames('none, API_KEY', scanned)).toBeNull()
  })

  test('parseEnvNames lets nothing but a scanned name through: no value, no prototype key (names only, D-60)', () => {
    const scanned = ['API_KEY', 'JIRA_URL']
    const answers = ['API_KEY=sk-live-123', 'sk-live-123', '$(whoami)', 'API_KEY;JIRA_URL', '__proto__', 'constructor']

    for (const answer of answers) expect([answer, parseEnvNames(answer, scanned)]).toEqual([answer, null])
  })

  test('parseEnvNames with nothing scanned gives no names for none and all, and null for any name', () => {
    expect(parseEnvNames('none', [])).toEqual([])
    expect(parseEnvNames('all', [])).toEqual([])
    expect(parseEnvNames('API_KEY', [])).toBeNull()
  })

  test('envQuestion lists the scanned names and says that values are never stored', () => {
    expect(envQuestion(['API_KEY', 'JIRA_URL'])).toBe(
      'Which env variables do roles carry? Names: API_KEY, JIRA_URL (values are never stored; e.g. API_KEY, or none)',
    )
  })

  test('envQuestion cleans each name and cuts it to 60 code points', () => {
    const odd = `A${BIDI_OVERRIDE}B`

    expect(envQuestion([odd, 'X'.repeat(70)])).toBe(
      `Which env variables do roles carry? Names: AB, ${'X'.repeat(59)}… ` +
        '(values are never stored; e.g. API_KEY, or none)',
    )
  })

  test('INSTRUCTION_LABELS words the three instruction groups and is frozen', () => {
    expect(INSTRUCTION_LABELS).toEqual({
      'global-claude-md': 'your global ~/.claude/CLAUDE.md and the files it imports',
      'auto-memory': 'the auto-memories for this repo',
      'project-claude-md': 'the project CLAUDE.md',
    })
    expect(Object.isFrozen(INSTRUCTION_LABELS)).toBe(true)
  })

  test('memoryQuestion words the question with the group label and the names found', () => {
    expect(memoryQuestion('auto-memory', ['a.md', 'b.md'])).toBe(autoMemoryAsk('a.md, b.md'))
    expect(memoryQuestion('project-claude-md', ['<repo>/CLAUDE.md'])).toBe(
      'Which roles get the project CLAUDE.md (<repo>/CLAUDE.md)? (e.g. PM, TL, or none)',
    )
    expect(memoryQuestion('global-claude-md', ['~/.claude/CLAUDE.md'])).toBe(
      'Which roles get your global ~/.claude/CLAUDE.md and the files it imports (~/.claude/CLAUDE.md)? ' +
        '(e.g. PM, TL, or none)',
    )
  })

  test('memoryQuestion shows five names at most and counts the rest', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

    expect(memoryQuestion('auto-memory', names.slice(0, 5))).toBe(autoMemoryAsk('a, b, c, d, e'))
    expect(memoryQuestion('auto-memory', names.slice(0, 6))).toBe(autoMemoryAsk('a, b, c, d, e, +1 more'))
    expect(memoryQuestion('auto-memory', names)).toBe(autoMemoryAsk('a, b, c, d, e, +2 more'))
  })

  test('memoryQuestion cleans each name to 60 code points, and with no name it leaves the brackets out', () => {
    const odd = `m${BIDI_OVERRIDE}.md`

    expect(memoryQuestion('auto-memory', [odd, 'x'.repeat(61)])).toBe(autoMemoryAsk(`m.md, ${'x'.repeat(59)}…`))
    expect(memoryQuestion('auto-memory', [])).toBe(
      'Which roles get the auto-memories for this repo? (e.g. PM, TL, or none)',
    )
  })
})

/** The env question for names as the dialog shows them, between its fixed start and end (D-60). */
function envAsk(shown: string): string {
  return `Which env variables do roles carry? Names: ${shown} (values are never stored; e.g. API_KEY, or none)`
}

/** This many env names, NAME_01 on, in order. */
function envNames(count: number): string[] {
  return Array.from({ length: count }, (_, at) => `NAME_${String(at + 1).padStart(2, '0')}`)
}

describe('env question cap (G-02-5)', () => {
  test('cappedNames shows five names at most, then counts the rest; no name gives no text', () => {
    expect(cappedNames(envNames(5))).toBe('NAME_01, NAME_02, NAME_03, NAME_04, NAME_05')
    expect(cappedNames(envNames(6))).toBe('NAME_01, NAME_02, NAME_03, NAME_04, NAME_05, +1 more')
    expect(cappedNames(envNames(40))).toBe('NAME_01, NAME_02, NAME_03, NAME_04, NAME_05, +35 more')
    expect(cappedNames([])).toBe('')
  })

  test('cappedNames cleans each name it shows and cuts it to 60 code points', () => {
    const ellipsis = String.fromCodePoint(0x2026)
    expect(cappedNames([`A${BIDI_OVERRIDE}B`, 'X'.repeat(70)])).toBe(`AB, ${'X'.repeat(59)}${ellipsis}`)
  })

  test('the env question lists all of 5 names, 5 of 6 with +1 more and 5 of 40 with +35 more', () => {
    expect(envQuestion(envNames(5))).toBe(envAsk('NAME_01, NAME_02, NAME_03, NAME_04, NAME_05'))
    expect(envQuestion(envNames(6))).toBe(envAsk('NAME_01, NAME_02, NAME_03, NAME_04, NAME_05, +1 more'))
    expect(envQuestion(envNames(40))).toBe(envAsk('NAME_01, NAME_02, NAME_03, NAME_04, NAME_05, +35 more'))
  })

  test('the memory question keeps its text: the same cap in brackets, or no brackets with no name', () => {
    expect(memoryQuestion('auto-memory', envNames(6))).toBe(
      autoMemoryAsk('NAME_01, NAME_02, NAME_03, NAME_04, NAME_05, +1 more'),
    )
    expect(memoryQuestion('auto-memory', [])).toBe(
      'Which roles get the auto-memories for this repo? (e.g. PM, TL, or none)',
    )
  })

  test('All of them still picks every scanned name, and a typed name past the fifth still counts (D-60)', () => {
    const names = envNames(40)
    expect(parseEnvNames(ALL_ENV_OPTION, names)).toEqual(names)
    expect(parseEnvNames('all', names)).toEqual(names)
    expect(parseEnvNames('NAME_40, NAME_06', names)).toEqual(['NAME_06', 'NAME_40'])
    expect(parseEnvNames('NAME_41', names)).toBeNull()
  })
})
