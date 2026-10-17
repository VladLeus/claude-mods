import { describe, expect, test } from 'claude-code/testing'

import type { HunkOp, PortRead, SettingProposal, ToolCommand } from '../types'
import { GSD_AUTONOMY } from './gsd'
import {
  attendedNote,
  configValue,
  hunkCandidates,
  hunkOp,
  hunkQuestion,
  isGsdAttended,
  isGsdAttendedFromConfig,
  NOT_SET_TEXT,
  parseHunkAnswer,
  resolveToolCommand,
  TOOL_SCRIPTS,
  UNKNOWN_CONFIG_TEXT,
} from './recommend'
import type { GsdToolContext, HunkCandidate } from './recommend'
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

/** A user-level GSD under the home folder, as init resolves it. */
const USER_GSD: GsdToolContext = {
  userDir: '/home/u/.claude/gsd-core',
  home: '/home/u',
  root: '/repo',
  configDir: null,
}

/** The mode write as a logical command. */
const MODE_COMMAND: ToolCommand = { tool: 'gsd-tools', args: ['config-set', 'mode', 'yolo'] }

const MODE_USER_ARGV = ['node', '/home/u/.claude/gsd-core/bin/gsd-tools.cjs', 'config-set', 'mode', 'yolo']
const MODE_USER_DISPLAY = 'node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo'
const MODE_REPO_DISPLAY = 'node .claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo'
const REFUSED = { argv: null, display: 'refused: an argument is not a plain word' }

/** A hunk op that is required, accepted and runnable; `over` changes the fields it names. */
function op(over: Partial<HunkOp>): HunkOp {
  return {
    kind: 'hunk',
    file: '.planning/config.json',
    key: 'mode',
    before: 'interactive',
    after: 'yolo',
    isRequired: true,
    isAccepted: true,
    isRunnable: true,
    command: MODE_USER_DISPLAY,
    ...over,
  }
}

describe('tool commands and attended', () => {
  test('a user-level GSD gives the argv from the raw dir and shows the command in display form', () => {
    expect(resolveToolCommand(MODE_COMMAND, USER_GSD)).toEqual({ argv: MODE_USER_ARGV, display: MODE_USER_DISPLAY })
  })

  test('with no user-level GSD there is no argv, and the display is the repo-local command for the person', () => {
    expect(resolveToolCommand(MODE_COMMAND, { ...USER_GSD, userDir: null })).toEqual({
      argv: null,
      display: MODE_REPO_DISPLAY,
    })
  })

  test('an argument that is not a plain word refuses the command, with a user-level GSD or without one', () => {
    const args = ['yolo; rm -rf', 'a b', '$(id)', '`id`', 'x\ny', '', "it's", 'a|b', 'a&b', 'a/b', '--flag=$HOME']

    for (const arg of args) {
      const command: ToolCommand = { tool: 'gsd-tools', args: ['config-set', 'mode', arg] }

      expect(resolveToolCommand(command, USER_GSD)).toEqual(REFUSED)
      expect(resolveToolCommand(command, { ...USER_GSD, userDir: null })).toEqual(REFUSED)
    }
  })

  test('letters, digits, dots, underscores and hyphens are plain words', () => {
    const command: ToolCommand = { tool: 'gsd-tools', args: ['config-set', 'workflow.text_mode', 'v1-2_3'] }

    expect(resolveToolCommand(command, USER_GSD).argv).toEqual([
      'node',
      '/home/u/.claude/gsd-core/bin/gsd-tools.cjs',
      'config-set',
      'workflow.text_mode',
      'v1-2_3',
    ])
  })

  test('a command with no arguments resolves to the bare script', () => {
    expect(resolveToolCommand({ tool: 'gsd-tools', args: [] }, USER_GSD)).toEqual({
      argv: ['node', '/home/u/.claude/gsd-core/bin/gsd-tools.cjs'],
      display: 'node ~/.claude/gsd-core/bin/gsd-tools.cjs',
    })
    expect(resolveToolCommand({ tool: 'gsd-tools', args: [] }, { ...USER_GSD, userDir: null })).toEqual({
      argv: null,
      display: 'node .claude/gsd-core/bin/gsd-tools.cjs',
    })
  })

  test('trailing slashes on the user dir do not reach the argv', () => {
    const resolved = resolveToolCommand(MODE_COMMAND, { ...USER_GSD, userDir: '/home/u/.claude/gsd-core//' })

    expect(resolved).toEqual({ argv: MODE_USER_ARGV, display: MODE_USER_DISPLAY })
  })

  test('the display names a dir under CLAUDE_CONFIG_DIR by that name, and any other dir as it is', () => {
    const underConfig = { userDir: '/cfg/gsd-core', home: '/home/u', root: '/repo', configDir: '/cfg' }
    const elsewhere = { userDir: '/opt/gsd', home: '/home/u', root: '/repo', configDir: null }
    const noHome = { ...USER_GSD, home: null }

    expect(resolveToolCommand(MODE_COMMAND, underConfig)).toEqual({
      argv: ['node', '/cfg/gsd-core/bin/gsd-tools.cjs', 'config-set', 'mode', 'yolo'],
      display: 'node $CLAUDE_CONFIG_DIR/gsd-core/bin/gsd-tools.cjs config-set mode yolo',
    })
    expect(resolveToolCommand(MODE_COMMAND, elsewhere).display).toBe(
      'node /opt/gsd/bin/gsd-tools.cjs config-set mode yolo',
    )
    expect(resolveToolCommand(MODE_COMMAND, noHome).display).toBe(
      'node /home/u/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo',
    )
  })

  test('a user dir that is not an absolute path without empty, dot or dot-dot segments is no user-level GSD', () => {
    const dirs = ['', '/', 'gsd-core', './gsd-core', '/home/u/../x', '/home//u', '/home/u/./gsd-core']

    for (const userDir of dirs) {
      expect(resolveToolCommand(MODE_COMMAND, { ...USER_GSD, userDir })).toEqual({
        argv: null,
        display: MODE_REPO_DISPLAY,
      })
    }
  })

  test('every GSD_AUTONOMY write resolves to a runnable user-level command, so its arguments are plain words', () => {
    for (const proposal of GSD_AUTONOMY) {
      expect(resolveToolCommand(proposal.write, USER_GSD)).toEqual({
        argv: ['node', '/home/u/.claude/gsd-core/bin/gsd-tools.cjs', 'config-set', proposal.key, proposal.to],
        display: `node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set ${proposal.key} ${proposal.to}`,
      })
    }
  })

  test('repo-local GSD is never an argv: every GSD_AUTONOMY write gives none, only the command to run', () => {
    for (const proposal of GSD_AUTONOMY) {
      const resolved = resolveToolCommand(proposal.write, { ...USER_GSD, userDir: null })

      expect(resolved.argv).toBeNull()
      expect(resolved.display).toBe(`node .claude/gsd-core/bin/gsd-tools.cjs config-set ${proposal.key} ${proposal.to}`)
    }
  })

  test('TOOL_SCRIPTS names the one script of gsd-tools and is frozen', () => {
    expect(TOOL_SCRIPTS).toEqual({ 'gsd-tools': 'bin/gsd-tools.cjs' })
    expect(Object.isFrozen(TOOL_SCRIPTS)).toBe(true)
  })

  test('a required hunk that is accepted and runnable leaves the roles unattended', () => {
    expect(isGsdAttended([op({})])).toBe(false)
  })

  test('a declined required hunk makes the roles attended', () => {
    expect(isGsdAttended([op({ isAccepted: false })])).toBe(true)
  })

  test('a required hunk that cadre cannot run makes the roles attended, though it was accepted', () => {
    expect(isGsdAttended([op({ isRunnable: false })])).toBe(true)
  })

  test('an optional hunk never makes the roles attended, declined or not runnable', () => {
    expect(isGsdAttended([op({ isRequired: false, isAccepted: false })])).toBe(false)
    expect(isGsdAttended([op({ isRequired: false, isRunnable: false })])).toBe(false)
  })

  test('one open required hunk among accepted ones is enough', () => {
    const hunks = [op({}), op({ key: 'workflow.text_mode', isAccepted: false }), op({ isRequired: false })]

    expect(isGsdAttended(hunks)).toBe(true)
  })

  test('no hunks leave the roles unattended (empty edge)', () => {
    expect(isGsdAttended([])).toBe(false)
  })

  test('from the config: the roles are unattended when every required value is at its target', () => {
    const atTargets = configText('{"mode":"yolo","workflow":{"text_mode":false}}')

    expect(isGsdAttendedFromConfig(GSD_AUTONOMY, atTargets, false)).toBe(false)
    expect(isGsdAttendedFromConfig(GSD_AUTONOMY, atTargets, true)).toBe(false)
  })

  test('from the config: the roles are attended when a required value differs or is not set', () => {
    expect(isGsdAttendedFromConfig(GSD_AUTONOMY, configText('{"mode":"interactive"}'), false)).toBe(true)
    expect(isGsdAttendedFromConfig(GSD_AUTONOMY, configText('{"mode":"yolo"}'), false)).toBe(true)
    expect(isGsdAttendedFromConfig(GSD_AUTONOMY, configText('{"workflow":{"text_mode":true}}'), false)).toBe(true)
  })

  test('from the config: a missing, unreadable or unusable config attends the roles (fail closed)', () => {
    expect(isGsdAttendedFromConfig(GSD_AUTONOMY, ABSENT, false)).toBe(true)

    for (const config of UNUSABLE) {
      expect(isGsdAttendedFromConfig(GSD_AUTONOMY, config, false)).toBe(true)
    }
  })

  test('from the config: no proposals attend nothing, whatever the config is (empty edge)', () => {
    expect(isGsdAttendedFromConfig([], UNREADABLE, true)).toBe(false)
    expect(isGsdAttendedFromConfig([], ABSENT, false)).toBe(false)
    expect(isGsdAttendedFromConfig([], configText('{"mode":"interactive"}'), true)).toBe(false)
  })

  test('from the config: an unmet optional proposal alone attends nothing', () => {
    const config = configText('{"mode":"yolo","workflow":{"text_mode":false},"hooks":{"context_warnings":true}}')

    expect(isGsdAttendedFromConfig(GSD_AUTONOMY, config, true)).toBe(false)
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
