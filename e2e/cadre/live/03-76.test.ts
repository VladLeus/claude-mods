import assert from 'node:assert/strict'
import { utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { passTrust } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import { capture, killServer, newWindow, socketName, startServer, WAIT_MS } from '../../lib/tmux.ts'
import {
  cadrePrint,
  firstLineOf,
  liveRepo,
  noteReply,
  printedCommand,
  replyOf,
  statusLine,
  statusUntil,
  waitForRoleTranscript,
  writeHandoff,
} from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const LAUNCHER = '.cadre/bin/be'
const WINDOW = 'cadre-be'
const START_FOLDER = 'src'
const HANDOFF = 'handoff-seed.md'
const EXPECTED_BY_NAME = 'found by its name cadre-be'
const EXPECTED_BY_BEAT = 'found by its fleet beat'
const EXPECTED_HANDOFF = `thoughts/shared/handoffs/${ROLE}/${HANDOFF}`
const TRANSCRIPT_WAIT_MS = WAIT_MS
const STATUS_WAIT_MS = WAIT_MS
const NEWEST = new Date('2099-01-01T00:00:00Z')

type Case = {
  readonly variant: string
  readonly path: string
  readonly from: string
  readonly isChecked: boolean
}

// A dir start moves into src by itself, so its launcher runs from the git root; a here start stays where it is run.
const CASES: readonly Case[] = [
  { variant: 'gsd-dir', path: 'dir/repo', from: '', isChecked: true },
  { variant: 'gsd-here', path: 'here/repo', from: START_FOLDER, isChecked: false },
]

const entry = rowEntry('03#76')

function foundBy(reply: string): string {
  const session = statusLine(reply, 'session') ?? ''
  if (session.includes(EXPECTED_BY_NAME)) return 'name'
  if (session.includes(EXPECTED_BY_BEAT)) return 'beat'

  return 'none'
}

async function runCase(ctx: RowContext, item: Case): Promise<void> {
  const { variant } = item
  const copy = await liveRepo(ctx, variant, { path: item.path })
  const startFolder = join(copy.repo, START_FOLDER)
  // The role session can write a handoff of its own within seconds: the seeded one is dated far ahead to stay newest.
  const seeded = await writeHandoff(startFolder, ROLE, HANDOFF)
  await utimes(seeded, NEWEST, NEWEST)
  const started = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, `${variant}: start be`, started)
  if (printedCommand(replyOf(started), ROLE) === null) {
    throw new HarnessError(`03#76: the ${variant} start did not render: ${firstLineOf(replyOf(started))}`)
  }

  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  await newWindow(server, WINDOW, join(copy.repo, item.from), [join(copy.repo, LAUNCHER)])
  const pane = await passTrust(server, WINDOW)
  const folder = await waitForRoleTranscript(startFolder, ROLE, ctx.scratch, TRANSCRIPT_WAIT_MS)
  const waited = `waited at most ${TRANSCRIPT_WAIT_MS} ms for a transcript titled cadre-${ROLE}`
  ctx.observe(`${variant}RoleTranscriptTitled`, folder !== null, waited)
  const status = await statusUntil(copy, ROLE, reply => foundBy(reply) !== 'none', STATUS_WAIT_MS)
  ctx.screen(`${variant}: the role window when status was read`, await capture(pane))
  await killServer(server)
  noteReply(ctx, `${variant}: status be`, status)

  const reply = replyOf(status)
  const how = foundBy(reply)
  const latest = statusLine(reply, 'latest handoff')
  ctx.observe(`${variant}FoundBy`, how, `the session line of the reply: ${statusLine(reply, 'session') ?? 'none'}`)
  ctx.observe(`${variant}LatestHandoff`, latest ?? 'none', 'the latest handoff line of the reply')
  if (!item.isChecked) return

  await ctx.check(`${variant}: status finds the session by its name or its fleet beat`, () => {
    assert.notEqual(how, 'none', `the session line is "${statusLine(reply, 'session') ?? 'missing'}"`)
  })
  await ctx.check(`${variant}: status shows the latest handoff`, () => {
    const shown = latest === null ? 'missing' : `"${latest}"`
    assert.equal(latest, EXPECTED_HANDOFF, `the "latest handoff" line is ${shown}`)
  })
}

rowTest(entry, async ctx => {
  for (const part of entry.partial ?? []) ctx.skipPart(part.part, part.reason)
  for (const item of CASES) await runCase(ctx, item)
})
