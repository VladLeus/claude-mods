import assert from 'node:assert/strict'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { configDir } from '../../lib/claude.ts'
import { rowTest } from '../../lib/row.ts'
import { cadrePrint, inboxDirOf, liveRepo, noteReply } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

type Kind = 'file' | 'folder' | 'link' | 'other'

const ROLE = 'be'
const RUNTIME = '.cadre/be/.runtime'
const EXPECTED_RUNTIME: readonly { readonly name: string; readonly kind: Kind }[] = [
  { name: 'settings.json', kind: 'file' },
  { name: 'mcp.json', kind: 'file' },
  { name: 'overlay', kind: 'folder' },
  { name: 'private-instructions', kind: 'folder' },
  { name: 'probe-expectations.json', kind: 'file' },
  { name: 'stamp', kind: 'file' },
]
const EXPECTED_INBOX_FILES: readonly string[] = ['inbox.jsonl']
// A plain start of a parts-flow role plants no instructions; a running role session writes session.json.
const EVIDENCE_RUNTIME_ENTRY = 'instructions'
const EVIDENCE_INBOX_FILE = 'session.json'
const INBOX_NAME_RE = /inbox/i

async function kindOf(path: string): Promise<Kind | null> {
  const stats = await lstat(path).catch(() => null)
  if (stats === null) return null
  if (stats.isSymbolicLink()) return 'link'
  if (stats.isDirectory()) return 'folder'

  return stats.isFile() ? 'file' : 'other'
}

async function presenceOf(path: string): Promise<string> {
  const kind = await kindOf(path)

  return kind === null ? 'absent' : `present (${kind})`
}

// Like ls -laR: every entry once with its kind, a link listed and never followed.
async function treeOf(dir: string, prefix = ''): Promise<readonly string[]> {
  const names = (await readdir(dir).catch((): string[] => [])).sort()
  const lines: string[] = []
  for (const name of names) {
    const kind = (await kindOf(join(dir, name))) ?? 'gone'
    lines.push(`${kind} ${prefix}${name}`)
    if (kind === 'folder') lines.push(...(await treeOf(join(dir, name), `${prefix}${name}/`)))
  }

  return lines
}

rowTest(rowEntry('03#65'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd')
  const started = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be', started)

  const runtime = join(copy.repo, RUNTIME)
  const runtimeTree = await treeOf(runtime)
  ctx.evidence(`${RUNTIME}/ listing`, runtimeTree.join('\n'))
  const instructions = await presenceOf(join(runtime, EVIDENCE_RUNTIME_ENTRY))
  ctx.evidence(`${RUNTIME}/${EVIDENCE_RUNTIME_ENTRY}, not required`, instructions)
  for (const { name, kind } of EXPECTED_RUNTIME) {
    await ctx.check(`${RUNTIME}/${name} is a ${kind}`, async () => {
      assert.equal(await kindOf(join(runtime, name)), kind, `${RUNTIME}/${name} is not a ${kind}`)
    })
  }

  const inboxDir = await inboxDirOf(configDir(), copy, ROLE)
  ctx.evidence(`the inbox folder of ${ROLE}, listing`, (await treeOf(inboxDir)).join('\n'))
  const session = await presenceOf(join(inboxDir, EVIDENCE_INBOX_FILE))
  ctx.evidence(`${EVIDENCE_INBOX_FILE} in the inbox folder of ${ROLE}, not required`, session)
  for (const name of EXPECTED_INBOX_FILES) {
    await ctx.check(`${name} is in the inbox folder of ${ROLE}`, async () => {
      assert.equal(await kindOf(join(inboxDir, name)), 'file', `${name} is not a file in the inbox folder`)
    })
  }
  await ctx.check('the inbox is not under .runtime/', () => {
    const found = runtimeTree.filter(line => INBOX_NAME_RE.test(line))
    assert.deepEqual(found, [], 'an inbox entry lies under .runtime/')
  })
})
