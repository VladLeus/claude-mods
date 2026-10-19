import { describe, expect, test } from 'claude-code/testing'

import type {
  FrameworkId,
  HunkOp,
  McpRef,
  PortRead,
  Recommendation,
  RepoScan,
  RoleSpec,
  ScanFinding,
  SettingProposal,
  SetupScan,
  SkillRef,
  TemplateRoleId,
  ToolCommand,
} from '../types'
import { GSD_AUTONOMY } from './gsd'
import {
  attendedNote,
  configValue,
  hunkCandidates,
  hunkOp,
  hunkQuestion,
  INSTALL_COMMANDS,
  isGsdAttended,
  isGsdAttendedFromConfig,
  NOT_SET_TEXT,
  parseHunkAnswer,
  recommend,
  recommendationLines,
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

  test('a config with mode interactive offers mode and the unset text_mode, in GSD_AUTONOMY order', () => {
    expect(hunkCandidates(GSD_AUTONOMY, configText('{"mode":"interactive"}'), false)).toEqual([
      { proposal: MODE, before: '"interactive"' },
      { proposal: TEXT_MODE, before: 'not set (GSD default)' },
    ])
  })

  test('gsd-statusline as the statusline adds the optional context_warnings hunk third', () => {
    expect(hunkCandidates(GSD_AUTONOMY, configText('{"mode":"interactive"}'), true)).toEqual([
      { proposal: MODE, before: '"interactive"' },
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

  test('a no-op compares raw values: the string "false" is not the boolean false, so its hunk is offered', () => {
    expect(hunkCandidates(GSD_AUTONOMY, configText('{"workflow":{"text_mode":"false"}}'), false)).toEqual([
      { proposal: MODE, before: 'not set (GSD default)' },
      { proposal: TEXT_MODE, before: '"false"' },
    ])
    expect(hunkCandidates(GSD_AUTONOMY, configText('{"mode":"yolo","workflow":{"text_mode":0}}'), false)).toEqual([
      { proposal: TEXT_MODE, before: '0' },
    ])
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

    expect(hunkCandidates(GSD_AUTONOMY, config, false)[0]).toEqual({
      proposal: MODE,
      before: '"interactive\\nWhy: forged"',
    })
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

  test('tracer: a config read becomes numbered questions, then an accepted and a declined op', () => {
    const candidates = hunkCandidates(GSD_AUTONOMY, configText('{"mode":"interactive"}'), false)
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
    after: '"yolo"',
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
    const stringFalse = configText('{"mode":"yolo","workflow":{"text_mode":"false"}}')
    expect(isGsdAttendedFromConfig(GSD_AUTONOMY, stringFalse, false)).toBe(true)
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

/** A role with the fields recommend reads set and the rest defaults. */
function role(id: string, basedOn: TemplateRoleId | null, title: string): RoleSpec {
  return {
    id,
    title,
    purpose: 'p',
    basedOn,
    model: 'opus',
    effort: 'medium',
    permissionMode: 'auto',
    autopilot: { duration: '4h', threshold: 65, askUser: false },
    hasBash: true,
    mcp: [],
    skills: [],
    instructions: [],
    carry: { autoCompactWindow: false, statusLine: false, env: [], hooks: [] },
  }
}

const PM = role('pm', 'pm', 'PM')
const TL = role('tl', 'tl', 'Team Lead')
const BE = role('be', 'be', 'BE')
const FE = role('fe', 'fe', 'FE')
const QA = role('qa', 'qa', 'QA')
const SECURITY = role('security', 'security', 'Security')

/** The six template roles in template order. */
const FULL_TEAM: readonly RoleSpec[] = [PM, TL, BE, FE, QA, SECURITY]

/** Every role of a team on one framework, in role order, as init resolves them. */
function allOn(roles: readonly RoleSpec[], framework: FrameworkId): FrameworkId[] {
  return roles.map(() => framework)
}

/** A repo scan that found nothing; `over` changes the fields it names. */
function repoScan(over: Partial<RepoScan> = {}): RepoScan {
  return {
    findings: [],
    languages: [],
    codeDirs: [],
    hasSource: false,
    isTruncated: false,
    cadre: { dir: 'absent', manifest: null, manifestState: 'absent', state: null, stateState: 'absent' },
    warnings: [],
    ...over,
  }
}

/** A user setup that holds nothing; `over` changes the fields it names. */
function setupScan(over: Partial<SetupScan> = {}): SetupScan {
  return {
    plugins: [],
    skills: [],
    mcp: [],
    agents: [],
    claudeMd: [],
    hasGlobalClaudeMd: false,
    memoryFiles: [],
    settingsKeys: [],
    hooks: [],
    carry: { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] },
    isMcpPartial: false,
    warnings: [],
    ...over,
  }
}

/** An E2E finding, as the repo scan records one. */
const E2E: ScanFinding = { kind: 'e2e', label: 'playwright', evidence: 'playwright.config.ts' }

/** An MCP server of the session, by name. */
function server(name: string): McpRef {
  return { name, source: 'session' }
}

/** A skill by name; `plugin` is null for a user or project skill. */
function skill(name: string, plugin: string | null = null): SkillRef {
  return { name, plugin }
}

const NO_FRAMEWORK_WHY = 'no dev framework is in use; roles run the built-in plan, execute, verify loop'
const PLAYWRIGHT_WHY = 'the FE role has no E2E setup to check its work in a browser'
const DEVTOOLS_WHY = 'the FE role cannot inspect the running page'
const SECURITY_WHY = 'the Security role has no security-review skill'

const GSD_LINE: Recommendation = { tool: 'GSD', roleId: null, why: NO_FRAMEWORK_WHY, install: INSTALL_COMMANDS.gsd }
const SUPERPOWERS_LINE: Recommendation = {
  tool: 'superpowers',
  roleId: null,
  why: NO_FRAMEWORK_WHY,
  install: INSTALL_COMMANDS.superpowers,
}

/** The Playwright MCP recommendation for the FE role `roleId`. */
function playwrightFor(roleId: string): Recommendation {
  return { tool: 'Playwright MCP', roleId, why: PLAYWRIGHT_WHY, install: INSTALL_COMMANDS.playwright }
}

/** The DevTools MCP recommendation for the FE role `roleId`. */
function devtoolsFor(roleId: string): Recommendation {
  return { tool: 'DevTools MCP', roleId, why: DEVTOOLS_WHY, install: INSTALL_COMMANDS.devtools }
}

/** The security-review recommendation for the Security role `roleId`. */
function securityReviewFor(roleId: string): Recommendation {
  return { tool: 'security-review', roleId, why: SECURITY_WHY, install: INSTALL_COMMANDS.securityReview }
}

describe('recommend', () => {
  test('INSTALL_COMMANDS holds the five printed commands word for word, and is frozen', () => {
    expect(INSTALL_COMMANDS).toEqual({
      gsd: 'npx -y --package=@opengsd/gsd-core@latest -- gsd-core --global',
      superpowers: 'claude plugin install superpowers@claude-plugins-official',
      playwright: 'claude mcp add playwright -- npx @playwright/mcp@latest',
      devtools: 'claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest',
      securityReview:
        "built into Claude Code as /security-review; add it to the Security role's skills in .cadre/<id>/role.json",
    })
    expect(Object.isFrozen(INSTALL_COMMANDS)).toBe(true)
  })

  test('no framework in use for any role gives the GSD and superpowers lines, first', () => {
    const roles = [PM, TL]

    expect(recommend({ roles, frameworks: allOn(roles, 'none'), scan: repoScan(), setup: setupScan() })).toEqual([
      GSD_LINE,
      SUPERPOWERS_LINE,
    ])
  })

  test('a framework in use for any role gives no GSD or superpowers line', () => {
    const roles = [PM, TL]
    const frameworks: readonly (readonly FrameworkId[])[] = [
      ['gsd', 'gsd'],
      ['superpowers', 'superpowers'],
      ['gsd', 'none'],
      ['none', 'superpowers'],
    ]

    for (const resolved of frameworks) {
      expect(recommend({ roles, frameworks: resolved, scan: repoScan(), setup: setupScan() })).toEqual([])
    }
  })

  test('a team with no roles gets no recommendation', () => {
    expect(recommend({ roles: [], frameworks: [], scan: repoScan(), setup: setupScan() })).toEqual([])
  })

  test('an FE role with no E2E finding and no playwright MCP gets the Playwright MCP line', () => {
    const setup = setupScan({ mcp: [server('chrome-devtools')] })

    expect(recommend({ roles: [FE], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([playwrightFor('fe')])
  })

  test('an E2E finding means no Playwright MCP line', () => {
    const scan = repoScan({ findings: [E2E] })
    const setup = setupScan({ mcp: [server('chrome-devtools')] })

    expect(recommend({ roles: [FE], frameworks: ['gsd'], scan, setup })).toEqual([])
  })

  test('a playwright MCP server, in any case and inside a longer name, means no Playwright MCP line', () => {
    for (const name of ['playwright', 'Playwright', 'plugin_playwright_playwright', 'my-PLAYWRIGHT-server']) {
      const setup = setupScan({ mcp: [server(name), server('chrome-devtools')] })

      expect(recommend({ roles: [FE], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([])
    }
  })

  test('an FE role with no devtools MCP gets the DevTools MCP line, whether E2E was found or not', () => {
    const scan = repoScan({ findings: [E2E] })
    const setup = setupScan({ mcp: [server('playwright')] })

    expect(recommend({ roles: [FE], frameworks: ['gsd'], scan, setup })).toEqual([devtoolsFor('fe')])
    expect(recommend({ roles: [FE], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([devtoolsFor('fe')])
  })

  test('a devtools MCP server, in any case and inside a longer name, means no DevTools MCP line', () => {
    for (const name of ['chrome-devtools', 'DevTools', 'devtools-mcp']) {
      const setup = setupScan({ mcp: [server(name), server('playwright')] })

      expect(recommend({ roles: [FE], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([])
    }
  })

  test('an FE role with neither tool gets both lines, Playwright first', () => {
    expect(recommend({ roles: [FE], frameworks: ['gsd'], scan: repoScan(), setup: setupScan() })).toEqual([
      playwrightFor('fe'),
      devtoolsFor('fe'),
    ])
  })

  test('a role based on fe is named by its own id, and a role with the id fe needs no base', () => {
    const web = role('web', 'fe', 'Web UI')
    const frontend = role('fe', null, 'Frontend')

    expect(recommend({ roles: [web], frameworks: ['gsd'], scan: repoScan(), setup: setupScan() })).toEqual([
      playwrightFor('web'),
      devtoolsFor('web'),
    ])
    expect(recommend({ roles: [frontend], frameworks: ['gsd'], scan: repoScan(), setup: setupScan() })).toEqual([
      playwrightFor('fe'),
      devtoolsFor('fe'),
    ])
  })

  test('each FE role gets its own line, rule by rule', () => {
    const roles = [FE, role('web', 'fe', 'Web UI')]

    expect(recommend({ roles, frameworks: allOn(roles, 'gsd'), scan: repoScan(), setup: setupScan() })).toEqual([
      playwrightFor('fe'),
      playwrightFor('web'),
      devtoolsFor('fe'),
      devtoolsFor('web'),
    ])
  })

  test('a Security role with no security-review skill gets the security-review line', () => {
    expect(recommend({ roles: [SECURITY], frameworks: ['gsd'], scan: repoScan(), setup: setupScan() })).toEqual([
      securityReviewFor('security'),
    ])
    expect(
      recommend({ roles: [role('sec', 'security', 'Sec')], frameworks: ['gsd'], scan: repoScan(), setup: setupScan() }),
    ).toEqual([securityReviewFor('sec')])
  })

  test('a security-review skill, plain or from a plugin, means no security-review line', () => {
    const skills = [skill('security-review'), skill('claude-code:security-review', 'claude-code')]

    for (const found of skills) {
      const setup = setupScan({ skills: [skill('review'), found] })

      expect(recommend({ roles: [SECURITY], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([])
    }
  })

  test('security-review counts only as the whole last word of a skill name, so security-reviewer does not', () => {
    const setup = setupScan({ skills: [skill('security-reviewer'), skill('security-review-extra'), skill('review')] })

    expect(recommend({ roles: [SECURITY], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([
      securityReviewFor('security'),
    ])
  })

  test('a security-review skill after a dash or a plugin, in any case, means no security-review line', () => {
    for (const name of ['my-security-review', 'Acme:Security-Review', 'SECURITY-REVIEW']) {
      const setup = setupScan({ skills: [skill(name)] })

      expect(recommend({ roles: [SECURITY], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([])
    }
  })

  test('a full team with nothing found gets the five lines in rule order', () => {
    const lines = recommend({
      roles: FULL_TEAM,
      frameworks: allOn(FULL_TEAM, 'none'),
      scan: repoScan(),
      setup: setupScan(),
    })

    expect(lines.map(line => [line.tool, line.roleId])).toEqual([
      ['GSD', null],
      ['superpowers', null],
      ['Playwright MCP', 'fe'],
      ['DevTools MCP', 'fe'],
      ['security-review', 'security'],
    ])
  })

  test('with a framework, E2E, both MCP servers and a security-review skill nothing is recommended', () => {
    const scan = repoScan({ findings: [E2E] })
    const setup = setupScan({
      mcp: [server('playwright'), server('chrome-devtools')],
      skills: [skill('security-review')],
    })

    expect(recommend({ roles: FULL_TEAM, frameworks: allOn(FULL_TEAM, 'gsd'), scan, setup })).toEqual([])
  })

  test('a recommendation is plain data: a tool, a role id, a reason and a command as text, never run', () => {
    const lines = recommend({
      roles: FULL_TEAM,
      frameworks: allOn(FULL_TEAM, 'none'),
      scan: repoScan(),
      setup: setupScan(),
    })

    expect(lines).toHaveLength(5)
    for (const line of lines) {
      expect(Object.keys(line).sort()).toEqual(['install', 'roleId', 'tool', 'why'])
      expect(typeof line.install).toBe('string')
      expect(typeof line.why).toBe('string')
    }
  })

  test('the security-review text is the one printed string, wherever it is shown', () => {
    const lines = recommend({ roles: [SECURITY], frameworks: ['gsd'], scan: repoScan(), setup: setupScan() })

    expect(lines.map(line => line.install)).toEqual([INSTALL_COMMANDS.securityReview])
  })

  test('recommendationLines of no recommendation says none', () => {
    expect(recommendationLines([], FULL_TEAM)).toEqual(['Recommendations: none'])
  })

  test('recommendationLines prints a heading, then each tool for its role with the exact command to run', () => {
    const lines = recommend({
      roles: FULL_TEAM,
      frameworks: allOn(FULL_TEAM, 'none'),
      scan: repoScan(),
      setup: setupScan(),
    })

    expect(recommendationLines(lines, FULL_TEAM)).toEqual([
      'Recommendations (print-only; nothing is installed):',
      '- GSD for all roles: no dev framework is in use; roles run the built-in plan, execute, verify loop',
      '    run: npx -y --package=@opengsd/gsd-core@latest -- gsd-core --global',
      '- superpowers for all roles: no dev framework is in use; roles run the built-in plan, execute, verify loop',
      '    run: claude plugin install superpowers@claude-plugins-official',
      '- Playwright MCP for FE: the FE role has no E2E setup to check its work in a browser',
      '    run: claude mcp add playwright -- npx @playwright/mcp@latest',
      '- DevTools MCP for FE: the FE role cannot inspect the running page',
      '    run: claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest',
      '- security-review for Security: the Security role has no security-review skill',
      `    run: ${INSTALL_COMMANDS.securityReview}`,
    ])
  })

  test('recommendationLines names the role by its title, and by its id when no role has it', () => {
    const web = role('web', 'fe', 'Web UI')
    const named = recommendationLines([playwrightFor('web')], [web])
    const unknown = recommendationLines([playwrightFor('ghost')], [web])

    expect(named[1]).toBe(`- Playwright MCP for Web UI: ${PLAYWRIGHT_WHY}`)
    expect(unknown[1]).toBe(`- Playwright MCP for ghost: ${PLAYWRIGHT_WHY}`)
  })

  test('recommendationLines cleans every cell, so a hostile value adds no line and hides no text', () => {
    const hostile: Recommendation = {
      tool: `T${BIDI_OVERRIDE}\nx`,
      roleId: 'web',
      why: 'w\nFAKE',
      install: `i${BIDI_OVERRIDE}\nrm -rf`,
    }
    const lines = recommendationLines([hostile], [role('web', 'fe', 'A\nB')])

    expect(lines).toEqual([
      'Recommendations (print-only; nothing is installed):',
      '- Tx for AB: wFAKE',
      '    run: irm -rf',
    ])
  })

  test('recommendationLines caps a long cell at 240 code points', () => {
    const long: Recommendation = { tool: 'T', roleId: null, why: 'w'.repeat(300), install: 'i' }
    const lines = recommendationLines([long], [])

    expect(lines[1]).toBe(`- T for all roles: ${'w'.repeat(239)}…`)
  })

  test('tracer for the whole path: a team with no framework gives lines that name the commands and run none', () => {
    const roles = [PM, FE]
    const lines = recommendationLines(
      recommend({ roles, frameworks: allOn(roles, 'none'), scan: repoScan(), setup: setupScan() }),
      roles,
    )

    expect(lines.filter(line => line.startsWith('    run: '))).toEqual([
      `    run: ${INSTALL_COMMANDS.gsd}`,
      `    run: ${INSTALL_COMMANDS.superpowers}`,
      `    run: ${INSTALL_COMMANDS.playwright}`,
      `    run: ${INSTALL_COMMANDS.devtools}`,
    ])
  })
})
