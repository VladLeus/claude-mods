import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { scratchEnv } from '../../lib/env.ts'
import type { ChildEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { copyTree } from '../../lib/fixture.ts'
import { spawn } from '../../lib/proc.ts'
import { parseShimLog } from '../../lib/shims.ts'
import type { ShimCall } from '../../lib/shims.ts'
import { importSource } from '../../lib/source.ts'
import { buildBare } from '../fixtures/repo.ts'

const MINI_ROLE = 'be'
const MINI_FRAMEWORK = 'none'
const RUNTIME_JSON = '{}'
const LAUNCH_WAIT_MS = 20_000
const POLL_MS = 200

export type LaunchStart =
  | { readonly kind: 'git-root' }
  | { readonly kind: 'here' }
  | { readonly kind: 'dir'; readonly path: string }

export type MiniWorld = {
  readonly repo: string
  readonly env: ChildEnv
  readonly launcher: string
  readonly launcherText: string
  readonly roleJson: string
  readonly runtime: string
  readonly stamp: string
}

export type LaunchOptions = {
  readonly cwd: string
  readonly env: ChildEnv
  readonly log: string
}

export type LaunchResult = {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly calls: readonly ShimCall[]
}

type CadreState = {
  readonly schema: 1
  readonly cadreVersion: string
  readonly framework: string
  readonly gitPolicy: string
  readonly roles: readonly string[]
  readonly launchStart: LaunchStart
  readonly readUserMcp: boolean
}

type GenerateInput = {
  readonly roles: readonly unknown[]
  readonly scopes: ReadonlyMap<string, unknown>
  readonly state: CadreState
  readonly only: string | null
}

type Seam = {
  readonly templateRole: (id: string) => unknown
  readonly scopeOf: (role: unknown, framework: string, team: readonly unknown[], over: object) => unknown
  readonly desiredFiles: (input: GenerateInput) => unknown
}

type DesiredFile = {
  readonly path: string
  readonly content: string
  readonly mode: 'file' | 'exec'
}

function seamFunction(module: unknown, name: string): (...args: unknown[]) => unknown {
  const value = isRecord(module) ? module[name] : undefined
  if (typeof value !== 'function') throw new HarnessError(`cadre seam changed: ${name}`)

  return (...args) => value(...args)
}

async function loadSeam(): Promise<Seam> {
  const testkit = await importSource('cadre/hooks/testkit.ts')
  const files = await importSource('cadre/hooks/generate/files.ts')
  const templateRole = seamFunction(testkit, 'templateRole')
  const scopeOf = seamFunction(testkit, 'scopeOf')
  const desiredFiles = seamFunction(files, 'desiredFiles')

  return {
    templateRole: id => templateRole(id),
    scopeOf: (role, framework, team, over) => scopeOf(role, framework, team, over),
    desiredFiles: input => desiredFiles(input),
  }
}

function isSafePath(path: string): boolean {
  return !isAbsolute(path) && normalize(path) === path && !path.split('/').includes('..')
}

function desiredFileOf(value: unknown): DesiredFile | null {
  if (!isRecord(value)) return null
  const { path, content, mode } = value
  if (typeof path !== 'string' || typeof content !== 'string' || !isSafePath(path)) return null
  if (mode !== 'file' && mode !== 'exec') return null

  return { path, content, mode }
}

function desiredFilesOf(value: unknown): readonly DesiredFile[] | null {
  if (!Array.isArray(value)) return null
  const files = value.map(desiredFileOf)

  return files.every((file): file is DesiredFile => file !== null) ? files : null
}

function generate(seam: Seam, start: LaunchStart): readonly DesiredFile[] {
  const role = seam.templateRole(MINI_ROLE)
  if (!isRecord(role) || role.id !== MINI_ROLE) throw new HarnessError('cadre seam changed: templateRole')
  const team = [role]
  const scopes = new Map([[MINI_ROLE, seam.scopeOf(role, MINI_FRAMEWORK, team, { launchStart: start })]])
  const state: CadreState = {
    schema: 1,
    cadreVersion: '0.2.0',
    framework: MINI_FRAMEWORK,
    gitPolicy: 'definitions',
    roles: [MINI_ROLE],
    launchStart: start,
    readUserMcp: false,
  }
  const files = desiredFilesOf(seam.desiredFiles({ roles: team, scopes, state, only: null }))
  if (!files) throw new HarnessError('cadre seam changed: desiredFiles')

  return files
}

function worldAt(repo: string, env: ChildEnv, launcherText: string): MiniWorld {
  const runtime = join(repo, '.cadre', MINI_ROLE, '.runtime')

  return {
    repo,
    env,
    launcher: join(repo, '.cadre', 'bin', MINI_ROLE),
    launcherText,
    roleJson: join(repo, '.cadre', MINI_ROLE, 'role.json'),
    runtime,
    stamp: join(runtime, 'stamp'),
  }
}

export async function miniWorld(dir: string, start: LaunchStart): Promise<MiniWorld> {
  const files = generate(await loadSeam(), start)
  const launcherFile = files.find(file => file.path === `.cadre/bin/${MINI_ROLE}`)
  if (!launcherFile) throw new HarnessError(`cadre seam changed: desiredFiles gave no .cadre/bin/${MINI_ROLE}`)

  const env = await scratchEnv(dir)
  const repo = join(dir, 'repo')
  await buildBare(repo, env)
  for (const file of files) {
    const target = join(repo, file.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.content)
    if (file.mode === 'exec') await chmod(target, 0o755)
  }
  const world = worldAt(repo, env, launcherFile.content)
  await mkdir(world.runtime, { recursive: true })
  await writeFile(join(world.runtime, 'settings.json'), RUNTIME_JSON)
  await writeFile(join(world.runtime, 'mcp.json'), RUNTIME_JSON)
  await writeFile(world.stamp, '')

  return world
}

export async function copyWorld(world: MiniWorld, dir: string): Promise<MiniWorld> {
  const repo = join(dir, 'repo')
  await copyTree(world.repo, repo)

  return worldAt(repo, world.env, world.launcherText)
}

async function shimCalls(log: string): Promise<readonly ShimCall[]> {
  const text = await readFile(log, 'utf8').catch(() => '')

  return parseShimLog(text.slice(0, text.lastIndexOf('\n') + 1))
}

// A launcher that reaches claude execs it, and the version shim then sleeps, so a logged call ends the wait.
export async function runLauncher(launcher: string, opts: LaunchOptions): Promise<LaunchResult> {
  const child = spawn([launcher], { cwd: opts.cwd, env: opts.env })
  const exited = child.done.then(result => ({ result }))
  for (let waitedMs = 0; waitedMs < LAUNCH_WAIT_MS; waitedMs += POLL_MS) {
    const settled = await Promise.race([exited, delay(POLL_MS, null)])
    if (settled) return { ...settled.result, calls: await shimCalls(opts.log) }
    const calls = await shimCalls(opts.log)
    if (calls.length === 0) continue
    child.kill()
    const { stdout, stderr } = await child.done

    return { code: null, stdout, stderr, calls }
  }
  child.kill('SIGKILL')
  await child.done.catch(() => null)

  throw new HarnessError(`${basename(launcher)} neither exited nor reached claude in ${LAUNCH_WAIT_MS} ms`)
}
