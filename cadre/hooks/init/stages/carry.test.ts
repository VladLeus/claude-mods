import { describe, expect, test } from 'claude-code/testing'

import type { HookScript, SetupScan } from '../../../types'
import { proposeRoles } from '../../roles/propose'
import { gatherScans } from '../../scan/gather'
import {
  DEFAULT_LOCATIONS,
  emptySetupScan,
  FULL_SCAN,
  gitWorld,
  memIo,
  memWorld,
  stateAt,
  valueOf,
  wholeDraft,
  withEvents,
} from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import { envQuestion } from '../answers'
import type { InitState } from '../state'
import { carryStage, carryStep, ENV_DISMISSED_REASON, envContextLine } from './carry'

/** Settings with one PreToolUse hook that runs the GSD secret read guard. */
const GUARD_SETTINGS = {
  hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node /x/hooks/gsd-secret-read-guard.js' }] }] },
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

  /** A hook script registered for an event in the user settings. */
  function hook(script: string, event = 'PreToolUse'): HookScript {
    return { script, event, source: 'user' }
  }

  test('the env question is asked once, and every role carries the picked names only', async () => {
    const run = memIo(memWorld({}), ['JIRA_URL'])
    const carried = valueOf(await carryStep(run.io, roles, twoNames))
    expect(run.asked).toEqual([ENV_ASKED])
    expect(run.specs).toEqual([{ options: ['None', 'All of them'], header: 'Env' }])
    const carry = { autoCompactWindow: false, statusLine: false, env: ['JIRA_URL'], hooks: [] }
    expect(carried.map(role => role.carry)).toEqual(roles.map(() => carry))
    expect(run.logged).toEqual([])
  })

  test('All of them carries every scanned name, None carries none, and NAME=value is asked again', async () => {
    const all = memIo(memWorld({}), ['API_KEY=x', 'All of them'])
    const carried = valueOf(await carryStep(all.io, roles, twoNames))
    expect(carried.every(role => role.carry.env.join() === 'API_KEY,JIRA_URL')).toBe(true)
    const refusal = `'API_KEY=x' isn't one of: "None", "All of them", or names from the list, typed exactly.`
    expect(all.asked).toEqual([ENV_ASKED, `${refusal}\n${ENV_ASKED}`])
    const none = valueOf(await carryStep(memIo(memWorld({}), ['None']).io, roles, twoNames))
    expect(none.every(role => role.carry.env.length === 0)).toBe(true)
  })

  test('the side pane lists every scanned env name right before the env question, names only (D-135)', async () => {
    const names = Array.from({ length: 40 }, (_, at) => `CADRE_UAT_NAME_${String(at + 1).padStart(2, '0')}`)
    const forty = emptySetupScan({ carry: { ...noCarry, envNames: names } })
    const run = memIo(memWorld({}), ['CADRE_UAT_NAME_40'])
    const { io, events } = withEvents(run)
    const carried = valueOf(await carryStep(io, roles, forty))
    expect(run.shown).toEqual([
      {
        key: 'env',
        title: 'Env variables',
        lines: ['Env variable names in your settings (values are never read):', ...names.map(name => `  ${name}`)],
      },
    ])
    expect(events).toEqual(['show env', `ask ${envQuestion(names)}`])
    expect(envQuestion(names)).toContain('+35 more')
    expect(carried.map(role => role.carry.env)).toEqual(roles.map(() => ['CADRE_UAT_NAME_40']))
  })

  test('with no env names nothing is asked; autoCompactWindow and the status line are carried when set', async () => {
    const run = memIo(memWorld({}), [])
    const set = emptySetupScan({ carry: { ...noCarry, autoCompactWindow: 800000, hasStatusLine: true } })
    const carried = valueOf(await carryStep(run.io, roles, set))
    expect([run.asked, run.shown]).toEqual([[], []])
    const carry = { autoCompactWindow: true, statusLine: true, env: [], hooks: [] }
    expect(carried.map(role => role.carry)).toEqual(roles.map(() => carry))
    const bare = valueOf(await carryStep(memIo(memWorld({}), []).io, roles, emptySetupScan()))
    const nothing = { autoCompactWindow: false, statusLine: false, env: [], hooks: [] }
    expect(bare.map(role => role.carry)).toEqual(roles.map(() => nothing))
  })

  test('of the user hooks only the GSD secret read guard is carried, once, by every role', async () => {
    const hooks = [
      hook('gsd-secret-read-guard.js'),
      hook('gsd-context-monitor.js', 'PostToolUse'),
      hook('my-hook.sh'),
      hook('gsd-secret-read-guard.js', 'PostToolUse'),
    ]
    const carried = valueOf(await carryStep(memIo(memWorld({}), []).io, roles, emptySetupScan({ hooks })))
    expect(carried.map(role => role.carry.hooks)).toEqual(roles.map(() => ['gsd-secret-read-guard.js']))
  })

  test('the guard is matched by its whole name, with a .js, .cjs or .sh extension', async () => {
    const scripts = [
      'gsd-secret-read-guard.sh',
      'gsd-secret-read-guard.py',
      'my-gsd-secret-read-guard.js',
      'gsd-secret-read-guard.js.bak',
      'gsd-secret-read-guard.cjs',
    ]
    const setup = emptySetupScan({ hooks: scripts.map(script => hook(script)) })
    const [first] = valueOf(await carryStep(memIo(memWorld({}), []).io, roles, setup))
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
      const carried = valueOf(await carryStep(memIo(memWorld({}), []).io, roles, gathered.setup))
      expect(carried.map(role => role.carry.hooks)).toEqual(roles.map(() => ['gsd-secret-read-guard.js']))
    }
  })

  test('a dismissal or three answers that name no scanned variable cancel with their reason (A1)', async () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], ENV_DISMISSED_REASON],
      [['HOME', 'jira_url', 'API_KEY JIRA_URL=1'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(memWorld({}), answers)
      expect(await carryStep(run.io, roles, twoNames)).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(ENV_DISMISSED_REASON).toBe('The env variables question was dismissed or not answered.')
  })

  test('the roles it is given are never changed', async () => {
    const before = JSON.stringify(roles)
    await carryStep(memIo(memWorld({}), ['All of them']).io, roles, twoNames)
    expect(JSON.stringify(roles)).toBe(before)
  })
})

describe('the carry stage (D-230)', () => {
  const roles = proposeRoles(FULL_SCAN).roles
  /** The carry facts of user settings with nothing set. */
  const noCarry = { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] }

  /** The carry stage entered for `roles` with the setup scan `setup`. */
  function carryAt(setup: SetupScan): InitState {
    const draft = wholeDraft({ roles, gathered: { ...wholeDraft().gathered, setup } })

    return carryStage.enter(stateAt('carry', draft))
  }

  test('carryStage lists every scanned env name, then asks the env question; the open question is that ask', () => {
    const state = carryAt(emptySetupScan({ carry: { ...noCarry, envNames: ['API_KEY', 'JIRA_URL'] } }))
    const question = withContext(envQuestion(['API_KEY', 'JIRA_URL']), envContextLine(roles))
    const ask = { question, spec: { options: ['None', 'All of them'], header: 'Env' } }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
    const lines = ['Env variable names in your settings (values are never read):', '  API_KEY', '  JIRA_URL']
    expect(state.outputs).toEqual([{ kind: 'show', block: { key: 'env', lines } }])
  })

  test('with no env name it shows and asks nothing, and every role carries the settings the user sets', () => {
    const state = carryAt(emptySetupScan({ carry: { ...noCarry, autoCompactWindow: 800000 } }))
    expect([state.sub, state.openQuestion, state.outputs]).toEqual([{ kind: 'done' }, null, []])
    const carry = { autoCompactWindow: true, statusLine: false, env: [], hooks: [] }
    expect(state.draft.roles?.map(role => role.carry)).toEqual(roles.map(() => carry))
  })
})
