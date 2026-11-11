import { join } from 'node:path'
import { scratchEnv } from '../../lib/env.ts'
import type { ChildEnv } from '../../lib/env.ts'
import type { Builder } from '../../lib/fixture.ts'
import { buildBare, buildGsdPre, buildSpPre } from './repo.ts'

type RepoBuild = (repo: string, env: ChildEnv) => Promise<void>

function offlineBuilder(build: RepoBuild): Builder {
  return {
    from: [],
    build: async ctx => build(ctx.repo, await scratchEnv(join(ctx.dir, 'env'))),
  }
}

export const VARIANTS: Record<string, Builder> = {
  bare: offlineBuilder(buildBare),
  'gsd-pre': offlineBuilder(buildGsdPre),
  'sp-pre': offlineBuilder(buildSpPre),
}
