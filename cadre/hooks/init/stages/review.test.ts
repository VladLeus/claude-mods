import { describe, expect, test } from 'claude-code/testing'

import type { InstructionHandout, Plan, RoleChange } from '../../../types'
import { REDACTED } from '../../core/redact'
import { proposeRoles } from '../../roles/propose'
import { recommend } from '../../roles/recommend'
import type { Gathered } from '../../scan/gather'
import { scopeCardLines } from '../../scope/card'
import { resolvedFramework, scopesFor } from '../../team'
import {
  cardOf,
  DEFAULT_LOCATIONS,
  driven,
  EMPTY_FACTS,
  emptySetupScan,
  gitWorld,
  memIo,
  repoScan,
  SECURITY_KEY,
  session,
  stateAt,
  templateRole,
  withFramework,
} from '../../testkit'
import { contextText, MAX_ASKS, NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import { proposalLines } from '../../ui/blocks/context'
import { recommendationLines } from '../../ui/blocks/recommendations'
import { PANE_PAGE_ROWS } from '../../ui/pane'
import { PREVIEW_ROWS } from '../../ui/preview'
import type { Surface } from '../../ui/surface'
import type { Draft, PlanResult } from '../draft'
import { initReplyText } from '../initapply'
import { nextStage, STAGES } from '../machine'
import { cancelledReply } from '../replies'
import { planStep } from '../run'
import type { Answer, InitState, ReviewItem } from '../state'
import { DURATION_OPTIONS } from './duration'
import { LAUNCH_START_OPTIONS } from './launch'
import { MODEL_MODE_QUESTION } from './model'
import { ROLES_QUESTION, rolesContextLine } from './roles'
import { GIT_POLICY_CONTEXT, GIT_POLICY_QUESTION } from './policy'
import {
  cardLines,
  improverRunLine,
  MAX_REVIEW_ROUNDS,
  parseReviewItem,
  PRIVATE_FILES_HEADING,
  privateFilesRow,
  REVIEW_DISMISSED_REASON,
  REVIEW_OPTIONS,
  REVIEW_QUESTION,
  REVIEW_ROUNDS_REASON,
  REVIEW_TYPE_HINT,
  reviewContextLine,
  reviewQuestion,
  reviewStage,
} from './review'

describe('what Confirm writes outside the repo (02-GAPS-B3 S4)', () => {
  test('the private files row, its heading and the improver line are fixed', () => {
    expect(privateFilesRow('be')).toBe(
      '    private files: <config dir>/cadre/<repo>-<hash8>/be/instructions/CLAUDE.md and instructions.json ' +
        '(outside the repo, never committed)',
    )
    expect(PRIVATE_FILES_HEADING).toBe('Private files per role (written after Confirm):')
    expect([improverRunLine(1), improverRunLine(2)]).toEqual([
      'After Confirm, claude-md-improver runs on up to 1 built file (claude -p, acceptEdits, up to 5 minutes each); ' +
        'you accept or keep each change.',
      'After Confirm, claude-md-improver runs on up to 2 built files (claude -p, acceptEdits, up to 5 minutes each); ' +
        'you accept or keep each change.',
    ])
  })
})

describe('question context lines (G-02-1)', () => {
  test('reviewContextLine is the plan summary, the git policy line and the launcher line', () => {
    const plan: Plan = { ops: [{ kind: 'create', path: '.cadre/bin/be', mode: 'exec', note: null }], warnings: [] }
    expect(reviewContextLine(plan, 'definitions', { kind: 'git-root' })).toBe(
      'Summary: 1 create, 0 change, 0 leave, 0 conflict, 0 hunks; ' +
        'Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root',
    )
    expect(reviewContextLine(plan, 'ignore', { kind: 'dir', path: 'apps/web' })).toBe(
      'Summary: 1 create, 0 change, 0 leave, 0 conflict, 0 hunks; ' +
        'Git policy: ignore all of .cadre/; Launchers start in: apps/web/ under the git root',
    )
  })
})

describe('init plan', () => {
  /** The scans of a session with nothing detected, a framework-free team on the built-in default. */
  const gathered: Gathered = {
    facts: { facts: EMPTY_FACTS, gsdUserDir: null },
    repo: repoScan({ codeDirs: ['src'] }),
    setup: emptySetupScan({ mcp: [session('jira')] }),
  }
  /** PM on the repo default, Team Lead on superpowers by its own framework, BE on the repo default. */
  const roles = [templateRole('pm'), withFramework(templateRole('tl'), 'superpowers'), templateRole('be')]

  test("cardLines gives the lines of every role's card in role order, and none for a role with no scope", () => {
    const scopes = scopesFor(roles, 'gsd', gathered, [], { kind: 'git-root' })
    expect(cardLines(roles, scopes)).toEqual(roles.flatMap(role => scopeCardLines(cardOf(scopes, role.id))))
    expect(cardLines([...roles, templateRole('qa')], scopes)).toEqual(cardLines(roles, scopes))
  })
})

describe('reviewStep', () => {
  test('the review question, the options a page may show and the round cap are fixed (D-43, D-233)', () => {
    expect(REVIEW_QUESTION).toBe(
      'Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.',
    )
    expect(REVIEW_OPTIONS).toEqual(['Next page', 'Previous page', 'Confirm', 'Change something…'])
    expect(Object.isFrozen(REVIEW_OPTIONS)).toBe(true)
    expect(MAX_REVIEW_ROUNDS).toBe(10)
    expect(REVIEW_DISMISSED_REASON).toBe('The review question was dismissed or not answered.')
    expect(REVIEW_ROUNDS_REASON).toBe('The review question was asked 10 times without "Confirm": nothing was chosen.')
  })

  test('parseReviewItem reads Confirm as its option gives it, or a typed item in any case; else null', () => {
    const cases: readonly (readonly [string, ReviewItem | null])[] = [
      ['Confirm', 'confirm'],
      [' confirm ', null],
      ['confirm', null],
      ['Change roles', 'roles'],
      ['roles', 'roles'],
      ['Change git policy', 'policy'],
      ['GIT POLICY', 'policy'],
      ['Change launcher start', 'launch'],
      ['launcher start', 'launch'],
      ['duration', 'duration'],
      ['Model', 'model'],
      ['assignments', 'assignments'],
      ['mcp', 'assignments'],
      ['skills', 'assignments'],
      ['memory', 'memory'],
      ['env', 'env'],
      [' hunks', 'hunks'],
      ['', null],
      ['yes', null],
      ['policy', null],
      ['change the model', null],
    ]
    for (const [answer, item] of cases) expect([answer, parseReviewItem(answer)]).toEqual([answer, item])
  })
})

describe('review question hint (G-02-7)', () => {
  test('reviewQuestion(null) is the question, then the typed-item hint on its own last line', () => {
    expect(REVIEW_TYPE_HINT).toBe(
      'Use a button, or type duration, model, assignments, memory, env or hunks under Other.',
    )
    expect(reviewQuestion(null)).toBe(
      'Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.\n' +
        'Use a button, or type duration, model, assignments, memory, env or hunks under Other.',
    )
    expect(reviewQuestion(null)).toBe(`${REVIEW_QUESTION}\n${REVIEW_TYPE_HINT}`)
  })

  test('a context line sits on its own line between the question and the hint, which always ends the text', () => {
    const context = 'Roles: PM, Team Lead, Security; 22 files planned.'
    expect(reviewQuestion(context).split('\n')).toEqual([REVIEW_QUESTION, context, REVIEW_TYPE_HINT])
    for (const given of [null, context]) expect(reviewQuestion(given).endsWith(`\n${REVIEW_TYPE_HINT}`)).toBe(true)
  })
})

/** A whole draft of a dry run over the testkit repo: the template team on the built-in default, nothing handed out. */
const REVIEW_DRAFT: Draft = {
  locations: DEFAULT_LOCATIONS,
  gathered: { facts: { facts: EMPTY_FACTS, gsdUserDir: null }, repo: repoScan(), setup: emptySetupScan() },
  readUserMcp: false,
  installed: ['none'],
  choice: { kind: 'none' },
  proposal: proposeRoles(repoScan()),
  hints: new Map(),
  duration: '4h',
  roles: proposeRoles(repoScan()).roles,
  changes: [],
  repoDefault: 'none',
  hunks: [],
  pluginInstalls: [],
  instructions: { kind: 'none' },
  policy: 'definitions',
  launchStart: { kind: 'git-root' },
}

/** The review stage entered with REVIEW_DRAFT (`over` changes the draft fields it names): its plan effect out. */
function reviewAt(over: Partial<Draft> = {}, state: Partial<InitState> = {}): InitState {
  return reviewStage.enter(stateAt('review', { ...REVIEW_DRAFT, ...over }, state))
}

/** The plan of the plan io effect `state` has out, made by planStep over the testkit git world. */
async function plannedFor(state: InitState): Promise<PlanResult> {
  const { effect } = state
  if (effect.kind !== 'io' || effect.call.id !== 'plan') throw new Error('no plan io effect is out')

  return planStep(memIo(gitWorld(), {}).io, effect.call.input)
}

/** The git policy question as the git policy stage asks it (D-136). */
const GIT_POLICY_ASK_TEXT = withContext(GIT_POLICY_QUESTION, GIT_POLICY_CONTEXT)

/** The answer to the plan io effect: the plan made. */
function planAnswer(planned: PlanResult): Answer {
  return { kind: 'io', result: { id: 'plan', result: planned } }
}

describe('the review stage (D-230)', () => {
  test('reviewStage plans the whole draft first, then shows the review block and asks; the open question', async () => {
    const state = reviewAt()
    expect(state.openQuestion).toBeNull()
    const planned = await plannedFor(state)
    const asking = nextStage(state, planAnswer(planned))
    const context = contextText(reviewContextLine(planned.plan, 'definitions', { kind: 'git-root' }))
    const blocks = asking.outputs.flatMap(output => (output.kind === 'show' ? [output.block] : []))
    const lines = blocks[0]?.lines ?? []
    const count = Math.ceil(lines.length / (PANE_PAGE_ROWS - 1))
    const own = { title: `Review (page 1 of ${count})`, lines: lines.slice(0, PANE_PAGE_ROWS - 1), kind: 'review' }
    const spec = { options: ['Next page', 'Confirm', 'Change something…'], header: 'Review', context: own }
    const ask = { question: reviewQuestion(context), spec }
    expect(asking.effect).toEqual({ kind: 'ask', ...ask })
    expect(asking.openQuestion).toEqual(ask)
    expect(blocks.map(block => [block.key, block.lines[0]])).toEqual([['review', 'Roles:']])
  })

  test('the review question carries the first page of the review block as its own context (D-236, D-233)', async () => {
    const state = reviewAt()
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const shown = asking.outputs.flatMap(output => (output.kind === 'show' ? output.block.lines : []))
    const page = shown.slice(0, PANE_PAGE_ROWS - 1)
    expect(asking.openQuestion?.spec.context?.lines).toEqual(page)
    const again = nextStage(asking, { kind: 'answer', text: 'maybe' })
    expect(again.openQuestion?.spec.context?.lines).toEqual(page)
  })

  test('Confirm on a --dry-run replies with the plan and the private files of each role; nothing written', async () => {
    const state = reviewAt()
    const planned = await plannedFor(state)
    const done = nextStage(nextStage(state, planAnswer(planned)), { kind: 'answer', text: 'Confirm' })
    const rows = [PRIVATE_FILES_HEADING, ...REVIEW_DRAFT.roles.map(role => privateFilesRow(role.id))]
    const reply = initReplyText(planned.plan, 'definitions', { kind: 'git-root' }, null, rows)
    expect([done.stage, done.effect]).toEqual(['done', { kind: 'end', reply }])
  })

  test('Confirm on a plain init sets the apply io effect of the confirmed draft and the plan just shown', async () => {
    const state = reviewAt({}, { dryRun: false })
    const planned = await plannedFor(state)
    const applying = nextStage(nextStage(state, planAnswer(planned)), { kind: 'answer', text: 'Confirm' })
    const reviewed = { draft: REVIEW_DRAFT, planned }
    expect(applying.effect).toEqual({ kind: 'io', call: { id: 'apply', reviewed } })
    expect(applying.openQuestion).toBeNull()
  })

  test('Change git policy goes back to the git policy stage, then the review again, counting a round', async () => {
    const state = reviewAt()
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const going = nextStage(asking, { kind: 'answer', text: 'Change git policy' })
    expect([going.stage, going.returnTo, going.returnAfter]).toEqual(['policy', 'review', 'policy'])
    expect(going.openQuestion?.question).toBe(GIT_POLICY_ASK_TEXT)
    const back = nextStage(going, { kind: 'answer', text: 'Commit all' })
    expect([back.stage, back.rounds, back.returnTo, back.returnAfter]).toEqual(['review', 1, null, null])
    expect(back.draft.policy).toBe('all')
    expect((await plannedFor(back)).state.gitPolicy).toBe('all')
  })

  test('Change launcher start goes back to the launcher start stage, then the review, counting a round', async () => {
    const state = reviewAt()
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const going = nextStage(asking, { kind: 'answer', text: 'Change launcher start' })
    expect([going.stage, going.returnTo, going.returnAfter]).toEqual(['launch', 'review', 'launch'])
    const lines = [
      'Git root: the top of this repo, the same for every launcher.',
      'Run folder: wherever you run a launcher from.',
      'Launchers: .cadre/bin/pm, .cadre/bin/tl, .cadre/bin/security',
    ]
    const context = { title: 'Launch', lines, kind: 'launch' }
    expect(going.openQuestion?.spec).toEqual({ options: LAUNCH_START_OPTIONS, header: 'Launch', context })
    const back = nextStage(going, { kind: 'answer', text: 'The folder I run it from' })
    expect([back.stage, back.rounds, back.returnTo, back.returnAfter]).toEqual(['review', 1, null, null])
    expect(back.draft.launchStart).toEqual({ kind: 'here' })
  })

  test('a typed duration goes back to the duration stage, asked though it is set, then the review again', async () => {
    const state = reviewAt()
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const going = nextStage(asking, { kind: 'answer', text: 'duration' })
    expect([going.stage, going.returnTo, going.returnAfter]).toEqual(['duration', 'review', 'duration'])
    const context = { title: 'Roles', lines: proposalLines(REVIEW_DRAFT.roles, []), kind: 'roles' }
    const spec = { options: DURATION_OPTIONS, header: 'Duration', context, acceptsTyped: true }
    expect(going.openQuestion?.spec).toEqual(spec)
    const back = nextStage(going, { kind: 'answer', text: '2h' })
    expect([back.stage, back.rounds, back.returnTo, back.returnAfter]).toEqual(['review', 1, null, null])
    expect(back.draft.duration).toBe('2h')
    expect(back.draft.roles?.map(role => role.autopilot.duration)).toEqual(REVIEW_DRAFT.roles.map(() => '2h'))
  })

  test('a typed model goes back to the model stage, then the review again, counting a round', async () => {
    const state = reviewAt()
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const going = nextStage(asking, { kind: 'answer', text: 'model' })
    expect([going.stage, going.returnTo, going.returnAfter]).toEqual(['model', 'review', 'model'])
    expect(going.openQuestion?.question.split('\n')[0]).toBe(MODEL_MODE_QUESTION)
    const back = driven(going, ['Same for all roles', 'opus + medium']).state
    expect([back.stage, back.rounds, back.returnTo, back.returnAfter]).toEqual(['review', 1, null, null])
    const modelled = REVIEW_DRAFT.roles.map(() => ['opus', 'medium'])
    expect(back.draft.roles?.map(role => [role.model, role.effort])).toEqual(modelled)
  })

  test('a typed env goes back to the carry stage, then the review again, counting a round', async () => {
    const carry = { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: ['API_KEY'] }
    const state = reviewAt({ gathered: { ...REVIEW_DRAFT.gathered, setup: emptySetupScan({ carry }) } })
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const going = nextStage(asking, { kind: 'answer', text: 'env' })
    expect([going.stage, going.returnTo, going.returnAfter]).toEqual(['carry', 'review', 'carry'])
    const env = ['Env variable names in your settings (values are never read):', '  API_KEY']
    const context = { title: 'Env variables', lines: env, kind: 'env' }
    const spec = { options: ['None', 'All of them'], header: 'Env', context, acceptsTyped: true }
    expect(going.openQuestion?.spec).toEqual(spec)
    const back = nextStage(going, { kind: 'answer', text: 'API_KEY' })
    expect([back.stage, back.rounds, back.returnTo, back.returnAfter]).toEqual(['review', 1, null, null])
    expect(back.draft.roles?.map(role => role.carry.env)).toEqual(REVIEW_DRAFT.roles.map(() => ['API_KEY']))
  })

  test('a typed hunks goes back to the hunk stage, its config read again, then the review again', async () => {
    const state = reviewAt({ repoDefault: 'gsd' })
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const going = nextStage(asking, { kind: 'answer', text: 'hunks' })
    expect([going.stage, going.returnTo, going.returnAfter]).toEqual(['hunks', 'review', 'hunks'])
    expect(going.effect.kind === 'io' ? going.effect.call.id : null).toBe('read-repo-file')
    const read = nextStage(going, { kind: 'io', result: { id: 'read-repo-file', result: { state: 'absent' } } })
    const back = driven(read, ['Accept', 'Accept']).state
    expect([back.stage, back.rounds, back.returnTo, back.returnAfter]).toEqual(['review', 1, null, null])
    expect(back.draft.hunks?.map(hunk => [hunk.key, hunk.isAccepted])).toEqual([
      ['mode', true],
      ['workflow.text_mode', true],
    ])
  })

  test('a typed assignments goes back to the assign stage, then the review again, counting a round', async () => {
    const setup = emptySetupScan({ mcp: [session('sentry')] })
    const state = reviewAt({ gathered: { ...REVIEW_DRAFT.gathered, setup } })
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const going = nextStage(asking, { kind: 'answer', text: 'assignments' })
    expect([going.stage, going.returnTo, going.returnAfter]).toEqual(['assign', 'review', 'assign'])
    const entry = nextStage(going, { kind: 'model', result: { id: 'mcp', result: new Map() } })
    const asked = nextStage(entry, { kind: 'answer', text: 'Whole group' })
    const lines = ['sentry: session, 0 tools. Recommended: none.']
    const context = { title: 'MCP servers', lines, kind: 'mcp-server' }
    const spec = { options: ['None', 'All roles'], header: 'MCP', context, acceptsTyped: true }
    expect(asked.openQuestion?.spec).toEqual(spec)
    const back = nextStage(asked, { kind: 'answer', text: 'All roles' })
    expect([back.stage, back.rounds, back.returnTo, back.returnAfter]).toEqual(['review', 1, null, null])
    expect(back.draft.roles?.map(role => role.mcp)).toEqual(REVIEW_DRAFT.roles.map(() => ['sentry']))
  })

  test('a typed memory goes back to the instructions stage, asks its questions again, then the review', async () => {
    const setup = emptySetupScan({ hasGlobalClaudeMd: true })
    const state = reviewAt({ gathered: { ...REVIEW_DRAFT.gathered, setup } })
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const going = nextStage(asking, { kind: 'answer', text: 'memory' })
    expect([going.stage, going.returnTo, going.returnAfter]).toEqual(['instructions', 'review', 'instructions'])
    const lines = ['~/.claude/CLAUDE.md and the files it imports']
    const context = { title: 'Global CLAUDE.md', lines, kind: 'memory-group' }
    const spec = { options: ['None', 'All roles'], header: 'Memory', context, acceptsTyped: true }
    expect(going.openQuestion?.spec).toEqual(spec)
    const back = nextStage(going, { kind: 'answer', text: 'All roles' })
    expect([back.stage, back.rounds, back.returnTo, back.returnAfter]).toEqual(['review', 1, null, null])
    expect(back.draft.roles?.map(role => role.instructions)).toEqual(REVIEW_DRAFT.roles.map(() => ['global-claude-md']))
  })

  test('Change roles asks the roles again from the current team, then each role step, then the review', async () => {
    const changes: readonly RoleChange[] = [{ roleId: 'fe', change: 'dropped', reason: 'No web code.', evidence: [] }]
    const state = reviewAt({ changes })
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const going = nextStage(asking, { kind: 'answer', text: 'Change roles' })
    expect([going.stage, going.returnTo, going.returnAfter]).toEqual(['roles', 'review', 'improver-install'])
    const asked = withContext(ROLES_QUESTION, rolesContextLine(REVIEW_DRAFT.roles, changes))
    expect(going.openQuestion?.question).toBe(asked)
    const chosen = nextStage({ ...going, outputs: [] }, { kind: 'answer', text: 'Use these roles' })
    expect([chosen.returnTo, chosen.returnAfter, chosen.rounds]).toEqual(['review', 'improver-install', 0])
    const keys = chosen.outputs.flatMap(output => (output.kind === 'show' ? [output.block.key] : []))
    expect(keys).toEqual(['recommendations'])
    const built: InstructionHandout = {
      kind: 'parts',
      scan: { parts: [], files: [], memories: [], warnings: [] },
      topics: [{ id: 'T1', title: 'Rules', summary: 'The team rules.', partIds: ['P1'] }],
      recommended: new Map(),
      given: new Map([['T1', ['pm']]]),
    }
    const last: InitState = { ...chosen, stage: 'improver-install', draft: { ...chosen.draft, instructions: built } }
    const improving = STAGES['improver-install'].enter({ ...last, sub: { kind: 'start' } })
    const back = nextStage(improving, { kind: 'answer', text: 'Not now' })
    expect([back.stage, back.rounds, back.returnTo, back.returnAfter]).toEqual(['review', 1, null, null])
  })

  test('a go-back picked at the last round cancels with REVIEW_ROUNDS_REASON and asks nothing more (A3)', async () => {
    const state = reviewAt({}, { rounds: MAX_REVIEW_ROUNDS - 1 })
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const ended = nextStage({ ...asking, outputs: [] }, { kind: 'answer', text: 'Change git policy' })
    expect(ended.effect).toEqual({ kind: 'end', reply: cancelledReply(REVIEW_ROUNDS_REASON) })
    expect(ended.outputs).toEqual([{ kind: 'log', text: REVIEW_ROUNDS_REASON }])
  })
})

describe('review redaction (WD-S5, #163)', () => {
  test('a secret-like span of a review line is hidden in the review block and its paged context', async () => {
    const [first] = REVIEW_DRAFT.roles
    const title = `Lead ${['token', 'ab12cd34ef56'].join('=')}`
    const roles = REVIEW_DRAFT.roles.map((role, at) => (at === 0 ? { ...role, title } : role))
    const state = reviewAt({ roles })
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const shown = asking.outputs.flatMap(output => (output.kind === 'show' ? output.block.lines : []))
    const context = asking.openQuestion?.spec.context?.lines ?? []
    const row = `  Lead token=${REDACTED} (${first?.id})`
    expect([shown.includes(row), context.includes(row)]).toEqual([true, true])
    expect(JSON.stringify([shown, context, asking.openQuestion?.question])).not.toContain('ab12cd34ef56')
  })
})

describe('the recommendations in the review (WD-M2, ROLE-03)', () => {
  /** REVIEW_DRAFT with a scan warning and the roles given: the review lines then sit between the two. */
  function draftWith(roles: Draft['roles']): Draft {
    const repo = repoScan({ warnings: ['could not list src'] })

    return { ...REVIEW_DRAFT, roles, gathered: { ...REVIEW_DRAFT.gathered, repo }, pluginInstalls: [SECURITY_KEY] }
  }

  /** The recommendation lines the security stage shows for a draft: recommend over the same inputs (ROLE-03). */
  function recommendedLines(draft: Draft): string[] {
    const frameworks = draft.roles.map(role => resolvedFramework(role, draft.repoDefault))
    const { roles, gathered } = draft

    return recommendationLines(recommend({ roles, frameworks, scan: gathered.repo, setup: gathered.setup }), roles)
  }

  /** The review block of a draft asked on `surface`, and the context of every page, paged with Next page (D-233). */
  async function reviewed(
    draft: Draft,
    surface: Surface,
  ): Promise<{ readonly lines: readonly string[]; readonly pages: readonly (readonly string[])[] }> {
    const entered = reviewStage.enter(stateAt('review', draft, { surface }))
    let state = nextStage(entered, planAnswer(await plannedFor(entered)))
    const lines = state.outputs.flatMap(output => (output.kind === 'show' ? output.block.lines : []))
    const pages: (readonly string[])[] = [state.openQuestion?.spec.context?.lines ?? []]
    while (state.openQuestion?.spec.options.includes('Next page') === true) {
      state = nextStage(state, { kind: 'answer', text: 'Next page' })
      pages.push(state.openQuestion?.spec.context?.lines ?? [])
    }

    return { lines, pages }
  }

  test('an FE team on no framework: the recommendations after the scan warnings, before the installs', async () => {
    const fe = templateRole('fe')
    const draft = draftWith([...REVIEW_DRAFT.roles, fe])
    const shown = recommendedLines(draft)
    const { lines } = await reviewed(draft, 'pane')
    const at = lines.indexOf(shown[0] ?? '')
    expect(lines.slice(at - 1, at + shown.length + 1)).toEqual([
      'warning: could not list src',
      ...shown,
      `Plugins to install after Confirm (a --dry-run installs nothing): ${SECURITY_KEY}`,
    ])
    const playwright = `- Playwright MCP for ${fe.title}: the FE role has no E2E setup to check its work in a browser`
    const run = '    run: claude mcp add playwright -- npx @playwright/mcp@latest'
    expect(shown.slice(shown.indexOf(playwright), shown.indexOf(playwright) + 2)).toEqual([playwright, run])
  })

  test('a team with nothing to recommend shows the one line the security stage shows for none', async () => {
    const draft = draftWith([withFramework(templateRole('pm'), 'superpowers')])
    const { lines } = await reviewed(draft, 'pane')
    expect(recommendedLines(draft)).toEqual(['Recommendations: none'])
    const at = lines.indexOf('Recommendations: none')
    expect(lines.slice(at - 1, at + 1)).toEqual(['warning: could not list src', 'Recommendations: none'])
  })

  test('the paged review reaches the recommendations on some page before Confirm, on each surface', async () => {
    const draft = draftWith([...REVIEW_DRAFT.roles, templateRole('fe')])
    const shown = recommendedLines(draft)
    for (const surface of ['pane', 'tui-default'] satisfies Surface[]) {
      const { lines, pages } = await reviewed(draft, surface)
      const flat = pages.flat()
      const at = flat.indexOf(shown[0] ?? '')
      expect([surface, flat, flat.slice(at, at + shown.length)]).toEqual([surface, lines, shown])
    }
  })
})

describe('the paged review on the TUI default (D-233, ASKED #4)', () => {
  /** The review asked on the TUI default over REVIEW_DRAFT: the state with its first page out, and the review lines. */
  async function tuiReview(state: Partial<InitState> = {}): Promise<{ readonly asking: InitState; lines: string[] }> {
    const entered = reviewAt({}, { surface: 'tui-default', ...state })
    const asking = nextStage(entered, planAnswer(await plannedFor(entered)))
    const lines = asking.outputs.flatMap(output => (output.kind === 'show' ? output.block.lines : []))

    return { asking, lines }
  }

  /** The review lines in pages of PREVIEW_ROWS - 1 lines (D-233). */
  function pagesOf(lines: readonly string[]): string[][] {
    const size = PREVIEW_ROWS - 1

    return Array.from({ length: Math.ceil(lines.length / size) }, (_, at) => lines.slice(at * size, (at + 1) * size))
  }

  test('a page offers Next page but last, Previous page but first, Confirm and Change something…', async () => {
    const { asking, lines } = await tuiReview()
    const pages = pagesOf(lines)
    expect(pages.length).toBeGreaterThan(2)
    expect(asking.openQuestion?.spec.options).toEqual(['Next page', 'Confirm', 'Change something…'])
    const second = nextStage(asking, { kind: 'answer', text: 'Next page' })
    expect(second.openQuestion?.spec.options).toEqual(['Next page', 'Previous page', 'Confirm', 'Change something…'])
    let last = second
    for (let page = 2; page < pages.length; page += 1) last = nextStage(last, { kind: 'answer', text: 'Next page' })
    expect(last.openQuestion?.spec.options).toEqual(['Previous page', 'Confirm', 'Change something…'])
  })

  test('each page is asked with that page as its context, titled with its place; no typed answer', async () => {
    const { asking, lines } = await tuiReview()
    const pages = pagesOf(lines)
    const titled = (at: number): string => `Review (page ${at + 1} of ${pages.length})`
    expect(asking.openQuestion?.spec.context).toEqual({ title: titled(0), lines: pages[0], kind: 'review' })
    expect(asking.openQuestion?.spec.acceptsTyped).toBeUndefined()
    const second = nextStage(asking, { kind: 'answer', text: 'Next page' })
    expect(second.openQuestion?.spec.context).toEqual({ title: titled(1), lines: pages[1], kind: 'review' })
    expect(second.openQuestion?.question).toBe(asking.openQuestion?.question)
    const back = nextStage(second, { kind: 'answer', text: 'Previous page' })
    expect(back.openQuestion?.spec.context).toEqual(asking.openQuestion?.spec.context)
  })

  test('paging never counts a round, and the page asks stay answerable past MAX_ASKS', async () => {
    const { asking } = await tuiReview({ rounds: MAX_REVIEW_ROUNDS - 1 })
    let state = asking
    for (let move = 0; move < MAX_ASKS + 1; move += 1) {
      state = nextStage(state, { kind: 'answer', text: move % 2 === 0 ? 'Next page' : 'Previous page' })
    }
    expect([state.stage, state.rounds, state.effect.kind]).toEqual(['review', MAX_REVIEW_ROUNDS - 1, 'ask'])
    const done = nextStage(state, { kind: 'answer', text: 'Confirm' })
    expect(done.stage).toBe('done')
  })

  test('Change something… with no item is asked again with the item words; a typed item goes back to it', async () => {
    const { asking } = await tuiReview()
    const again = nextStage(asking, { kind: 'answer', text: 'Change something…' })
    const [refusal] = (again.openQuestion?.question ?? '').split('\n')
    const words = ['roles', 'git policy', 'launcher start', 'duration', 'model', 'assignments', 'memory', 'env']
    expect(words.every(word => refusal?.includes(word))).toBe(true)
    expect(again.openQuestion?.spec.context).toEqual(asking.openQuestion?.spec.context)
    const going = nextStage(again, { kind: 'answer', text: 'roles' })
    expect([going.stage, going.returnTo, going.returnAfter]).toEqual(['roles', 'review', 'improver-install'])
    const policy = nextStage(asking, { kind: 'answer', text: 'git policy' })
    expect([policy.stage, policy.returnAfter]).toEqual(['policy', 'policy'])
  })

  test('a typed confirm is asked again: only the Confirm option confirms (T-02.1-78)', async () => {
    const { asking } = await tuiReview()
    for (const text of ['confirm', ' Confirm ', 'CONFIRM']) {
      const again = nextStage(asking, { kind: 'answer', text })
      expect([text, again.stage, again.effect.kind]).toEqual([text, 'review', 'ask'])
    }
    expect(nextStage(asking, { kind: 'answer', text: 'Confirm' }).stage).toBe('done')
  })

  test('the buttons of the paged review are its own: an unusable answer still cancels after MAX_ASKS', async () => {
    const { asking } = await tuiReview()
    let state = asking
    for (let tries = 0; tries < MAX_ASKS; tries += 1) state = nextStage(state, { kind: 'answer', text: 'maybe' })
    expect(state.effect).toEqual({ kind: 'end', reply: cancelledReply(NO_USABLE_ANSWER_REASON) })
  })
})

describe('the paged review on a pane surface (ASKED #19, #23)', () => {
  test('a page holds PANE_PAGE_ROWS - 1 review lines, with the options of the TUI default', async () => {
    const state = reviewAt()
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const shown = asking.outputs.flatMap(output => (output.kind === 'show' ? output.block.lines : []))
    expect([PANE_PAGE_ROWS, shown.length > 2 * (PANE_PAGE_ROWS - 1)]).toEqual([20, true])
    const second = nextStage(asking, { kind: 'answer', text: 'Next page' })
    const lines = shown.slice(PANE_PAGE_ROWS - 1, 2 * (PANE_PAGE_ROWS - 1))
    expect(second.openQuestion?.spec.context?.lines).toEqual(lines)
    expect(second.openQuestion?.spec.options).toEqual(['Next page', 'Previous page', 'Confirm', 'Change something…'])
    expect([second.rounds, second.openQuestion?.spec.acceptsTyped]).toEqual([0, undefined])
  })

  test('a review that fits one page offers Confirm and Change something… only, titled Review (ASKED #23)', async () => {
    const state = reviewAt({ roles: [] })
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const shown = asking.outputs.flatMap(output => (output.kind === 'show' ? output.block.lines : []))
    expect(shown.length < PANE_PAGE_ROWS).toBe(true)
    expect(asking.openQuestion?.spec.options).toEqual(['Confirm', 'Change something…'])
    expect(asking.openQuestion?.spec.context).toEqual({ title: 'Review', lines: shown, kind: 'review' })
  })

  test('the former Change buttons show on no surface, but their labels still go back to their items', async () => {
    const state = reviewAt()
    const asking = nextStage(state, planAnswer(await plannedFor(state)))
    const isFormer = (label: string): boolean => label.startsWith('Change ') && label !== 'Change something…'
    expect(asking.openQuestion?.spec.options.some(isFormer)).toBe(false)
    const going = nextStage(asking, { kind: 'answer', text: 'Change launcher start' })
    expect([going.stage, going.returnAfter]).toEqual(['launch', 'launch'])
  })
})

