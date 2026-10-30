import { describe, expect, test } from 'claude-code/testing'

import { PLUGIN_RUN_TIMEOUT_MS } from '../../apply/run'
import { recommend } from '../../roles/recommend'
import { resolvedFramework } from '../../team'
import {
  BIDI_OVERRIDE,
  driven,
  emptySetupScan,
  GUIDANCE_KEY,
  memIo,
  memWorld,
  SECURITY_KEY,
  SECURITY_KEYS,
  stateAt,
  templateRole,
  wholeDraft,
} from '../../testkit'
import { MAX_ASKS, NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import { recommendationLines } from '../../ui/blocks/recommendations'
import type { Draft } from '../draft'
import {
  INSTALL_OPTIONS,
  SECURITY_INSTALL_CONTEXT,
  SECURITY_INSTALL_DISMISSED_REASON,
  SECURITY_INSTALL_PREFIX,
  securityInstallQuestion,
  securityInstallStep,
  securityStage,
  withSecuritySkill,
} from './security'

describe('security plugin installs (decision #39)', () => {
  test('the question start, its two answers, its cancel reason and the install timeout are fixed', () => {
    expect(SECURITY_INSTALL_PREFIX).toBe('Install from claude-plugins-official after you confirm the plan:')
    expect(INSTALL_OPTIONS).toEqual(['Install', 'Not now'])
    expect(Object.isFrozen(INSTALL_OPTIONS)).toBe(true)
    expect(SECURITY_INSTALL_DISMISSED_REASON).toBe('The security plugins question was dismissed or not answered.')
    expect(PLUGIN_RUN_TIMEOUT_MS).toBe(180_000)
  })

  test('the question names each missing plugin, then gives one note for each', () => {
    const start = 'Install from claude-plugins-official after you confirm the plan:'
    const securityNote =
      'claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and ' +
      'writes CLAUDE-SECURITY-<time>/ report folders into the repo.'
    const guidanceNote = 'security-guidance adds hooks that warn about risky edits.'
    expect(securityInstallQuestion(SECURITY_KEYS)).toBe(
      `${start} claude-security and security-guidance? ${securityNote} ${guidanceNote}`,
    )
    expect(securityInstallQuestion([SECURITY_KEY])).toBe(`${start} claude-security? ${securityNote}`)
    expect(securityInstallQuestion([GUIDANCE_KEY])).toBe(`${start} security-guidance? ${guidanceNote}`)
  })

  test('the step asks nothing with no plugin missing; Install gives the keys, Not now none, in any case', async () => {
    const quiet = memIo(memWorld({}), [])
    expect(await securityInstallStep(quiet.io, [])).toEqual({ kind: 'accepted', value: [] })
    expect(quiet.asked).toEqual([])
    const cases: readonly (readonly [string, readonly string[]])[] = [
      ['Install', SECURITY_KEYS],
      [' install ', SECURITY_KEYS],
      ['Not now', []],
      ['NOT NOW', []],
    ]
    for (const [answer, value] of cases) {
      const run = memIo(memWorld({}), [answer])
      const result = await securityInstallStep(run.io, SECURITY_KEYS)
      expect([answer, result]).toEqual([answer, { kind: 'accepted', value }])
      expect(run.asked).toEqual([withContext(securityInstallQuestion(SECURITY_KEYS), SECURITY_INSTALL_CONTEXT)])
      expect(run.specs).toEqual([{ options: ['Install', 'Not now'], header: 'Security' }])
    }
  })

  test('a dismissal, or three answers that are neither, cancels the step with its reason (A1, D-45)', async () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], 'The security plugins question was dismissed or not answered.'],
      [['yes', 'later', 'Install them'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(memWorld({}), answers)
      expect(await securityInstallStep(run.io, SECURITY_KEYS)).toEqual({ kind: 'cancelled', reason })
      expect(run.asked).toHaveLength(answers.length === 0 ? 1 : MAX_ASKS)
      expect(run.logged).toEqual([])
    }
    const refused = memIo(memWorld({}), ['yes', 'Install'])
    await securityInstallStep(refused.io, SECURITY_KEYS)
    const question = withContext(securityInstallQuestion(SECURITY_KEYS), SECURITY_INSTALL_CONTEXT)
    expect(refused.asked).toEqual([question, `'yes' isn't one of: "Install", "Not now".\n${question}`])
  })

  test('withSecuritySkill gives the skill once to each role standing for Security, or takes it away', () => {
    const skill = 'claude-security:claude-security'
    const appsec = templateRole('qa', { id: 'appsec', basedOn: 'security', skills: ['codex:rescue'] })
    const roles = [templateRole('pm', { skills: [skill] }), templateRole('security'), appsec]
    const before = JSON.stringify(roles)
    const given = withSecuritySkill(roles, true)
    expect(given.map(role => [role.id, role.skills])).toEqual([
      ['pm', [skill]],
      ['security', [skill]],
      ['appsec', ['codex:rescue', skill]],
    ])
    expect(withSecuritySkill(given, true)).toEqual(given)
    expect(withSecuritySkill(given, false).map(role => [role.id, role.skills])).toEqual([
      ['pm', [skill]],
      ['security', []],
      ['appsec', ['codex:rescue']],
    ])
    expect(given[0]).toEqual(roles[0])
    expect(JSON.stringify(roles)).toBe(before)
  })
})

describe('security plugin review fixes (#69)', () => {
  test('the question shows each plugin name cleaned, as every printed key is (B7)', () => {
    expect(securityInstallQuestion([`x${BIDI_OVERRIDE}\ny@m`])).toBe(`${SECURITY_INSTALL_PREFIX} xy? `)
  })
})

describe('the security stage (D-230)', () => {
  /** PM, Team Lead and Security on the built-in default, with no security plugin installed. */
  const draft = wholeDraft()

  /** The recommendations block of `draft`'s team, as the stage shows it before the question (ROLE-03). */
  function recommendationsOf(given: Draft): unknown {
    const { roles, gathered } = given
    const frameworks = roles.map(role => resolvedFramework(role, given.repoDefault))
    const recommendations = recommend({ roles, frameworks, scan: gathered.repo, setup: gathered.setup })

    return { kind: 'show', block: { key: 'recommendations', lines: recommendationLines(recommendations, roles) } }
  }

  test('securityStage shows the recommendations, then asks the plugins question; the open question is that ask', () => {
    const state = securityStage.enter(stateAt('security', draft))
    const question = withContext(securityInstallQuestion(SECURITY_KEYS), SECURITY_INSTALL_CONTEXT)
    const ask = { question, spec: { options: ['Install', 'Not now'], header: 'Security' } }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
    expect(state.outputs).toEqual([recommendationsOf(draft)])
  })

  test('with no plugin missing it shows the recommendations, asks nothing and installs nothing', () => {
    const setup = emptySetupScan({ installedPlugins: SECURITY_KEYS })
    const installed = wholeDraft({ gathered: { ...draft.gathered, setup }, pluginInstalls: [GUIDANCE_KEY] })
    const state = securityStage.enter(stateAt('security', installed))
    expect([state.sub, state.openQuestion, state.draft.pluginInstalls]).toEqual([{ kind: 'done' }, null, []])
    expect(state.draft.roles).toEqual(installed.roles)
    expect(state.outputs).toEqual([recommendationsOf(installed)])
  })

  test('Install gives the keys and the Security role its review skill; Not now none, and takes the skill away', () => {
    const skill = 'claude-security:claude-security'
    const cases: readonly (readonly [string, readonly string[], readonly string[]])[] = [
      ['Install', SECURITY_KEYS, [skill]],
      ['Not now', [], []],
    ]
    for (const [answer, installs, skills] of cases) {
      const run = driven(securityStage.enter(stateAt('security', draft)), [answer])
      expect([answer, run.state.draft.pluginInstalls]).toEqual([answer, installs])
      const security = run.state.draft.roles?.find(role => role.id === 'security')
      expect([answer, security?.skills.filter(name => name === skill)]).toEqual([answer, skills])
    }
  })
})
