import { join } from 'node:path'
import { scratchEnv } from '../../lib/env.ts'
import type { ChildEnv } from '../../lib/env.ts'
import type { Builder } from '../../lib/fixture.ts'
import { buildByInit } from '../lib/session.ts'
import { GSD_DIR_SCRIPT, GSD_HERE_SCRIPT, GSD_IGNOREALL_SCRIPT, GSD_SCRIPT } from './answers.ts'
import type { DialogEntry } from './answers.ts'
import { buildBare, buildGsdPre, buildSpPre } from './repo.ts'

type RepoBuild = (repo: string, env: ChildEnv) => Promise<void>

function offlineBuilder(build: RepoBuild): Builder {
  return {
    from: [],
    build: async ctx => build(ctx.repo, await scratchEnv(join(ctx.dir, 'env'))),
  }
}

function initBuilder(from: string, script: readonly DialogEntry[]): Builder {
  return {
    from: [from],
    build: ctx => buildByInit(ctx, from, script),
  }
}

export const VARIANTS: Record<string, Builder> = {
  bare: offlineBuilder(buildBare),
  'gsd-pre': offlineBuilder(buildGsdPre),
  'sp-pre': offlineBuilder(buildSpPre),
  gsd: initBuilder('gsd-pre', GSD_SCRIPT),
  'gsd-here': initBuilder('gsd-pre', GSD_HERE_SCRIPT),
  'gsd-dir': initBuilder('gsd-pre', GSD_DIR_SCRIPT),
  'gsd-ignoreall': initBuilder('gsd-pre', GSD_IGNOREALL_SCRIPT),
}
