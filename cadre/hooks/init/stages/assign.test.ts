import { describe, expect, test } from 'claude-code/testing'

import type { InitIo, McpRef, RoleSpec, SetupScan } from '../../../types'
import { proposeRoles } from '../../roles/propose'
import {
  EMPTY_FACTS,
  emptySetupScan,
  firstLines,
  FULL_SCAN,
  memIo,
  memWorld,
  OWN_SKILLS_ENTRY_PREFIX,
  repoScan,
  roleIn,
  session,
  skillRef,
  stageStep,
  stateAt,
  valueOf,
} from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import { nextStage } from '../machine'
import type { Answer } from '../state'
import { assignStage } from './assign'
import { ASSIGNMENT_DISMISSED_REASON, mcpContextLine, skillsContextLine } from './own-skills'

/** The buttons of every question on which roles get an item. */
const ROLE_LIST_OPTIONS = ['None', 'All roles']

/** The buttons of a plugin group question with no recommendation for the group (D-251). */
const GROUP_OPTIONS = ['Go one by one', ...ROLE_LIST_OPTIONS]

/** The assign stage run over `io` for `roles`, the setup scan `setup` and the history `hints`, as a step result. */
function assignedBy(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  hints: ReadonlyMap<string, number> = new Map(),
): Promise<StepResult<readonly RoleSpec[]>> {
  const gathered = { facts: { facts: EMPTY_FACTS, gsdUserDir: null }, repo: repoScan(), setup }

  return stageStep(io, assignStage, stateAt('assign', { roles, gathered, hints }), draft => draft.roles)
}

describe('assignmentStep', () => {
  /** PM, Team Lead, BE, FE, QA and Security: a repo with a frontend and tests keeps every template role. */
  const roles = proposeRoles(FULL_SCAN).roles
  /** jira, which the table seeds for PM and TL, the unknown sentry, security-review and two codex skills. */
  const setup = emptySetupScan({
    mcp: [session('jira'), session('sentry')],
    skills: [skillRef('security-review'), skillRef('codex:rescue', 'codex'), skillRef('codex:setup', 'codex')],
  })
  const JIRA_QUESTION = 'Which roles get the jira MCP server? (e.g. BE, QA, or none)'
  const SENTRY_QUESTION = 'Which roles get the sentry MCP server? (e.g. BE, QA, or none)'
  const CODEX_QUESTION = 'Which roles get codex skills (2)? (e.g. BE, QA, or none)'
  /** The codex group question as a pane surface asks it: no count or uses, the pane lists each skill (D-283). */
  const CODEX_PANE_QUESTION = 'Which roles get codex skills? (e.g. BE, QA, or none)'
  /** The MCP hand-out's entry question and its whole-group question, as asked (D-250). */
  const MCP_ENTRY_ASKED = withContext(
    'Which roles get the MCP servers (2)? Pick how to hand them out.',
    '2 MCP servers; each question shows its source, its tools and the roles it is recommended for.',
  )
  const MCP_WHOLE_ASKED = withContext(
    'Which roles get all the MCP servers (2)? (e.g. BE, QA, or none)',
    mcpContextLine(roles),
  )
  /** The three questions as asked: the team's role ids and what giving the item means under each (D-136). */
  const JIRA_ASKED = withContext(JIRA_QUESTION, mcpContextLine(roles))
  const SENTRY_ASKED = withContext(SENTRY_QUESTION, mcpContextLine(roles))
  const CODEX_ASKED = withContext(CODEX_QUESTION, skillsContextLine(roles))
  /**
   * The own context of each question (D-211): session servers with no tool listed, jira with the table seed the failed
   * mcp call falls back to (D-254), and two undescribed skills.
   */
  const JIRA_CONTEXT = {
    title: 'MCP: jira',
    lines: ['Source: session', 'Tools: none listed', 'Recommended: pm, tl'],
    kind: 'mcp-server',
    // A pane surface asks each question with the roles recommended for it in place of the context line (D-255).
    pane: { asked: JIRA_ASKED, text: withContext(JIRA_QUESTION, 'Recommended: pm, tl') },
  }
  const SENTRY_CONTEXT = {
    title: 'MCP: sentry',
    lines: ['Source: session', 'Tools: none listed', 'Recommended: none'],
    kind: 'mcp-server',
    pane: { asked: SENTRY_ASKED, text: withContext(SENTRY_QUESTION, 'Recommended: none') },
  }
  const CODEX_CONTEXT = {
    title: 'Skills: codex',
    lines: [
      'Recommended: none',
      'codex:rescue: No description. Recommended: none.',
      'codex:setup: No description. Recommended: none.',
    ],
    kind: 'skill-group',
    // The group question alone, with no count or uses (D-283).
    pane: { asked: CODEX_ASKED, text: withContext(CODEX_PANE_QUESTION, 'Recommended: none') },
  }

  test('every server and skill is asked; a table match is only its seed (D-249, D-280)', async () => {
    const answers = ['Go one by one', 'pm, tl', 'be', 'All roles', 'Accept recommendations']
    const run = memIo(memWorld({}), answers)
    const assigned = valueOf(await assignedBy(run.io, roles, setup))
    expect(run.asked.slice(0, 4)).toEqual([MCP_ENTRY_ASKED, JIRA_ASKED, SENTRY_ASKED, CODEX_ASKED])
    expect(firstLines(run.asked.slice(4))).toEqual([OWN_SKILLS_ENTRY_ONE])
    const [entry] = run.specs
    const servers = ['jira: session, 0 tools. Recommended: pm, tl.', 'sentry: session, 0 tools. Recommended: none.']
    expect([entry?.context?.title, entry?.context?.lines, entry?.context?.kind]).toEqual([
      'MCP servers',
      servers,
      'mcp-server',
    ])
    expect(run.specs.slice(0, 4).map(spec => ({ ...spec, context: spec === entry ? null : spec.context }))).toEqual([
      { options: ['Accept recommendations', 'Go one by one', 'Whole group'], header: 'MCP', context: null },
      { options: ['Yes', 'No'], header: 'MCP 1/2', context: JIRA_CONTEXT, acceptsTyped: true },
      { options: ['Yes', 'No'], header: 'MCP 2/2', context: SENTRY_CONTEXT, acceptsTyped: true },
      { options: GROUP_OPTIONS, header: 'Skills', context: CODEX_CONTEXT, acceptsTyped: true },
    ])
    expect(assigned.map(role => [role.id, role.mcp])).toEqual([
      ['pm', ['jira']],
      ['tl', ['jira']],
      ['be', ['sentry']],
      ['fe', []],
      ['qa', []],
      ['security', []],
    ])
    expect(roleIn(assigned, 'security').skills).toEqual(['codex:rescue', 'codex:setup', 'security-review'])
    for (const id of ['pm', 'tl', 'be', 'fe', 'qa']) {
      expect(roleIn(assigned, id).skills).toEqual(['codex:rescue', 'codex:setup'])
    }
    expect(run.logged).toEqual([])
  })

  test('a typed list of ids or titles gives the item to those roles, and None to no role', async () => {
    const run = memIo(memWorld({}), ['Go one by one', 'pm', 'Team Lead, qa', 'None', 'Accept recommendations'])
    const assigned = valueOf(await assignedBy(run.io, roles, setup))
    expect(roleIn(assigned, 'pm').mcp).toEqual(['jira'])
    expect(roleIn(assigned, 'tl').mcp).toEqual(['sentry'])
    expect(roleIn(assigned, 'qa').mcp).toEqual(['sentry'])
    expect(roleIn(assigned, 'pm').skills).toEqual([])
    expect(roleIn(assigned, 'security').skills).toEqual(['security-review'])
  })

  test('an answer that names a role the team does not have is asked again with why on top', async () => {
    const run = memIo(memWorld({}), ['Whole group', 'cto', 'be', 'None', 'Accept recommendations'])
    const assigned = valueOf(await assignedBy(run.io, roles, setup))
    expect(roleIn(assigned, 'be').mcp).toEqual(['jira', 'sentry'])
    const refusal = `'cto' isn't one of: "None", "All roles", or role ids from: pm, tl, be, fe, qa, security.`
    const asked = [MCP_ENTRY_ASKED, MCP_WHOLE_ASKED, `${refusal}\n${MCP_WHOLE_ASKED}`, CODEX_ASKED]
    expect(run.asked.slice(0, 4)).toEqual(asked)
  })

  test('three unreadable answers or a dismissal cancel with their reason, and no answer is kept (A1)', async () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [['cto', 'cto', 'cto'], NO_USABLE_ANSWER_REASON],
      [[], ASSIGNMENT_DISMISSED_REASON],
      [['be'], ASSIGNMENT_DISMISSED_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(memWorld({}), answers)
      expect(await assignedBy(run.io, roles, setup)).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(ASSIGNMENT_DISMISSED_REASON).toBe(
      'A question on which roles get an MCP server or skills was dismissed or not answered.',
    )
  })

  test('infra servers and handoff and framework skills are never asked; a table server is (D-249)', async () => {
    const quiet = emptySetupScan({
      mcp: [session('autopilot'), session('github')],
      skills: [
        skillRef('create-handoff-doc'),
        skillRef('gsd-plan-phase'),
        skillRef('superpowers:brainstorming', 'superpowers'),
      ],
    })
    const run = memIo(memWorld({}), ['Go one by one', 'tl'])
    const assigned = valueOf(await assignedBy(run.io, roles, quiet))
    expect(firstLines(run.asked)).toEqual([
      'Which roles get the MCP servers (1)? Pick how to hand them out.',
      'Which roles get the github MCP server? (e.g. BE, QA, or none)',
    ])
    expect(roleIn(assigned, 'tl').mcp).toEqual(['github'])
    expect(assigned.flatMap(role => role.skills)).toEqual([])
    const bare = await assignedBy(memIo(memWorld({}), []).io, roles, emptySetupScan())
    expect(bare).toEqual({ kind: 'accepted', value: roles })
  })

  test('the roles it is given are never changed', async () => {
    const before = JSON.stringify(roles)
    await assignedBy(memIo(memWorld({}), ['All roles', 'All roles', 'All roles']).io, roles, setup)
    expect(JSON.stringify(roles)).toBe(before)
  })

  test('a second run with None takes every server and skill away, the table skill too (A3, D-280)', async () => {
    const all = ['Whole group', 'All roles', 'All roles', 'Accept recommendations']
    const first = valueOf(await assignedBy(memIo(memWorld({}), all).io, roles, setup))
    expect(first.map(role => role.mcp.includes('sentry'))).toEqual(roles.map(() => true))
    expect(roleIn(first, 'security').skills).toContain('security-review')
    const none = ['Whole group', 'None', 'None', 'Whole group', 'None']
    const again = valueOf(await assignedBy(memIo(memWorld({}), none).io, first, setup))
    expect(again.map(role => [role.id, role.mcp, role.skills])).toEqual([
      ['pm', [], []],
      ['tl', [], []],
      ['be', [], []],
      ['fe', [], []],
      ['qa', [], []],
      ['security', [], []],
    ])
  })

  test('a narrower second answer leaves an asked server on the roles it names only (A3)', async () => {
    const accept = 'Accept recommendations'
    const firstRun = memIo(memWorld({}), ['Go one by one', 'pm, tl', 'All roles', 'None', accept])
    const first = valueOf(await assignedBy(firstRun.io, roles, setup))
    const againRun = memIo(memWorld({}), ['Go one by one', 'pm, tl', 'be', 'None', accept])
    const again = valueOf(await assignedBy(againRun.io, first, setup))
    expect(again.filter(role => role.mcp.includes('sentry')).map(role => role.id)).toEqual(['be'])
    expect(roleIn(again, 'tl').mcp).toEqual(['jira'])
  })
})

/** The entry question of the user's own skills when there is one (G-02-1b), as its first line reads. */
const OWN_SKILLS_ENTRY_ONE = `${OWN_SKILLS_ENTRY_PREFIX} (1)?`

describe('history hints', () => {
  /** PM, Team Lead, BE, FE, QA and Security: a repo with a frontend and tests keeps every template role. */
  const roles = proposeRoles(FULL_SCAN).roles
  /** The unknown sentry, and three skill groups to ask about: alpha (1), codex (2) and the user's own (1). */
  const setup = emptySetupScan({
    mcp: [session('sentry')],
    skills: [
      skillRef('alpha:x', 'alpha'),
      skillRef('codex:rescue', 'codex'),
      skillRef('codex:setup', 'codex'),
      skillRef('my-skill'),
    ],
  })
  /** The MCP hand-out of the one server answered Whole group, and its question for all the servers (D-250). */
  const SERVER_QUESTIONS = [
    'Which roles get the MCP servers (1)? Pick how to hand them out.',
    'Which roles get all the MCP servers (1)? (e.g. BE, QA, or none)',
  ]
  /**
   * The 02-07 questions in today's order: the server's hand-out, the plugin groups by label, then the hand-out of the
   * user's own skills answered Whole group, which asks their group question (G-02-1b).
   */
  const PLAIN_QUESTIONS = [
    ...SERVER_QUESTIONS,
    'Which roles get alpha skills (1)? (e.g. BE, QA, or none)',
    'Which roles get codex skills (2)? (e.g. BE, QA, or none)',
    OWN_SKILLS_ENTRY_ONE,
    'Which roles get your own skills (1)? (e.g. BE, QA, or none)',
  ]
  /** Whole group and None for the server, None for each plugin group, then Whole group and None for the own skills. */
  const NONE_FOR_ALL = ['Whole group', 'None', 'None', 'None', 'Whole group', 'None']

  test('with hints the busiest plugin group comes first, with its uses; servers first, own skills last', async () => {
    const hints = new Map([
      ['my-skill', 5],
      ['codex:rescue', 2],
      ['codex:setup', 1],
    ])
    const run = memIo(memWorld({}), NONE_FOR_ALL)
    valueOf(await assignedBy(run.io, roles, setup, hints))
    expect(firstLines(run.asked)).toEqual([
      ...SERVER_QUESTIONS,
      'Which roles get codex skills (2)? (used 3 times in recent sessions) (e.g. BE, QA, or none)',
      'Which roles get alpha skills (1)? (e.g. BE, QA, or none)',
      OWN_SKILLS_ENTRY_ONE,
      'Which roles get your own skills (1)? (used 5 times in recent sessions) (e.g. BE, QA, or none)',
    ])
  })

  test('without hints, or with none that count, assignmentStep asks the 02-07 questions in order', async () => {
    for (const hints of [undefined, new Map<string, number>(), new Map([['not-asked', 4]])]) {
      const run = memIo(memWorld({}), NONE_FOR_ALL)
      valueOf(await assignedBy(run.io, roles, setup, hints))
      expect(firstLines(run.asked)).toEqual(PLAIN_QUESTIONS)
    }
  })

  test('with hints each answer still decides the whole list of the names it asks about (A3)', async () => {
    const hints = new Map([['my-skill', 5]])
    const all = ['Whole group', 'All roles', 'All roles', 'All roles', 'Whole group', 'All roles']
    const first = valueOf(await assignedBy(memIo(memWorld({}), all).io, roles, setup, hints))
    expect(first.every(role => role.skills.includes('my-skill') && role.skills.includes('alpha:x'))).toBe(true)
    const again = valueOf(await assignedBy(memIo(memWorld({}), NONE_FOR_ALL).io, first, setup, hints))
    expect(again.flatMap(role => [...role.mcp, ...role.skills])).toEqual([])
  })
})

/** The mcp model call's answer that recommends no role for any server (D-248). */
const SERVERS_NONE: Answer = { kind: 'model', result: { id: 'mcp', result: new Map() } }

/** The skills model call's answer that recommends no role for any skill or group (D-248). */
const SKILLS_NONE: Answer = {
  kind: 'model',
  result: { id: 'skills', result: { own: new Map(), groups: new Map(), groupSkills: new Map() } },
}

describe('the assign stage (D-230)', () => {
  /** PM, Team Lead, BE, FE, QA and Security. */
  const roles = proposeRoles(FULL_SCAN).roles
  /** The unknown sentry server, a codex skill group and one skill of the user's own. */
  const setup = emptySetupScan({
    mcp: [session('sentry')],
    skills: [skillRef('codex:rescue', 'codex'), { name: 'mine', plugin: null, purpose: 'Do my thing.' }],
  })
  const gathered = { facts: { facts: EMPTY_FACTS, gsdUserDir: null }, repo: repoScan(), setup }

  test('assignStage hands out the servers after the mcp call, then asks each skill group (D-248, D-250)', () => {
    const calling = assignStage.enter(stateAt('assign', { roles, gathered, hints: new Map() }))
    const servers = [{ name: 'sentry', source: 'session', tools: [], seed: [] }]
    expect(calling.effect).toEqual({ kind: 'model', call: { id: 'mcp', roles, servers } })
    const entry = nextStage(calling, SERVERS_NONE)
    const entrySpec = entry.openQuestion?.spec
    expect([entrySpec?.options, entrySpec?.header, entrySpec?.context?.lines]).toEqual([
      ['Go one by one', 'Whole group'],
      'MCP',
      ['sentry: session, 0 tools. Recommended: none.'],
    ])
    const state = nextStage(entry, { kind: 'answer', text: 'Go one by one' })
    const sentence = 'Which roles get the sentry MCP server? (e.g. BE, QA, or none)'
    const question = withContext(sentence, mcpContextLine(roles))
    const lines = ['Source: session', 'Tools: none listed', 'Recommended: none']
    const pane = { asked: question, text: withContext(sentence, 'Recommended: none') }
    const context = { title: 'MCP: sentry', lines, kind: 'mcp-server', pane }
    const ask = { question, spec: { options: ['Yes', 'No'], header: 'MCP 1/1', context, acceptsTyped: true } }
    expect([state.effect, state.openQuestion]).toEqual([{ kind: 'ask', ...ask }, ask])
    const group = nextStage(nextStage(state, { kind: 'answer', text: 'be' }), SKILLS_NONE)
    const codexLines = ['Recommended: none', 'codex:rescue: No description. Recommended: none.']
    const codexQuestion = 'Which roles get codex skills (1)? (e.g. BE, QA, or none)'
    const codexPane = {
      asked: withContext(codexQuestion, skillsContextLine(roles)),
      text: withContext('Which roles get codex skills? (e.g. BE, QA, or none)', 'Recommended: none'),
    }
    const codex = { title: 'Skills: codex', lines: codexLines, kind: 'skill-group', pane: codexPane }
    const typed = { acceptsTyped: true }
    expect(group.openQuestion?.spec).toEqual({ options: GROUP_OPTIONS, header: 'Skills', context: codex, ...typed })
  })

  test('an MCP server question names its source and the tools the session lists for it (D-211)', () => {
    const toolNames = ['mcp__sentry__issues', 'mcp__sentry__events', 'mcp__jira__search', 'Read']
    const fromRepo: McpRef = { name: 'sentry', source: 'project' }
    const project = { ...gathered, setup: { ...setup, mcp: [fromRepo] } }
    const calling = assignStage.enter(stateAt('assign', { roles, gathered: project, hints: new Map() }, { toolNames }))
    const servers = [{ name: 'sentry', source: '.mcp.json', tools: ['events', 'issues'], seed: [] }]
    expect(calling.effect).toEqual({ kind: 'model', call: { id: 'mcp', roles, servers } })
    const entry = nextStage(calling, { kind: 'model', result: { id: 'mcp', result: new Map([['sentry', ['qa']]]) } })
    const state = nextStage(entry, { kind: 'answer', text: 'Go one by one' })
    const sentence = 'Which roles get the sentry MCP server? (e.g. BE, QA, or none)'
    const pane = { asked: withContext(sentence, mcpContextLine(roles)), text: withContext(sentence, 'Recommended: qa') }
    expect(state.openQuestion?.spec.context).toEqual({
      title: 'MCP: sentry',
      lines: ['Source: .mcp.json', 'Tools: 2 (events, issues)', 'Recommended: qa'],
      kind: 'mcp-server',
      pane,
    })
  })

  test('a skill group question lists each skill with its description, uses and recommended roles (D-211)', () => {
    const skills = [{ name: 'codex:rescue', plugin: 'codex', purpose: 'Delegate a stuck task' }]
    const described = { ...gathered, setup: { ...setup, mcp: [], skills } }
    const hints = new Map([['codex:rescue', 3]])
    const state = nextStage(assignStage.enter(stateAt('assign', { roles, gathered: described, hints })), SKILLS_NONE)
    const question = state.openQuestion?.question ?? ''
    const sentence = 'Which roles get codex skills? (e.g. BE, QA, or none)'
    expect(state.openQuestion?.spec.context).toEqual({
      title: 'Skills: codex',
      lines: [
        'Recommended: none',
        'codex:rescue: Delegate a stuck task. Used 3 times in the last 50 sessions. Recommended: none.',
      ],
      kind: 'skill-group',
      pane: { asked: question, text: withContext(sentence, 'Recommended: none') },
    })
  })

  test('one skills model effect after the MCP answers, then the groups, then the own skills hand-out (D-248)', () => {
    const calls = assignStage.enter(stateAt('assign', { roles, gathered, hints: new Map() }))
    const whole = nextStage(nextStage(calls, SERVERS_NONE), { kind: 'answer', text: 'Whole group' })
    const calling = nextStage(whole, { kind: 'answer', text: 'be' })
    const own = [{ name: 'mine', plugin: null, purpose: 'Do my thing.' }]
    const groups = [{ plugin: 'codex', skills: [{ name: 'codex:rescue', plugin: 'codex' }] }]
    const mcpByRole = new Map(roles.map(role => [role.id, role.id === 'be' ? ['sentry'] : []]))
    const call = { id: 'skills', roles, mcpByRole, own, groups, counts: new Map(), seeds: new Map() }
    expect(calling.effect).toEqual({ kind: 'model', call })
    const recommended = { own: new Map([['mine', ['be']]]), groups: new Map(), groupSkills: new Map() }
    const group = nextStage(calling, { kind: 'model', result: { id: 'skills', result: recommended } })
    const entry = nextStage(group, { kind: 'answer', text: 'None' })
    expect(entry.outputs.map(output => (output.kind === 'show' ? output.block.key : output.kind))).toEqual(['skills'])
    expect(entry.openQuestion?.question.split('\n')[0]).toBe(`${OWN_SKILLS_ENTRY_PREFIX} (1)?`)
  })
})

describe('infra plugins by name (D-252)', () => {
  test('no question names a skill of autopilot under another marketplace; the codex group is still asked', async () => {
    const roles = proposeRoles(FULL_SCAN).roles
    const setup = emptySetupScan({
      skills: [
        skillRef('away', 'autopilot@elsewhere'),
        skillRef('back', 'autopilot@elsewhere'),
        skillRef('codex:rescue', 'codex'),
      ],
    })
    const run = memIo(memWorld({}), ['None'])
    await assignedBy(run.io, roles, setup)
    expect(firstLines(run.asked)).toEqual(['Which roles get codex skills (1)? (e.g. BE, QA, or none)'])
    expect(JSON.stringify(run.specs)).not.toContain('away')
  })
})

describe('table seeds (D-280)', () => {
  test('a plugin group question shows the table seed of each of its skills; only the answer gives it', async () => {
    const roles = proposeRoles(FULL_SCAN).roles
    const skills = [skillRef('frontend-design', 'frontend'), skillRef('lint', 'frontend')]
    const setup = emptySetupScan({ skills })
    const run = memIo(memWorld({}), ['None'])
    const assigned = valueOf(await assignedBy(run.io, roles, setup))
    expect(run.specs[0]?.context?.lines).toEqual([
      'Recommended: none',
      'frontend-design: No description. Recommended: fe.',
      'lint: No description. Recommended: none.',
    ])
    expect(assigned.flatMap(role => role.skills)).toEqual([])
  })
})

describe('plugin skill groups (D-251)', () => {
  const roles = proposeRoles(FULL_SCAN).roles
  /** Two plugin groups in label order: alpha (G1) with one skill, codex (G2) with two. */
  const setup = emptySetupScan({
    skills: [skillRef('alpha:x', 'alpha'), skillRef('codex:rescue', 'codex'), skillRef('codex:setup', 'codex')],
  })
  /** The skills call's reply: alpha:x to QA and its group to none; codex to BE and QA, codex:rescue to BE. */
  const REPLY = '{"skills":{"G1S1":["qa"],"G2S1":["be"],"G2S2":[]},"groups":{"G1":[],"G2":["be","qa"]}}'

  test('Accept recommendation gives a group its roles; one by one asks each skill, then the next group', async () => {
    const run = memIo(memWorld({ replies: [REPLY] }), ['Go one by one', 'Yes', 'Accept recommendation'])
    const assigned = valueOf(await assignedBy(run.io, roles, setup))
    expect(firstLines(run.asked)).toEqual([
      'Which roles get alpha skills (1)? (e.g. BE, QA, or none)',
      'Which roles get the skill alpha:x?',
      'Which roles get codex skills (2)? (e.g. BE, QA, or none)',
    ])
    expect(run.specs.map(spec => spec.options)).toEqual([
      ['Go one by one', 'None', 'All roles'],
      ['Yes', 'No'],
      ['Accept recommendation', 'Go one by one', 'None', 'All roles'],
    ])
    expect(run.specs[1]?.header).toBe('Skill 1/1')
    expect(run.asked[1]?.split('\n')[1]).toBe('No description. Recommended: qa.')
    expect(run.specs[2]?.context?.lines).toEqual([
      'Recommended: be, qa',
      'codex:rescue: No description. Recommended: be.',
      'codex:setup: No description. Recommended: none.',
    ])
    expect(roleIn(assigned, 'qa').skills).toEqual(['alpha:x', 'codex:rescue', 'codex:setup'])
    expect(roleIn(assigned, 'be').skills).toEqual(['codex:rescue', 'codex:setup'])
    expect(roleIn(assigned, 'pm').skills).toEqual([])
  })

  test('a group with no recommendation offers no Accept, so typing it is asked again with why on top', async () => {
    const run = memIo(memWorld({ replies: [REPLY] }), ['Accept recommendation', 'None', 'None'])
    valueOf(await assignedBy(run.io, roles, setup))
    const refusal = `'Accept recommendation' isn't one of: "Go one by one", "None", "All roles", or role ids from: ${
      roles.map(role => role.id).join(', ')}.`
    expect(run.asked[1]?.split('\n')[0]).toBe(refusal)
  })
})
