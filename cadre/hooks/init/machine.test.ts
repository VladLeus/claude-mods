import { describe, expect, test } from 'claude-code/testing'

import type { InstructionPart } from '../../types'
import type { GuardResult } from '../guards/repo'
import {
  DEFAULT_LOCATIONS,
  gitWorld,
  RECOMMENDED,
  scansOf,
  stateAt,
  TEMPLATE_ROLES,
  TOPICS,
  wholeDraft,
} from '../testkit'
import { NO_SURFACE } from '../ui/surfaces/none'
import { TUI_DEFAULT } from '../ui/surfaces/tui-default'
import { initialState, nextStage, STAGES } from './machine'
import { INIT_CANCELLED } from './replies'
import type { Answer, InitState } from './state'
import { assignStage } from './stages/assign'
import { instructionsStage } from './stages/instructions'
import { policyStage } from './stages/policy'

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
