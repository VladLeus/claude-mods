import { describe, expect, test } from 'claude-code/testing'

import type { InitIo, LaunchStart, PortStat } from '../../../types'
import { isRepoFolder } from '../../paths'
import { proposeRoles } from '../../roles/propose'
import {
  BIDI_OVERRIDE,
  DEFAULT_LOCATIONS,
  driven,
  drivenWith,
  memIo,
  memWorld,
  repoScan,
  stateAt,
  wholeDraft,
} from '../../testkit'
import type { MemRun } from '../../testkit'
import { MAX_ASKS, NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import { nextStage } from '../machine'
import { cancelledReply } from '../replies'
import type { InitState, IoCall, IoResult } from '../state'
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
  launchStage,
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

/** What the launch stage chooses for the folder apps/web of the repo. */
const APPS_WEB: LaunchStart = { kind: 'dir', path: 'apps/web' }

/** The team the launcher start is asked for: PM, Team Lead and Security, whose ids its context line names (D-136). */
const LAUNCH_TEAM = proposeRoles(repoScan()).roles

/** The launch stage entered for LAUNCH_TEAM in the fixture repo, the rest of a whole draft set: its question out. */
function launchAt(): InitState {
  return launchStage.enter(stateAt('launch', wholeDraft({ roles: LAUNCH_TEAM })))
}

/** The launch stage's host operation as init/run performs it, through `io` (isRepoFolder). */
function launchCalls(io: InitIo): (call: IoCall) => Promise<IoResult> {
  return async call => {
    if (call.id !== 'launch-dir-check') throw new Error(`the launch stage does not set ${call.id}`)

    return { id: 'launch-dir-check', result: await isRepoFolder(io, call.root, call.path) }
  }
}

/** The launcher start question as asked for LAUNCH_TEAM: whose launchers start there, under it (D-136). */
const LAUNCH_ASKED = withContext(LAUNCH_START_QUESTION, launchContextLine(LAUNCH_TEAM))

/** The launcher folder question as asked: that the folder must stay inside the repo, under it (D-136). */
const DIR_ASKED = withContext(LAUNCH_DIR_QUESTION, LAUNCH_DIR_CONTEXT)

/** The launcher start question's own context for LAUNCH_TEAM: what each start means and the launchers (D-236). */
const LAUNCH_CONTEXT = {
  title: 'Launch',
  lines: [
    'Git root: the top of this repo, the same for every launcher.',
    'Run folder: wherever you run a launcher from.',
    'Launchers: .cadre/bin/pm, .cadre/bin/tl, .cadre/bin/security',
  ],
  kind: 'launch',
}

/** The launcher folder question's own context in a repo with no folder of code (D-236). */
const NO_DIRS_CONTEXT = {
  title: 'Launch folder',
  lines: ['No folder with code was found in this repo.'],
  kind: 'launch-dir',
}

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
      'Type the folder the launchers start in under Other, relative to the repo root (for example apps/web).',
    )
    expect(LAUNCH_DIR_OPTIONS).toEqual(['Cancel init'])
    expect(Object.isFrozen(LAUNCH_DIR_OPTIONS)).toBe(true)
  })

  test('the git root and the folder it is run from are chosen by label or word, trimmed and in any case', () => {
    const cases: readonly (readonly [string, LaunchStart])[] = [
      ['Git root of this repo', { kind: 'git-root' }],
      [' git root ', { kind: 'git-root' }],
      ['The folder I run it from', { kind: 'here' }],
      ['IN HERE', { kind: 'here' }],
    ]
    for (const [answer, start] of cases) {
      const run = driven(launchAt(), [answer])
      expect(run.state.draft.launchStart).toEqual(start)
      expect(run.asked).toEqual([LAUNCH_ASKED])
      expect(run.specs[0]).toEqual({ options: LAUNCH_START_OPTIONS, header: 'Launch', context: LAUNCH_CONTEXT })
    }
  })

  test('another folder asks for it, and a plain folder of the repo is chosen, one trailing slash dropped', async () => {
    for (const first of ['Another folder in this repo', 'other']) {
      for (const folder of ['apps/web', 'apps/web/', ' apps/web ']) {
        const run = await drivenWith(launchAt(), [first, folder], launchCalls(memIo(FOLDER_WORLD, []).io))
        expect(run.state.draft.launchStart).toEqual(APPS_WEB)
        expect(run.asked).toEqual([LAUNCH_ASKED, DIR_ASKED])
        expect(run.specs[1]).toEqual({ options: ['Cancel init'], header: 'Launch dir', context: NO_DIRS_CONTEXT })
        expect(run.outputs).toEqual([])
      }
    }
  })

  test('an unsafe or missing folder, a file or a link out of the repo is asked again with why on top', async () => {
    const bad = ['../x', '/etc', 'a b', '${HOME}', 'missing', 'apps/readme.md', 'apps/linked']
    for (const answer of bad) {
      const run = await drivenWith(launchAt(), ['other', answer, 'apps/web'], launchCalls(memIo(FOLDER_WORLD, []).io))
      expect(run.state.draft.launchStart).toEqual(APPS_WEB)
      const problem = ['missing', 'apps/readme.md', 'apps/linked'].includes(answer) ? NOT_A_FOLDER : UNSAFE_FOLDER
      expect(run.outputs).toEqual([])
      expect(run.asked).toEqual([
        LAUNCH_ASKED,
        DIR_ASKED,
        `${cannotUse(answer, problem)}\n${DIR_ASKED}`,
      ])
    }
  })

  test('a folder reached through a linked parent that leaves the repo is refused, and asked again', async () => {
    const port = memIo(FOLDER_WORLD, [])
    const outside: PortStat = { kind: 'dir', size: 0, isLink: false, realPath: '/elsewhere/vendor/ui' }
    const io = withStat(port, '/repo/vendor/ui', outside)
    const run = await drivenWith(launchAt(), ['other', 'vendor/ui', 'apps/web'], launchCalls(io))
    expect(run.state.draft.launchStart).toEqual(APPS_WEB)
    expect(run.outputs).toEqual([])
    expect(run.asked).toEqual([
      LAUNCH_ASKED,
      DIR_ASKED,
      `${cannotUse('vendor/ui', NOT_A_FOLDER)}\n${DIR_ASKED}`,
    ])
  })

  test('a folder whose stat has no real path is refused, and asked again', async () => {
    const port = memIo(FOLDER_WORLD, [])
    const unresolved: PortStat = { kind: 'dir', size: 0, isLink: false }
    const io = withStat(port, '/repo/apps/unresolved', unresolved)
    const run = await drivenWith(launchAt(), ['other', 'apps/unresolved', 'apps/web'], launchCalls(io))
    expect(run.state.draft.launchStart).toEqual(APPS_WEB)
    expect(run.outputs).toEqual([])
    expect(run.asked).toEqual([
      LAUNCH_ASKED,
      DIR_ASKED,
      `${cannotUse('apps/unresolved', NOT_A_FOLDER)}\n${DIR_ASKED}`,
    ])
  })

  test('a folder whose real path lies inside the repo is still chosen', async () => {
    const inside: PortStat = { kind: 'dir', size: 0, isLink: false, realPath: '/repo/packages/api' }
    const io = withStat(memIo(FOLDER_WORLD, []), '/repo/packages/api', inside)
    const run = await drivenWith(launchAt(), ['other', 'packages/api'], launchCalls(io))
    expect(run.state.draft.launchStart).toEqual({ kind: 'dir', path: 'packages/api' })
    expect(run.asked).toEqual([LAUNCH_ASKED, DIR_ASKED])
    expect(run.outputs).toEqual([])
  })

  test('a refused folder is shown cleaned and capped in the line that says why', async () => {
    const answer = `a${BIDI_OVERRIDE} ${'x'.repeat(200)}`
    const run = await drivenWith(launchAt(), ['other', answer, 'apps/web'], launchCalls(memIo(FOLDER_WORLD, []).io))
    expect(run.asked[2]).toBe(`${cannotUse(`a ${'x'.repeat(107)}…`, UNSAFE_FOLDER)}\n${DIR_ASKED}`)
    expect(run.outputs).toEqual([])
  })

  test(`${MAX_ASKS} unusable folders cancel with the rounds reason, and nothing was chosen`, async () => {
    const answers = ['other', '../a', 'missing', '/b', 'apps/web']
    const run = await drivenWith(launchAt(), answers, launchCalls(memIo(FOLDER_WORLD, []).io))
    expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(LAUNCH_DIR_ROUNDS_REASON) })
    expect(run.asked.slice(1)).toEqual([
      DIR_ASKED,
      `${cannotUse('../a', UNSAFE_FOLDER)}\n${DIR_ASKED}`,
      `${cannotUse('missing', NOT_A_FOLDER)}\n${DIR_ASKED}`,
    ])
    expect(run.outputs).toEqual([{ kind: 'log', text: LAUNCH_DIR_ROUNDS_REASON }])
    expect(LAUNCH_DIR_ROUNDS_REASON).toBe('No usable launcher folder after 3 tries: nothing was chosen.')
  })

  test('Cancel init or a dismissal at the folder question cancels with its reason', async () => {
    for (const answers of [['other', 'Cancel init'], ['other', ' cancel INIT '], ['other']]) {
      const run = await drivenWith(launchAt(), answers, launchCalls(memIo(FOLDER_WORLD, []).io))
      expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(LAUNCH_DIR_CANCELLED_REASON) })
    }
    expect(LAUNCH_DIR_CANCELLED_REASON).toBe('The launcher folder question was dismissed or cancelled.')
  })

  test('a dismissed or never answered start question cancels with its reason', async () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], LAUNCH_START_DISMISSED_REASON],
      [['somewhere', 'else', 'again'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = driven(launchAt(), answers)
      expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(reason) })
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
    const calls = launchCalls(memIo(FOLDER_WORLD, []).io)
    const run = await drivenWith(launchAt(), ['other', '../a', 'missing', 'apps/web'], calls)
    expect(run.state.draft.launchStart).toEqual(APPS_WEB)
    expect(run.asked).toEqual([
      LAUNCH_ASKED,
      DIR_ASKED,
      `${cannotUse('../a', UNSAFE_FOLDER)}\n${DIR_ASKED}`,
      `${cannotUse('missing', NOT_A_FOLDER)}\n${DIR_ASKED}`,
    ])
    expect(run.outputs).toEqual([])
    const capped = await drivenWith(launchAt(), ['other', '../a', 'missing', '/b'], calls)
    expect(capped.state.effect).toEqual({ kind: 'end', reply: cancelledReply(LAUNCH_DIR_ROUNDS_REASON) })
  })
})

describe('the launch stage (D-230)', () => {
  /** The launch stage entered for LAUNCH_TEAM in the fixture repo: the launcher start question out. */
  const entered = launchStage.enter(stateAt('launch', { locations: DEFAULT_LOCATIONS, roles: LAUNCH_TEAM }))

  test('launchStage asks the launcher start question with the role ids; the open question is that ask', () => {
    const spec = { options: LAUNCH_START_OPTIONS, header: 'Launch', context: LAUNCH_CONTEXT }
    const ask = { question: LAUNCH_ASKED, spec }
    expect(entered.effect).toEqual({ kind: 'ask', ...ask })
    expect(entered.openQuestion).toEqual(ask)
  })

  test('the folder question lists the folders with code of the repo scan as its own context (D-236)', () => {
    const repo = repoScan({ codeDirs: ['apps', 'packages'] })
    const gathered = { ...wholeDraft().gathered, repo }
    const state = launchStage.enter(stateAt('launch', wholeDraft({ roles: LAUNCH_TEAM, gathered })))
    const asked = nextStage(state, { kind: 'answer', text: 'other' })
    expect(asked.openQuestion?.spec.context).toEqual({
      title: 'Launch folder',
      lines: ['Folders with code in this repo:', '  apps/', '  packages/'],
      kind: 'launch-dir',
    })
  })

  test('another folder asks for it; the folder check is an io effect, and a repo folder ends the stage', () => {
    const asked = nextStage(entered, { kind: 'answer', text: 'Another folder in this repo' })
    const spec = { options: ['Cancel init'], header: 'Launch dir', context: NO_DIRS_CONTEXT }
    expect(asked.openQuestion).toEqual({ question: DIR_ASKED, spec })
    const checking = nextStage(asked, { kind: 'answer', text: 'apps/web/' })
    const call = { id: 'launch-dir-check', root: '/repo', path: 'apps/web' }
    expect([checking.effect, checking.openQuestion]).toEqual([{ kind: 'io', call }, null])
    const done = nextStage(checking, { kind: 'io', result: { id: 'launch-dir-check', result: true } })
    expect(done.draft.launchStart).toEqual({ kind: 'dir', path: 'apps/web' })
  })

  test('a folder the check refuses is asked again with why on top, and an unsafe one is never checked', () => {
    const asked = nextStage(entered, { kind: 'answer', text: 'other' })
    const checking = nextStage(asked, { kind: 'answer', text: 'missing' })
    const refused = nextStage(checking, { kind: 'io', result: { id: 'launch-dir-check', result: false } })
    expect(refused.openQuestion?.question).toBe(`${cannotUse('missing', NOT_A_FOLDER)}\n${DIR_ASKED}`)
    const unsafe = nextStage(refused, { kind: 'answer', text: '../a' })
    expect(unsafe.effect.kind).toBe('ask')
    expect(unsafe.openQuestion?.question).toBe(`${cannotUse('../a', UNSAFE_FOLDER)}\n${DIR_ASKED}`)
  })
})
