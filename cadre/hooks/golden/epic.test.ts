import { describe, expect, test } from 'claude-code/testing'

import { epicRecordText, MERGED_ARGV, STATUS_ARGV } from '../epic'
import { entry, hostWorld } from '../testkit'
import { captureEpic, captureEpicDone } from './capture'
import { GOLDEN_EPIC } from './epic'
import {
  BASE_RULES,
  BRANCH,
  DARWIN,
  DONE_RULES,
  doneWorld,
  KEPT_RULES,
  keptWorld,
  RECORD,
  RENDER_RULES,
  renderWorld,
  rule,
  WORKTREE,
} from './worlds'

describe('golden: /cadre epic create and done (D-219)', () => {
  test('create: PROJ-1 on macOS in iTerm renders each role and opens it in a new tab', async () => {
    const host = hostWorld({ runs: [...RENDER_RULES, DARWIN, ...BASE_RULES], env: { TERM_PROGRAM: 'iTerm.app' } })
    const golden = await captureEpic(await renderWorld(), host, { key: 'PROJ-1', title: '', terminal: 'auto' })
    expect(golden).toEqual(GOLDEN_EPIC.create)
  })

  test('createReuse: PROJ-1 reuses its kept worktree and links only what is missing', async () => {
    const recorded = { ...RECORD, slug: 'proj-1-x', branch: 'epic/proj-1-x', links: ['node_modules'], copies: ['.env'] }
    const kept = await keptWorld(epicRecordText(recorded))
    const world = {
      ...kept,
      files: { ...kept.files, '/repo/.env': 'MAIN=1\n' },
      dirs: { ...kept.dirs, '/repo': [entry('.env')] },
    }
    const host = hostWorld({ runs: [...KEPT_RULES, ...BASE_RULES] })
    const golden = await captureEpic(world, host, { key: 'PROJ-1', title: 'Add retry', terminal: 'auto' })
    expect(golden).toEqual(GOLDEN_EPIC.createReuse)
  })

  test('createMacOnly: PROJ-1 off macOS opens nothing, shows the refusal once and copies each command', async () => {
    const linux = rule(['/usr/bin/uname', '-s'], 0, 'Linux\n')
    const host = hostWorld({ runs: [...RENDER_RULES, linux, ...BASE_RULES] })
    const golden = await captureEpic(await renderWorld(), host, { key: 'PROJ-1', title: '', terminal: 'auto' })
    expect(golden).toEqual(GOLDEN_EPIC.createMacOnly)
  })

  test('done: a clean, merged, idle epic loses its recorded links, then its worktree', async () => {
    const host = hostWorld({ runs: [...DONE_RULES, ...BASE_RULES] })
    const golden = await captureEpicDone(await doneWorld(), host, { key: 'PROJ-1', force: false })
    expect(golden).toEqual(GOLDEN_EPIC.done)
  })

  test('doneRefused: a dirty worktree on an unmerged branch is refused, naming both reasons', async () => {
    const dirty = rule(STATUS_ARGV(WORKTREE), 0, ' M src/a.ts\n')
    const unmerged = rule(MERGED_ARGV('/repo', BRANCH, 'main'), 1)
    const host = hostWorld({ runs: [dirty, unmerged, ...DONE_RULES, ...BASE_RULES] })
    const golden = await captureEpicDone(await doneWorld(), host, { key: 'PROJ-1', force: false })
    expect(golden).toEqual(GOLDEN_EPIC.doneRefused)
  })
})
