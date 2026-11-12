import { claudeBin, printMode } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { run } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import { liveRepo } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const EXPECTED_SKILL = 'claude-security:claude-security'
const PLUGIN_KEY = 'claude-security@claude-plugins-official'
const MARKETPLACE = 'anthropics/claude-plugins-official'
const PLUGIN_NAME = 'claude-security'
const PLUGIN_COMMAND_MS = 300_000
const PROMPT = 'Reply with OK'

const row = rowEntry('03#80')

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function initEventOf(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.split('\n')) {
    const event = parseJson(line)
    if (isRecord(event) && event.type === 'system' && event.subtype === 'init') return event
  }

  return null
}

function namesOf(event: Record<string, unknown>, list: string): readonly string[] {
  const value = event[list]
  if (!Array.isArray(value)) return []

  return value.filter(item => typeof item === 'string' && item.includes(PLUGIN_NAME))
}

async function plugin(ctx: RowContext, copy: LiveRepo, args: readonly string[]): Promise<void> {
  const argv = [claudeBin(), 'plugin', ...args]
  const result = await run(argv, { cwd: copy.repo, env: copy.env, timeoutMs: PLUGIN_COMMAND_MS })
  const label = `claude plugin ${args.join(' ')}`
  ctx.evidence(`${label}, exit code and output`, `exit ${result.code}\n${result.stdout}\n${result.stderr}`)
  if (result.code !== 0) throw new HarnessError(`03#80: ${label} exited ${result.code}`)
}

rowTest(row, async ctx => {
  for (const part of row.partial ?? []) ctx.skipPart(part.part, part.reason)
  if (row.exclusive !== true) {
    throw new HarnessError('03#80 installs a plugin in the e2e dir: its registry entry must be exclusive')
  }
  const copy = await liveRepo(ctx, 'bare')
  await plugin(ctx, copy, ['marketplace', 'add', MARKETPLACE])
  await plugin(ctx, copy, ['install', PLUGIN_KEY])

  const result = await printMode(copy.repo, ['--output-format', 'stream-json', '--verbose', PROMPT], copy.env)
  ctx.evidence('the stream-json run after the install, exit code and stderr', `exit ${result.code}\n${result.stderr}`)
  const init = initEventOf(result.stdout)
  if (init === null) throw new HarnessError('03#80: the stream-json run printed no init event')
  const commands = namesOf(init, 'slash_commands')
  const skills = namesOf(init, 'skills')
  ctx.evidence('the claude-security names in the init event', [
    `slash_commands: ${commands.join(', ') || 'none'}`,
    `skills: ${skills.join(', ') || 'none'}`,
  ].join('\n'))
  ctx.observe('claudeSecurityCommandName', commands[0] ?? null, commands.join(', ') || 'no matching slash command')
  ctx.observe(
    'commandNameIsTheExpectedOne',
    commands.includes(EXPECTED_SKILL),
    `expected ${EXPECTED_SKILL} (CLAUDE_SECURITY_SKILL)`,
  )
})
