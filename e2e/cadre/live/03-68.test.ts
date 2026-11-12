import assert from 'node:assert/strict'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { rowTest } from '../../lib/row.ts'
import { shellQuote } from '../../lib/shims.ts'
import { cadrePrint, liveRepo, noteReply, replyOf, systemTool } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const EXPECTED_REPLY =
  'cadre start could not read the git common dir (git rev-parse failed or gave no absolute path; ' +
  'git 2.31 or newer is needed), so it stopped.'
const OLD_GIT_FLAG = '--path-format=absolute'
const OLD_GIT_COMMON_DIR = '.git'

// A git older than 2.31 does not know the flag: rev-parse prints it back, then the common dir as a relative path.
function oldGitScript(realGit: string): string {
  return [
    '#!/bin/sh',
    'for arg in "$@"; do',
    `  if [ "$arg" = ${OLD_GIT_FLAG} ]; then`,
    `    printf '%s\\n' ${OLD_GIT_FLAG} ${OLD_GIT_COMMON_DIR}`,
    '    exit 0',
    '  fi',
    'done',
    `exec ${shellQuote(realGit)} "$@"`,
    '',
  ].join('\n')
}

rowTest(rowEntry('03#68', 'b'), async ctx => {
  const shimDir = join(ctx.scratch, 'shims')
  await mkdir(shimDir, { recursive: true })
  const shim = join(shimDir, 'git')
  await writeFile(shim, oldGitScript(await systemTool('git')))
  await chmod(shim, 0o755)

  const copy = await liveRepo(ctx, 'gsd', { shimDir })
  const reply = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be with a git that does not know --path-format=absolute', reply)

  await ctx.check('the reply is the git 2.31 refusal of the UAT', () => {
    assert.equal(replyOf(reply), EXPECTED_REPLY)
  })
})
