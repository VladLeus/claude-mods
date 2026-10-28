import { describe, expect, test } from 'claude-code/testing'

import { helpText } from './command'
import { USAGE_ROWS, usageLines } from './usage'

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
