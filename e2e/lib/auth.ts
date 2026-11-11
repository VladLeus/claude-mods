import { realpathSync, statSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { HarnessError } from './errors.ts'
import { isRecord } from './filter.ts'
import type { FilterValues } from './filter.ts'
import type { Env } from './proc.ts'
import { rootReason } from './scratch.ts'

export const AUTH_MARGIN_MS = 3 * 60 * 60_000

export type AuthStatus = {
  readonly loggedIn: boolean
  readonly expiresAt: number | null
  readonly identityValues: readonly string[]
}

const IDENTITY_KEY_RE = /email|name|org|account/i
const MIN_IDENTITY_CHARS = 3
const EPOCH_DIGITS_RE = /^[0-9]+$/
const EPOCH_MS_FROM = 1e12

export function e2eConfigPath(env: Env = process.env, home: string = userInfo().homedir): string {
  return env.E2E_CONFIG_DIR || join(home, '.cache', 'claude-mods-e2e', 'config')
}

export function e2eConfigDir(env: Env = process.env, home?: string): string {
  const path = e2eConfigPath(env, home)
  let real: string
  try {
    real = realpathSync(path)
  } catch {
    throw new HarnessError(`the e2e config dir does not exist: ${path}`)
  }
  if (!statSync(real).isDirectory()) throw new HarnessError(`the e2e config dir is not a folder: ${path}`)

  return real
}

function expiryOf(value: unknown): number | null {
  if (typeof value !== 'string') return null
  // loginExpiresAt is an ISO-8601 string; an all-digit value is epoch seconds below 1e12, else epoch ms.
  if (EPOCH_DIGITS_RE.test(value)) {
    const epoch = Number(value)
    if (!Number.isFinite(epoch)) return null
    return epoch < EPOCH_MS_FROM ? epoch * 1000 : epoch
  }
  const at = Date.parse(value)

  return Number.isFinite(at) ? at : null
}

function identityValuesOf(status: Record<string, unknown>): readonly string[] {
  const values = Object.entries(status).flatMap(([key, value]) => {
    if (!IDENTITY_KEY_RE.test(key) || typeof value !== 'string') return []
    return value.length >= MIN_IDENTITY_CHARS ? [value] : []
  })

  return [...new Set(values)]
}

export function parseAuthStatus(stdout: string): AuthStatus | null {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!isRecord(value) || typeof value.loggedIn !== 'boolean') return null

  return {
    loggedIn: value.loggedIn,
    expiresAt: expiryOf(value.loginExpiresAt),
    identityValues: identityValuesOf(value),
  }
}

export function expiresSoon(expiresAt: number | null, now: number): boolean {
  if (expiresAt === null) return false

  return expiresAt < now + AUTH_MARGIN_MS
}

export async function writeFilterFile(scratchRoot: string, identities: readonly string[]): Promise<string> {
  const why = rootReason(scratchRoot)
  if (why) throw new HarnessError(`writeFilterFile refused: ${why}`)
  const dir = join(scratchRoot, 'auth')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
  const path = join(dir, 'filter.json')
  const values: FilterValues = { credentials: [], identities: [...identities] }
  await writeFile(path, `${JSON.stringify(values)}\n`, { mode: 0o600, flag: 'wx' })

  return path
}
