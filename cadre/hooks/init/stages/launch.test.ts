import { describe, expect, test } from 'claude-code/testing'

import type { InitIo, LaunchStart, PortStat } from '../../../types'
import { proposeRoles } from '../../roles/propose'
import { BIDI_OVERRIDE, memIo, memWorld, repoScan } from '../../testkit'
import type { MemRun } from '../../testkit'
import { MAX_ASKS, NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import {
  LAUNCH_DIR_CANCELLED_REASON,
  LAUNCH_DIR_CONTEXT,
  LAUNCH_DIR_OPTIONS,
  LAUNCH_DIR_QUESTION,
  LAUNCH_DIR_ROUNDS_REASON,
  LAUNCH_START_DISMISSED_REASON,
  LAUNCH_START_OPTIONS,
  LAUNCH_START_QUESTION,
  launchContextLine,
  launchLine,
  launchStartStep,
} from './launch'

/** The world of the launcher folder tests: apps/web is a folder, a file, a linked folder and nothing else. */
const FOLDER_WORLD = memWorld({
  dirs: { '/repo/apps/web': [], '/repo/apps/linked': [] },
  files: { '/repo/apps/readme.md': 'x' },
  realPaths: { '/repo/apps/linked': '/elsewhere/linked' },
})

/** The port of a run whose stat of `path` answers `stat`; the stat of any other path is the run's own. */
function withStat(run: MemRun, path: string, stat: PortStat): InitIo {
  return { ...run.io, stat: async asked => (asked === path ? stat : run.io.stat(asked)) }
}

/** The line on top of the folder question when it is asked again after a folder it cannot use (D-136). */
function cannotUse(answer: string, problem: string): string {
  return `Cannot use ${answer}: ${problem}.`
}

/** The problem with a folder path isSafeRelativePath refuses. */
const UNSAFE_FOLDER = 'use a folder inside this repo: letters, digits, . _ @ - and /, with no .. and no leading /'

/** The problem with a folder whose real path is not a folder inside the repo. */
const NOT_A_FOLDER = 'it is not a folder in this repo'

/** What launchStartStep gives for the folder apps/web of the repo. */
const APPS_WEB = { kind: 'accepted', value: { kind: 'dir', path: 'apps/web' } }

/** The team the launcher start is asked for: PM, Team Lead and Security, whose ids its context line names (D-136). */
const LAUNCH_TEAM = proposeRoles(repoScan()).roles

/** The launcher start question as asked for LAUNCH_TEAM: whose launchers start there, under it (D-136). */
const LAUNCH_ASKED = withContext(LAUNCH_START_QUESTION, launchContextLine(LAUNCH_TEAM))

/** The launcher folder question as asked: that the folder must stay inside the repo, under it (D-136). */
const DIR_ASKED = withContext(LAUNCH_DIR_QUESTION, LAUNCH_DIR_CONTEXT)

describe('launchStartStep', () => {
  test('the launcher start question is asked once for the repo with three options in a fixed order', () => {
    expect(LAUNCH_START_QUESTION).toBe(
      'Where should the role launchers start their sessions? (asked once for this repo)',
    )
    expect(LAUNCH_START_OPTIONS).toEqual([
      'Git root of this repo',
      'The folder I run it from',
      'Another folder in this repo',
    ])
    expect(Object.isFrozen(LAUNCH_START_OPTIONS)).toBe(true)
    expect(LAUNCH_DIR_QUESTION).toBe(
      'Type the folder the launchers start in, relative to the repo root (for example apps/web).',
    )
    expect(LAUNCH_DIR_OPTIONS).toEqual(['Cancel init'])
    expect(Object.isFrozen(LAUNCH_DIR_OPTIONS)).toBe(true)
  })

  test('the git root and the folder it is run from are chosen by label or word, trimmed and in any case', async () => {
    const cases: readonly (readonly [string, LaunchStart])[] = [
      ['Git root of this repo', { kind: 'git-root' }],
      [' git root ', { kind: 'git-root' }],
      ['The folder I run it from', { kind: 'here' }],
      ['IN HERE', { kind: 'here' }],
    ]
    for (const [answer, start] of cases) {
      const run = memIo(memWorld({}), [answer])
      expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual({ kind: 'accepted', value: start })
      expect(run.asked).toEqual([LAUNCH_ASKED])
      expect(run.specs[0]).toEqual({ options: LAUNCH_START_OPTIONS, header: 'Launch' })
    }
  })

  test('another folder asks for it, and a plain folder of the repo is chosen, one trailing slash dropped', async () => {
    for (const first of ['Another folder in this repo', 'other']) {
      for (const folder of ['apps/web', 'apps/web/', ' apps/web ']) {
        const run = memIo(FOLDER_WORLD, [first, folder])
        expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual(APPS_WEB)
        expect(run.asked).toEqual([LAUNCH_ASKED, DIR_ASKED])
        expect(run.specs[1]).toEqual({ options: ['Cancel init'], header: 'Launch dir' })
        expect(run.logged).toEqual([])
      }
    }
  })

  test('an unsafe or missing folder, a file or a link out of the repo is asked again with why on top', async () => {
    const bad = ['../x', '/etc', 'a b', '${HOME}', 'missing', 'apps/readme.md', 'apps/linked']
    for (const answer of bad) {
      const run = memIo(FOLDER_WORLD, ['other', answer, 'apps/web'])
      expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual(APPS_WEB)
      const problem = ['missing', 'apps/readme.md', 'apps/linked'].includes(answer) ? NOT_A_FOLDER : UNSAFE_FOLDER
      expect(run.logged).toEqual([])
      expect(run.asked).toEqual([
        LAUNCH_ASKED,
        DIR_ASKED,
        `${cannotUse(answer, problem)}\n${DIR_ASKED}`,
      ])
    }
  })

  test('a folder reached through a linked parent that leaves the repo is refused, and asked again', async () => {
    const run = memIo(FOLDER_WORLD, ['other', 'vendor/ui', 'apps/web'])
    const outside: PortStat = { kind: 'dir', size: 0, isLink: false, realPath: '/elsewhere/vendor/ui' }
    expect(await launchStartStep(withStat(run, '/repo/vendor/ui', outside), '/repo', LAUNCH_TEAM)).toEqual(APPS_WEB)
    expect(run.logged).toEqual([])
    expect(run.asked).toEqual([
      LAUNCH_ASKED,
      DIR_ASKED,
      `${cannotUse('vendor/ui', NOT_A_FOLDER)}\n${DIR_ASKED}`,
    ])
  })

  test('a folder whose stat has no real path is refused, and asked again', async () => {
    const run = memIo(FOLDER_WORLD, ['other', 'apps/unresolved', 'apps/web'])
    const unresolved: PortStat = { kind: 'dir', size: 0, isLink: false }
    const io = withStat(run, '/repo/apps/unresolved', unresolved)
    expect(await launchStartStep(io, '/repo', LAUNCH_TEAM)).toEqual(APPS_WEB)
    expect(run.logged).toEqual([])
    expect(run.asked).toEqual([
      LAUNCH_ASKED,
      DIR_ASKED,
      `${cannotUse('apps/unresolved', NOT_A_FOLDER)}\n${DIR_ASKED}`,
    ])
  })

  test('a folder whose real path lies inside the repo is still chosen', async () => {
    const run = memIo(FOLDER_WORLD, ['other', 'packages/api'])
    const inside: PortStat = { kind: 'dir', size: 0, isLink: false, realPath: '/repo/packages/api' }
    const chosen = { kind: 'accepted', value: { kind: 'dir', path: 'packages/api' } }
    expect(await launchStartStep(withStat(run, '/repo/packages/api', inside), '/repo', LAUNCH_TEAM)).toEqual(chosen)
    expect(run.asked).toEqual([LAUNCH_ASKED, DIR_ASKED])
    expect(run.logged).toEqual([])
  })

  test('a refused folder is shown cleaned and capped in the line that says why', async () => {
    const answer = `a${BIDI_OVERRIDE} ${'x'.repeat(200)}`
    const run = memIo(FOLDER_WORLD, ['other', answer, 'apps/web'])
    await launchStartStep(run.io, '/repo', LAUNCH_TEAM)
    expect(run.asked[2]).toBe(`${cannotUse(`a ${'x'.repeat(107)}…`, UNSAFE_FOLDER)}\n${DIR_ASKED}`)
    expect(run.logged).toEqual([])
  })

  test(`${MAX_ASKS} unusable folders cancel with the rounds reason, and nothing was chosen`, async () => {
    const run = memIo(FOLDER_WORLD, ['other', '../a', 'missing', '/b', 'apps/web'])
    const rounds = { kind: 'cancelled', reason: LAUNCH_DIR_ROUNDS_REASON }
    expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual(rounds)
    expect(run.asked.slice(1)).toEqual([
      DIR_ASKED,
      `${cannotUse('../a', UNSAFE_FOLDER)}\n${DIR_ASKED}`,
      `${cannotUse('missing', NOT_A_FOLDER)}\n${DIR_ASKED}`,
    ])
    expect(run.logged).toEqual([])
    expect(LAUNCH_DIR_ROUNDS_REASON).toBe('No usable launcher folder after 3 tries: nothing was chosen.')
  })

  test('Cancel init or a dismissal at the folder question cancels with its reason', async () => {
    for (const answers of [['other', 'Cancel init'], ['other', ' cancel INIT '], ['other']]) {
      const run = memIo(FOLDER_WORLD, answers)
      const cancelled = { kind: 'cancelled', reason: LAUNCH_DIR_CANCELLED_REASON }
      expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual(cancelled)
    }
    expect(LAUNCH_DIR_CANCELLED_REASON).toBe('The launcher folder question was dismissed or cancelled.')
  })

  test('a dismissed or never answered start question cancels with its reason', async () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], LAUNCH_START_DISMISSED_REASON],
      [['somewhere', 'else', 'again'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(memWorld({}), answers)
      expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual({ kind: 'cancelled', reason })
    }
    expect(LAUNCH_START_DISMISSED_REASON).toBe('The launcher start question was dismissed or not answered.')
  })

  test('launchLine says where the launchers start', () => {
    expect(launchLine({ kind: 'git-root' })).toBe('Launchers start in: the git root')
    expect(launchLine({ kind: 'here' })).toBe('Launchers start in: the folder they are run from')
    expect(launchLine({ kind: 'dir', path: 'apps/web' })).toBe('Launchers start in: apps/web/ under the git root')
  })
})

describe('refusal re-ask (G-02-6b)', () => {
  test('the launcher folder loop puts its refusal on top of the next ask; the cap keeps its reason', async () => {
    const run = memIo(FOLDER_WORLD, ['other', '../a', 'missing', 'apps/web'])
    expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual(APPS_WEB)
    expect(run.asked).toEqual([
      LAUNCH_ASKED,
      DIR_ASKED,
      `${cannotUse('../a', UNSAFE_FOLDER)}\n${DIR_ASKED}`,
      `${cannotUse('missing', NOT_A_FOLDER)}\n${DIR_ASKED}`,
    ])
    expect(run.logged).toEqual([])
    const capped = memIo(FOLDER_WORLD, ['other', '../a', 'missing', '/b'])
    const rounds = { kind: 'cancelled', reason: LAUNCH_DIR_ROUNDS_REASON }
    expect(await launchStartStep(capped.io, '/repo', LAUNCH_TEAM)).toEqual(rounds)
  })
})
