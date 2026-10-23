/**
 * Test support for the golden suite (D-219), not a test itself: each capture runs one init flow over the scripted
 * ports of testkit.ts (memIo, memHost) and returns its golden value. The golden tests compare that value with their
 * fixture; a scratch run prints it to make the fixture. Only the golden modules import it.
 */
import { sha256Hex } from '../hash'
import { runInit } from '../init'
import { memIo } from '../testkit'
import type { MemRun, MemWorld } from '../testkit'
import type { GoldenAsk, GoldenBlock, GoldenRun } from './types'

/**
 * The golden of a finished run: each question split on '\n' with its spec's header (null when none), options and
 * multi-select, every line logged, every side-pane block, the sha256 of each prompt in order, and the reply split on
 * '\n'.
 */
export async function captureRun(run: MemRun, reply: string): Promise<GoldenRun> {
  const asks = run.asked.map(
    (question, index): GoldenAsk => ({
      question: question.split('\n'),
      header: run.specs[index]?.header ?? null,
      options: run.specs[index]?.options ?? [],
      multiSelect: run.specs[index]?.multiSelect === true,
    }),
  )
  const shown = run.shown.map((block): GoldenBlock => ({ key: block.key, title: block.title, lines: block.lines }))
  const promptHashes = await Promise.all(run.prompts.map(prompt => sha256Hex(prompt)))

  return { asks, logged: run.logged, shown, promptHashes, reply: reply.split('\n') }
}

/** The golden of `/cadre init --dry-run` over `world`, each question answered by its longest prefix in `answers`. */
export async function captureInit(world: MemWorld, answers: Readonly<Record<string, string>>): Promise<GoldenRun> {
  const run = memIo(world, answers)
  const reply = await runInit(run.io, { dryRun: true })

  return captureRun(run, reply)
}
