import { describe, expect, test } from 'claude-code/testing'

import type { Facts, FrameworkId, InitFacts, InstructionPart, RepoEntry, RoleSpec } from '../../types'
import { chooseFramework } from '../framework/contract'
import { detectAll } from '../framework/registry'
import type { GuardResult } from '../guards/repo'
import type { Gathered } from '../scan/gather'
import type { TeamState } from '../team'
import {
  DEFAULT_LOCATIONS,
  EMPTY_FACTS,
  emptySetupScan,
  gitWorld,
  PROVEN_FACTS,
  RECOMMENDED,
  repoScan,
  scansOf,
  stateAt,
  stateOf,
  templateRole,
  TEMPLATE_ROLES,
  TOPICS,
  wholeDraft,
  withFramework,
} from '../testkit'
import { NO_SURFACE } from '../ui/surfaces/none'
import { TUI_DEFAULT } from '../ui/surfaces/tui-default'
import type { PlanResult } from './draft'
import { frameworksState, initialState, nextStage, STAGES } from './machine'
import { cancelledReply, INIT_CANCELLED } from './replies'
import { FLOW_ORDER, STAGE_ORDER } from './state'
import type { Answer, InitState } from './state'
import { assignStage } from './stages/assign'
import { FRAMEWORK_DISMISSED_REASON, frameworksStage, installedFrameworks } from './stages/frameworks'
import { instructionsStage } from './stages/instructions'
import { pmPluginStage } from './stages/pm-plugin'
import { policyStage } from './stages/policy'
import { REVIEW_DISMISSED_REASON } from './stages/review'

/** What the launcher start stage after the git policy is entered with: the session's locations and the roles. */
const POLICY_DRAFT = { locations: DEFAULT_LOCATIONS, roles: TEMPLATE_ROLES }

/**
 * The init state with its own objects frozen (the state, its draft, cursor, effect, open question and outputs), so a
 * transition that writes into its input throws; the shared fixtures the draft points to are left as they are.
 */
function frozen(state: InitState): InitState {
  const parts: readonly unknown[] = [state.draft, state.sub, state.effect, state.openQuestion, state.outputs]
  for (const part of parts) Object.freeze(part)

  return Object.freeze(state)
}

describe('init stage machine (D-230)', () => {
  test('initialState starts at the guard with its effect out, no open question and nothing to show', () => {
    const state = initialState(true)
    expect(state.stage).toBe('guard')
    expect(state.dryRun).toBe(true)
    expect(state.effect.kind).not.toBe('ask')
    expect(state.effect.kind).not.toBe('end')
    expect(state.openQuestion).toBeNull()
    expect(state.outputs).toEqual([])
    expect(state.returnTo).toBeNull()
    expect(initialState(false).dryRun).toBe(false)
  })

  test('the PM plugin stage comes right after the assignments, before the instructions and improver install', () => {
    const at = STAGE_ORDER.indexOf('pm-plugin')

    expect([STAGE_ORDER[at - 1], STAGE_ORDER[at + 1]]).toEqual(['assign', 'instructions'])
    expect(at < STAGE_ORDER.indexOf('improver-install')).toBe(true)
    expect(STAGES['pm-plugin']).toBe(pmPluginStage)
  })

  test('initialState has no page width yet: the run reads it before each step (D-292)', () => {
    expect([initialState(true).pageColumns, initialState(false, TUI_DEFAULT).pageColumns]).toEqual([null, null])
  })

  test('initialState keeps the surface the run was given, a pane surface when none is given (D-208)', () => {
    expect(initialState(true, TUI_DEFAULT).surface.id).toBe('tui-default')
    expect(initialState(false, NO_SURFACE).surface.id).toBe('none')
    expect(initialState(true).surface.id).toBe('pane-desktop')
  })

  test('an answer whose kind does not match the open effect cancels init with the cancel reply (fail closed)', () => {
    const state = nextStage(initialState(true), { kind: 'answer', text: 'Commit all' })
    expect(state.stage).toBe('cancelled')
    expect(state.effect).toEqual({ kind: 'end', reply: INIT_CANCELLED })
    expect(state.openQuestion).toBeNull()
  })

  test('any answer once init is done or cancelled cancels it with the cancel reply (fail closed)', () => {
    const done = stateAt('done', {}, { effect: { kind: 'end', reply: 'cadre init --dry-run' } })
    const cancelled = nextStage(initialState(true), { kind: 'answer', text: 'yes' })
    for (const state of [done, cancelled]) {
      const next = nextStage(state, { kind: 'answer', text: 'yes' })
      expect(next.stage).toBe('cancelled')
      expect(next.effect).toEqual({ kind: 'end', reply: INIT_CANCELLED })
      expect(next.openQuestion).toBeNull()
    }
  })

  test('nextStage gives a new state and leaves the state it was given as it was', () => {
    const state = frozen(policyStage.enter(stateAt('policy', POLICY_DRAFT)))
    const next = nextStage(state, { kind: 'answer', text: 'Commit all' })
    expect(next).not.toBe(state)
    expect(state.stage).toBe('policy')
    expect(state.draft.policy).toBeUndefined()
    expect(state.effect.kind).toBe('ask')
    expect(next.draft.policy).toBe('all')
  })
})

describe('the guard and scan stages (D-230)', () => {
  test('the guard is an io effect: a refusal is the whole reply and logs nothing, else consent is next', () => {
    const state = initialState(true)
    expect(state.effect).toEqual({ kind: 'io', call: { id: 'guard' } })
    const refusal = { kind: 'io', result: { id: 'guard', result: { kind: 'refuse', text: 'no' } } } satisfies Answer
    const refused = nextStage(state, refusal)
    expect(refused.stage).toBe('done')
    expect(refused.effect).toEqual({ kind: 'end', reply: 'no' })
    expect(refused.outputs).toEqual([])
    const ok = { kind: 'ok', locations: DEFAULT_LOCATIONS } satisfies GuardResult
    const passed = nextStage(state, { kind: 'io', result: { id: 'guard', result: ok } })
    expect(passed.stage).toBe('consent')
    expect(passed.draft.locations).toBe(DEFAULT_LOCATIONS)
  })

  test('the scans are an io effect with the consent answer; their summary shows in no block of its own', async () => {
    const draft = { locations: DEFAULT_LOCATIONS, readUserMcp: false }
    const state = STAGES.scan.enter(stateAt('scan', draft))
    const call = { id: 'scan', locations: DEFAULT_LOCATIONS, readUserMcp: false }
    expect(state.effect).toEqual({ kind: 'io', call })
    const gathered = await scansOf(gitWorld())
    const next = nextStage(state, { kind: 'io', result: { id: 'scan', result: gathered } })
    // The history question's context, or a fold into the roles questions, shows the scan summary (D-302).
    expect(next.stage).toBe('history')
    expect(next.draft.gathered).toBe(gathered)
    expect(next.outputs).toEqual([])
  })
})

describe('kept model results (D-235)', () => {
  /** A whole draft whose setup has one skill of the user's own and a global CLAUDE.md. */
  const draft = wholeDraft({
    gathered: {
      ...wholeDraft().gathered,
      setup: { ...wholeDraft().gathered.setup, hasGlobalClaudeMd: true, skills: [{ name: 'mine', plugin: null }] },
    },
  })

  test('nextStage keeps the skills answer with the MCP answers of its call, the topics and the parts (D-253)', () => {
    expect(initialState(true).kept).toBeNull()
    const calling = assignStage.enter(stateAt('assign', draft))
    const skills = { own: new Map([['mine', ['pm']]]), groups: new Map(), groupSkills: new Map() }
    const recommended = nextStage(calling, { kind: 'model', result: { id: 'skills', result: skills } })
    const mcpAssigned = new Map(draft.roles.map(role => [role.id, []]))
    expect(recommended.kept).toEqual({ mcp: null, skills, mcpAssigned, topics: null, parts: null })
    const instructing = instructionsStage.enter(stateAt('instructions', draft, { kept: recommended.kept }))
    const repo = { rules: [], hasAgentsMd: false }
    const consent = nextStage(instructing, { kind: 'io', result: { id: 'repo-instruction-names', result: repo } })
    const reading = nextStage(consent, { kind: 'answer', text: 'Yes, read them' })
    const file = '~/.claude/CLAUDE.md'
    const part: InstructionPart = { id: 'P1', file, heading: 'Rules', source: 'global', text: 'x', hash: 'h' }
    const scan = { parts: [part], files: [file], memories: [], warnings: [] }
    const grouping = nextStage(reading, { kind: 'io', result: { id: 'read-instruction-files', result: scan } })
    const grouped = nextStage(grouping, { kind: 'model', result: { id: 'topics', result: TOPICS } })
    const parted = nextStage(grouped, { kind: 'model', result: { id: 'parts', result: RECOMMENDED } })
    expect(parted.kept).toEqual({ mcp: null, skills, mcpAssigned, topics: TOPICS, parts: RECOMMENDED })
  })
})

describe('the frameworks flow', () => {
  /** BE on GSD, Team Lead on superpowers, PM on none and QA on no framework of its own, as role.json stores them. */
  const STORED: readonly RoleSpec[] = [
    withFramework(templateRole('be'), 'gsd'),
    withFramework(templateRole('tl'), 'superpowers'),
    withFramework(templateRole('pm'), 'none'),
    templateRole('qa'),
  ]
  /** The facts of a repo whose GSD is proven and in use. */
  const GSD_IN_USE: InitFacts = {
    ...PROVEN_FACTS,
    facts: { ...PROVEN_FACTS.facts, repoEntries: [{ name: '.planning', kind: 'dir', isLink: false }] },
  }

  /** The scans of a repo whose cadre.json stores the frameworks `stored`, GSD in use. */
  function gatheredWith(stored: readonly FrameworkId[]): Gathered {
    const state = stateOf(STORED, { frameworks: stored })

    return { facts: GSD_IN_USE, repo: repoScan({ cadre: { ...repoScan().cadre, state } }), setup: emptySetupScan() }
  }

  /** The stored team: STORED with a cadre.json that commits all, starts at the git root and may read ~/.claude.json. */
  const TEAM: TeamState = {
    state: stateOf(STORED, { gitPolicy: 'all', readUserMcp: true, framework: 'gsd' }),
    roles: STORED,
    texts: new Map(),
  }

  /** The first state of a frameworks run over the scans of `stored`. */
  function started(stored: readonly FrameworkId[] = ['gsd']): InitState {
    const seed = { locations: DEFAULT_LOCATIONS, gathered: gatheredWith(stored), team: TEAM }

    return frameworksState(true, undefined, seed)
  }

  /** `.planning/` and `docs/` at the repo root, and `superpowers/` in docs: GSD and superpowers in use. */
  const PLANNING: RepoEntry = { name: '.planning', kind: 'dir', isLink: false }
  const DOCS: RepoEntry = { name: 'docs', kind: 'dir', isLink: false }
  const SUPERPOWERS_DOCS: RepoEntry = { name: 'superpowers', kind: 'dir', isLink: false }

  /** The frameworks stage of a re-init entered over `scanned`, its cadre.json storing the frameworks `stored`. */
  function reInitAt(scanned: Facts, stored: readonly FrameworkId[]): InitState {
    const state = stateOf(TEMPLATE_ROLES, { frameworks: stored })
    const repo = repoScan({ cadre: { ...repoScan().cadre, state } })
    const gathered = { facts: { facts: scanned, gsdUserDir: null }, repo, setup: emptySetupScan() }
    const detections = detectAll(scanned)
    const draft = wholeDraft({
      roles: TEMPLATE_ROLES,
      gathered,
      installed: installedFrameworks(detections),
      choice: chooseFramework(detections, null),
    })

    return frameworksStage.enter(stateAt('frameworks', draft))
  }

  /** A plan result that changes BE's ROLE.md. */
  const CHANGED: PlanResult = {
    plan: { ops: [{ kind: 'change', path: '.cadre/be/ROLE.md', mode: 'file', note: null }], warnings: [] },
    state: stateOf(STORED),
    desired: [],
    manifest: { schema: 1, cadreVersion: '0.2.0', files: [] },
    gitignore: null,
  }

  /** The run at its review with CHANGED planned: None kept, so no hunk is asked on the way. */
  function reviewing(): InitState {
    const framed = nextStage(started(), { kind: 'answer', text: 'None (built-in)' })

    return nextStage(framed, { kind: 'io', result: { id: 'reframe-plan', result: CHANGED } })
  }

  test('frameworksState seeds the draft from the stored team and the fresh scans, with no framework answer', () => {
    const gathered = gatheredWith(['gsd'])
    const { draft } = started()
    const detections = detectAll(gathered.facts.facts)
    expect([draft.locations, draft.gathered, draft.readUserMcp, draft.policy, draft.launchStart]).toEqual([
      DEFAULT_LOCATIONS,
      gathered,
      true,
      'all',
      { kind: 'git-root' },
    ])
    const detected = [installedFrameworks(detections), chooseFramework(detections, null)]
    expect([draft.installed, draft.choice]).toEqual(detected)
    expect([draft.frameworkSet, draft.repoDefault, draft.hunks, draft.gsdCheck]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  test('the seed clears every GSD or superpowers role value and keeps an explicit none', () => {
    const frameworks = (started().draft.roles ?? []).map(role => [role.id, role.framework])
    expect(frameworks).toEqual([['be', undefined], ['tl', undefined], ['pm', 'none'], ['qa', undefined]])
  })

  test('it asks the set question over a stored GSD and over a stored None, in the frameworks flow', () => {
    const storedSets: readonly (readonly FrameworkId[])[] = [['gsd'], []]
    for (const stored of storedSets) {
      const state = started(stored)
      expect([state.stage, state.flow, state.sub, state.outputs]).toEqual([
        'frameworks',
        'frameworks',
        { kind: 'set', tries: 1 },
        [],
      ])
    }
  })

  test('a re-init keeps a stored GSD in use but not installed, asks nothing and notes /cadre frameworks', () => {
    const state = reInitAt({ ...EMPTY_FACTS, repoEntries: [PLANNING] }, ['gsd'])
    const line =
      'Frameworks: GSD kept from cadre.json but not installed for this repo. Run /cadre frameworks to install.'

    expect([state.openQuestion, state.draft.frameworkSet, state.outputs]).toEqual([
      null,
      ['gsd'],
      [{ kind: 'note', line }],
    ])
  })

  test('a re-init keeping GSD and superpowers in use, neither installed, gives one note naming both', () => {
    const state = reInitAt({ ...EMPTY_FACTS, repoEntries: [PLANNING, DOCS], docsEntries: [SUPERPOWERS_DOCS] }, [
      'gsd',
      'superpowers',
    ])
    const line =
      'Frameworks: GSD and superpowers kept from cadre.json but not installed for this repo. ' +
      'Run /cadre frameworks to install.'

    expect([state.draft.frameworkSet, state.outputs]).toEqual([['gsd', 'superpowers'], [{ kind: 'note', line }]])
  })

  test('a re-init keeping a stored GSD with a proven GSD gives no note', () => {
    const state = reInitAt({ ...PROVEN_FACTS.facts, repoEntries: [PLANNING] }, ['gsd'])

    expect([state.openQuestion, state.draft.frameworkSet, state.outputs]).toEqual([null, ['gsd'], []])
  })

  test('the run goes frameworks, hunks, reframe-review; init keeps its own order', () => {
    const kept = nextStage(started(), { kind: 'answer', text: 'Keep GSD (Recommended)' })
    const none = nextStage(started(), { kind: 'answer', text: 'None (built-in)' })
    expect(FLOW_ORDER.frameworks).toEqual(['frameworks', 'hunks', 'reframe-review'])
    expect([kept.stage, none.stage, none.effect.kind]).toEqual(['hunks', 'reframe-review', 'io'])
    expect(FLOW_ORDER.init).toBe(STAGE_ORDER)
  })

  test('a dismissed set question ends with the frameworks cancel reply', () => {
    const dismissed = nextStage(started(), { kind: 'answer', text: null })
    expect(dismissed.effect).toEqual({ kind: 'end', reply: cancelledReply(FRAMEWORK_DISMISSED_REASON, 'frameworks') })
  })

  test('Cancel at the review and a dismissed review end with the frameworks cancel reply', () => {
    const cancelled = nextStage(reviewing(), { kind: 'answer', text: 'Cancel' })
    const dismissed = nextStage(reviewing(), { kind: 'answer', text: null })
    expect([cancelled.effect, dismissed.effect]).toEqual([
      { kind: 'end', reply: 'frameworks cancelled, nothing written: Cancel was chosen at the review.' },
      { kind: 'end', reply: cancelledReply(REVIEW_DISMISSED_REASON, 'frameworks') },
    ])
  })

  test('an init run keeps its cancel reply and its fail-closed text', () => {
    const dismissed = nextStage(policyStage.enter(stateAt('policy', POLICY_DRAFT)), { kind: 'answer', text: null })
    const failed = nextStage(initialState(true), { kind: 'answer', text: 'Commit all' })
    const reply = dismissed.effect.kind === 'end' ? dismissed.effect.reply : ''
    expect([reply.startsWith(`${INIT_CANCELLED}: `), failed.effect]).toEqual([
      true,
      { kind: 'end', reply: INIT_CANCELLED },
    ])
  })
})
