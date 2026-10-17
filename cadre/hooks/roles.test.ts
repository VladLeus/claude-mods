import { describe, expect, test } from 'claude-code/testing'

import type { RepoScan, ScanFinding, ScanKind, TemplateRoleId } from '../types'
import { BUILTIN_GATES } from './builtin'
import { DECISION_TYPES } from './framework'
import { GSD_GATES } from './gsd'
import {
  AUTOPILOT_THRESHOLD,
  chainLines,
  DECISION_OWNERS,
  decisionChain,
  DEFAULT_DURATION,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  DEFAULT_PERMISSION_MODE,
  EMPTY_CARRY,
  HUMAN_FALLBACK,
  proposeRoles,
  roleFromTemplate,
  ROLE_TEMPLATE,
} from './roles'
import type { TemplateRole } from './roles'
import { SUPERPOWERS_GATES } from './superpowers'

/** A repo scan with nothing found and source present. A test sets only what it reads. */
function scan(over: Partial<RepoScan>): RepoScan {
  return {
    findings: [],
    languages: [],
    codeDirs: [],
    hasSource: true,
    isTruncated: false,
    cadre: { dir: 'absent', manifest: null, manifestState: 'absent', state: null, stateState: 'absent' },
    warnings: [],
    ...over,
  }
}

/** One scan finding. */
function finding(kind: ScanKind, label: string, evidence: string): ScanFinding {
  return { kind, label, evidence }
}

/** The template row with this id; a test that names a missing row fails here, loudly. */
function row(id: TemplateRoleId): TemplateRole {
  const found = ROLE_TEMPLATE.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`no template row ${id}`)

  return found
}

const REACT = finding('fe', 'react', 'package.json')
const EXPRESS = finding('be', 'express', 'package.json')
const JS_TESTS = finding('test', 'JS/TS test files', 'src/a.test.ts')
const E2E = finding('e2e', 'Playwright config', 'playwright.config.ts')
const TS_LANG = finding('lang', 'JavaScript/TypeScript (package.json)', 'package.json')
const RUBY_LANG = finding('lang', 'Ruby (Gemfile)', 'Gemfile')
const GO_LANG = finding('lang', 'Go (go.mod)', 'go.mod')

/** The template ids in template order, which every proposal and its change list must keep. */
const TEMPLATE_ORDER: readonly TemplateRoleId[] = ['pm', 'tl', 'be', 'fe', 'qa', 'security']

const FE_REASON = 'no frontend framework found (react, vue, next, svelte, angular)'
const QA_REASON = 'no tests or E2E setup found'

/** The ids of a proposal's roles. */
function idsOf(over: Partial<RepoScan>): string[] {
  return proposeRoles(scan(over)).roles.map(role => role.id)
}

describe('ROLE_TEMPLATE', () => {
  test('lists pm, tl, be, fe, qa and security in that order, with their titles', () => {
    expect(ROLE_TEMPLATE.map(template => template.id)).toEqual(TEMPLATE_ORDER)
    expect(ROLE_TEMPLATE.map(template => template.title)).toEqual(['PM', 'Team Lead', 'BE', 'FE', 'QA', 'Security'])
  })

  test('the table and every row are frozen', () => {
    expect(Object.isFrozen(ROLE_TEMPLATE)).toBe(true)
    expect(ROLE_TEMPLATE.every(template => Object.isFrozen(template))).toBe(true)
  })

  test('each purpose is its fixed sentence', () => {
    expect(ROLE_TEMPLATE.map(template => template.purpose)).toEqual([
      'Owns product decisions: scope, requirements and acceptance.',
      'Owns architecture and QA decisions; reviews and merges the work.',
      'Implements the backend and core code.',
      'Implements the frontend.',
      'Owns tests and end-to-end checks.',
      'Owns security decisions and reviews.',
    ])
  })

  test('only PM lacks Bash, and PM, TL and Security ask the person (--ask-user)', () => {
    expect(ROLE_TEMPLATE.filter(template => !template.hasBash).map(template => template.id)).toEqual(['pm'])
    expect(ROLE_TEMPLATE.filter(template => template.askUser).map(template => template.id)).toEqual([
      'pm',
      'tl',
      'security',
    ])
  })

  test('the defaults are opus, medium effort, auto mode, 4h and a threshold of 65', () => {
    expect(DEFAULT_MODEL).toBe('opus')
    expect(DEFAULT_EFFORT).toBe('medium')
    expect(DEFAULT_PERMISSION_MODE).toBe('auto')
    expect(DEFAULT_DURATION).toBe('4h')
    expect(AUTOPILOT_THRESHOLD).toBe(65)
  })

  test('the human fallback is queue_question, and the empty carry is frozen with frozen lists', () => {
    expect(HUMAN_FALLBACK).toBe('human (queue_question)')
    expect(EMPTY_CARRY).toEqual({ autoCompactWindow: false, statusLine: false, env: [], hooks: [] })
    expect(Object.isFrozen(EMPTY_CARRY)).toBe(true)
    expect(Object.isFrozen(EMPTY_CARRY.env)).toBe(true)
    expect(Object.isFrozen(EMPTY_CARRY.hooks)).toBe(true)
  })

  test('roleFromTemplate of the PM row has no Bash, asks the person, and carries nothing', () => {
    expect(roleFromTemplate(row('pm'))).toEqual({
      id: 'pm',
      title: 'PM',
      purpose: 'Owns product decisions: scope, requirements and acceptance.',
      basedOn: 'pm',
      model: 'opus',
      effort: 'medium',
      permissionMode: 'auto',
      autopilot: { duration: '4h', threshold: 65, askUser: true },
      hasBash: false,
      mcp: [],
      skills: [],
      instructions: [],
      carry: { autoCompactWindow: false, statusLine: false, env: [], hooks: [] },
    })
  })

  test('roleFromTemplate gives be, fe and qa Bash and no --ask-user, and tl and security both', () => {
    const traits = (id: TemplateRoleId) => {
      const role = roleFromTemplate(row(id))

      return { hasBash: role.hasBash, askUser: role.autopilot.askUser }
    }

    expect(traits('be')).toEqual({ hasBash: true, askUser: false })
    expect(traits('fe')).toEqual({ hasBash: true, askUser: false })
    expect(traits('qa')).toEqual({ hasBash: true, askUser: false })
    expect(traits('tl')).toEqual({ hasBash: true, askUser: true })
    expect(traits('security')).toEqual({ hasBash: true, askUser: true })
  })

  test('every template role is based on itself and has the same model, effort, mode, duration and threshold', () => {
    const roles = ROLE_TEMPLATE.map(roleFromTemplate)

    expect(roles).toHaveLength(6)
    expect(roles.map(role => role.id)).toEqual(TEMPLATE_ORDER)
    expect(roles.map(role => role.basedOn)).toEqual(TEMPLATE_ORDER)
    expect(roles.every(role => role.model === 'opus' && role.effort === 'medium')).toBe(true)
    expect(roles.every(role => role.permissionMode === 'auto')).toBe(true)
    expect(roles.every(role => role.autopilot.duration === '4h' && role.autopilot.threshold === 65)).toBe(true)
    expect(roles.every(role => role.framework === undefined)).toBe(true)
  })

  test('roleFromTemplate gives a new role each call', () => {
    expect(roleFromTemplate(row('be'))).not.toBe(roleFromTemplate(row('be')))
  })
})

describe('proposeRoles', () => {
  test('a react, an express and a test finding propose all six roles in template order with no changes', () => {
    const proposal = proposeRoles(scan({ findings: [EXPRESS, REACT, JS_TESTS], languages: ['TypeScript'] }))

    expect(proposal.roles.map(role => role.id)).toEqual(TEMPLATE_ORDER)
    expect(proposal.changes).toEqual([])
  })

  test('each kept role is the template role', () => {
    const proposal = proposeRoles(scan({ findings: [EXPRESS, REACT, E2E] }))

    expect(proposal.roles).toHaveLength(6)
    expect(proposal.roles).toEqual(ROLE_TEMPLATE.map(roleFromTemplate))
  })

  test('no frontend finding drops FE with its reason and no evidence', () => {
    const proposal = proposeRoles(scan({ findings: [EXPRESS, JS_TESTS] }))

    expect(proposal.roles.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'qa', 'security'])
    expect(proposal.changes).toEqual([{ roleId: 'fe', change: 'dropped', reason: FE_REASON, evidence: [] }])
  })

  test('no test and no e2e finding drops QA with its reason and no evidence', () => {
    const proposal = proposeRoles(scan({ findings: [EXPRESS, REACT] }))

    expect(proposal.roles.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'fe', 'security'])
    expect(proposal.changes).toEqual([{ roleId: 'qa', change: 'dropped', reason: QA_REASON, evidence: [] }])
  })

  test('a test finding alone keeps QA, and so does an e2e finding alone', () => {
    expect(idsOf({ findings: [EXPRESS, REACT, JS_TESTS] })).toContain('qa')
    expect(idsOf({ findings: [EXPRESS, REACT, E2E] })).toContain('qa')
    expect(proposeRoles(scan({ findings: [EXPRESS, REACT, E2E] })).changes).toEqual([])
  })

  test('PM, TL and Security are proposed for every scan', () => {
    const scans: Partial<RepoScan>[] = [
      {},
      { hasSource: false },
      { findings: [REACT] },
      { findings: [EXPRESS, JS_TESTS] },
      { findings: [REACT, EXPRESS, JS_TESTS, E2E, TS_LANG], languages: ['TypeScript'] },
      { hasSource: false, isTruncated: true },
    ]

    for (const over of scans) {
      const ids = idsOf(over)

      expect(ids).toContain('pm')
      expect(ids).toContain('tl')
      expect(ids).toContain('security')
    }
  })

  test('no source code drops BE with its reason and no evidence', () => {
    const proposal = proposeRoles(scan({ hasSource: false, findings: [REACT, JS_TESTS] }))

    expect(proposal.roles.map(role => role.id)).toEqual(['pm', 'tl', 'fe', 'qa', 'security'])
    expect(proposal.changes).toEqual([
      { roleId: 'be', change: 'dropped', reason: 'no source code found', evidence: [] },
    ])
  })

  test('source code and no frontend framework keeps BE with the no UI reason and the language evidence', () => {
    const proposal = proposeRoles(scan({ languages: ['TypeScript'], findings: [TS_LANG, JS_TESTS] }))

    expect(proposal.roles.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'qa', 'security'])
    expect(proposal.changes).toEqual([
      {
        roleId: 'be',
        change: 'kept',
        reason: 'source code found (TypeScript), no UI framework',
        evidence: ['package.json'],
      },
      { roleId: 'fe', change: 'dropped', reason: FE_REASON, evidence: [] },
    ])
  })

  test('source code with a frontend framework and no backend framework keeps BE with the no backend reason', () => {
    const proposal = proposeRoles(
      scan({ languages: ['TypeScript', 'Ruby'], findings: [REACT, JS_TESTS, TS_LANG, RUBY_LANG] }),
    )

    expect(proposal.roles.map(role => role.id)).toEqual(TEMPLATE_ORDER)
    expect(proposal.changes).toEqual([
      {
        roleId: 'be',
        change: 'kept',
        reason: 'source code found (TypeScript, Ruby), no backend framework',
        evidence: ['package.json', 'Gemfile'],
      },
    ])
  })

  test('a repo with source but no named language says unknown language', () => {
    const proposal = proposeRoles(scan({ findings: [REACT, JS_TESTS] }))

    expect(proposal.changes).toEqual([
      {
        roleId: 'be',
        change: 'kept',
        reason: 'source code found (unknown language), no backend framework',
        evidence: [],
      },
    ])
  })

  test('a backend finding keeps BE with no change record', () => {
    const proposal = proposeRoles(scan({ findings: [EXPRESS, REACT, JS_TESTS] }))

    expect(proposal.changes.some(change => change.roleId === 'be')).toBe(false)
    expect(proposal.roles.some(role => role.id === 'be')).toBe(true)
  })

  test('the evidence lists at most three paths, taken from the language findings in finding order', () => {
    const langs = [
      GO_LANG,
      finding('lang', 'JavaScript/TypeScript (package.json)', 'web/package.json'),
      finding('lang', 'Python (pyproject.toml)', 'pyproject.toml'),
      RUBY_LANG,
    ]
    const proposal = proposeRoles(scan({ languages: ['Go'], findings: [...langs, JS_TESTS] }))
    const kept = proposal.changes.find(change => change.roleId === 'be')

    expect(kept?.evidence).toEqual(['go.mod', 'web/package.json', 'pyproject.toml'])
  })

  test('the evidence takes paths from the language findings only', () => {
    const proposal = proposeRoles(scan({ languages: ['Go'], findings: [JS_TESTS, GO_LANG] }))

    expect(proposal.changes.find(change => change.roleId === 'be')?.evidence).toEqual(['go.mod'])
  })

  test('two findings with the same path give one evidence entry', () => {
    const proposal = proposeRoles(
      scan({
        languages: ['TypeScript'],
        findings: [TS_LANG, finding('lang', 'TypeScript sources', 'package.json'), JS_TESTS],
      }),
    )

    expect(proposal.changes.find(change => change.roleId === 'be')?.evidence).toEqual(['package.json'])
  })

  test('adjacency edge: one evidence entry for a repeated kind and label, and two records for FE and BE', () => {
    const twice = [TS_LANG, finding('lang', 'JavaScript/TypeScript (package.json)', 'web/package.json'), JS_TESTS]
    const proposal = proposeRoles(scan({ languages: ['TypeScript'], findings: twice }))

    expect(proposal.changes.map(change => change.roleId)).toEqual(['be', 'fe'])
    expect(proposal.changes.find(change => change.roleId === 'be')?.evidence).toEqual(['package.json'])
    expect(proposal.changes.find(change => change.roleId === 'fe')?.change).toBe('dropped')
  })

  test('empty edge: no findings and no source propose exactly PM, TL and Security with three drops', () => {
    const proposal = proposeRoles(scan({ hasSource: false }))

    expect(proposal.roles.map(role => role.id)).toEqual(['pm', 'tl', 'security'])
    expect(proposal.changes).toEqual([
      { roleId: 'be', change: 'dropped', reason: 'no source code found', evidence: [] },
      { roleId: 'fe', change: 'dropped', reason: FE_REASON, evidence: [] },
      { roleId: 'qa', change: 'dropped', reason: QA_REASON, evidence: [] },
    ])
  })

  test('ordering edge: roles and changes keep template order for every scan', () => {
    const scans: Partial<RepoScan>[] = [
      {},
      { hasSource: false },
      { findings: [REACT] },
      { findings: [EXPRESS] },
      { findings: [JS_TESTS] },
      { findings: [E2E, TS_LANG], languages: ['TypeScript'] },
      { findings: [REACT, EXPRESS, JS_TESTS, E2E] },
      { hasSource: false, findings: [REACT, JS_TESTS] },
    ]

    for (const over of scans) {
      const proposal = proposeRoles(scan(over))
      const ids = proposal.roles.map(role => role.id)
      const changed = proposal.changes.map(change => change.roleId)

      expect(ids).toEqual(TEMPLATE_ORDER.filter(id => ids.includes(id)))
      expect(changed).toEqual(TEMPLATE_ORDER.filter(id => changed.includes(id)))
      expect(ids.slice(0, 2)).toEqual(['pm', 'tl'])
      expect(ids.at(-1)).toBe('security')
    }
  })

  test('a dropped role is never proposed, and a kept role with a record always is', () => {
    const scans: Partial<RepoScan>[] = [{}, { hasSource: false }, { findings: [REACT] }, { findings: [JS_TESTS] }]
    let checked = 0

    for (const over of scans) {
      const proposal = proposeRoles(scan(over))
      const ids = proposal.roles.map(role => role.id)

      for (const change of proposal.changes) {
        checked += 1

        expect(ids.includes(change.roleId)).toBe(change.change === 'kept')
      }
    }

    expect(checked > 0).toBe(true)
  })

  test('the scan is not changed', () => {
    const input = scan({ languages: ['TypeScript'], findings: [TS_LANG, JS_TESTS] })
    const before = JSON.stringify(input)

    proposeRoles(input)

    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('decision owners', () => {
  test('DECISION_OWNERS maps Product to pm, Arch and QA to tl, and Security to security, and is frozen', () => {
    expect(DECISION_OWNERS).toEqual({ Product: 'pm', Arch: 'tl', QA: 'tl', Security: 'security' })
    expect(Object.isFrozen(DECISION_OWNERS)).toBe(true)
  })

  test('every decision type has an owner that is a template role', () => {
    for (const type of DECISION_TYPES) {
      expect(ROLE_TEMPLATE.some(template => template.id === DECISION_OWNERS[type])).toBe(true)
    }
  })

  test('every non-null decisionType in the GSD, superpowers and built-in gate tables has an owner', () => {
    const gates = [...GSD_GATES, ...SUPERPOWERS_GATES, ...BUILTIN_GATES]
    let checked = 0

    for (const gate of gates) {
      if (gate.decisionType === null) continue
      checked += 1

      expect(Object.hasOwn(DECISION_OWNERS, gate.decisionType)).toBe(true)
    }

    expect(checked > 0).toBe(true)
  })

  test('the chain names the owner when it is present', () => {
    expect(decisionChain('Product', ['pm', 'tl'])).toEqual(['pm', 'human (queue_question)'])
    expect(decisionChain('Security', ['security', 'tl'])).toEqual(['security', 'human (queue_question)'])
    expect(decisionChain('Arch', ['tl'])).toEqual(['tl', 'human (queue_question)'])
  })

  test('the chain falls back to tl when the owner is missing', () => {
    expect(decisionChain('Product', ['tl'])).toEqual(['tl', 'human (queue_question)'])
    expect(decisionChain('Security', ['tl', 'be'])).toEqual(['tl', 'human (queue_question)'])
  })

  test('the chain is only the human when neither the owner nor tl is present', () => {
    expect(decisionChain('Security', ['be'])).toEqual(['human (queue_question)'])
    expect(decisionChain('Product', [])).toEqual(['human (queue_question)'])
    expect(decisionChain('QA', ['qa'])).toEqual(['human (queue_question)'])
  })

  test('every chain ends with the human fallback, whatever the roles', () => {
    const subsets: string[][] = [[], ['pm'], ['tl'], ['be', 'fe'], ['pm', 'tl'], ['security'], [...TEMPLATE_ORDER]]

    for (const roles of subsets) {
      for (const decision of DECISION_TYPES) {
        expect(decisionChain(decision, roles).at(-1)).toBe(HUMAN_FALLBACK)
      }
    }
  })

  test('chainLines gives one line per decision type in DECISION_TYPES order', () => {
    expect(chainLines(['tl', 'be'])).toEqual([
      'Product: tl -> human (queue_question)',
      'Arch: tl -> human (queue_question)',
      'Security: tl -> human (queue_question)',
      'QA: tl -> human (queue_question)',
    ])
  })

  test('chainLines names each owner of a full team, and only the human for a team without owners', () => {
    expect(chainLines([...TEMPLATE_ORDER])).toEqual([
      'Product: pm -> human (queue_question)',
      'Arch: tl -> human (queue_question)',
      'Security: security -> human (queue_question)',
      'QA: tl -> human (queue_question)',
    ])
    expect(chainLines(['be'])).toEqual([
      'Product: human (queue_question)',
      'Arch: human (queue_question)',
      'Security: human (queue_question)',
      'QA: human (queue_question)',
    ])
  })
})
