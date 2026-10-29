/**
 * `/cadre start <id>` in the repo's root session (D-102, LNCH-04), a layer 11 module: runStart checks the repo, the
 * team, the launcher and claude, in that order, compiles the team, renders the role through renderRole, and hands over
 * the launcher command: printed, copied to the clipboard and, with `--terminal`, opened in a new terminal on macOS
 * (D-110, D-109). It runs through the InitIo and HostIo ports only, and never runs the launcher (D-108). It imports
 * generate/files, guards/repo, scan/gather, team, ui and the start modules; register and the goldens run it.
 */
import type { HostIo, InitIo, TerminalChoice } from '../../types'
import { desiredFiles } from '../generate/files'
import { repoGuard } from '../guards/repo'
import { scanWarnings } from '../scan/gather'
import { compileTeam, readTeam, regenBadRole } from '../team'
import { terminalHostOf } from '../ui/open'
import {
  clipboardRun,
  COPIED_LINE,
  launcherCommand,
  NOT_COPIED_LINE,
  TERMINAL_OPEN_TIMEOUT_MS,
  terminalPlan,
} from '../ui/terminal'
import { claudeRefusal } from './claude-version'
import { launcherDrift, launcherRead } from './launcher-check'
import { renderRole } from './render'

/**
 * The `--terminal` line below the copy line (D-109, D-126, D-132). The host is macOS when `/usr/bin/uname -s` exits 0
 * with `Darwin`; with that, and TMUX and TERM_PROGRAM as the host reads them, terminalPlan gives the argv to run, or
 * the refusal, which is the line. An open that exits 0 gives `Opened it in a new <name>.`, and one that cannot run or
 * exits non-zero gives `Could not open a new <name>: run the command above yourself.`
 */
async function terminalLine(
  host: HostIo,
  input: {
    readonly choice: Exclude<TerminalChoice, 'none'>
    readonly id: string
    readonly root: string
    readonly command: string
  },
): Promise<string> {
  const { isMacOs, tmux, termProgram } = await terminalHostOf(host)
  const plan = terminalPlan({ ...input, tmux, termProgram, isMacOs })
  if (plan.kind === 'refuse') return plan.text
  const open = await host.run(plan.argv, { timeoutMs: TERMINAL_OPEN_TIMEOUT_MS })
  if (open !== null && open.exitCode === 0) return `Opened it in a new ${plan.name}.`

  return `Could not open a new ${plan.name}: run the command above yourself.`
}

/**
 * The reply of a render that ran every step (D-102): what was asked for, the folder rendered with the number of links
 * it made, one `warning: ` line per warning, then the line that hands over the launcher and the launcher command, two
 * spaces in, and below the command the lines of `after`: the copy line, then the `--terminal` line when the switch
 * was given (D-110, D-109).
 */
function startReplyText(
  id: string,
  links: number,
  warnings: readonly string[],
  command: string,
  after: readonly string[],
): string {
  return [
    `cadre start ${id}`,
    `Rendered .cadre/${id}/.runtime/ (${links} ${links === 1 ? 'link' : 'links'}).`,
    ...warnings.map(warning => `warning: ${warning}`),
    `Run this in a terminal to start role ${id}:`,
    `  ${command}`,
    ...after,
  ].join('\n')
}

/**
 * `/cadre start <id>` in the repo's root session (D-102, LNCH-04). It refuses with one exact line, in this order: the
 * repo refusals of repoGuard (in the start wording); the team refusals of readTeam; the launcher refusals of
 * launcherRead (manifest, launcher missing, launcher changed); the claude refusals of claudeRefusal (D-107), run
 * before anything else is run; and the refusals of renderRole. It reads the team, checks the launcher and compiles
 * the team (compileTeam) itself, in the session's root; renderRole then renders the role's `.runtime/` for that same
 * root, with the MCP project entries of the root as resolved, then as given, and no epic (D-157): the settings, the MCP
 * config, the probe expectations, the links and the private instructions folder, the inbox when there is none, and the
 * stamp last. The reply names the folder; the scan warnings of the run, as regen prints them (scanWarnings, #54 A1);
 * the launcher warning of launcherDrift (#54 A3); every warning renderRole gives; and the launcher command
 * (startReplyText). Once the render has run every step, it copies the command through the host with clipboardRun, and
 * the line below the command is COPIED_LINE when pbcopy exits 0, else NOT_COPIED_LINE, which is not an error (D-110,
 * D-132); a refused or failed render copies nothing. With `--terminal` (`options.terminal` other than `none`), after
 * the copy it asks `/usr/bin/uname -s`, TMUX and TERM_PROGRAM, and opens the command where terminalPlan says, or prints
 * its refusal: the line of terminalLine follows the copy line, and the command is printed and copied in every case
 * (D-109, D-126, D-132). It never runs the launcher, and never starts a background session (D-108).
 */
export async function runStart(
  io: InitIo,
  host: HostIo,
  options: { readonly id: string; readonly terminal: TerminalChoice },
): Promise<string> {
  const { id, terminal } = options
  const guard = await repoGuard(io, 'start')
  if (guard.kind === 'refuse') return guard.text
  const { locations } = guard
  const team = await readTeam(io, locations.root, 'start', id)
  if (team.kind === 'refuse') return team.text
  const { state, roles } = team.value
  const launcher = await launcherRead(io, locations.root, id)
  if (launcher.kind === 'refuse') return launcher.text
  const claude = await claudeRefusal(host, locations.home)
  if (claude !== null) return claude

  const { gathered, scopes } = await compileTeam(io, locations, state, roles)
  const role = roles.find(candidate => candidate.id === id)
  const scope = scopes.get(id)
  // Fail closed: readTeam read every listed role and compileTeam compiled each one, so both are always there.
  if (role === undefined || scope === undefined) return regenBadRole(id)
  const codeDirs = gathered.repo.codeDirs
  const mcpRoots = [locations.root, locations.givenRoot]
  const render = await renderRole(io, host, { locations, state, role, scope, codeDirs, mcpRoots, epic: null })
  if (render.kind === 'refuse') return render.text
  const drift = launcherDrift(id, launcher.value, desiredFiles({ roles, scopes, state, only: id }))
  const scan = scanWarnings(locations, gathered)
  const warnings = [...scan, ...drift, ...render.warnings]
  const command = launcherCommand(locations.root, id)
  const copy = clipboardRun(command)
  const copied = await host.run(copy.argv, copy.options)
  const copyLine = copied !== null && copied.exitCode === 0 ? COPIED_LINE : NOT_COPIED_LINE
  if (terminal === 'none') return startReplyText(id, render.links, warnings, command, [copyLine])
  const opened = await terminalLine(host, { choice: terminal, id, root: locations.root, command })

  return startReplyText(id, render.links, warnings, command, [copyLine, opened])
}
