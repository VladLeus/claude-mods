import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HarnessError } from './errors.ts'

export const SHIM_SLEEP_S = 300

export type ShimCall = {
  readonly name: string
  readonly cwd: string
  readonly tty: boolean
  readonly env: Readonly<Record<string, string | null>>
  readonly argv: readonly string[]
}

const SHIM_NAME_RE = /^[A-Za-z0-9._-]+$/
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function shellQuote(value: string): string {
  return `'${value.replaceAll(`'`, `'\\''`)}'`
}

// The whole record is built first and appended by one cat, so records of parallel calls never interleave; a printf of
// more than about 1 KB reaches the file in pieces.
function recordFunction(name: string, envNames: readonly string[]): string {
  const envLines = envNames.map(env => {
    const set = `line="$line$tab"'env:${env}='"$${env}"`
    const unset = `line="$line$tab"'env:${env}'`

    return `  if [ "\${${env}+set}" = set ]; then ${set}; else ${unset}; fi`
  })

  return [
    'record() {',
    `  tab=$(printf '\\t')`,
    `  line=${shellQuote(name)}`,
    `  line="$line\${tab}cwd=$(pwd -P)"`,
    `  if [ -t 0 ]; then line="$line\${tab}tty=yes"; else line="$line\${tab}tty=no"; fi`,
    ...envLines,
    `  line="$line\${tab}argv"`,
    `  for arg in "$@"; do line="$line$tab$arg"; done`,
    '  /bin/cat >> "$log" <<EOF',
    '$line',
    'EOF',
    '}',
  ].join('\n')
}

async function writeShim(dir: string, name: string, script: string): Promise<string> {
  if (!SHIM_NAME_RE.test(name)) throw new HarnessError(`not a shim name: ${name}`)
  await mkdir(dir, { recursive: true })
  const path = join(dir, name)
  await writeFile(path, script)
  await chmod(path, 0o755)

  return path
}

export async function logShim(
  dir: string,
  name: string,
  realPath: string | null,
  logFile: string,
  envNames: readonly string[] = ['CLAUDECODE'],
): Promise<string> {
  const badEnv = envNames.find(env => !ENV_NAME_RE.test(env))
  if (badEnv !== undefined) throw new HarnessError(`not an env name: ${badEnv}`)
  const tail = realPath ? `exec ${shellQuote(realPath)} "$@"` : 'exit 0'
  const script = ['#!/bin/sh', `log=${shellQuote(logFile)}`, recordFunction(name, envNames), 'record "$@"', tail, '']

  return writeShim(dir, name, script.join('\n'))
}

export async function versionShim(dir: string, version: string, logFile: string): Promise<string> {
  const script = [
    '#!/bin/sh',
    `log=${shellQuote(logFile)}`,
    recordFunction('claude', []),
    'if [ "$1" = --version ]; then',
    `  printf '%s\\n' ${shellQuote(`${version} (Claude Code)`)}`,
    '  exit 0',
    'fi',
    'record "$@"',
    `exec /bin/sleep ${SHIM_SLEEP_S}`,
    '',
  ]

  return writeShim(dir, 'claude', script.join('\n'))
}

// A claude that answers `--version` through `claudeBin` and fails every other call with `message` on stderr.
export async function probeFailShim(dir: string, claudeBin: string, message: string): Promise<string> {
  const script = [
    '#!/bin/sh',
    'if [ "$1" = --version ]; then',
    `  exec ${shellQuote(claudeBin)} "$@"`,
    'fi',
    `printf '%s\\n' ${shellQuote(message)} >&2`,
    'exit 1',
    '',
  ]

  return writeShim(dir, 'claude', script.join('\n'))
}

// Logs every call like logShim; the first call that holds `matchArg` as one argument writes `stateFile` and exits 1,
// every other call execs `execPath`.
export async function failMatchShim(
  dir: string,
  name: string,
  execPath: string,
  logFile: string,
  matchArg: string,
  stateFile: string,
): Promise<string> {
  const script = [
    '#!/bin/sh',
    `log=${shellQuote(logFile)}`,
    `state=${shellQuote(stateFile)}`,
    recordFunction(name, ['CLAUDECODE']),
    'record "$@"',
    'if [ ! -e "$state" ]; then',
    '  for arg in "$@"; do',
    `    if [ "$arg" = ${shellQuote(matchArg)} ]; then`,
    '      : > "$state"',
    '      exit 1',
    '    fi',
    '  done',
    'fi',
    `exec ${shellQuote(execPath)} "$@"`,
    '',
  ]

  return writeShim(dir, name, script.join('\n'))
}

// The probe pipes stdout into grep, so the shim buffers it to keep the exit code.
export async function recordShim(dir: string, execPath: string, outFile: string): Promise<string> {
  const script = [
    '#!/bin/sh',
    `out=${shellQuote(outFile)}`,
    'part="$out.$$"',
    `${shellQuote(execPath)} "$@" > "$part"`,
    'code=$?',
    '/bin/cat "$part" >> "$out"',
    '/bin/cat "$part"',
    '/bin/rm -f "$part"',
    'exit "$code"',
    '',
  ]

  return writeShim(dir, 'claude', script.join('\n'))
}

const MCP_STUB_FILE = 'mcp-stub.mjs'

const MCP_STUB_LINES: readonly string[] = [
  'import { createInterface } from "node:readline"',
  'const tool = { name: "ping", description: "Answers pong.", inputSchema: { type: "object", properties: {} } }',
  'const serverInfo = { name: "e2e-stub", version: "0.0.0" }',
  'const results = {',
  '  initialize: params => ({',
  '    protocolVersion: params?.protocolVersion ?? "2024-11-05",',
  '    capabilities: { tools: {} },',
  '    serverInfo,',
  '  }),',
  '  "tools/list": () => ({ tools: [tool] }),',
  '  "tools/call": () => ({ content: [{ type: "text", text: "pong" }] }),',
  '  ping: () => ({}),',
  '}',
  'const send = message => process.stdout.write(JSON.stringify(message) + "\\n")',
  'for await (const line of createInterface({ input: process.stdin })) {',
  '  let request = null',
  '  try { request = JSON.parse(line) } catch { continue }',
  '  if (request === null || typeof request !== "object" || request.id === undefined) continue',
  '  const result = results[request.method]',
  '  if (result === undefined) {',
  '    send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "method not found" } })',
  '    continue',
  '  }',
  '  send({ jsonrpc: "2.0", id: request.id, result: result(request.params) })',
  '}',
  '',
]

// A stdio MCP server with one tool `ping`; notifications such as notifications/initialized get no answer.
export async function mcpStub(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, MCP_STUB_FILE)
  await writeFile(path, MCP_STUB_LINES.join('\n'))

  return path
}

function parseCall(line: string): ShimCall | null {
  const fields = line.split('\t')
  const [name, cwdField, ttyField] = fields
  const argvAt = fields.indexOf('argv')
  if (!name || !cwdField?.startsWith('cwd=') || argvAt < 3) return null
  if (ttyField !== 'tty=yes' && ttyField !== 'tty=no') return null
  const envFields = fields.slice(3, argvAt)
  if (!envFields.every(field => field.startsWith('env:'))) return null
  const env = Object.fromEntries(envFields.map((field): [string, string | null] => {
    const body = field.slice('env:'.length)
    const at = body.indexOf('=')
    if (at === -1) return [body, null]

    return [body.slice(0, at), body.slice(at + 1)]
  }))

  return { name, cwd: cwdField.slice('cwd='.length), tty: ttyField === 'tty=yes', env, argv: fields.slice(argvAt + 1) }
}

export function parseShimLog(text: string): readonly ShimCall[] {
  return text.split('\n').filter(line => line.length > 0).map(parseCall).filter(call => call !== null)
}
