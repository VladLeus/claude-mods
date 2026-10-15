import { describe, expect, test } from 'claude-code/testing'

import { helpText, parseCommand } from './command'

describe('parseCommand', () => {
  test('empty input is the help text with no unknown input', async () => {
    expect(parseCommand('')).toEqual({ kind: 'help', unknown: null })
  })

  test('help in any case is the help text with no unknown input', async () => {
    expect(parseCommand('help')).toEqual({ kind: 'help', unknown: null })
    expect(parseCommand('HELP')).toEqual({ kind: 'help', unknown: null })
  })

  test('detect alone is the detection without the adapter contract', async () => {
    expect(parseCommand('detect')).toEqual({ kind: 'detect', adapters: false })
  })

  test('--adapters after detect, in any case and spacing, adds the adapter contract', async () => {
    expect(parseCommand('  DETECT   --adapters ')).toEqual({ kind: 'detect', adapters: true })
    expect(parseCommand('detect --adapters')).toEqual({ kind: 'detect', adapters: true })
  })

  test('detect followed by other words is unknown input', async () => {
    expect(parseCommand('detect foo')).toEqual({ kind: 'help', unknown: 'detect foo' })
  })

  test('an unknown subcommand is echoed back as unknown input', async () => {
    expect(parseCommand('init')).toEqual({ kind: 'help', unknown: 'init' })
  })

  test('invisible and bidi characters are stripped and the echo is capped at 40 code points', async () => {
    const word = `${'a'.repeat(30)}‮${'b'.repeat(29)}`
    const command = parseCommand(word)
    const unknown = command.kind === 'help' ? (command.unknown ?? '') : ''
    expect(unknown.includes('‮')).toBe(false)
    expect(Array.from(unknown).length).toBeLessThanOrEqual(40)
    expect(unknown.endsWith('…')).toBe(true)
  })

  test('the same arguments parse to deep-equal results every time', async () => {
    expect(parseCommand('detect --adapters')).toEqual(parseCommand('detect --adapters'))
  })
})

describe('helpText', () => {
  test('without unknown input it lists the two detect commands and no unknown line', async () => {
    const text = helpText(null)
    expect(text).toContain('/cadre detect')
    expect(text).toContain('/cadre detect --adapters')
    expect(text).not.toContain('Unknown')
  })

  test('with unknown input the first line names it as an unknown subcommand', async () => {
    expect(helpText('init').split('\n')[0]).toBe('Unknown subcommand: init')
  })
})
