/**
 * The team hierarchy a role session sends through, a layer 11 module: the role ids of cadre.json and each role's
 * parent as /cadre epic orders them (epicParentOf), read through readTeam.
 */
import type { InitIo, TeamView } from '../../types'
import { standIn } from '../roles/template'
import { readTeam } from '../team'
import { epicParentOf } from './pick'

/** The team view of the repo at `root`; null when the team cannot be read. With no PM, pm and every parent are null. */
export async function teamViewOf(io: InitIo, root: string): Promise<TeamView | null> {
  const read = await readTeam(io, root, 'start', null)
  if (read.kind === 'refuse') return null
  const { state, roles } = read.value
  const pmId = standIn('pm', roles)
  const parents = Object.fromEntries(
    roles.map((role): [string, string | null] => [role.id, pmId === null ? null : epicParentOf(role, roles, pmId)]),
  )

  return { ids: state.roles, parents, pm: pmId }
}
