/**
 * The gather and render halves of /cadre start (D-102); renderRole, which gathers and renders one role for the root it
 * is given, the session's for /cadre start and an epic worktree for /cadre epic (D-157); and runStart, the command
 * itself, which checks the repo and the team, runs renderRole through the HostIo port and hands over the launcher
 * command: printed, copied to the clipboard and, with `--terminal`, opened in a new terminal on macOS (LNCH-04, D-110,
 * D-109).
 *
 * The gather half reads, through the InitIo and HostIo ports only, and never writes: the facts about the launching
 * user that a role launch needs (gatherLaunchUser, D-98), and the user's `~/.claude.json` under the stored consent
 * (readClaudeJson, D-58), from which runtimeMcpText renders a role's MCP config (D-93).
 *
 * The render half gives the ordered steps that write a role's per-launch files into `.cadre/<id>/.runtime/`, and the
 * role's private instructions folder under the config folder (privateFolderSteps), from its LaunchPlan (D-98) and the
 * texts of its MCP config and probe expectations. It reads and writes nothing: /cadre start stats and lists the paths
 * renderPaths names, then runs the steps renderSteps gives, in order, through the host. The stamp is always the last
 * step, and the launcher trusts it: it refuses to start when the stamp is missing or older than the role files or a
 * rendered file, so a render that stops part way never starts a session (LNCH-03).
 */
import type {
  CadreState,
  CompiledScope,
  HostIo,
  InitIo,
  InitLocations,
  PortEntry,
  PortStat,
  RoleSpec,
  TerminalChoice,
} from '../types'
import { compareText, sortedUnique } from './core/text'
import { desiredFiles } from './generate/files'
import { repoGuard } from './guards/repo'
import { isStepDone } from './host/steps'
import type { LaunchUser, OverlayLink } from './launch/links'
import { launchPlan } from './launch/plan'
import type { LaunchPlan } from './launch/plan'
import { PRIVATE_INSTRUCTIONS_LINK, privateInstructionsDir, roleMemoryDir } from './paths'
import { expectationsFor, probeExpectationsText } from './probe'
import { scanWarnings } from './scan/gather'
import { claudeRefusal } from './start/claude-version'
import { gatherLaunchUser } from './start/gather-user'
import { launcherDrift, launcherRead, renderFailedReply } from './start/launcher-check'
import { readClaudeJson, runtimeMcpText } from './start/mcp-config'
import { renderPaths, renderSteps, repoRelative, runtimeFolder, stampText } from './start/render-plan'
import type { RenderInput } from './start/render-plan'
import { compileTeam, readTeam, regenBadRole } from './team'
import { terminalHostOf } from './ui/open'
import {
  clipboardRun,
  COPIED_LINE,
  launcherCommand,
  NOT_COPIED_LINE,
  TERMINAL_OPEN_TIMEOUT_MS,
  terminalPlan,
} from './ui/terminal'

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
 * The disk a render is planned from: the stat of each path renderPaths names, asked with resolve, and the listing of
 * each folder it names. A folder the host cannot list gets no listing, so renderSteps counts it as empty.
 */
async function renderDiskOf(
  io: InitIo,
  paths: { readonly stats: readonly string[]; readonly listings: readonly string[] },
): Promise<Pick<RenderInput, 'stats' | 'listings'>> {
  const stats = new Map<string, PortStat | null>()
  for (const path of paths.stats) stats.set(path, await io.stat(path))
  const listings = new Map<string, readonly PortEntry[]>()
  for (const path of paths.listings) {
    const entries = await io.list(path)
    if (entries !== null) listings.set(path, entries)
  }

  return { stats, listings }
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
 * The role's LaunchPlan with the link `.cadre/<id>/.runtime/private-instructions` to its private instructions folder,
 * `<role memory folder>/instructions` (D-140 q1-b, q2-a), added in path order: the launcher adds that link with
 * `--add-dir`, so every render makes it, and the folder behind it (privateFolderSteps), for a role with no private part
 * too. The folder lies in the user's config folder, apart from the memory files, and never in the repo.
 */
function withPrivateInstructions(plan: LaunchPlan, user: LaunchUser, id: string): LaunchPlan {
  const link: OverlayLink = {
    path: `${runtimeFolder(user.root, id)}/${PRIVATE_INSTRUCTIONS_LINK}`,
    target: privateInstructionsDir(user, id),
  }

  return { ...plan, links: [...plan.links, link].sort((a, b) => compareText(a.path, b.path)) }
}

/**
 * What makes a render an epic render (D-157): /cadre epic renders a role for its epic worktree, from the team of the
 * main checkout.
 */
export type EpicRender = {
  /** The main checkout's root, where the team, the manifest and the launchers were read. */
  readonly mainRoot: string
  /** The text of the role's epic kickoff, written to `.runtime/kickoff.txt` right before the stamp (D-158). */
  readonly kickoff: string
}

/**
 * The CLAUDE.md files an epic role must not load (RESEARCH Pitfall 1): `paths`, which the host lists for the ancestors
 * of the session's folder, the main checkout, so it does not name the worktree's own, and `<worktree>/CLAUDE.md` and
 * `<worktree>/.claude/CLAUDE.md`, sorted and once each. Excluding a path that does not exist is harmless (A2).
 */
export function worktreeClaudeMd(paths: readonly string[], worktree: string): string[] {
  return sortedUnique([...paths, `${worktree}/CLAUDE.md`, `${worktree}/.claude/CLAUDE.md`])
}

/**
 * The render half of /cadre start for one role (D-102), which /cadre epic runs too, once per role, for its epic
 * worktree (D-157): `locations` give the root it renders for, and the caller reads and compiles the team (`state`, the
 * role, its compiled scope and the repo's code dirs) in the session's own root. It gathers the launching user for the
 * root (gatherLaunchUser), builds the role's LaunchPlan with its private instructions link (withPrivateInstructions,
 * D-140 q1-b), renders the MCP config from `~/.claude.json` under the stored consent with the project entries of
 * `mcpRoots`, then of the user's `mainRoot` when set (03.1-W3 S1), in that order (runtimeMcpText), and the probe
 * expectations, and renders `<root>/.cadre/<id>/.runtime/`: renderPaths names what to stat and list, renderSteps plans
 * the steps from the root the LaunchPlan was built for, and every refusal comes before anything is written. Each step
 * then runs through the host in order, and the first one that fails stops the render with renderFailedReply and no
 * stamp written, so the launcher refuses to start (LNCH-03).
 * It refuses with the refusals of gatherLaunchUser, a role memory folder level it would write through included
 * (privateFolderRefusal, 02-GAPS-B3 C5), a render refusal, or that failure. Else it gives the number of links the
 * render made and every warning of the launch user, the LaunchPlan, the MCP config and the render, in that order.
 * `epic` is null for /cadre start, which changes nothing. For /cadre epic it names the main checkout and the role's
 * epic kickoff, which the render writes to `.runtime/kickoff.txt` as the step before the stamp (D-158), and the user
 * the LaunchPlan is built for also excludes the worktree's own CLAUDE.md files (worktreeClaudeMd, RESEARCH Pitfall 1)
 * and carries the main checkout as `mainRoot`, whose code dirs get the exact denies the worktree's get (Pitfall 2).
 */
export async function renderRole(
  io: InitIo,
  host: HostIo,
  input: {
    readonly locations: InitLocations
    readonly state: CadreState
    readonly role: RoleSpec
    readonly scope: CompiledScope
    readonly codeDirs: readonly string[]
    readonly mcpRoots: readonly string[]
    readonly epic: EpicRender | null
  },
): Promise<
  | { readonly kind: 'refuse'; readonly text: string }
  | { readonly kind: 'ok'; readonly links: number; readonly warnings: readonly string[] }
> {
  const { locations, state, role, scope } = input
  const { id } = role
  const launch = await gatherLaunchUser(io, host, {
    locations,
    launchStart: state.launchStart,
    codeDirs: input.codeDirs,
    role,
  })
  if (launch.kind === 'refuse') return { kind: 'refuse', text: launch.text }
  const gathered = launch.user
  const user: LaunchUser =
    input.epic === null
      ? gathered
      : {
          ...gathered,
          claudeMd: worktreeClaudeMd(gathered.claudeMd, locations.root),
          mainRoot: input.epic.mainRoot,
        }
  const plan = withPrivateInstructions(launchPlan(role, scope, user), user, id)
  const claudeJson = await readClaudeJson(io, locations, state.readUserMcp)
  const mcpRoots = [...input.mcpRoots, ...(user.mainRoot === undefined ? [] : [user.mainRoot])]
  const mcp = runtimeMcpText(role, claudeJson, mcpRoots, state.readUserMcp)
  const expectationsText = probeExpectationsText(expectationsFor(scope, roleMemoryDir(user, id)))
  const stamp = stampText((await io.cadreVersion()) ?? 'unknown')
  const disk = await renderDiskOf(io, renderPaths(user.root, id, plan, { kickoff: input.epic !== null }))
  const texts = { mcpText: mcp.text, expectationsText, stampText: stamp }
  // Only an epic render names a kickoff, so a /cadre start render never writes or removes one (D-168).
  const kickoff = input.epic === null ? {} : { kickoff: input.epic.kickoff }
  const render = renderSteps({ root: user.root, id, plan, ...texts, ...disk, memories: launch.memories, ...kickoff })
  if (render.refusal !== null) return { kind: 'refuse', text: render.refusal }

  for (const step of render.steps) {
    if (!(await isStepDone(host, step))) {
      return { kind: 'refuse', text: renderFailedReply(id, repoRelative(user.root, step.path)) }
    }
  }
  const links = render.steps.filter(step => step.kind === 'link').length

  return { kind: 'ok', links, warnings: [...launch.warnings, ...plan.warnings, ...mcp.warnings, ...render.warnings] }
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
