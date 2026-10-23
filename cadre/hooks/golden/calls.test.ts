import { describe, expect, test } from 'claude-code/testing'

import { epicRecordText, MERGED_ARGV, STATUS_ARGV } from '../epic'
import { DEFAULT_LOCATIONS, entry, hostWorld } from '../testkit'
import { GOLDEN_CALLS } from './calls'
import { captureEpicCalls, captureEpicDoneCalls, captureStartCalls, captureStatusCalls } from './capture'
import {
  appliedWorld,
  BASE_RULES,
  BRANCH,
  CLAUDE_OK,
  claudeRule,
  DARWIN,
  DONE_LOG,
  DONE_RULES,
  doneWorld,
  GIT_OK,
  guardedWorld,
  KEPT_RULES,
  keptWorld,
  LAUNCHER_PATH,
  onStatus,
  RECORD,
  RENDER_RULES,
  renderWorld,
  repoWorld,
  rule,
  S9_TITLED,
  s9World,
  TIME_LOG,
  withoutFile,
  WORKTREE,
} from './worlds'

describe('golden: host runs with all their options (WA-M2, D-219)', () => {
  test('epicCreate: PROJ-1 on macOS in iTerm renders each role and opens it in a new tab', async () => {
    const host = hostWorld({ runs: [...RENDER_RULES, DARWIN, ...BASE_RULES], env: { TERM_PROGRAM: 'iTerm.app' } })
    const golden = await captureEpicCalls(await renderWorld(), host, { key: 'PROJ-1', title: '', terminal: 'auto' })
    expect(golden).toEqual(GOLDEN_CALLS.epicCreate)
  })

  test('epicCreateReuse: PROJ-1 reuses its kept worktree and links only what is missing', async () => {
    const recorded = { ...RECORD, slug: 'proj-1-x', branch: 'epic/proj-1-x', links: ['node_modules'], copies: ['.env'] }
    const kept = await keptWorld(epicRecordText(recorded))
    const world = {
      ...kept,
      files: { ...kept.files, '/repo/.env': 'MAIN=1\n' },
      dirs: { ...kept.dirs, '/repo': [entry('.env')] },
    }
    const host = hostWorld({ runs: [...KEPT_RULES, ...BASE_RULES] })
    const golden = await captureEpicCalls(world, host, { key: 'PROJ-1', title: 'Add retry', terminal: 'auto' })
    expect(golden).toEqual(GOLDEN_CALLS.epicCreateReuse)
  })

  test('epicCreateMacOnly: PROJ-1 off macOS opens nothing, shows the refusal once, copies each command', async () => {
    const linux = rule(['/usr/bin/uname', '-s'], 0, 'Linux\n')
    const host = hostWorld({ runs: [...RENDER_RULES, linux, ...BASE_RULES] })
    const golden = await captureEpicCalls(await renderWorld(), host, { key: 'PROJ-1', title: '', terminal: 'auto' })
    expect(golden).toEqual(GOLDEN_CALLS.epicCreateMacOnly)
  })

  test('epicDone: a clean, merged, idle epic loses its recorded links, then its worktree', async () => {
    const host = hostWorld({ runs: [...DONE_RULES, ...BASE_RULES] })
    const golden = await captureEpicDoneCalls(await doneWorld(), host, { key: 'PROJ-1', force: false })
    expect(golden).toEqual(GOLDEN_CALLS.epicDone)
  })

  test('epicDoneRefused: a dirty worktree on an unmerged branch is refused, naming both reasons', async () => {
    const dirty = rule(STATUS_ARGV(WORKTREE), 0, ' M src/a.ts\n')
    const unmerged = rule(MERGED_ARGV('/repo', BRANCH, 'main'), 1)
    const host = hostWorld({ runs: [dirty, unmerged, ...DONE_RULES, ...BASE_RULES] })
    const golden = await captureEpicDoneCalls(await doneWorld(), host, { key: 'PROJ-1', force: false })
    expect(golden).toEqual(GOLDEN_CALLS.epicDoneRefused)
  })

  test('statusDone: an off run whose log ends finished (done)', async () => {
    const golden = await captureStatusCalls(
      s9World('{"isOn":false}', DONE_LOG),
      hostWorld({ runs: [S9_TITLED] }),
      'be',
    )
    expect(golden).toEqual(GOLDEN_CALLS.statusDone)
  })

  test('statusRunning: a status file on with a fresh beat, whatever the log says', async () => {
    const golden = await captureStatusCalls(
      s9World(onStatus(10_000), DONE_LOG),
      hostWorld({ runs: [S9_TITLED] }),
      'be',
    )
    expect(golden).toEqual(GOLDEN_CALLS.statusRunning)
  })

  test('statusNotStarted: a session with neither a status file nor a log', async () => {
    const golden = await captureStatusCalls(s9World(null, null), hostWorld({ runs: [S9_TITLED] }), 'be')
    expect(golden).toEqual(GOLDEN_CALLS.statusNotStarted)
  })

  test('statusStopped: a stale beat with a log that ends finished (time)', async () => {
    const golden = await captureStatusCalls(
      s9World(onStatus(120_000), TIME_LOG),
      hostWorld({ runs: [S9_TITLED] }),
      'be',
    )
    expect(golden).toEqual(GOLDEN_CALLS.statusStopped)
  })

  test('statusUnknown: a status file that is not JSON', async () => {
    const golden = await captureStatusCalls(s9World('{', DONE_LOG), hostWorld({ runs: [S9_TITLED] }), 'be')
    expect(golden).toEqual(GOLDEN_CALLS.statusUnknown)
  })

  test('startRender: be over the applied world, with claude new enough and git answering', async () => {
    const golden = await captureStartCalls(await appliedWorld(), hostWorld({ runs: [CLAUDE_OK, GIT_OK] }), 'be')
    expect(golden).toEqual(GOLDEN_CALLS.startRender)
  })

  test('startRefusalRepo: a session root below the git top level refuses before the team is read', async () => {
    const locations = { ...DEFAULT_LOCATIONS, root: '/repo/app', givenRoot: '/repo/app' }
    const golden = await captureStartCalls(repoWorld({ locations }), hostWorld({ runs: [CLAUDE_OK, GIT_OK] }), 'be')
    expect(golden).toEqual(GOLDEN_CALLS.startRefusalRepo)
  })

  test('startRefusalTeam: a git repo with no .cadre/cadre.json refuses before the launcher is checked', async () => {
    const golden = await captureStartCalls(guardedWorld(), hostWorld({ runs: [CLAUDE_OK, GIT_OK] }), 'be')
    expect(golden).toEqual(GOLDEN_CALLS.startRefusalTeam)
  })

  test('startRefusalLauncher: a missing launcher refuses before claude is run', async () => {
    const world = withoutFile(await appliedWorld(), LAUNCHER_PATH)
    const golden = await captureStartCalls(world, hostWorld({ runs: [CLAUDE_OK, GIT_OK] }), 'be')
    expect(golden).toEqual(GOLDEN_CALLS.startRefusalLauncher)
  })

  test('startRefusalClaude: a claude --version that cannot run refuses before any other run', async () => {
    const golden = await captureStartCalls(await appliedWorld(), hostWorld({ runs: [claudeRule(null), GIT_OK] }), 'be')
    expect(golden).toEqual(GOLDEN_CALLS.startRefusalClaude)
  })
})
