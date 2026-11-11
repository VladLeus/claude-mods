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

function recordFunction(name: string, envNames: readonly string[]): string {
  const envLines = envNames.map(env =>
    `    if [ "\${${env}+set}" = set ]; then printf '\\tenv:${env}=%s' "$${env}"; else printf '\\tenv:${env}'; fi`)

  return [
    'record() {',
    '  {',
    `    printf '%s' ${shellQuote(name)}`,
    `    printf '\\tcwd=%s' "$(pwd -P)"`,
    `    if [ -t 0 ]; then printf '\\ttty=yes'; else printf '\\ttty=no'; fi`,
    ...envLines,
    `    printf '\\targv'`,
    `    for arg in "$@"; do printf '\\t%s' "$arg"; done`,
    `    printf '\\n'`,
    '  } >> "$log"',
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
