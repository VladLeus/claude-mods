import { describe, expect, test } from 'claude-code/testing'

import { COMMAND_COLUMN, helpText, parseCommand, ROLE_ID_PATTERN, USAGE_LINES } from './command'

describe('ROLE_ID_PATTERN', () => {
  test('a lowercase slug of 1 to 24 characters is a role id', () => {
    expect(ROLE_ID_PATTERN.test('security')).toBe(true)
    expect(ROLE_ID_PATTERN.test('a-1')).toBe(true)
    expect(ROLE_ID_PATTERN.test('a')).toBe(true)
    expect(ROLE_ID_PATTERN.test('a'.repeat(24))).toBe(true)
  })

  test('a capital, a leading digit or hyphen, an underscore or a 25th character is not a role id', () => {
    expect(ROLE_ID_PATTERN.test('Be')).toBe(false)
    expect(ROLE_ID_PATTERN.test('1a')).toBe(false)
    expect(ROLE_ID_PATTERN.test('-a')).toBe(false)
    expect(ROLE_ID_PATTERN.test('a_b')).toBe(false)
    expect(ROLE_ID_PATTERN.test('a'.repeat(25))).toBe(false)
    expect(ROLE_ID_PATTERN.test('')).toBe(false)
  })

  test('a slash, a dot segment, a space or a line break can never be part of a role id', () => {
    expect(ROLE_ID_PATTERN.test('a/b')).toBe(false)
    expect(ROLE_ID_PATTERN.test('../x')).toBe(false)
    expect(ROLE_ID_PATTERN.test('..')).toBe(false)
    expect(ROLE_ID_PATTERN.test('a b')).toBe(false)
    expect(ROLE_ID_PATTERN.test('a\n')).toBe(false)
  })
})

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

  test('init alone is the guided setup that writes', () => {
    expect(parseCommand('init')).toEqual({ kind: 'init', dryRun: false })
  })

  test('--dry-run after init, in any case and spacing, is the dry run', () => {
    expect(parseCommand('init --dry-run')).toEqual({ kind: 'init', dryRun: true })
    expect(parseCommand('INIT --DRY-RUN')).toEqual({ kind: 'init', dryRun: true })
    expect(parseCommand('  Init   --Dry-Run ')).toEqual({ kind: 'init', dryRun: true })
  })

  test('a repeated --dry-run switch is still the dry run', () => {
    expect(parseCommand('init --dry-run --dry-run')).toEqual({ kind: 'init', dryRun: true })
  })

  test('init followed by other words or switches is unknown input', () => {
    expect(parseCommand('init now')).toEqual({ kind: 'help', unknown: 'init now' })
    expect(parseCommand('init --force')).toEqual({ kind: 'help', unknown: 'init --force' })
    expect(parseCommand('init --dry-run extra')).toEqual({ kind: 'help', unknown: 'init --dry-run extra' })
  })

  test('a word that only starts with init is unknown input, not the guided setup', () => {
    expect(parseCommand('initial')).toEqual({ kind: 'help', unknown: 'initial' })
    expect(parseCommand('init-now')).toEqual({ kind: 'help', unknown: 'init-now' })
  })

  test('--dry-run alone, or on detect, is unknown input', () => {
    expect(parseCommand('--dry-run')).toEqual({ kind: 'help', unknown: '--dry-run' })
    expect(parseCommand('detect --dry-run')).toEqual({ kind: 'help', unknown: 'detect --dry-run' })
    expect(parseCommand('init --adapters')).toEqual({ kind: 'help', unknown: 'init --adapters' })
  })

  test('an unknown subcommand is echoed back as unknown input', () => {
    expect(parseCommand('start')).toEqual({ kind: 'help', unknown: 'start' })
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
    expect(command).toEqual({ kind: 'help', unknown: `${'a'.repeat(30)}${'b'.repeat(9)}\u2026` })
  })

  test('the cap counts code points, not UTF-16 units', () => {
    const command = parseCommand('😀'.repeat(50))
    expect(command).toEqual({ kind: 'help', unknown: `${'😀'.repeat(39)}\u2026` })
    const unknown = command.kind === 'help' ? (command.unknown ?? '') : ''
    expect(Array.from(unknown).length).toBe(40)
  })
})

/** Each usage row is indented this many spaces, then the command is padded to COMMAND_COLUMN before its description. */
const ROW_INDENT = 2

describe('helpText', () => {
  test('without unknown input it lists the detect and init commands and no unknown line', () => {
    const text = helpText(null)
    expect(text).toContain('/cadre detect')
    expect(text).toContain('/cadre detect --adapters')
    expect(text).toContain('/cadre init')
    expect(text).toContain('/cadre init --dry-run')
    expect(text).not.toContain('Unknown')
  })

  test('each command has its own row, and every row starts its description in the same column', () => {
    const rows = USAGE_LINES.slice(1)
    expect(rows).toHaveLength(4)
    const commands = rows.map(row => row.slice(ROW_INDENT, ROW_INDENT + COMMAND_COLUMN).trimEnd())
    expect(commands).toEqual(['/cadre detect', '/cadre detect --adapters', '/cadre init', '/cadre init --dry-run'])
    const descriptionColumn = ROW_INDENT + COMMAND_COLUMN
    for (const row of rows) {
      expect(row.slice(descriptionColumn - 1, descriptionColumn)).toBe(' ')
      expect(row.slice(descriptionColumn, descriptionColumn + 1)).not.toBe(' ')
    }
  })

  test('the init rows say what they do and that nothing is written yet', () => {
    const text = helpText(null)
    expect(text).toContain('guided setup: scan, propose roles, show the file plan (writes nothing yet)')
    expect(text).toContain('the same guided flow; prints the plan and writes nothing')
  })

  test('with unknown input the first line names it as an unknown subcommand', () => {
    expect(helpText('start').split('\n')[0]).toBe('Unknown subcommand: start')
  })
})
