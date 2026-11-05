/**
 * The regenApply specs: the refusal of a plan and desired files that disagree, which writes nothing and runs nothing
 * (D-272 edge #33, D-347).
 */
import { describe, expect, test } from 'claude-code/testing'

import { NOTHING_APPLIED } from '../apply/run'
import { t } from '../locales/t'
import { planWithManifest } from '../plan/plan'
import {
  A,
  DEFAULT_LOCATIONS,
  emptySetupScan,
  file,
  hostWorld,
  input,
  LAUNCHER,
  memHost,
  memIo,
  memWorld,
  templateRole,
} from '../testkit'
import { regenApply } from './plan'
import type { RegenPlanned } from './plan'
import type { RegenHanded } from './review'

describe('regenApply (D-347)', () => {
  test(
    'a plan and desired files that disagree write nothing: the refusal and manifestSkipped, no host call (#33)',
    async () => {
      const desired = [file(LAUNCHER, '#!/bin/sh\n', 'exec'), file(A, 'a\n')]
      const { plan, manifest } = await planWithManifest(input({ desired }))
      // The create op of A has no desired file.
      const planned: RegenPlanned = {
        plan,
        warnings: [],
        dropped: [],
        desired: [file(LAUNCHER, '#!/bin/sh\n', 'exec')],
        manifest,
      }
      const handed: RegenHanded = {
        role: templateRole('be'),
        isRoleWritten: false,
        repoParts: null,
        privateRole: null,
        dropped: [],
        warnings: [],
        untracked: [],
        isSession: true,
        folder: null,
      }
      const run = memIo(memWorld({}), {})
      const host = memHost(hostWorld({}))
      const outcome = await regenApply(run.io, host.io, {
        locations: DEFAULT_LOCATIONS,
        planned,
        handed,
        setup: emptySetupScan(),
      })

      expect(outcome).toEqual({ ...NOTHING_APPLIED, refused: [t('apply.steps.planMismatch')], manifestSkipped: true })
      expect([host.writes, host.calls, run.asked]).toEqual([[], [], []])
    },
  )
})
