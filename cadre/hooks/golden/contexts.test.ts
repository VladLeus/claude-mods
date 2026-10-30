import { describe, expect, test } from 'claude-code/testing'

import type { AskSpec } from '../../types'
import { runInit } from '../init/run'
import { runRegen } from '../regen/run'
import { memIo } from '../testkit'
import type { MemWorld } from '../testkit'
import { GOLDEN_CONTEXTS } from './contexts'
import type { GoldenContextAsk } from './contexts'
import { beOnlyWorld, GOLDEN_WORLDS } from './worlds'

/**
 * Each ask of a run as GOLDEN_CONTEXTS keeps it: its header chip, its own context and whether it takes a typed answer.
 */
function contextsOf(specs: readonly AskSpec[]): GoldenContextAsk[] {
  return specs.map(spec => ({
    header: spec.header ?? null,
    context: spec.context ?? null,
    acceptsTyped: spec.acceptsTyped === true,
  }))
}

/** The asks of `/cadre init --dry-run` over `world`, each question answered by its longest prefix in `answers`. */
async function initContexts(world: MemWorld, answers: Readonly<Record<string, string>>): Promise<GoldenContextAsk[]> {
  const run = memIo(world, answers)
  await runInit(run.io, { dryRun: true })

  return contextsOf(run.specs)
}

describe("golden: every question's own context (D-203, D-234, D-236)", () => {
  test('nothing: a git repo where the scan detects nothing, with the INIT_ANSWERS defaults', async () => {
    const { world, answers } = GOLDEN_WORLDS.nothing
    expect(await initContexts(world, answers)).toEqual(GOLDEN_CONTEXTS.nothing)
  })

  test('gsd: six roles with a proven user GSD that is in use, with the INIT_ANSWERS defaults', async () => {
    const { world, answers } = GOLDEN_WORLDS.gsd
    expect(await initContexts(world, answers)).toEqual(GOLDEN_CONTEXTS.gsd)
  })

  test('superpowers: six roles with superpowers in use, with the INIT_ANSWERS defaults', async () => {
    const { world, answers } = GOLDEN_WORLDS.superpowers
    expect(await initContexts(world, answers)).toEqual(GOLDEN_CONTEXTS.superpowers)
  })

  test('everyStep: two frameworks in use and the secret world, with the instruction parts declined', async () => {
    const { world, answers } = GOLDEN_WORLDS.everyStep
    expect(await initContexts(world, answers)).toEqual(GOLDEN_CONTEXTS.everyStep)
  })

  test('parts: instruction parts and two memories handed out by the model recommendations', async () => {
    const { world, answers } = GOLDEN_WORLDS.parts
    expect(await initContexts(world, answers)).toEqual(GOLDEN_CONTEXTS.parts)
  })

  test('regenDry: regen be --dry-run with BE as the whole team (beOnlyWorld)', async () => {
    const run = memIo(beOnlyWorld(), {})
    await runRegen(run.io, { id: 'be', dryRun: true })
    expect(contextsOf(run.specs)).toEqual(GOLDEN_CONTEXTS.regenDry)
  })
})
