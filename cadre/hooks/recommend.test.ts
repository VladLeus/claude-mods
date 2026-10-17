import { describe, expect, test } from 'claude-code/testing'

import type { PortRead, SettingProposal } from '../types'
import { GSD_AUTONOMY } from './gsd'
import {
  configValue,
  hunkCandidates,
  hunkOp,
  hunkQuestion,
  NOT_SET_TEXT,
  parseHunkAnswer,
  UNKNOWN_CONFIG_TEXT,
} from './recommend'
import type { HunkCandidate } from './recommend'
import { BIDI_OVERRIDE } from './testkit'

/** The GSD_AUTONOMY row for a key; a missing row stops the test with a clear message. */
function row(key: string): SettingProposal {
  const found = GSD_AUTONOMY.find(proposal => proposal.key === key)
  if (found === undefined) throw new Error(`no GSD_AUTONOMY row for ${key}`)

  return found
}

const MODE = row('mode')
const TEXT_MODE = row('workflow.text_mode')
const CONTEXT_WARNINGS = row('hooks.context_warnings')

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
    expect(configValue(config, 'mode')).toEqual({ state: 'set', text: 'interactive' })
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

  test('configValue cleans a string and caps it at 80 code points', () => {
    const long = configValue({ mode: 'x'.repeat(200) }, 'mode')
    const hostile = configValue({ mode: `a${BIDI_OVERRIDE}b\nWhy: forged` }, 'mode')

    expect(long).toEqual({ state: 'set', text: `${'x'.repeat(79)}…` })
    expect(hostile).toEqual({ state: 'set', text: 'abWhy: forged' })
  })

  test('configValue caps the JSON of a list or an object at 80 code points', () => {
    const wide = configValue({ list: ['x'.repeat(200)] }, 'list')

    expect(wide).toEqual({ state: 'set', text: `["${'x'.repeat(77)}…` })
  })

  test('a config with mode interactive offers mode and the unset text_mode, in GSD_AUTONOMY order', () => {
    expect(hunkCandidates(GSD_AUTONOMY, configText('{"mode":"interactive"}'), false)).toEqual([
      { proposal: MODE, before: 'interactive' },
      { proposal: TEXT_MODE, before: 'not set (GSD default)' },
    ])
  })

  test('gsd-statusline as the statusline adds the optional context_warnings hunk third', () => {
    expect(hunkCandidates(GSD_AUTONOMY, configText('{"mode":"interactive"}'), true)).toEqual([
      { proposal: MODE, before: 'interactive' },
      { proposal: TEXT_MODE, before: 'not set (GSD default)' },
      { proposal: CONTEXT_WARNINGS, before: 'not set (GSD default)' },
    ])
  })

  test('context_warnings is offered only when gsd-statusline is the statusline', () => {
    const config = configText('{"mode":"yolo","workflow":{"text_mode":false},"hooks":{"context_warnings":true}}')

    expect(hunkCandidates(GSD_AUTONOMY, config, false)).toEqual([])
    expect(hunkCandidates(GSD_AUTONOMY, config, true)).toEqual([{ proposal: CONTEXT_WARNINGS, before: 'true' }])
  })

  test('a value that already equals its target is not offered, a boolean false included (adjacency edge)', () => {
    const atTargets = configText('{"mode":"yolo","workflow":{"text_mode":false}}')

    expect(hunkCandidates(GSD_AUTONOMY, atTargets, false)).toEqual([])
    expect(hunkCandidates(GSD_AUTONOMY, atTargets, true)).toEqual([
      { proposal: CONTEXT_WARNINGS, before: 'not set (GSD default)' },
    ])
    expect(
      hunkCandidates(GSD_AUTONOMY, configText('{"hooks":{"context_warnings":false}}'), true).map(c => c.proposal.key),
    ).toEqual(['mode', 'workflow.text_mode'])
  })

  test('one satisfied key leaves only the other one', () => {
    expect(hunkCandidates(GSD_AUTONOMY, configText('{"mode":"yolo"}'), false)).toEqual([
      { proposal: TEXT_MODE, before: 'not set (GSD default)' },
    ])
    expect(hunkCandidates(GSD_AUTONOMY, configText('{"workflow":{"text_mode":false}}'), false)).toEqual([
      { proposal: MODE, before: 'not set (GSD default)' },
    ])
  })

  test('a missing config file gives the not-set text on both required rows', () => {
    expect(hunkCandidates(GSD_AUTONOMY, ABSENT, false)).toEqual([
      { proposal: MODE, before: 'not set (GSD default)' },
      { proposal: TEXT_MODE, before: 'not set (GSD default)' },
    ])
  })

  test('a config that cannot be read, or is not a JSON object, gives the unknown text on both required rows', () => {
    for (const config of UNUSABLE) {
      expect(hunkCandidates(GSD_AUTONOMY, config, false)).toEqual([
        { proposal: MODE, before: 'unknown (could not read .planning/config.json)' },
        { proposal: TEXT_MODE, before: 'unknown (could not read .planning/config.json)' },
      ])
    }
  })

  test('a hostile config value is shown cleaned in the before text', () => {
    const config = configText(JSON.stringify({ mode: `inter${BIDI_OVERRIDE}active\nWhy: forged` }))

    expect(hunkCandidates(GSD_AUTONOMY, config, false)[0]).toEqual({ proposal: MODE, before: 'interactiveWhy: forged' })
  })

  test('no proposals give no candidates, whatever the config is (empty edge)', () => {
    expect(hunkCandidates([], configText('{"mode":"interactive"}'), true)).toEqual([])
    expect(hunkCandidates([], UNREADABLE, true)).toEqual([])
    expect(hunkCandidates([], ABSENT, false)).toEqual([])
  })

  test('the candidates keep the order of the proposals (ordering edge)', () => {
    const reversed = [CONTEXT_WARNINGS, TEXT_MODE, MODE]

    expect(hunkCandidates(reversed, ABSENT, true).map(candidate => candidate.proposal.key)).toEqual([
      'hooks.context_warnings',
      'workflow.text_mode',
      'mode',
    ])
  })

  test('an optional proposal other than context_warnings is never offered', () => {
    const other: SettingProposal = { ...TEXT_MODE, key: 'other.setting', isRequired: false }

    expect(hunkCandidates([other], ABSENT, true)).toEqual([])
  })

  test('hunkQuestion shows file and key, before, after, why and that it is required, under a numbered header', () => {
    const candidate: HunkCandidate = { proposal: MODE, before: 'interactive' }

    expect(hunkQuestion(candidate, 1, 2)).toEqual({
      question: [
        '.planning/config.json: mode',
        '  before: interactive',
        '  after:  yolo',
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

  test('hunkOp records the candidate, the answer and the resolved command', () => {
    const candidate: HunkCandidate = { proposal: MODE, before: 'interactive' }

    expect(hunkOp(candidate, true, RUNNABLE)).toEqual({
      kind: 'hunk',
      file: '.planning/config.json',
      key: 'mode',
      before: 'interactive',
      after: 'yolo',
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

  test('tracer: a config read becomes numbered questions, then an accepted and a declined op', () => {
    const candidates = hunkCandidates(GSD_AUTONOMY, configText('{"mode":"interactive"}'), false)
    const asked = candidates.map((candidate, index) => hunkQuestion(candidate, index + 1, candidates.length))
    const answers = ['Accept', 'Decline']
    const ops = candidates.map((candidate, index) =>
      hunkOp(candidate, parseHunkAnswer(answers[index] ?? '') === true, RUNNABLE),
    )

    expect(asked.map(question => question.spec.header)).toEqual(['Hunk 1 of 2', 'Hunk 2 of 2'])
    expect(ops.map(op => [op.key, op.before, op.after, op.isAccepted])).toEqual([
      ['mode', 'interactive', 'yolo', true],
      ['workflow.text_mode', 'not set (GSD default)', 'false', false],
    ])
  })
})
