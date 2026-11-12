import assert from 'node:assert/strict'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { answer, idleTui, waitTui } from '../../lib/claude.ts'
import { liveEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { copyTree, fixtureDir } from '../../lib/fixture.ts'
import { rowTest } from '../../lib/row.ts'
import { rowDir, scratchRoot } from '../../lib/scratch.ts'
import { capture, killServer, socketName, startServer, WAIT_MS } from '../../lib/tmux.ts'
import type { Pane } from '../../lib/tmux.ts'
import { GSD_SECURITY_INSTALL_SCRIPT, INIT_REVIEW_QUESTION } from '../fixtures/answers.ts'
import {
  APPLIED_REPLY,
  assertHaikuRoles,
  cadrePrint,
  cadreTui,
  driveDialogs,
  firstLineOf,
  noteReply,
  printedCommand,
  replyOf,
  runProbe,
} from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const MARKETPLACE = 'claude-plugins-official'
const SECURITY_KEY = `claude-security@${MARKETPLACE}`
const GUIDANCE_KEY = `security-guidance@${MARKETPLACE}`
const EXPECTED_INSTALLED_LINE =
  'Installed claude-security@claude-plugins-official and security-guidance@claude-plugins-official: ' +
  'run /reload-plugins to load them in this session.'
const EXPECTED_NEXT_LINE_START = 'Next:'
const EXPECTED_SKILL = 'claude-security:claude-security'
const EXPECTED_COMMAND = '/claude-security'
const SECURITY = 'security'
const INIT_COMMAND = '/cadre init'
const CONFIRM = 'Confirm'
const NEXT_PAGE = 'Next page'
const PAGE_RE = /Review \(page ([0-9]+) of ([0-9]+)\)/
const PLUGINS_RULE_RE = /Plugins: only (.*?) load/g
const OTHER_MARKETPLACE_KEY_RE = /(?:security-guidance|claude-security)@([A-Za-z0-9._-]+)/g
const VIOLATED = 'violated'
const MAX_REVIEW_PAGES = 60
const MAX_SCANNED_BYTES = 1_000_000
const WHITESPACE_RE = /\s+/g
const FRAME_TOP_LEFT = '┌'
const FRAME_TOP_RIGHT = '┐'
const FRAME_BOTTOM_LEFT = '└'
const SCANNED_FOLDERS: readonly string[] = ['.cadre', '.claude']

// 03#87 reads the copy 03#83 initialised; it lives in the run scratch so it outlasts the scratch of 03#83.
let shared: LiveRepo | null = null

function squashed(text: string): string {
  return text.replace(WHITESPACE_RE, ' ')
}

// The lines inside the preview box beside the options of a dialog, read between the columns of the box's own frame.
function previewLines(screen: string): readonly string[] {
  const rows = screen.split('\n')
  const top = rows.findLastIndex(row => row.includes(FRAME_TOP_LEFT))
  const frame = rows[top]
  if (frame === undefined) return []
  const left = frame.indexOf(FRAME_TOP_LEFT)
  const right = frame.lastIndexOf(FRAME_TOP_RIGHT)
  const bottom = rows.findIndex((row, index) => index > top && row.includes(FRAME_BOTTOM_LEFT))
  if (right === -1 || bottom === -1) return []

  return rows.slice(top + 1, bottom).map(row => row.slice(left + 1, right).trim())
}

function pageOf(screen: string): { readonly page: number; readonly count: number } | null {
  const found = PAGE_RE.exec(previewLines(screen).join('\n'))
  if (found === null) return null

  return { page: Number(found[1]), count: Number(found[2]) }
}

// The preview of every page of the review, one entry per page, ending with the pane on the last page.
async function readReview(pane: Pane, first: string): Promise<readonly (readonly string[])[]> {
  const pages = [previewLines(first)]
  let at = pageOf(first)
  while (at !== null && at.page < at.count) {
    if (pages.length >= MAX_REVIEW_PAGES) throw new HarnessError(`the review has more than ${MAX_REVIEW_PAGES} pages`)
    const next = at.page + 1
    await answer(pane, NEXT_PAGE)
    await waitTui(pane, screen => pageOf(screen)?.page === next, WAIT_MS, `page ${next} of the review`)
    const screen = await idleTui(pane)
    pages.push(previewLines(screen))
    at = pageOf(screen)
  }

  return pages
}

async function jsonOf(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8').catch(() => null)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function enabledKeys(settings: unknown): readonly string[] {
  if (!isRecord(settings) || !isRecord(settings.enabledPlugins)) return []

  return Object.entries(settings.enabledPlugins).filter(([, isOn]) => isOn === true).map(([key]) => key)
}

async function roleIds(repo: string): Promise<readonly string[]> {
  const entries = await readdir(join(repo, '.cadre'), { withFileTypes: true }).catch(() => null)
  if (entries === null) throw new HarnessError('the copy has no .cadre/ folder')

  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
}

// Every regular file under `dir`, links left out, so a link out of the copy is never followed.
async function filesUnder(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null)
  if (entries === null) return []
  const found: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...await filesUnder(path))
    if (entry.isFile()) found.push(path)
  }

  return found
}

async function otherMarketplaceKeys(repo: string): Promise<readonly string[]> {
  const hits: string[] = []
  for (const folder of SCANNED_FOLDERS) {
    for (const path of await filesUnder(join(repo, folder))) {
      const stats = await lstat(path)
      if (stats.size > MAX_SCANNED_BYTES) continue
      const text = await readFile(path, 'utf8')
      for (const match of text.matchAll(OTHER_MARKETPLACE_KEY_RE)) {
        if (match[1] !== MARKETPLACE) hits.push(`${path.slice(repo.length + 1)}: ${match[0]}`)
      }
    }
  }

  return hits
}

rowTest(rowEntry('03#83'), async ctx => {
  const shareDir = await rowDir('03-83-87-shared', scratchRoot())
  const repo = join(shareDir, 'repo')
  await copyTree(fixtureDir('gsd-pre'), repo)
  const copy: LiveRepo = { repo, env: liveEnv() }
  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))

  const pane = await cadreTui(server, copy, INIT_COMMAND)
  const withoutReview = GSD_SECURITY_INSTALL_SCRIPT.filter(entry => entry.question !== INIT_REVIEW_QUESTION)
  const first = (await driveDialogs(pane, withoutReview, APPLIED_REPLY, { stopAt: INIT_REVIEW_QUESTION })).final
  const pages = await readReview(pane, first)
  ctx.screen('the first page of the review', first)
  ctx.evidence('the review, preview text of every page', pages.map((page, at) => {
    return `-- page ${at + 1}\n${page.join('\n')}`
  }).join('\n'))
  const rules = [...squashed(pages.map(page => page.join(' ')).join(' ')).matchAll(PLUGINS_RULE_RE)].map(m => m[0])
  ctx.evidence('the Plugins: only rules of the review', rules.join('\n') || 'none')
  await ctx.check('before Confirm the Security card names both keys in its Plugins: only rule', () => {
    const named = rules.some(rule => rule.includes(SECURITY_KEY) && rule.includes(GUIDANCE_KEY))
    assert.ok(named, `no Plugins: only rule names both ${SECURITY_KEY} and ${GUIDANCE_KEY}`)
  })

  await answer(pane, CONFIRM)
  await driveDialogs(pane, [], APPLIED_REPLY)
  const history = await capture(pane, { history: true })
  const reply = history.slice(Math.max(0, history.lastIndexOf(`❯ ${INIT_COMMAND}`)))
  ctx.evidence('the reply of /cadre init after Confirm', reply)
  await assertHaikuRoles(copy)
  shared = copy

  const text = squashed(reply)
  await ctx.check('the reply holds the Installed line', () => {
    assert.ok(text.includes(EXPECTED_INSTALLED_LINE), `the reply does not hold: ${EXPECTED_INSTALLED_LINE}`)
  })
  await ctx.check('the Installed line is the line before the Next line', () => {
    const expected = `${EXPECTED_INSTALLED_LINE} ${EXPECTED_NEXT_LINE_START}`
    assert.ok(text.includes(expected), 'the line after the Installed line is not the Next line')
  })
  await ctx.check(`.cadre/security/role.json lists ${EXPECTED_SKILL}`, async () => {
    const role = await jsonOf(join(repo, '.cadre', SECURITY, 'role.json'))
    const skills = isRecord(role) && Array.isArray(role.skills) ? role.skills : []
    assert.ok(skills.includes(EXPECTED_SKILL), `role.json skills: ${JSON.stringify(skills)}`)
  })

  const started = await cadrePrint(copy, `start ${SECURITY}`)
  noteReply(ctx, 'start security', started)
  if (printedCommand(replyOf(started), SECURITY) === null) {
    throw new HarnessError(`03#83: the start did not render: ${firstLineOf(replyOf(started))}`)
  }
  const settingsFiles: readonly string[] = [
    join('.cadre', SECURITY, 'settings.json'),
    join('.cadre', SECURITY, '.runtime', 'settings.json'),
  ]
  for (const file of settingsFiles) {
    const keys = enabledKeys(await jsonOf(join(repo, file)))
    ctx.evidence(`${file} enabledPlugins`, keys.join('\n') || 'none')
    await ctx.check(`${file} enables both plugins`, () => {
      assert.ok(keys.includes(SECURITY_KEY) && keys.includes(GUIDANCE_KEY), `${file} enables: ${keys.join(', ')}`)
    })
  }

  const probe = await runProbe(copy, SECURITY)
  noteReply(ctx, 'the probe of security', probe)
  const verdicts = probe.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  await ctx.check(`the probe lists ${EXPECTED_COMMAND}`, () => {
    const listed = verdicts.some(line => line.includes(EXPECTED_SKILL) && !line.startsWith(VIOLATED))
    assert.ok(listed, `no probe line that is not violated names ${EXPECTED_SKILL}`)
  })
  const hookLines = verdicts.filter(line => line.includes('security-guidance'))
  ctx.observe('probeNamesSecurityGuidance', hookLines.length > 0, hookLines.join('\n') || 'no probe line names it')
})

rowTest(rowEntry('03#87'), async ctx => {
  const copy = shared
  if (copy === null) throw new HarnessError('03#87 reads the copy 03#83 initialised, and 03#83 made none')

  const enabling: string[] = []
  for (const id of await roleIds(copy.repo)) {
    for (const file of ['settings.json', join('.runtime', 'settings.json')]) {
      const keys = enabledKeys(await jsonOf(join(copy.repo, '.cadre', id, file)))
      if (keys.includes(GUIDANCE_KEY)) enabling.push(`${id} (${file})`)
    }
  }
  ctx.evidence(`the role settings that enable ${GUIDANCE_KEY}`, enabling.join('\n') || 'none')
  await ctx.check(`only Security's settings enable ${GUIDANCE_KEY}`, () => {
    const others = enabling.filter(item => !item.startsWith(`${SECURITY} (`))
    assert.deepEqual(others, [], `other roles enable it: ${others.join(', ')}`)
    assert.ok(enabling.length > 0, `no settings of ${SECURITY} enable it`)
  })

  const hits = await otherMarketplaceKeys(copy.repo)
  ctx.evidence('security plugin keys of another marketplace under .cadre/ and .claude/', hits.join('\n') || 'none')
  await ctx.check('no file under .cadre/ or .claude/ names a security plugin key of another marketplace', () => {
    assert.deepEqual(hits, [], `found: ${hits.join('; ')}`)
  })
})
