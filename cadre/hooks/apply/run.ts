/**
 * The apply runner, a layer 9 module: the one runner init and regen share. After Confirm it writes the steps of a
 * plan, each role's private files and the improver pass, only through HostIo, installs the plugins answered Install,
 * names the role memory folders, and gives the applied lines of the reply (D-105, LNCH-01, G-02-1f, D-141). It
 * imports apply, core, the GSD hunks, git, host, paths, roles/infra, scan/facts/normalize and the types, so init and
 * regen run their writes here.
 */
import type { HostIo, InitIo, InitLocations, PortEntry, RoleSpec, WriteStat } from '../../types'
import {
  improveBuiltFiles,
  improverLine,
  installedLine,
  installFailureText,
  MARKETPLACE_ADD_ARGV,
  pluginInstallArgv,
  PYTHON_VERSION_ARGV,
  pythonProblem,
  restoreSteps,
} from '../apply'
import type { BuiltFile, ImproverTally } from '../apply'
import { reportText } from '../core/text'
import { attendedNote } from '../framework/gsd/hunks'
import { gitCommonDirOf } from '../git/common-dir'
import { hasRunFailed, isStepDone, privateModeArgv } from '../host/steps'
import { displayPath, roleMemoryDir, trimSlash, userDirOf } from '../paths'
import { CLAUDE_SECURITY_PLUGIN } from '../roles/infra'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { hunkFailureLine } from './hunks'
import type { HunkRun } from './hunks'
import { instructionsRecordPath, instructionsRecordText, privateClaudeMdPath } from './private'
import type { ApplyInput, ApplyStep, PrivateFile, PrivateRole } from './private'
import {
  applyListPaths,
  applyStatPaths,
  chmodArgv,
  chmodProblem,
  listedLinkProblem,
  privateCheckPaths,
  privateLevels,
  privateWriteProblem,
  writeProblem,
} from './safety'
import { applySteps } from './steps'

/** The first applied line when an apply had no step to run: every planned file is already on the disk (D-105). */
export const APPLIED_NONE_NOTE = 'Applied: nothing to write; every file is up to date.'

/** The last line of a plain init or regen reply: what to run next to launch a role from the files written. */
export const NEXT_STEP_NOTE = 'Next: run /cadre start <id> to launch a role.'

/** The start of the manifest-skipped warning; init and regen end it with the command to run again. */
const MANIFEST_SKIPPED_START = '.cadre/manifest.json was not written because a file above was not written: run '

/**
 * The warning in an init reply when apply did not write the manifest because a file write before it failed or was
 * refused, so the manifest never claims a file that is not on the disk (LNCH-01, T-03-18).
 */
export const MANIFEST_SKIPPED_NOTE = `${MANIFEST_SKIPPED_START}/cadre init again.`

/** The manifest-skipped warning of a regen reply: re-running regen of the role is the narrower fix (A4). */
export function regenManifestSkippedNote(id: string): string {
  return `${MANIFEST_SKIPPED_START}/cadre regen ${reportText(id)} again.`
}

/**
 * The warning in an init reply when apply cannot name the role memory folders, so the private files of these roles
 * are not written (G-02-1f, D-140 q2-a): there is no user folder, or git gives no absolute common dir. The ids are
 * cleaned and capped as report cells are.
 */
export function privateFoldersUnknownWarning(ids: readonly string[]): string {
  return (
    `the private files of ${ids.map(reportText).join(', ')} were not written: their role memory folders are unknown ` +
    '(no home folder, or git rev-parse failed or gave no absolute path; git 2.31 or newer is needed)'
  )
}

/** What a role was given that is private, before its role memory folder is known (privatesOf). */
export type OwedPrivate = Pick<PrivateRole, 'id' | 'parts' | 'memories' | 'partsNotGiven'>

/**
 * What one apply did (D-105, LNCH-01). Every path is repo-relative, except that of a private file:
 * - `written`: each path whose write landed, in step order, the `.gitignore`, the manifest and the private files of
 *   the role memory folders included, a private file as displayPath shows it (`~/...`, G-02-1f);
 * - `executable`: each launcher whose chmod ran and exited 0;
 * - `failed`: each path whose write the host refused or failed;
 * - `refused`: the writeProblem or listedLinkProblem text of each write that was not tried, because the stat of the
 *   path or a folder above it failed, the path is a folder, the path or a folder above it is a link, not a folder or
 *   not inside the repo, a folder lists the path or a folder above it as a link, or such a folder could not be listed
 *   (#72 A2);
 * - `notExecutable`: each launcher whose chmod ran but did not exit 0, or could not run;
 * - `chmodRefusals`: the chmodProblem text of each chmod that was not run, because the write of its path did not land;
 * - `hunkFailures`: each framework command that failed (D-106);
 * - `attended`: the required keys whose failed command made roles attended (D-106);
 * - `installed`: each plugin key, a security plugin or claude-md-management, whose install ran after Confirm and exited
 *   0 (decision #39, D-141);
 * - `installProblems`: the text of each such plugin that was not installed, with the command to run by hand (decision
 *   #39); never fatal to the apply;
 * - `untrackedParts`: the warning of each source file whose repo parts were left out of the built files because git
 *   does not track it, or GIT_TRACKING_UNKNOWN_WARNING when git could not be asked (02-GAPS-B2 M3);
 * - `privateProblems`: the warning of each private file that was not written (G-02-1f): the privateWriteProblem text
 *   of one refused, `could not write <path>` for one whose folder could not be made private or whose write failed, and
 *   privateFoldersUnknownWarning when the role memory folders could not be named; never a reason to skip the manifest,
 *   which names no private file;
 * - `manifestSkipped`: whether the manifest was not written because a write of a repo file before it failed or was
 *   refused;
 * - `improverWarnings`: the reply warning of each per-file improver question that got no usable answer (G-02-1f,
 *   D-141), and for a plain regen where no one can be asked whose rebuilt files the improver could improve,
 *   improverNotOfferedWarning (D-142);
 * - `improved`: how many built files the improver changed and the person accepted, of how many the pass ran for; null
 *   when no improver pass ran.
 */
export type ApplyOutcome = {
  readonly written: readonly string[]
  readonly executable: readonly string[]
  readonly failed: readonly string[]
  readonly refused: readonly string[]
  readonly notExecutable: readonly string[]
  readonly chmodRefusals: readonly string[]
  readonly hunkFailures: readonly HunkRun[]
  readonly attended: readonly string[]
  readonly installed: readonly string[]
  readonly installProblems: readonly string[]
  readonly untrackedParts: readonly string[]
  readonly privateProblems: readonly string[]
  readonly manifestSkipped: boolean
  readonly improverWarnings: readonly string[]
  readonly improved: ImproverTally | null
}

/** The outcome of an apply that did nothing: no write, no run, no problem and no improver pass. */
const NOTHING_APPLIED: ApplyOutcome = Object.freeze({
  written: [],
  executable: [],
  failed: [],
  refused: [],
  notExecutable: [],
  chmodRefusals: [],
  hunkFailures: [],
  attended: [],
  installed: [],
  installProblems: [],
  untrackedParts: [],
  privateProblems: [],
  manifestSkipped: false,
  improverWarnings: [],
  improved: null,
})

/** How long one launcher chmod may run before it is given up. */
const CHMOD_TIMEOUT_MS = 10_000

/**
 * Whether the folders of these private files are made and made private (G-02-1f, 02-GAPS-B2 N13): the mkdir run of
 * /cadre start (isStepDone) makes the deepest folder of privateLevels with every one above it, then `/bin/chmod 700`
 * runs on each level from the top (privateModeArgv); false at the first run the host rejects or that does not exit 0.
 */
async function isPrivateFolderMade(host: HostIo, folder: string, files: readonly PrivateFile[]): Promise<boolean> {
  const levels = privateLevels(folder, files)
  const deepest = levels.at(-1) ?? folder
  if (!(await isStepDone(host, { kind: 'mkdir', path: deepest }))) return false
  for (const level of levels) {
    const run = await host.run(privateModeArgv(level), { timeoutMs: CHMOD_TIMEOUT_MS })
    if (hasRunFailed(run)) return false
  }

  return true
}

/** What writePrivate did: the private files written, as displayPath shows them, and the warning of each one not. */
type PrivateOutcome = {
  readonly written: readonly string[]
  readonly problems: readonly string[]
}

/**
 * Writes the private files of one role into its role memory folder (G-02-1f, D-140 q2-a, T-02-72). Every path
 * privateCheckPaths names is stat'ed through statForWrite and every folder it names listed, then a file is tried only
 * when privateWriteProblem finds it is a private file of a confirmed role (`allowed`) with nothing on its way listed as
 * a link, unchecked or a folder; else its refusal is a problem. The files tried are written once their folders are made
 * and made private (isPrivateFolderMade), and one whose folders could not be made, or whose write the host refused or
 * failed, is `could not write <path>`. Paths are shown as displayPath shows them, `~/...` under the home folder.
 */
export async function writePrivate(
  io: InitIo,
  host: HostIo,
  step: { readonly path: string; readonly files: readonly PrivateFile[] },
  context: { readonly locations: InitLocations; readonly allowed: ReadonlySet<string> },
): Promise<PrivateOutcome> {
  const { locations, allowed } = context
  const paths = privateCheckPaths(step.path, step.files)
  const stats = new Map<string, WriteStat>()
  for (const path of paths.stats) stats.set(path, await io.statForWrite(path))
  const listings = new Map<string, readonly PortEntry[] | null>()
  for (const folder of paths.listings) listings.set(folder, await io.list(folder))
  const shownPath = (path: string): string => displayPath(path, locations.home, locations.root, locations.configDir)
  const refusals = step.files.map(file => privateWriteProblem(file.path, { allowed, stats, listings, locations }))
  const problems = refusals.filter((refusal): refusal is string => refusal !== null)
  const tried = step.files.filter((_, index) => refusals[index] === null)
  if (tried.length === 0) return { written: [], problems }
  const notWritten = (file: PrivateFile): string => `could not write ${shownPath(file.path)}`
  if (!(await isPrivateFolderMade(host, step.path, tried))) {
    return { written: [], problems: [...problems, ...tried.map(notWritten)] }
  }
  const written: string[] = []
  for (const file of tried) {
    if (await host.write(file.path, file.text)) written.push(shownPath(file.path))
    else problems.push(notWritten(file))
  }

  return { written, problems }
}

/**
 * Runs the steps of a confirmed apply through the host, in order (D-105, LNCH-01). Every path applyStatPaths names is
 * stat'ed once, through the init port's statForWrite and with resolve, and every folder applyListPaths names is listed
 * once through io.list, before the first step. A write is tried only when writeProblem finds no failed stat, link,
 * folder, non-folder or out-of-repo path on its way (T-03-17, #44) and listedLinkProblem finds no entry on its way
 * listed as a link and no folder there that could not be listed (#72 A2), and its path joins `written` only when
 * host.write says it landed. A chmod runs only on a path in `written`, so only after the write of that same path in
 * this same apply passed writeProblem and landed (chmodProblem): `/bin/chmod` follows links, so a chmod on a path whose
 * write was refused or failed could change the target of a link planted there, outside the repo (RESEARCH 3.2,
 * T-03-38); such a launcher is not made executable, and no chmod runs for it at all. A chmod that ran makes its
 * launcher executable only on exit 0. A private step writes the private files of one role into its role memory folder
 * outside the repo (writePrivate, G-02-1f), each only when it is one of `allowed`, the private files of the confirmed
 * roles (T-02-72); its problems are private problems. The manifest is written like any file, but skipped when a write
 * of a repo file before it failed or was refused, so it never claims a file that is not on the disk (T-03-18); a
 * private file is never in it, so a private problem never skips it.
 */
export async function writeSteps(
  io: InitIo,
  host: HostIo,
  locations: InitLocations,
  steps: readonly ApplyStep[],
  allowed: ReadonlySet<string> = new Set(),
): Promise<ApplyOutcome> {
  const { root } = locations
  const base = trimSlash(root)
  const stats = new Map<string, WriteStat>()
  for (const path of applyStatPaths(steps)) stats.set(path, await io.statForWrite(`${base}/${path}`))
  const listings = new Map<string, readonly PortEntry[] | null>()
  for (const folder of applyListPaths(steps)) {
    listings.set(folder, await io.list(folder === '' ? base : `${base}/${folder}`))
  }
  const written = new Set<string>()
  const executable: string[] = []
  const failed: string[] = []
  const refused: string[] = []
  const notExecutable: string[] = []
  const chmodRefusals: string[] = []
  const privateProblems: string[] = []
  let manifestSkipped = false
  for (const step of steps) {
    if (step.kind === 'chmod') {
      const problem = chmodProblem(step.path, written)
      if (problem !== null) {
        chmodRefusals.push(problem)
        continue
      }
      const run = await host.run(chmodArgv(root, step.path), { timeoutMs: CHMOD_TIMEOUT_MS })
      if (run !== null && run.exitCode === 0) executable.push(step.path)
      else notExecutable.push(step.path)
      continue
    }
    if (step.kind === 'private') {
      const outcome = await writePrivate(io, host, step, { locations, allowed })
      for (const path of outcome.written) written.add(path)
      privateProblems.push(...outcome.problems)
      continue
    }
    if (step.kind === 'manifest' && (failed.length > 0 || refused.length > 0)) {
      manifestSkipped = true
      continue
    }
    const problem = writeProblem(step.path, stats, root) ?? listedLinkProblem(step.path, stats, listings)
    if (problem !== null) {
      refused.push(problem)
      continue
    }
    if (await host.write(`${base}/${step.path}`, step.text)) written.add(step.path)
    else failed.push(step.path)
  }

  return {
    ...NOTHING_APPLIED,
    written: [...written],
    executable,
    failed,
    refused,
    notExecutable,
    chmodRefusals,
    privateProblems,
    manifestSkipped,
  }
}

/**
 * Runs the steps of a confirmed apply with the improver pass between the file writes and the manifest (G-02-1f,
 * D-141). writeSteps runs every step but the manifest; the improver pass runs on each offered built file whose write
 * landed (improveBuiltFiles); then writeSteps runs, with checks made after the improver ran, the write-back of each
 * file the pass gives back as built (restoreSteps) and the manifest applySteps gives with the accepted texts, so the
 * manifest hashes each built file as it ends up. As in one writeSteps run, the manifest is skipped when a write of a
 * repo file before it, the first ones or a write-back, failed or was refused. A file written twice counts once.
 */
export async function writeImproved(
  io: InitIo,
  host: HostIo,
  apply: {
    readonly locations: InitLocations
    readonly input: ApplyInput
    readonly steps: readonly ApplyStep[]
    readonly offered: readonly BuiltFile[]
    readonly allowed: ReadonlySet<string>
  },
): Promise<ApplyOutcome> {
  const { locations, input, allowed } = apply
  const fileSteps = apply.steps.filter(step => step.kind !== 'manifest')
  const first = await writeSteps(io, host, locations, fileSteps, allowed)
  const landed = new Set(first.written)
  const shownPath = (path: string): string => displayPath(path, locations.home, locations.root, locations.configDir)
  const files = apply.offered.filter(file => landed.has(file.repoPath ?? shownPath(file.path)))
  const pass = await improveBuiltFiles(io, host, files, locations)
  const manifest = (await applySteps({ ...input, improved: pass.accepted })).filter(step => step.kind === 'manifest')
  const isSkipped = first.failed.length > 0 || first.refused.length > 0
  const later = [...restoreSteps(pass.restores), ...(isSkipped ? [] : manifest)]
  const second = later.length === 0 ? NOTHING_APPLIED : await writeSteps(io, host, locations, later, allowed)

  return {
    ...first,
    written: [...first.written, ...second.written.filter(path => !landed.has(path))],
    failed: [...first.failed, ...second.failed],
    refused: [...first.refused, ...second.refused],
    privateProblems: [...first.privateProblems, ...second.privateProblems],
    manifestSkipped: (isSkipped && manifest.length > 0) || second.manifestSkipped,
    improverWarnings: pass.warnings,
    improved: files.length === 0 ? null : { changed: pass.changed, total: pass.total },
  }
}

/**
 * The lines a plain init or regen reply ends with (D-105, LNCH-01). First `Applied: wrote <n> file(s) (<m>
 * executable).`, `file` when n is 1, n counting every write that landed (the `.gitignore`, the manifest and the
 * private files included) and m the launchers made executable, or APPLIED_NONE_NOTE when nothing was written and no
 * write failed or was refused. Then one `warning: ` line for each write writeProblem refused (its text), each write
 * the host failed, each chmod not run (the chmodProblem text), each chmod that did not exit 0 (with the command to run
 * by hand), each framework command that failed (hunkFailureLine), the attended note when a failure made roles
 * attended, each plugin that was not installed (its installProblems text, decision #39), each source file
 * whose repo parts were left out because git does not track it, or that git could not be asked (untrackedParts,
 * 02-GAPS-B2 M3), each private file that was not written, or the roles whose role memory folders could not be named
 * (privateProblems, G-02-1f), each improver question that got no usable answer (improverWarnings, D-141), and
 * `manifestNote` (MANIFEST_SKIPPED_NOTE unless the caller names another) when the manifest was skipped. Then, when
 * plugins were installed, the line that names them and says to run /reload-plugins (installedLine), and when an
 * improver pass ran, how many built files it changed and the person accepted (improverLine). NEXT_STEP_NOTE comes
 * last.
 */
export function appliedLines(outcome: ApplyOutcome, manifestNote: string = MANIFEST_SKIPPED_NOTE): string[] {
  const { written, executable, failed, refused } = outcome
  const isNothing = written.length === 0 && failed.length === 0 && refused.length === 0
  const noun = written.length === 1 ? 'file' : 'files'
  const counted = `Applied: wrote ${written.length} ${noun} (${executable.length} executable).`
  const warnings = [
    ...refused,
    ...failed.map(path => `could not write ${reportText(path)}`),
    ...outcome.chmodRefusals,
    ...outcome.notExecutable.map(path => {
      const shownPath = reportText(path)

      return `could not make ${shownPath} executable: run chmod 755 ${shownPath}`
    }),
    ...outcome.hunkFailures.map(hunkFailureLine),
    ...(outcome.attended.length > 0 ? [attendedNote(outcome.attended)] : []),
    ...outcome.installProblems,
    ...outcome.untrackedParts,
    ...outcome.privateProblems,
    ...outcome.improverWarnings,
    ...(outcome.manifestSkipped ? [manifestNote] : []),
  ]
  const installed = outcome.installed.length > 0 ? [installedLine(outcome.installed)] : []
  const improved = outcome.improved === null ? [] : [improverLine(outcome.improved)]

  return [
    isNothing ? APPLIED_NONE_NOTE : counted,
    ...warnings.map(warning => `warning: ${warning}`),
    ...installed,
    ...improved,
    NEXT_STEP_NOTE,
  ]
}

/**
 * How long one plugin install, or the marketplace add, may run at apply before it is given up (decision #39, D-141,
 * T-03-42).
 */
export const PLUGIN_RUN_TIMEOUT_MS = 180_000

/**
 * How long the Python check before the claude-security install may run before it is given up (decision #39,
 * T-03-42).
 */
export const PYTHON_TIMEOUT_MS = 5_000

/**
 * Installs the plugins the person answered Install for, after Confirm (decision #39, D-141): each key in order, every
 * run with the home folder as cwd, so no repo-level settings or marketplace definitions take part (T-03-46). For
 * claude-security alone, PYTHON_VERSION_ARGV runs first (PYTHON_TIMEOUT_MS), and a pythonProblem is recorded and skips
 * that key only. An install runs pluginInstallArgv (PLUGIN_RUN_TIMEOUT_MS) and counts when it exits 0. The first
 * install that fails, a run the host rejects included, runs MARKETPLACE_ADD_ARGV once for the whole call: when the add
 * exits 0, that install and each later one that fails is tried once more; when the add fails, none is. A key that
 * still failed is a problem with the commands to run by hand (installFailureText), and the next key is still tried.
 */
export async function installPlugins(
  host: HostIo,
  home: string,
  keys: readonly string[],
): Promise<Pick<ApplyOutcome, 'installed' | 'installProblems'>> {
  const installed: string[] = []
  const installProblems: string[] = []
  const pythonOptions = { cwd: home, timeoutMs: PYTHON_TIMEOUT_MS }
  const pluginOptions = { cwd: home, timeoutMs: PLUGIN_RUN_TIMEOUT_MS }
  const isDone = async (argv: readonly string[]): Promise<boolean> => {
    const run = await host.run(argv, pluginOptions)

    return run !== null && run.exitCode === 0
  }
  let marketplace: 'untried' | 'added' | 'failed' = 'untried'
  for (const key of keys) {
    const problem =
      key === CLAUDE_SECURITY_PLUGIN ? pythonProblem(await host.run(PYTHON_VERSION_ARGV, pythonOptions)) : null
    if (problem !== null) {
      installProblems.push(problem)
      continue
    }
    if (await isDone(pluginInstallArgv(key))) {
      installed.push(key)
      continue
    }
    if (marketplace === 'untried') marketplace = (await isDone(MARKETPLACE_ADD_ARGV)) ? 'added' : 'failed'
    if (marketplace === 'added' && (await isDone(pluginInstallArgv(key)))) {
      installed.push(key)
      continue
    }
    installProblems.push(installFailureText(key, marketplace === 'failed'))
  }

  return { installed, installProblems }
}

/** Where the private files of an apply go: the roles that have one, the paths apply may write, and why none is. */
type PrivatePlan = {
  readonly privates: readonly PrivateRole[]
  readonly allowed: ReadonlySet<string>
  readonly problems: readonly string[]
  /** Every role id of the team to its role memory folder; empty when unknown (02-GAPS-B3 M1). */
  readonly folders: ReadonlyMap<string, string>
}

/**
 * How the role memory folder of a role is named, as /cadre start names it (G-02-1f, D-140 q2-a): from the user folder
 * and the git common dir (gitCommonDirOf runs `git rev-parse` once at the repo root, roleMemoryDir); null with no user
 * folder, when git is not asked, or with no absolute common dir from git.
 */
export async function roleFoldersOf(
  io: InitIo,
  host: HostIo,
  locations: InitLocations,
): Promise<((id: string) => string) | null> {
  const userDir = userDirOf(locations)
  if (userDir === null) return null
  const common = await gitCommonDirOf(io, host, locations.root)
  if (common === null) return null

  return id => roleMemoryDir({ userDir, ...common }, id)
}

/** The folder name of the repo root, which heads each private text file (D-140 q2-a). */
export function repoNameOf(locations: InitLocations): string {
  const root = trimSlash(locations.root)

  return root.slice(root.lastIndexOf('/') + 1)
}

/** The private files of these role memory folders: the only paths outside the repo an apply may write (T-02-72). */
export function privatePaths(folders: readonly string[]): ReadonlySet<string> {
  return new Set(folders.flatMap(folder => [privateClaudeMdPath(folder), instructionsRecordPath(folder)]))
}

/**
 * Where the private files go (G-02-1f Storage split, D-140 q2-a, T-02-72). On every plain init the role memory folder
 * of each role is named from the user folder and the git common dir, as /cadre start names it (roleFoldersOf: git runs
 * once, 02-GAPS-B3 C1), `folders` maps every role of the team to it (02-GAPS-B3 M1), and `allowed` holds the private
 * text file and the hand-out record of every role of the team: the only paths outside the repo apply may write
 * (privatePaths). Each role owed private files (privatesOf) gets them, unless the instructions.json on disk is exactly
 * the record it would get: an unchanged record leaves both private files as they are, an accepted improver text
 * included, and their paths stay allowed (02-GAPS-B3 S1). The repo's folder name heads each private text file
 * (repoNameOf). With no user folder, or no absolute common dir from git, nothing private is written and
 * privateFoldersUnknownWarning names the roles owed private files.
 */
export async function privatePlanOf(
  io: InitIo,
  host: HostIo,
  locations: InitLocations,
  input: { readonly roles: readonly RoleSpec[]; readonly owed: readonly OwedPrivate[] },
): Promise<PrivatePlan> {
  const none: PrivatePlan = { privates: [], allowed: new Set(), problems: [], folders: new Map() }
  const folderOf = await roleFoldersOf(io, host, locations)
  if (folderOf === null) return { ...none, problems: [privateFoldersUnknownWarning(input.owed.map(role => role.id))] }
  const repo = repoNameOf(locations)
  const privates: PrivateRole[] = []
  for (const role of input.owed) {
    const folder = folderOf(role.id)
    const read = await io.read(instructionsRecordPath(folder), MAX_READ_BYTES)
    const record = instructionsRecordText(role.parts, role.memories, role.partsNotGiven)
    if (read.state === 'text' && read.text === record) continue
    privates.push({ ...role, folder, repo })
  }

  return {
    privates,
    allowed: privatePaths(input.roles.map(role => folderOf(role.id))),
    problems: [],
    folders: new Map(input.roles.map((role): [string, string] => [role.id, folderOf(role.id)])),
  }
}
