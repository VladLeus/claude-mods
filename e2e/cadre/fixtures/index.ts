import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preparePlugins } from '../../lib/claude.ts'
import { scratchEnv } from '../../lib/env.ts'
import type { ChildEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import type { BuildContext, Builder } from '../../lib/fixture.ts'
import { run } from '../../lib/proc.ts'
import { addMcpServer, assertMcpHandOut, buildByInit } from '../lib/session.ts'
import type { InitBuildSteps, LiveRepo } from '../lib/session.ts'
import {
  GSD_DIR_SCRIPT,
  GSD_HERE_SCRIPT,
  GSD_IGNOREALL_SCRIPT,
  GSD_SCRIPT,
  MCP_ROLE,
  MCP_SCRIPT,
  MCP_SERVER,
  NONE_TEAM_SCRIPT,
  V050_SCRIPT,
} from './answers.ts'
import type { DialogEntry } from './answers.ts'
import { buildBare, buildGsdPre, buildSpPre } from './repo.ts'

type RepoBuild = (repo: string, env: ChildEnv) => Promise<void>

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
// The commit that bumped cadre to 0.5.0, and the folders of the marketplace it holds.
const V050_COMMIT = '74a51375'
const MARKETPLACE_PATHS: readonly string[] = ['.claude-plugin', 'cadre', 'autopilot', 'agent-fleet']
const V050_PLUGINS: readonly string[] = ['cadre', 'autopilot', 'agent-fleet']
const ARCHIVE_MS = 120_000

function offlineBuilder(build: RepoBuild): Builder {
  return {
    from: [],
    build: async ctx => build(ctx.repo, await scratchEnv(join(ctx.dir, 'env'))),
  }
}

function initBuilder(from: string, script: readonly DialogEntry[], steps?: InitBuildSteps): Builder {
  return {
    from: [from],
    build: ctx => buildByInit(ctx, from, script, steps),
  }
}

async function addServerOrFail(copy: LiveRepo): Promise<void> {
  const added = await addMcpServer(copy, MCP_SERVER)
  if (added.code === 0) return

  throw new HarnessError(`claude mcp add exited ${added.code}: ${added.stderr.trim()}`)
}

// claude records the server for the project of this copy before the init, which reads ~/.claude.json and gives the
// server to one role. A copy at another path keeps the hand-out but not the server: its row adds the server itself.
const mcp = initBuilder('gsd-pre', MCP_SCRIPT, {
  before: addServerOrFail,
  after: copy => assertMcpHandOut(copy, MCP_SERVER, MCP_ROLE),
})

async function runChecked(argv: readonly string[], cwd: string, env: ChildEnv): Promise<void> {
  const result = await run(argv, { cwd, env, timeoutMs: ARCHIVE_MS })
  if (result.code === 0) return

  throw new HarnessError(`${argv.slice(0, 2).join(' ')} exited ${result.code}: ${result.stderr.trim()}`)
}

async function archiveMarketplace(ctx: BuildContext, env: ChildEnv): Promise<string> {
  const root = join(ctx.dir, 'marketplace')
  const archive = join(ctx.dir, 'marketplace.tar')
  await mkdir(root, { recursive: true })
  await runChecked(
    ['git', 'archive', '--format=tar', `--output=${archive}`, V050_COMMIT, '--', ...MARKETPLACE_PATHS],
    REPO_DIR,
    env,
  )
  await runChecked(['tar', '-xf', archive, '-C', root], ctx.dir, env)

  return root
}

// A team applied by cadre 0.5.0: inside the exclusive window the e2e dir holds that marketplace, and run.ts restores
// the current plugin state after the build.
const v050: Builder = {
  from: ['gsd-pre'],
  exclusive: true,
  build: async ctx => {
    const root = await archiveMarketplace(ctx, await scratchEnv(join(ctx.dir, 'env')))
    await preparePlugins(root, V050_PLUGINS)
    await buildByInit(ctx, 'gsd-pre', V050_SCRIPT)
  },
}

export const VARIANTS: Record<string, Builder> = {
  bare: offlineBuilder(buildBare),
  'gsd-pre': offlineBuilder(buildGsdPre),
  'sp-pre': offlineBuilder(buildSpPre),
  gsd: initBuilder('gsd-pre', GSD_SCRIPT),
  'gsd-here': initBuilder('gsd-pre', GSD_HERE_SCRIPT),
  'gsd-dir': initBuilder('gsd-pre', GSD_DIR_SCRIPT),
  'gsd-ignoreall': initBuilder('gsd-pre', GSD_IGNOREALL_SCRIPT),
  'none-team': initBuilder('bare', NONE_TEAM_SCRIPT),
  mcp,
  v050,
}
