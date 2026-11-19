import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { dismiss, isDialogScreen, startTui, waitTui } from '../../lib/claude.ts'
import { rowTest } from '../../lib/row.ts'
import { killServer, socketName, startServer, WAIT_MS } from '../../lib/tmux.ts'
import { EPIC_KEY, printEpic, typeCommand } from '../lib/epic.ts'
import { cadrePrint, firstLineOf, liveRepo, noteReply, replyOf } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const WHITESPACE_RE = /\s+/g
const WORKTREES_BELOW = '/.claude/worktrees'
const FORMS = [
  { key: 'Frameworks', args: 'frameworks' },
  { key: 'FrameworksDryRun', args: 'frameworks --dry-run' },
] as const

// A reply names the main checkout when it holds its path where that path does not just start the worktree's own path,
// which lies below it. A terminal may break a long line, so whitespace is left out of both sides.
function namesMain(text: string, mains: readonly string[]): boolean {
  const flat = text.replace(WHITESPACE_RE, '')

  return mains.some(main => {
    const parts = flat.split(main.replace(WHITESPACE_RE, ''))

    return parts.slice(1).some(rest => !rest.startsWith(WORKTREES_BELOW))
  })
}

rowTest(rowEntry('03.2#39'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  const mains = [...new Set([copy.repo, await realpath(copy.repo)])]
  const epic = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'epic', epic.result)
  const inside: LiveRepo = { repo: epic.worktree, env: copy.env }

  // claude -p has no dialog, so /cadre frameworks refuses there before it looks at the worktree: only a note.
  for (const form of FORMS) {
    const result = await cadrePrint(inside, form.args)
    noteReply(ctx, `print: ${form.args}`, result)
    const shown = firstLineOf(replyOf(result))
    ctx.observe(`print${form.key}NamesTheMainCheckout`, namesMain(replyOf(result), mains), shown)
  }

  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  const pane = await startTui(server, epic.worktree, [])
  for (const form of FORMS) {
    const seen = await typeCommand(pane, `/cadre ${form.args}`)
    ctx.screen(`${form.args}: the reply in the worktree session`, seen.dialog ?? seen.reply)
    await ctx.check(`${form.args}: refuses without asking a question`, () => {
      assert.equal(seen.dialog, null, 'the command asked a question')
    })
    await ctx.check(`${form.args}: the refusal names the main checkout`, () => {
      assert.ok(namesMain(seen.reply, mains), `the reply does not name it: ${firstLineOf(seen.reply)}`)
    })
    if (seen.dialog === null) continue

    await dismiss(pane)
    await waitTui(pane, screen => !isDialogScreen(screen), WAIT_MS, 'the question to close')
  }
})
