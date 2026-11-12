import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { printMode } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { rowTest } from '../../lib/row.ts'
import { mcpStub } from '../../lib/shims.ts'
import { liveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const STUB_SERVER = 'stub'
const STUB_TOOL_PREFIX = `mcp__${STUB_SERVER}__`
const DENIED_TOOL = 'WebFetch'
const UNKNOWN_KEY = 'e2eUnknownTopLevelKey'
const PROMPT = 'Reply with OK'
const STREAM_ARGS: readonly string[] = ['--output-format', 'stream-json', '--verbose']

const row = rowEntry('03#50')

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

function toolsOf(event: Record<string, unknown>): readonly string[] {
  return Array.isArray(event.tools) ? event.tools.filter(tool => typeof tool === 'string') : []
}

function stubServerText(event: Record<string, unknown>): string {
  const servers = Array.isArray(event.mcp_servers) ? event.mcp_servers : []
  const stub: unknown = servers.find(server => isRecord(server) && server.name === STUB_SERVER)

  return stub === undefined ? 'the init event lists no stub server' : JSON.stringify(stub)
}

async function writeJson(path: string, value: unknown): Promise<string> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)

  return path
}

rowTest(row, async ctx => {
  for (const part of row.partial ?? []) ctx.skipPart(part.part, part.reason)
  const copy = await liveRepo(ctx, 'bare')
  const stub = await mcpStub(join(ctx.scratch, 'mcp'))
  const mcpConfig = await writeJson(join(ctx.scratch, 'mcp.json'), {
    mcpServers: { [STUB_SERVER]: { type: 'stdio', command: process.execPath, args: [stub] } },
  })
  const denySettings = await writeJson(join(ctx.scratch, 'denied-mcp.json'), {
    deniedMcpServers: [{ serverName: STUB_SERVER }],
  })

  const denied = await printMode(
    copy.repo,
    [...STREAM_ARGS, '--mcp-config', mcpConfig, '--settings', denySettings, PROMPT],
    copy.env,
  )
  ctx.evidence('the run with deniedMcpServers, exit code and stderr', `exit ${denied.code}\n${denied.stderr}`)
  const deniedInit = initEventOf(denied.stdout)
  if (deniedInit === null) throw new HarnessError('03#50: the deniedMcpServers run printed no init event')
  const stubTools = toolsOf(deniedInit).filter(tool => tool.startsWith(STUB_TOOL_PREFIX))
  ctx.evidence('the stub server in the init event', stubServerText(deniedInit))
  ctx.observe(
    'stubToolsAbsentWithFlagLayerDeniedMcpServers',
    stubTools.length === 0,
    stubTools.length === 0 ? `no ${STUB_TOOL_PREFIX} tool in the init event` : stubTools.join(', '),
  )

  const unknownSettings = await writeJson(join(ctx.scratch, 'unknown-key.json'), {
    [UNKNOWN_KEY]: true,
    permissions: { deny: [DENIED_TOOL] },
  })
  const unknown = await printMode(copy.repo, [...STREAM_ARGS, '--settings', unknownSettings, PROMPT], copy.env)
  ctx.evidence('the run with an unknown settings key, exit code and stderr', `exit ${unknown.code}\n${unknown.stderr}`)
  const unknownInit = initEventOf(unknown.stdout)
  if (unknownInit === null) throw new HarnessError('03#50: the unknown-key run printed no init event')
  const isDenied = !toolsOf(unknownInit).includes(DENIED_TOOL)
  const evidence = isDenied
    ? `${DENIED_TOOL} is not in the init event tools: the file was kept`
    : `${DENIED_TOOL} is in the init event tools: the deny was lost`
  ctx.observe('webFetchDeniedNextToAnUnknownKey', isDenied, evidence)
})
