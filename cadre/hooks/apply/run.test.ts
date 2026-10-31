import { describe, expect, test } from 'claude-code/testing'

import type { DesiredFile } from '../../types'
import { sha256Hex } from '../core/hash'
import { attendedNote } from '../framework/gsd/hunks'
import { untrackedPartsWarning } from '../generate/gittrack'
import { GIT_COMMON_DIR_ARGV } from '../git/common-dir'
import { planWithManifest } from '../plan/plan'
import { DEFAULT_LOCATIONS, hostWorld, memHost, memIo, memWorld, outcomeOf, USER_DIR_LISTED } from '../testkit'
import { hunkFailureLine } from './hunks'
import type { HunkRun } from './hunks'
import { improverArgv } from './improver'
import type { BuiltFile } from './improver'
import type { ApplyInput, ApplyStep } from './private'
import {
  APPLIED_NONE_NOTE,
  appliedLines,
  MANIFEST_SKIPPED_NOTE,
  NEXT_STEP_NOTE,
  roleFoldersOf,
  writeImproved,
  writeSteps,
  writeWithImprover,
} from './run'
import type { ApplyOutcome } from './run'
import { applySteps } from './steps'

/** BE's built CLAUDE.md, repo-relative, as the plan and the reply name it. */
const BE_CLAUDE_MD = '.cadre/be/CLAUDE.md'

/** BE's built CLAUDE.md as an absolute path under the fixture repo /repo. */
const BE_CLAUDE_MD_PATH = `/repo/${BE_CLAUDE_MD}`

/** The text apply writes to BE's built CLAUDE.md: its header line, then one repo part. */
const BE_BUILT = '<!-- cadre: instructions for role be -->\n\n# Rules\nRun the tests before a commit.\n'

/** The one desired file of the fixture apply: BE's built CLAUDE.md. */
const DESIRED: readonly DesiredFile[] = [{ path: BE_CLAUDE_MD, content: BE_BUILT, mode: 'file' }]

/** BE's built CLAUDE.md as the improver pass gets it, watching nothing else and with no flags. */
const BE_BUILT_FILE: BuiltFile = {
  path: BE_CLAUDE_MD_PATH,
  repoPath: BE_CLAUDE_MD,
  text: BE_BUILT,
  watched: [],
  runFlags: [],
}

/** The apply input of DESIRED planned over an empty repo with no manifest: no conflict and no private file. */
async function fixtureInput(): Promise<ApplyInput> {
  const planned = await planWithManifest({
    desired: DESIRED,
    disk: new Map(),
    manifest: null,
    manifestState: 'absent',
    carried: [],
    gitignore: null,
    hunks: [],
    cadreVersion: '0.2.0',
  })

  return { ...planned, desired: DESIRED, gitignore: null, choices: new Map() }
}

describe('writeWithImprover', () => {
  test('with no built file offered it writes the steps as writeSteps does, and runs no improver', async () => {
    const input = await fixtureInput()
    const steps = await applySteps(input)
    const allowed: ReadonlySet<string> = new Set()
    const helper = memHost(hostWorld({}))
    const direct = memHost(hostWorld({}))
    const args = { locations: DEFAULT_LOCATIONS, input, steps, offered: [], allowed }
    const outcome = await writeWithImprover(memIo(memWorld({}), {}).io, helper.io, args)

    expect(outcome).toEqual(await writeSteps(memIo(memWorld({}), {}).io, direct.io, DEFAULT_LOCATIONS, steps, allowed))
    expect(helper.writes).toEqual(direct.writes)
    expect(helper.calls.filter(call => call.argv[0] === 'claude')).toEqual([])
  })

  test('with a built file offered it runs the improver pass as writeImproved does', async () => {
    const input = await fixtureInput()
    const steps = await applySteps(input)
    const world = memWorld({ files: { [BE_CLAUDE_MD_PATH]: BE_BUILT } })
    const helper = memHost(hostWorld({}))
    const direct = memHost(hostWorld({}))
    const args = { locations: DEFAULT_LOCATIONS, input, steps, offered: [BE_BUILT_FILE], allowed: new Set<string>() }
    const outcome = await writeWithImprover(memIo(world, {}).io, helper.io, args)

    expect(outcome).toEqual(await writeImproved(memIo(world, {}).io, direct.io, args))
    expect(helper.writes).toEqual(direct.writes)
    expect(helper.calls.filter(call => call.argv[0] === 'claude').map(call => call.argv)).toEqual([
      improverArgv(BE_CLAUDE_MD_PATH),
    ])
  })
})

/** BE's role memory folder in the fixture repo (D-140 q2-a): `<userDir>/cadre/<repo>-<hash8>/be`. */
const BE_DIR = '/home/u/.claude/cadre/repo-1a2b3c4d/be'

/** BE's private text file, at its absolute path in its role memory folder. */
const BE_TEXT_FILE = `${BE_DIR}/instructions/CLAUDE.md`

/** BE's private text file as a reply shows it, from the home folder. */
const BE_TEXT_SHOWN = '~/.claude/cadre/repo-1a2b3c4d/be/instructions/CLAUDE.md'

/** A repo file whose repo-relative path is the very text a reply shows for BE's private text file (D-242). */
const LOOKALIKE_PATH = `/repo/${BE_TEXT_SHOWN}`

/** The writes of the D-242 specs: the lookalike repo file, then BE's private text file in its own private step. */
const COLLIDING_STEPS: readonly ApplyStep[] = [
  { kind: 'write', path: BE_TEXT_SHOWN, text: 'repo\n' },
  { kind: 'private', path: BE_DIR, files: [{ path: BE_TEXT_FILE, text: 'private\n' }] },
]

/** The lookalike repo file as the improver pass would get it. */
const LOOKALIKE_FILE: BuiltFile = {
  path: LOOKALIKE_PATH,
  repoPath: BE_TEXT_SHOWN,
  text: 'repo\n',
  watched: [],
  runFlags: [],
}

/** BE's private text file as the improver pass would get it: outside the repo, so not repo-relative. */
const BE_PRIVATE_FILE: BuiltFile = { path: BE_TEXT_FILE, repoPath: null, text: 'private\n', watched: [], runFlags: [] }

/** Runs writeImproved over COLLIDING_STEPS, offering `offered`, with the host failing the writes of `writeFails`. */
async function collidingRun(
  offered: readonly BuiltFile[],
  writeFails: readonly string[] = [],
): Promise<ApplyOutcome> {
  const io = memIo(memWorld({ dirs: USER_DIR_LISTED }), {}).io
  const host = memHost(hostWorld({ writeFails }))
  const args = { input: await fixtureInput(), steps: COLLIDING_STEPS, offered, allowed: new Set([BE_TEXT_FILE]) }

  return writeImproved(io, host.io, { locations: DEFAULT_LOCATIONS, ...args })
}

describe('written set by absolute path and kind (D-242)', () => {
  test('a written private file is offered by path and kind, and counts beside a repo file shown the same', async () => {
    const outcome = await collidingRun([BE_PRIVATE_FILE])

    expect(outcome.improved).toEqual({ changed: 0, total: 1 })
    expect(outcome.written.filter(path => path === BE_TEXT_SHOWN)).toEqual([BE_TEXT_SHOWN, BE_TEXT_SHOWN])
  })

  test('a repo file whose write failed is not offered when a private file shown the same was written', async () => {
    const outcome = await collidingRun([LOOKALIKE_FILE], [LOOKALIKE_PATH])

    expect(outcome.improved).toBeNull()
  })

  test('a private file whose write failed is not offered when a repo file shown the same was written', async () => {
    const outcome = await collidingRun([BE_PRIVATE_FILE], [BE_TEXT_FILE])

    expect(outcome.improved).toBeNull()
  })
})

/** The refusal writeProblem gives for the launcher of BE. */
const BE_REFUSED = 'refused to write .cadre/bin/be: it or a folder above it is a link, or not inside the repo'

/** The line for the launcher of BE when its write was refused or failed, so no chmod ran (RESEARCH 3.2). */
const BE_NOT_EXECUTABLE = 'warning: .cadre/bin/be was not made executable: its write was refused or failed'

describe('init apply (D-105)', () => {
  test('the apply notes are fixed', () => {
    const skipped = '.cadre/manifest.json was not written because a file above was not written: run /cadre init again.'
    expect(APPLIED_NONE_NOTE).toBe('Applied: nothing to write; every file is up to date.')
    expect(NEXT_STEP_NOTE).toBe('Next: run /cadre start <id> to launch a role.')
    expect(MANIFEST_SKIPPED_NOTE).toBe(skipped)
  })

  test('appliedLines: the count, one warning line per problem in a fixed order, the next step last', () => {
    const run: HunkRun = { key: 'mode', file: '.planning/config.json', argv: ['node'], display: 'node ~/x mode yolo' }
    const outcome = outcomeOf({
      written: ['.cadre/pm/ROLE.md'],
      failed: ['.cadre/be/ROLE.md'],
      refused: [BE_REFUSED],
      notExecutable: ['.cadre/bin/pm'],
      chmodRefusals: ['.cadre/bin/be was not made executable: its write was refused or failed'],
      hunkFailures: [run],
      attended: ['mode'],
      manifestSkipped: true,
    })
    expect(appliedLines(outcome)).toEqual([
      'Applied: wrote 1 file (0 executable).',
      `warning: ${BE_REFUSED}`,
      'warning: could not write .cadre/be/ROLE.md',
      BE_NOT_EXECUTABLE,
      'warning: could not make .cadre/bin/pm executable: run chmod 755 .cadre/bin/pm',
      `warning: ${hunkFailureLine(run)}`,
      `warning: ${attendedNote(['mode'])}`,
      `warning: ${MANIFEST_SKIPPED_NOTE}`,
      NEXT_STEP_NOTE,
    ])
    expect(appliedLines(outcomeOf())).toEqual([APPLIED_NONE_NOTE, NEXT_STEP_NOTE])
    expect(appliedLines(outcomeOf({ failed: ['.cadre/INDEX.md'] }))[0]).toBe('Applied: wrote 0 files (0 executable).')
  })

  test('appliedLines: the untracked-parts warnings come right after the install problems (02-GAPS-B2 M3)', () => {
    const untracked = untrackedPartsWarning('notes/local.md')
    const problems = { installProblems: ['install it by hand'], untrackedParts: [untracked] }
    const outcome = outcomeOf({ ...problems, manifestSkipped: true })
    expect(appliedLines(outcome)).toEqual([
      APPLIED_NONE_NOTE,
      'warning: install it by hand',
      `warning: ${untracked}`,
      `warning: ${MANIFEST_SKIPPED_NOTE}`,
      NEXT_STEP_NOTE,
    ])
  })
})

describe('roleFoldersOf (D-238)', () => {
  test('a relative or inside-repo CLAUDE_CONFIG_DIR names role folders under <home>/.claude', async () => {
    const git = { argv: GIT_COMMON_DIR_ARGV, result: { exitCode: 0, stdout: '/repo/.git\n', stderr: '' } }
    const slug = `repo-${(await sha256Hex('/repo/.git')).slice(0, 8)}`
    for (const configDir of ['.claude-alt', '/repo/.claude-alt']) {
      const host = memHost(hostWorld({ runs: [git] })).io
      const folderOf = await roleFoldersOf(memIo(memWorld({}), {}).io, host, { ...DEFAULT_LOCATIONS, configDir })

      expect(folderOf?.('be')).toBe(`/home/u/.claude/cadre/${slug}/be`)
    }
  })
})
