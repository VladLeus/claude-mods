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
import { assignStage, mcpContextLine } from './assign'
import { ASSIGNMENT_DISMISSED_REASON, skillsContextLine } from './own-skills'

/** The buttons of every question on which roles get an item. */
const ROLE_LIST_OPTIONS = ['None', 'All roles']

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
  /** The three questions as asked: the team's role ids and what giving the item means under each (D-136). */
  const JIRA_ASKED = withContext(JIRA_QUESTION, mcpContextLine(roles))
  const SENTRY_ASKED = withContext(SENTRY_QUESTION, mcpContextLine(roles))
  const CODEX_ASKED = withContext(CODEX_QUESTION, skillsContextLine(roles))
  /** The own context of each question (D-211): session servers with no tool listed, and two undescribed skills. */
  const JIRA_CONTEXT = {
    title: 'MCP: jira',
    lines: ['Source: session', 'Tools: none listed', 'Recommended: pm, tl'],
    kind: 'mcp-server',
  }
  const SENTRY_CONTEXT = {
    title: 'MCP: sentry',
    lines: ['Source: session', 'Tools: none listed', 'Recommended: none'],
    kind: 'mcp-server',
  }
  const CODEX_CONTEXT = {
    title: 'Skills: codex',
    lines: ['codex:rescue: No description. Recommended: none.', 'codex:setup: No description. Recommended: none.'],
    kind: 'skill-group',
  }

  test('every server is asked with its table seed; each unknown skill group is asked once (D-249)', async () => {
    const run = memIo(memWorld({}), ['pm, tl', 'be', 'All roles'])
    const assigned = valueOf(await assignedBy(run.io, roles, setup))
    expect(run.asked).toEqual([JIRA_ASKED, SENTRY_ASKED, CODEX_ASKED])
    expect(run.specs).toEqual([
      { options: ROLE_LIST_OPTIONS, header: 'MCP', context: JIRA_CONTEXT, acceptsTyped: true },
      { options: ROLE_LIST_OPTIONS, header: 'MCP', context: SENTRY_CONTEXT, acceptsTyped: true },
      { options: ROLE_LIST_OPTIONS, header: 'Skills', context: CODEX_CONTEXT, acceptsTyped: true },
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
    const run = memIo(memWorld({}), ['pm', 'Team Lead, qa', 'None'])
    const assigned = valueOf(await assignedBy(run.io, roles, setup))
    expect(roleIn(assigned, 'pm').mcp).toEqual(['jira'])
    expect(roleIn(assigned, 'tl').mcp).toEqual(['sentry'])
    expect(roleIn(assigned, 'qa').mcp).toEqual(['sentry'])
    expect(roleIn(assigned, 'pm').skills).toEqual([])
    expect(roleIn(assigned, 'security').skills).toEqual(['security-review'])
  })

  test('an answer that names a role the team does not have is asked again with why on top', async () => {
    const run = memIo(memWorld({}), ['None', 'cto', 'be', 'None'])
    const assigned = valueOf(await assignedBy(run.io, roles, setup))
    expect(roleIn(assigned, 'be').mcp).toEqual(['sentry'])
    const refusal = `'cto' isn't one of: "None", "All roles", or role ids from: pm, tl, be, fe, qa, security.`
    expect(run.asked).toEqual([JIRA_ASKED, SENTRY_ASKED, `${refusal}\n${SENTRY_ASKED}`, CODEX_ASKED])
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
    const run = memIo(memWorld({}), ['tl'])
    const assigned = valueOf(await assignedBy(run.io, roles, quiet))
    expect(firstLines(run.asked)).toEqual(['Which roles get the github MCP server? (e.g. BE, QA, or none)'])
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

  test('a second run with None takes every server and the codex skills away; the table skill stays (A3)', async () => {
    const all = ['All roles', 'All roles', 'All roles']
    const first = valueOf(await assignedBy(memIo(memWorld({}), all).io, roles, setup))
    expect(first.map(role => role.mcp.includes('sentry'))).toEqual(roles.map(() => true))
    const again = valueOf(await assignedBy(memIo(memWorld({}), ['None', 'None', 'None']).io, first, setup))
    expect(again.map(role => [role.id, role.mcp, role.skills])).toEqual([
      ['pm', [], []],
      ['tl', [], []],
      ['be', [], []],
      ['fe', [], []],
      ['qa', [], []],
      ['security', [], ['security-review']],
    ])
  })

  test('a narrower second answer leaves an asked server on the roles it names only (A3)', async () => {
    const first = valueOf(await assignedBy(memIo(memWorld({}), ['pm, tl', 'All roles', 'None']).io, roles, setup))
    const again = valueOf(await assignedBy(memIo(memWorld({}), ['pm, tl', 'be', 'None']).io, first, setup))
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
  const SENTRY_QUESTION = 'Which roles get the sentry MCP server? (e.g. BE, QA, or none)'
  /**
   * The 02-07 questions in today's order: the server, the plugin groups by label, then the hand-out of the user's own
   * skills answered Whole group, which asks their group question (G-02-1b).
   */
  const PLAIN_QUESTIONS = [
    SENTRY_QUESTION,
    'Which roles get alpha skills (1)? (e.g. BE, QA, or none)',
    'Which roles get codex skills (2)? (e.g. BE, QA, or none)',
    OWN_SKILLS_ENTRY_ONE,
    'Which roles get your own skills (1)? (e.g. BE, QA, or none)',
  ]
  /** None for the server and each plugin group, then Whole group and None for the user's own skills. */
  const NONE_FOR_ALL = ['None', 'None', 'None', 'Whole group', 'None']

  test('with hints the busiest plugin group comes first, with its uses; servers first, own skills last', async () => {
    const hints = new Map([
      ['my-skill', 5],
      ['codex:rescue', 2],
      ['codex:setup', 1],
    ])
    const run = memIo(memWorld({}), NONE_FOR_ALL)
    valueOf(await assignedBy(run.io, roles, setup, hints))
    expect(firstLines(run.asked)).toEqual([
      SENTRY_QUESTION,
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
    const all = ['All roles', 'All roles', 'All roles', 'Whole group', 'All roles']
    const first = valueOf(await assignedBy(memIo(memWorld({}), all).io, roles, setup, hints))
    expect(first.every(role => role.skills.includes('my-skill') && role.skills.includes('alpha:x'))).toBe(true)
    const again = valueOf(await assignedBy(memIo(memWorld({}), NONE_FOR_ALL).io, first, setup, hints))
    expect(again.flatMap(role => [...role.mcp, ...role.skills])).toEqual([])
  })
})

describe('the assign stage (D-230)', () => {
  /** PM, Team Lead, BE, FE, QA and Security. */
  const roles = proposeRoles(FULL_SCAN).roles
  /** The unknown sentry server, a codex skill group and one skill of the user's own. */
  const setup = emptySetupScan({
    mcp: [session('sentry')],
    skills: [skillRef('codex:rescue', 'codex'), { name: 'mine', plugin: null, purpose: 'Do my thing.' }],
  })
  const gathered = { facts: { facts: EMPTY_FACTS, gsdUserDir: null }, repo: repoScan(), setup }

  test('assignStage asks each unknown server, then each skill group; the open question is the first', () => {
    const state = assignStage.enter(stateAt('assign', { roles, gathered, hints: new Map() }))
    const question = withContext('Which roles get the sentry MCP server? (e.g. BE, QA, or none)', mcpContextLine(roles))
    const lines = ['Source: session', 'Tools: none listed', 'Recommended: none']
    const context = { title: 'MCP: sentry', lines, kind: 'mcp-server' }
    const ask = { question, spec: { options: ROLE_LIST_OPTIONS, header: 'MCP', context, acceptsTyped: true } }
    expect([state.effect, state.openQuestion]).toEqual([{ kind: 'ask', ...ask }, ask])
    const group = nextStage(state, { kind: 'answer', text: 'be' })
    const codexLines = ['codex:rescue: No description. Recommended: none.']
    const codex = { title: 'Skills: codex', lines: codexLines, kind: 'skill-group' }
    const typed = { acceptsTyped: true }
    expect(group.openQuestion?.spec).toEqual({ options: ROLE_LIST_OPTIONS, header: 'Skills', context: codex, ...typed })
  })

  test('an MCP server question names its source and the tools the session lists for it (D-211)', () => {
    const toolNames = ['mcp__sentry__issues', 'mcp__sentry__events', 'mcp__jira__search', 'Read']
    const fromRepo: McpRef = { name: 'sentry', source: 'project' }
    const project = { ...gathered, setup: { ...setup, mcp: [fromRepo] } }
    const state = assignStage.enter(stateAt('assign', { roles, gathered: project, hints: new Map() }, { toolNames }))
    expect(state.openQuestion?.spec.context).toEqual({
      title: 'MCP: sentry',
      lines: ['Source: .mcp.json', 'Tools: 2 (events, issues)', 'Recommended: none'],
      kind: 'mcp-server',
    })
  })

  test('a skill group question lists each skill with its description, uses and recommended roles (D-211)', () => {
    const skills = [{ name: 'codex:rescue', plugin: 'codex', purpose: 'Delegate a stuck task' }]
    const described = { ...gathered, setup: { ...setup, mcp: [], skills } }
    const hints = new Map([['codex:rescue', 3]])
    const state = assignStage.enter(stateAt('assign', { roles, gathered: described, hints }))
    expect(state.openQuestion?.spec.context).toEqual({
      title: 'Skills: codex',
      lines: ['codex:rescue: Delegate a stuck task. Used 3 times in the last 50 sessions. Recommended: none.'],
      kind: 'skill-group',
    })
  })

  test('the own skills are recommended by a skills model effect, then shown and handed out', () => {
    const state = assignStage.enter(stateAt('assign', { roles, gathered, hints: new Map() }))
    const calling = nextStage(nextStage(state, { kind: 'answer', text: 'be' }), { kind: 'answer', text: 'None' })
    const skills = [{ name: 'mine', plugin: null, purpose: 'Do my thing.' }]
    expect(calling.effect).toEqual({ kind: 'model', call: { id: 'skills', roles, skills, counts: new Map() } })
    const recommended = new Map([['S1', ['be']]])
    const entry = nextStage(calling, { kind: 'model', result: { id: 'skills', result: recommended } })
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
