import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { ChildEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { run } from '../../lib/proc.ts'

const GIT_MS = 30_000

type RepoFiles = Readonly<Record<string, string>>

const BARE_FILES: RepoFiles = {
  'README.md': '# e2e fixture\n',
  'package.json': '{\n  "name": "e2e-fixture",\n  "private": true\n}\n',
  'src/app.ts': `export const greeting = 'hello'\n`,
}

const GSD_PRE_FILES: RepoFiles = {
  ...BARE_FILES,
  '.planning/PROJECT.md': '# Project\n',
  '.planning/config.json': '{}\n',
}

const SP_PRE_FILES: RepoFiles = {
  ...BARE_FILES,
  'docs/superpowers/README.md': '# Superpowers\n',
}

async function git(repo: string, env: ChildEnv, args: readonly string[]): Promise<void> {
  const result = await run(['git', ...args], { cwd: repo, env, timeoutMs: GIT_MS })
  if (result.code === 0) return

  throw new HarnessError(`git ${args.join(' ')} exited ${result.code}: ${result.stderr.trim()}`)
}

async function buildRepo(repo: string, env: ChildEnv, files: RepoFiles): Promise<void> {
  if (existsSync(repo)) throw new HarnessError(`the repo folder ${basename(repo)} already exists`)
  for (const [path, text] of Object.entries(files)) {
    const file = join(repo, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, text)
  }
  await git(repo, env, ['init', '-q', '-b', 'main'])
  await git(repo, env, ['add', '-A'])
  await git(repo, env, ['commit', '-q', '-m', 'e2e fixture'])
}

export async function buildBare(repo: string, env: ChildEnv): Promise<void> {
  await buildRepo(repo, env, BARE_FILES)
}

export async function buildGsdPre(repo: string, env: ChildEnv): Promise<void> {
  await buildRepo(repo, env, GSD_PRE_FILES)
}

export async function buildSpPre(repo: string, env: ChildEnv): Promise<void> {
  await buildRepo(repo, env, SP_PRE_FILES)
}
