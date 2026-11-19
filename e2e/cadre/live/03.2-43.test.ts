import assert from 'node:assert/strict'
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { configDir, passTrust } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord, isStringList } from '../../lib/filter.ts'
import { pollUntil } from '../../lib/poll.ts'
import { rowTest } from '../../lib/row.ts'
import { shellQuote } from '../../lib/shims.ts'
import { capture, killServer, newWindow, POLL_MS, socketName, startServer, WAIT_MS } from '../../lib/tmux.ts'
import { cadrePrint, firstLineOf, liveRepo, noteReply, printedCommand, replyOf } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const LAUNCHER = '.cadre/bin/be'
const WINDOW = 'cadre-be'
const RUNTIME_SETTINGS = '.cadre/be/.runtime/settings.json'
const PRIVATE_COPY = '.cadre/be/.runtime/private-instructions/CLAUDE.md'
const PRIVATE_FILE = 'CLAUDE.md'
const PRIVATE_TEXT = '# Private instructions of be\n\nThe private marker of this role is cadre-e2e-private-03-2-43.\n'
const EVENT = 'InstructionsLoaded'
const EVENT_TEMPLATE = 'event.XXXXXX'
const EXPECTED_LOAD_REASON = 'session_start'
const LOAD_WAIT_MS = 2 * WAIT_MS
// The rule cadre renders for the role's private instructions folder: `Edit(//<absolute folder>/**)`.
const PRIVATE_DENY_RE = /^Edit\(\/(\/[^()*]*\/be\/instructions)\/\*\*\)$/

type Loaded = {
  readonly path: string
  readonly reason: string
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// A project hook that writes the JSON of each InstructionsLoaded event to a new file of its own in `dir`.
async function writeInstructionsLoadedHook(repo: string, dir: string): Promise<void> {
  const target = `"$(/usr/bin/mktemp ${shellQuote(join(dir, EVENT_TEMPLATE))})"`
  const command = `/bin/sh -c ${shellQuote(`cat > ${target}`)}`
  const settings = { hooks: { [EVENT]: [{ hooks: [{ type: 'command', command }] }] } }
  await mkdir(dir, { recursive: true })
  await mkdir(join(repo, '.claude'), { recursive: true })
  await writeFile(join(repo, '.claude', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`)
}

// The InstructionsLoaded events written so far, in file name order, which is not the order they came in; a file
// still being written is read at the next call.
async function loadedEvents(dir: string): Promise<readonly Loaded[]> {
  const names = (await readdir(dir).catch((): string[] => [])).sort()
  const loaded: Loaded[] = []
  for (const name of names) {
    const event = parsed(await readFile(join(dir, name), 'utf8').catch(() => ''))
    if (!isRecord(event) || event.hook_event_name !== EVENT) continue
    const path = event.file_path
    if (typeof path !== 'string') continue
    const reason = event.load_reason
    loaded.push({ path, reason: typeof reason === 'string' ? reason : 'none' })
  }

  return loaded
}

function copyReasons(loaded: readonly Loaded[], paths: readonly string[]): readonly string[] {
  return loaded.filter(item => paths.includes(item.path)).map(item => item.reason)
}

// The events once one names the copy with the session start reason; the events as they stand when none came in time.
async function loadedUntil(dir: string, paths: readonly string[]): Promise<readonly Loaded[]> {
  const label = 'the session start InstructionsLoaded event of the private CLAUDE.md copy'
  const opts = { timeoutMs: LOAD_WAIT_MS, intervalMs: POLL_MS, now: Date.now, sleep: delay, label }
  const isLoaded = (loaded: readonly Loaded[]): boolean => copyReasons(loaded, paths).includes(EXPECTED_LOAD_REASON)
  try {
    return await pollUntil(() => loadedEvents(dir), isLoaded, opts)
  } catch (error) {
    if (error instanceof HarnessError) return loadedEvents(dir)
    throw error
  }
}

async function isUnderConfigDir(folder: string): Promise<boolean> {
  const config = configDir()
  const roots = new Set([config, await realpath(config).catch(() => config)])

  return [...roots].some(root => folder.startsWith(`${join(root, 'cadre')}/`))
}

// What the path is when it is not a real folder; null when it is one.
async function notFolderKind(path: string): Promise<string | null> {
  const stats = await lstat(path).catch(() => null)
  if (stats === null) return 'missing'
  if (stats.isSymbolicLink()) return 'a link'
  if (!stats.isDirectory()) return 'not a directory'

  return null
}

// The role's private instructions folder, read from the Edit deny cadre renders for it into the role's settings.
async function privateSourceOf(repo: string): Promise<string> {
  const value = parsed(await readFile(join(repo, RUNTIME_SETTINGS), 'utf8').catch(() => ''))
  const permissions = isRecord(value) ? value.permissions : undefined
  const deny = isRecord(permissions) ? permissions.deny : undefined
  if (!isStringList(deny)) throw new HarnessError(`03.2#43: no permissions.deny list in ${RUNTIME_SETTINGS}`)
  const folders = deny
    .map(rule => PRIVATE_DENY_RE.exec(rule)?.[1])
    .filter((folder): folder is string => folder !== undefined)
  const [folder] = folders
  if (folder === undefined || folders.length > 1) {
    throw new HarnessError(`03.2#43: ${folders.length} Edit denies of a be/instructions folder in ${RUNTIME_SETTINGS}`)
  }
  if (!(await isUnderConfigDir(folder))) {
    throw new HarnessError('03.2#43: the private instructions folder of the deny is not under the e2e dir')
  }
  const kind = await notFolderKind(folder)
  if (kind !== null) throw new HarnessError(`03.2#43: the private instructions folder of ${ROLE} is ${kind}`)

  return folder
}

rowTest(rowEntry('03.2#43'), async ctx => {
  const events = join(ctx.scratch, 'instructions-loaded')
  const copy = await liveRepo(ctx, 'gsd')
  await writeInstructionsLoadedHook(copy.repo, events)
  const first = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be, the first render', first)
  if (printedCommand(replyOf(first), ROLE) === null) {
    throw new HarnessError(`03.2#43: the first start did not render: ${firstLineOf(replyOf(first))}`)
  }

  const sourceFile = join(await privateSourceOf(copy.repo), PRIVATE_FILE)
  ctx.after(() => rm(sourceFile, { force: true }))
  await writeFile(sourceFile, PRIVATE_TEXT)
  const second = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be after the private CLAUDE.md was written', second)
  const copied = join(copy.repo, PRIVATE_COPY)
  const copyCheck = `the start copies the private CLAUDE.md to ${PRIVATE_COPY} as a regular file with its text`
  await ctx.check(copyCheck, async () => {
    const stats = await lstat(copied).catch(() => null)
    assert.ok(stats !== null, `${PRIVATE_COPY} is not there`)
    assert.ok(stats.isFile(), `${PRIVATE_COPY} is not a regular file`)
    assert.equal(await readFile(copied, 'utf8'), PRIVATE_TEXT, `${PRIVATE_COPY} holds another text`)
  })

  // The print-mode starts load the project hook too, so their events are cleared before the role session starts.
  await rm(events, { recursive: true, force: true })
  await mkdir(events, { recursive: true })
  const paths = [...new Set([copied, join(await realpath(copy.repo), PRIVATE_COPY)])]
  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  const pane = await newWindow(server, WINDOW, copy.repo, [join(copy.repo, LAUNCHER)])
  await passTrust(server, WINDOW)
  const loaded = await loadedUntil(events, paths)
  ctx.screen('the role window once the events were read', await capture(pane))
  await killServer(server)

  const shown = loaded.map(item => `${item.reason} ${item.path}`).join('\n')
  ctx.evidence('the InstructionsLoaded events of the role session', shown || 'none')
  await ctx.check(`the role session started by ${LAUNCHER} loads the copy at session start`, () => {
    const reasons = copyReasons(loaded, paths)
    assert.ok(reasons.length > 0, `no InstructionsLoaded event names ${PRIVATE_COPY}`)
    const seen = reasons.join(', ')
    assert.ok(reasons.includes(EXPECTED_LOAD_REASON), `the copy was loaded only with the reasons ${seen}`)
  })
})
