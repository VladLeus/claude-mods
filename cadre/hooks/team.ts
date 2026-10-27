/**
 * The team a command works from, a layer 7 module: it reads `.cadre/cadre.json` and every role.json it lists, refusing
 * with an exact reply, and compiles the scope of every role on its framework. /cadre start, status, epic, regen and
 * init read and compile the team here; it never imports init, so none of them reaches into init for the team.
 */
import type {
  CadreState,
  CompiledScope,
  FrameworkId,
  HunkOp,
  InitIo,
  InitLocations,
  LaunchStart,
  McpRoute,
  RoleSpec,
  ScopeContext,
  SetupScan,
} from '../types'
import { idsOrNone } from './core/text'
import { isAttendedFromConfig, isUnmetHunk } from './framework/gsd/hunks'
import { ADAPTERS } from './framework/registry'
import type { CommandWord } from './guards/repo'
import { cadreStatePath, isRepoFolder, roleJsonPath } from './paths'
import { parseRoleJson } from './roles'
import { MAX_READ_BYTES } from './scan/facts/normalize'
import { gatherScans } from './scan/gather'
import type { Gathered } from './scan/gather'
import { readRepoFile } from './scan/port-read'
import { compileScope } from './scope'
import { parseCadreState } from './state/cadre-files'

/** The framework a role runs on: its own, else the repo default, else `none`, the built-in fallback (D-73, D-17). */
export function resolvedFramework(role: RoleSpec, repoDefault: FrameworkId | null): FrameworkId {
  return role.framework ?? repoDefault ?? 'none'
}

/**
 * The MCP route of every role (D-104): merged, so /fleet keeps working in role sessions; a denied server gets tool
 * denies and a deniedMcpServers entry in the runtime settings, which the card labels best-effort (D-124, #39).
 */
export const MCP_ROUTE: McpRoute = 'merged'

/**
 * The frameworks whose roles the answered hunks leave attended (ROLE-04, A5): a framework is attended when its adapter
 * offers autonomy hunks for this setup and a hunk on that adapter's config file is unmet (isUnmetHunk). A framework
 * with no config file to change is never attended this way.
 */
function attendedByHunks(setup: SetupScan, hunks: readonly HunkOp[]): ReadonlySet<FrameworkId> {
  const attended = new Set<FrameworkId>()
  for (const adapter of ADAPTERS) {
    const offered = adapter.autonomyHunks(setup)
    if (offered === null) continue
    if (hunks.some(hunk => hunk.file === offered.file && isUnmetHunk(hunk))) attended.add(adapter.id)
  }

  return attended
}

/**
 * One compiled scope per role, by role id (ROLE-06, D-80): each role is compiled for the framework it runs on
 * (resolvedFramework), with the setup and the code dirs of the scans, the MCP route of every role (MCP_ROUTE, D-104),
 * where the launchers start, so the card tells what loads there (D-122), the whole team for the decision chain, and as
 * attended when its framework is in `attended`.
 */
export function compileAll(
  roles: readonly RoleSpec[],
  repoDefault: FrameworkId | null,
  gathered: Gathered,
  attended: ReadonlySet<FrameworkId>,
  launchStart: LaunchStart,
): ReadonlyMap<string, CompiledScope> {
  return new Map(
    roles.map((role): [string, CompiledScope] => {
      const framework = resolvedFramework(role, repoDefault)
      const context: ScopeContext = {
        framework,
        setup: gathered.setup,
        codeDirs: gathered.repo.codeDirs,
        isAttended: attended.has(framework),
        mcpRoute: MCP_ROUTE,
        launchStart,
        roles,
      }

      return [role.id, compileScope(role, context)]
    }),
  )
}

/**
 * The scope of every role, which init shows and plans from (ROLE-06, D-78, D-104): compileScope with the role's own
 * framework or the repo default, the setup and the code dirs of the scans, MCP_ROUTE, where the launchers start (D-122)
 * and the whole team. A role is attended when an unmet hunk is on its framework's config file (A5). Keyed by role id,
 * in role order.
 */
export function scopesFor(
  roles: readonly RoleSpec[],
  repoDefault: FrameworkId | null,
  gathered: Gathered,
  hunks: readonly HunkOp[],
  launchStart: LaunchStart,
): ReadonlyMap<string, CompiledScope> {
  return compileAll(roles, repoDefault, gathered, attendedByHunks(gathered.setup, hunks), launchStart)
}

/** The cadre commands that work from an applied team, so they need `.cadre/cadre.json`. */
export type TeamCommand = Exclude<CommandWord, 'init'>

/**
 * The reply when a command that works from the team finds no `.cadre/cadre.json`, worded for that command: there is
 * nothing to work from until init has run (D-68).
 */
export function noStateReply(command: TeamCommand): string {
  return `cadre ${command} needs .cadre/cadre.json from /cadre init: run /cadre init first.`
}

/** The reply when regen finds no `.cadre/cadre.json`: there is nothing to re-render from until init has run (D-68). */
export const REGEN_NO_STATE = noStateReply('regen')

/**
 * The reply when `.cadre/cadre.json` is there but cannot be used: it cannot be read, is too large or is not valid repo
 * state (parseCadreState), or the launcher folder it stores is not a folder inside the repo (T-02-36).
 */
export const REGEN_BAD_STATE = '.cadre/cadre.json is not valid: fix it, or run /cadre init again.'

/** The reply when `.cadre/cadre.json` does not list the role asked for: it names the roles listed, or none. */
export function regenNoRole(id: string, roles: readonly string[]): string {
  return `no role ${id} in .cadre/cadre.json (roles: ${idsOrNone(roles)})`
}

/**
 * The reply when a listed role's role.json is missing, cannot be read, is not valid (parseRoleJson) or holds the id of
 * another folder (T-02-36).
 */
export function regenBadRole(id: string): string {
  return `.cadre/${id}/role.json is missing or not valid: fix it, or run /cadre init again.`
}

/** The reply when a role stores no framework and the repo has no default framework to run it on (D-73, D-97d). */
export function regenNeedsFramework(id: string): string {
  return (
    `role ${id} has no framework and this repo has no default: set "framework" in .cadre/${id}/role.json to gsd, ` +
    `superpowers or none, then run /cadre regen ${id} again.`
  )
}

/** What a read of regen, /cadre start or /cadre status gives: the value it found, or the exact reply that refuses. */
export type RegenRead<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'refuse'; readonly text: string }

/** A regen read that refuses the run with this reply. */
export function regenRefusal(text: string): RegenRead<never> {
  return { kind: 'refuse', text }
}

/**
 * The repo state regen re-renders from, and /cadre start and /cadre status work from (D-68, T-02-36):
 * `.cadre/cadre.json` read through readRepoFile, so a link out of the repo is never read, and checked by
 * parseCadreState. A missing file refuses with noStateReply, worded for `command`; a file that cannot be read, is too
 * large or is not valid state refuses with REGEN_BAD_STATE, and so does a stored launcher folder that is not a folder
 * inside the repo (isRepoFolder).
 */
async function regenState(
  io: InitIo,
  root: string,
  command: TeamCommand,
): Promise<RegenRead<CadreState>> {
  const read = await readRepoFile(io, root, cadreStatePath(), MAX_READ_BYTES)
  if (read.state === 'absent') return regenRefusal(noStateReply(command))
  const state = read.state === 'text' ? parseCadreState(read.text) : null
  if (state === null) return regenRefusal(REGEN_BAD_STATE)
  const start = state.launchStart
  if (start.kind === 'dir' && !(await isRepoFolder(io, root, start.path))) return regenRefusal(REGEN_BAD_STATE)

  return { kind: 'ok', value: state }
}

/** The team regen read: every listed role, and the role.json text each was parsed from, keyed by its id (A5). */
type RegenTeam = {
  readonly roles: readonly RoleSpec[]
  readonly texts: ReadonlyMap<string, string>
}

/**
 * Every role `.cadre/cadre.json` lists, in its order, read back from `.cadre/<id>/role.json` through readRepoFile and
 * parseRoleJson (D-68, T-02-36), with the exact text each was parsed from (A5). The first role whose file is missing,
 * cannot be read, is not valid or holds another id than its folder refuses with regenBadRole, so no role is
 * re-rendered beside a half-known team.
 */
async function regenRoles(io: InitIo, root: string, ids: readonly string[]): Promise<RegenRead<RegenTeam>> {
  const roles: RoleSpec[] = []
  const texts = new Map<string, string>()
  for (const id of ids) {
    const read = await readRepoFile(io, root, roleJsonPath(id), MAX_READ_BYTES)
    if (read.state !== 'text') return regenRefusal(regenBadRole(id))
    const role = parseRoleJson(read.text)
    if (role === null || role.id !== id) return regenRefusal(regenBadRole(id))
    roles.push(role)
    texts.set(id, read.text)
  }

  return { kind: 'ok', value: { roles, texts } }
}

/**
 * The team a command works from (D-68, A5): the repo state of `.cadre/cadre.json`, every role it lists in its order,
 * read back from the role's role.json, and the exact role.json text each role was parsed from, keyed by role id.
 */
export type TeamState = {
  readonly state: CadreState
  readonly roles: readonly RoleSpec[]
  readonly texts: ReadonlyMap<string, string>
}

/**
 * The team regen, /cadre start and /cadre status read before they plan or launch anything (D-68, T-02-36). It refuses
 * with an exact reply in this order, which is runRegen's: no `.cadre/cadre.json` (noStateReply, worded for
 * `command`); a cadre.json that cannot be read or is not valid, its stored launcher folder included (REGEN_BAD_STATE);
 * an `id` it does not list (regenNoRole); the first listed role.json, in cadre.json order, that is missing, not valid
 * or holds another id (regenBadRole); and, when the repo has no default framework, the first listed role with none of
 * its own (regenNeedsFramework, D-73). A null `id` (/cadre epic, which asks for no one role) reads the whole team, so
 * the regenNoRole check is skipped. It asks nothing and writes nothing.
 */
export async function readTeam(
  io: InitIo,
  root: string,
  command: TeamCommand,
  id: string | null,
): Promise<RegenRead<TeamState>> {
  const loaded = await regenState(io, root, command)
  if (loaded.kind === 'refuse') return loaded
  const state = loaded.value
  if (id !== null && !state.roles.includes(id)) return regenRefusal(regenNoRole(id, state.roles))

  const team = await regenRoles(io, root, state.roles)
  if (team.kind === 'refuse') return team
  const { roles, texts } = team.value
  const unframed = state.framework === null ? roles.find(role => role.framework === undefined) : undefined
  if (unframed !== undefined) return regenRefusal(regenNeedsFramework(unframed.id))

  return { kind: 'ok', value: { state, roles, texts } }
}

/**
 * The frameworks whose roles the current config leaves attended, with no question asked (regen and /cadre start
 * through compileTeam, and apply once the hunks ran, D-70, D-72, D-120, A5): for each adapter in ADAPTERS order that a
 * role runs on and that offers autonomy hunks for this setup, its config file is read through readRepoFile, and the
 * framework is attended while a required proposal is not at its target (isAttendedFromConfig). A config that cannot
 * be read attends the roles (fail closed).
 */
export async function attendedByConfig(
  io: InitIo,
  root: string,
  frameworks: readonly FrameworkId[],
  setup: SetupScan,
): Promise<ReadonlySet<FrameworkId>> {
  const attended = new Set<FrameworkId>()
  for (const adapter of ADAPTERS) {
    if (!frameworks.includes(adapter.id)) continue
    const offered = adapter.autonomyHunks(setup)
    if (offered === null) continue
    const config = await readRepoFile(io, root, offered.file, MAX_READ_BYTES)
    if (isAttendedFromConfig(offered.proposals, config)) attended.add(adapter.id)
  }

  return attended
}

/**
 * The scans and the compiled scopes of a team, as regen and /cadre start use them (D-68, D-70, D-72): the scans of one
 * run (gatherScans), which read ~/.claude.json only when cadre.json records the consent (readUserMcp, A1); attended
 * judged from the config on disk with no question asked (attendedByConfig); and every role compiled on its own
 * framework or the repo default, for cadre.json's launch start (compileAll, D-122).
 */
export async function compileTeam(
  io: InitIo,
  locations: InitLocations,
  state: CadreState,
  roles: readonly RoleSpec[],
): Promise<{ readonly gathered: Gathered; readonly scopes: ReadonlyMap<string, CompiledScope> }> {
  const gathered = await gatherScans(io, locations, state.readUserMcp)
  const frameworks = roles.map(role => resolvedFramework(role, state.framework))
  const attended = await attendedByConfig(io, locations.root, frameworks, gathered.setup)

  return { gathered, scopes: compileAll(roles, state.framework, gathered, attended, state.launchStart) }
}
