import { describe, expect, test } from 'claude-code/testing'
import type { HunkOp, PortRead, SettingProposal } from '../../../types'
import { BIDI_OVERRIDE } from '../../testkit'
import { GSD_AUTONOMY } from './adapter'
import {
  attendedNote,
  configValue,
  hunkCandidates,
  hunkOp,
  isAttendedFromConfig,
  isUnmetHunk,
  NOT_SET_TEXT,
  UNKNOWN_CONFIG_TEXT,
} from './hunks'
import type { HunkCandidate } from './hunks'

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

const ABSENT: PortRead = { state: 'absent' }
const UNREADABLE: PortRead = { state: 'unknown' }

/** Reads that give no usable config: a failed read, a file over the cap, text that is not JSON or not an object. */
const UNUSABLE: readonly PortRead[] = [
  UNREADABLE,
  { state: 'too-large', bytes: 300_000 },
  configText('not json'),
  configText(''),
  configText('[]'),
  configText('null'),
  configText('5'),
  configText('"yolo"'),
]

/** What resolveToolCommand gives for a user-level GSD, in the form hunkOp takes it. */
const RUNNABLE = {
  argv: ['node', '/home/u/.claude/gsd-core/bin/gsd-tools.cjs', 'config-set', 'mode', 'yolo'],
  display: 'node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo',
}

describe('autonomy hunks', () => {
  test('the two before texts for a missing key and for a config that could not be read are fixed', () => {
    expect(NOT_SET_TEXT).toBe('not set (GSD default)')
    expect(UNKNOWN_CONFIG_TEXT).toBe('unknown (could not read .planning/config.json)')
  })

  test('configValue reads a dotted key as text: a boolean, a string and a missing key', () => {
    const config = { mode: 'interactive', workflow: { text_mode: false } }

    expect(configValue(config, 'workflow.text_mode')).toEqual({ state: 'set', text: 'false' })
    expect(configValue(config, 'mode')).toEqual({ state: 'set', text: '"interactive"' })
    expect(configValue(config, 'hooks.context_warnings')).toEqual({ state: 'not-set' })
  })

  test('configValue reads a number as its digits and any other value as JSON', () => {
    const config = { a: { n: 3, none: null, list: [1, 'x'], object: { k: true } } }

    expect(configValue(config, 'a.n')).toEqual({ state: 'set', text: '3' })
    expect(configValue(config, 'a.none')).toEqual({ state: 'set', text: 'null' })
    expect(configValue(config, 'a.list')).toEqual({ state: 'set', text: '[1,"x"]' })
    expect(configValue(config, 'a.object')).toEqual({ state: 'set', text: '{"k":true}' })
  })

  test('configValue gives not set when a step is not a plain object', () => {
    const configs = [null, undefined, 'text', 5, true, [], { workflow: 'x' }, { workflow: null }, { workflow: [] }]

    for (const config of configs) {
      expect(configValue(config, 'workflow.text_mode')).toEqual({ state: 'not-set' })
    }
  })

  test('configValue never reads an inherited name as a key', () => {
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'workflow.constructor']) {
      expect(configValue({ workflow: {} }, key)).toEqual({ state: 'not-set' })
    }
  })

  test('configValue shows a string JSON-quoted, cleaned and capped at 80 code points', () => {
    const long = configValue({ mode: 'x'.repeat(200) }, 'mode')
    const hostile = configValue({ mode: `a${BIDI_OVERRIDE}b\nWhy: forged` }, 'mode')

    expect(long).toEqual({ state: 'set', text: `"${'x'.repeat(78)}…` })
    expect(hostile).toEqual({ state: 'set', text: '"ab\\nWhy: forged"' })
  })

  test('configValue caps the JSON of a list or an object at 80 code points', () => {
    const wide = configValue({ list: ['x'.repeat(200)] }, 'list')

    expect(wide).toEqual({ state: 'set', text: `["${'x'.repeat(77)}…` })
  })

  test('a config with mode interactive offers mode and the unset text_mode, in the order of the proposals', () => {
    expect(hunkCandidates(REQUIRED, configText('{"mode":"interactive"}'))).toEqual([
      { proposal: MODE, before: '"interactive"' },
      { proposal: TEXT_MODE, before: 'not set (GSD default)' },
    ])
  })

  test('every proposal it is given is offered, the optional context_warnings third (A5)', () => {
    expect(hunkCandidates(GSD_AUTONOMY, configText('{"mode":"interactive"}'))).toEqual([
      { proposal: MODE, before: '"interactive"' },
      { proposal: TEXT_MODE, before: 'not set (GSD default)' },
      { proposal: CONTEXT_WARNINGS, before: 'not set (GSD default)' },
    ])
  })

  test('context_warnings is offered only when it is given, since the adapter decides what to offer (A5)', () => {
    const config = configText('{"mode":"yolo","workflow":{"text_mode":false},"hooks":{"context_warnings":true}}')

    expect(hunkCandidates(REQUIRED, config)).toEqual([])
    expect(hunkCandidates(GSD_AUTONOMY, config)).toEqual([{ proposal: CONTEXT_WARNINGS, before: 'true' }])
  })

  test('a value that already equals its target is not offered, a boolean false included (adjacency edge)', () => {
    const atTargets = configText('{"mode":"yolo","workflow":{"text_mode":false}}')

    expect(hunkCandidates(REQUIRED, atTargets)).toEqual([])
    expect(hunkCandidates(GSD_AUTONOMY, atTargets)).toEqual([
      { proposal: CONTEXT_WARNINGS, before: 'not set (GSD default)' },
    ])
    expect(
      hunkCandidates(GSD_AUTONOMY, configText('{"hooks":{"context_warnings":false}}')).map(c => c.proposal.key),
    ).toEqual(['mode', 'workflow.text_mode'])
  })

  test('a no-op compares raw values: the string "false" is not the boolean false, so its hunk is offered', () => {
    expect(hunkCandidates(REQUIRED, configText('{"workflow":{"text_mode":"false"}}'))).toEqual([
      { proposal: MODE, before: 'not set (GSD default)' },
      { proposal: TEXT_MODE, before: '"false"' },
    ])
    expect(hunkCandidates(REQUIRED, configText('{"mode":"yolo","workflow":{"text_mode":0}}'))).toEqual([
      { proposal: TEXT_MODE, before: '0' },
    ])
  })

  test('one satisfied key leaves only the other one', () => {
    expect(hunkCandidates(REQUIRED, configText('{"mode":"yolo"}'))).toEqual([
      { proposal: TEXT_MODE, before: 'not set (GSD default)' },
    ])
    expect(hunkCandidates(REQUIRED, configText('{"workflow":{"text_mode":false}}'))).toEqual([
      { proposal: MODE, before: 'not set (GSD default)' },
    ])
  })

  test('a missing config file gives the not-set text on both required rows', () => {
    expect(hunkCandidates(REQUIRED, ABSENT)).toEqual([
      { proposal: MODE, before: 'not set (GSD default)' },
      { proposal: TEXT_MODE, before: 'not set (GSD default)' },
    ])
  })

  test('a config that cannot be read, or is not a JSON object, gives the unknown text on both required rows', () => {
    for (const config of UNUSABLE) {
      expect(hunkCandidates(REQUIRED, config)).toEqual([
        { proposal: MODE, before: 'unknown (could not read .planning/config.json)' },
        { proposal: TEXT_MODE, before: 'unknown (could not read .planning/config.json)' },
      ])
    }
  })

  test('a hostile config value is shown cleaned in the before text', () => {
    const config = configText(JSON.stringify({ mode: `inter${BIDI_OVERRIDE}active\nWhy: forged` }))

    expect(hunkCandidates(REQUIRED, config)[0]).toEqual({
      proposal: MODE,
      before: '"interactive\\nWhy: forged"',
    })
  })

  test('no proposals give no candidates, whatever the config is (empty edge)', () => {
    expect(hunkCandidates([], configText('{"mode":"interactive"}'))).toEqual([])
    expect(hunkCandidates([], UNREADABLE)).toEqual([])
    expect(hunkCandidates([], ABSENT)).toEqual([])
  })

  test('the candidates keep the order of the proposals (ordering edge)', () => {
    const reversed = [CONTEXT_WARNINGS, TEXT_MODE, MODE]

    expect(hunkCandidates(reversed, ABSENT).map(candidate => candidate.proposal.key)).toEqual([
      'hooks.context_warnings',
      'workflow.text_mode',
      'mode',
    ])
  })

  test('any optional proposal it is given is offered like a required one (A5)', () => {
    const other: SettingProposal = { ...TEXT_MODE, key: 'other.setting', isRequired: false }

    expect(hunkCandidates([other], ABSENT)).toEqual([{ proposal: other, before: NOT_SET_TEXT }])
  })

  test('hunkOp records the candidate, the answer and the resolved command', () => {
    const candidate: HunkCandidate = { proposal: MODE, before: 'interactive' }

    expect(hunkOp(candidate, true, RUNNABLE)).toEqual({
      kind: 'hunk',
      file: '.planning/config.json',
      key: 'mode',
      before: 'interactive',
      after: '"yolo"',
      isRequired: true,
      isAccepted: true,
      isRunnable: true,
      command: 'node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo',
    })
  })

  test('a declined hunk is not accepted, though the proposal is required', () => {
    const op = hunkOp({ proposal: TEXT_MODE, before: 'not set (GSD default)' }, false, RUNNABLE)

    expect(op.isRequired).toBe(true)
    expect(op.isAccepted).toBe(false)
  })

  test('a hunk whose command has no argv is not runnable, accepted or not, and shows the command to run', () => {
    const resolved = { argv: null, display: 'node .claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo' }
    const op = hunkOp({ proposal: MODE, before: 'interactive' }, true, resolved)

    expect(op.isAccepted).toBe(true)
    expect(op.isRunnable).toBe(false)
    expect(op.command).toBe('node .claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo')
  })

  test('an optional proposal gives an optional op', () => {
    const op = hunkOp({ proposal: CONTEXT_WARNINGS, before: 'true' }, true, RUNNABLE)

    expect(op.isRequired).toBe(false)
    expect(op.key).toBe('hooks.context_warnings')
    expect(op.before).toBe('true')
    expect(op.after).toBe('false')
  })
})

const MODE_USER_DISPLAY = 'node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo'

/** A hunk op that is required, accepted and runnable; `over` changes the fields it names. */
function op(over: Partial<HunkOp>): HunkOp {
  return {
    kind: 'hunk',
    file: '.planning/config.json',
    key: 'mode',
    before: 'interactive',
    after: '"yolo"',
    isRequired: true,
    isAccepted: true,
    isRunnable: true,
    command: MODE_USER_DISPLAY,
    ...over,
  }
}

describe('tool commands and attended', () => {
  test('isUnmetHunk is true exactly for a required hunk that was declined or cannot run (B5)', () => {
    const cases: readonly (readonly [boolean, boolean, boolean, boolean])[] = [
      [true, true, true, false],
      [true, false, true, true],
      [true, true, false, true],
      [true, false, false, true],
      [false, true, true, false],
      [false, false, true, false],
      [false, true, false, false],
      [false, false, false, false],
    ]

    for (const [isRequired, isAccepted, isRunnable, isUnmet] of cases) {
      const flags = [isRequired, isAccepted, isRunnable]
      expect([...flags, isUnmetHunk(op({ isRequired, isAccepted, isRunnable }))]).toEqual([...flags, isUnmet])
    }
  })

  test('from the config: the roles are unattended when every required value is at its target', () => {
    const atTargets = configText('{"mode":"yolo","workflow":{"text_mode":false}}')

    expect(isAttendedFromConfig(REQUIRED, atTargets)).toBe(false)
    expect(isAttendedFromConfig(GSD_AUTONOMY, atTargets)).toBe(false)
  })

  test('from the config: the roles are attended when a required value differs or is not set', () => {
    expect(isAttendedFromConfig(GSD_AUTONOMY, configText('{"mode":"interactive"}'))).toBe(true)
    expect(isAttendedFromConfig(GSD_AUTONOMY, configText('{"mode":"yolo"}'))).toBe(true)
    expect(isAttendedFromConfig(GSD_AUTONOMY, configText('{"workflow":{"text_mode":true}}'))).toBe(true)
    const stringFalse = configText('{"mode":"yolo","workflow":{"text_mode":"false"}}')
    expect(isAttendedFromConfig(GSD_AUTONOMY, stringFalse)).toBe(true)
  })

  test('from the config: a missing, unreadable or unusable config attends the roles (fail closed)', () => {
    expect(isAttendedFromConfig(GSD_AUTONOMY, ABSENT)).toBe(true)

    for (const config of UNUSABLE) {
      expect(isAttendedFromConfig(GSD_AUTONOMY, config)).toBe(true)
    }
  })

  test('from the config: no proposals attend nothing, whatever the config is (empty edge)', () => {
    expect(isAttendedFromConfig([], UNREADABLE)).toBe(false)
    expect(isAttendedFromConfig([], ABSENT)).toBe(false)
    expect(isAttendedFromConfig([], configText('{"mode":"interactive"}'))).toBe(false)
  })

  test('from the config: an unmet optional proposal alone attends nothing', () => {
    const config = configText('{"mode":"yolo","workflow":{"text_mode":false},"hooks":{"context_warnings":true}}')

    expect(isAttendedFromConfig(GSD_AUTONOMY, config)).toBe(false)
  })

  test('attendedNote lists the keys and says what the roles wait for', () => {
    expect(attendedNote(['mode', 'workflow.text_mode'])).toBe(
      'attended: GSD needs a person until mode and workflow.text_mode are set as proposed',
    )
  })

  test('attendedNote reads right for one key, three keys, and none', () => {
    expect(attendedNote(['workflow.text_mode'])).toBe(
      'attended: GSD needs a person until workflow.text_mode is set as proposed',
    )
    expect(attendedNote(['a', 'b', 'c'])).toBe('attended: GSD needs a person until a, b and c are set as proposed')
    expect(attendedNote([])).toBe('attended: GSD needs a person until its settings are set as proposed')
  })

  test('attendedNote cleans its keys, so a hostile key cannot add a line or hide text', () => {
    expect(attendedNote([`a${BIDI_OVERRIDE}\nb`])).toBe('attended: GSD needs a person until ab is set as proposed')
  })
})
