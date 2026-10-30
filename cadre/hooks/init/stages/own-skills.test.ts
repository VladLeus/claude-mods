import { describe, expect, test } from 'claude-code/testing'

import type { InitIo, RoleSpec, SetupScan, SkillRef } from '../../../types'
import { proposeRoles } from '../../roles/propose'
import {
  EMPTY_FACTS,
  emptySetupScan,
  FULL_SCAN,
  memIo,
  memWorld,
  OWN_SKILLS_ENTRY_PREFIX,
  repoScan,
  roleIn,
  shownBlock,
  skillRef,
  stageStep,
  stateAt,
  valueOf,
  withEvents,
} from '../../testkit'
import type { MemRun } from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import type { InitState } from '../state'
import { assignStage } from './assign'
import { ASSIGNMENT_DISMISSED_REASON, ownSkillContextLine, skillsContextLine } from './own-skills'

/** The first row of the own-skills block (G-02-1b). */
const OWN_SKILLS_HEADING =
  'Skills with no plugin (a role given a skill can run it in its session; a role not given it cannot):'

/** The system prompt and the prompt of a run's completion at `at`, as memIo records them. */
function completionAt(run: MemRun, at: number): { readonly system: string; readonly prompt: string } {
  const [system = '', prompt = ''] = (run.prompts[at] ?? '').split('\n---\n')

  return { system, prompt }
}

/** The own-skills entry question of a hand-out of `count` skills (G-02-1b), as its first line reads. */
function ownEntry(count: number): string {
  return `${OWN_SKILLS_ENTRY_PREFIX} (${count})?`
}

/** The answers of the own-skills entry question, in the order the dialog shows them (G-02-1b). */
const OWN_ENTRY_OPTIONS = ['Accept recommendations', 'Go one by one', 'Whole group']

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

describe('own skills hand-out (G-02-1b)', () => {
  /** PM, Team Lead, BE, FE, QA and Security. */
  const roles = proposeRoles(FULL_SCAN).roles
  /** A codex plugin skill, and three of the user's own skills: mid and zeta used 4 times each, alpha never. */
  const setup = emptySetupScan({
    skills: [
      skillRef('codex:rescue', 'codex'),
      { name: 'alpha', plugin: null, purpose: 'Sort the inbox.' },
      { name: 'zeta', plugin: null },
      { name: 'mid', plugin: null, purpose: 'Draft the weekly report.' },
    ],
  })
  const hints = new Map([
    ['mid', 4],
    ['zeta', 4],
  ])
  /** The recommendation in the busiest-first order: S1 mid to BE, S2 zeta to FE, S3 alpha to no role. */
  const REPLY = '{"skills":{"S1":["be"],"S2":["fe"],"S3":[]}}'
  const CODEX_QUESTION = 'Which roles get codex skills (1)? (e.g. BE, QA, or none)'
  const ENTRY_CONTEXT = '3 skills with no plugin; the pane shows what each does and the roles it is recommended for.'
  /** The one-by-one questions as asked, busiest first and then by name, each with its context line. */
  const MID_ASKED =
    'Which roles get the skill mid?\nDraft the weekly report. Used 4 times in the last 50 sessions. Recommended: be.'
  const ZETA_ASKED =
    'Which roles get the skill zeta?\nNo description. Used 4 times in the last 50 sessions. Recommended: fe.'
  const ALPHA_ASKED = 'Which roles get the skill alpha?\nSort the inbox. Recommended: none.'

  test("an own skill's purpose with no final mark gets a period in its context line (N1)", () => {
    const deploy: SkillRef = { name: 'deploy', plugin: null, purpose: 'Deploy the app' }
    expect(ownSkillContextLine(deploy, 3, [])).toBe(
      'Deploy the app. Used 3 times in the last 50 sessions. Recommended: none.',
    )
  })

  /** The user's own skills a role was given, in the order its list keeps them. */
  function ownOf(assigned: readonly RoleSpec[], id: string): readonly string[] {
    return roleIn(assigned, id).skills.filter(name => ['alpha', 'mid', 'zeta'].includes(name))
  }

  /** A run of the step on `given` with these answers and replies; the result is checked to be accepted first. */
  async function stepRun(
    answers: readonly string[],
    replies: readonly string[] = [REPLY],
    given: readonly RoleSpec[] = roles,
  ): Promise<{ readonly run: MemRun; readonly assigned: readonly RoleSpec[] }> {
    const run = memIo(memWorld({ replies }), answers)
    const result = await assignedBy(run.io, given, setup, hints)
    expect(result.kind).toBe('accepted')

    return { run, assigned: result.kind === 'accepted' ? result.value : [] }
  }

  test('the plugin groups come first, then the entry question with its context, chip and three answers', async () => {
    const { run } = await stepRun(['None', 'Accept recommendations'])
    expect(run.asked).toEqual([
      withContext(CODEX_QUESTION, skillsContextLine(roles)),
      withContext(ownEntry(3), ENTRY_CONTEXT),
    ])
    expect(run.specs).toEqual([
      { options: ['None', 'All roles'], header: 'Skills' },
      { options: OWN_ENTRY_OPTIONS, header: 'Skills' },
    ])
  })

  test('one own skill is counted in the singular in the entry question and its context line', async () => {
    const one = emptySetupScan({ skills: [{ name: 'alpha', plugin: null }] })
    const run = memIo(memWorld({}), ['Accept recommendations'])
    expect((await assignedBy(run.io, roles, one)).kind).toBe('accepted')
    const context = '1 skill with no plugin; the pane shows what each does and the roles it is recommended for.'
    expect(run.asked).toEqual([withContext(ownEntry(1), context)])
  })

  test('after the plugin groups the model recommends, and the pane shows the skills busiest first', async () => {
    const run = memIo(memWorld({ replies: [REPLY] }), ['None', 'Accept recommendations'])
    const { io, events } = withEvents(run)
    await assignedBy(io, roles, setup, hints)
    expect(events).toEqual([`ask ${CODEX_QUESTION}`, 'show skills', `ask ${ownEntry(3)}`])
    expect(completionAt(run, 0).prompt.split('\n').slice(-3)).toEqual([
      'S1 | mid | Draft the weekly report. | used 4 times',
      'S2 | zeta | (no description) | used 4 times',
      'S3 | alpha | Sort the inbox. | used 0 times',
    ])
    expect(shownBlock(run, 'skills')).toEqual([
      OWN_SKILLS_HEADING,
      '  mid: Draft the weekly report.',
      '    used 4 times in the last 50 sessions; recommended: be',
      '  zeta: No description.',
      '    used 4 times in the last 50 sessions; recommended: fe',
      '  alpha: Sort the inbox.',
      '    recommended: none',
    ])
  })

  test('Accept recommendations gives each own skill its recommended roles; the plugin answer stays', async () => {
    const { run, assigned } = await stepRun(['All roles', 'Accept recommendations'])
    expect(roles.map(role => [role.id, ownOf(assigned, role.id)])).toEqual([
      ['pm', []],
      ['tl', []],
      ['be', ['mid']],
      ['fe', ['zeta']],
      ['qa', []],
      ['security', []],
    ])
    expect(assigned.filter(role => !role.skills.includes('codex:rescue'))).toEqual([])
    expect(run.asked).toHaveLength(2)
  })

  test('with no usable recommendation, Accept gives no own skill to any role', async () => {
    const { assigned } = await stepRun(['None', 'Accept recommendations'], [])
    expect(assigned.flatMap(role => role.skills)).toEqual([])
  })

  test('Go one by one asks each own skill once, busiest first, then by name: Yes, No and a role list', async () => {
    const { run, assigned } = await stepRun(['None', 'Go one by one', 'Yes', 'No', 'qa'])
    expect(run.asked.slice(2)).toEqual([MID_ASKED, ZETA_ASKED, ALPHA_ASKED])
    expect(run.specs.slice(2)).toEqual([
      { options: ['Yes', 'No'], header: 'Skill 1/3' },
      { options: ['Yes', 'No'], header: 'Skill 2/3' },
      { options: ['Yes', 'No'], header: 'Skill 3/3' },
    ])
    expect(roles.map(role => [role.id, ownOf(assigned, role.id)])).toEqual([
      ['pm', []],
      ['tl', []],
      ['be', ['mid']],
      ['fe', []],
      ['qa', ['alpha']],
      ['security', []],
    ])
  })

  test('a typed role list is read as a group answer is; an unknown role is asked again with why on top', async () => {
    const { run, assigned } = await stepRun(['None', 'Go one by one', 'cto', 'Team Lead, qa', 'No', 'No'])
    const refusal = `'cto' isn't one of: "Yes", "No", or role ids from: pm, tl, be, fe, qa, security.`
    expect(run.asked.slice(2, 4)).toEqual([MID_ASKED, `${refusal}\n${MID_ASKED}`])
    expect([ownOf(assigned, 'tl'), ownOf(assigned, 'qa'), ownOf(assigned, 'be')]).toEqual([['mid'], ['mid'], []])
  })

  test("Whole group asks today's group question for the own skills, with their uses", async () => {
    const { run, assigned } = await stepRun(['None', 'Whole group', 'All roles'])
    const own = 'Which roles get your own skills (3)? (used 8 times in recent sessions) (e.g. BE, QA, or none)'
    expect(run.asked.slice(2)).toEqual([withContext(own, skillsContextLine(roles))])
    expect(run.specs.at(-1)).toEqual({ options: ['None', 'All roles'], header: 'Skills' })
    expect(assigned.map(role => ownOf(assigned, role.id))).toEqual(roles.map(() => ['alpha', 'mid', 'zeta']))
  })

  test('a dismissal or three unreadable answers cancel with their reason at the question they hit (A1)', async () => {
    const cases: readonly (readonly [readonly string[], string, string])[] = [
      [['None'], ASSIGNMENT_DISMISSED_REASON, ownEntry(3)],
      [['None', 'zz', 'zz', 'zz'], NO_USABLE_ANSWER_REASON, ownEntry(3)],
      [['None', 'Go one by one', 'Yes'], ASSIGNMENT_DISMISSED_REASON, 'Which roles get the skill zeta?'],
      [['None', 'Go one by one', 'cto', 'cto', 'cto'], NO_USABLE_ANSWER_REASON, 'Which roles get the skill mid?'],
    ]
    for (const [answers, reason, question] of cases) {
      const run = memIo(memWorld({ replies: [REPLY] }), answers)
      expect(await assignedBy(run.io, roles, setup, hints)).toEqual({ kind: 'cancelled', reason })
      expect([answers, run.asked.at(-1)?.includes(question)]).toEqual([answers, true])
    }
  })

  test('a second run decides the own skills again: No takes away what Accept gave (A3)', async () => {
    const first = await stepRun(['None', 'Accept recommendations'])
    expect(ownOf(first.assigned, 'be')).toEqual(['mid'])
    const again = await stepRun(['None', 'Go one by one', 'No', 'No', 'No'], [REPLY], first.assigned)
    expect(again.assigned.flatMap(role => ownOf(again.assigned, role.id))).toEqual([])
  })

  test('a team with no own skill is asked no hand-out question, and the model is not called', async () => {
    const run = memIo(memWorld({ replies: [REPLY] }), ['All roles'])
    const plugins = emptySetupScan({ skills: [skillRef('codex:rescue', 'codex')] })
    valueOf(await assignedBy(run.io, roles, plugins, hints))
    expect(run.asked).toEqual([withContext(CODEX_QUESTION, skillsContextLine(roles))])
    expect(run.prompts).toEqual([])
  })

  test('a skill question cuts the name to 60 code points; past 12 code points the chip is just Skill', async () => {
    const names = Array.from({ length: 100 }, (_, at) => `s${String(at).padStart(3, '0')}`)
    const long = skillRef('n'.repeat(100))
    const many = emptySetupScan({ skills: [long, ...names.map(name => skillRef(name))] })
    const run = memIo(memWorld({}), ['Go one by one', ...Array.from({ length: 101 }, () => 'No')])
    expect((await assignedBy(run.io, roles, many)).kind).toBe('accepted')
    expect(run.asked[1]?.split('\n')[0]).toBe(`Which roles get the skill ${'n'.repeat(59)}…?`)
    expect([run.specs[99]?.header, run.specs[100]?.header, run.specs[101]?.header]).toEqual([
      'Skill 99/101',
      'Skill',
      'Skill',
    ])
  })
})

describe('own skills on a go-back (D-235)', () => {
  test('a go-back to the assignments asks with the kept recommendation and makes no model call', () => {
    const roles = proposeRoles(FULL_SCAN).roles
    const setup = emptySetupScan({ skills: [{ name: 'mine', plugin: null }] })
    const gathered = { facts: { facts: EMPTY_FACTS, gsdUserDir: null }, repo: repoScan(), setup }
    const ownSkills = new Map([['S1', ['be']]])
    const kept = { roleIds: roles.map(role => role.id), ownSkills, topics: null, parts: null }
    const draft = { roles, gathered, hints: new Map() }
    const back = { returnTo: 'review', returnAfter: 'assign', kept } satisfies Partial<InitState>
    const state = assignStage.enter(stateAt('assign', draft, back))
    expect(state.effect.kind).toBe('ask')
    expect(state.openQuestion?.question.split('\n')[0]).toBe(`${OWN_SKILLS_ENTRY_PREFIX} (1)?`)
    const shown = state.outputs.flatMap(output => (output.kind === 'show' ? output.block.lines : []))
    expect(shown).toContain('    recommended: be')
    const first = assignStage.enter(stateAt('assign', draft, { kept }))
    expect(first.effect.kind).toBe('model')
  })
})
