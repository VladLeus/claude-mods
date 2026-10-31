/**
 * The role render of /cadre start and /cadre epic (D-102, D-157), a layer 10 module: renderRole renders one role's
 * runtime folder `.runtime/` for the root it is given, the session's for /cadre start and an epic worktree for
 * /cadre epic. It gathers the launching user there, builds the role's LaunchPlan with its private instructions link,
 * renders the MCP config and the probe expectations, and runs the render steps through the HostIo port, each refusal
 * before anything is written. It imports core, host/steps, launch, paths, probe and the start modules below it; the
 * start command and epic read it.
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
} from '../../types'
import { compareText, sortedUnique } from '../core/text'
import { isStepDone } from '../host/steps'
import type { LaunchUser, OverlayLink } from '../launch/links'
import { launchPlan } from '../launch/plan'
import type { LaunchPlan } from '../launch/plan'
import { PRIVATE_INSTRUCTIONS_LINK, privateInstructionsDir, roleMemoryDir } from '../paths'
import { expectationsFor, probeExpectationsText } from '../probe/probe'
import { gatherLaunchUser } from './gather-user'
import { renderFailedReply } from './launcher-check'
import { readClaudeJson, runtimeMcpText } from './mcp-config'
import { renderPaths, renderSteps, repoRelative, runtimeFolder, stampText } from './render-plan'
import type { RenderInput } from './render-plan'

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
  // The roots gatherLaunchUser kept the user folder outside of (WF-S4): ~/.claude.json follows the same rule (SR-1).
  const mainRoots = gathered.mainRoot === undefined ? [] : [gathered.mainRoot]
  const userRoots = [locations.root, locations.givenRoot, ...mainRoots]
  const claudeJson = await readClaudeJson(io, locations, state.readUserMcp, userRoots)
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
