/**
 * The team hierarchy a role session sends through, a layer 11 module: the role ids of cadre.json, each role's parent
 * as /cadre epic orders them (epicParentOf), and the repo's frameworks and sizing, read through readTeam.
 */
import type { InitIo, TeamView } from '../../types'
import { repoFrameworks } from '../core/framework-id'
import { defaultSizing } from '../messages/sizing'
import { standIn } from '../roles/template'
import { readTeam } from '../team'
import { epicParentOf } from './pick'

/**
 * The team view of the repo at `root`; null when the team cannot be read. With no PM, pm and every parent are null.
 * With no sizing block, the sizing is the default for the repo's frameworks.
 */
export async function teamViewOf(io: InitIo, root: string): Promise<TeamView | null> {
  const read = await readTeam(io, root, 'start', null)
  if (read.kind === 'refuse') return null
  const { state, roles } = read.value
  const pmId = standIn('pm', roles)
  const parents = Object.fromEntries(
    roles.map((role): [string, string | null] => [role.id, pmId === null ? null : epicParentOf(role, roles, pmId)]),
  )
  const frameworks = repoFrameworks(state)

  return { ids: state.roles, parents, pm: pmId, sizing: state.sizing ?? defaultSizing(frameworks), frameworks }
}
