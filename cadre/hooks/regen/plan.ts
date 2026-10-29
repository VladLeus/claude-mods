/**
 * The regen plan, a layer 10 module: the one role's file plan against the last manifest, the regen reply, and the
 * writes through the apply runner, with the improver pass in a session (D-68, D-105, D-141, D-142). It imports the
 * apply runner, steps and improver, core, generate, paths, the plan, the scans, ui/blocks/scan, roles/infra, the side
 * read, the hand-out and the types, so regen's entry plans and writes here.
 */
import type {
  CadreState,
  DesiredFile,
  HostIo,
  InitIo,
  InitLocations,
  Manifest,
  ManifestEntry,
  Plan,
  RoleSpec,
  SetupScan,
} from '../../types'
import { builtRoleFiles } from '../apply/improver'
import type { ApplyInput } from '../apply/private'
import { appliedLines, privatePaths, regenManifestSkippedNote, writeWithImprover } from '../apply/run'
import type { ApplyOutcome } from '../apply/run'
import { applySteps } from '../apply/steps'
import { sha256Hex } from '../core/hash'
import { desiredFiles } from '../generate/files'
import { builtClaudeMdPath } from '../generate/launcher'
import { launcherPath, roleJsonPath } from '../paths'
import { planReadPaths, planWithManifest } from '../plan/plan'
import { DRY_RUN_NOTE, renderPlan } from '../plan/text'
import { CLAUDE_MD_PLUGIN } from '../roles/infra'
import { scanWarnings } from '../scan/gather'
import { readPaths } from '../scan/port-read'
import { scanWarningLines } from '../ui/blocks/scan'
import type { RegenHanded } from './review'
import type { RegenScans } from './side-read'

/**
 * The warning of a plain regen where no one can be asked whose rebuilt files the improver could improve (D-141,
 * D-142): it is not run, since no one can answer Accept or Keep original.
 */
export function improverNotOfferedWarning(id: string): string {
  return (
    `the improver was not offered for ${id}: claude -p cannot ask Accept or Keep original; ` +
    `run /cadre regen ${id} in a session to review the changes`
  )
}

/** Whether a repo-relative path is one of this role's own: in its folder `.cadre/<id>/`, or its launcher. */
function isRolePath(path: string, id: string): boolean {
  return path.startsWith(`.cadre/${id}/`) || path === launcherPath(id)
}

/**
 * The manifest entries regen keeps as they are (D-68): every entry of the last manifest that this run does not
 * generate and that is not in the role's folder or its launcher, so the other roles and cadre.json keep theirs.
 */
function carriedEntries(manifest: Manifest, desired: readonly DesiredFile[], id: string): ManifestEntry[] {
  const generated = new Set(desired.map(file => file.path))

  return manifest.files.filter(entry => !generated.has(entry.path) && !isRolePath(entry.path, id))
}

/**
 * What regen planned for one role: the file plan, the warnings its reply prints between the plan and the ending (the
 * scan warnings of the run, A4, then the hand-out's), the reply lines of what the hand-out dropped, and what apply
 * writes the plan from: the desired files and the manifest the plan records.
 */
export type RegenPlanned = {
  readonly plan: Plan
  readonly warnings: readonly string[]
  readonly dropped: readonly string[]
  readonly desired: readonly DesiredFile[]
  readonly manifest: Manifest
}

/** The manifest with this path recorded at this hash in place of any entry it had for it (A5, AUTO-PICK #19 Q2). */
function withRecordedHash(manifest: Manifest, path: string, sha256: string): Manifest {
  const others = manifest.files.filter(entry => entry.path !== path)

  return { ...manifest, files: [...others, { path, sha256, mode: 'file' }] }
}

/**
 * The file plan of regen for one role (D-68, PLAN-04), from its scans (regenScans) and its hand-out (regenHandout).
 * desiredFiles gives only that role's files, its launcher and the index, with the role as the hand-out gives it, and
 * its built `.cadre/<id>/CLAUDE.md` only when the hand-out rebuilds it from its repo parts; else the last manifest's
 * entry of that file is carried, so the file gets no op and is never listed as no longer generated (AUTO-PICK #15,
 * #19 Q4). Exactly the paths planReadPaths names are read, and planWithManifest classifies them against the disk and
 * the last manifest, carrying every other entry (carriedEntries). No `.gitignore` block and no hunk is planned. The
 * role's role.json is the input (A5): when the hand-out leaves its records as they are it gets no op and the new
 * manifest records the hash of `roleJson`, the text on disk, which the next init normalises; when its records change
 * it is planned with them against that same disk hash as the last one, so it is a change, never a conflict (AUTO-PICK
 * #19 Q2). The warnings are the scan warnings of the run (scanWarnings, A4), then the hand-out's.
 */
export async function regenPlan(
  io: InitIo,
  input: {
    readonly id: string
    readonly state: CadreState
    readonly roles: readonly RoleSpec[]
    readonly roleJson: string
    readonly locations: InitLocations
    readonly scans: RegenScans
    readonly handed: RegenHanded
  },
): Promise<RegenPlanned> {
  const { id, state, roleJson, locations, scans, handed } = input
  const { manifest } = scans
  const roles = input.roles.map(role => (role.id === id ? handed.role : role))
  const parts = handed.repoParts === null ? {} : { repoParts: new Map([[id, handed.repoParts]]) }
  const generated = desiredFiles({ roles, scopes: scans.scopes, state, only: id, ...parts })
  const ownPath = roleJsonPath(id)
  const sha256 = await sha256Hex(roleJson)
  const desired = handed.isRoleWritten ? generated : generated.filter(file => file.path !== ownPath)
  const own = generated
    .filter(file => !handed.isRoleWritten && file.path === ownPath)
    .map((file): ManifestEntry => ({ path: file.path, sha256, mode: file.mode }))
  const builtPath = builtClaudeMdPath(id)
  const built = handed.repoParts === null ? manifest.files.filter(entry => entry.path === builtPath) : []
  const planned = await planWithManifest({
    desired,
    disk: await readPaths(io, locations.root, planReadPaths(desired)),
    manifest: handed.isRoleWritten ? withRecordedHash(manifest, ownPath, sha256) : manifest,
    manifestState: scans.manifestState,
    carried: [...own, ...built, ...carriedEntries(manifest, generated, id)],
    gitignore: null,
    hunks: [],
    cadreVersion: (await io.cadreVersion()) ?? 'unknown',
  })
  const warnings = [...scanWarnings(locations, scans.gathered), ...handed.warnings]

  return { plan: planned.plan, warnings, dropped: handed.dropped, desired, manifest: planned.manifest }
}

/**
 * The regen reply (D-68): what was asked for, the file plan as renderPlan prints it, the reply line of each item the
 * hand-out dropped (G-02-1f Regen), one `warning:` line for each warning of the plan, between the plan and the ending
 * as init prints them (scanWarningLines, A4), then the dry-run note when `applied` is null (--dry-run, nothing was
 * written), else the lines of what the apply did (appliedLines), with the regen manifest note (A4).
 */
export function regenReplyText(planned: RegenPlanned, id: string, applied: ApplyOutcome | null): string {
  const command = applied === null ? `cadre regen ${id} --dry-run` : `cadre regen ${id}`
  const ending = applied === null ? [DRY_RUN_NOTE] : appliedLines(applied, regenManifestSkippedNote(id))
  const warnings = scanWarningLines(planned.warnings)

  return [command, ...renderPlan(planned.plan), ...planned.dropped, ...warnings, ...ending].join('\n')
}

/**
 * Writes the plan of a plain regen (D-68, D-105) with no question: applySteps with the role's private files when the
 * hand-out rebuilds them, whose paths are the only ones outside the repo it may write (privatePaths, T-02-72), run by
 * writeSteps, so a conflicted file is kept and its `.cadre-new` copy written. When claude-md-management is installed
 * and the apply rebuilds a built file with a part in it (builtRoleFiles: the role's built CLAUDE.md with a repo part,
 * watching its private files when its role memory folder is known and guarded from its `.runtime` folder, and its
 * private text file with a global part; 02-GAPS-B3 M1, C1), the improver pass runs on them in a session
 * (writeImproved, D-141, D-142); where no one can be asked it does not start, and the outcome carries
 * improverNotOfferedWarning. The warnings of the hand-out's git check are its untrackedParts.
 */
export async function regenApply(
  io: InitIo,
  host: HostIo,
  input: {
    readonly locations: InitLocations
    readonly planned: RegenPlanned
    readonly handed: RegenHanded
    readonly setup: SetupScan
  },
): Promise<ApplyOutcome> {
  const { locations, planned, handed } = input
  const { plan, desired, manifest } = planned
  const { privateRole, role } = handed
  const privates = privateRole === null ? [] : [privateRole]
  const applyInput: ApplyInput = { plan, desired, manifest, gitignore: null, choices: new Map(), privates }
  const steps = await applySteps(applyInput)
  const allowed = privatePaths(privates.map(owed => owed.folder))
  const withParts = new Set(handed.repoParts !== null && handed.repoParts.length > 0 ? [role.id] : [])
  const isImproverReady = input.setup.installedPlugins.includes(CLAUDE_MD_PLUGIN)
  const privateFolders = new Set(privateRole !== null && privateRole.parts.length > 0 ? [privateRole.folder] : [])
  const roleFolders = handed.folder === null ? new Map<string, string>() : new Map([[role.id, handed.folder]])
  const filter = { repoIds: withParts, privateFolders, roleFolders }
  const built = isImproverReady ? builtRoleFiles(steps, locations.root, filter) : []
  const isOffered = built.length > 0 && handed.isSession
  const written = await writeWithImprover(io, host, {
    locations,
    input: applyInput,
    steps,
    offered: isOffered ? built : [],
    allowed,
  })
  const notOffered = built.length > 0 && !handed.isSession ? [improverNotOfferedWarning(role.id)] : []

  const improverWarnings = [...written.improverWarnings, ...notOffered]

  return { ...written, untrackedParts: handed.untracked, improverWarnings }
}
