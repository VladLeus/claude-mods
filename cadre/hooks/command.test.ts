import { describe, expect, test } from 'claude-code/testing'

import { helpText, parseCommand } from './command'

describe('parseCommand', () => {
  test('empty input is the help text with no unknown input', () => {
    expect(parseCommand('')).toEqual({ kind: 'help', unknown: null })
  })

  test('help in any case is the help text with no unknown input', () => {
    expect(parseCommand('help')).toEqual({ kind: 'help', unknown: null })
    expect(parseCommand('HELP')).toEqual({ kind: 'help', unknown: null })
  })

  test('detect alone is the detection without the adapter contract', () => {
    expect(parseCommand('detect')).toEqual({ kind: 'detect', adapters: false })
  })

  test('--adapters after detect, in any case and spacing, adds the adapter contract', () => {
    expect(parseCommand('  DETECT   --adapters ')).toEqual({ kind: 'detect', adapters: true })
    expect(parseCommand('detect --adapters')).toEqual({ kind: 'detect', adapters: true })
    expect(parseCommand('detect --ADAPTERS')).toEqual({ kind: 'detect', adapters: true })
  })

  test('detect followed by other words is unknown input', () => {
    expect(parseCommand('detect foo')).toEqual({ kind: 'help', unknown: 'detect foo' })
    expect(parseCommand('detect --adapters extra')).toEqual({ kind: 'help', unknown: 'detect --adapters extra' })
  })

  test('a repeated --adapters switch is still the detection with the adapter contract', () => {
    expect(parseCommand('detect --adapters --adapters')).toEqual({ kind: 'detect', adapters: true })
  })

  test('an unknown subcommand is echoed back as unknown input', () => {
    expect(parseCommand('init')).toEqual({ kind: 'help', unknown: 'init' })
  })

  test('input of only invisible characters is the help text with no unknown input', () => {
    expect(parseCommand('\u202E')).toEqual({ kind: 'help', unknown: null })
    expect(parseCommand('\u200B')).toEqual({ kind: 'help', unknown: null })
  })

  test('a control character inside the input becomes a space', () => {
    expect(parseCommand('foo\u0007bar')).toEqual({ kind: 'help', unknown: 'foo bar' })
  })

  test('bidi characters are stripped and the echo is capped at 40 code points', () => {
    const command = parseCommand(`${'a'.repeat(30)}\u202E${'b'.repeat(29)}`)
    expect(command).toEqual({ kind: 'help', unknown: `${'a'.repeat(30)}${'b'.repeat(9)}…` })
  })

  test('the cap counts code points, not UTF-16 units', () => {
    const command = parseCommand('😀'.repeat(50))
    expect(command).toEqual({ kind: 'help', unknown: `${'😀'.repeat(39)}…` })
    const unknown = command.kind === 'help' ? (command.unknown ?? '') : ''
    expect(Array.from(unknown).length).toBe(40)
  })
})

describe('helpText', () => {
  test('without unknown input it lists the two detect commands and no unknown line', () => {
    const text = helpText(null)
    expect(text).toContain('/cadre detect')
    expect(text).toContain('/cadre detect --adapters')
    expect(text).not.toContain('Unknown')
  })

  test('with unknown input the first line names it as an unknown subcommand', () => {
    expect(helpText('init').split('\n')[0]).toBe('Unknown subcommand: init')
  })
})
