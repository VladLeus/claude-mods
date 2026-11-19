import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { configDir } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { rowTest } from '../../lib/row.ts'
import { EPIC_KEY, epicDone, printEpic, roleIdsOf } from '../lib/epic.ts'
import { firstLineOf, inboxDirOf, liveRepo, noteReply, replyOf } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const PM = 'pm'
const INBOX_FILE = 'inbox.jsonl'
const CADRE_SENDER = 'cadre'
const STALE_SENDER = 'old-epic'
const STALE_BODY = 'a note of the first epic that the second epic must not keep'
const NO_FOLDER_ERROR = 'no inbox folder for '

type Inboxes = {
  readonly files: ReadonlyMap<string, string>
  // One `<id>: <why>` text for each role whose inbox folder is not there.
  readonly missing: readonly string[]
}

// Each role's inbox file in the inbox home the worktree's path keys. A folder that is not there is a finding of the
// row; any other failure of inboxDirOf is the harness's.
async function inboxesOf(
  config: string,
  copy: LiveRepo,
  worktree: string,
  ids: readonly string[],
): Promise<Inboxes> {
  const files = new Map<string, string>()
  const missing: string[] = []
  for (const id of ids) {
    try {
      files.set(id, join(await inboxDirOf(config, { repo: worktree, env: copy.env }, id), INBOX_FILE))
    } catch (error) {
      if (!(error instanceof HarnessError) || !error.message.startsWith(NO_FOLDER_ERROR)) throw error
      missing.push(`${id}: ${firstLineOf(error.message)}`)
    }
  }

  return { files, missing }
}

function staleEntry(id: string): string {
  const entry = {
    v: 1,
    type: 'entry',
    id: `${STALE_SENDER}-${id}`,
    at: 1,
    from: STALE_SENDER,
    to: id,
    kind: 'note',
    subject: 'stale',
    body: STALE_BODY,
  }

  return `${JSON.stringify(entry)}\n`
}

// The entries of an inbox, one JSON object a line; a line that is none is null.
function entriesOf(text: string): readonly (Record<string, unknown> | null)[] {
  return text.split('\n').filter(line => line.trim() !== '').map(line => {
    try {
      const value: unknown = JSON.parse(line)

      return isRecord(value) ? value : null
    } catch {
      return null
    }
  })
}

function isBrief(entry: Record<string, unknown> | null): boolean {
  if (entry === null || entry.from !== CADRE_SENDER || entry.to !== PM) return false
  const shown = [entry.subject, entry.body].filter((part): part is string => typeof part === 'string')

  return shown.some(part => part.includes(EPIC_KEY))
}

rowTest(rowEntry('03.2#41'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  const ids = await roleIdsOf(copy)
  const config = configDir()

  const first = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'the first epic', first.result)
  const before = await inboxesOf(config, copy, first.worktree, ids)
  await ctx.check('the first epic makes an inbox folder for every role', () => {
    assert.deepEqual(before.missing, [], `no inbox folder: ${before.missing.join('; ')}`)
  })
  if (before.missing.length > 0) return

  for (const [id, file] of before.files) await appendFile(file, staleEntry(id))
  const done = await epicDone(copy, EPIC_KEY, true)
  noteReply(ctx, 'epic done', done)
  await ctx.check('epic done removes the first worktree', () => {
    assert.ok(!existsSync(first.worktree), `the worktree folder is still there: ${firstLineOf(replyOf(done))}`)
  })
  // Without a removed worktree the second epic only reuses it, which clears nothing.
  if (existsSync(first.worktree)) return

  const second = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'the second epic', second.result)
  const after = await inboxesOf(config, copy, second.worktree, ids)
  await ctx.check('the second epic has an inbox folder for every role, where the first one had them', () => {
    assert.deepEqual(after.missing, [], `no inbox folder: ${after.missing.join('; ')}`)
    for (const [id, file] of before.files) assert.equal(after.files.get(id), file, `the inbox home of ${id} moved`)
  })

  for (const [id, file] of after.files) {
    const text = await readFile(file, 'utf8').catch(() => null)
    await ctx.check(`${id}: the new inbox holds only entries from cadre, none of the first epic`, () => {
      assert.ok(text !== null, 'the inbox file is not there')
      assert.ok(!text.includes(STALE_BODY), 'the inbox still holds the entry of the first epic')
      const others = entriesOf(text).filter(entry => entry === null || entry.from !== CADRE_SENDER)
      assert.equal(others.length, 0, `${others.length} lines are no entry from ${CADRE_SENDER}`)
    })
    if (id !== PM) continue

    ctx.evidence('the PM inbox after the second epic', text ?? '')
    await ctx.check('PM: the new inbox holds the brief of the epic', () => {
      assert.ok(entriesOf(text ?? '').some(isBrief), `no entry from ${CADRE_SENDER} to ${PM} names ${EPIC_KEY}`)
    })
  }
})
