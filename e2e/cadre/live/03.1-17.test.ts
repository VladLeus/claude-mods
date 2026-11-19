import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import { killServer, socketName, startServer } from '../../lib/tmux.ts'
import type { Pane, Server } from '../../lib/tmux.ts'
import {
  answerEpicDone,
  askEpicDone,
  epicBranchesOf,
  epicBranchOf,
  epicDone,
  printEpic,
  waitGone,
  worktreesOf,
} from '../lib/epic.ts'
import { firstLineOf, liveRepo, noteReply, replyOf } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const KEYS = { keep: 'PROJ-1', remove: 'PROJ-2', print: 'PROJ-3' } as const
const EXPECTED_KEEP = 'No, keep it'
const ANSWER_REMOVE = 'Yes'
const EXPECTED_NOTHING_REMOVED = /removed nothing/
const KEEP_ON_CURSOR_RE = /^\s*❯\s+(?:1\.\s+)?No, keep it\b/m
const YES_ROW_RE = /^\s+(?:[0-9]+\.\s+)?Yes\b/m
const EDIT_FILE = 'README.md'
const EDIT_TEXT = 'edited in the worktree\n'

type DirtyEpic = {
  readonly worktree: string
  readonly file: string
}

// The epic in print mode, with one tracked file of its worktree edited, so the worktree holds changes.
async function dirtyEpic(ctx: RowContext, copy: LiveRepo, key: string): Promise<DirtyEpic> {
  const epic = await printEpic(copy, key)
  noteReply(ctx, `${key}: epic`, epic.result)
  const file = join(epic.worktree, EDIT_FILE)
  await appendFile(file, EDIT_TEXT)

  return { worktree: epic.worktree, file }
}

async function assertKept(copy: LiveRepo, epic: DirtyEpic, key: string, count: number): Promise<void> {
  assert.ok(existsSync(epic.worktree), 'the worktree folder is gone')
  assert.equal((await worktreesOf(copy)).length, count, 'git lists another number of worktrees')
  assert.ok((await epicBranchesOf(copy)).includes(epicBranchOf(key)), 'the epic branch is gone')
  const text = await readFile(epic.file, 'utf8').catch(() => '')
  assert.ok(text.endsWith(EDIT_TEXT), 'the edit in the worktree is gone')
}

// The question lists No, keep it first: its option holds the cursor the dialog starts on and Yes is listed below it.
function assertKeepFirst(asked: { readonly dialog: string | null; readonly reply: string }): void {
  const { dialog } = asked
  assert.ok(dialog !== null, `epic done --force asked no question: ${firstLineOf(asked.reply)}`)
  const at = dialog.search(KEEP_ON_CURSOR_RE)
  assert.ok(at !== -1, `the cursor is not on ${EXPECTED_KEEP}`)
  assert.match(dialog.slice(at), YES_ROW_RE, 'no Yes option is listed below No, keep it')
}

// The consent question answered No, keep it: the worktree and its changes stay.
async function keepCase(ctx: RowContext, copy: LiveRepo, server: Server): Promise<Pane> {
  const key = KEYS.keep
  const epic = await dirtyEpic(ctx, copy, key)
  const count = (await worktreesOf(copy)).length
  const asked = await askEpicDone(server, copy, key)
  ctx.screen('keep: the consent question', asked.dialog ?? asked.reply)
  await ctx.check('keep: the question lists No, keep it first', () => assertKeepFirst(asked))
  if (asked.dialog === null) return asked.pane

  ctx.screen('keep: the reply after No, keep it', await answerEpicDone(asked, EXPECTED_KEEP))
  await ctx.check('keep: No keeps the worktree', () => assertKept(copy, epic, key, count))

  return asked.pane
}

// The same question answered Yes: the worktree goes, though it holds changes, so it went with --force.
async function removeCase(ctx: RowContext, copy: LiveRepo, server: Server, pane: Pane): Promise<void> {
  const key = KEYS.remove
  const epic = await dirtyEpic(ctx, copy, key)
  const count = (await worktreesOf(copy)).length
  const asked = await askEpicDone(server, copy, key, pane)
  ctx.screen('remove: the consent question', asked.dialog ?? asked.reply)
  await ctx.check('remove: epic done --force asks the question', () => {
    assert.ok(asked.dialog !== null, `epic done --force asked no question: ${firstLineOf(asked.reply)}`)
  })
  if (asked.dialog === null) return

  ctx.screen('remove: the reply after Yes', await answerEpicDone(asked, ANSWER_REMOVE))
  const isGone = await waitGone(epic.worktree)
  await ctx.check('remove: Yes removes the worktree', async () => {
    assert.ok(isGone, 'the worktree folder is still there')
    assert.equal((await worktreesOf(copy)).length, count - 1, 'git still lists the worktree')
  })
}

// In claude -p the question cannot be asked, so epic done --force refuses.
async function printCase(ctx: RowContext, copy: LiveRepo): Promise<void> {
  const key = KEYS.print
  const epic = await dirtyEpic(ctx, copy, key)
  const count = (await worktreesOf(copy)).length
  const done = await epicDone(copy, key, true, true)
  noteReply(ctx, 'print: epic done --force', done)
  await ctx.check('print: claude -p refuses and says it removed nothing', () => {
    assert.match(replyOf(done), EXPECTED_NOTHING_REMOVED, `the reply is: ${firstLineOf(replyOf(done))}`)
  })
  await ctx.check('print: claude -p removes nothing', () => assertKept(copy, epic, key, count))
}

rowTest(rowEntry('03.1#17'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))

  const pane = await keepCase(ctx, copy, server)
  await removeCase(ctx, copy, server, pane)
  await printCase(ctx, copy)
})
