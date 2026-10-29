import { describe, expect, test } from 'claude-code/testing'

import type { RoleSpec } from '../../../types'
import { proposeRoles } from '../../roles/propose'
import { emptySetupScan, firstLines, memIo, memWorld, repoScan, session, skillRef } from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import { assignmentStep, mcpContextLine } from './assign'
import { ASSIGNMENT_DISMISSED_REASON, skillsContextLine } from './own-skills'

/** A scan of a TypeScript repo with a React frontend and tests, so the template proposes all six roles. */
const FULL_SCAN = repoScan({
  languages: ['TypeScript'],
  hasSource: true,
  findings: [
    { kind: 'fe', label: 'react', evidence: 'package.json' },
    { kind: 'lang', label: 'JavaScript/TypeScript (package.json)', evidence: 'package.json' },
    { kind: 'test', label: 'JS/TS test files', evidence: 'src/a.test.ts' },
  ],
})

/** The value of an accepted step result; a cancelled one stops the test with its reason. */
function valueOf<T>(result: StepResult<T>): T {
  if (result.kind === 'cancelled') throw new Error(`the step was cancelled: ${result.reason}`)

  return result.value
}

/** The role with this id in what a step gave; a missing role stops the test with a clear message. */
function roleIn(roles: readonly RoleSpec[] | null, id: string): RoleSpec {
  const found = roles?.find(role => role.id === id)
  if (found === undefined) throw new Error(`no role ${id}`)

  return found
}

/** The buttons of every question on which roles get an item. */
const ROLE_LIST_OPTIONS = ['None', 'All roles']

describe('assignmentStep', () => {
  /** PM, Team Lead, BE, FE, QA and Security: a repo with a frontend and tests keeps every template role. */
  const roles = proposeRoles(FULL_SCAN).roles
  /** jira, which the table gives to PM and TL, the unknown sentry, security-review and two codex skills. */
  const setup = emptySetupScan({
    mcp: [session('jira'), session('sentry')],
    skills: [skillRef('security-review'), skillRef('codex:rescue', 'codex'), skillRef('codex:setup', 'codex')],
  })
  const SENTRY_QUESTION = 'Which roles get the sentry MCP server? (e.g. BE, QA, or none)'
  const CODEX_QUESTION = 'Which roles get codex skills (2)? (e.g. BE, QA, or none)'
  /** The two questions as asked: the team's role ids and what giving the item means under each (D-136). */
  const SENTRY_ASKED = withContext(SENTRY_QUESTION, mcpContextLine(roles))
  const CODEX_ASKED = withContext(CODEX_QUESTION, skillsContextLine(roles))

  test('the tables decide the known names; each unknown server and skill group is asked once', async () => {
    const run = memIo(memWorld({}), ['be', 'All roles'])
    const assigned = valueOf(await assignmentStep(run.io, roles, setup))
    expect(run.asked).toEqual([SENTRY_ASKED, CODEX_ASKED])
    expect(run.specs).toEqual([
      { options: ROLE_LIST_OPTIONS, header: 'MCP' },
      { options: ROLE_LIST_OPTIONS, header: 'Skills' },
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
    const run = memIo(memWorld({}), ['Team Lead, qa', 'None'])
    const assigned = valueOf(await assignmentStep(run.io, roles, setup))
    expect(roleIn(assigned, 'tl').mcp).toEqual(['jira', 'sentry'])
    expect(roleIn(assigned, 'qa').mcp).toEqual(['sentry'])
    expect(roleIn(assigned, 'pm').skills).toEqual([])
    expect(roleIn(assigned, 'security').skills).toEqual(['security-review'])
  })

  test('an answer that names a role the team does not have is asked again with why on top', async () => {
    const run = memIo(memWorld({}), ['cto', 'be', 'None'])
    const assigned = valueOf(await assignmentStep(run.io, roles, setup))
    expect(roleIn(assigned, 'be').mcp).toEqual(['sentry'])
    const refusal = `'cto' isn't one of: "None", "All roles", or role ids from: pm, tl, be, fe, qa, security.`
    expect(run.asked).toEqual([SENTRY_ASKED, `${refusal}\n${SENTRY_ASKED}`, CODEX_ASKED])
  })

  test('three unreadable answers or a dismissal cancel with their reason, and no answer is kept (A1)', async () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [['cto', 'cto', 'cto'], NO_USABLE_ANSWER_REASON],
      [[], ASSIGNMENT_DISMISSED_REASON],
      [['be'], ASSIGNMENT_DISMISSED_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(memWorld({}), answers)
      expect(await assignmentStep(run.io, roles, setup)).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(ASSIGNMENT_DISMISSED_REASON).toBe(
      'A question on which roles get an MCP server or skills was dismissed or not answered.',
    )
  })

  test('infra servers and handoff and framework skills are never asked about; nothing found asks nothing', async () => {
    const quiet = emptySetupScan({
      mcp: [session('autopilot'), session('github')],
      skills: [
        skillRef('create-handoff-doc'),
        skillRef('gsd-plan-phase'),
        skillRef('superpowers:brainstorming', 'superpowers'),
      ],
    })
    const run = memIo(memWorld({}), [])
    const assigned = valueOf(await assignmentStep(run.io, roles, quiet))
    expect(run.asked).toEqual([])
    expect(roleIn(assigned, 'tl').mcp).toEqual(['github'])
    expect(assigned.flatMap(role => role.skills)).toEqual([])
    const bare = await assignmentStep(memIo(memWorld({}), []).io, roles, emptySetupScan())
    expect(bare).toEqual({ kind: 'accepted', value: roles })
  })

  test('the roles it is given are never changed', async () => {
    const before = JSON.stringify(roles)
    await assignmentStep(memIo(memWorld({}), ['All roles', 'All roles']).io, roles, setup)
    expect(JSON.stringify(roles)).toBe(before)
  })

  test('a second run with None takes sentry and the codex skills away, and the table names stay (A3)', async () => {
    const first = valueOf(await assignmentStep(memIo(memWorld({}), ['All roles', 'All roles']).io, roles, setup))
    expect(first.map(role => role.mcp.includes('sentry'))).toEqual(roles.map(() => true))
    const again = valueOf(await assignmentStep(memIo(memWorld({}), ['None', 'None']).io, first, setup))
    expect(again.map(role => [role.id, role.mcp, role.skills])).toEqual([
      ['pm', ['jira'], []],
      ['tl', ['jira'], []],
      ['be', [], []],
      ['fe', [], []],
      ['qa', [], []],
      ['security', [], ['security-review']],
    ])
  })

  test('a narrower second answer leaves an asked server on the roles it names only (A3)', async () => {
    const first = valueOf(await assignmentStep(memIo(memWorld({}), ['All roles', 'None']).io, roles, setup))
    const again = valueOf(await assignmentStep(memIo(memWorld({}), ['be', 'None']).io, first, setup))
    expect(again.filter(role => role.mcp.includes('sentry')).map(role => role.id)).toEqual(['be'])
    expect(roleIn(again, 'tl').mcp).toEqual(['jira'])
  })
})

/** The start of the entry question of the user's own skills (G-02-1b), as an answer key matches it. */
const OWN_SKILLS_ENTRY_PREFIX = 'How do you want to hand out your own skills'

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
    valueOf(await assignmentStep(run.io, roles, setup, hints))
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
      valueOf(await assignmentStep(run.io, roles, setup, hints))
      expect(firstLines(run.asked)).toEqual(PLAIN_QUESTIONS)
    }
  })

  test('with hints each answer still decides the whole list of the names it asks about (A3)', async () => {
    const hints = new Map([['my-skill', 5]])
    const all = ['All roles', 'All roles', 'All roles', 'Whole group', 'All roles']
    const first = valueOf(await assignmentStep(memIo(memWorld({}), all).io, roles, setup, hints))
    expect(first.every(role => role.skills.includes('my-skill') && role.skills.includes('alpha:x'))).toBe(true)
    const again = valueOf(await assignmentStep(memIo(memWorld({}), NONE_FOR_ALL).io, first, setup, hints))
    expect(again.flatMap(role => [...role.mcp, ...role.skills])).toEqual([])
  })
})
