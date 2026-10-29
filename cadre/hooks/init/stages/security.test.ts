import { describe, expect, test } from 'claude-code/testing'

import { PLUGIN_RUN_TIMEOUT_MS } from '../../apply/run'
import { BIDI_OVERRIDE, GUIDANCE_KEY, memIo, memWorld, SECURITY_KEY, templateRole } from '../../testkit'
import { MAX_ASKS, NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import {
  INSTALL_OPTIONS,
  SECURITY_INSTALL_CONTEXT,
  SECURITY_INSTALL_DISMISSED_REASON,
  SECURITY_INSTALL_PREFIX,
  securityInstallQuestion,
  securityInstallStep,
  withSecuritySkill,
} from './security'

/** Both security plugin keys, in the order init asks about and installs them (decision #39). */
const SECURITY_KEYS = [SECURITY_KEY, GUIDANCE_KEY]

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
