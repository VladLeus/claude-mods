import assert from 'node:assert/strict'
import { symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { passTrust } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { rowTest } from '../../lib/row.ts'
import { capture, killServer, newWindow, socketName, startServer, WAIT_MS } from '../../lib/tmux.ts'
import {
  cadrePrint,
  firstLineOf,
  holdRoleName,
  liveRepo,
  noteReply,
  printedCommand,
  replyOf,
  statusLine,
  statusUntil,
  waitForRoleTranscript,
} from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const LAUNCHER = '.cadre/bin/be'
const WINDOW = 'cadre-be'
const STATE_LABEL = 'state'
const EXPECTED_NOT_STARTED = 'not started'
const TRANSCRIPT_WAIT_MS = WAIT_MS
const STATUS_WAIT_MS = WAIT_MS

// A found session has a state of its own; `not started` is what a status that missed the session says.
function readsStarted(reply: string): boolean {
  const state = statusLine(reply, STATE_LABEL)

  return state !== null && state !== EXPECTED_NOT_STARTED
}

function shownState(reply: string): string {
  const state = statusLine(reply, STATE_LABEL)

  return state === null ? 'no state line' : `"${STATE_LABEL}: ${state}"`
}

rowTest(rowEntry('03#77'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  const link = join(ctx.scratch, 'link')
  await symlink(copy.repo, link)
  const started = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be', started)
  if (printedCommand(replyOf(started), ROLE) === null) {
    throw new HarnessError(`03#77: the start did not render: ${firstLineOf(replyOf(started))}`)
  }

  await holdRoleName(ctx, ROLE)
  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  await newWindow(server, WINDOW, link, [join(link, LAUNCHER)])
  const pane = await passTrust(server, WINDOW)
  const folder = await waitForRoleTranscript(copy.repo, ROLE, ctx.scratch, TRANSCRIPT_WAIT_MS)
  const waited = `waited at most ${TRANSCRIPT_WAIT_MS} ms for a transcript titled cadre-${ROLE}`
  ctx.observe('roleTranscriptTitled', folder !== null, waited)

  const viaLink: LiveRepo = { repo: link, env: copy.env }
  const status = await statusUntil(viaLink, ROLE, readsStarted, STATUS_WAIT_MS)
  ctx.screen('the role window when status was read', await capture(pane))
  await killServer(server)
  noteReply(ctx, 'status be with the link as the folder', status)

  const reply = replyOf(status)
  await ctx.check('the status reply through the link is not not started', () => {
    assert.ok(readsStarted(reply), `the reply holds ${shownState(reply)}`)
  })
})
