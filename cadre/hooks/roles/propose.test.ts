import { describe, expect, test } from 'claude-code/testing'

import type { RepoScan, ScanFinding, ScanKind, TemplateRoleId } from '../../types'
import { proposeRoles } from './propose'
import { NO_FRONTEND_REASON, NO_SOURCE_REASON, NO_TESTS_REASON, roleFromTemplate, ROLE_TEMPLATE } from './template'

/** A repo scan with nothing found and source present. A test sets only what it reads. */
function scan(over: Partial<RepoScan>): RepoScan {
  return {
    findings: [],
    languages: [],
    codeDirs: [],
    hasSource: true,
    cappedFolders: [],
    isOverallCapped: false,
    cadre: { dir: 'absent', manifest: null, manifestState: 'absent', state: null, stateState: 'absent' },
    warnings: [],
    ...over,
  }
}

/** One scan finding. */
function finding(kind: ScanKind, label: string, evidence: string): ScanFinding {
  return { kind, label, evidence }
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

/** The ids of a proposal's roles. */
function idsOf(over: Partial<RepoScan>): string[] {
  return proposeRoles(scan(over)).roles.map(role => role.id)
}

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
    expect(proposal.changes).toEqual([{ roleId: 'fe', change: 'dropped', reason: NO_FRONTEND_REASON, evidence: [] }])
  })

  test('no test and no e2e finding drops QA with its reason and no evidence', () => {
    const proposal = proposeRoles(scan({ findings: [EXPRESS, REACT] }))

    expect(proposal.roles.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'fe', 'security'])
    expect(proposal.changes).toEqual([{ roleId: 'qa', change: 'dropped', reason: NO_TESTS_REASON, evidence: [] }])
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
      { hasSource: false, cappedFolders: ['a/b'] },
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
      { roleId: 'be', change: 'dropped', reason: NO_SOURCE_REASON, evidence: [] },
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
      { roleId: 'fe', change: 'dropped', reason: NO_FRONTEND_REASON, evidence: [] },
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
      { roleId: 'be', change: 'dropped', reason: NO_SOURCE_REASON, evidence: [] },
      { roleId: 'fe', change: 'dropped', reason: NO_FRONTEND_REASON, evidence: [] },
      { roleId: 'qa', change: 'dropped', reason: NO_TESTS_REASON, evidence: [] },
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

    expect(checked).toBeGreaterThan(0)
  })

  test('the scan is not changed', () => {
    const input = scan({ languages: ['TypeScript'], findings: [TS_LANG, JS_TESTS] })
    const before = JSON.stringify(input)

    proposeRoles(input)

    expect(JSON.stringify(input)).toBe(before)
  })
})
