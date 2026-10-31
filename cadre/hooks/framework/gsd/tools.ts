/**
 * GSD's tool resolver, a layer 2 module in GSD's framework folder: the one table that turns a logical GSD tool into its
 * script, and the real command of a tool call, which only a user-level GSD dir turns into an argv (D-71, D-72, D-28).
 * It imports paths and the types, so init and apply resolve GSD tool calls here.
 */
import type { ToolCommand } from '../../../types'
import { t } from '../../locales/t'
import { displayPath, isSafeConfigDir, trimSlash } from '../../paths'

/** What resolveToolCommand needs: the raw user-level GSD dir, and the folders a path is shown relative to. */
export type GsdToolContext = {
  /** The absolute user-level GSD dir, used raw for the argv and never printed; null when there is none (D-72). */
  readonly userDir: string | null
  readonly home: string | null
  readonly root: string
  readonly configDir: string | null
}

/** The script of each logical tool, relative to its GSD dir (D-71): the one table that turns a tool into a path. */
export const TOOL_SCRIPTS: Readonly<Record<ToolCommand['tool'], string>> = Object.freeze({
  'gsd-tools': 'bin/gsd-tools.cjs',
})

/** Where the repo's own GSD copy lives. The command for it is printed for the person and never run (D-28, D-72). */
const REPO_GSD_DIR = '.claude/gsd-core'

/** An argument cadre hands to a tool: letters, digits, dot, underscore and hyphen only, so no shell text gets in. */
const PLAIN_WORD = /^[A-Za-z0-9._-]+$/

/** The display of a command that was refused because an argument is not a plain word. */
const REFUSED_DISPLAY = t('framework.gsd.tools.refusedDisplay')

/**
 * The real command for a logical tool call (D-71). Only a user-level GSD dir becomes an argv, `node <dir>/<script>
 * <args>` with the raw dir, and its display form shows the dir as `~/...` (or `$CLAUDE_CONFIG_DIR/...`). Without one,
 * or with a dir that is not an absolute path free of empty, `.` and `..` segments, the result has no argv and the
 * display is the repo-local command for the person to run from the repo root: cadre never runs the repo's own GSD copy
 * (T-02-21, D-28, D-72). An argument that is not a plain word refuses the command. Nothing here runs anything.
 */
export function resolveToolCommand(
  command: ToolCommand,
  gsd: GsdToolContext,
): { readonly argv: readonly string[] | null; readonly display: string } {
  if (!command.args.every(arg => PLAIN_WORD.test(arg))) return { argv: null, display: REFUSED_DISPLAY }
  const script = TOOL_SCRIPTS[command.tool]
  const userDir = trimSlash(gsd.userDir)
  if (userDir === null || !isSafeConfigDir(userDir)) {
    return { argv: null, display: ['node', `${REPO_GSD_DIR}/${script}`, ...command.args].join(' ') }
  }
  const path = `${userDir}/${script}`
  const shown = displayPath(path, gsd.home, gsd.root, gsd.configDir)

  return { argv: ['node', path, ...command.args], display: ['node', shown, ...command.args].join(' ') }
}
