import { describe, expect, test } from 'claude-code/testing'

import type {
  Detection,
  DetectStatus,
  Facts,
  FrameworkId,
  RoleChange,
  RoleProposal,
  RoleSpec,
  UnsupportedId,
} from '../../../types'
import { detectAll } from '../../framework/registry'
import { proposeRoles } from '../../roles/propose'
import { gatherScans } from '../../scan/gather'
import { MAX_PROPOSE_ATTEMPTS } from '../../suggest/checked'
import { PROPOSE_SYSTEM, rolesFromProposal } from '../../suggest/propose'
import type { Proposed } from '../../suggest/propose'
import {
  DEFAULT_LOCATIONS,
  EMPTY_FACTS,
  firstLines,
  FRAMEWORKS,
  FULL_SCAN,
  gitWorld,
  leaks,
  memIo,
  memWorld,
  shownBlock,
  driven,
  SOURCE_SCAN,
  stageRun,
  stateAt,
  templateRole,
  withEvents,
} from '../../testkit'
import type { MemRun } from '../../testkit'
import { MAX_ASKS, NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import { nextStage } from '../machine'
import type { InitState } from '../state'
import {
  ADJUST_DISMISSED_REASON,
  ADJUST_OPTIONS,
  ADJUST_QUESTION,
  ADJUST_ROUNDS_NOTE,
  adjustContextLine,
  DESCRIBE_CANCELLED_REASON,
  DESCRIBE_CONTEXT,
  DESCRIBE_OPTIONS,
  DESCRIBE_QUESTION,
  installedFrameworks,
  MAX_ADJUST_ROUNDS,
  MAX_ROLE_ROUNDS,
  proposalLines,
  ROLE_ROUNDS_REASON,
  ROLES_DISMISSED_REASON,
  ROLES_OPTIONS,
  ROLES_QUESTION,
  rolesContextLine,
  rolesStage,
} from './roles'

/** A model reply that describes a BE role and a docs role with no template base. */
const DESCRIBED_REPLY =
  '{"roles":[{"id":"be","title":"BE","purpose":"API","basedOn":"be"},' +
  '{"id":"docs","title":"Docs","purpose":"docs","basedOn":null}]}'

/** The roles DESCRIBED_REPLY stands for. */
const DESCRIBED_ROLES = rolesFromProposal([
  { id: 'be', title: 'BE', purpose: 'API', basedOn: 'be' },
  { id: 'docs', title: 'Docs', purpose: 'docs', basedOn: null },
])

/** The person's description the describe tests type. */
const DESCRIPTION = 'we have a BE and a docs writer'

/** A detection of one framework or marker with this status, as detectAll gives it. */
function detection(id: FrameworkId | UnsupportedId, status: DetectStatus): Detection {
  return { id, name: id, status, version: null, evidence: [] }
}

/** The roles stage at its start: `proposal` with the frameworks `installed`, from `start` when asked again (A6). */
function rolesAt(proposal: RoleProposal, installed: readonly FrameworkId[], start?: RoleProposal): InitState {
  const again = start === undefined ? {} : { roles: start.roles, changes: start.changes }

  return stateAt('roles', { proposal, installed, ...again })
}

/** How the roles stage ended, as the roles step gave it: the roles accepted with their changes, or why it cancelled. */
function rolesResult(end: InitState): StepResult<RoleProposal> | null {
  if (end.sub.kind === 'cancelled') return { kind: 'cancelled', reason: end.sub.reason }
  const { roles, changes } = end.draft
  if (end.sub.kind !== 'done' || roles === undefined || changes === undefined) return null

  return { kind: 'accepted', value: { roles, changes } }
}

/** The roles the roles stage ended with; null when it was cancelled. */
function rolesOf(end: InitState): readonly RoleSpec[] | null {
  const result = rolesResult(end)

  return result === null || result.kind === 'cancelled' ? null : result.value.roles
}

/** The proposal of a repo with source code and no UI framework: the template with FE dropped. */
const PROPOSAL = proposeRoles(SOURCE_SCAN)

/** The roles stage run over a port with these model replies and answers, from the questions on PROPOSAL. */
async function rolesRun(
  answers: readonly string[],
  replies: readonly string[] = [],
  proposal: RoleProposal = PROPOSAL,
  installed: readonly FrameworkId[] = FRAMEWORKS,
): Promise<{ readonly run: MemRun; readonly end: InitState }> {
  const run = memIo(memWorld({ replies }), answers)
  const end = await stageRun(run.io, rolesStage, rolesAt(proposal, installed))

  return { run, end }
}

/** The fallback sentence that ends the line init prints when the described structure cannot be used. */
const FALLBACK_END = 'Using the template proposal; you can still adjust it.'

/** The refusal on top of the describe question when it is asked again after a blank answer (D-136). */
const EMPTY_DESCRIPTION =
  `An empty answer isn't one of: a description of your roles, "Use the template instead", "Cancel init".`

/** The describe question as it is asked: the question, then its context line (D-136). */
const DESCRIBE_ASKED = withContext(DESCRIBE_QUESTION, DESCRIBE_CONTEXT)

describe('proposalLines', () => {
  test('the proposal lists each role with its title, id and purpose, then each scan change with its reason', () => {
    const proposal = proposeRoles(SOURCE_SCAN)
    expect(proposalLines(proposal.roles, proposal.changes)).toEqual([
      'Proposed roles:',
      `  ${'PM (pm)'.padEnd(24)}Owns product decisions: scope, requirements and acceptance.`,
      `  ${'Team Lead (tl)'.padEnd(24)}Owns architecture and QA decisions; reviews and merges the work.`,
      `  ${'BE (be)'.padEnd(24)}Implements the backend and core code.`,
      `  ${'QA (qa)'.padEnd(24)}Owns tests and end-to-end checks.`,
      `  ${'Security (security)'.padEnd(24)}Owns security decisions and reviews.`,
      'Changes from the scan:',
      '  kept be: source code found (TypeScript), no UI framework (package.json)',
      '  dropped fe: no frontend framework found (react, vue, next, svelte, angular)',
    ])
  })

  test('evidence paths are joined with commas, and no change at all reads none', () => {
    const roles = proposeRoles(FULL_SCAN).roles
    const change: RoleChange = { roleId: 'be', change: 'kept', reason: 'r', evidence: ['a.ts', 'b/c.go'] }
    expect(proposalLines(roles, [change]).slice(-1)).toEqual(['  kept be: r (a.ts, b/c.go)'])
    expect(proposalLines(roles, []).slice(-2)).toEqual(['Changes from the scan:', '  none'])
  })

  test('a title and id of 24 characters or more still leave one space before the purpose', () => {
    const [first] = DESCRIBED_ROLES
    if (first === undefined) throw new Error('no described role')
    const long = { ...first, id: 'backend-api', title: 'Backend API team' }
    expect(proposalLines([long], [])[1]).toBe('  Backend API team (backend-api) API')
  })
})

describe('describeStep', () => {
  /** The answer that asks the describe question, and the answer that accepts the roles asked about after it. */
  const DESCRIBE = 'Describe my own structure'
  const USE = 'Use these roles'

  test('a description the model turns into valid roles gives those roles', async () => {
    const { run, end } = await rolesRun([DESCRIBE, DESCRIPTION, USE], [DESCRIBED_REPLY])
    expect(rolesResult(end)).toEqual({ kind: 'accepted', value: { roles: DESCRIBED_ROLES, changes: [] } })
    expect(run.asked[1]).toBe(DESCRIBE_ASKED)
    expect(run.specs[1]).toEqual({ options: ['Use the template instead', 'Cancel init'], header: 'Describe' })
  })

  test('the prompt is the propose system text and the description as a JSON string', async () => {
    const { run } = await rolesRun([DESCRIBE, DESCRIPTION, USE], [DESCRIBED_REPLY])
    expect(run.prompts).toHaveLength(1)
    expect(run.prompts[0]?.startsWith(`${PROPOSE_SYSTEM}\n---\n`)).toBe(true)
    expect(run.prompts[0]).toContain(JSON.stringify(DESCRIPTION))
  })

  test('an invalid reply is sent back with its exact errors, three model calls in all', async () => {
    const { run, end } = await rolesRun([DESCRIBE, DESCRIPTION, USE], ['not json', DESCRIBED_REPLY])
    expect(rolesOf(end)).toEqual(DESCRIBED_ROLES)
    expect(run.prompts).toHaveLength(2)
    expect(run.prompts[0]).not.toContain('the reply is not JSON')
    expect(run.prompts[1]).toContain('- the reply is not JSON')
    expect(MAX_PROPOSE_ATTEMPTS).toBe(3)
  })

  test('after three invalid replies it falls back to the template and says why', async () => {
    const { run, end } = await rolesRun([DESCRIBE, DESCRIPTION, USE], ['not json', '{"roles":"x"}', '{"roles":[]}'])
    expect(run.logged).toEqual([
      `Could not use the described structure: no roles: describe at least one role. ${FALLBACK_END}`,
    ])
    expect(rolesResult(end)).toEqual({ kind: 'accepted', value: PROPOSAL })
    expect(run.prompts).toHaveLength(3)
  })

  test('a model that gives no text is retried and then falls back with that reason', async () => {
    const { run } = await rolesRun([DESCRIBE, DESCRIPTION, USE])
    expect(run.logged).toEqual([`Could not use the described structure: the model gave no text. ${FALLBACK_END}`])
    expect(run.prompts).toHaveLength(3)
  })

  test('many errors are cut so the reason line still ends with the fallback sentence', async () => {
    const badIds = Array.from({ length: 13 }, (_, index) => ({ id: `Bad_${index}`, title: 'x', purpose: 'y' }))
    const reply = JSON.stringify({ roles: badIds })
    const { run } = await rolesRun([DESCRIBE, DESCRIPTION, USE], [reply, reply, reply])
    const [message = ''] = run.logged
    expect(message.startsWith('Could not use the described structure: ')).toBe(true)
    expect(message.endsWith(FALLBACK_END)).toBe(true)
    expect(Array.from(message).length <= 240).toBe(true)
  })

  test('a blank description is asked again with why on top, and never sent to the model', async () => {
    const { run, end } = await rolesRun([DESCRIBE, '   ', '', DESCRIPTION, USE], [DESCRIBED_REPLY])
    expect(rolesOf(end)).toEqual(DESCRIBED_ROLES)
    const again = `${EMPTY_DESCRIPTION}\n${DESCRIBE_ASKED}`
    expect(run.asked.slice(1, 4)).toEqual([DESCRIBE_ASKED, again, again])
    expect(run.prompts).toHaveLength(1)
  })

  test('the template answer makes no model call; Cancel init, a dismissal or 3 blank answers cancel', async () => {
    const template = await rolesRun([DESCRIBE, 'Use the template instead', USE], [DESCRIBED_REPLY])
    expect(rolesResult(template.end)).toEqual({ kind: 'accepted', value: PROPOSAL })
    expect(template.run.prompts).toEqual([])
    const cancelledBy = { kind: 'cancelled', reason: DESCRIBE_CANCELLED_REASON }
    const cancel = await rolesRun([DESCRIBE, 'Cancel init'], [DESCRIBED_REPLY])
    expect(rolesResult(cancel.end)).toEqual(cancelledBy)
    expect(cancel.run.prompts).toEqual([])
    expect(rolesResult((await rolesRun([DESCRIBE])).end)).toEqual(cancelledBy)
    const blank = await rolesRun([DESCRIBE, '', ' ', '  ', DESCRIPTION], [DESCRIBED_REPLY])
    expect(rolesResult(blank.end)).toEqual({ kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON })
    expect([blank.run.asked.length - 1, blank.run.prompts]).toEqual([MAX_ASKS, []])
    expect(DESCRIBE_OPTIONS).toEqual(['Use the template instead', 'Cancel init'])
    expect(Object.isFrozen(DESCRIBE_OPTIONS)).toBe(true)
  })

  test('the describe question says to type the structure in the text field', () => {
    expect(DESCRIBE_QUESTION).toBe('Describe your role structure in your own words (type it in the text field).')
  })
})

describe('adjustLoop', () => {
  const full = proposeRoles(FULL_SCAN)
  const roles = full.roles
  /** The Adjust question as it is asked while the roles are unchanged: its context names all six (D-136). */
  const ASKED = withContext(ADJUST_QUESTION, adjustContextLine(roles))

  /**
   * The roles stage on the FULL_SCAN proposal: `Adjust them`, then `answers` to the Adjust question, then
   * `Use these roles` for the roles question asked after it; `adjusts` are the Adjust asks.
   */
  async function adjustRun(
    answers: readonly string[],
    installed: readonly FrameworkId[] = FRAMEWORKS,
  ): Promise<{ readonly run: MemRun; readonly end: InitState; readonly adjusts: string[] }> {
    const { run, end } = await rolesRun(['Adjust them', ...answers, 'Use these roles'], [], full, installed)

    return { run, end, adjusts: run.asked.slice(1, -1) }
  }

  test('one typed change per answer until Done adjusting: drop and add', async () => {
    const { run, end, adjusts } = await adjustRun(['drop fe', 'add docs "Docs writer"', 'Done adjusting'])
    const adjusted = rolesOf(end)
    expect(adjusted?.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'qa', 'security', 'docs'])
    expect(adjusted?.find(role => role.id === 'docs')?.title).toBe('Docs writer')
    expect(firstLines(adjusts)).toEqual([ADJUST_QUESTION, ADJUST_QUESTION, ADJUST_QUESTION])
    expect(run.specs[1]).toEqual({ options: ['Done adjusting', 'Show the roles'], header: 'Adjust' })
  })

  test('rename and framework change one role and keep the others', async () => {
    const { end } = await adjustRun(['rename be api "API"', 'framework qa gsd', 'Done adjusting'])
    const adjusted = rolesOf(end)
    expect(adjusted?.map(role => role.id)).toEqual(['pm', 'tl', 'api', 'fe', 'qa', 'security'])
    expect(adjusted?.find(role => role.id === 'api')?.title).toBe('API')
    expect(adjusted?.find(role => role.id === 'qa')?.framework).toBe('gsd')
    expect(adjusted?.filter(role => role.framework !== undefined)).toHaveLength(1)
  })

  test('Done adjusting gives the adjusted roles, which the roles question still has to confirm', async () => {
    const { run, end } = await adjustRun(['drop fe', 'Done adjusting'])
    const kept = roles.filter(role => role.id !== 'fe')
    expect(firstLines(run.asked).filter(question => question === ROLES_QUESTION)).toHaveLength(2)
    expect(rolesResult(end)).toEqual({ kind: 'accepted', value: { roles: kept, changes: full.changes } })
  })

  test('a line it cannot read and a change it cannot apply each put their exact message on the next ask', async () => {
    const { run, end, adjusts } = await adjustRun(['delete fe', 'drop zz', 'Done adjusting'])
    expect(rolesOf(end)).toEqual(roles)
    expect(adjusts).toEqual([
      ASKED,
      `Could not read that change: delete fe. Use add, drop, rename or framework.\n${ASKED}`,
      `no role "zz"\n${ASKED}`,
    ])
    expect(run.logged).toEqual([])
  })

  test('Show the roles shows the current roles in the pane and asks again', async () => {
    const { run } = await adjustRun(['drop fe', 'Show the roles', 'Done adjusting'])
    const shown = run.shown[1]
    expect(shown?.key).toBe('roles')
    expect(shown?.lines[0]).toBe('Proposed roles:')
    expect(shown?.lines.join('\n')).not.toContain('FE (fe)')
    expect(shown?.lines).not.toContain('Changes from the scan:')
    expect(run.logged).toEqual([])
  })

  test('a dismissed adjust question cancels the step with its reason (A1)', async () => {
    const { end } = await rolesRun(['Adjust them', 'drop fe'], [], full)
    expect(rolesResult(end)).toEqual({ kind: 'cancelled', reason: ADJUST_DISMISSED_REASON })
    expect(ADJUST_DISMISSED_REASON).toBe('The Adjust question was dismissed.')
  })

  test('after 30 answers without Done adjusting the roles so far go back with a note, not accepted (A1)', async () => {
    const { run, end, adjusts } = await adjustRun(['drop fe', ...Array.from({ length: 29 }, () => 'delete fe')])
    const kept = roles.filter(role => role.id !== 'fe')
    expect(rolesResult(end)).toEqual({ kind: 'accepted', value: { roles: kept, changes: full.changes } })
    expect(adjusts).toHaveLength(MAX_ADJUST_ROUNDS)
    expect(MAX_ADJUST_ROUNDS).toBe(30)
    expect(run.logged).toEqual([ADJUST_ROUNDS_NOTE])
    expect(run.shown.filter(block => block.key === 'notes')).toEqual([
      { key: 'notes', title: 'Notes', lines: [ADJUST_ROUNDS_NOTE] },
    ])
    expect(ADJUST_ROUNDS_NOTE).toBe(
      'Adjust took 30 answers without "Done adjusting": showing the roles as they are now.',
    )
  })

  test('Adjust refuses a framework not installed, names the installed ones, and the role keeps its own', async () => {
    const { run, end, adjusts } = await adjustRun(['framework qa superpowers', 'Done adjusting'], ['gsd', 'none'])
    expect(rolesOf(end)).toEqual(roles)
    const refusal =
      'Cannot set qa to superpowers: it is not installed for this repo (installed: GSD, none (built-in)). ' +
      'qa keeps its framework.'
    expect(adjusts).toEqual([ASKED, `${refusal}\n${ASKED}`])
    expect(run.logged).toEqual([])
  })

  test('Adjust applies an installed framework; a role it does not know gets the unknown-role message', async () => {
    const answers = ['framework qa gsd', 'framework nosuch superpowers', 'Done adjusting']
    const { run, end, adjusts } = await adjustRun(answers, ['gsd', 'none'])
    expect(rolesOf(end)?.find(role => role.id === 'qa')?.framework).toBe('gsd')
    expect(adjusts).toEqual([ASKED, ASKED, `no role "nosuch"\n${ASKED}`])
    expect(run.logged).toEqual([])
  })

  test('none is always installed, so a role can always be set to the built-in fallback', async () => {
    const { run, end, adjusts } = await adjustRun(['framework qa none', 'framework be gsd', 'Done adjusting'], ['none'])
    const adjusted = rolesOf(end)
    expect(adjusted?.find(role => role.id === 'qa')?.framework).toBe('none')
    expect(adjusted?.find(role => role.id === 'be')?.framework).toBeUndefined()
    const refusal =
      'Cannot set be to gsd: it is not installed for this repo (installed: none (built-in)). be keeps its framework.'
    expect(adjusts).toEqual([ASKED, ASKED, `${refusal}\n${ASKED}`])
    expect(run.logged).toEqual([])
  })

  test('installedFrameworks lists the supported ones in use or installed, in SUPPORTED_IDS order, then none', () => {
    expect(installedFrameworks([])).toEqual(['none'])
    expect(installedFrameworks([detection('superpowers', 'installed'), detection('gsd', 'in-use')])).toEqual([
      'gsd',
      'superpowers',
      'none',
    ])
    expect(installedFrameworks([detection('gsd', 'not-found'), detection('superpowers', 'in-use')])).toEqual([
      'superpowers',
      'none',
    ])
    expect(installedFrameworks([detection('aidlc', 'unsupported'), detection('gsd', 'not-found')])).toEqual(['none'])
    expect(installedFrameworks(detectAll(AMBIGUOUS_FACTS))).toEqual(['gsd', 'superpowers', 'none'])
  })

  test('the adjust question gives an example of each change', () => {
    expect(ADJUST_QUESTION).toBe(
      'Adjust the roles: type one change, for example add docs "Docs writer", drop fe, rename be api "API", ' +
        'or framework qa gsd.',
    )
    expect(ADJUST_OPTIONS).toEqual(['Done adjusting', 'Show the roles'])
    expect(Object.isFrozen(ADJUST_OPTIONS)).toBe(true)
  })
})

describe('rolesStep', () => {
  const proposal = PROPOSAL

  test('Use these roles returns the proposed roles, after the proposal lines are shown', async () => {
    const run = memIo(memWorld({}), { 'Use these roles?': 'Use these roles' })
    const end = await stageRun(run.io, rolesStage, rolesAt(proposal, FRAMEWORKS))
    expect(rolesResult(end)).toEqual({ kind: 'accepted', value: proposal })
    const lines = proposalLines(proposal.roles, proposal.changes)
    expect(run.shown).toEqual([{ key: 'roles', title: 'Roles', lines }])
    expect(run.logged).toEqual([])
    expect(run.asked).toEqual([withContext(ROLES_QUESTION, rolesContextLine(proposal.roles, proposal.changes))])
    const options = ['Use these roles', 'Adjust them', 'Describe my own structure']
    expect(run.specs[0]).toEqual({ options, header: 'Roles' })
    expect(ROLES_QUESTION).toBe('Use these roles?')
    expect(ROLES_OPTIONS).toEqual(['Use these roles', 'Adjust them', 'Describe my own structure'])
    expect(Object.isFrozen(ROLES_OPTIONS)).toBe(true)
  })

  test('a described structure goes through the model twice and is used after Use these roles', async () => {
    const answers = ['Describe my own structure', DESCRIPTION, 'Use these roles']
    const { run, end } = await rolesRun(answers, ['not json', DESCRIBED_REPLY])
    expect(rolesResult(end)).toEqual({ kind: 'accepted', value: { roles: DESCRIBED_ROLES, changes: [] } })
    const roles = rolesOf(end)
    expect(run.prompts).toHaveLength(2)
    expect(run.prompts[1]).toContain('the reply is not JSON')
    expect(roles).toEqual(DESCRIBED_ROLES)
    const docs = roles?.find(role => role.id === 'docs')
    expect(docs?.hasBash).toBe(true)
    expect(docs?.autopilot.askUser).toBe(false)
    expect(firstLines(run.asked)).toEqual([ROLES_QUESTION, DESCRIBE_QUESTION, ROLES_QUESTION])
    expect(run.shown[1]?.lines).toEqual(proposalLines(DESCRIBED_ROLES, []))
  })

  test('three invalid replies print why and ask the roles question again with the template roles', async () => {
    const answers = ['Describe my own structure', DESCRIPTION, 'Use these roles']
    const { run, end } = await rolesRun(answers, ['not json', 'not json', 'not json'])
    expect(rolesResult(end)).toEqual({ kind: 'accepted', value: proposal })
    expect(run.prompts).toHaveLength(3)
    const [reason] = run.logged
    expect(run.logged).toHaveLength(1)
    expect(reason?.startsWith('Could not use the described structure:')).toBe(true)
    expect(reason?.endsWith(FALLBACK_END)).toBe(true)
    expect(run.shown.map(block => block.key)).toEqual(['roles', 'notes', 'roles'])
    expect(run.shown[1]).toEqual({ key: 'notes', title: 'Notes', lines: run.logged })
    expect(run.shown[2]?.lines).toEqual(proposalLines(proposal.roles, proposal.changes))
    expect(firstLines(run.asked)).toEqual([ROLES_QUESTION, DESCRIBE_QUESTION, ROLES_QUESTION])
  })

  test('Use the template instead goes back to the roles question with no model call', async () => {
    const answers = ['Describe my own structure', '  ', 'Use the template instead', 'Use these roles']
    const { run, end } = await rolesRun(answers, [DESCRIBED_REPLY])
    expect(rolesResult(end)).toEqual({ kind: 'accepted', value: proposal })
    expect(run.prompts).toEqual([])
    expect(firstLines(run.asked)).toEqual([ROLES_QUESTION, DESCRIBE_QUESTION, EMPTY_DESCRIPTION, ROLES_QUESTION])
    expect(run.asked[2]).toBe(`${EMPTY_DESCRIPTION}\n${DESCRIBE_ASKED}`)
  })

  test('the prompt holds the typed text as a JSON string and no name the scans found', async () => {
    const world = gitWorld({
      tools: [{ name: 'mcp__sentry__issues', description: 'Sentry issues', mcp: true }],
      replies: [DESCRIBED_REPLY],
    })
    const run = memIo(world, ['Describe my own structure', DESCRIPTION, 'Use these roles'])
    const gathered = await gatherScans(run.io, DEFAULT_LOCATIONS, false)
    expect(gathered.setup.mcp.map(server => server.name)).toEqual(['sentry'])
    await stageRun(run.io, rolesStage, rolesAt(proposeRoles(gathered.repo), FRAMEWORKS))
    expect(run.prompts).toHaveLength(1)
    expect(run.prompts[0]).toContain(JSON.stringify(DESCRIPTION))
    expect(leaks(run.prompts.join('\n'), ['sentry', '/repo', '/home/u'])).toEqual([])
  })

  test('Adjust them adjusts the roles and asks the roles question again with them', async () => {
    const full = proposeRoles(FULL_SCAN)
    const answers = ['Adjust them', 'drop fe', 'add docs "Docs writer"', 'Done adjusting', 'Use these roles']
    const { run, end } = await rolesRun(answers, [], full)
    expect(rolesOf(end)?.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'qa', 'security', 'docs'])
    expect(firstLines(run.asked).filter(question => question === ROLES_QUESTION)).toHaveLength(2)
    expect(shownBlock(run, 'roles').join('\n')).toContain('Docs writer (docs)')
  })

  test('a dismissal or 3 unreadable answers at any point cancel the step with their reason (A1)', async () => {
    const scripts: readonly (readonly [readonly string[], string])[] = [
      [[], ROLES_DISMISSED_REASON],
      [['Adjust them'], ADJUST_DISMISSED_REASON],
      [['Describe my own structure'], DESCRIBE_CANCELLED_REASON],
      [['Describe my own structure', 'Cancel init'], DESCRIBE_CANCELLED_REASON],
      [['maybe', 'maybe', 'maybe'], NO_USABLE_ANSWER_REASON],
      [['Describe my own structure', '', '', ''], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of scripts) {
      expect(rolesResult((await rolesRun(answers)).end)).toEqual({ kind: 'cancelled', reason })
    }
    expect(ROLES_DISMISSED_REASON).toBe('The roles question was dismissed or not answered.')
    expect(DESCRIBE_CANCELLED_REASON).toBe('The describe question was dismissed or cancelled.')
  })

  test('described roles in the 10th round are never used: the step cancels after 10 roles questions (A1)', async () => {
    const rounds = Array.from({ length: 9 }, () => ['Adjust them', 'Done adjusting']).flat()
    const { run, end } = await rolesRun([...rounds, 'Describe my own structure', DESCRIPTION], [DESCRIBED_REPLY])
    expect(rolesResult(end)).toEqual({ kind: 'cancelled', reason: ROLE_ROUNDS_REASON })
    expect(rolesOf(end)).toBeNull()
    expect(run.prompts).toHaveLength(1)
    expect(firstLines(run.asked).filter(question => question === ROLES_QUESTION)).toHaveLength(MAX_ROLE_ROUNDS)
    expect(MAX_ROLE_ROUNDS).toBe(10)
    expect(ROLE_ROUNDS_REASON).toBe(
      'The roles question was asked 10 times without "Use these roles": nothing was chosen.',
    )
  })

  test('a 10th round of Adjust them and Done adjusting cancels too: no cap ever accepts the roles (A1)', async () => {
    const { run, end } = await rolesRun(Array.from({ length: 11 }, () => ['Adjust them', 'Done adjusting']).flat())
    expect(rolesResult(end)).toEqual({ kind: 'cancelled', reason: ROLE_ROUNDS_REASON })
    expect(firstLines(run.asked).filter(question => question === ROLES_QUESTION)).toHaveLength(10)
  })

  test('the Adjust cap shows the roles so far and asks the roles question again; Use these roles accepts', async () => {
    const full = proposeRoles(FULL_SCAN)
    const answers = ['Adjust them', 'drop fe', ...Array.from({ length: 29 }, () => 'delete fe'), 'Use these roles']
    const run = memIo(memWorld({}), answers)
    const { io, events } = withEvents(run)
    const kept = full.roles.filter(role => role.id !== 'fe')
    const end = await stageRun(io, rolesStage, rolesAt(full, FRAMEWORKS))
    expect(rolesResult(end)).toEqual({ kind: 'accepted', value: { roles: kept, changes: full.changes } })
    expect(firstLines(run.asked).filter(question => question === ROLES_QUESTION)).toHaveLength(2)
    const noteAt = events.indexOf(`log ${ADJUST_ROUNDS_NOTE}`)
    expect(noteAt > 0 && events[noteAt + 1] === 'show notes' && events[noteAt + 2] === 'show roles').toBe(true)
    expect(shownBlock(run, 'roles')).toEqual(proposalLines(kept, full.changes))
  })

  test('the Adjust cap is not acceptance: a dismissed roles question after it cancels the step', async () => {
    const full = proposeRoles(FULL_SCAN)
    const answers = ['Adjust them', 'drop fe', ...Array.from({ length: 29 }, () => 'delete fe')]
    const { end } = await rolesRun(answers, [], full)
    expect(rolesResult(end)).toEqual({ kind: 'cancelled', reason: ROLES_DISMISSED_REASON })
  })

  test('a start team is shown with its own scan changes, none for a described team (A6)', async () => {
    const run = memIo(memWorld({}), { 'Use these roles?': 'Use these roles' })
    const start: RoleProposal = { roles: DESCRIBED_ROLES, changes: [] }
    const end = await stageRun(run.io, rolesStage, rolesAt(proposal, FRAMEWORKS, start))
    expect(rolesResult(end)).toEqual({ kind: 'accepted', value: start })
    expect(run.shown).toEqual([{ key: 'roles', title: 'Roles', lines: proposalLines(DESCRIBED_ROLES, []) }])
    expect(shownBlock(run, 'roles').slice(-2)).toEqual(['Changes from the scan:', '  none'])
  })
})

/** Facts where GSD (.planning/) and superpowers (docs/superpowers/) are both in use, so the choice is ambiguous. */
const AMBIGUOUS_FACTS: Facts = {
  ...EMPTY_FACTS,
  repoEntries: [
    { name: '.planning', kind: 'dir', isLink: false },
    { name: 'docs', kind: 'dir', isLink: false },
  ],
  docsEntries: [{ name: 'superpowers', kind: 'dir', isLink: false }],
}

describe('refusal re-ask (G-02-6b)', () => {
  test('the Adjust loop puts the message of a change it cannot apply on top of the next ask', async () => {
    const full = proposeRoles(FULL_SCAN)
    const roles = full.roles
    const answers = ['Adjust them', 'delete fe', 'drop zz', 'drop fe', 'Show the roles', 'Done adjusting']
    const { run, end } = await rolesRun([...answers, 'Use these roles'], [], full)
    const kept = roles.filter(role => role.id !== 'fe')
    expect(rolesOf(end)).toEqual(kept)
    const before = withContext(ADJUST_QUESTION, adjustContextLine(roles))
    const after = withContext(ADJUST_QUESTION, adjustContextLine(kept))
    expect(run.asked.slice(1, -1)).toEqual([
      before,
      `Could not read that change: delete fe. Use add, drop, rename or framework.\n${before}`,
      `no role "zz"\n${before}`,
      after,
      after,
    ])
    expect(run.logged).toEqual([])
  })

  test('a typed line break in an Adjust change cannot add a line to the next ask (T-02-54)', async () => {
    const full = proposeRoles(FULL_SCAN)
    const { run } = await rolesRun(['Adjust them', 'delete\nfe', 'Done adjusting', 'Use these roles'], [], full)
    expect(run.asked[2]?.split('\n')).toEqual([
      'Could not read that change: deletefe. Use add, drop, rename or framework.',
      ADJUST_QUESTION,
      adjustContextLine(full.roles),
    ])
  })
})

describe('question context lines (G-02-1)', () => {
  test('rolesContextLine names each role by title and id, then how many changes the scan made', () => {
    const roles = [templateRole('pm'), templateRole('be')]
    const change: RoleChange = { roleId: 'fe', change: 'dropped', reason: 'r', evidence: [] }
    expect(rolesContextLine(roles, [])).toBe('Proposed: PM (pm), BE (be).')
    expect(rolesContextLine(roles, [change])).toBe('Proposed: PM (pm), BE (be); 1 change from the scan.')
    expect(rolesContextLine(roles, [change, change])).toBe('Proposed: PM (pm), BE (be); 2 changes from the scan.')
  })

  test('the Adjust context line names the roles as they are now, after each change', async () => {
    const answers = ['Adjust them', 'drop fe', 'drop zz', 'Done adjusting', 'Use these roles']
    const { run } = await rolesRun(answers, [], proposeRoles(FULL_SCAN))
    expect(run.asked.slice(1, -1)).toEqual([
      `${ADJUST_QUESTION}\nRoles now: pm, tl, be, fe, qa, security.`,
      `${ADJUST_QUESTION}\nRoles now: pm, tl, be, qa, security.`,
      `no role "zz"\n${ADJUST_QUESTION}\nRoles now: pm, tl, be, qa, security.`,
    ])
  })
})

describe('the roles stage (D-230)', () => {
  const proposal = proposeRoles(SOURCE_SCAN)

  test('rolesStage shows the proposal, then asks the roles question; the open question is that ask', () => {
    const state = rolesStage.enter(stateAt('roles', { proposal, installed: FRAMEWORKS }))
    const question = withContext(ROLES_QUESTION, rolesContextLine(proposal.roles, proposal.changes))
    const ask = { question, spec: { options: [...ROLES_OPTIONS], header: 'Roles' } }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
    const lines = proposalLines(proposal.roles, proposal.changes)
    expect(state.outputs).toEqual([{ kind: 'show', block: { key: 'roles', lines } }])
  })

  test('Describe asks for the text, then calls the model as an effect; the described roles are asked about', () => {
    const state = rolesStage.enter(stateAt('roles', { proposal, installed: FRAMEWORKS }))
    const describing = nextStage(state, { kind: 'answer', text: 'Describe my own structure' })
    expect(describing.openQuestion?.question).toBe(DESCRIBE_ASKED)
    const calling = nextStage(describing, { kind: 'answer', text: DESCRIPTION })
    expect([calling.effect, calling.openQuestion]).toEqual([
      { kind: 'model', call: { id: 'describe-roles', text: DESCRIPTION } },
      null,
    ])
    const result = { kind: 'roles', roles: DESCRIBED_ROLES } satisfies Proposed
    const asked = nextStage({ ...calling, outputs: [] }, { kind: 'model', result: { id: 'describe-roles', result } })
    expect(asked.openQuestion?.question).toBe(withContext(ROLES_QUESTION, rolesContextLine(DESCRIBED_ROLES, [])))
    const lines = proposalLines(DESCRIBED_ROLES, [])
    expect(asked.outputs).toEqual([{ kind: 'show', block: { key: 'roles', lines } }])
  })
})

describe('kept model results on Change roles (D-235, ASKED #14)', () => {
  test('unchanged role ids keep the kept results; changed ones clear them, so the model is called again', () => {
    const roleIds = PROPOSAL.roles.map(role => role.id)
    const kept = { roleIds, ownSkills: new Map([['S1', ['pm']]]), topics: null, parts: null }
    const again = { returnTo: 'review', returnAfter: 'improver-install', kept } satisfies Partial<InitState>
    const start = rolesAt(PROPOSAL, FRAMEWORKS, PROPOSAL)
    const same = driven(rolesStage.enter({ ...start, ...again }), ['Use these roles']).state
    expect(same.kept).toEqual(kept)
    const answers = ['Adjust them', 'drop tl', 'Done adjusting', 'Use these roles']
    const changed = driven(rolesStage.enter({ ...start, ...again }), answers).state
    expect(changed.draft.roles?.map(role => role.id)).not.toEqual(roleIds)
    expect(changed.kept).toBeNull()
  })
})
