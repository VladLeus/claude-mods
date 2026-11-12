import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { configDir, passTrust } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { rowTest } from '../../lib/row.ts'
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
} from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const LAUNCHER = '.cadre/bin/be'
const WINDOW = 'cadre-be'
const EXPECTED_BY_NAME = 'found by its name cadre-be'
const EXPECTED_BY_BEAT = 'found by its fleet beat'
const COMPONENTS = 5
const COMPONENT_CHARS = 50
const ENGINE_NAME_LIMIT = 200
const NON_ALPHANUMERIC_RE = /[^A-Za-z0-9]/g
const TRANSCRIPT_WAIT_MS = 2 * WAIT_MS
const STATUS_WAIT_MS = WAIT_MS

function component(index: number): string {
  return `deep${index + 1}`.padEnd(COMPONENT_CHARS, 'x')
}

function foundBy(reply: string): string {
  const session = statusLine(reply, 'session') ?? ''
  if (session.includes(EXPECTED_BY_NAME)) return 'name'
  if (session.includes(EXPECTED_BY_BEAT)) return 'beat'

  return 'none'
}

rowTest(rowEntry('03#78'), async ctx => {
  const path = Array.from({ length: COMPONENTS }, (_, index) => component(index)).join('/')
  const copy = await liveRepo(ctx, 'gsd', { path })
  const encoded = copy.repo.replace(NON_ALPHANUMERIC_RE, '-')
  if (encoded.length <= ENGINE_NAME_LIMIT) {
    throw new HarnessError(`03#78: the folder name has ${encoded.length} characters, not over ${ENGINE_NAME_LIMIT}`)
  }
  ctx.observe('transcriptFolderNameLength', encoded.length, `${COMPONENTS} folders of ${COMPONENT_CHARS} characters`)
  const started = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be', started)
  if (printedCommand(replyOf(started), ROLE) === null) {
    throw new HarnessError(`03#78: the start did not render: ${firstLineOf(replyOf(started))}`)
  }

  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  await newWindow(server, WINDOW, copy.repo, [join(copy.repo, LAUNCHER)])
  const pane = await passTrust(server, WINDOW)
  const folder = await waitForRoleTranscript(copy.repo, ROLE, ctx.scratch, TRANSCRIPT_WAIT_MS)
  const status = await statusUntil(copy, ROLE, reply => foundBy(reply) !== 'none', STATUS_WAIT_MS)
  ctx.screen('the role window when status was read', await capture(pane))
  await killServer(server)
  noteReply(ctx, 'status be', status)

  const reply = replyOf(status)
  const how = foundBy(reply)
  const fullName = await stat(join(configDir(), 'projects', encoded)).then(() => true, () => false)
  ctx.observe('engineKeptTheFullFolderName', fullName, 'a folder named by the whole encoded repo path exists')
  ctx.observe('roleTranscriptSeen', folder !== null, 'a transcript titled cadre-be, found by the folder name prefix')
  const state = statusLine(reply, 'state') ?? 'none'
  ctx.observe('statusFindsTheSession', how !== 'none', `found by: ${how}; state: ${state}`)
  ctx.observe('foundBy', how, `the session line of the reply: ${statusLine(reply, 'session') ?? 'none'}`)
})
