import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { passTrust } from '../../lib/claude.ts'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import { capture, killServer, newWindow, socketName, startServer, WAIT_MS } from '../../lib/tmux.ts'
import {
  commitInWorktree,
  epicBranchesOf,
  epicBranchOf,
  epicDone,
  epicWorktree,
  gitOk,
  kindOf,
  printEpic,
  worktreesOf,
} from '../lib/epic.ts'
import { liveRepo, noteReply, replyOf, statusLine, statusUntil, waitForRoleTranscript } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const LAUNCHER = '.cadre/bin/be'
const WINDOW = 'cadre-be'
const TRANSCRIPT_WAIT_MS = WAIT_MS
const STATUS_WAIT_MS = WAIT_MS
const KEYS = { modified: 'PROJ-1', unmerged: 'PROJ-2', running: 'PROJ-3', untracked: 'PROJ-4' } as const
const EXPECTED_CHANGES = /changes/
const EXPECTED_NOT_MERGED = /not merged/
const EXPECTED_RUNNING = /still runs?/

type Refusal = {
  readonly name: string
  readonly key: string
  readonly reason: RegExp
  // A file the refusal must leave where it is.
  readonly kept: string | null
}

// epic done once, and what it left of the worktree and its branch.
async function refuses(ctx: RowContext, copy: LiveRepo, spec: Refusal): Promise<void> {
  const worktree = epicWorktree(copy, spec.key)
  const count = (await worktreesOf(copy)).length
  const done = await epicDone(copy, spec.key, true)
  noteReply(ctx, `${spec.name}: epic done`, done)
  await ctx.check(`${spec.name}: epic done refuses and names the reason`, () => {
    assert.match(replyOf(done), spec.reason, 'the reply does not give the reason')
  })
  await ctx.check(`${spec.name}: epic done removes nothing`, async () => {
    assert.ok(existsSync(worktree), 'the worktree folder is gone')
    assert.equal((await worktreesOf(copy)).length, count, 'git lists another number of worktrees')
    assert.ok((await epicBranchesOf(copy)).includes(epicBranchOf(spec.key)), 'the epic branch is gone')
    if (spec.kept === null) return
    assert.equal(await kindOf(spec.kept), 'file', 'the file the case made is gone')
  })
}

async function modifiedCase(ctx: RowContext, copy: LiveRepo): Promise<void> {
  const epic = await printEpic(copy, KEYS.modified)
  noteReply(ctx, 'modified: epic', epic.result)
  const file = join(epic.worktree, 'README.md')
  await appendFile(file, 'edited in the worktree\n')
  const spec = { name: 'a modified tracked file', key: KEYS.modified, reason: EXPECTED_CHANGES, kept: file }
  await refuses(ctx, copy, spec)
}

async function unmergedCase(ctx: RowContext, copy: LiveRepo): Promise<void> {
  const epic = await printEpic(copy, KEYS.unmerged)
  noteReply(ctx, 'unmerged: epic', epic.result)
  await commitInWorktree(copy, epic.worktree, 'feature.txt', 'a commit of its own\n')
  await refuses(ctx, copy, { name: 'an unmerged branch', key: KEYS.unmerged, reason: EXPECTED_NOT_MERGED, kept: null })
}

async function untrackedCase(ctx: RowContext, copy: LiveRepo): Promise<void> {
  const epic = await printEpic(copy, KEYS.untracked)
  noteReply(ctx, 'untracked: epic', epic.result)
  const file = join(epic.worktree, 'untracked.txt')
  await writeFile(file, 'not added to git\n')
  const spec = { name: 'an untracked file', key: KEYS.untracked, reason: EXPECTED_CHANGES, kept: file }
  await refuses(ctx, copy, spec)
  await gitOk(copy, ['config', 'status.showUntrackedFiles', 'no'])
  await refuses(ctx, copy, { ...spec, name: 'an untracked file with status.showUntrackedFiles no' })
}

// A role reads running while its session is named cadre-<id> and its autopilot run is on, so the role is started by
// its launcher in the worktree and asked about through status before epic done is.
async function runningCase(ctx: RowContext, copy: LiveRepo): Promise<void> {
  const epic = await printEpic(copy, KEYS.running)
  noteReply(ctx, 'running: epic', epic.result)
  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  await newWindow(server, WINDOW, epic.worktree, [join(epic.worktree, LAUNCHER)])
  const pane = await passTrust(server, WINDOW)
  const folder = await waitForRoleTranscript(epic.worktree, ROLE, ctx.scratch, TRANSCRIPT_WAIT_MS)
  ctx.observe('roleTranscriptTitled', folder !== null, `waited at most ${TRANSCRIPT_WAIT_MS} ms for cadre-${ROLE}`)
  const isRunning = (reply: string): boolean => statusLine(reply, 'state') === 'running'
  const status = await statusUntil({ repo: epic.worktree, env: copy.env }, ROLE, isRunning, STATUS_WAIT_MS)
  ctx.observe('statusStateBeforeEpicDone', statusLine(replyOf(status), 'state'), 'the state line of status there')
  ctx.screen('the role window when epic done was asked', await capture(pane))
  await refuses(ctx, copy, { name: 'a running role', key: KEYS.running, reason: EXPECTED_RUNNING, kept: null })
  await killServer(server)
}

const entry = rowEntry('03.1#15')

rowTest(entry, async ctx => {
  for (const part of entry.partial ?? []) ctx.skipPart(part.part, part.reason)
  const copy = await liveRepo(ctx, 'gsd')
  await modifiedCase(ctx, copy)
  await unmergedCase(ctx, copy)
  await untrackedCase(ctx, copy)
  await runningCase(ctx, copy)
})
