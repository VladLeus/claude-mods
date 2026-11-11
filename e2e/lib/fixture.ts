import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { SYSTEM_PATH } from './env.ts'
import { HarnessError } from './errors.ts'
import { run } from './proc.ts'
import { scratchRoot } from './scratch.ts'

export const COPY_MS = 120_000

const VARIANT_RE = /^[a-z0-9-]+$/

export function copyArgv(src: string, dst: string, platform: string): readonly string[] {
  if (platform === 'darwin') return ['/bin/cp', '-cRp', src, dst]

  return ['cp', '-a', '--reflink=auto', src, dst]
}

export async function copyTree(src: string, dst: string): Promise<void> {
  if (!existsSync(src)) throw new HarnessError(`copyTree: the source ${basename(src)} does not exist`)
  if (existsSync(dst)) throw new HarnessError(`copyTree: the destination ${basename(dst)} already exists`)
  await mkdir(dirname(dst), { recursive: true })
  const env = { PATH: SYSTEM_PATH, HOME: join(scratchRoot(), 'home') }
  const result = await run(copyArgv(src, dst, process.platform), { cwd: dirname(dst), env, timeoutMs: COPY_MS })
  if (result.code === 0) return

  throw new HarnessError(`copyTree: cp exited ${result.code}: ${result.stderr.trim()}`)
}

export function fixtureDir(variant: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (!VARIANT_RE.test(variant)) throw new HarnessError(`fixtureDir: not a variant name: ${variant}`)
  const root = env.E2E_FIXTURES
  if (!root) throw new HarnessError('E2E_FIXTURES is unset: run through npm run e2e or e2e:live')

  return join(root, variant, 'repo')
}
