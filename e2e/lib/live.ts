import { constants as fsConstants, realpathSync } from 'node:fs'
import { access, lstat, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { isRealConfig, SYSTEM_PATH } from './env.ts'
import type { HostUser } from './env.ts'
import { HarnessError } from './errors.ts'
import { isRecord } from './filter.ts'
import { compareGuard, fenceRefusals, fleetBeats, globalAwayActive, guardSnapshot } from './guard.ts'
import { keychainDigest, projectTranscripts, removeSessionFiles, testSessionIds } from './guard.ts'
import type { GuardResult, GuardSnapshot, KeychainDigest, Needles, Removal } from './guard.ts'
import { run } from './proc.ts'
import { isUnder, scratchBase } from './scratch.ts'

const CLAUDE_VERSION_MS = 30_000
const SESSION_SETTLE_MS = 5_000
const KEYCHAIN_LIST_MS = 30_000
const LOCK_PID_FILE = 'pid'
const KEYCHAIN_LIST_ARGV = ['/usr/bin/security', 'dump-keychain'] as const

export type LiveScope = {
  readonly host: HostUser
  readonly e2eDir: string
  readonly needles: Needles
}

type SessionPass = {
  readonly ids: readonly string[]
  readonly removal: Removal
}

export type SessionCleanup = {
  readonly removed: number
  readonly failures: readonly string[]
  readonly recorded: ReadonlySet<string>
}

export async function resolveOnPath(name: string, pathValue: string): Promise<string | null> {
  for (const dir of pathValue.split(delimiter)) {
    if (!isAbsolute(dir)) continue
    const candidate = join(dir, name)
    const usable = await access(candidate, fsConstants.X_OK).then(() => stat(candidate)).then(
      stats => stats.isFile(),
      () => false,
    )
    if (usable) return candidate
  }

  return null
}

export async function claudeVersion(bin: string, scratch: string): Promise<string> {
  const home = join(scratch, 'claude-version')
  await mkdir(home, { recursive: true })
  const env = { PATH: [dirname(bin), dirname(process.execPath), SYSTEM_PATH].join(':'), HOME: home }
  const result = await run([bin, '--version'], { cwd: home, env, timeoutMs: CLAUDE_VERSION_MS }).catch(() => null)
  const line = result?.code === 0 ? result.stdout.trim().split('\n')[0] : undefined

  return line || 'absent (claude --version failed)'
}

export function e2eDirReason(dir: string, host: HostUser, repoDir: string): string | null {
  if (isRealConfig(dir, host, process.env)) return 'the e2e config dir is the real config dir or lies under it'
  const repo = realpathSync(repoDir)
  if (dir === repo || isUnder(dir, repo)) return 'the e2e config dir is inside the repo'

  return null
}

function errorCode(error: unknown): unknown {
  return isRecord(error) ? error.code : undefined
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) === 'EPERM'
  }
}

async function lockPid(lock: string): Promise<number> {
  return Number((await readFile(join(lock, LOCK_PID_FILE), 'utf8').catch(() => '')).trim())
}

async function makeLock(lock: string): Promise<boolean> {
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return false
    throw error
  }
  await writeFile(join(lock, LOCK_PID_FILE), `${process.pid}\n`)

  return true
}

export async function takeLock(lock: string): Promise<boolean> {
  if (await makeLock(lock)) return true
  if (isAlive(await lockPid(lock))) return false
  const stats = await lstat(lock).catch(() => null)
  if (stats?.isSymbolicLink()) throw new HarnessError(`the run lock is a symlink: ${lock}`)
  await rm(lock, { recursive: true, force: true })

  return makeLock(lock)
}

export async function releaseLock(lock: string): Promise<void> {
  if (await lockPid(lock) !== process.pid) return

  await rm(lock, { recursive: true, force: true })
}

export async function isGlobalAway(home: string, now: number): Promise<boolean> {
  const text = await readFile(join(home, '.claude', 'autopilot', 'status', 'global.json'), 'utf8').catch(() => '')

  return globalAwayActive(text, now)
}

export async function keychainState(host: HostUser, repoDir: string): Promise<KeychainDigest | null | undefined> {
  if (process.platform !== 'darwin') return undefined
  const env = { PATH: SYSTEM_PATH, HOME: host.home, USER: host.user }
  const opts = { cwd: repoDir, env, timeoutMs: KEYCHAIN_LIST_MS, host: true }
  const result = await run(KEYCHAIN_LIST_ARGV, opts).catch(() => null)

  return result?.code === 0 ? keychainDigest(result.stdout) : null
}

export function keychainNote(digest: KeychainDigest | null | undefined): string {
  if (digest === undefined) return 'no keychain listing off macOS'
  if (digest === null) return 'keychain listing unavailable'

  return `keychain: ${digest.count} Claude Code items`
}

export async function removeLeftovers(scope: LiveScope): Promise<Removal> {
  const transcripts = await projectTranscripts(scope.e2eDir)
  const ids = testSessionIds(transcripts, await fleetBeats(scope.host.home), scratchBase(), scope.e2eDir)

  return removeSessionFiles(scope.host.home, ids)
}

async function removeRunSessions(scope: LiveScope, before: GuardSnapshot): Promise<SessionPass> {
  const existed = new Set(before.sessionFiles)
  const beats = (await fleetBeats(scope.host.home)).filter(beat => !existed.has(`fleet/${beat.id}.json`))
  const ids = testSessionIds(await projectTranscripts(scope.e2eDir), beats, scratchBase(), scope.e2eDir)

  return { ids, removal: await removeSessionFiles(scope.host.home, ids) }
}

export async function cleanupSessions(scope: LiveScope, before: GuardSnapshot): Promise<SessionCleanup> {
  const first = await removeRunSessions(scope, before)
  // A session that dies with its tmux server can still write one last beat after the first pass.
  await delay(SESSION_SETTLE_MS)
  const second = await removeRunSessions(scope, before)

  return {
    removed: first.removal.removed + second.removal.removed,
    failures: [...new Set([...first.removal.failures, ...second.removal.failures])],
    recorded: new Set([...first.ids, ...second.ids]),
  }
}

export async function checkGuard(
  scope: LiveScope,
  scratch: string,
  before: GuardSnapshot,
  recorded: ReadonlySet<string>,
  repoDir: string,
): Promise<GuardResult> {
  const after = await guardSnapshot(scope.host.home, scope.needles, await keychainState(scope.host, repoDir))
  const beats = await fleetBeats(scope.host.home)
  const beatCwds = new Map(beats.flatMap(beat => (beat.cwd === null ? [] : [[beat.id, beat.cwd] as const])))
  const refusals = await fenceRefusals(scratch)

  return compareGuard(before, after, { needles: scope.needles, refusals, recorded, beatCwds })
}

export function guardItems(notRemoved: readonly string[], cleanup: SessionCleanup, guard: GuardResult): readonly string[] {
  return [
    ...guard.failures.map(line => `failure: ${line}`),
    ...notRemoved.map(rel => `session files not removed: ${rel}`),
    `removed ${cleanup.removed} files of ${cleanup.recorded.size} test sessions`,
    ...guard.warnings.map(line => `warning: ${line}`),
  ]
}
