import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const SYSTEM_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
export const GIT_USER_NAME = 'e2e'
export const GIT_USER_EMAIL = 'e2e@example.invalid'

export type ChildEnv = Readonly<Record<string, string>>

export type OfflineEnvOptions = {
  readonly home: string
  readonly gitConfig: string
  readonly shimDir?: string | undefined
}

export function offlinePath(shimDir?: string): string {
  const dirs = [dirname(process.execPath), SYSTEM_PATH]

  return (shimDir ? [shimDir, ...dirs] : dirs).join(':')
}

export function offlineEnv(opts: OfflineEnvOptions): ChildEnv {
  return {
    PATH: offlinePath(opts.shimDir),
    HOME: opts.home,
    GIT_CONFIG_GLOBAL: opts.gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
  }
}

export function gitConfigText(): string {
  return `[user]\n\tname = ${GIT_USER_NAME}\n\temail = ${GIT_USER_EMAIL}\n`
}

export async function scratchEnv(dir: string, shimDir?: string): Promise<ChildEnv> {
  const home = join(dir, 'home')
  const gitConfig = join(dir, 'gitconfig')
  await mkdir(home, { recursive: true })
  await writeFile(gitConfig, gitConfigText())

  return offlineEnv({ home, gitConfig, shimDir })
}
