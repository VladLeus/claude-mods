import { describe, expect, test } from 'claude-code/testing'

import { COMMAND_COLUMN, helpText, USAGE_LINES, USAGE_ROWS, usageLines } from './usage'

/**
 * The usage lines of `/cadre` as helpText gave them before the usage rows (SHOULD 8): captured by running it at the
 * base of 02.1-18 and pasted here, so the renderer has to give them byte for byte.
 */
const HELP_LINES: readonly string[] = [
  'cadre commands:',
  '  /cadre detect                 show which dev framework this repo uses, with evidence (read-only)',
  '  /cadre detect --adapters      also show the contract cadre would drive each framework with',
  '  /cadre init                   guided setup: scan, propose roles, review the file plan, then write it',
  '  /cadre init --dry-run         the same guided flow; prints the plan and writes nothing',
  '  /cadre regen <id>             re-render one role from its role.json and write its files',
  "  /cadre regen <id> --dry-run   print that role's plan and write nothing",
  "  /cadre start <id>             render a role's runtime files, then print and copy its launcher command",
  '  /cadre start <id> --terminal  also open it in a new Terminal window, iTerm tab or tmux window (macOS)',
  "  /cadre status <id>            show from disk whether a role's autopilot run is done, running, stopped, " +
    'not started or unknown',
  "  /cadre epic <KEY> [title]     create or reuse the epic's worktree and open its roles there",
  "  /cadre epic done <KEY>        remove a finished epic's worktree (clean, merged, no role running)",
]

describe('usage rows (SHOULD 8)', () => {
  test('helpText without unknown input is the captured text, byte for byte', () => {
    expect(helpText(null)).toBe(HELP_LINES.join('\n'))
  })

  test('usageLines of USAGE_ROWS gives the captured usage lines, line for line', () => {
    expect(usageLines(USAGE_ROWS)).toEqual(HELP_LINES)
  })
})

/** Each usage row is indented this many spaces, then the command is padded to COMMAND_COLUMN before its description. */
const ROW_INDENT = 2

describe('helpText', () => {
  test('without unknown input it lists the detect, init and regen commands and no unknown line', () => {
    const text = helpText(null)
    expect(text).toContain('/cadre detect')
    expect(text).toContain('/cadre detect --adapters')
    expect(text).toContain('/cadre init')
    expect(text).toContain('/cadre init --dry-run')
    expect(text).toContain('/cadre regen <id>')
    expect(text).toContain('/cadre regen <id> --dry-run')
    expect(text).not.toContain('Unknown')
  })

  test('each command has its own row, and every row starts its description in the same column', () => {
    const rows = USAGE_LINES.slice(1)
    expect(rows).toHaveLength(11)
    const commands = rows.map(row => row.slice(ROW_INDENT, ROW_INDENT + COMMAND_COLUMN).trimEnd())
    expect(commands).toEqual([
      '/cadre detect',
      '/cadre detect --adapters',
      '/cadre init',
      '/cadre init --dry-run',
      '/cadre regen <id>',
      '/cadre regen <id> --dry-run',
      '/cadre start <id>',
      '/cadre start <id> --terminal',
      '/cadre status <id>',
      '/cadre epic <KEY> [title]',
      '/cadre epic done <KEY>',
    ])
    const descriptionColumn = ROW_INDENT + COMMAND_COLUMN
    for (const row of rows) {
      expect(row.slice(descriptionColumn - 1, descriptionColumn)).toBe(' ')
      expect(row.slice(descriptionColumn, descriptionColumn + 1)).not.toBe(' ')
    }
  })

  test('the init rows say what they do: plain init writes the plan, --dry-run writes nothing', () => {
    const text = helpText(null)
    expect(text).toContain('guided setup: scan, propose roles, review the file plan, then write it')
    expect(text).toContain('the same guided flow; prints the plan and writes nothing')
  })

  test('the regen rows say what they do: plain regen writes the role files, --dry-run writes nothing', () => {
    const text = helpText(null)
    expect(text).toContain('re-render one role from its role.json and write its files')
    expect(text).toContain("print that role's plan and write nothing")
  })

  test('no row says that nothing is written yet', () => {
    expect(USAGE_LINES.filter(row => row.includes('writes nothing yet'))).toEqual([])
  })

  test('with unknown input the first line names it as an unknown subcommand', () => {
    expect(helpText('launch').split('\n')[0]).toBe('Unknown subcommand: launch')
  })
})
