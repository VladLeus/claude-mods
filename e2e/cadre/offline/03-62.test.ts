import { join } from 'node:path'
import { scratchEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { run } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import { buildBare } from '../fixtures/repo.ts'
import { rowEntry } from '../rows.ts'

const GIT_MS = 30_000
const CALLS = [
  { name: 'showToplevel', argv: ['git', 'rev-parse', '--show-toplevel'] },
  { name: 'gitCommonDir', argv: ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'] },
] as const

rowTest(rowEntry('03#62'), async ctx => {
  const env = await scratchEnv(ctx.scratch)
  const repo = join(ctx.scratch, 'repo')
  await buildBare(repo, env)
  const worktree = join(ctx.scratch, 'worktree')
  const added = await run(['git', 'worktree', 'add', '-b', 'linked', worktree], { cwd: repo, env, timeoutMs: GIT_MS })
  if (added.code !== 0) throw new HarnessError(`git worktree add exited ${added.code}: ${added.stderr.trim()}`)

  for (const call of CALLS) {
    const result = await run(call.argv, { cwd: worktree, env, timeoutMs: GIT_MS })
    const command = `$ ${call.argv.join(' ')} (run in the linked worktree)`
    ctx.observe(call.name, result.stdout.trim(), `${command}\nexit ${result.code}\n${result.stdout}${result.stderr}`)
  }
})
