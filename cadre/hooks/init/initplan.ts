/**
 * The plan step of init (PLAN-01, PLAN-03, PLAN-04, D-67, G-02-1f), a layer 10 module: planStep, the truthful file
 * plan of a draft, with the built CLAUDE.md of each role from the repo parts it was given (repoPartsOf), the role.json
 * records regen compares against (withRepoRecords) and the built files a re-init keeps as they are
 * (keptBuiltEntries); and privatesOf, what each role is owed outside the repo. Pure: it reads through the InitIo port
 * it is given, imports apply, core, generate, launch, paths, plan, records, roles, scan and init/draft, and never
 * imports init.ts, which imports it, or init/run.
 */
import type {
  CadreState,
  CompiledScope,
  DesiredFile,
  FrameworkId,
  GitPolicy,
  HunkOp,
  InitIo,
  InitLocations,
  InstructionHandout,
  InstructionPart,
  InstructionPartRecord,
  LaunchStart,
  Manifest,
  ManifestEntry,
  PortRead,
  RepoScan,
  RoleSpec,
} from '../../types'
import type { OwedPrivate } from '../apply/run'
import { sha256Hex } from '../core/hash'
import { compareText } from '../core/text'
import { desiredFiles } from '../generate/files'
import { builtClaudeMdPath } from '../generate/launcher'
import { isPartsFlowRole } from '../launch/links'
import { GITIGNORE_FILE, roleJsonPath } from '../paths'
import { gitignoreLines, mergeIgnoreBlock } from '../plan/gitignore'
import { planReadPaths, planWithManifest } from '../plan/plan'
import { partRecord, withPartRecords } from '../records'
import { parseRoleJson } from '../roles/rolejson'
import { standsFor } from '../roles/template'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { readPaths, readRepoFile } from '../scan/port-read'
import type { PlanResult } from './draft'

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
 * The manifest entries of the built files a re-init keeps as they are (02-GAPS-B3 S1): for each role whose built
 * `.cadre/<id>/CLAUDE.md` is desired, when its role.json as the disk holds it is text parseRoleJson takes, with the
 * same repo part records as the role, given and not given (compared by file, heading and hash), and the built file as
 * the disk holds it hashes to its entry in the last manifest, that entry; so an accepted improver text is neither
 * written over nor offered again while the role's parts are unchanged.
 */
async function keptBuiltEntries(
  roles: readonly RoleSpec[],
  desired: readonly DesiredFile[],
  disk: ReadonlyMap<string, PortRead>,
  manifest: Manifest | null,
): Promise<ManifestEntry[]> {
  const desiredPaths = new Set(desired.map(file => file.path))
  const recordsText = (records: readonly InstructionPartRecord[] | undefined): string =>
    JSON.stringify((records ?? []).map(({ file, heading, hash }) => ({ file, heading, hash })))
  const kept: ManifestEntry[] = []
  for (const role of roles) {
    const path = builtClaudeMdPath(role.id)
    const entry = manifest?.files.find(file => file.path === path)
    if (!desiredPaths.has(path) || entry === undefined) continue
    const roleRead = disk.get(roleJsonPath(role.id))
    const onDisk = roleRead?.state === 'text' ? parseRoleJson(roleRead.text) : null
    if (onDisk === null) continue
    if (recordsText(onDisk.instructionParts) !== recordsText(role.instructionParts)) continue
    if (recordsText(onDisk.instructionPartsNotGiven) !== recordsText(role.instructionPartsNotGiven)) continue
    const built = disk.get(path)
    if (built?.state !== 'text' || (await sha256Hex(built.text)) !== entry.sha256) continue
    kept.push(entry)
  }

  return kept
}

/**
 * The truthful file plan of init (PLAN-01, PLAN-03, PLAN-04, D-67). The repo state holds cadre's own version, else
 * `unknown`, the repo default framework, the git policy, the role ids and where the launchers start (A2), and
 * desiredFiles gives every file from it, with the built `.cadre/<id>/CLAUDE.md` of each role from the repo parts
 * `repoParts` gives it (G-02-1f): whenever init passes repoParts every role gets its built file, the header alone with
 * no repo part, so a later hand-out always replaces stale content (02-GAPS-B2 S1). A role whose repo records and built
 * file are as the last apply left them keeps its built file and manifest entry, as regenPlan does, so an accepted
 * improver text is not overwritten or asked again (keptBuiltEntries, 02-GAPS-B3 S1): its path is dropped from the
 * desired files and its entry carried. The repo state also records the consent answer, so regen knows whether it may
 * read ~/.claude.json (A1). Exactly the paths planReadPaths names (each file, the copy beside it and the manifest) and
 * the root `.gitignore` are read, through readRepoFile, so a link out of the repo is unknown and never read.
 * planWithManifest classifies each file against the disk and the last manifest the scan read, then adds the ignore
 * block of the policy (gitignoreLines, which leaves out a `thoughts/` line the file already has and, when a role
 * stands for Security, ends with the line for claude-security's report folders, decision #39) and the hunks.
 * The result also holds what apply writes the plan from: the desired files less the kept ones, the manifest the plan
 * records and the merged `.gitignore` text, which is null when the `.gitignore` cannot be read or its block cannot be
 * merged, since the plan then has no op for it. It writes nothing itself: apply writes the plan after Confirm
 * (applyConfirmed).
 */
export async function planStep(
  io: InitIo,
  input: {
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
  },
): Promise<PlanResult> {
  const { roles, repoDefault, policy, launchStart, scopes, hunks, repo, locations, readUserMcp, repoParts } = input
  const cadreVersion = (await io.cadreVersion()) ?? 'unknown'
  const state: CadreState = {
    schema: 1,
    cadreVersion,
    framework: repoDefault,
    gitPolicy: policy,
    roles: roles.map(role => role.id),
    launchStart,
    readUserMcp,
  }
  const parts = repoParts === undefined ? {} : { repoParts }
  const generated = desiredFiles({ roles, scopes, state, only: null, ...parts })
  const disk = await readPaths(io, locations.root, planReadPaths(generated))
  const carried = await keptBuiltEntries(roles, generated, disk, repo.cadre.manifest)
  const keptPaths = new Set(carried.map(entry => entry.path))
  const desired = generated.filter(file => !keptPaths.has(file.path))
  const ignoreRead = await readRepoFile(io, locations.root, GITIGNORE_FILE, MAX_READ_BYTES)
  const existing = ignoreRead.state === 'text' ? ignoreRead.text : null
  const lines = gitignoreLines(policy, existing, roles.some(role => standsFor(role, 'security')))
  const { plan, manifest } = await planWithManifest({
    desired,
    disk,
    manifest: repo.cadre.manifest,
    manifestState: repo.cadre.manifestState,
    carried,
    gitignore: { disk: ignoreRead, lines },
    hunks,
    cadreVersion,
  })
  const isIgnoreReadable = ignoreRead.state === 'text' || ignoreRead.state === 'absent'
  const gitignore = isIgnoreReadable ? mergeIgnoreBlock(existing, lines) : null

  return { plan, state, desired, manifest, gitignore }
}
