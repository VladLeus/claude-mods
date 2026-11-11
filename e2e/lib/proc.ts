import { spawn as spawnChild } from 'node:child_process'
import { constants } from 'node:os'
import { basename, resolve } from 'node:path'
import { HarnessError } from './errors.ts'
import { isUnder, rootReason } from './scratch.ts'

export type Env = Readonly<Record<string, string | undefined>>

export type RunOptions = {
  readonly cwd: string
  readonly env: Env
  readonly input?: string
  readonly timeoutMs: number
  readonly host?: boolean
}

export type SpawnOptions = {
  readonly cwd: string
  readonly env: Env
  readonly input?: string
  readonly timeoutMs?: number
  readonly host?: boolean
  readonly inherit?: boolean
}

export type RunResult = {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type Child = {
  readonly pid: number | undefined
  readonly done: Promise<RunResult>
  kill(signal?: NodeJS.Signals): void
}

const KILL_GRACE_MS = 2_000

export function fenceReason(env: Env, root: string | undefined): string | null {
  if (!root) return 'the scratch root is unknown (E2E_SCRATCH is unset)'
  const rootWhy = rootReason(root)
  if (rootWhy) return rootWhy
  if (!env.HOME) return 'HOME is missing'
  if (!isUnder(resolve(env.HOME), root)) return 'HOME is outside the scratch root'

  return null
}

function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code
  if (!signal) return 1

  return 128 + constants.signals[signal]
}

export function spawn(argv: readonly string[], opts: SpawnOptions): Child {
  const [program, ...args] = argv
  if (!program) throw new HarnessError('spawn needs a program')
  const name = basename(program)
  const why = opts.host === true ? null : fenceReason(opts.env, process.env.E2E_SCRATCH)
  if (why) throw new HarnessError(`refusing to start ${name}: ${why}`)

  const output = opts.inherit === true ? 'inherit' : 'pipe'
  const child = spawnChild(program, args, {
    cwd: opts.cwd,
    env: { ...opts.env },
    stdio: [opts.input === undefined ? 'ignore' : 'pipe', output, output],
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })
  child.stdin?.on('error', () => {})
  if (opts.input !== undefined) child.stdin?.end(opts.input)

  const done = new Promise<RunResult>((resolveDone, rejectDone) => {
    let timedOut = false
    const timer = opts.timeoutMs === undefined ? null : setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref()
    }, opts.timeoutMs)
    child.on('error', error => {
      if (timer) clearTimeout(timer)
      rejectDone(new HarnessError(`cannot start ${name}: ${error.message}`))
    })
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      if (timedOut) return rejectDone(new HarnessError(`${name} timed out after ${opts.timeoutMs} ms`))
      resolveDone({ code: exitCodeOf(code, signal), stdout, stderr })
    })
  })

  return {
    pid: child.pid,
    done,
    kill: signal => {
      child.kill(signal)
    },
  }
}

export async function run(argv: readonly string[], opts: RunOptions): Promise<RunResult> {
  return spawn(argv, opts).done
}
