/** The team hierarchy a role session sends through, a layer 11 module. */
import type { InitIo, TeamView } from '../../types'

export async function teamViewOf(_io: InitIo, _root: string): Promise<TeamView | null> {
  return { ids: [], parents: {} }
}
