import assert from 'node:assert/strict'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { configDir } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { rowTest } from '../../lib/row.ts'
import { importSource } from '../../lib/source.ts'
import { cadrePrint, firstLineOf, inboxDirOf, liveRepo, noteReply, printedCommand, replyOf } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const INBOX_FILE = 'inbox.jsonl'
const ARCHIVE_RE = /^inbox-[0-9]+\.jsonl$/
const PADDING_LINE = 'x'.repeat(1000)
const OPEN_IDS: readonly string[] = ['pm-1700000000001-0000000a', 'pm-1700000000002-0000000b']
const RESEND_RE = /send again|re-?send/i
const CADRE_SENDER = 'cadre'

async function rotationThreshold(): Promise<number> {
  const send = await importSource('cadre/hooks/messages/send.ts')
  const value = isRecord(send) ? send.INBOX_ROTATE_BYTES : undefined
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value

  throw new HarnessError('cadre seam changed: INBOX_ROTATE_BYTES')
}

function openEntry(id: string): string {
  const at = Number(id.split('-')[1])
  const entry = { v: 1, type: 'entry', id, at, from: 'pm', to: ROLE, kind: 'note', subject: 'open', body: 'still open' }

  return JSON.stringify(entry)
}

// Two open entries around lines that are no entry, so the inbox is over the threshold and lists exactly two open ids.
function oversizedInbox(thresholdBytes: number): string {
  const [first, second] = OPEN_IDS
  if (first === undefined || second === undefined) throw new HarnessError('03.2#26 needs two open ids')
  const padding = Array.from({ length: Math.ceil(thresholdBytes / (PADDING_LINE.length + 1)) + 1 }, () => PADDING_LINE)

  return `${[openEntry(first), ...padding, openEntry(second)].join('\n')}\n`
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

rowTest(rowEntry('03.2#26'), async ctx => {
  const threshold = await rotationThreshold()
  const copy = await liveRepo(ctx, 'gsd')
  const first = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be, the first render', first)
  if (printedCommand(replyOf(first), ROLE) === null) {
    throw new HarnessError(`03.2#26: the first start did not render: ${firstLineOf(replyOf(first))}`)
  }

  const inboxDir = await inboxDirOf(configDir(), copy, ROLE)
  const inbox = join(inboxDir, INBOX_FILE)
  const text = oversizedInbox(threshold)
  const size = Buffer.byteLength(text)
  if (size <= threshold) throw new HarnessError(`03.2#26: the seeded inbox is ${size} bytes, not over ${threshold}`)
  await writeFile(inbox, text)
  const second = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be over the rotation threshold', second)

  const archives = (await readdir(inboxDir)).filter(name => ARCHIVE_RE.test(name))
  ctx.evidence('the inbox folder after the second start', (await readdir(inboxDir)).sort().join('\n'))
  await ctx.check('the inbox moved whole to one inbox-<at>.jsonl beside it', async () => {
    assert.equal(archives.length, 1, `${archives.length} archives lie beside the inbox`)
    const [archive] = archives
    assert.ok(archive !== undefined, 'no archive lies beside the inbox')
    assert.equal((await stat(join(inboxDir, archive))).size, size, 'the archive is not the whole old inbox')
  })

  const fresh = await readFile(inbox, 'utf8').catch(() => '')
  const [firstLine = ''] = fresh.split('\n').filter(line => line.trim() !== '')
  const entry = parseLine(firstLine)
  const body = isRecord(entry) && typeof entry.body === 'string' ? entry.body : ''
  await ctx.check('the fresh inbox starts with an entry from cadre', () => {
    assert.ok(isRecord(entry) && entry.from === CADRE_SENDER, 'the first line is no entry from cadre')
  })
  await ctx.check('the first entry lists both open ids', () => {
    for (const id of OPEN_IDS) assert.ok(body.includes(id), `the first entry does not list ${id}`)
  })
  await ctx.check('the first entry names the archive', () => {
    const [archive] = archives
    assert.ok(archive !== undefined && body.includes(archive), 'the first entry does not name the archive')
  })
  await ctx.check('the first entry asks to send again', () => {
    assert.ok(RESEND_RE.test(body), 'the first entry does not ask to re-send')
  })
})
