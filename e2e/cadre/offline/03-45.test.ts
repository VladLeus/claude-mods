import assert from 'node:assert/strict'
import { stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { offlinePath } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { copyTree } from '../../lib/fixture.ts'
import { run } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import { versionShim } from '../../lib/shims.ts'
import { buildBare } from '../fixtures/repo.ts'
import { copyWorld, miniWorld, runLauncher } from '../lib/world.ts'
import type { LaunchResult, MiniWorld } from '../lib/world.ts'
import { rowEntry } from '../rows.ts'

const EXPECTED_OLD_CLAUDE = 'cadre: needs claude 2.1.295 or newer on PATH (see claude --version)'
const EXPECTED_FOREIGN = 'cadre: not the repo of role be'
const EXPECTED_INVALID_NAME = 'not valid JSON'
const EXPECTED_OLDER_NAME = 'older than'
const OLD_CLAUDE = '2.1.294'
const NEW_CLAUDE = '2.1.322'
const TOUCH_MS = 10_000
// The shell's -nt compares whole seconds on some hosts, so the touched role.json lands two seconds after the stamp.
const TOUCH_AFTER_STAMP_MS = 2_000
const ECHO_RE = /echo ('(?:[^']|'\\'')*'|[A-Za-z0-9_./=:@+-]+) >&2/g

function unquote(word: string): string {
  if (!word.startsWith(`'`)) return word

  return word.slice(1, -1).replaceAll(`'\\''`, `'`)
}

// The UAT names these refusals without quoting them, so their exact line is read from the generated launcher.
function launcherLine(launcherText: string, name: string): string {
  const messages = [...launcherText.matchAll(ECHO_RE)].map(match => unquote(match[1] ?? ''))
  const lines = [...new Set(messages.filter(message => message.includes(name)))]
  const [line] = lines
  if (line === undefined || lines.length > 1) {
    throw new Error(`the launcher has ${lines.length} stderr lines holding "${name}", not one`)
  }

  return line
}

function resultText(result: LaunchResult): string {
  const exit = result.code === null ? 'running when claude was reached, stopped by the harness' : `exit ${result.code}`
  const calls = result.calls.map(call => `claude call: ${call.argv.join(' ')}`)

  return [exit, `stderr:\n${result.stderr}`, ...calls].join('\n')
}

function assertRefused(result: LaunchResult, line: string): void {
  assert.equal(result.calls.length, 0, 'the launcher reached claude instead of refusing')
  assert.notEqual(result.code, 0, 'the launcher exited 0')
  assert.ok(result.stderr.split('\n').includes(line), `stderr does not hold the line: ${line}`)
}

async function launch(
  ctx: RowContext,
  label: string,
  world: MiniWorld,
  version: string,
  launcher: string,
  repo: string,
): Promise<LaunchResult> {
  const bin = join(dirname(repo), 'bin')
  const log = join(dirname(repo), 'claude.log')
  await versionShim(bin, version, log)
  const result = await runLauncher(launcher, { cwd: repo, env: { ...world.env, PATH: offlinePath(bin) }, log })
  ctx.evidence(label, resultText(result))

  return result
}

rowTest(rowEntry('03#45'), async ctx => {
  const world = await miniWorld(join(ctx.scratch, 'world'), { kind: 'git-root' })

  await ctx.check('baseline', async () => {
    const copy = await copyWorld(world, join(ctx.scratch, 'baseline'))
    const result = await launch(ctx, 'baseline', world, NEW_CLAUDE, copy.launcher, copy.repo)
    if (result.calls.some(call => call.argv.length > 0)) return

    const message = `baseline: the ${NEW_CLAUDE} claude shim was never reached, so no refusal below means anything`
    throw new HarnessError(`${message} (exit ${result.code}: ${result.stderr.trim()})`)
  })

  await ctx.check('old claude', async () => {
    const copy = await copyWorld(world, join(ctx.scratch, 'old-claude'))
    const result = await launch(ctx, 'old claude', world, OLD_CLAUDE, copy.launcher, copy.repo)
    assertRefused(result, EXPECTED_OLD_CLAUDE)
  })

  await ctx.check('not valid JSON', async () => {
    const line = launcherLine(world.launcherText, EXPECTED_INVALID_NAME)
    const copy = await copyWorld(world, join(ctx.scratch, 'invalid-json'))
    const settings = join(copy.runtime, 'settings.json')
    await writeFile(settings, '{')
    const opts = { cwd: copy.repo, env: world.env, timeoutMs: TOUCH_MS }
    const touch = await run(['touch', '-r', copy.stamp, settings], opts)
    if (touch.code !== 0) throw new HarnessError(`touch -r exited ${touch.code}: ${touch.stderr.trim()}`)
    const result = await launch(ctx, 'not valid JSON', world, NEW_CLAUDE, copy.launcher, copy.repo)
    assertRefused(result, line)
  })

  await ctx.check('older than', async () => {
    const line = launcherLine(world.launcherText, EXPECTED_OLDER_NAME)
    const copy = await copyWorld(world, join(ctx.scratch, 'older-than'))
    const later = new Date((await stat(copy.stamp)).mtimeMs + TOUCH_AFTER_STAMP_MS)
    await utimes(copy.roleJson, later, later)
    const result = await launch(ctx, 'older than', world, NEW_CLAUDE, copy.launcher, copy.repo)
    assertRefused(result, line)
  })

  await ctx.check('foreign repo', async () => {
    const repo = join(ctx.scratch, 'foreign-repo', 'repo')
    await buildBare(repo, world.env)
    const launcher = join(repo, relative(world.repo, world.launcher))
    await copyTree(world.launcher, launcher)
    const result = await launch(ctx, 'foreign repo', world, NEW_CLAUDE, launcher, repo)
    assertRefused(result, EXPECTED_FOREIGN)
  })
})
