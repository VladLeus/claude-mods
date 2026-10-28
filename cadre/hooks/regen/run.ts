/**
 * The regen entry, a layer 11 module: `/cadre regen <id> [--dry-run]` from its guard to its reply (D-68, D-99, D-142):
 * it reads the team and the scans, hands out what changed, plans the one role and writes it through the apply runner,
 * or replies with the plan of a dry run. It imports the repo guard, team, core, the regen steps and the types, so
 * register and the goldens run /cadre regen here.
 */
import type { HostIo, InitIo } from '../../types'
import { reportText } from '../core/text'
import { initGuard } from '../guards/repo'
import { regenApply, regenCancelledReply, regenHandout, regenPlan, regenReplyText } from '../init'
import { readTeam, regenBadRole } from '../team'
import { regenScans } from './side-read'

/**
 * How `/cadre regen <id>` runs (D-68, T-03-16): --dry-run prints the role's plan and holds no host, so it can neither
 * write nor run; plain regen writes that plan through `host`.
 */
export type RegenOptions =
  | { readonly id: string; readonly dryRun: true }
  | { readonly id: string; readonly dryRun: false; readonly host: HostIo }

/**
 * The reply of a regen cancelled at one of its questions: its reason logged as its own line, the one place it is
 * printed (A1), and regenCancelledReply of it, so the reply names it too (AUTO-PICK #19 Q7).
 */
function regenCancelReply(io: InitIo, reason: string): string {
  io.log(reportText(reason))

  return regenCancelledReply(reason)
}

/**
 * `/cadre regen <id> [--dry-run]` (D-68, D-99, D-142). Its guard (initGuard in the regen wording) never asks whether
 * anyone is there, so it also runs in `claude -p`. It then reads the team (readTeam) and refuses with an exact reply,
 * in this order: no `.cadre/cadre.json` (REGEN_NO_STATE); a cadre.json that cannot be read or is not valid, its stored
 * launcher folder included (REGEN_BAD_STATE); an id it does not list (regenNoRole); the first listed role.json, in
 * cadre.json order, that is missing, not valid or holds another id (regenBadRole); when the repo has no default
 * framework, the first listed role with none of its own (regenNeedsFramework, D-73); and last, read by its scans
 * (regenScans), a manifest that is not there (REGEN_NO_MANIFEST) or cannot be read, is too large or is not valid
 * (REGEN_BAD_MANIFEST, A2). Then it hands out what changed in the files and memories the role's records name
 * (regenHandout, G-02-1f Regen): in a session it asks about each new or changed item, and a dismissed or unanswered
 * question cancels with regenCancelledReply, its reason logged as its own line, before anything is written (AUTO-PICK
 * #19 Q7); where no one can be asked it asks and logs nothing and says what it left out. A role.json with no records
 * asks and logs nothing, as before. It plans that one role (regenPlan). --dry-run replies with the plan, the dropped
 * lines, a `warning:` line for each warning and the note that nothing was written; plain regen writes the plan
 * (regenApply): a conflicted file is kept and its `.cadre-new` copy written, as an unanswered conflict is (D-67),
 * cadre.json is never among its files, a manifest the plan keeps as a conflict is not written, and in a session the
 * improver pass runs on the rebuilt files (D-141). It then replies with the plan, the dropped lines, the warnings and
 * what the apply did (regenReplyText). ~/.claude.json is read only when cadre.json records the consent (readUserMcp,
 * A1), so the MCP denies init compiled from it stay. Plain regen and --dry-run differ in the first line and the ending,
 * and a dry run compares no private record (AUTO-PICK #19 Q5) and asks git nothing.
 */
export async function runRegen(io: InitIo, options: RegenOptions): Promise<string> {
  const guard = await initGuard(io, 'regen')
  if (guard.kind === 'refuse') return guard.text
  const { locations } = guard
  const { id } = options

  const team = await readTeam(io, locations.root, 'regen', id)
  if (team.kind === 'refuse') return team.text
  const { state, roles, texts } = team.value
  const role = roles.find(listed => listed.id === id)
  const roleJson = texts.get(id)
  // Fail closed: every listed role was read, so after the id check the role and its text are always there.
  if (role === undefined || roleJson === undefined) return regenBadRole(id)

  const scans = await regenScans(io, locations, state, roles)
  if (scans.kind === 'refuse') return scans.text
  const { setup } = scans.value.gathered
  const host = options.dryRun ? null : options.host
  const handed = await regenHandout(io, host, { id, role, locations, setup })
  if (handed.kind === 'cancelled') return regenCancelReply(io, handed.reason)

  const input = { id, state, roles, roleJson, locations, scans: scans.value, handed: handed.value }
  const planned = await regenPlan(io, input)
  if (options.dryRun) return regenReplyText(planned, id, null)
  const outcome = await regenApply(io, options.host, { locations, planned, handed: handed.value, setup })

  return regenReplyText(planned, id, outcome)
}
