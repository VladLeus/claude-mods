import { describe, expect, test } from 'claude-code/testing'

import type { InitIo, McpRef, RoleSpec, SetupScan, SkillRef } from '../../../types'
import { SCREEN_LIST_WORDS } from '../../locales/t'
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
import {
  ASSIGNMENT_DISMISSED_REASON,
  mcpContextLine,
  mcpEntry,
  mcpServerItems,
  ownSkillContextLine,
  skillsContextLine,
} from './own-skills'

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

/** How the own-skills entry spreads its answers over its pages on a pane surface (D-306): Accept on the last only. */
const OWN_PAGE_OPTIONS = { always: ['Go one by one', 'Whole group'], dropped: [] }

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
  /**
   * The recommendation in the busiest-first order: S1 mid to BE, S2 zeta to FE, S3 alpha to no role, and the codex
   * group (G1) and its skill (G1S1) to no role (D-248).
   */
  const REPLY = '{"skills":{"S1":["be"],"S2":["fe"],"S3":[],"G1S1":[]},"groups":{"G1":[]}}'
  const CODEX_QUESTION = 'Which roles get codex skills (1)? (e.g. BE, QA, or none)'
  const ENTRY_CONTEXT = '3 skills with no plugin; the pane shows what each does and the roles it is recommended for.'
  /** The one-by-one questions as asked, busiest first and then by name, each with its context line. */
  const MID_ASKED =
    'Which roles get the skill mid?\nDraft the weekly report. Used 4 times in the last 50 sessions. Recommended: be.'
  const ZETA_ASKED =
    'Which roles get the skill zeta?\nNo description. Used 4 times in the last 50 sessions. Recommended: fe.'
  const ALPHA_ASKED = 'Which roles get the skill alpha?\nSort the inbox. Recommended: none.'
  /** The own-skills block after the recommendation, busiest first (G-02-1b). */
  const OWN_BLOCK = [
    OWN_SKILLS_HEADING,
    '  mid: Draft the weekly report.',
    '    used 4 times in the last 50 sessions; recommended: be',
    '  zeta: No description.',
    '    used 4 times in the last 50 sessions; recommended: fe',
    '  alpha: Sort the inbox.',
    '    recommended: none',
  ]
  /** Each own skill as its context line reads (D-211): what it does, its own uses and the recommended roles. */
  const MID_LINE = 'mid: Draft the weekly report. Used 4 times in the last 50 sessions. Recommended: be.'
  const ZETA_LINE = 'zeta: No description. Used 4 times in the last 50 sessions. Recommended: fe.'
  const ALPHA_LINE = 'alpha: Sort the inbox. Recommended: none.'
  /** The own-skills entry question's own context: the own-skills block. */
  /** The entry question as asked: its count line (D-136). */
  const ENTRY_ASKED = withContext(ownEntry(3), ENTRY_CONTEXT)
  /** The entry's summary, which a pane surface asks: the three skills, two of them recommended a role (D-310). */
  const OWN_SUMMARY = '3 skills, 2 recommended'
  /** Each own skill's item rows (D-311): `name → roles`, then what it does with its uses, or the placeholder. */
  const MID_ROWS = [
    { role: 'item', label: 'mid', text: 'be', indent: 2 },
    { role: 'description', text: 'Draft the weekly report. Used 4 times in the last 50 sessions.', indent: 4 },
  ]
  const ZETA_ROWS = [
    { role: 'item', label: 'zeta', text: 'fe', indent: 2 },
    { role: 'placeholder', text: 'no description', indent: 4 },
    { role: 'description', text: 'Used 4 times in the last 50 sessions.', indent: 4 },
  ]
  const ALPHA_ROWS = [
    { role: 'item', label: 'alpha', text: 'none', indent: 2 },
    { role: 'description', text: 'Sort the inbox.', indent: 4 },
  ]
  /** The rows of OWN_BLOCK the pane draws: the heading, then each skill's item rows, busiest first (D-311). */
  const OWN_ROWS = [{ role: 'heading', text: OWN_SKILLS_HEADING, indent: 0 }, ...MID_ROWS, ...ZETA_ROWS, ...ALPHA_ROWS]
  const OWN_CONTEXT = {
    title: 'Your own skills',
    lines: OWN_BLOCK,
    kind: 'skills',
    summary: OWN_SUMMARY,
    pane: { asked: ENTRY_ASKED, text: withContext(ownEntry(3), OWN_SUMMARY) },
    rows: [{ title: null, rows: OWN_ROWS }],
  }
  /**
   * The codex group question's own context: its one skill, never used and recommended to no role; a pane surface asks
   * the question alone, with no count or uses, and its summary: the skill count and the group's recommendation
   * (D-283, D-310).
   */
  const CODEX_CONTEXT = {
    title: 'Skills: codex',
    lines: ['Recommended: none', 'codex:rescue: No description. Recommended: none.'],
    kind: 'skill-group',
    summary: '1 skill. Recommended: none',
    pane: {
      asked: withContext(CODEX_QUESTION, skillsContextLine(roles)),
      text: withContext('Which roles get codex skills? (e.g. BE, QA, or none)', '1 skill. Recommended: none'),
    },
    rows: [
      {
        title: null,
        rows: [
          { role: 'recommended', label: 'Recommended', text: 'none', indent: 0 },
          { role: 'item', label: 'codex:rescue', text: 'none', indent: 2 },
          { role: 'placeholder', text: 'no description', indent: 4 },
        ],
      },
    ],
  }

  test("an own skill's purpose with no final mark gets a period in its context line (N1)", () => {
    const deploy: SkillRef = { name: 'deploy', plugin: null, purpose: 'Deploy the app' }
    expect(ownSkillContextLine(deploy, 3, [])).toBe(
      'Deploy the app. Used 3 times in the last 50 sessions. Recommended: none.',
    )
  })

  test("a secret-like span of an own skill's purpose is hidden in its context line (E1)", () => {
    const deploy: SkillRef = { name: 'deploy', plugin: null, purpose: 'Deploy with Bearer FAKE-TOKEN-0123' }
    expect(ownSkillContextLine(deploy, 0, ['be'])).toBe('Deploy with Bearer [hidden]. Recommended: be.')
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
    expect(run.asked).toEqual([withContext(CODEX_QUESTION, skillsContextLine(roles)), ENTRY_ASKED])
    expect(run.specs).toEqual([
      { options: ['Go one by one', 'None', 'All roles'], header: 'Skills', context: CODEX_CONTEXT, acceptsTyped: true },
      { options: OWN_ENTRY_OPTIONS, header: 'Skills', pageOptions: OWN_PAGE_OPTIONS, context: OWN_CONTEXT },
    ])
  })

  test('one own skill is counted in the singular in the entry question and its context line', async () => {
    const one = emptySetupScan({ skills: [{ name: 'alpha', plugin: null }] })
    const run = memIo(memWorld({ replies: ['{"skills":{"S1":["pm"]}}'] }), ['Accept recommendations'])
    expect((await assignedBy(run.io, roles, one)).kind).toBe('accepted')
    const context = '1 skill with no plugin; the pane shows what each does and the roles it is recommended for.'
    expect(run.asked).toEqual([withContext(ownEntry(1), context)])
  })

  test('the model recommends before the plugin groups; then the entry lists the skills busiest first', async () => {
    const run = memIo(memWorld({ replies: [REPLY] }), ['None', 'Accept recommendations'])
    const { io, events } = withEvents(run)
    await assignedBy(io, roles, setup, hints)
    expect(events).toEqual([`ask ${CODEX_QUESTION}`, `ask ${ownEntry(3)}`])
    expect(completionAt(run, 0).prompt.split('\n').slice(-6, -3)).toEqual([
      'S1 | mid | Draft the weekly report. | used 4 times',
      'S2 | zeta | (no description) | used 4 times',
      'S3 | alpha | Sort the inbox. | used 0 times',
    ])
    expect([run.shown, run.specs[1]?.context?.lines]).toEqual([[], OWN_BLOCK])
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

  test('with no usable recommendation Accept is not offered, and typing it is refused (D-279)', async () => {
    const { run, assigned } = await stepRun(['None', 'Accept recommendations', 'Whole group', 'None'], [])
    expect(run.specs[1]?.options).toEqual(['Go one by one', 'Whole group'])
    expect(run.asked[2]?.split('\n')[0]).toBe(
      `'Accept recommendations' isn't one of: "Go one by one", "Whole group".`,
    )
    expect(assigned.flatMap(role => role.skills)).toEqual([])
  })

  test('Go one by one asks each own skill once, busiest first, then by name: Yes, No and a role list', async () => {
    const { run, assigned } = await stepRun(['None', 'Go one by one', 'Yes', 'No', 'qa'])
    expect(run.asked.slice(2)).toEqual([MID_ASKED, ZETA_ASKED, ALPHA_ASKED])
    // A pane surface asks each skill's question with its summary, the roles recommended for it (D-310).
    const specAt = (at: number, line: string, asked: string, items: readonly unknown[]): unknown => {
      const [sentence = ''] = asked.split('\n')
      const summary = `Recommended: ${['be', 'fe', 'none'][at - 1]}`
      const pane = { asked, text: withContext(sentence, summary) }
      const rows = [{ title: null, rows: items }]
      const context = { title: `Skill ${at} of 3`, lines: [line], kind: 'skill', summary, pane, rows }

      return { options: ['Yes', 'No'], header: `Skill ${at}/3`, context, acceptsTyped: true }
    }
    expect(run.specs.slice(2)).toEqual([
      specAt(1, MID_LINE, MID_ASKED, MID_ROWS),
      specAt(2, ZETA_LINE, ZETA_ASKED, ZETA_ROWS),
      specAt(3, ALPHA_LINE, ALPHA_ASKED, ALPHA_ROWS),
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
    // A pane surface asks the whole-group question alone with its summary: the own skills have no group
    // recommendation (D-283, D-310).
    const short = 'Which roles get your own skills? (e.g. BE, QA, or none)'
    const summary = '3 skills. Recommended: none'
    const pane = { asked: withContext(own, skillsContextLine(roles)), text: withContext(short, summary) }
    const lines = [ALPHA_LINE, MID_LINE, ZETA_LINE]
    const rows = [{ title: null, rows: [...ALPHA_ROWS, ...MID_ROWS, ...ZETA_ROWS] }]
    const context = { title: 'Skills: your own', lines, kind: 'skill-group', summary, pane, rows }
    expect(run.specs.at(-1)).toEqual({ options: ['None', 'All roles'], header: 'Skills', context, acceptsTyped: true })
    expect(assigned.map(role => ownOf(assigned, role.id))).toEqual(roles.map(() => ['alpha', 'mid', 'zeta']))
  })

  test('each own-skills question carries its own context: the group, the entry, then each skill (D-211)', async () => {
    const { run } = await stepRun(['None', 'Go one by one', 'No', 'No', 'No'])
    expect(run.specs.map(spec => spec.context?.kind)).toEqual(['skill-group', 'skills', 'skill', 'skill', 'skill'])
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

  test('a team with no own skill is asked no hand-out question; the model is asked about its group only', async () => {
    const run = memIo(memWorld({ replies: ['{"skills":{"G1S1":[]},"groups":{"G1":[]}}'] }), ['All roles'])
    const plugins = emptySetupScan({ skills: [skillRef('codex:rescue', 'codex')] })
    valueOf(await assignedBy(run.io, roles, plugins, hints))
    expect(run.asked).toEqual([withContext(CODEX_QUESTION, skillsContextLine(roles))])
    expect(run.prompts).toHaveLength(1)
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
    const skills = { own: new Map([['mine', ['be']]]), groups: new Map(), groupSkills: new Map() }
    const mcpAssigned = new Map(roles.map(role => [role.id, []]))
    const kept = { mcp: null, skills, mcpAssigned, topics: null, parts: null }
    const draft = { roles, gathered, hints: new Map() }
    const back = { returnTo: 'review', returnAfter: 'assign', kept } satisfies Partial<InitState>
    const state = assignStage.enter(stateAt('assign', draft, back))
    expect(state.effect.kind).toBe('ask')
    expect(state.openQuestion?.question.split('\n')[0]).toBe(`${OWN_SKILLS_ENTRY_PREFIX} (1)?`)
    expect(state.outputs).toEqual([])
    expect(state.openQuestion?.spec.context?.lines).toContain('    recommended: be')
    const first = assignStage.enter(stateAt('assign', draft, { kept }))
    expect(first.effect.kind).toBe('model')
  })
})

describe('the MCP hand-out (D-250)', () => {
  const roles = proposeRoles(FULL_SCAN).roles

  test('the entry asks which roles get the servers and how many, with the MCP chip and the shared answers', () => {
    expect(mcpEntry(2)).toEqual({
      question: 'Which roles get the MCP servers (2)? Pick how to hand them out.',
      contextLine: '2 MCP servers; each question shows its source, its tools and the roles it is recommended for.',
      header: 'MCP',
      accept: 'Accept recommendations',
      oneByOne: 'Go one by one',
      whole: 'Whole group',
    })
    expect(mcpEntry(1).contextLine.startsWith('1 MCP server;')).toBe(true)
  })

  test('each server is an item with its question, chip, recommendation and own context', () => {
    const servers: readonly McpRef[] = [
      { name: 'github', source: 'session' },
      { name: 'sentry', source: 'project' },
    ]
    const tools = ['mcp__github__search', 'mcp__sentry__issues']
    const items = mcpServerItems(servers, tools, new Map([['github', ['tl']]]), roles, SCREEN_LIST_WORDS)
    expect(items.map(item => [item.id, item.question, item.header, item.recommended])).toEqual([
      ['github', 'Which roles get the github MCP server? (e.g. BE, QA, or none)', 'MCP 1/2', ['tl']],
      ['sentry', 'Which roles get the sentry MCP server? (e.g. BE, QA, or none)', 'MCP 2/2', []],
    ])
    expect(items.every(item => item.contextLine === mcpContextLine(roles))).toBe(true)
    expect(items[1]?.context).toEqual({
      title: 'MCP: sentry',
      lines: ['Source: .mcp.json', 'Tools: 1 (issues)', 'Recommended: none'],
      kind: 'mcp-server',
      summary: 'Recommended: none',
      rows: [
        {
          title: null,
          rows: [
            { role: 'field', label: 'Source', text: '.mcp.json', indent: 0 },
            { role: 'plain', text: 'Tools: 1 (issues)', indent: 0 },
            { role: 'recommended', label: 'Recommended', text: 'none', indent: 0 },
          ],
        },
      ],
    })
  })
})
