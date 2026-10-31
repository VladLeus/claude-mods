import { t } from '../locales/t'
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
  { command: t('command.usage.usageRows'), text: t('command.usage.usageRows2') },
  { command: t('command.usage.usageRows3'), text: t('command.usage.usageRows4') },
  { command: t('command.usage.usageRows5'), text: t('command.usage.usageRows6') },
  { command: t('command.usage.usageRows7'), text: t('command.usage.usageRows8') },
  { command: t('command.usage.usageRows9'), text: t('command.usage.usageRows10') },
  { command: t('command.usage.usageRows11'), text: t('command.usage.usageRows12') },
  { command: t('command.usage.usageRows13'), text: t('command.usage.usageRows14') },
  {
    command: t('command.usage.usageRowsCommand'),
    text: t('command.usage.usageRowsText'),
  },
  {
    command: t('command.usage.usageRowsCommand2'),
    text: t('command.usage.usageRowsText2'),
  },
  { command: t('command.usage.usageRows15'), text: t('command.usage.usageRows16') },
  { command: t('command.usage.usageRows17'), text: t('command.usage.usageRows18') },
])

/**
 * The usage lines of these rows (SHOULD 8): the title, then each row indented two spaces with its command padded to
 * COMMAND_COLUMN and its text after it, so every text starts in the same column.
 */
export function usageLines(rows: readonly { command: string; text: string }[]): string[] {
  return [t('command.usage.usageLines'), ...rows.map(row => `  ${row.command.padEnd(COMMAND_COLUMN)}${row.text}`)]
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

  return [t('command.usage.helpText', { unknown }), ...USAGE_LINES].join('\n')
}
