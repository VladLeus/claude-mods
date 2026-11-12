import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { idleTui, SETTINGS_WARNING, startTui } from '../../lib/claude.ts'
import type { TuiStep } from '../../lib/claude.ts'
import { liveEnv } from '../../lib/env.ts'
import { copyTree, fixtureDir } from '../../lib/fixture.ts'
import { rowTest } from '../../lib/row.ts'
import { shellQuote } from '../../lib/shims.ts'
import { killServer, sendKeys, sendText, socketName, startServer, waitDead } from '../../lib/tmux.ts'
import { rowEntry } from '../rows.ts'

const EXIT_COMMAND = '/exit'
const HOOK_PATH = 'hooks.SessionStart'

function untypedHookSettings(marker: string): string {
  const command = `/bin/sh -c ${shellQuote(`echo ran >> ${shellQuote(marker)}`)}`
  const settings = { hooks: { SessionStart: [{ hooks: [{ command }] }] } }

  return `${JSON.stringify(settings, null, 2)}\n`
}

rowTest(rowEntry('03#70'), async ctx => {
  const repo = join(ctx.scratch, 'repo')
  await copyTree(fixtureDir('bare'), repo)
  const marker = join(ctx.scratch, 'untyped-hook-ran')
  const settings = join(ctx.scratch, 'untyped-hook-settings.json')
  await writeFile(settings, untypedHookSettings(marker))
  const server = await startServer(socketName(), liveEnv())
  ctx.after(() => killServer(server))
  const warnings: string[] = []
  const seen = (step: TuiStep, screen: string): void => {
    if (step === SETTINGS_WARNING) warnings.push(screen)
  }
  const pane = await startTui(server, repo, ['--settings', settings], seen)
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
