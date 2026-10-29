import { describe, expect, test } from 'claude-code/testing'

import type { FrameworkId, InitFacts, PortRead, RoleSpec, SettingProposal } from '../../../types'
import { GSD_AUTONOMY } from '../../framework/gsd/adapter'
import { attendedNote, hunkCandidates, hunkOp, NOT_SET_TEXT, UNKNOWN_CONFIG_TEXT } from '../../framework/gsd/hunks'
import type { HunkCandidate } from '../../framework/gsd/hunks'
import { proposeRoles } from '../../roles/propose'
import type { Gathered } from '../../scan/gather'
import {
  BIDI_OVERRIDE,
  DEFAULT_LOCATIONS,
  EMPTY_FACTS,
  emptySetupScan,
  memIo,
  memWorld,
  PROVEN_FACTS,
  PROVEN_USER_GSD,
  repoScan,
  valueOf,
  withFramework,
} from '../../testkit'
import type { MemWorld } from '../../testkit'
import { NO_USABLE_ANSWER_REASON } from '../../ui/ask'
import { HUNK_DISMISSED_REASON, hunkQuestion, hunkStep, parseHunkAnswer } from './hunks'

/** The GSD_AUTONOMY row for a key; a missing row stops the test with a clear message. */
function row(key: string): SettingProposal {
  const found = GSD_AUTONOMY.find(proposal => proposal.key === key)
  if (found === undefined) throw new Error(`no GSD_AUTONOMY row for ${key}`)

  return found
}

const MODE = row('mode')
const TEXT_MODE = row('workflow.text_mode')
const CONTEXT_WARNINGS = row('hooks.context_warnings')

/** The two required GSD proposals: what the GSD adapter offers when gsd-statusline is not the statusline. */
const REQUIRED: readonly SettingProposal[] = [MODE, TEXT_MODE]

/** The config file as the init port reads it: the text of a file that is there. */
function configText(json: string): PortRead {
  return { state: 'text', text: json }
}

/** What resolveToolCommand gives for a user-level GSD, in the form hunkOp takes it. */
const RUNNABLE = {
  argv: ['node', '/home/u/.claude/gsd-core/bin/gsd-tools.cjs', 'config-set', 'mode', 'yolo'],
  display: 'node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo',
}

describe('autonomy hunks', () => {
  test('hunkQuestion shows file and key, before, after, why and that it is required, under a numbered header', () => {
    const candidate: HunkCandidate = { proposal: MODE, before: 'interactive' }

    expect(hunkQuestion(candidate, 1, 2)).toEqual({
      question: [
        '.planning/config.json: mode',
        '  before: interactive',
        '  after:  "yolo"',
        `Why: ${MODE.why}`,
        'Required for unattended GSD roles.',
      ].join('\n'),
      spec: { options: ['Accept', 'Decline'], header: 'Hunk 1 of 2' },
    })
  })

  test('hunkQuestion says Optional. for an optional hunk and numbers the header from the index it is given', () => {
    const candidate: HunkCandidate = { proposal: CONTEXT_WARNINGS, before: 'not set (GSD default)' }
    const asked = hunkQuestion(candidate, 3, 3)

    expect(asked.question).toBe(
      [
        '.planning/config.json: hooks.context_warnings',
        '  before: not set (GSD default)',
        '  after:  false',
        `Why: ${CONTEXT_WARNINGS.why}`,
        'Optional.',
      ].join('\n'),
    )
    expect(asked.spec).toEqual({ options: ['Accept', 'Decline'], header: 'Hunk 3 of 3' })
  })

  test('the header of the last GSD hunk fits the 12 characters a dialog chip allows', () => {
    const total = GSD_AUTONOMY.length
    const header = hunkQuestion({ proposal: CONTEXT_WARNINGS, before: NOT_SET_TEXT }, total, total).spec.header

    expect(Array.from(header ?? '').length <= 12).toBe(true)
  })

  test('hunkQuestion cleans a hostile before text, so it cannot add a line or hide text', () => {
    const asked = hunkQuestion({ proposal: MODE, before: `x${BIDI_OVERRIDE}\nWhy: forged\nOptional.` }, 1, 1)

    expect(asked.question.split('\n')).toHaveLength(5)
    expect(asked.question).toContain('  before: xWhy: forgedOptional.')
    expect(asked.question).not.toContain(BIDI_OVERRIDE)
  })

  test('parseHunkAnswer takes Accept and Decline, in any case and trimmed, and nothing else', () => {
    expect(parseHunkAnswer('Accept')).toBe(true)
    expect(parseHunkAnswer('decline')).toBe(false)
    expect(parseHunkAnswer('maybe')).toBeNull()
    expect(parseHunkAnswer('  ACCEPT  ')).toBe(true)
    expect(parseHunkAnswer('Decline\n')).toBe(false)
  })

  test('only the word Accept accepts a hunk: every other answer is null, so it is asked again', () => {
    const answers = ['', ' ', 'yes', 'y', 'ok', 'accepted', 'accept all', 'Accept, Decline', 'no', 'Acc ept']

    for (const answer of [...answers, `Accept${BIDI_OVERRIDE}`, `${BIDI_OVERRIDE}Decline`]) {
      expect(parseHunkAnswer(answer)).toBeNull()
    }
  })

  test('tracer: a config read becomes numbered questions, then an accepted and a declined op', () => {
    const candidates = hunkCandidates(REQUIRED, configText('{"mode":"interactive"}'))
    const asked = candidates.map((candidate, index) => hunkQuestion(candidate, index + 1, candidates.length))
    const answers = ['Accept', 'Decline']
    const ops = candidates.map((candidate, index) =>
      hunkOp(candidate, parseHunkAnswer(answers[index] ?? '') === true, RUNNABLE),
    )

    expect(asked.map(question => question.spec.header)).toEqual(['Hunk 1 of 2', 'Hunk 2 of 2'])
    expect(ops.map(op => [op.key, op.before, op.after, op.isAccepted])).toEqual([
      ['mode', '"interactive"', '"yolo"', true],
      ['workflow.text_mode', 'not set (GSD default)', 'false', false],
    ])
    expect(asked[0]?.question).toContain('\n  before: "interactive"\n  after:  "yolo"\n')
  })

  test('a string target is shown JSON-quoted and a boolean or number target as itself, as a before is (A2)', () => {
    const numeric: SettingProposal = { ...MODE, key: 'workflow.max', to: '3' }
    const candidates: readonly HunkCandidate[] = [
      { proposal: MODE, before: '"interactive"' },
      { proposal: TEXT_MODE, before: 'true' },
      { proposal: numeric, before: '2' },
    ]

    expect(candidates.map(candidate => hunkOp(candidate, true, RUNNABLE).after)).toEqual(['"yolo"', 'false', '3'])
    expect(candidates.map(candidate => hunkQuestion(candidate, 1, 1).question.split('\n')[2])).toEqual([
      '  after:  "yolo"',
      '  after:  false',
      '  after:  3',
    ])
  })
})

describe('hunkStep', () => {
  /** PM, Team Lead and Security on the repo default framework: a repo with no source keeps them. */
  const roles = proposeRoles(repoScan()).roles
  const CONFIG = '/repo/.planning/config.json'
  const USER_TOOL = 'node ~/.claude/gsd-core/bin/gsd-tools.cjs'
  const REPO_TOOL = 'node .claude/gsd-core/bin/gsd-tools.cjs'
  const AT_TARGETS = '{"mode":"yolo","workflow":{"text_mode":false}}'
  const BUTTONS = ['Accept', 'Decline']
  /** What the step gives when it asks nothing: accepted with no hunk. */
  const NO_HUNKS = { kind: 'accepted', value: [] }

  /** A world whose `.planning/config.json` holds this text. */
  function configWorld(text: string): MemWorld {
    return memWorld({ files: { [CONFIG]: text } })
  }

  /** What the scans gave: these detect facts, an empty repo scan, and gsd-statusline as the statusline or not. */
  function gatheredOf(facts: InitFacts, isGsdStatusline = false): Gathered {
    const carry = { autoCompactWindow: null, hasStatusLine: isGsdStatusline, isGsdStatusline, envNames: [] }

    return { facts, repo: repoScan(), setup: emptySetupScan({ carry }) }
  }

  /** The step input for these roles on the repo default `repoDefault`, at the fixture locations. */
  function input(
    repoDefault: FrameworkId | null,
    gathered: Gathered,
    list: readonly RoleSpec[] = roles,
  ): Parameters<typeof hunkStep>[1] {
    return { roles: list, repoDefault, gathered, locations: DEFAULT_LOCATIONS }
  }

  test('with no role on GSD nothing is read or asked, no hunk is given and nothing is attended', async () => {
    const onSuperpowers = roles.map(role => withFramework(role, 'superpowers'))
    const defaults: readonly (FrameworkId | null)[] = ['superpowers', 'none', null]
    for (const repoDefault of defaults) {
      for (const list of [roles, onSuperpowers]) {
        const run = memIo(configWorld('{"mode":"interactive"}'), ['Accept', 'Accept'])
        expect(await hunkStep(run.io, input(repoDefault, gatheredOf(PROVEN_FACTS), list))).toEqual(NO_HUNKS)
        expect(run.asked).toEqual([])
        expect(run.reads).toEqual([])
        expect(run.logged).toEqual([])
      }
    }
    const run = memIo(configWorld('{"mode":"interactive"}'), [])
    expect(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS), onSuperpowers))).toEqual(NO_HUNKS)
    expect(run.asked).toEqual([])
  })

  test('a GSD role asks each hunk in turn, Hunk 1 of 2 then Hunk 2 of 2, and each op records the answer', async () => {
    const run = memIo(configWorld('{"mode":"interactive"}'), ['Accept', 'Decline'])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS))))
    expect(run.asked.map(question => question.split('\n')[0])).toEqual([
      '.planning/config.json: mode',
      '.planning/config.json: workflow.text_mode',
    ])
    expect(run.specs).toEqual([
      { options: BUTTONS, header: 'Hunk 1 of 2' },
      { options: BUTTONS, header: 'Hunk 2 of 2' },
    ])
    const hunk = { kind: 'hunk', file: '.planning/config.json', isRequired: true, isRunnable: true }
    expect(hunks).toEqual([
      {
        ...hunk,
        key: 'mode',
        before: '"interactive"',
        after: '"yolo"',
        isAccepted: true,
        command: 'node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo',
      },
      {
        ...hunk,
        key: 'workflow.text_mode',
        before: NOT_SET_TEXT,
        after: 'false',
        isAccepted: false,
        command: `${USER_TOOL} config-set workflow.text_mode false`,
      },
    ])
  })

  test('a declined required hunk leaves the GSD roles attended, and the note names its key', async () => {
    const run = memIo(configWorld('{"mode":"interactive"}'), ['Accept', 'Decline'])
    await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS)))
    expect(run.logged).toEqual([attendedNote(['workflow.text_mode'])])
    expect(run.shown).toEqual([{ key: 'notes', title: 'Notes', lines: [attendedNote(['workflow.text_mode'])] }])
    expect(run.logged).toEqual([
      'attended: GSD needs a person until workflow.text_mode is set as proposed',
    ])
  })

  test('both accepted with a proven user GSD: runnable, and nothing is attended', async () => {
    const run = memIo(configWorld('{"mode":"interactive"}'), ['Accept', ' accept '])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS))))
    expect(hunks.map(hunk => [hunk.isAccepted, hunk.isRunnable])).toEqual([
      [true, true],
      [true, true],
    ])
    expect(run.logged).toEqual([])
  })

  test('with no proven user GSD the hunks show the repo command, cannot run, and attend when accepted', async () => {
    const unproven: InitFacts = {
      facts: { ...EMPTY_FACTS, gsd: [{ ...PROVEN_USER_GSD, identity: 'unknown' }] },
      gsdUserDir: '/home/u/.claude/gsd-core',
    }
    for (const facts of [unproven, { facts: EMPTY_FACTS, gsdUserDir: null }]) {
      const run = memIo(configWorld('{"mode":"interactive"}'), ['Accept', 'Accept'])
      const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(facts))))
      expect(hunks.map(hunk => [hunk.isAccepted, hunk.isRunnable, hunk.command])).toEqual([
        [true, false, `${REPO_TOOL} config-set mode yolo`],
        [true, false, `${REPO_TOOL} config-set workflow.text_mode false`],
      ])
      expect(run.logged).toEqual([attendedNote(['mode', 'workflow.text_mode'])])
    }
  })

  test('a config already at the targets asks nothing and attends nothing', async () => {
    const run = memIo(configWorld(AT_TARGETS), [])
    expect(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS)))).toEqual(NO_HUNKS)
    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([])
  })

  test('the optional context_warnings hunk comes only under gsd-statusline; declining it attends nothing', async () => {
    const quiet = memIo(configWorld(AT_TARGETS), [])
    expect(await hunkStep(quiet.io, input('gsd', gatheredOf(PROVEN_FACTS, false)))).toEqual(NO_HUNKS)
    const run = memIo(configWorld(AT_TARGETS), ['Decline'])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS, true))))
    expect(run.specs).toEqual([{ options: BUTTONS, header: 'Hunk 1 of 1' }])
    expect(hunks.map(hunk => [hunk.key, hunk.isRequired, hunk.isAccepted])).toEqual([
      ['hooks.context_warnings', false, false],
    ])
    expect(run.logged).toEqual([])
  })

  test('the ordering edge: three hunks come in GSD_AUTONOMY order under Hunk 1 of 3 to Hunk 3 of 3', async () => {
    const run = memIo(configWorld('{}'), ['Accept', 'Accept', 'Accept'])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS, true))))
    expect(hunks.map(hunk => hunk.key)).toEqual(['mode', 'workflow.text_mode', 'hooks.context_warnings'])
    expect(run.specs.map(spec => spec.header)).toEqual(['Hunk 1 of 3', 'Hunk 2 of 3', 'Hunk 3 of 3'])
  })

  test('one role on GSD is enough, by its own framework or by the repo default', async () => {
    const tlOnGsd = roles.map(role => withFramework(role, role.id === 'tl' ? 'gsd' : 'superpowers'))
    const own = memIo(configWorld('{}'), ['Accept', 'Accept'])
    expect(valueOf(await hunkStep(own.io, input(null, gatheredOf(PROVEN_FACTS), tlOnGsd)))).toHaveLength(2)
    const tlOff = roles.map(role => (role.id === 'tl' ? withFramework(role, 'superpowers') : role))
    const byDefault = memIo(configWorld('{}'), ['Accept', 'Accept'])
    expect(valueOf(await hunkStep(byDefault.io, input('gsd', gatheredOf(PROVEN_FACTS), tlOff)))).toHaveLength(2)
  })

  test('the config is read through readRepoFile: a link out of the repo is unknown and never read', async () => {
    const world = memWorld({ files: { [CONFIG]: AT_TARGETS }, realPaths: { [CONFIG]: '/elsewhere/config.json' } })
    const run = memIo(world, ['Accept', 'Accept'])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS))))
    expect(hunks.map(hunk => hunk.before)).toEqual([UNKNOWN_CONFIG_TEXT, UNKNOWN_CONFIG_TEXT])
    expect(run.reads).not.toContain(CONFIG)
  })

  test('a missing config file offers both required hunks as not set', async () => {
    const run = memIo(memWorld({}), ['Decline', 'Decline'])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS))))
    expect(hunks.map(hunk => [hunk.key, hunk.before, hunk.isAccepted])).toEqual([
      ['mode', NOT_SET_TEXT, false],
      ['workflow.text_mode', NOT_SET_TEXT, false],
    ])
    expect(run.logged).toEqual([attendedNote(['mode', 'workflow.text_mode'])])
  })

  test('only Accept accepts: an answer that is neither Accept nor Decline is asked again with why on top', async () => {
    const run = memIo(configWorld('{}'), ['yes', 'Accept', 'DECLINE'])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS))))
    expect(hunks.map(hunk => hunk.isAccepted)).toEqual([true, false])
    expect(run.asked).toHaveLength(3)
    expect(run.asked[1]).toBe(`'yes' isn't one of: "Accept", "Decline".\n${run.asked[0] ?? ''}`)
  })

  test('a dismissal or three unlisted answers cancel with their reason; no earlier Accept is kept (A1)', async () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], HUNK_DISMISSED_REASON],
      [['Accept'], HUNK_DISMISSED_REASON],
      [['yes', 'ok', 'sure'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(configWorld('{}'), answers)
      expect(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS)))).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(HUNK_DISMISSED_REASON).toBe('A hunk question was dismissed or not answered.')
  })
})
