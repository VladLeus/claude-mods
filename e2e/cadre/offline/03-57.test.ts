import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { scratchEnv } from '../../lib/env.ts'
import type { ChildEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { run } from '../../lib/proc.ts'
import type { RunResult } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import { rowEntry } from '../rows.ts'

const NT_SCRIPT = 'touch b; touch a; [ a -nt b ] && echo newer || echo not-newer'
const ATTEMPTS = 5
const STEP_MS = 10_000
const NS_PER_SECOND = 1_000_000_000n

type NtRun = {
  readonly result: RunResult
  readonly attempt: number
  readonly aNs: bigint
  readonly bNs: bigint
}

type Filesystem = {
  readonly type: string
  readonly evidence: string
}

async function ntRun(dir: string, env: ChildEnv, attempt: number): Promise<NtRun> {
  const cwd = join(dir, `attempt-${attempt}`)
  await mkdir(cwd)
  const result = await run(['/bin/sh', '-c', NT_SCRIPT], { cwd, env, timeoutMs: STEP_MS })
  const [a, b] = await Promise.all([stat(join(cwd, 'a'), { bigint: true }), stat(join(cwd, 'b'), { bigint: true })])

  return { result, attempt, aNs: a.mtimeNs, bNs: b.mtimeNs }
}

// Two touches can straddle a second boundary, which would make whole-second -nt look precise; retry until both
// files carry the same whole second.
async function sameSecondRun(dir: string, env: ChildEnv): Promise<NtRun> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const nt = await ntRun(dir, env, attempt)
    if (nt.aNs / NS_PER_SECOND === nt.bNs / NS_PER_SECOND) return nt
  }

  throw new HarnessError(`touch b and touch a never landed in one whole second in ${ATTEMPTS} attempts`)
}

async function filesystemOf(dir: string, env: ChildEnv): Promise<Filesystem> {
  const opts = { cwd: dir, env, timeoutMs: STEP_MS }
  if (process.platform !== 'darwin') {
    const df = await run(['df', '-PT', dir], opts)
    const type = df.stdout.trim().split('\n')[1]?.split(/\s+/)[1] ?? 'unknown'

    return { type, evidence: `$ df -PT ${dir}\n${df.stdout}${df.stderr}` }
  }
  const df = await run(['df', '-P', dir], opts)
  const mountPoint = df.stdout.trim().split('\n')[1]?.split(/\s+/).slice(5).join(' ') ?? ''
  const mount = await run(['mount'], opts)
  const line = mount.stdout.split('\n').find(entry => entry.includes(` on ${mountPoint} (`)) ?? ''
  const type = /\(([^,)]+)/.exec(line)?.[1] ?? 'unknown'

  return { type, evidence: `$ df -P ${dir}\n${df.stdout}${df.stderr}$ mount (the ${mountPoint} line)\n${line}\n` }
}

rowTest(rowEntry('03#57'), async ctx => {
  const env = await scratchEnv(ctx.scratch)
  const dir = join(ctx.scratch, 'nt')
  await mkdir(dir)

  const nt = await sameSecondRun(dir, env)
  const times = `mtime b ${nt.bNs} ns, mtime a ${nt.aNs} ns: one whole second (attempt ${nt.attempt})`
  const output = `$ ${NT_SCRIPT}\n${nt.result.stdout}${nt.result.stderr}${times}\n`
  ctx.observe('ntWithinSecond', nt.result.stdout.trim() === 'newer', output)

  const host = await run(['uname', '-sr'], { cwd: dir, env, timeoutMs: STEP_MS })
  ctx.observe('host', host.stdout.trim(), `$ uname -sr\n${host.stdout}${host.stderr}`)

  const filesystem = await filesystemOf(dir, env)
  ctx.observe('filesystem', filesystem.type, filesystem.evidence)
})
