/**
 * The plan side of init (PLAN-01, PLAN-03, PLAN-04, D-67, D-230, G-02-1f), a layer 10 module, its pure parts: the repo
 * parts each role was given (repoPartsOf), the role.json records regen compares against (withRepoRecords), what each
 * role is owed outside the repo (privatesOf), and PlanStepInput, what the plan of a draft is made from; init/run makes
 * the plan itself (planStep), which reads the disk. Pure: it imports apply, core, launch, records and the types, and
 * never imports init/machine or init/run.
 */
import type {
  CompiledScope,
  FrameworkId,
  GitPolicy,
  HunkOp,
  InitLocations,
  InstructionHandout,
  InstructionPart,
  LaunchStart,
  RepoScan,
  RoleSpec,
} from '../../types'
import type { OwedPrivate } from '../apply/run'
import { compareText } from '../core/text'
import { isPartsFlowRole } from '../launch/links'
import { partRecord, withPartRecords } from '../records'

/**
 * The parts each role was given that were read from the repo, by role id (G-02-1f Storage split): for a parts
 * hand-out, every part of every topic the role was given, with source `repo`, in read order; a role given only global
 * parts maps to none. Empty for the whole-file questions and for none. A part of the global CLAUDE.md is left out, so
 * it never reaches a file in the repo (T-02-69); memories are not parts.
 */
export function repoPartsOf(handout: InstructionHandout): ReadonlyMap<string, readonly InstructionPart[]> {
  if (handout.kind !== 'parts') return new Map()
  const { scan, topics, given } = handout
  const roleIds = new Set(topics.flatMap(topic => given.get(topic.id) ?? []))

  return new Map(
    Array.from(roleIds, (roleId): [string, InstructionPart[]] => {
      const owned = topics.filter(topic => given.get(topic.id)?.includes(roleId) === true)
      const partIds = new Set(owned.flatMap(topic => topic.partIds))

      return [roleId, scan.parts.filter(part => part.source === 'repo' && partIds.has(part.id))]
    }),
  )
}

/**
 * The roles with the records regen compares against (G-02-1f Regen, AUTO-PICK #19 Q1): each parts-flow role
 * (isPartsFlowRole) records the repo parts `repoParts` gives it, and as not given every other repo part the read found
 * in the same files, both in read order, so its role.json names no global part and no memory (T-02-79); a role given
 * no repo part records none, and a whole-files role is left as it is.
 */
export function withRepoRecords(
  roles: readonly RoleSpec[],
  handout: InstructionHandout,
  repoParts: ReadonlyMap<string, readonly InstructionPart[]>,
): RoleSpec[] {
  const read = handout.kind === 'parts' ? handout.scan.parts.filter(part => part.source === 'repo') : []

  return roles.map(role => {
    if (!isPartsFlowRole(role)) return role
    const given = repoParts.get(role.id) ?? []
    const files = new Set(given.map(part => part.file))
    const notGiven = read.filter(part => files.has(part.file) && !given.includes(part))

    return withPartRecords(role, given.map(partRecord), notGiven.map(partRecord))
  })
}

/**
 * What each role of the team was given that is private (G-02-1f Storage split, D-140 q2-a; 02-GAPS-B3 C1): one entry
 * per role of the team, in role id order, the order of the role memory folders, for every hand-out kind, so every
 * Confirm writes both private files of every role and no role keeps a part or a memory it lost. For a parts hand-out,
 * every global part of the topics it was given, in read order, every memory it was given, in file-name order, and the
 * other global parts of the files its parts come from, which its record names as not given (AUTO-PICK #19 Q1), each
 * list empty for a role given nothing; the whole-file questions and none give every role empty lists. A part read from
 * the repo is never among them: those go to its built file (repoPartsOf).
 */
export function privatesOf(handout: InstructionHandout, roles: readonly RoleSpec[]): OwedPrivate[] {
  const ids = roles.map(role => role.id).sort(compareText)
  if (handout.kind !== 'parts') return ids.map(id => ({ id, parts: [], memories: [], partsNotGiven: [] }))
  const { scan, topics, given } = handout
  const isGiven = (itemId: string, roleId: string): boolean => given.get(itemId)?.includes(roleId) === true
  const globalParts = scan.parts.filter(part => part.source === 'global')

  return ids.map(id => {
    const partIds = new Set(topics.filter(topic => isGiven(topic.id, id)).flatMap(topic => topic.partIds))
    const parts = globalParts.filter(part => partIds.has(part.id))
    const files = new Set(parts.map(part => part.file))
    const notGiven = globalParts.filter(part => files.has(part.file) && !partIds.has(part.id))
    const memories = scan.memories.filter(memory => isGiven(memory.id, id))

    return { id, parts, memories, partsNotGiven: notGiven.map(partRecord) }
  })
}

/**
 * What planStep plans from (PLAN-01, D-105): the roles with their records, the repo default, the git policy, the
 * launcher start, the compiled scopes, the hunks, the repo scan, the session's locations and the consent answer.
 */
export type PlanStepInput = {
  readonly roles: readonly RoleSpec[]
  readonly repoDefault: FrameworkId | null
  readonly policy: GitPolicy
  readonly launchStart: LaunchStart
  readonly scopes: ReadonlyMap<string, CompiledScope>
  readonly hunks: readonly HunkOp[]
  readonly repo: RepoScan
  readonly locations: InitLocations
  readonly readUserMcp: boolean
  /** The parts each role was given, by role id (repoPartsOf); absent plans no built role file. */
  readonly repoParts?: ReadonlyMap<string, readonly InstructionPart[]>
}
