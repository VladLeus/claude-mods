import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { claudeBin, configDir, squashed } from '../../lib/claude.ts'
import { fenceBin } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { run } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import { failMatchShim, logShim, parseShimLog } from '../../lib/shims.ts'
import type { ShimCall } from '../../lib/shims.ts'
import { capture, killServer, socketName, startServer } from '../../lib/tmux.ts'
import { GSD_SECURITY_INSTALL_SCRIPT } from '../fixtures/answers.ts'
import { APPLIED_REPLY, assertHaikuRoles, cadreTui, driveDialogs, liveRepo, systemTool } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const INIT_COMMAND = '/cadre init'
const MARKETPLACE = 'claude-plugins-official'
const SECURITY_KEY = `claude-security@${MARKETPLACE}`
const GUIDANCE_KEY = `security-guidance@${MARKETPLACE}`
const MARKETPLACE_ADD_ARGS: readonly string[] = ['marketplace', 'add', `anthropics/${MARKETPLACE}`]
const MARKETPLACE_ADD = `plugin ${MARKETPLACE_ADD_ARGS.join(' ')}`
const EXPECTED_INSTALL_COMMAND = `claude plugin install ${SECURITY_KEY}`
const EXPECTED_MARKETPLACE_HINT =
  '(if the claude-plugins-official marketplace is missing, first run: ' +
  'claude plugin marketplace add anthropics/claude-plugins-official)'
// The calls the UAT row names, in its order: the Python check, the failed install, the add, the install again, then
// security-guidance.
const EXPECTED_ORDER: readonly string[] = [
  'python3 --version',
  `claude plugin install ${SECURITY_KEY}`,
  `claude ${MARKETPLACE_ADD}`,
  `claude plugin install ${SECURITY_KEY}`,
  `claude plugin install ${GUIDANCE_KEY}`,
]
const PLUGIN_COMMAND_MS = 300_000
const SHOWN_CALLS = 40
const WRONG_CONFIG_DIR = 'cadre-spawned claude without the e2e config dir'
const ADD_FAILED_REASON = 'the marketplace add did not fail on this claude'

const row = rowEntry('03#82')

type InitRun = {
  readonly calls: readonly ShimCall[]
  readonly reply: string
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function callText(call: ShimCall): string {
  return [call.name, ...call.argv].join(' ')
}

function callsText(calls: readonly ShimCall[]): string {
  const lines = calls.slice(0, SHOWN_CALLS).map(call => `${callText(call)} (cwd ${call.cwd}, tty ${call.tty})`)
  const more = calls.length - SHOWN_CALLS

  return [...lines, ...(more > 0 ? [`... and ${more} more calls`] : [])].join('\n')
}

function isInstallOrAdd(call: ShimCall): boolean {
  return call.name === 'python3' || (call.name === 'claude' && call.argv[0] === 'plugin')
}

async function jsonOf(path: string): Promise<unknown> {
  return parseJson(await readFile(path, 'utf8').catch(() => ''))
}

async function knownMarketplaces(): Promise<readonly string[]> {
  const value = await jsonOf(join(configDir(), 'plugins', 'known_marketplaces.json'))

  return isRecord(value) ? Object.keys(value) : []
}

async function installedKeys(): Promise<readonly string[]> {
  const value = await jsonOf(join(configDir(), 'plugins', 'installed_plugins.json'))

  return isRecord(value) && isRecord(value.plugins) ? Object.keys(value.plugins) : []
}

async function plugin(ctx: RowContext, copy: LiveRepo, args: readonly string[]): Promise<number> {
  const argv = [claudeBin(), 'plugin', ...args]
  const home = copy.env.HOME
  if (!home) throw new HarnessError('the live env has no HOME')
  const result = await run(argv, { cwd: home, env: copy.env, timeoutMs: PLUGIN_COMMAND_MS })
  ctx.evidence(`claude plugin ${args.join(' ')}, exit code and output`, `exit ${result.code}\n${result.stderr}`)

  return result.code
}

// Drives /cadre init with the security plugins answered Install, in a root claude whose PATH starts with the shims.
async function initWithShims(ctx: RowContext, copy: LiveRepo, log: string, label: string): Promise<InitRun> {
  const server = await startServer(socketName(), copy.env)
  try {
    const pane = await cadreTui(server, copy, INIT_COMMAND)
    await driveDialogs(pane, GSD_SECURITY_INSTALL_SCRIPT, APPLIED_REPLY)
    const history = await capture(pane, { history: true })
    const reply = history.slice(Math.max(0, history.lastIndexOf(`❯ ${INIT_COMMAND}`)))
    ctx.evidence(`${label}: the reply of /cadre init`, reply)
    await assertHaikuRoles(copy)
    const calls = parseShimLog(await readFile(log, 'utf8').catch(() => ''))
    ctx.evidence(`${label}: the calls the shims logged`, callsText(calls))

    return { calls, reply }
  } finally {
    await killServer(server)
  }
}

async function firstInit(ctx: RowContext): Promise<void> {
  const shimDir = join(ctx.scratch, 'first', 'shims')
  const log = join(ctx.scratch, 'first', 'calls.log')
  await logShim(shimDir, 'claude', fenceBin(), log, ['CLAUDECODE', 'CLAUDE_CONFIG_DIR'])
  await logShim(shimDir, 'python3', await systemTool('python3'), log)
  const copy = await liveRepo(ctx, 'gsd-pre', { path: 'first/repo', shimDir })
  if ((await knownMarketplaces()).includes(MARKETPLACE)) {
    throw new HarnessError(`03#82 needs the e2e dir without the ${MARKETPLACE} marketplace at its start`)
  }

  const { calls } = await initWithShims(ctx, copy, log, 'the first init')
  const claudeCalls = calls.filter(call => call.name === 'claude')
  const e2eDir = configDir()
  if (!claudeCalls.every(call => call.env.CLAUDE_CONFIG_DIR === e2eDir)) throw new HarnessError(WRONG_CONFIG_DIR)
  const liveHome = copy.env.HOME
  if (!liveHome) throw new HarnessError('the live env has no HOME')
  const home = await realpath(liveHome)
  const steps = calls.filter(isInstallOrAdd)

  await ctx.check('the runs come in the UAT order', () => {
    assert.deepEqual(steps.map(callText), EXPECTED_ORDER, 'the logged order differs')
  })
  await ctx.check('every run has the home folder as its cwd', () => {
    const elsewhere = steps.filter(call => call.cwd !== home).map(callText)
    assert.deepEqual(elsewhere, [], `these runs have another cwd: ${elsewhere.join('; ')}`)
  })
  await ctx.check('no run waits for input: none has a terminal on stdin', () => {
    const withTty = calls.filter(call => call.tty).map(callText)
    assert.deepEqual(withTty, [], `these runs have a terminal on stdin: ${withTty.join('; ')}`)
  })
  await ctx.check('claude runs from inside a session: CLAUDECODE is set', () => {
    assert.ok(claudeCalls.length > 0, 'no claude call was logged')
    const unset = claudeCalls.filter(call => call.env.CLAUDECODE === null).map(callText)
    assert.deepEqual(unset, [], `CLAUDECODE is unset for: ${unset.join('; ')}`)
  })
  const keys = await installedKeys()
  ctx.evidence('installed_plugins.json keys after the first init', keys.join('\n'))
  for (const key of [SECURITY_KEY, GUIDANCE_KEY]) {
    await ctx.check(`installed_plugins.json holds ${key}`, () => {
      assert.ok(keys.includes(key), `installed_plugins.json does not hold ${key}`)
    })
  }
}

// The add-already-there case: the marketplace stays, the two plugins go, so the second init offers them again.
async function addAlreadyThere(ctx: RowContext): Promise<void> {
  const shimDir = join(ctx.scratch, 'second', 'shims')
  const log = join(ctx.scratch, 'second', 'calls.log')
  const state = join(ctx.scratch, 'second', 'failed-once')
  await failMatchShim(shimDir, 'claude', fenceBin(), log, SECURITY_KEY, state)
  const copy = await liveRepo(ctx, 'gsd-pre', { path: 'second/repo', shimDir })
  if (!(await knownMarketplaces()).includes(MARKETPLACE)) {
    ctx.observe('addAlreadyThereRun', false, `the ${MARKETPLACE} marketplace is not there after the first init`)
    for (const part of ['no install retry after a failed add', 'the install command with the marketplace hint']) {
      ctx.skipPart(part, `the ${MARKETPLACE} marketplace is not there after the first init`)
    }
    return
  }
  for (const key of [SECURITY_KEY, GUIDANCE_KEY]) {
    const code = await plugin(ctx, copy, ['uninstall', key])
    if (code !== 0) throw new HarnessError(`03#82: claude plugin uninstall ${key} exited ${code}`)
  }

  const { calls, reply } = await initWithShims(ctx, copy, log, 'the add-already-there init')
  const texts = calls.map(callText)
  const securityInstall = `claude plugin install ${SECURITY_KEY}`
  if (!texts.includes(securityInstall)) throw new HarnessError('03#82: the second init ran no claude-security install')
  const addAt = texts.indexOf(`claude ${MARKETPLACE_ADD}`)
  await ctx.check('the forced install failure makes cadre run the marketplace add', () => {
    assert.ok(addAt > texts.indexOf(securityInstall), 'no marketplace add after the failed claude-security install')
  })
  const isRetried = addAt !== -1 && texts.slice(addAt + 1).includes(securityInstall)
  ctx.observe('installRetriedAfterTheAdd', isRetried, isRetried ? 'the install ran again' : 'no install after the add')

  const addCode = await plugin(ctx, copy, MARKETPLACE_ADD_ARGS)
  ctx.observe('marketplaceAddExitCodeWhenThere', addCode, `claude ${MARKETPLACE_ADD} with the marketplace there`)
  if (addCode === 0) {
    for (const part of ['no install retry after a failed add', 'the install command with the marketplace hint']) {
      ctx.skipPart(part, ADD_FAILED_REASON)
    }
    return
  }
  await ctx.check('no install retry after the failed add', () => {
    assert.ok(addAt !== -1 && !isRetried, 'the log holds a claude-security install after the add')
  })
  await ctx.check('the reply holds the install command followed by the marketplace hint', () => {
    const expected = `${EXPECTED_INSTALL_COMMAND} ${EXPECTED_MARKETPLACE_HINT}`
    assert.ok(squashed(reply).includes(expected), `the reply does not hold: ${expected}`)
  })
}

rowTest(row, async ctx => {
  if (row.exclusive !== true) {
    throw new HarnessError('03#82 installs plugins in the e2e dir: its registry entry must be exclusive')
  }
  await firstInit(ctx)
  await addAlreadyThere(ctx)
})
