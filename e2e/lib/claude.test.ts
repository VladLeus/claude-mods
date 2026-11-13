import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isInputShowing, modelCallReason, STDERR_REASON_CHARS } from './claude.ts'

const RULE = '─'.repeat(20)
const COMMAND = '/cadre init'
const HOME = '/Users/unitperson'
const SECRET = 'unit-secret-value-123'
const IDENTITY = 'Unit Display Person'
const BASE = 'model call failed: claude -p exited 1'

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
