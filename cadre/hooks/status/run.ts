/**
 * `/cadre status <id>` (D-111, D-131, LNCH-06), a layer 11 module: whether a role's autopilot run is done, running,
 * stopped, not started or unknown, read only from files on disk, never from what a model says, so the end-to-end check
 * has a done signal it can trust (SC3). The session id changes on every autopilot restart, so the role's session is
 * found by its name `cadre-<id>` (status/session-find); then that session's autopilot status file and log are read
 * (status/autopilot-files) and reported, with the role's newest handoff and, for a role on the built-in framework,
 * whether its DONE.md marker is there (status/report, D-17).
 *
 * It reads autopilot's and agent-fleet's files by their on-disk format and never imports either mod. It runs in the
 * root session or in `claude -p`, asks nothing, writes nothing (its host is `Pick<HostIo, 'run'>`), and runs only the
 * git checkout probe and `/usr/bin/grep` over a transcript. register and the goldens run it.
 */
import type { HostIo, InitIo } from '../../types'
import { GIT_TIMEOUT_MS } from '../git/argv'
import { CHECKOUT_ARGV, checkoutOf } from '../git/checkout'
import { repoGuard } from '../guards/repo'
import { readTeam, regenBadRole, resolvedFramework } from '../team'
import { NO_SESSION_RUN, runOf } from './autopilot-files'
import { handoffOf, hasDoneMarker, statusReportText } from './report'
import { sessionOf, startFolderOf } from './session-find'

/**
 * `/cadre status <id>` (D-111, D-131), in the root session or in `claude -p`. It refuses with the shared replies only:
 * repoGuard's, worded for status, then readTeam's (no `.cadre/cadre.json`, an id cadre.json does not list, a role.json
 * that is not valid). Then it looks for the role's session by its name (sessionOf): the newest of the start folder's
 * transcripts under `<userDir>/projects/` whose title grep (titleGrepArgv, run through the host) gives `cadre-<id>`,
 * else its fleet beat. With no session the run is not started; else its state comes from the session's autopilot
 * status file and log (runOf, statusStateOf). The report adds the newest handoff under the folder the session started
 * in, or the start folder when no session was found (handoffOf), and, for a role whose framework (its own, else
 * cadre.json's) is the built-in one, whether its DONE.md marker is there (D-17). In a linked worktree, where
 * CHECKOUT_ARGV and checkoutOf name the main checkout, the team is read from the main checkout, so status works there
 * under every git policy, while the session, its run, its handoff and its DONE.md stay the worktree's own (D-151). It
 * asks nothing and writes nothing: it is given only the host's run, for the checkout probe and the title grep, so it
 * cannot write (T-03-01, #63 A3).
 */
export async function runStatus(
  io: InitIo,
  host: Pick<HostIo, 'run'>,
  options: { readonly id: string },
): Promise<string> {
  const { id } = options
  const guard = await repoGuard(io, 'status')
  if (guard.kind === 'refuse') return guard.text
  const { locations } = guard
  const checkout = checkoutOf(await host.run(CHECKOUT_ARGV(locations.root), { timeoutMs: GIT_TIMEOUT_MS }))
  const teamRoot = checkout.kind === 'linked' && checkout.main !== null ? checkout.main : locations.root
  const team = await readTeam(io, teamRoot, 'status', id)
  if (team.kind === 'refuse') return team.text
  const { state, roles } = team.value
  const role = roles.find(candidate => candidate.id === id)
  // Fail closed: readTeam read every role cadre.json lists, the one asked for included, so it is always there.
  if (role === undefined) return regenBadRole(id)

  const startFolder = startFolderOf(locations.root, state.launchStart)
  const found = await sessionOf(io, host, { locations, id, startFolder })
  const run = found === null ? NO_SESSION_RUN : await runOf(io, locations.givenHome, found.sessionId)
  const isBuiltin = resolvedFramework(role, state.framework) === 'none'

  return statusReportText({
    id,
    state: run.state,
    sessionId: found?.sessionId ?? null,
    foundBy: found?.foundBy ?? null,
    lastLog: run.lastLog,
    handoff: await handoffOf(io, found === null ? startFolder : found.folder, id),
    doneMarker: isBuiltin ? await hasDoneMarker(io, locations.root, id) : null,
  })
}
