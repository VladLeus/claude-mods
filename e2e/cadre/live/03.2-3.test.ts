import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { run } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import { capture, killServer, socketName, startServer } from '../../lib/tmux.ts'
import { FRAMEWORK_SET_QUESTION, FRAMEWORKS_KEEP_GSD_DRY_SCRIPT, SP_GSD_INSTALL_SCRIPT } from '../fixtures/answers.ts'
import {
  APPLIED_REPLY,
  assertHaikuRoles,
  cadreTui,
  driveDialogs,
  liveRepo,
  noteReply,
  systemTool,
} from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const EXPECTED_PATHS: readonly string[] = [
  '.claude/gsd-core',
  '.claude/commands',
  '.claude/agents',
  '.claude/hooks',
  '.claude/scripts',
  '.claude/settings.local.json',
  '.claude/gsd-file-manifest.json',
  '.claude/gsd-install-state.json',
]
const EXPECTED_FOUND = 'GSD'
const INIT_COMMAND = '/cadre init'
const DRY_RUN_COMMAND = '/cadre frameworks --dry-run'
const DRY_RUN_NOTE_RE = /Dry run: nothing was written\./
const FOUND_RE = /Found: (.*?)\. Adding one installs it/
const FOUND_SPLIT_RE = /,| and /
const VERSION_FILE = '.claude/gsd-core/VERSION'
const GSD_TOOLS = '.claude/gsd-core/bin/gsd-tools.cjs'
const WORKSTREAM = 'cadre-be'
const WORKSTREAM_MS = 60_000
const WHITESPACE_RE = /\s+/g

function squashed(text: string): string {
  return text.replace(WHITESPACE_RE, ' ')
}

rowTest(rowEntry('03.2#3'), async ctx => {
  await systemTool('npx')
  const copy = await liveRepo(ctx, 'sp-pre')
  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))

  const pane = await cadreTui(server, copy, INIT_COMMAND)
  await driveDialogs(pane, SP_GSD_INSTALL_SCRIPT, APPLIED_REPLY)
  const history = await capture(pane, { history: true })
  ctx.evidence('the reply of /cadre init', history.slice(Math.max(0, history.lastIndexOf(`❯ ${INIT_COMMAND}`))))
  await assertHaikuRoles(copy)

  for (const path of EXPECTED_PATHS) {
    await ctx.check(`the install wrote ${path}`, () => {
      assert.ok(existsSync(join(copy.repo, path)), `${path} is not in the repo`)
    })
  }

  const dry = await cadreTui(server, copy, DRY_RUN_COMMAND)
  const asked = await driveDialogs(dry, FRAMEWORKS_KEEP_GSD_DRY_SCRIPT, DRY_RUN_NOTE_RE, {
    stopAt: FRAMEWORK_SET_QUESTION,
  })
  ctx.screen(`the framework question of ${DRY_RUN_COMMAND}`, asked.final)
  const found = FOUND_RE.exec(squashed(asked.final))?.[1] ?? null
  ctx.evidence('the frameworks the dry run found', found ?? 'no Found: list on the question')
  const names = found === null ? [] : found.split(FOUND_SPLIT_RE).map(name => name.trim())
  await ctx.check(`the dry run detects ${EXPECTED_FOUND} installed: its framework question lists it as found`, () => {
    assert.ok(names.includes(EXPECTED_FOUND), `found: ${found}`)
  })

  const version = await readFile(join(copy.repo, VERSION_FILE), 'utf8').catch(() => null)
  ctx.observe('gsdCoreVersion', version?.trim() ?? null, `${VERSION_FILE} after the install`)
  const create = await run([process.execPath, GSD_TOOLS, 'workstream.create', WORKSTREAM, '--no-migrate'], {
    cwd: copy.repo,
    env: copy.env,
    timeoutMs: WORKSTREAM_MS,
  })
  noteReply(ctx, `workstream.create ${WORKSTREAM} --no-migrate`, create)
  ctx.observe('workstreamCreateExitCode', create.code, `node ${GSD_TOOLS} workstream.create ${WORKSTREAM} --no-migrate`)
})
