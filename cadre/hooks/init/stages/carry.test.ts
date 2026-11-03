import { describe, expect, test } from 'claude-code/testing'

import type { HookScript, RoleSpec, SetupScan } from '../../../types'
import { PANE_LIST_WORDS, SCREEN_LIST_WORDS } from '../../locales/t'
import { proposeRoles } from '../../roles/propose'
import { gatherScans } from '../../scan/gather'
import {
  DEFAULT_LOCATIONS,
  driven,
  emptySetupScan,
  FULL_SCAN,
  gitWorld,
  memIo,
  stateAt,
  wholeDraft,
} from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import { envQuestion } from '../answers'
import { cancelledReply } from '../replies'
import type { InitState } from '../state'
import { carryStage, ENV_DISMISSED_REASON, envContextLine } from './carry'

/** Settings with one PreToolUse hook that runs the GSD secret read guard. */
const GUARD_SETTINGS = {
  hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node /x/hooks/gsd-secret-read-guard.js' }] }] },
}

/** The carry stage entered for `roles` with the setup scan `setup`, the rest of a whole draft set. */
function carryAt(roles: readonly RoleSpec[], setup: SetupScan): InitState {
  return carryStage.enter(stateAt('carry', wholeDraft({ roles, gathered: { ...wholeDraft().gathered, setup } })))
}

describe('carryStep', () => {
  const roles = proposeRoles(FULL_SCAN).roles
  /** The carry facts of user settings with two env variables and nothing else. */
  const noCarry = { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] }
  const twoNames = emptySetupScan({ carry: { ...noCarry, envNames: ['API_KEY', 'JIRA_URL'] } })
  const ENV_QUESTION =
    'Which env variables do roles carry? Names: API_KEY, JIRA_URL (values are never stored; e.g. API_KEY, or none)'
  /** The env question as asked: the team's role ids and where the values come from under it (D-136). */
  const ENV_ASKED = withContext(ENV_QUESTION, envContextLine(roles))
  /** The env question as a pane surface asks it: no env name, the pane lists them (D-283). */
  const ENV_PANE_QUESTION = 'Which env variables do roles carry? (values are never stored; e.g. API_KEY, or none)'
  /** The side-pane block of the two names, shown right before the env question (D-135). */
  const TWO_NAMES_LINES = ['Env variable names in your settings (values are never read):', '  API_KEY', '  JIRA_URL']
  const TWO_NAMES_BLOCK = { kind: 'show', block: { key: 'env', lines: TWO_NAMES_LINES } }

  /** A hook script registered for an event in the user settings. */
  function hook(script: string, event = 'PreToolUse'): HookScript {
    return { script, event, source: 'user' }
  }

  /** The roles the carry stage ends with for `setup` and no answer: nothing is asked when no env name was scanned. */
  function quietCarried(setup: SetupScan): readonly RoleSpec[] | undefined {
    return carryAt(roles, setup).draft.roles
  }

  test('the env question is asked once, and every role carries the picked names only', () => {
    const run = driven(carryAt(roles, twoNames), ['JIRA_URL'])
    expect(run.asked).toEqual([ENV_ASKED])
    // A pane surface asks the question alone with the summary of its context, which lists every name (D-283, D-310).
    const summary = '2 env names'
    const pane = { asked: ENV_ASKED, text: withContext(ENV_PANE_QUESTION, summary) }
    const context = { title: 'Env variables', lines: TWO_NAMES_LINES, kind: 'env', summary, pane }
    expect(run.specs).toEqual([{ options: ['None', 'All of them'], header: 'Env', context, acceptsTyped: true }])
    const carry = { autoCompactWindow: false, statusLine: false, env: ['JIRA_URL'], hooks: [] }
    expect(run.state.draft.roles?.map(role => role.carry)).toEqual(roles.map(() => carry))
    expect(run.outputs).toEqual([TWO_NAMES_BLOCK])
  })

  test('All of them carries every scanned name, None carries none, and NAME=value is asked again', () => {
    const all = driven(carryAt(roles, twoNames), ['API_KEY=x', 'All of them'])
    expect(all.state.draft.roles?.every(role => role.carry.env.join() === 'API_KEY,JIRA_URL')).toBe(true)
    const refusal = `'API_KEY=x' isn't one of: "None", "All of them", or names from the list, typed exactly.`
    expect(all.asked).toEqual([ENV_ASKED, `${refusal}\n${ENV_ASKED}`])
    const none = driven(carryAt(roles, twoNames), ['None'])
    expect(none.state.draft.roles?.every(role => role.carry.env.length === 0)).toBe(true)
  })

  test('the side pane lists every scanned env name right before the env question, names only (D-135)', () => {
    const names = Array.from({ length: 40 }, (_, at) => `CADRE_UAT_NAME_${String(at + 1).padStart(2, '0')}`)
    const forty = emptySetupScan({ carry: { ...noCarry, envNames: names } })
    const state = carryAt(roles, forty)
    const lines = ['Env variable names in your settings (values are never read):', ...names.map(name => `  ${name}`)]
    expect(state.outputs).toEqual([{ kind: 'show', block: { key: 'env', lines } }])
    expect(state.openQuestion?.question.split('\n')[0]).toBe(envQuestion(names, PANE_LIST_WORDS))
    expect(envQuestion(names, SCREEN_LIST_WORDS)).toContain('+35 more')
    const carried = driven(state, ['CADRE_UAT_NAME_40']).state.draft.roles
    expect(carried?.map(role => role.carry.env)).toEqual(roles.map(() => ['CADRE_UAT_NAME_40']))
  })

  test('with no env names nothing is asked; autoCompactWindow and the status line are carried when set', () => {
    const set = emptySetupScan({ carry: { ...noCarry, autoCompactWindow: 800000, hasStatusLine: true } })
    const state = carryAt(roles, set)
    expect([state.sub, state.openQuestion, state.outputs]).toEqual([{ kind: 'done' }, null, []])
    const carry = { autoCompactWindow: true, statusLine: true, env: [], hooks: [] }
    expect(state.draft.roles?.map(role => role.carry)).toEqual(roles.map(() => carry))
    const nothing = { autoCompactWindow: false, statusLine: false, env: [], hooks: [] }
    expect(quietCarried(emptySetupScan())?.map(role => role.carry)).toEqual(roles.map(() => nothing))
  })

  test('of the user hooks only the GSD secret read guard is carried, once, by every role', () => {
    const hooks = [
      hook('gsd-secret-read-guard.js'),
      hook('gsd-context-monitor.js', 'PostToolUse'),
      hook('my-hook.sh'),
      hook('gsd-secret-read-guard.js', 'PostToolUse'),
    ]
    const carried = quietCarried(emptySetupScan({ hooks }))
    expect(carried?.map(role => role.carry.hooks)).toEqual(roles.map(() => ['gsd-secret-read-guard.js']))
  })

  test('the guard is matched by its whole name, with a .js, .cjs or .sh extension', () => {
    const scripts = [
      'gsd-secret-read-guard.sh',
      'gsd-secret-read-guard.py',
      'my-gsd-secret-read-guard.js',
      'gsd-secret-read-guard.js.bak',
      'gsd-secret-read-guard.cjs',
    ]
    const [first] = quietCarried(emptySetupScan({ hooks: scripts.map(script => hook(script)) })) ?? []
    expect(first?.carry.hooks).toEqual(['gsd-secret-read-guard.cjs', 'gsd-secret-read-guard.sh'])
  })

  test('the guard is carried when any settings source registers it: user, project or local (D-103)', async () => {
    const placements = [
      { user: GUARD_SETTINGS, project: {}, local: {} },
      { user: {}, project: GUARD_SETTINGS, local: {} },
      { user: {}, project: {}, local: GUARD_SETTINGS },
    ]
    for (const settings of placements) {
      const gathered = await gatherScans(memIo(gitWorld({ settings }), {}).io, DEFAULT_LOCATIONS, false)
      const carried = quietCarried(gathered.setup)
      expect(carried?.map(role => role.carry.hooks)).toEqual(roles.map(() => ['gsd-secret-read-guard.js']))
    }
  })

  test('a dismissal or three answers that name no scanned variable cancel with their reason (A1)', () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], ENV_DISMISSED_REASON],
      [['HOME', 'jira_url', 'API_KEY JIRA_URL=1'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = driven(carryAt(roles, twoNames), answers)
      expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(reason) })
      expect(run.outputs).toEqual([TWO_NAMES_BLOCK, { kind: 'log', text: reason }])
    }
    expect(ENV_DISMISSED_REASON).toBe('The env variables question was dismissed or not answered.')
  })

  test('the roles it is given are never changed', () => {
    const before = JSON.stringify(roles)
    driven(carryAt(roles, twoNames), ['All of them'])
    expect(JSON.stringify(roles)).toBe(before)
  })
})

describe('the carry stage (D-230)', () => {
  const roles = proposeRoles(FULL_SCAN).roles
  /** The carry facts of user settings with nothing set. */
  const noCarry = { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] }

  test('carryStage lists every scanned env name, then asks the env question; the open question is that ask', () => {
    const state = carryAt(roles, emptySetupScan({ carry: { ...noCarry, envNames: ['API_KEY', 'JIRA_URL'] } }))
    const question = withContext(envQuestion(['API_KEY', 'JIRA_URL'], PANE_LIST_WORDS), envContextLine(roles))
    const lines = ['Env variable names in your settings (values are never read):', '  API_KEY', '  JIRA_URL']
    const short = 'Which env variables do roles carry? (values are never stored; e.g. API_KEY, or none)'
    const pane = { asked: question, text: withContext(short, '2 env names') }
    const context = { title: 'Env variables', lines, kind: 'env', summary: '2 env names', pane }
    const ask = { question, spec: { options: ['None', 'All of them'], header: 'Env', context, acceptsTyped: true } }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
    expect(state.outputs).toEqual([{ kind: 'show', block: { key: 'env', lines } }])
  })

  test('the env question carries the env names as its own context, each cleaned (D-236, T-02.1-71)', () => {
    const bidi = String.fromCodePoint(0x202e)
    const state = carryAt(roles, emptySetupScan({ carry: { ...noCarry, envNames: [`API${bidi}_KEY`] } }))
    expect(state.openQuestion?.spec.context?.lines).toEqual([
      'Env variable names in your settings (values are never read):',
      '  API_KEY',
    ])
  })

  test('with no env name it shows and asks nothing, and every role carries the settings the user sets', () => {
    const state = carryAt(roles, emptySetupScan({ carry: { ...noCarry, autoCompactWindow: 800000 } }))
    expect([state.sub, state.openQuestion, state.outputs]).toEqual([{ kind: 'done' }, null, []])
    const carry = { autoCompactWindow: true, statusLine: false, env: [], hooks: [] }
    expect(state.draft.roles?.map(role => role.carry)).toEqual(roles.map(() => carry))
  })
})
