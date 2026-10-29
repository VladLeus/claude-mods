import { describe, expect, test } from 'claude-code/testing'

import { appliedLines, NEXT_STEP_NOTE } from '../apply/run'
import { DRY_RUN_NOTE, renderPlan } from '../plan/text'
import { emptyDiskPlan, outcomeOf } from '../testkit'
import { initReplyText } from './initapply'
import { IGNORE_ALL_NOTE } from './replies'
import { policyLine } from './stages/policy'

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
