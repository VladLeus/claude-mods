import { describe, expect, test } from 'claude-code/testing'

import type { RoleChange } from '../../../types'
import { proposeRoles } from '../../roles/propose'
import { rolesFromProposal } from '../../suggest/propose'
import { FULL_SCAN, SOURCE_SCAN } from '../../testkit'
import { proposalLines } from './context'

/** The roles DESCRIBED_REPLY stands for. */
const DESCRIBED_ROLES = rolesFromProposal([
  { id: 'be', title: 'BE', purpose: 'API', basedOn: 'be' },
  { id: 'docs', title: 'Docs', purpose: 'docs', basedOn: null },
])

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
