import { describe, expect, test } from 'claude-code/testing'

import { runInit } from '../init/run'
import { DEFAULT_LOCATIONS, gitWorld, memIo, memWorld } from '../testkit'
import { captureReply } from './capture'
import { GOLDEN_INIT_REFUSALS } from './init-refusals'
import { STATUS_PATH } from './worlds'

describe('golden: init refusals (D-219)', () => {
  test('a session nobody can be asked in (claude -p)', async () => {
    const run = memIo(gitWorld({ interactive: false }), {})
    const reply = await runInit(run.io, { dryRun: true })
    expect(await captureReply(run, reply)).toEqual(GOLDEN_INIT_REFUSALS.notInteractive)
  })

  test('a session root that cannot be read', async () => {
    const run = memIo(gitWorld({ locations: null }), {})
    const reply = await runInit(run.io, { dryRun: true })
    expect(await captureReply(run, reply)).toEqual(GOLDEN_INIT_REFUSALS.rootUnknown)
  })

  test('a session root that is the home folder', async () => {
    const run = memIo(gitWorld({ locations: { ...DEFAULT_LOCATIONS, root: '/home/u', givenRoot: '/home/u' } }), {})
    const reply = await runInit(run.io, { dryRun: true })
    expect(await captureReply(run, reply)).toEqual(GOLDEN_INIT_REFUSALS.homeFolder)
  })

  test('a session root that is the file system root', async () => {
    const run = memIo(gitWorld({ locations: { ...DEFAULT_LOCATIONS, root: '/', givenRoot: '/' } }), {})
    const reply = await runInit(run.io, { dryRun: true })
    expect(await captureReply(run, reply)).toEqual(GOLDEN_INIT_REFUSALS.fileSystemRoot)
  })

  test('a session root with no git repo above it', async () => {
    const run = memIo(memWorld({}), {})
    const reply = await runInit(run.io, { dryRun: true })
    expect(await captureReply(run, reply)).toEqual(GOLDEN_INIT_REFUSALS.noGitRepo)
  })

  test('a session root below the git top level', async () => {
    const locations = { ...DEFAULT_LOCATIONS, root: '/repo/app', givenRoot: '/repo/app' }
    const run = memIo(gitWorld({ locations }), {})
    const reply = await runInit(run.io, { dryRun: true })
    expect(await captureReply(run, reply)).toEqual(GOLDEN_INIT_REFUSALS.belowGitTop)
  })

  test('an active autopilot run in this session', async () => {
    const files = { [STATUS_PATH]: '{"isOn":true,"phase":"running","beat":1000000}' }
    const run = memIo(gitWorld({ files }), {})
    const reply = await runInit(run.io, { dryRun: true })
    expect(await captureReply(run, reply)).toEqual(GOLDEN_INIT_REFUSALS.autopilotActive)
  })

  test('an autopilot status file that cannot be read', async () => {
    const run = memIo(gitWorld({ unknownPaths: [STATUS_PATH] }), {})
    const reply = await runInit(run.io, { dryRun: true })
    expect(await captureReply(run, reply)).toEqual(GOLDEN_INIT_REFUSALS.autopilotUnknown)
  })

  test('three unusable answers to the first question', async () => {
    const run = memIo(gitWorld(), ['maybe', 'maybe', 'maybe'])
    const reply = await runInit(run.io, { dryRun: true })
    expect(await captureReply(run, reply)).toEqual(GOLDEN_INIT_REFUSALS.unusableAnswers)
  })
})
