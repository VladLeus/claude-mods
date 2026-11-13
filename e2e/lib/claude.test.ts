import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isInputShowing } from './claude.ts'

const RULE = '─'.repeat(20)
const COMMAND = '/cadre init'

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
