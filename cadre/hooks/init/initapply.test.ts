import { describe, expect, test } from 'claude-code/testing'

import type { DesiredFile, GitPolicy, HunkOp, Plan } from '../../types'
import { appliedLines, NEXT_STEP_NOTE } from '../apply/run'
import { gitignoreLines } from '../plan/gitignore'
import { buildPlan } from '../plan/plan'
import { DRY_RUN_NOTE, renderPlan } from '../plan/text'
import { outcomeOf } from '../testkit'
import { initReplyText } from './initapply'
import { IGNORE_ALL_NOTE } from './replies'
import { policyLine } from './stages/policy'

/**
 * The plan buildPlan gives for these files when the disk holds nothing, with the ignore block of `policy` and, for a
 * team with a Security role, the security reports line, as init plans the block (decision #39). The `.gitignore` op
 * shows the block lines (PLAN-03), so a block planned without that line would differ.
 */
async function emptyDiskPlan(
  desired: readonly DesiredFile[],
  policy: GitPolicy,
  hunks: readonly HunkOp[] = [],
  hasSecurityRole = false,
): Promise<Plan> {
  return buildPlan({
    desired,
    disk: new Map(),
    manifest: null,
    manifestState: 'absent',
    carried: [],
    gitignore: { disk: { state: 'absent' }, lines: gitignoreLines(policy, null, hasSecurityRole) },
    hunks,
    cadreVersion: '0.2.0',
  })
}

describe('init plan', () => {
  test('initReplyText ends a plain reply with the applied lines and a dry run with its note', async () => {
    const plan = await emptyDiskPlan([], 'ignore')
    const outcome = outcomeOf({ written: ['.cadre/bin/be', '.gitignore'], executable: ['.cadre/bin/be'] })
    expect(appliedLines(outcome)).toEqual(['Applied: wrote 2 files (1 executable).', NEXT_STEP_NOTE])
    expect(initReplyText(plan, 'ignore', { kind: 'dir', path: 'apps/web' }, outcome).split('\n')).toEqual([
      'cadre init',
      ...renderPlan(plan),
      policyLine('ignore'),
      'Launchers start in: apps/web/ under the git root',
      IGNORE_ALL_NOTE,
      ...appliedLines(outcome),
    ])
    expect(initReplyText(plan, 'definitions', { kind: 'git-root' }, null).split('\n')).toEqual([
      'cadre init --dry-run',
      ...renderPlan(plan),
      policyLine('definitions'),
      'Launchers start in: the git root',
      DRY_RUN_NOTE,
    ])
  })
})
