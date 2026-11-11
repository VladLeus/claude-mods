import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { answer, claudeBin, idleTui, TUI_READY, TUI_TRUST, waitTui } from '../../lib/claude.ts'
import { liveEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { copyTree, fixtureDir } from '../../lib/fixture.ts'
import { rowTest } from '../../lib/row.ts'
import { shellQuote } from '../../lib/shims.ts'
import { killServer, newWindow, sendKeys, sendText, socketName, startServer } from '../../lib/tmux.ts'
import { waitDead, WAIT_MS } from '../../lib/tmux.ts'
import type { Pane, Server } from '../../lib/tmux.ts'
import { rowEntry } from '../rows.ts'

const EXIT_COMMAND = '/exit'
const WINDOW = 'claude'
const CONTINUE = 'Continue'
const START_ROUNDS = 8
const START_LABEL = 'the ready prompt, a settings warning, the folder trust dialog or a first-run screen'
const SETTINGS_WARNING_RE = /Settings Warning/
const HOOK_PATH = 'hooks.SessionStart'

type Started = {
  readonly pane: Pane
  readonly warnings: readonly string[]
}

function untypedHookSettings(marker: string): string {
  const command = `/bin/sh -c ${shellQuote(`echo ran >> ${shellQuote(marker)}`)}`
  const settings = { hooks: { SessionStart: [{ hooks: [{ command }] }] } }

  return `${JSON.stringify(settings, null, 2)}\n`
}

function isKnownScreen(screen: string): boolean {
  const isTrustStep = TUI_TRUST.some(step => step.matcher.test(screen))

  return TUI_READY.test(screen) || SETTINGS_WARNING_RE.test(screen) || isTrustStep
}

// The engine stops at a Settings Warning dialog for a hook entry it skips; its first option is Continue.
async function startPastWarnings(server: Server, cwd: string, args: readonly string[]): Promise<Started> {
  const pane = await newWindow(server, WINDOW, cwd, [claudeBin(), ...args])
  const warnings: string[] = []
  for (let round = 0; round < START_ROUNDS; round += 1) {
    await waitTui(pane, isKnownScreen, WAIT_MS, START_LABEL)
    const screen = await idleTui(pane)
    if (TUI_READY.test(screen)) return { pane, warnings }
    if (SETTINGS_WARNING_RE.test(screen)) {
      warnings.push(screen)
      await answer(pane, CONTINUE)
      continue
    }
    const step = TUI_TRUST.find(item => item.matcher.test(screen))
    if (!step) continue
    if (step.label === null) await sendKeys(pane, 'Enter')
    else await answer(pane, step.label)
  }

  throw new HarnessError(`claude did not reach the ready prompt in ${START_ROUNDS} rounds`)
}

rowTest(rowEntry('03#70'), async ctx => {
  const repo = join(ctx.scratch, 'repo')
  await copyTree(fixtureDir('bare'), repo)
  const marker = join(ctx.scratch, 'untyped-hook-ran')
  const settings = join(ctx.scratch, 'untyped-hook-settings.json')
  await writeFile(settings, untypedHookSettings(marker))
  const server = await startServer(socketName(), liveEnv())
  ctx.after(() => killServer(server))
  const { pane, warnings } = await startPastWarnings(server, repo, ['--settings', settings])
  for (const [index, screen] of warnings.entries()) ctx.screen(`settings warning ${index + 1}`, screen)
  ctx.screen('after the start', await idleTui(pane))

  const warning = warnings.flatMap(screen => screen.split('\n')).find(line => line.includes(HOOK_PATH))
  ctx.observe('settingsWarningDialog', warnings.length > 0, warning?.trim() ?? 'no warning dialog was shown')
  const ran = await readFile(marker, 'utf8').catch(() => null)
  ctx.observe('untypedHookRan', ran !== null, ran === null ? 'the marker file was not written' : `marker: ${ran}`)

  await sendText(pane, EXIT_COMMAND)
  await sendKeys(pane, 'Enter')
  await waitDead(pane)
})
