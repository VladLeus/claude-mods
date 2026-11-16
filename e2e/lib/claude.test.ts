import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  dialogOptions,
  dialogText,
  initEventOf,
  initLineOf,
  inputBoxOf,
  isInputShowing,
  isPromptOrQuestion,
  modelCallReason,
  squashed,
  STDERR_REASON_CHARS,
} from './claude.ts'

const RULE = '─'.repeat(20)
const COMMAND = '/cadre init'
const HOME = '/Users/unitperson'
const SECRET = 'unit-secret-value-123'
const IDENTITY = 'Unit Display Person'
const BASE = 'model call failed: claude -p exited 1'
const ANSWERED: readonly string[] = [
  '❯ /cadre init',
  '',
  ' ☐ Frameworks',
  '',
  '⏺ cadre: - e2e hand-added line 001',
  '⏺ cadre: - e2e hand-added line 002',
  '',
  RULE,
]
const PAGED_DIALOG: readonly string[] = [
  ' ☐ Conflict',
  '',
  '│ .cadre/be/ROLE.md was changed outside cadre. Keep your version, or take the new one?',
  '│ Keep mine leaves your edited file as it is; Take new writes the new version over it.',
  '',
  '❯ 1. Next page       ┌───────────────────────────────┐',
  '  2. Last page       │ - e2e hand-added line 001     │',
  '                     │ - e2e hand-added line 002     │',
  '                     └───────────────────────────────┘',
  '',
  RULE,
  '  Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel',
]
const NO_DIALOG = ['⏺ cadre: done, and a ☐ inside a line is no header', '', RULE, '❯', RULE].join('\n')
const WORKING_TOP: readonly string[] = ['✻ Working… (1s · esc to interrupt)', '']

function initLine(fields: Record<string, unknown>): string {
  return JSON.stringify({ type: 'system', subtype: 'init', ...fields })
}

test('isInputShowing is true when the input box between two rules holds the typed text', () => {
  const screen = ['⏺ an earlier reply', '', RULE, `❯ ${COMMAND}`, RULE, '  ? for shortcuts'].join('\n')

  assert.equal(isInputShowing(screen, COMMAND), true)
})

test('isInputShowing ignores trailing spaces and a session name on the top rule', () => {
  const named = [`${RULE} cadre-be ──`, `❯ ${COMMAND}   `, RULE].join('\n')

  assert.equal(isInputShowing(named, COMMAND), true)
})

test('isInputShowing compares the text as written, not as a pattern', () => {
  const text = 'Reply (with) OK?'

  assert.equal(isInputShowing([RULE, `❯ ${text}`, RULE].join('\n'), text), true)
  assert.equal(isInputShowing([RULE, '❯ Reply with OK', RULE].join('\n'), '.*'), false)
})

test('isInputShowing is false for the empty input box', () => {
  assert.equal(isInputShowing([RULE, '❯', RULE].join('\n'), COMMAND), false)
})

test('isInputShowing is false while the box holds a different or partly drawn text', () => {
  assert.equal(isInputShowing([RULE, '❯ /cadre in', RULE].join('\n'), COMMAND), false)
  assert.equal(isInputShowing([RULE, `❯ ${COMMAND} --dry-run`, RULE].join('\n'), COMMAND), false)
})

test('isInputShowing is false for a typed line that is not between two rules', () => {
  const echoed = ['', `❯ ${COMMAND}`, '', '⏺ cadre: done', '', RULE, '❯', RULE].join('\n')

  assert.equal(isInputShowing(echoed, COMMAND), false)
  assert.equal(isInputShowing([`❯ ${COMMAND}`, RULE].join('\n'), COMMAND), false)
  assert.equal(isInputShowing([RULE, `❯ ${COMMAND}`].join('\n'), COMMAND), false)
})

test('isInputShowing is true for a typed text the input box wraps over indented lines', () => {
  const text = 'PM here, for epic PROJ-1 Add retry: add a helper'
  const screen = [RULE, '❯ PM here, for epic PROJ-1 Add', '  retry: add a helper', RULE].join('\n')

  assert.equal(isInputShowing(screen, text), true)
})

test('isInputShowing is true for a text the box breaks inside a word', () => {
  const screen = [RULE, '❯ PM here, for ep', '  ic PROJ-1', RULE].join('\n')

  assert.equal(isInputShowing(screen, 'PM here, for epic PROJ-1'), true)
})

test('inputBoxOf is the same for two screens of a working session that differ only above the box', () => {
  const box = [RULE, '❯ hello there', RULE]
  const first = inputBoxOf([...WORKING_TOP, ...box].join('\n'))
  const later = inputBoxOf(['✻ Working… (2s · esc to interrupt)', '', ...box].join('\n'))

  assert.notEqual(first, null)
  assert.equal(later, first)
})

test('inputBoxOf is null when no input box is on the screen', () => {
  assert.equal(inputBoxOf(PAGED_DIALOG.join('\n')), null)
})

test('isPromptOrQuestion is true for the ready prompt and for a question of the session', () => {
  assert.equal(isPromptOrQuestion(NO_DIALOG), true)
  assert.equal(isPromptOrQuestion(PAGED_DIALOG.join('\n')), true)
})

test('isPromptOrQuestion is false for the folder trust dialog and a working screen', () => {
  const trust = [
    'Do you trust the files in this folder?',
    '',
    '❯ 1. Yes, I trust this folder',
    '  2. No, exit',
    '',
    'Enter to confirm · Esc to cancel',
  ].join('\n')
  const working = [...WORKING_TOP, RULE, '❯ hello there', RULE].join('\n')

  assert.equal(isPromptOrQuestion(trust), false)
  assert.equal(isPromptOrQuestion(working), false)
})

test('modelCallReason names only the exit code when stderr is empty', () => {
  assert.equal(modelCallReason(1, '', [], { HOME }), BASE)
})

test('modelCallReason adds the first non-empty stderr line', () => {
  assert.equal(modelCallReason(1, '\n\nError: boom\nsecond line', [], { HOME }), `${BASE}: Error: boom`)
})

test('modelCallReason filters identity values, env secrets and the home path out of the stderr line', () => {
  const stderr = `Error: ${IDENTITY} at ${HOME}/work sent ${SECRET}\nmore`
  const reason = modelCallReason(1, stderr, [IDENTITY], { HOME, UNIT_API_TOKEN: SECRET })

  assert.equal(reason, `${BASE}: Error: <identity> at ~/work sent <secret>`)
  for (const value of [IDENTITY, HOME, SECRET]) assert.equal(reason.includes(value), false)
})

test('modelCallReason cuts the stderr line to STDERR_REASON_CHARS after filtering it', () => {
  const lead = 'x'.repeat(STDERR_REASON_CHARS - 10)
  const stderr = `${lead}${SECRET} ${'y'.repeat(STDERR_REASON_CHARS)}`
  const reason = modelCallReason(1, stderr, [], { HOME, UNIT_API_TOKEN: SECRET })

  assert.equal(reason, `${BASE}: ${lead}<secret> y`)
  assert.equal(reason.length, `${BASE}: `.length + STDERR_REASON_CHARS)
})

test('dialogText is the screen from the start of the last ☐ header line', () => {
  const screen = [...ANSWERED, ...PAGED_DIALOG].join('\n')

  assert.equal(dialogText(screen), PAGED_DIALOG.join('\n'))
})

test('dialogText is the whole screen when no line starts with a ☐ header', () => {
  assert.equal(dialogText(NO_DIALOG), NO_DIALOG)
})

test('squashed folds each run of spaces, tabs and line breaks into one space', () => {
  assert.equal(squashed('Keep  mine\n  and\tTake new'), 'Keep mine and Take new')
})

test('squashed keeps a leading and a trailing run as one space each', () => {
  assert.equal(squashed('\n  cadre: done \n'), ' cadre: done ')
})

test('dialogOptions lists the option labels in the cursor column, cut before the preview box beside them', () => {
  const screen = [...ANSWERED, ...PAGED_DIALOG].join('\n')

  assert.deepEqual(dialogOptions(screen), ['Next page', 'Last page'])
})

test('dialogOptions is empty for a screen with no cursor row', () => {
  assert.deepEqual(dialogOptions(NO_DIALOG), [])
})

test('initLineOf gives the first system init line as printed and as parsed, past other events', () => {
  const first = initLine({ skills: ['p:s'], slash_commands: ['c'] })
  const text = [
    JSON.stringify({ type: 'system', subtype: 'hook_started' }),
    first,
    initLine({ skills: ['later'], slash_commands: [] }),
  ].join('\n')

  assert.deepEqual(initLineOf(text), { raw: first, event: JSON.parse(first) })
})

test('initLineOf skips an init event of another type and a line that is not JSON', () => {
  const real = initLine({ skills: [] })
  const text = [
    JSON.stringify({ type: 'assistant', subtype: 'init', skills: ['wrong'] }),
    '{"type":"system","subtype":"init",',
    real,
  ].join('\n')

  assert.equal(initLineOf(text)?.raw, real)
})

test('initLineOf is null when no line is a system init event', () => {
  assert.equal(initLineOf(''), null)
  assert.equal(initLineOf([JSON.stringify({ type: 'assistant' }), 'not json'].join('\n')), null)
})

test('initEventOf reads the lists of the first init line, past other events', () => {
  const text = [
    JSON.stringify({ type: 'system', subtype: 'hook_started' }),
    initLine({ skills: ['p:s'], slash_commands: ['c'] }),
    initLine({ skills: ['later'], slash_commands: [] }),
  ].join('\n')

  assert.deepEqual(initEventOf(text), { skills: ['p:s'], slashCommands: ['c'] })
})

test('initEventOf is null with no init line, an init line that is not JSON, or a missing or mixed list', () => {
  assert.equal(initEventOf(JSON.stringify({ type: 'assistant' })), null)
  assert.equal(initEventOf('{"type":"system","subtype":"init",'), null)
  assert.equal(initEventOf(initLine({ slash_commands: ['c'] })), null)
  assert.equal(initEventOf(initLine({ skills: ['p:s'] })), null)
  assert.equal(initEventOf(initLine({ skills: ['p:s'], slash_commands: ['c', 1] })), null)
})
