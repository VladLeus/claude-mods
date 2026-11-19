import { existsSync, realpathSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { e2eConfigDir } from './auth.ts'
import { HarnessError } from './errors.ts'
import type { Env } from './proc.ts'
import { isUnder, rootReason, scratchRoot } from './scratch.ts'

export const SYSTEM_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
export const GIT_USER_NAME = 'e2e'
export const GIT_USER_EMAIL = 'e2e@example.invalid'

export type ChildEnv = Readonly<Record<string, string>>

export type OfflineEnvOptions = {
  readonly home: string
  readonly gitConfig: string
  readonly shimDir?: string | undefined
}

export type HostUser = {
  readonly home: string
  readonly user: string
}

export type LiveEnvOptions = {
  readonly shimDir?: string | undefined
  readonly claudeBin?: string | undefined
  readonly configDir?: string | undefined
  readonly env?: Env
  readonly host?: HostUser
}

const FENCE_EXIT_CODE = 97
const FENCE_REFUSAL = 'e2e fence: claude without the e2e config dir'
const FENCE_UNSAFE_RE = /['\n]/

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

export function hostUser(): HostUser {
  const info = userInfo()

  return { home: info.homedir, user: info.username }
}

function realOrResolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function realConfigDirs(host: HostUser, env: Env): readonly string[] {
  const own = env.CLAUDE_CONFIG_DIR ? [env.CLAUDE_CONFIG_DIR] : []

  return [join(host.home, '.claude'), ...own].map(realOrResolved)
}

export function isRealConfig(dir: string, host: HostUser, env: Env): boolean {
  return realConfigDirs(host, env).some(real => dir === real || isUnder(dir, real))
}

function liveConfigDir(value: string | undefined, host: HostUser, env: Env): string {
  if (!value) throw new HarnessError('liveEnv: CLAUDE_CONFIG_DIR is unset or empty')
  let real: string
  try {
    real = realpathSync(value)
  } catch {
    throw new HarnessError(`liveEnv: CLAUDE_CONFIG_DIR does not exist: ${value}`)
  }
  if (real !== e2eConfigDir(env, host.home)) {
    throw new HarnessError('liveEnv: CLAUDE_CONFIG_DIR is not the e2e config dir')
  }
  if (isRealConfig(real, host, env)) throw new HarnessError('liveEnv: CLAUDE_CONFIG_DIR is in the real config dir')

  return real
}

export function livePath(scratch: string, claudeBin: string, shimDir?: string): string {
  const dirs = [join(scratch, 'fence'), dirname(claudeBin), dirname(process.execPath), SYSTEM_PATH]

  return (shimDir ? [shimDir, ...dirs] : dirs).join(':')
}

export function liveEnv(opts: LiveEnvOptions = {}): ChildEnv {
  const env = opts.env ?? process.env
  const host = opts.host ?? hostUser()
  if (!isAbsolute(host.home)) throw new HarnessError('liveEnv: the home folder is not absolute')
  if (!host.user) throw new HarnessError('liveEnv: the user name is empty')
  const claudeBin = opts.claudeBin ?? env.E2E_CLAUDE_BIN
  if (!claudeBin) throw new HarnessError('liveEnv: E2E_CLAUDE_BIN is unset: run through npm run e2e:live')
  const configDir = liveConfigDir(opts.configDir ?? env.E2E_CONFIG_DIR, host, env)
  const scratch = scratchRoot(env)

  return {
    PATH: livePath(scratch, claudeBin, opts.shimDir),
    HOME: host.home,
    USER: host.user,
    CLAUDE_CONFIG_DIR: configDir,
    LANG: 'en_US.UTF-8',
    TERM: 'xterm-256color',
    TMPDIR: env.TMPDIR || tmpdir(),
    ANTHROPIC_MODEL: 'haiku',
    CLAUDE_CODE_EFFORT_LEVEL: 'medium',
    CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1',
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
    CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1',
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    GIT_CONFIG_GLOBAL: join(scratch, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    npm_config_cache: join(scratch, 'npm-cache'),
  }
}

function fenceText(log: string, claudeBin: string, e2eDir: string): string {
  return [
    '#!/bin/sh',
    `if [ "$CLAUDE_CONFIG_DIR" != '${e2eDir}' ]; then`,
    `  printf '%s\\n' refused >> '${log}'`,
    `  printf '%s\\n' '${FENCE_REFUSAL}' >&2`,
    `  exit ${FENCE_EXIT_CODE}`,
    'fi',
    `exec '${claudeBin}' "$@"`,
    '',
  ].join('\n')
}

export async function writeClaudeFence(root: string, claudeBin: string, e2eDir: string): Promise<string> {
  if ([root, claudeBin, e2eDir].some(path => FENCE_UNSAFE_RE.test(path))) {
    throw new HarnessError('writeClaudeFence refused: a path holds a single quote or a newline')
  }
  const why = rootReason(root)
  if (why) throw new HarnessError(`writeClaudeFence refused: ${why}`)
  const dir = join(root, 'fence')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, 'claude')
  await writeFile(path, fenceText(join(dir, 'refused.log'), claudeBin, e2eDir), { mode: 0o700 })
  await chmod(path, 0o700)
  // The live env's GIT_CONFIG_GLOBAL file is written here, since run.ts writes the fence once before any live child.
  await writeFile(join(root, 'gitconfig'), gitConfigText())

  return path
}

export function fenceBin(env: Env = process.env): string {
  const path = join(scratchRoot(env), 'fence', 'claude')
  if (!existsSync(path)) throw new HarnessError('the claude fence is not written: run through npm run e2e:live')

  return path
}
