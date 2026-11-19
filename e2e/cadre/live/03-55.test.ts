import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { HarnessError } from '../../lib/errors.ts'
import { rowTest } from '../../lib/row.ts'
import {
  cadrePrint,
  firstLineOf,
  liveRepo,
  noteReply,
  printedCommand,
  replyOf,
  runProbe,
  sessionStartRuns,
  writeSessionStartHook,
} from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const RUNTIME_SETTINGS = '.cadre/be/.runtime/settings.json'

rowTest(rowEntry('03#55'), async ctx => {
  const marker = join(ctx.scratch, 'project-hook-ran')
  const copy = await liveRepo(ctx, 'gsd-here')
  await writeSessionStartHook(copy.repo, marker)
  const started = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be', started)
  if (printedCommand(replyOf(started), ROLE) === null) {
    throw new HarnessError(`03#55: the start did not render: ${firstLineOf(replyOf(started))}`)
  }

  // The start's own session loads the project settings too: its lines show that a print-mode session runs the hook,
  // and they are cleared so the lines after the probe are the probe's alone.
  const startRuns = await sessionStartRuns(marker)
  ctx.observe('hookRanInTheStartSession', startRuns > 0, `${startRuns} marker lines after /cadre start`)
  await rm(marker, { force: true })

  const probe = await runProbe(copy, ROLE)
  noteReply(ctx, 'the probe run from the git root', probe)
  const runs = await sessionStartRuns(marker)
  const runtime = await readFile(join(copy.repo, RUNTIME_SETTINGS), 'utf8').catch(() => '')
  const evidence = `${runs} marker lines after the probe; hook in ${RUNTIME_SETTINGS}: ${runtime.includes(marker)}`
  ctx.observe('projectSettingsLoaded', runs > 0, evidence)
})
