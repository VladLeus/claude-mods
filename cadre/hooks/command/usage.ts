/**
 * The usage text of /cadre, a layer 9 module: one row per command with what it shows, the renderer that pads each
 * command to one column (SHOULD 8), and the help text with an unknown input named first. It imports nothing, so
 * register answers `/cadre` and `/cadre help` with the text here.
 */

/** Width, in characters, the command column is padded to in the usage lines; the tests share it. */
export const COMMAND_COLUMN = 30

/**
 * The commands `/cadre` lists, in this order, each as typed and with what it shows (SHOULD 8): usageLines pads every
 * command to the same column.
 */
export const USAGE_ROWS: readonly { command: string; text: string }[] = Object.freeze([
  { command: '/cadre detect', text: 'show which dev framework this repo uses, with evidence (read-only)' },
  { command: '/cadre detect --adapters', text: 'also show the contract cadre would drive each framework with' },
  { command: '/cadre init', text: 'guided setup: scan, propose roles, review the file plan, then write it' },
  { command: '/cadre init --dry-run', text: 'the same guided flow; prints the plan and writes nothing' },
  { command: '/cadre regen <id>', text: 're-render one role from its role.json and write its files' },
  { command: '/cadre regen <id> --dry-run', text: "print that role's plan and write nothing" },
  { command: '/cadre start <id>', text: "render a role's runtime files, then print and copy its launcher command" },
  {
    command: '/cadre start <id> --terminal',
    text: 'also open it in a new Terminal window, iTerm tab or tmux window (macOS)',
  },
  {
    command: '/cadre status <id>',
    text: "show from disk whether a role's autopilot run is done, running, stopped, not started or unknown",
  },
  { command: '/cadre epic <KEY> [title]', text: "create or reuse the epic's worktree and open its roles there" },
  { command: '/cadre epic done <KEY>', text: "remove a finished epic's worktree (clean, merged, no role running)" },
])

/**
 * The usage lines of these rows (SHOULD 8): the title, then each row indented two spaces with its command padded to
 * COMMAND_COLUMN and its text after it, so every text starts in the same column.
 */
export function usageLines(rows: readonly { command: string; text: string }[]): string[] {
  return ['cadre commands:', ...rows.map(row => `  ${row.command.padEnd(COMMAND_COLUMN)}${row.text}`)]
}

/**
 * The lines `/cadre` prints: a title, then each command and what it shows. A command that writes nothing says so,
 * and every row starts its description in the same column.
 */
export const USAGE_LINES: readonly string[] = usageLines(USAGE_ROWS)

/**
 * The reply to `/cadre` without a command, or with unknown input: the usage lines, preceded by an
 * `Unknown subcommand:` line when the input was not a known command.
 */
export function helpText(unknown: string | null): string {
  if (unknown === null) return USAGE_LINES.join('\n')

  return [`Unknown subcommand: ${unknown}`, ...USAGE_LINES].join('\n')
}
