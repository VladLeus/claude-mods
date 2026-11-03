import { describe, expect, test } from 'claude-code/testing'

import type { FrameworkId, InitFacts, InitIo, PortRead, RoleSpec, SettingProposal } from '../../../types'
import { GSD_AUTONOMY } from '../../framework/gsd/adapter'
import { attendedNote, hunkCandidates, hunkOp, NOT_SET_TEXT, UNKNOWN_CONFIG_TEXT } from '../../framework/gsd/hunks'
import type { HunkCandidate } from '../../framework/gsd/hunks'
import { proposeRoles } from '../../roles/propose'
import type { Gathered } from '../../scan/gather'
import { MAX_READ_BYTES } from '../../scan/facts/normalize'
import { readRepoFile } from '../../scan/port-read'
import {
  BIDI_OVERRIDE,
  DEFAULT_LOCATIONS,
  drivenWith,
  EMPTY_FACTS,
  emptySetupScan,
  memIo,
  memWorld,
  PROVEN_FACTS,
  PROVEN_USER_GSD,
  repoScan,
  stateAt,
  wholeDraft,
  withFramework,
} from '../../testkit'
import type { Driven, MemWorld } from '../../testkit'
import { NO_USABLE_ANSWER_REASON } from '../../ui/ask'
import { nextStage } from '../machine'
import { cancelledReply } from '../replies'
import type { IoCall, IoResult } from '../state'
import { HUNK_DISMISSED_REASON, hunkQuestion, hunksStage, parseHunkAnswer } from './hunks'

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

  test('a hunk question has no context of its own, so every surface asks its full text (D-255)', () => {
    expect(hunkQuestion({ proposal: MODE, before: 'interactive' }, 1, 2).spec.context).toBeUndefined()
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

/** The hunk stage's host operation as init/run performs it, through `io` (readRepoFile). */
function hunkCalls(io: InitIo): (call: IoCall) => Promise<IoResult> {
  return async call => {
    if (call.id !== 'read-repo-file') throw new Error(`the hunk stage does not set ${call.id}`)

    return { id: 'read-repo-file', result: await readRepoFile(io, call.root, call.path, call.maxBytes) }
  }
}

describe('hunkStep', () => {
  /** PM, Team Lead and Security on the repo default framework: a repo with no source keeps them. */
  const roles = proposeRoles(repoScan()).roles
  const CONFIG = '/repo/.planning/config.json'
  const USER_TOOL = 'node ~/.claude/gsd-core/bin/gsd-tools.cjs'
  const REPO_TOOL = 'node .claude/gsd-core/bin/gsd-tools.cjs'
  const AT_TARGETS = '{"mode":"yolo","workflow":{"text_mode":false}}'
  const BUTTONS = ['Accept', 'Decline']

  /** A world whose `.planning/config.json` holds this text. */
  function configWorld(text: string): MemWorld {
    return memWorld({ files: { [CONFIG]: text } })
  }

  /** What the scans gave: these detect facts, an empty repo scan, and gsd-statusline as the statusline or not. */
  function gatheredOf(facts: InitFacts, isGsdStatusline = false): Gathered {
    const carry = { autoCompactWindow: null, hasStatusLine: isGsdStatusline, isGsdStatusline, envNames: [] }

    return { facts, repo: repoScan(), setup: emptySetupScan({ carry }) }
  }

  /**
   * A drive through the hunk stage for these roles on the repo default `repoDefault`, at the fixture locations, with
   * `answers` to its questions and its config reads performed over a port on `world`; `reads` is what the port read.
   */
  async function hunkRun(
    world: MemWorld,
    repoDefault: FrameworkId | null,
    gathered: Gathered,
    answers: readonly string[],
    list: readonly RoleSpec[] = roles,
  ): Promise<Driven & { readonly reads: readonly string[] }> {
    const port = memIo(world, [])
    const state = hunksStage.enter(stateAt('hunks', wholeDraft({ roles: list, repoDefault, gathered })))
    const run = await drivenWith(state, answers, hunkCalls(port.io))

    return { ...run, reads: port.reads }
  }

  test('with no role on GSD nothing is read or asked, no hunk is given and nothing is attended', async () => {
    const onSuperpowers = roles.map(role => withFramework(role, 'superpowers'))
    const defaults: readonly (FrameworkId | null)[] = ['superpowers', 'none', null]
    for (const repoDefault of defaults) {
      for (const list of [roles, onSuperpowers]) {
        const world = configWorld('{"mode":"interactive"}')
        const run = await hunkRun(world, repoDefault, gatheredOf(PROVEN_FACTS), ['Accept', 'Accept'], list)
        expect(run.state.draft.hunks).toEqual([])
        expect([run.asked, run.calls, run.reads, run.outputs]).toEqual([[], [], [], []])
      }
    }
    const run = await hunkRun(configWorld('{"mode":"interactive"}'), 'gsd', gatheredOf(PROVEN_FACTS), [], onSuperpowers)
    expect([run.state.draft.hunks, run.asked]).toEqual([[], []])
  })

  test('a GSD role asks each hunk in turn, Hunk 1 of 2 then Hunk 2 of 2, and each op records the answer', async () => {
    const run = await hunkRun(configWorld('{"mode":"interactive"}'), 'gsd', gatheredOf(PROVEN_FACTS), BUTTONS)
    expect(run.asked.map(question => question.split('\n')[0])).toEqual([
      '.planning/config.json: mode',
      '.planning/config.json: workflow.text_mode',
    ])
    expect(run.specs).toEqual([
      { options: BUTTONS, header: 'Hunk 1 of 2' },
      { options: BUTTONS, header: 'Hunk 2 of 2' },
    ])
    const hunk = { kind: 'hunk', file: '.planning/config.json', isRequired: true, isRunnable: true }
    expect(run.state.draft.hunks).toEqual([
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
    const run = await hunkRun(configWorld('{"mode":"interactive"}'), 'gsd', gatheredOf(PROVEN_FACTS), BUTTONS)
    expect(run.outputs).toEqual([{ kind: 'note', line: attendedNote(['workflow.text_mode']) }])
    expect(attendedNote(['workflow.text_mode'])).toBe(
      'attended: GSD needs a person until workflow.text_mode is set as proposed',
    )
  })

  test('both accepted with a proven user GSD: runnable, and nothing is attended', async () => {
    const answers = ['Accept', ' accept ']
    const run = await hunkRun(configWorld('{"mode":"interactive"}'), 'gsd', gatheredOf(PROVEN_FACTS), answers)
    expect(run.state.draft.hunks?.map(hunk => [hunk.isAccepted, hunk.isRunnable])).toEqual([
      [true, true],
      [true, true],
    ])
    expect(run.outputs).toEqual([])
  })

  test('with no proven user GSD the hunks show the repo command, cannot run, and attend when accepted', async () => {
    const unproven: InitFacts = {
      facts: { ...EMPTY_FACTS, gsd: [{ ...PROVEN_USER_GSD, identity: 'unknown' }] },
      gsdUserDir: '/home/u/.claude/gsd-core',
    }
    for (const facts of [unproven, { facts: EMPTY_FACTS, gsdUserDir: null }]) {
      const run = await hunkRun(configWorld('{"mode":"interactive"}'), 'gsd', gatheredOf(facts), ['Accept', 'Accept'])
      expect(run.state.draft.hunks?.map(hunk => [hunk.isAccepted, hunk.isRunnable, hunk.command])).toEqual([
        [true, false, `${REPO_TOOL} config-set mode yolo`],
        [true, false, `${REPO_TOOL} config-set workflow.text_mode false`],
      ])
      expect(run.outputs).toEqual([{ kind: 'note', line: attendedNote(['mode', 'workflow.text_mode']) }])
    }
  })

  test('a config already at the targets asks nothing and attends nothing', async () => {
    const run = await hunkRun(configWorld(AT_TARGETS), 'gsd', gatheredOf(PROVEN_FACTS), [])
    expect([run.state.draft.hunks, run.asked, run.outputs]).toEqual([[], [], []])
  })

  test('the optional context_warnings hunk comes only under gsd-statusline; declining it attends nothing', async () => {
    const quiet = await hunkRun(configWorld(AT_TARGETS), 'gsd', gatheredOf(PROVEN_FACTS, false), [])
    expect(quiet.state.draft.hunks).toEqual([])
    const run = await hunkRun(configWorld(AT_TARGETS), 'gsd', gatheredOf(PROVEN_FACTS, true), ['Decline'])
    expect(run.specs).toEqual([{ options: BUTTONS, header: 'Hunk 1 of 1' }])
    expect(run.state.draft.hunks?.map(hunk => [hunk.key, hunk.isRequired, hunk.isAccepted])).toEqual([
      ['hooks.context_warnings', false, false],
    ])
    expect(run.outputs).toEqual([])
  })

  test('the ordering edge: three hunks come in GSD_AUTONOMY order under Hunk 1 of 3 to Hunk 3 of 3', async () => {
    const answers = ['Accept', 'Accept', 'Accept']
    const run = await hunkRun(configWorld('{}'), 'gsd', gatheredOf(PROVEN_FACTS, true), answers)
    const keys = ['mode', 'workflow.text_mode', 'hooks.context_warnings']
    expect(run.state.draft.hunks?.map(hunk => hunk.key)).toEqual(keys)
    expect(run.specs.map(spec => spec.header)).toEqual(['Hunk 1 of 3', 'Hunk 2 of 3', 'Hunk 3 of 3'])
  })

  test('one role on GSD is enough, by its own framework or by the repo default', async () => {
    const tlOnGsd = roles.map(role => withFramework(role, role.id === 'tl' ? 'gsd' : 'superpowers'))
    const answers = ['Accept', 'Accept']
    const own = await hunkRun(configWorld('{}'), null, gatheredOf(PROVEN_FACTS), answers, tlOnGsd)
    expect(own.state.draft.hunks).toHaveLength(2)
    const tlOff = roles.map(role => (role.id === 'tl' ? withFramework(role, 'superpowers') : role))
    const byDefault = await hunkRun(configWorld('{}'), 'gsd', gatheredOf(PROVEN_FACTS), answers, tlOff)
    expect(byDefault.state.draft.hunks).toHaveLength(2)
  })

  test('the config is read through readRepoFile: a link out of the repo is unknown and never read', async () => {
    const world = memWorld({ files: { [CONFIG]: AT_TARGETS }, realPaths: { [CONFIG]: '/elsewhere/config.json' } })
    const run = await hunkRun(world, 'gsd', gatheredOf(PROVEN_FACTS), ['Accept', 'Accept'])
    expect(run.state.draft.hunks?.map(hunk => hunk.before)).toEqual([UNKNOWN_CONFIG_TEXT, UNKNOWN_CONFIG_TEXT])
    expect(run.reads).not.toContain(CONFIG)
  })

  test('a missing config file offers both required hunks as not set', async () => {
    const run = await hunkRun(memWorld({}), 'gsd', gatheredOf(PROVEN_FACTS), ['Decline', 'Decline'])
    expect(run.state.draft.hunks?.map(hunk => [hunk.key, hunk.before, hunk.isAccepted])).toEqual([
      ['mode', NOT_SET_TEXT, false],
      ['workflow.text_mode', NOT_SET_TEXT, false],
    ])
    expect(run.outputs).toEqual([{ kind: 'note', line: attendedNote(['mode', 'workflow.text_mode']) }])
  })

  test('only Accept accepts: an answer that is neither Accept nor Decline is asked again with why on top', async () => {
    const run = await hunkRun(configWorld('{}'), 'gsd', gatheredOf(PROVEN_FACTS), ['yes', 'Accept', 'DECLINE'])
    expect(run.state.draft.hunks?.map(hunk => hunk.isAccepted)).toEqual([true, false])
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
      const run = await hunkRun(configWorld('{}'), 'gsd', gatheredOf(PROVEN_FACTS), answers)
      expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(reason) })
      expect(run.state.draft.hunks).toEqual([])
      expect(run.outputs).toEqual([{ kind: 'log', text: reason }])
    }
    expect(HUNK_DISMISSED_REASON).toBe('A hunk question was dismissed or not answered.')
  })
})

describe('the hunk stage (D-230)', () => {
  /** PM, Team Lead and Security: a repo with no source keeps them. */
  const roles = proposeRoles(repoScan()).roles
  /** What the scans gave: proven GSD facts, an empty repo scan, and gsd-statusline not the statusline. */
  const gathered: Gathered = { facts: PROVEN_FACTS, repo: repoScan(), setup: emptySetupScan() }

  test('hunksStage reads the GSD config as an io effect, then asks Hunk 1 of 2; the open question is that ask', () => {
    const state = hunksStage.enter(stateAt('hunks', wholeDraft({ roles, repoDefault: 'gsd', gathered })))
    const call = { id: 'read-repo-file', root: DEFAULT_LOCATIONS.root, path: '.planning/config.json' }
    expect(state.effect).toEqual({ kind: 'io', call: { ...call, maxBytes: MAX_READ_BYTES } })
    expect(state.openQuestion).toBeNull()
    const read = configText('{"mode":"interactive"}')
    const asking = nextStage(state, { kind: 'io', result: { id: 'read-repo-file', result: read } })
    expect(asking.openQuestion?.spec).toEqual({ options: ['Accept', 'Decline'], header: 'Hunk 1 of 2' })
    expect(asking.openQuestion?.question.split('\n')[0]).toBe('.planning/config.json: mode')
  })

  test('with no role on GSD nothing is read or asked, and the stage ends with no hunks', () => {
    const state = hunksStage.enter(stateAt('hunks', wholeDraft({ roles, repoDefault: 'none', gathered })))
    expect([state.sub, state.openQuestion, state.draft.hunks, state.outputs]).toEqual([{ kind: 'done' }, null, [], []])
  })
})
