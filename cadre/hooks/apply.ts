/**
 * Apply plans the writes of a plan the person confirmed (D-105): the files the plan creates or changes in plan order,
 * a chmod right after each launcher, the root `.gitignore` block, then the private files of each role in its role
 * memory folder outside the repo (G-02-1f, D-140 q2-a), and the manifest last, so an apply that stops early never
 * leaves a manifest that claims a file it did not write (LNCH-01). A file the person edited is written only when they
 * answer Take new (D-67), no write or chmod may follow a link out of the repo, and no write outside the repo may go
 * anywhere but a private file of a confirmed role (T-02-72). The framework commands of the accepted hunks are
 * re-resolved from their adapter proposals, and a failed one makes its roles attended (D-106, D-120). It also gives
 * the argvs and the reply lines of the security plugin installs, with the Python check and the marketplace add, and
 * the setup the plan is made again from after them (decision #39). Init runs the steps through the host port. The
 * improver pass between the file writes and the manifest (G-02-1f, D-141) is the one part that runs here, through the
 * ports init gives it: each improver run goes through HostIo.run, while its reads and questions go through InitIo,
 * which can neither write nor run.
 */
import type {
  DesiredFile,
  FileMode,
  FileOp,
  HostIo,
  HostRun,
  HunkOp,
  InitIo,
  InitLocations,
  Manifest,
  ManifestEntry,
  Plan,
  PortRead,
  SettingProposal,
  SetupScan,
} from '../types'
import type { ConflictChoice } from './apply/conflict'
import { instructionsRecordPath, privateClaudeMdPath, privateSteps } from './apply/private'
import type { ApplyInput, ApplyStep } from './apply/private'
import { parentOf, privateFolderOf } from './apply/safety'
import { sha256Hex } from './core/hash'
import { stableJson } from './core/json'
import { compareText, countedNoun, reportText, sortedUnique } from './core/text'
import { resolveToolCommand } from './framework/gsd/tools'
import type { GsdToolContext } from './framework/gsd/tools'
import { ADAPTERS } from './framework/registry'
import { builtClaudeMdPath } from './generate/launcher'
import { editWriteRules } from './launch'
import { BESIDE_SUFFIX, displayPath, GITIGNORE_FILE, isFileInsideRoot, trimSlash } from './paths'
import { MANIFEST_PATH } from './plan/classify'
import { CLAUDE_SECURITY_PLUGIN } from './roles/infra'
import { MAX_READ_BYTES } from './scan/facts/normalize'
import { missingState } from './scan/port-read'
import { ASK_HEADERS, askChoice, noteLine, quotedLabels, showBlock, withContext } from './ui/ask'
import { diffLines, lineDiff } from './ui/diff'
import type { LineDiff } from './ui/diff'

/** The desired files by path; of two with the same path the first is kept, as buildPlan keeps it. */
function desiredByPath(desired: readonly DesiredFile[]): ReadonlyMap<string, DesiredFile> {
  const files = new Map<string, DesiredFile>()
  for (const file of desired) {
    if (!files.has(file.path)) files.set(file.path, file)
  }

  return files
}

/** A write of the text, then a chmod of the same path when the file is a launcher (mode exec). */
function writeOf(path: string, text: string, mode: FileMode): ApplyStep[] {
  const write: ApplyStep = { kind: 'write', path, text }
  if (mode !== 'exec') return [write]

  return [write, { kind: 'chmod', path }]
}

/** Whether an op writes its path as planned: a create or a change. */
function isCreateOrChange(op: FileOp): boolean {
  return op.kind === 'create' || op.kind === 'change'
}

/**
 * Whether the op of a desired file writes it: a create, a change, or a conflict the person answered Take new (D-67).
 * A leave, and a conflict answered Keep mine or not answered at all (one that appeared after the questions), keep the
 * file on the disk as it is.
 */
function isWritten(op: FileOp, choices: ReadonlyMap<string, ConflictChoice>): boolean {
  if (isCreateOrChange(op)) return true

  return op.kind === 'conflict' && choices.get(op.path) === 'new'
}

/** The step of the `.gitignore` op: a create or a change writes the merged block text, when there is one. */
function ignoreSteps(op: FileOp, gitignore: string | null): ApplyStep[] {
  if (gitignore === null || !isCreateOrChange(op)) return []

  return [{ kind: 'write', path: op.path, text: gitignore }]
}

/** The desired file a `.cadre-new` copy holds the new version of; null for any other path. */
function besideOriginal(path: string, files: ReadonlyMap<string, DesiredFile>): DesiredFile | null {
  if (!path.endsWith(BESIDE_SUFFIX)) return null

  return files.get(path.slice(0, -BESIDE_SUFFIX.length)) ?? null
}

/**
 * The steps of one file op. The `.gitignore` op gives what ignoreSteps gives. A desired file is written when isWritten
 * says so, and a launcher is made executable right after its write. The `.cadre-new` copy beside a conflict gets the
 * new version, for diffing, when the person did not take the new version and the copy's op is a create or a change: a
 * copy that already holds something else (a conflict) is kept as it is, and a copy is never made executable (D-67). A
 * leave writes nothing.
 */
function opSteps(op: FileOp, input: ApplyInput, files: ReadonlyMap<string, DesiredFile>): ApplyStep[] {
  if (op.path === GITIGNORE_FILE) return ignoreSteps(op, input.gitignore)
  const file = files.get(op.path)
  if (file !== undefined) return isWritten(op, input.choices) ? writeOf(op.path, file.content, op.mode) : []
  const original = besideOriginal(op.path, files)
  if (original === null || !isCreateOrChange(op) || input.choices.get(original.path) === 'new') return []

  return [{ kind: 'write', path: op.path, text: original.content }]
}

/** The plan's op for the manifest; null when the plan has none. */
function manifestOpOf(plan: Plan): FileOp | null {
  for (const op of plan.ops) {
    if (op.kind !== 'hunk' && op.path === MANIFEST_PATH) return op
  }

  return null
}

/**
 * The desired files of the conflicts answered Take new, with the mode of their op: exactly the conflicts opSteps
 * writes, since the walk never writes the manifest or the `.gitignore` as a desired file either.
 */
function takenNew(input: ApplyInput, files: ReadonlyMap<string, DesiredFile>): DesiredFile[] {
  const taken: DesiredFile[] = []
  for (const op of input.plan.ops) {
    if (op.kind !== 'conflict' || op.path === MANIFEST_PATH || op.path === GITIGNORE_FILE) continue
    const file = files.get(op.path)
    if (file === undefined || !isWritten(op, input.choices)) continue
    taken.push({ path: op.path, content: file.content, mode: op.mode })
  }

  return taken
}

/**
 * The files whose text the manifest records anew (D-67, D-141): each file taken new with its desired text, and each
 * built role file whose improved text the person accepted (`improved`) with that text, which wins over the desired
 * text of the same path; each with the mode of its desired file. An improved path with no desired file gives none.
 */
function changedFiles(input: ApplyInput, files: ReadonlyMap<string, DesiredFile>): DesiredFile[] {
  const improved = input.improved ?? new Map<string, string>()
  const taken = takenNew(input, files).filter(file => !improved.has(file.path))
  const accepted = Array.from(improved).flatMap(([path, content]): DesiredFile[] => {
    const desired = files.get(path)

    return desired === undefined ? [] : [{ path, content, mode: desired.mode }]
  })

  return [...taken, ...accepted]
}

/**
 * The manifest apply writes: the one the plan records, with the entry of each file taken new or improved replaced by
 * one with the hash of its new text, or added when the plan had none for it (an untracked file), sorted by path (D-67,
 * D-141).
 */
async function manifestAfter(manifest: Manifest, taken: readonly DesiredFile[]): Promise<Manifest> {
  const paths = new Set(taken.map(file => file.path))
  const files: ManifestEntry[] = manifest.files.filter(entry => !paths.has(entry.path))
  for (const file of taken) files.push({ path: file.path, sha256: await sha256Hex(file.content), mode: file.mode })
  files.sort((a, b) => compareText(a.path, b.path))

  return { schema: 1, cadreVersion: manifest.cadreVersion, files }
}

/**
 * The steps that apply a confirmed plan (D-105, LNCH-01), from the plan's ops in their order (opSteps): a create or a
 * change of a desired file writes its text, and so does a conflict answered Take new (D-67), while its `.cadre-new`
 * copy is then not written; a conflict answered Keep mine, or not answered, keeps the person's file and writes the
 * copy instead. Every chmod step comes right after the write step of the same path. The root `.gitignore` op writes
 * the merged block text; a leave writes nothing, and so does a hunk. After the repo files come the private files of
 * each role in `privates`, one step per role that has one (G-02-1f, D-140 q2-a). The manifest comes last, once every
 * file is written, so an apply that stops early never leaves a manifest that claims a file it did not write; it
 * records the new hash of each file taken new and of each built role file whose improved text the person accepted
 * (`improved`, D-141), keeps the old entry of each file kept, and never names a private file. There is none when the
 * plan keeps the manifest as a conflict (it could not be read, A6), and none when the plan leaves it and no file was
 * taken new or improved. No step deletes anything.
 */
export async function applySteps(input: ApplyInput): Promise<ApplyStep[]> {
  const files = desiredByPath(input.desired)
  const steps: ApplyStep[] = []
  for (const op of input.plan.ops) {
    if (op.kind === 'hunk' || op.path === MANIFEST_PATH) continue
    steps.push(...opSteps(op, input, files))
  }
  steps.push(...privateSteps(input.privates ?? []))
  const manifestOp = manifestOpOf(input.plan)
  const changed = changedFiles(input, files)
  if (manifestOp === null || manifestOp.kind === 'conflict') return steps
  if (manifestOp.kind === 'leave' && changed.length === 0) return steps
  const manifest = await manifestAfter(input.manifest, changed)

  return [...steps, { kind: 'manifest', path: MANIFEST_PATH, text: stableJson(manifest) }]
}

/** How long one improver run may take before it is given up (G-02-1f, D-141, T-02-77): the file then stays as built. */
export const IMPROVER_TIMEOUT_MS = 300_000

/**
 * The argv of one improver run (D-141 imp-b): `claude -p` in acceptEdits, so the run edits the file in place and asks
 * nothing, then `flags`, a repo file's guard (improverGuardFlags, 02-GAPS-B3 M1) and none for a private text file, then
 * `--` and a prompt that names the claude-md-management:claude-md-improver skill and the file's absolute path. Init
 * runs it only after Confirm, through the host port, with the folder that holds the file as cwd.
 */
export function improverArgv(path: string, flags: readonly string[] = []): readonly string[] {
  return [
    'claude',
    '-p',
    '--permission-mode',
    'acceptEdits',
    ...flags,
    '--',
    `Use the claude-md-management:claude-md-improver skill to improve the file ${path} only.`,
  ]
}

/**
 * Why a repo file's improver run is not started (02-GAPS-B3 M1 c): its .runtime folder has a path no exact deny rule
 * can hold.
 */
export const UNGUARDED_RUN_REASON = 'its folder has a path a permission rule cannot hold'

/**
 * The flags of a repo file's improver run (02-GAPS-B3 M1 a): settings that deny Edit and Write on
 * `//<root>/.cadre/<id>/.runtime/**`, so the run cannot edit through the links there, and no Bash; null when
 * editWriteRules cannot hold that path, and the run is then not started.
 */
export function improverGuardFlags(root: string, id: string): readonly string[] | null {
  const rules = editWriteRules(`${trimSlash(root)}/.cadre/${id}/.runtime`, '/**')
  if (rules === null) return null

  return ['--settings', JSON.stringify({ permissions: { deny: rules } }), '--disallowedTools', 'Bash']
}

/**
 * One built role file the improver pass offers (G-02-1f, D-141): its absolute path, its repo-relative path when it is
 * a repo file (`.cadre/<id>/CLAUDE.md`; null for a private text file), and the text cadre built and wrote there.
 */
export type BuiltFile = {
  readonly path: string
  readonly repoPath: string | null
  readonly text: string
  /**
   * Absolute paths marked before and after the run besides its folder (02-GAPS-B3 M1): for a repo file, the role's
   * private text file and instructions.json.
   */
  readonly watched: readonly string[]
  /**
   * The flags of its run (improverGuardFlags): [] for a private text file; null for a repo file whose run is not
   * started.
   */
  readonly runFlags: readonly string[] | null
}

/**
 * What builtRoleFiles offers (G-02-1f, D-141; 02-GAPS-B3 M1, C1): the role ids whose built CLAUDE.md holds a repo part,
 * the role memory folders whose private text holds a global part (a header alone has nothing to improve), and each
 * role's memory folder by id, for the watched paths.
 */
export type BuiltFilter = {
  readonly repoIds: ReadonlySet<string>
  readonly privateFolders: ReadonlySet<string>
  readonly roleFolders: ReadonlyMap<string, string>
}

/**
 * The built role files of an apply the improver pass offers, in step order (G-02-1f, D-141; 02-GAPS-B3 M1, C1): the
 * written `.cadre/<id>/CLAUDE.md` of each role in `filter.repoIds`, watching the role's private text file and
 * instructions.json when its role memory folder is known, with the guard flags of its run (improverGuardFlags); and
 * the private text file of each private step whose folder is in `filter.privateFolders`, watching nothing, with no
 * flags. A record, a `.cadre-new` copy, a header-only private text file and every other file are left out. `root` is
 * the repo root the repo paths lie under.
 */
export function builtRoleFiles(steps: readonly ApplyStep[], root: string, filter: BuiltFilter): BuiltFile[] {
  const base = trimSlash(root)
  const idOf = new Map(Array.from(filter.repoIds, (id): [string, string] => [builtClaudeMdPath(id), id]))

  return steps.flatMap((step): BuiltFile[] => {
    const id = step.kind === 'write' ? idOf.get(step.path) : undefined
    if (step.kind === 'write' && id !== undefined) {
      const folder = filter.roleFolders.get(id)
      const watched = folder === undefined ? [] : [privateClaudeMdPath(folder), instructionsRecordPath(folder)]
      const runFlags = improverGuardFlags(root, id)

      return [{ path: `${base}/${step.path}`, repoPath: step.path, text: step.text, watched, runFlags }]
    }
    if (step.kind !== 'private' || !filter.privateFolders.has(step.path)) return []
    const textPath = privateClaudeMdPath(step.path)
    const files = step.files.filter(file => file.path === textPath)

    return files.map(file => ({ ...file, repoPath: null, watched: [], runFlags: [] }))
  })
}

/**
 * The steps that write built role files back as cadre built them, after the improver pass (G-02-1f, D-141, T-02-76): a
 * repo file as a write of its repo path and a private text file as the private step of its role memory folder, so
 * each write gets the same checks as the first one. A path that is neither gives none.
 */
export function restoreSteps(files: readonly BuiltFile[]): ApplyStep[] {
  return files.flatMap((file): ApplyStep[] => {
    if (file.repoPath !== null) return [{ kind: 'write', path: file.repoPath, text: file.text }]
    const folder = privateFolderOf(file.path)

    return folder === null ? [] : [{ kind: 'private', path: folder, files: [{ path: file.path, text: file.text }] }]
  })
}

/** The answers to the per-file improver question, Accept first (D-141). */
export const IMPROVER_OPTIONS: readonly string[] = Object.freeze(['Accept', 'Keep original'])

/** What the person chose for one improved file: the improver's text, or the text cadre built. */
type ImproverChoice = 'accept' | 'keep'

/** The answer to the per-file improver question: Accept or Keep original, trimmed and in any case; else null. */
function parseImproverAnswer(answer: string): ImproverChoice | null {
  const wanted = answer.trim().toLowerCase()
  if (wanted === 'accept') return 'accept'
  if (wanted === 'keep original') return 'keep'

  return null
}

/** How many lines a diff adds and removes, as the improver block and question say it (D-141). */
function diffCounts(diff: LineDiff): string {
  return `${countedNoun(diff.added, 'line', 'lines')} added, ${diff.removed} removed`
}

/** The per-file improver question (D-141): whether to keep the improver's changes to the file at the shown path. */
export function improverQuestion(path: string): string {
  return `Accept the improver's changes to ${path}?`
}

/** The context line of the per-file improver question (D-136, D-141): the size of the change, and where its diff is. */
export function improverContextLine(diff: LineDiff): string {
  return `${diffCounts(diff)}; the pane shows the diff.`
}

/**
 * The improver block of one file (G-02-1f, D-141): its shown path with how many lines the improver added and removed,
 * then the changed lines (diffLines).
 */
export function improverBlockLines(path: string, diff: LineDiff): string[] {
  return [`${path}: ${diffCounts(diff)}`, ...diffLines(diff)]
}

/** The note for a built file the improver ran on and did not change (D-141). */
export function improverNoChangeNote(path: string): string {
  return `the improver made no change to ${path}`
}

/** The note for a built file whose improver run failed (D-141, T-02-77): why, and that the file stays as built. */
export function improverFailedNote(path: string, reason: string): string {
  return `the improver did not run for ${path} (${reason}): the file stays as built`
}

/**
 * The note for a built file the improver left as something cadre cannot read and show as a diff: gone, a link, not a
 * regular file, over the read cap or unreadable (D-141, T-02-76); it is written back as built.
 */
export function improverUnreadableNote(path: string): string {
  return `the improver left ${path} unreadable: it is written back as built`
}

/** The reply warning for a per-file improver question that got no usable answer (D-141): the file stays as built. */
export function improverDismissedWarning(path: string): string {
  return `the improver question for ${path} was dismissed: the file stays as built`
}

/**
 * The reply warning for a built file that was not its built text when its own improver run was due (02-GAPS-B3 M1):
 * an earlier run changed or removed it; it gets no run and is written back as built.
 */
export function changedBeforeRunWarning(path: string): string {
  return `${path} changed before its improver run: it is written back as built`
}

/** The most other files the reply warning of one improver run names; the improver block names them all (D-141). */
const MAX_NAMED_OTHERS = 3

/**
 * The reply warning for an improver run that changed other files in its folder (D-141, T-02-75), the risk the person
 * accepted in place of a scratch copy: how many, the folder, the first MAX_NAMED_OTHERS shown paths and how many more,
 * and that the pane lists them. They are not undone.
 */
export function otherChangesWarning(folder: string, paths: readonly string[]): string {
  const named = paths.slice(0, MAX_NAMED_OTHERS)
  const rest = paths.length - named.length
  const listed = rest === 0 ? named.join(', ') : `${named.join(', ')}, +${rest} more`
  const count = countedNoun(paths.length, 'other file', 'other files')

  return `the improver also changed ${count} in ${folder}: ${listed}; review them (listed in the pane)`
}

/**
 * The rows of the improver block that name the other files an improver run changed (D-141, T-02-75): a heading with
 * the run's folder, then one row per shown path; none when there is none.
 */
export function otherFilesLines(folder: string, paths: readonly string[]): string[] {
  if (paths.length === 0) return []

  return [`Other files changed by the improver in ${folder}:`, ...paths.map(path => `  ${path}`)]
}

/**
 * The reply warning for an improver run's folder that held more files than one look checks (D-141, T-02-75): how many
 * files a change of was not checked.
 */
export function uncheckedFilesWarning(count: number, folder: string): string {
  return `${countedNoun(count, 'file', 'files')} in ${folder} ${count === 1 ? 'was' : 'were'} not checked`
}

/**
 * Why an improver run failed, or null when it exited 0 (D-141, T-02-77): `it exited with <code>` for any other exit;
 * for a run the host gave no result for, `it timed out` when it lasted IMPROVER_TIMEOUT_MS or longer by the clock,
 * since the host gives up a run at its time, else `it could not start`. `elapsedMs` is null when the clock was not
 * read.
 */
export function improverFailure(run: HostRun | null, elapsedMs: number | null): string | null {
  if (run !== null) return run.exitCode === 0 ? null : `it exited with ${run.exitCode}`
  if (elapsedMs !== null && elapsedMs >= IMPROVER_TIMEOUT_MS) return 'it timed out'

  return 'it could not start'
}

/** How many built files the improver changed and the person accepted, of how many the pass ran for (D-141). */
export type ImproverTally = {
  readonly changed: number
  readonly total: number
}

/** The reply line of an improver pass (D-141), which comes right after the applied lines. */
export function improverLine(tally: ImproverTally): string {
  return `Improver: ${tally.changed} of ${tally.total} built files changed and accepted.`
}

/** What the improver pass did (G-02-1f, D-141), with its tally. */
export type ImproverOutcome = ImproverTally & {
  /** The text of each repo file whose change the person accepted, by repo-relative path: the manifest records it. */
  readonly accepted: ReadonlyMap<string, string>
  /**
   * The built files to write back as cadre built them: each kept, not answered, left unreadable, changed by a run that
   * failed, or changed before its own run (02-GAPS-B3 M1).
   */
  readonly restores: readonly BuiltFile[]
  /**
   * The reply warnings of the pass, file by file: a file changed before its own run, a per-file question that got no
   * usable answer, the other files a run changed, and the files of a run's folder that were not checked.
   */
  readonly warnings: readonly string[]
}

/**
 * What the pass did with one built file: the text the person accepted (null when the file stays or goes back as
 * built), whether it goes back to be written as built, and the reply warnings of its run.
 */
type ImprovedFile = {
  readonly accepted: string | null
  readonly isRestored: boolean
  readonly warnings: readonly string[]
}

/**
 * A built file as the improver pass reads it, before and after its run (D-141, T-02-76): only a regular file that is
 * not a link, and for a repo file one whose real path lies inside the repo, is read, up to MAX_READ_BYTES; any other
 * path is `unknown`, and a missing one `absent`. So a link the improver left is never read or shown.
 */
async function builtRead(io: InitIo, file: BuiltFile, root: string): Promise<PortRead> {
  const stat = await io.stat(file.path)
  if (stat === null) return { state: await missingState(io, file.path) }
  if (stat.isLink || stat.kind !== 'file') return { state: 'unknown' }
  if (file.repoPath !== null && !isFileInsideRoot(stat, root)) return { state: 'unknown' }

  return io.read(file.path, MAX_READ_BYTES)
}

/** Whether two reads of one path found the same: the same state and, for text, the same text or size. */
function isSameRead(before: PortRead, after: PortRead): boolean {
  if (before.state === 'text' && after.state === 'text') return before.text === after.text
  if (before.state === 'too-large' && after.state === 'too-large') return before.bytes === after.bytes

  return before.state === after.state
}

/** Where the improver pass shows a path from: the repo and the home folder of the run, and CLAUDE_CONFIG_DIR. */
type ShownFrom = Pick<InitLocations, 'home' | 'root' | 'configDir'>

/** A path as the improver pass shows it: one under the repo as a repo-relative path, else as displayPath shows it. */
function shownPathOf(path: string, from: ShownFrom): string {
  const base = `${trimSlash(from.root)}/`
  if (path.startsWith(base)) return reportText(path.slice(base.length))

  return displayPath(path, from.home, from.root, from.configDir)
}

/** The most files one look at an improver run's folder reads (D-141, T-02-75); more are counted as not checked. */
const MAX_SNAPSHOT_FILES = 200

/**
 * How many levels of sub-folders below an improver run's folder a look lists (D-141): deep enough for
 * `.runtime/overlay/.claude/skills/<name>` and `.runtime/instructions/memory/<name>` (02-GAPS-B3 M1).
 */
const SNAPSHOT_LEVELS = 4

/** What a look keeps for a file it found past MAX_SNAPSHOT_FILES: it was not read. */
const UNCHECKED = 'unchecked'

/** What a look keeps for a file it could not read. */
const UNREAD = 'unknown'

/**
 * One look at the folder an improver run starts in (D-141, T-02-75): for each file found, by absolute path, the
 * sha256Hex of its text, its size when it is over MAX_READ_BYTES, UNREAD when it could not be read; for each folder
 * kept as an entry, `dir` and the hash of its entry names, UNREAD when it could not be listed (02-GAPS-B3 M1); or
 * UNCHECKED past MAX_SNAPSHOT_FILES.
 */
type Snapshot = ReadonlyMap<string, string>

/** What a look keeps for one file: the hash of its text, its size over the read cap, or UNREAD. */
async function fileMark(io: InitIo, path: string): Promise<string> {
  const read = await io.read(path, MAX_READ_BYTES)
  if (read.state === 'text') return sha256Hex(read.text)
  if (read.state === 'too-large') return `too-large ${read.bytes}`

  return UNREAD
}

/**
 * What a look keeps for one folder (02-GAPS-B3 M1): `dir` and the sha256Hex of its entry names, sorted and joined by
 * line breaks, so an entry added or removed shows; UNREAD when it cannot be listed.
 */
async function folderMark(io: InitIo, path: string): Promise<string> {
  const entries = await io.list(path)
  if (entries === null) return UNREAD

  return `dir ${await sha256Hex(entries.map(entry => entry.name).sort(compareText).join('\n'))}`
}

/**
 * A look at the folder an improver run starts in (folderSnapshot, D-141, T-02-75; 02-GAPS-B3 M1): the folder and its
 * real sub-folders SNAPSHOT_LEVELS levels down are listed, and each real folder found at the last level is kept as a
 * folder entry. A link the stat finds to be a folder is listed once, one level into its target: each file there is
 * kept as a file entry, read through, and each folder as a folder entry. Every other entry, a file link included, is
 * a file entry, so it is read through. A folder that cannot be listed adds nothing, `watched` adds each path it names
 * as a file entry, and `except`, the built file itself, is left out. The first MAX_SNAPSHOT_FILES entries in path
 * order are marked, a file up to MAX_READ_BYTES (fileMark) and a folder by its entry names (folderMark); the rest are
 * kept UNCHECKED.
 */
async function folderSnapshot(
  io: InitIo,
  folder: string,
  except: string,
  watched: readonly string[],
): Promise<Snapshot> {
  const files: string[] = [...watched]
  const folders: string[] = []
  let level: readonly string[] = [folder]
  for (let depth = 0; depth <= SNAPSHOT_LEVELS && level.length > 0; depth += 1) {
    const below: string[] = []
    for (const listed of level) {
      for (const entry of (await io.list(listed)) ?? []) {
        const path = `${listed}/${entry.name}`
        if (entry.kind === 'dir' && !entry.isLink) {
          const into = depth < SNAPSHOT_LEVELS ? below : folders
          into.push(path)
          continue
        }
        if (!entry.isLink || (await io.stat(path))?.kind !== 'dir') {
          files.push(path)
          continue
        }
        for (const inner of (await io.list(path)) ?? []) {
          const into = inner.kind === 'dir' && !inner.isLink ? folders : files
          into.push(`${path}/${inner.name}`)
        }
      }
    }
    level = below
  }
  const isFolder = new Set(folders)
  const marks = new Map<string, string>()
  for (const [index, path] of sortedUnique([...files, ...folders].filter(path => path !== except)).entries()) {
    if (index >= MAX_SNAPSHOT_FILES) marks.set(path, UNCHECKED)
    else marks.set(path, isFolder.has(path) ? await folderMark(io, path) : await fileMark(io, path))
  }

  return marks
}

/** What two looks at an improver run's folder show (D-141, T-02-75): the other files changed, and the unchecked. */
type FolderChanges = {
  readonly paths: readonly string[]
  readonly unchecked: number
}

/**
 * The other files an improver run changed (D-141, T-02-75), in path order: each path one look has and the other has
 * not (added or removed), and each whose mark differs (changed, or became unreadable); a path both looks found but one
 * of them did not read is counted as not checked instead.
 */
function folderChanges(before: Snapshot, after: Snapshot): FolderChanges {
  const paths: string[] = []
  let unchecked = 0
  for (const path of sortedUnique([...before.keys(), ...after.keys()])) {
    const was = before.get(path)
    const now = after.get(path)
    const isUnchecked = was === UNCHECKED || now === UNCHECKED
    if (was !== undefined && now !== undefined && isUnchecked) unchecked += 1
    if (was === undefined || now === undefined || (!isUnchecked && was !== now)) paths.push(path)
  }

  return { paths, unchecked }
}

/**
 * What became of the built file of an improver run (D-141, T-02-76): its run `failed` (improverFailure), with whether
 * the run changed it anyway; `unchanged`, it still holds the built text or reads as it did before the run;
 * `unreadable`, it changed into something cadre cannot read and show (builtRead); or `changed`, with its new text and
 * its diff from the built text.
 */
type BuiltState =
  | { readonly kind: 'failed'; readonly reason: string; readonly isChanged: boolean }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'changed'; readonly text: string; readonly diff: LineDiff }

/** What became of a built file, from its reads before and after its run and why the run failed, if it did. */
function builtState(file: BuiltFile, before: PortRead, after: PortRead, failure: string | null): BuiltState {
  const isAsBuilt = after.state === 'text' && after.text === file.text
  const isChanged = !isAsBuilt && !isSameRead(before, after)
  if (failure !== null) return { kind: 'failed', reason: failure, isChanged }
  if (!isChanged) return { kind: 'unchanged' }
  if (after.state !== 'text') return { kind: 'unreadable' }

  return { kind: 'changed', text: after.text, diff: lineDiff(file.text, after.text) }
}

/** The note of a built file the person is not asked about (D-141): why the run failed, no change, or unreadable. */
function stateNote(state: Exclude<BuiltState, { readonly kind: 'changed' }>, path: string): string {
  if (state.kind === 'failed') return improverFailedNote(path, state.reason)
  if (state.kind === 'unchanged') return improverNoChangeNote(path)

  return improverUnreadableNote(path)
}

/**
 * One file of the improver pass (G-02-1f, D-141; 02-GAPS-B3 M1). It reads the file (builtRead) first: one that is not
 * its built text, changed or removed by an earlier run, gets no run and no look and goes back as built, with
 * changedBeforeRunWarning; a repo file whose run has no guard (runFlags null) gets no run either, only the note of
 * UNGUARDED_RUN_REASON, and stays as built. Else it looks at the file's folder and the paths `watched` names
 * (folderSnapshot), runs improverArgv with the file's flags in that folder with IMPROVER_TIMEOUT_MS, the clock read
 * around the run, then reads and looks again. Other files the run changed, and files it could not check, are reply
 * warnings and rows of the improver block; they are never undone. A file whose run failed, that did not change, or
 * that changed into something cadre cannot read gets its note and no question; a failed run's change and an unreadable
 * file go back as built. A changed file's diff from the built text is shown in the improver block and the per-file
 * question is asked: Accept keeps the new text, Keep original gives the file back, and a question with no usable answer
 * gives it back with a warning.
 */
async function improveOne(io: InitIo, host: HostIo, file: BuiltFile, from: ShownFrom): Promise<ImprovedFile> {
  const folder = parentOf(file.path)
  const shownPath = shownPathOf(file.path, from)
  const shownFolder = shownPathOf(folder, from)
  const before = await builtRead(io, file, from.root)
  if (before.state !== 'text' || before.text !== file.text) {
    return { accepted: null, isRestored: true, warnings: [changedBeforeRunWarning(shownPath)] }
  }
  if (file.runFlags === null) {
    await noteLine(io, improverFailedNote(shownPath, UNGUARDED_RUN_REASON))

    return { accepted: null, isRestored: false, warnings: [] }
  }
  const beforeFolder = await folderSnapshot(io, folder, file.path, file.watched)
  const started = await io.now()
  const run = await host.run(improverArgv(file.path, file.runFlags), { cwd: folder, timeoutMs: IMPROVER_TIMEOUT_MS })
  const ended = await io.now()
  const after = await builtRead(io, file, from.root)
  const others = folderChanges(beforeFolder, await folderSnapshot(io, folder, file.path, file.watched))
  const otherPaths = others.paths.map(path => shownPathOf(path, from))
  const otherLines = otherFilesLines(shownFolder, otherPaths)
  const warnings = [
    ...(otherPaths.length === 0 ? [] : [otherChangesWarning(shownFolder, otherPaths)]),
    ...(others.unchecked === 0 ? [] : [uncheckedFilesWarning(others.unchecked, shownFolder)]),
  ]
  const failure = improverFailure(run, started === null || ended === null ? null : ended - started)
  const state = builtState(file, before, after, failure)
  if (state.kind !== 'changed') {
    await noteLine(io, stateNote(state, shownPath))
    if (otherLines.length > 0) await showBlock(io, 'improver', otherLines)
    const isRestored = state.kind === 'unreadable' || (state.kind === 'failed' && state.isChanged)

    return { accepted: null, isRestored, warnings }
  }
  await showBlock(io, 'improver', [...improverBlockLines(shownPath, state.diff), ...otherLines])
  const answer = await askChoice(io, {
    question: withContext(improverQuestion(shownPath), improverContextLine(state.diff)),
    spec: { options: IMPROVER_OPTIONS, header: ASK_HEADERS.improver },
    parse: parseImproverAnswer,
    accepts: quotedLabels(IMPROVER_OPTIONS),
  })
  if (answer.kind !== 'answered') {
    return { accepted: null, isRestored: true, warnings: [improverDismissedWarning(shownPath), ...warnings] }
  }

  return answer.value === 'accept'
    ? { accepted: state.text, isRestored: false, warnings }
    : { accepted: null, isRestored: true, warnings }
}

/**
 * The improver pass (G-02-1f, D-141 imp-b): after Confirm, once the built files are written and before the manifest,
 * each file in `files` gets one improver run in turn, in place (improveOne), and the person reviews each change. A file
 * an earlier run changed is written back as built with no run of its own, and a repo file whose run has no guard gets
 * no run (02-GAPS-B3 M1). It gives the accepted text of each repo file for the manifest, the files to write back as
 * built (restoreSteps), the reply warnings, and how many files were changed and accepted of how many it was given. It
 * writes nothing itself; a dry run never reaches it, since it holds no HostIo (T-03-16).
 */
export async function improveBuiltFiles(
  io: InitIo,
  host: HostIo,
  files: readonly BuiltFile[],
  from: ShownFrom,
): Promise<ImproverOutcome> {
  const accepted = new Map<string, string>()
  const restores: BuiltFile[] = []
  const warnings: string[] = []
  let changed = 0
  for (const file of files) {
    const result = await improveOne(io, host, file, from)
    warnings.push(...result.warnings)
    if (result.isRestored) restores.push(file)
    if (result.accepted === null) continue
    changed += 1
    if (file.repoPath !== null) accepted.set(file.repoPath, result.accepted)
  }

  return { accepted, restores, warnings, changed, total: files.length }
}

/** One framework command apply runs for an accepted hunk: the hunk's key and file, the argv, and its display form. */
export type HunkRun = {
  readonly key: string
  readonly file: string
  /** Re-resolved from the adapter proposal (D-106); never printed, since it holds the raw user-level GSD dir. */
  readonly argv: readonly string[]
  /** The command as the person may run it by hand, with the GSD dir shown as `~/...` (D-71). */
  readonly display: string
}

/**
 * The adapter proposal a hunk was asked from (A5): among the adapters whose autonomyHunks(setup) changes the hunk's
 * file, the first proposal they offer for this setup whose key is the hunk's key; null when none does. Only the
 * hunk's file and key are read, never its before, after or displayed command (D-106).
 */
export function hunkProposal(setup: SetupScan, hunk: HunkOp): SettingProposal | null {
  for (const adapter of ADAPTERS) {
    const offered = adapter.autonomyHunks(setup)
    if (offered === null || offered.file !== hunk.file) continue
    const proposal = offered.proposals.find(candidate => candidate.key === hunk.key)
    if (proposal !== undefined) return proposal
  }

  return null
}

/**
 * The framework commands apply runs, before it renders and hashes ROLE.md (D-120): one for each hunk the person
 * accepted and cadre can run, in hunk order. The argv is re-resolved from the hunk's adapter proposal with
 * resolveToolCommand and is never parsed from the command, before or after text the plan displayed (D-106, D-71).
 * Without a proven user-level GSD the command resolves no argv, so a repo-local GSD gives no run and is only printed
 * for the person (D-28, D-72); a hunk no adapter offers gives no run either.
 */
export function hunkRuns(hunks: readonly HunkOp[], setup: SetupScan, gsd: GsdToolContext): HunkRun[] {
  const runs: HunkRun[] = []
  for (const hunk of hunks) {
    if (!hunk.isAccepted || !hunk.isRunnable) continue
    const proposal = hunkProposal(setup, hunk)
    if (proposal === null) continue
    const { argv, display } = resolveToolCommand(proposal.write, gsd)
    if (argv === null) continue
    runs.push({ key: hunk.key, file: hunk.file, argv, display })
  }

  return runs
}

/**
 * The hunks after their runs (D-106, D-120): each hunk whose key is in `failed` is no longer runnable, so isUnmetHunk
 * makes the roles of its framework attended when it is required and the plan re-judges them before ROLE.md is
 * rendered; every other hunk is kept as it was. The hunks given are not changed. A failure is matched by key, which is
 * unique while every hunk targets the one GSD config file; key it by file and key once a second hunk file exists.
 */
export function hunksAfterRuns(hunks: readonly HunkOp[], failed: ReadonlySet<string>): HunkOp[] {
  return hunks.map(hunk => (failed.has(hunk.key) ? { ...hunk, isRunnable: false } : hunk))
}

/**
 * The line init prints for a framework command that failed at apply (D-106): the file and the key it changes, and the
 * command in display form for the person to run themselves. Every value is cleaned and capped as a report cell is.
 */
export function hunkFailureLine(run: HunkRun): string {
  const change = `the ${reportText(run.file)} change ${reportText(run.key)}`

  return `${change} failed: run it yourself: ${reportText(run.display)}`
}

/**
 * The argv that installs a plugin by its exact key (decision #39). Init runs it only after Confirm, through the host
 * port, with the home folder as cwd.
 */
export function pluginInstallArgv(key: string): readonly string[] {
  return ['claude', 'plugin', 'install', key]
}

/**
 * The argv of the Python check init runs right before the claude-security install (decision #39): claude-security's
 * README asks for Python 3.9 or newer on PATH. Like every install run it has the home folder as cwd, so no repo-level
 * settings or marketplace definitions take part (T-03-46).
 */
export const PYTHON_VERSION_ARGV: readonly string[] = Object.freeze(['python3', '--version'])

/**
 * The argv that adds Anthropic's official marketplace (decision #39): init runs it once per apply, after the first
 * install that fails, and then tries that install once more. It has the home folder as cwd, never the repo, so no
 * repo-level settings or marketplace definitions take part (T-03-46).
 */
export const MARKETPLACE_ADD_ARGV: readonly string[] = Object.freeze([
  'claude',
  'plugin',
  'marketplace',
  'add',
  'anthropics/claude-plugins-official',
])

/**
 * The text init prints for a plugin it could not install (decision #39): the command to run by hand, and, when the
 * marketplace add failed too, that add as a first step only for a missing marketplace, since the add also fails when
 * the marketplace is there already (decision #69 A3). The key is cleaned and capped as a report cell is.
 */
export function installFailureText(key: string, isMarketplaceFailed: boolean): string {
  const shown = reportText(key)
  const install = `claude plugin install ${shown}`
  const add = ` (if the claude-plugins-official marketplace is missing, first run: ${MARKETPLACE_ADD_ARGV.join(' ')})`

  return `could not install ${shown}: run it yourself: ${install}${isMarketplaceFailed ? add : ''}`
}

/**
 * The line init prints once plugins were installed (decision #39): their keys, and that /reload-plugins loads them in
 * the session that ran init. Each key is cleaned and capped as a report cell is.
 */
export function installedLine(keys: readonly string[]): string {
  const them = keys.length === 1 ? 'it' : 'them'

  return `Installed ${keys.map(reportText).join(' and ')}: run /reload-plugins to load ${them} in this session.`
}

/** The version line python3 prints, `Python <major>.<minor>...`, with the major and minor version (decision #39). */
const PYTHON_VERSION_LINE = /^Python (\d+)\.(\d+)/

/**
 * Why claude-security is not to be installed, or null when Python is fine for it (decision #39): claude-security's
 * README asks for Python 3.9 or newer on PATH. A run of PYTHON_VERSION_ARGV the host rejected, or that did not exit 0,
 * means python3 was not found. Otherwise the first line with text of stdout, else of stderr (an older python3 prints
 * its version there), must be a PYTHON_VERSION_LINE of 3.9 or newer; any other line is named, cleaned and capped as a
 * report cell is (T-03-45), and output with no text says nothing. The text ends with the command to run once Python is
 * there.
 */
export function pythonProblem(run: HostRun | null): string | null {
  const needs = (why: string): string =>
    `claude-security was not installed: it needs Python 3.9 or newer on PATH (${why}): install it, then run: ` +
    pluginInstallArgv(CLAUDE_SECURITY_PLUGIN).join(' ')
  if (run === null || run.exitCode !== 0) return needs('python3 was not found')
  const firstLine = (text: string): string | undefined => text.split(/\r?\n/).find(line => line.trim() !== '')
  const line = firstLine(run.stdout) ?? firstLine(run.stderr)
  if (line === undefined) return needs('python3 --version says nothing')
  const match = PYTHON_VERSION_LINE.exec(line)
  const major = Number(match?.[1])
  const minor = Number(match?.[2])
  if (major > 3 || (major === 3 && minor >= 9)) return null

  return needs(`python3 --version says ${reportText(line)}`)
}

/**
 * The text init prints for each plugin to install when no home folder is known to run the installs from (decision
 * #39): nothing is run then, since a run from the repo would let its settings and marketplace definitions take part
 * (T-03-46). The key is cleaned and capped as a report cell is.
 */
export function noHomeInstallText(key: string): string {
  const shown = reportText(key)

  return (
    `could not install ${shown}: no home folder is known to run it from: run it yourself: ` +
    `claude plugin install ${shown}`
  )
}

/**
 * The setup scan the plan is made again from after the installs (decision #39): the setup with each installed plugin
 * key added to its plugins and to its installed plugins, sorted and once each, as the next scan lists them, so a
 * Security role's settings enable claude-security once it is installed. The review plans from it too, with the keys
 * answered Install, so the cards and the plan it shows are those Confirm writes when every install works (decision #69
 * A4). The setup given is not changed.
 */
export function setupAfterInstalls(setup: SetupScan, installed: readonly string[]): SetupScan {
  return {
    ...setup,
    plugins: sortedUnique([...setup.plugins, ...installed]),
    installedPlugins: sortedUnique([...setup.installedPlugins, ...installed]),
  }
}
