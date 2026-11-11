import { constants } from 'node:fs'
import { access, mkdir, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { offlinePath } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { run } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import { versionShim } from '../../lib/shims.ts'
import { copyWorld, miniWorld, runLauncher } from '../lib/world.ts'
import type { LaunchResult, MiniWorld } from '../lib/world.ts'
import { rowEntry } from '../rows.ts'

const CURRENT_CLAUDE = '2.1.322'
const DOUBLE_JSON = '{}{}'
const INVALID_JSON_NAME = 'not valid JSON'
const TOUCH_MS = 10_000
const JQ = 'jq'
const NODE = 'node'

function resultText(result: LaunchResult): string {
  const exit = result.code === null ? 'running when claude was reached, stopped by the harness' : `exit ${result.code}`
  const calls = result.calls.map(call => `claude call: ${call.argv.join(' ')}`)

  return [exit, `stderr:\n${result.stderr}`, ...calls].join('\n')
}

async function isExecutable(path: string): Promise<boolean> {
  const stats = await stat(path).catch(() => null)
  if (!stats?.isFile()) return false

  return access(path, constants.X_OK).then(() => true, () => false)
}

async function onPath(name: string, dirs: readonly string[]): Promise<boolean> {
  for (const dir of dirs) {
    if (await isExecutable(join(dir, name))) return true
  }

  return false
}

async function linkToolsWithoutJq(dirs: readonly string[], into: string): Promise<void> {
  await mkdir(into)
  const linked = new Set<string>([JQ])
  for (const dir of dirs) {
    for (const name of await readdir(dir).catch(() => [])) {
      const target = join(dir, name)
      if (linked.has(name) || !await isExecutable(target)) continue
      linked.add(name)
      await symlink(target, join(into, name))
    }
  }
  if (!await onPath(NODE, [into])) throw new HarnessError('the folder of links has no node, so no check could run')
}

// The launcher starts claude once its JSON check passes; the version shim logs that call.
function acceptedBy(result: LaunchResult, label: string): boolean {
  if (result.calls.length > 0) return true
  if (result.stderr.includes(INVALID_JSON_NAME)) return false
  const first = result.stderr.trim().split('\n')[0] ?? ''

  throw new HarnessError(`${label}: the launcher stopped before its JSON check: ${first}`)
}

async function launchWith(
  ctx: RowContext,
  world: MiniWorld,
  name: string,
  tools: readonly string[],
): Promise<LaunchResult> {
  const copy = await copyWorld(world, join(ctx.scratch, name))
  const settings = join(copy.runtime, 'settings.json')
  await writeFile(settings, DOUBLE_JSON)
  const opts = { cwd: copy.repo, env: world.env, timeoutMs: TOUCH_MS }
  const touch = await run(['touch', '-r', copy.stamp, settings], opts)
  if (touch.code !== 0) throw new HarnessError(`touch -r exited ${touch.code}: ${touch.stderr.trim()}`)
  const bin = join(ctx.scratch, `${name}-bin`)
  const log = join(ctx.scratch, `${name}.log`)
  await versionShim(bin, CURRENT_CLAUDE, log)
  const env = { ...world.env, PATH: [bin, ...tools].join(':') }

  return runLauncher(copy.launcher, { cwd: copy.repo, env, log })
}

rowTest(rowEntry('03#58'), async ctx => {
  const world = await miniWorld(join(ctx.scratch, 'world'), { kind: 'git-root' })
  const normal = offlinePath().split(':')
  if (await onPath(JQ, normal)) {
    const result = await launchWith(ctx, world, 'with-jq', normal)
    ctx.observe('acceptedWithJq', acceptedBy(result, 'with jq'), resultText(result))
  } else {
    ctx.observe('withJq', 'no jq on host', 'jq is in none of the folders of the PATH the launcher runs with')
  }

  const withoutJq = join(ctx.scratch, 'without-jq')
  await linkToolsWithoutJq(normal, withoutJq)
  const result = await launchWith(ctx, world, 'node-only', [withoutJq])
  ctx.observe('acceptedWithNodeOnly', acceptedBy(result, 'with node only'), resultText(result))
})
