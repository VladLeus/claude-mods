import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChildEnv } from '../lib/env.ts'
import { HarnessError } from '../lib/errors.ts'
import { run } from '../lib/proc.ts'

export const CADRE_DIR = '.cadre'
export const CADRE_COMMIT_MESSAGE = 'e2e: commit .cadre/'

const GIT_MS = 60_000
const HASH_CHARS = 12
const ADD_ARGV: readonly string[] = ['git', 'add', '-A', '--', CADRE_DIR]
// --only keeps other staged changes out of the commit and staged.
const COMMIT_ARGV: readonly string[] = [
  'git', 'commit', '--no-verify', '-q', '-m', CADRE_COMMIT_MESSAGE, '--only', '--', CADRE_DIR,
]
const NAMES_ARGV: readonly string[] = ['git', 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--root', 'HEAD']
const HEAD_ARGV: readonly string[] = ['git', 'rev-parse', 'HEAD']

export const CADRE_GIT_ARGVS: readonly (readonly string[])[] = [ADD_ARGV, COMMIT_ARGV, NAMES_ARGV, HEAD_ARGV]

// Set through the env so the argv stays free of -c; --no-verify alone still runs the other hooks.
const NO_HOOKS_ENV: ChildEnv = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.hooksPath',
  GIT_CONFIG_VALUE_0: '/dev/null',
}

async function git(repo: string, env: ChildEnv, argv: readonly string[]): Promise<string> {
  const result = await run(argv, { cwd: repo, env: { ...env, ...NO_HOOKS_ENV }, timeoutMs: GIT_MS })
  if (result.code === 0) return result.stdout
  const output = `${result.stdout}\n${result.stderr}`.trim()

  throw new HarnessError(`git ${argv[1] ?? ''} exited ${result.code}: ${output}`)
}

export async function commitCadre(repo: string, env: ChildEnv): Promise<string> {
  const stats = await lstat(join(repo, CADRE_DIR)).catch(() => null)
  if (stats === null) throw new HarnessError('the copy has no .cadre/ folder')
  if (stats.isSymbolicLink()) throw new HarnessError("the copy's .cadre is a symlink: refused")
  if (!stats.isDirectory()) throw new HarnessError('the copy has no .cadre/ folder')
  await git(repo, env, ADD_ARGV)
  await git(repo, env, COMMIT_ARGV)
  const names = (await git(repo, env, NAMES_ARGV)).split('\0').filter(name => name !== '')
  const outside = names.filter(name => !name.startsWith(`${CADRE_DIR}/`))
  if (outside.length > 0) throw new HarnessError(`the commit holds paths outside .cadre/: ${outside.join(', ')}`)
  const head = (await git(repo, env, HEAD_ARGV)).trim()

  return `committed ${names.length} paths under ${CADRE_DIR}/: ${head.slice(0, HASH_CHARS)}`
}
