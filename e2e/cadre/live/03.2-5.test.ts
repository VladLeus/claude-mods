import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { answer, idleTui, isDialogScreen, waitTui } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { rowTest } from '../../lib/row.ts'
import { parseShimLog } from '../../lib/shims.ts'
import { capture, killServer, socketName, startServer, WAIT_MS } from '../../lib/tmux.ts'
import type { Pane } from '../../lib/tmux.ts'
import { INIT_REVIEW_QUESTION, SP_GSD_INSTALLS_SCRIPT } from '../fixtures/answers.ts'
import type { DialogEntry } from '../fixtures/answers.ts'
import { APPLIED_REPLY, cadrePrint, cadreTui, driveDialogs, liveRepo, noteReply, replyOf } from '../lib/session.ts'
import { npxShim } from '../lib/shims.ts'
import { rowEntry } from '../rows.ts'

const DRY_RUN_COMMAND = '/cadre init --dry-run'
const EXPECTED_REFUSAL = /interactive session/
const DIALOG_TEXTS: readonly string[] = [
  'Use these roles',
  'Which frameworks does this team use?',
  'Read ~/.claude.json',
]
const DRY_RUN_NOTE_RE = /Dry run: nothing was written\./
const NEXT_PAGE = 'Next page'
const CONFIRM = 'Confirm'
const PAGE_RE = /Review \(page ([0-9]+) of ([0-9]+)\)/
const MAX_REVIEW_PAGES = 60
const WHITESPACE_RE = /\s+/g
const FRAME_TOP_LEFT = '┌'
const FRAME_TOP_RIGHT = '┐'
const FRAME_BOTTOM_LEFT = '└'

type InstallLine = {
  readonly name: string
  // The start of the review line that announces the install, and the command or keys it names.
  readonly lead: string
  readonly command: string
}

// The UAT quotes no install line: these are the three the review shows for the answers of the script.
const EXPECTED_INSTALL_LINES: readonly InstallLine[] = [
  {
    name: 'the GSD framework install',
    lead: 'Framework install from the repo root after Confirm (a --dry-run installs nothing',
    command: 'npx -y @opengsd/gsd-core@latest --claude --local',
  },
  {
    name: 'the grill plugin install',
    lead: 'Plugin install from the repo root after Confirm (a --dry-run installs nothing)',
    command: 'claude plugin install mattpocock-skills@claude-plugins-official --scope project',
  },
  {
    name: 'the security plugins install',
    lead: 'Plugins to install after Confirm (a --dry-run installs nothing)',
    command: 'claude-security@claude-plugins-official, security-guidance@claude-plugins-official',
  },
]

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

// The review is the one dialog the script leaves open: driveDialogs gives up on it once the screen stays unchanged.
async function parkAtReview(pane: Pane, script: readonly DialogEntry[]): Promise<string> {
  let failure: unknown = null
  try {
    await driveDialogs(pane, script, APPLIED_REPLY)
  } catch (error) {
    failure = error
  }
  const screen = await idleTui(pane)
  if (isDialogScreen(screen) && squashed(screen).includes(INIT_REVIEW_QUESTION)) return screen

  throw failure ?? new HarnessError(`the dialogs ended before the review:\n${screen}`)
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

function isListed(text: string, line: InstallLine): boolean {
  const at = text.indexOf(line.lead)

  return at !== -1 && text.indexOf(line.command, at) !== -1
}

async function npxCallCount(log: string): Promise<number> {
  return parseShimLog(await readFile(log, 'utf8').catch(() => '')).filter(call => call.name === 'npx').length
}

rowTest(rowEntry('03.2#5'), async ctx => {
  const shims = join(ctx.scratch, 'shims')
  const log = join(ctx.scratch, 'npx.log')
  await npxShim(shims, 'noop', log)
  const sp = await liveRepo(ctx, 'sp-pre', { path: 'sp/repo', shimDir: shims })
  const gsd = await liveRepo(ctx, 'gsd', { path: 'gsd/repo', shimDir: shims })
  const server = await startServer(socketName(), sp.env)
  ctx.after(() => killServer(server))
  // Each step is held to the calls it made itself, so one that installs does not fail the steps after it.
  let called = 0
  const noNewCall = async (): Promise<void> => {
    const calls = await npxCallCount(log)
    const added = calls - called
    called = calls
    assert.equal(added, 0, `the npx shim was called ${added} times`)
  }

  const pane = await cadreTui(server, sp, DRY_RUN_COMMAND)
  const withoutReview = SP_GSD_INSTALLS_SCRIPT.filter(entry => entry.question !== INIT_REVIEW_QUESTION)
  const first = await parkAtReview(pane, withoutReview)
  const pages = await readReview(pane, first)
  ctx.screen('the first page of the dry-run review', first)
  const preview = pages.map((page, at) => `-- page ${at + 1}\n${page.join('\n')}`)
  ctx.evidence('the dry-run review, preview text of every page', preview.join('\n'))
  const review = squashed(pages.map(page => page.join(' ')).join(' '))
  for (const line of EXPECTED_INSTALL_LINES) {
    await ctx.check(`the dry-run review lists ${line.name}`, () => {
      assert.ok(isListed(review, line), `no review line starts "${line.lead}" and names ${line.command}`)
    })
  }

  await answer(pane, CONFIRM)
  await waitTui(pane, DRY_RUN_NOTE_RE, WAIT_MS, 'the dry-run note')
  await idleTui(pane)
  const history = await capture(pane, { history: true })
  const reply = history.slice(Math.max(0, history.lastIndexOf(`❯ ${DRY_RUN_COMMAND}`)))
  ctx.evidence('the reply of /cadre init --dry-run', reply)
  await ctx.check('the dry run runs no install: the npx shim is not called', noNewCall)
  await killServer(server)

  const refused = await cadrePrint(sp, 'init')
  noteReply(ctx, 'claude -p /cadre init', refused)
  await ctx.check('claude -p /cadre init refuses: it needs an interactive session', () => {
    assert.match(replyOf(refused), EXPECTED_REFUSAL, 'the reply does not say it needs an interactive session')
  })
  await ctx.check('claude -p /cadre init asks nothing: no question text is in the output', () => {
    const found = DIALOG_TEXTS.filter(text => refused.stdout.includes(text))
    assert.deepEqual(found, [], `the output holds the question text: ${found.join(', ')}`)
  })
  await ctx.check('claude -p /cadre init installs nothing: the npx shim is not called', noNewCall)

  const regen = await cadrePrint(gsd, 'regen be')
  noteReply(ctx, 'claude -p /cadre regen be', regen)
  await ctx.check('claude -p /cadre regen installs nothing: the npx shim is not called', noNewCall)
})
