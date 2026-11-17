/**
 * The improver pass, a layer 9 module: between the file writes and the manifest, one `claude -p` run per private text
 * file in its own folder, then its diff and the Accept or Keep original question, the files written back as built and
 * the reply lines of the pass. Each run goes through HostIo.run, while its reads and questions go through InitIo, which
 * can neither write nor run. It imports core, paths, scan, ui/ask, ui/diff, the private role files, the write safety
 * checks and the types, so the apply runner and init read it here.
 */
import type { AskContext, ContextRow, HostIo, HostRun, InitIo, InitLocations, PortRead } from '../../types'
import { sha256Hex } from '../core/hash'
import { labelled } from '../core/labelled'
import type { Labelled } from '../core/labelled'
import { compareText, reportText, sortedUnique } from '../core/text'
import { PROMPTS } from '../locales/prompts'
import { fill, t, tn } from '../locales/t'
import { displayPath, parentOf, trimSlash } from '../paths'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { missingState } from '../scan/port-read'
import { ASK_HEADERS, askChoice, noteLine, paneQuestionOf, quotedLabels } from '../ui/ask'
import { diffLines, lineDiff } from '../ui/diff'
import type { LineDiff } from '../ui/diff'
import { privateClaudeMdPath } from './private'
import type { ApplyStep } from './private'
import { privateFolderOf } from './safety'

/** How long one improver run may take before it is given up (G-02-1f, D-141, T-02-77): the file then stays as built. */
export const IMPROVER_TIMEOUT_MS = 300_000

/** The status line or pane loader set before the writes and before each improver run (D-284, S-02). */
export const IMPROVER_PROGRESS = t('init.status.improver')

/**
 * The argv of one improver run: `claude -p` in acceptEdits, so the run edits the file in place and asks nothing, then
 * `--` and a prompt that names the claude-md-management:claude-md-improver skill and the file's absolute path.
 */
export function improverArgv(path: string): readonly string[] {
  return [
    'claude',
    '-p',
    '--permission-mode',
    'acceptEdits',
    '--',
    fill(PROMPTS.improverPrompt, { path }),
  ]
}

/** One private text file the improver pass offers: its absolute path and the text cadre built and wrote there. */
export type BuiltFile = {
  readonly path: string
  readonly text: string
}

/**
 * What builtRoleFiles offers: the role memory folders whose private text holds a global part, since a header alone has
 * nothing to improve.
 */
export type BuiltFilter = {
  readonly privateFolders: ReadonlySet<string>
}

/**
 * The private text files of an apply the improver pass offers, in step order: the text file of each private step whose
 * folder is in `filter.privateFolders`; every other file is left out.
 */
export function builtRoleFiles(steps: readonly ApplyStep[], filter: BuiltFilter): BuiltFile[] {
  return steps.flatMap((step): BuiltFile[] => {
    if (step.kind !== 'private' || !filter.privateFolders.has(step.path)) return []
    const textPath = privateClaudeMdPath(step.path)

    return step.files.filter(file => file.path === textPath)
  })
}

/**
 * The steps that write private text files back as cadre built them after the improver pass: each as the private step
 * of its role memory folder, so the write gets the same checks as the first one; a path outside one gives none.
 */
export function restoreSteps(files: readonly BuiltFile[]): ApplyStep[] {
  return files.flatMap((file): ApplyStep[] => {
    const folder = privateFolderOf(file.path)

    return folder === null ? [] : [{ kind: 'private', path: folder, files: [{ path: file.path, text: file.text }] }]
  })
}

/** Each answer to the per-file improver question with its choice (D-141, D-225): one EN key draws and parses it. */
const IMPROVER_LABELS: readonly Labelled<ImproverChoice>[] = Object.freeze([
  { label: t('apply.improver.accept'), value: 'accept' },
  { label: t('apply.improver.keepOriginal'), value: 'keep' },
])

/** The answers to the per-file improver question, Accept first (D-141). */
export const IMPROVER_OPTIONS: readonly string[] = Object.freeze(IMPROVER_LABELS.map(entry => entry.label))

/** What the person chose for one improved file: the improver's text, or the text cadre built. */
type ImproverChoice = 'accept' | 'keep'

/** The answer to the per-file improver question: Accept or Keep original, trimmed and in any case; else null. */
function parseImproverAnswer(answer: string): ImproverChoice | null {
  return labelled(IMPROVER_LABELS, answer)
}

/** How many lines a diff adds and removes, as the improver block and question say it (D-141). */
function diffCounts(diff: LineDiff): string {
  return tn('apply.improver.diffCounts', diff.added, { count: diff.added, removed: diff.removed })
}

/** The per-file improver question (D-141): whether to keep the improver's changes to the file at the shown path. */
export function improverQuestion(path: string): string {
  return t('apply.improver.improverQuestion', { path })
}

/** The context line of the per-file improver question (D-136, D-141): the size of the change, and where its diff is. */
export function improverContextLine(diff: LineDiff): string {
  return t('apply.improver.improverContextLine', { diffCounts: diffCounts(diff) })
}

/**
 * The improver block of one file (G-02-1f, D-141): its shown path with how many lines the improver added and removed,
 * then the changed lines as diffLines shows them, their secret-like spans hidden before the cap (E1, PR-S1; only the
 * shown lines, never the text the improver left or cadre writes back).
 */
export function improverBlockLines(path: string, diff: LineDiff): string[] {
  return [t('apply.improver.improverBlockLines', {
    path,
    diffCounts: diffCounts(diff),
  }), ...diffLines(diff)]
}

/**
 * The context of the per-file improver question (D-236): its diff, as the improver block shows it, then the other files
 * the run changed (otherFilesLines, T-02-75); its summary is the block's first line, the file with how many lines the
 * improver added and removed (D-310). Its rows hold that line as a field of the path and the counts, then every other
 * line as one plain row (D-313).
 */
export function improverContext(path: string, diff: LineDiff, otherLines: readonly string[]): AskContext {
  const [summary = '', ...diffRows] = improverBlockLines(path, diff)
  const lines = [summary, ...diffRows, ...otherLines]
  const rows: ContextRow[] = [
    { role: 'field', label: path, text: diffCounts(diff), indent: 0 },
    ...[...diffRows, ...otherLines].map((line): ContextRow => ({ role: 'plain', text: line, indent: 0 })),
  ]
  const title = t('apply.improver.improverContext', { path: reportText(path) })

  return { title, lines, kind: 'improver', summary, rows: [{ title: null, rows }] }
}

/** The note for a built file the improver ran on and did not change (D-141). */
export function improverNoChangeNote(path: string): string {
  return t('apply.improver.improverNoChangeNote', { path })
}

/** The note for a built file whose improver run failed (D-141, T-02-77): why, and that the file stays as built. */
export function improverFailedNote(path: string, reason: string): string {
  return t('apply.improver.improverFailedNote', { path, reason })
}

/**
 * The note for a built file the improver left as something cadre cannot read and show as a diff: gone, a link, not a
 * regular file, over the read cap or unreadable (D-141, T-02-76); it is written back as built.
 */
export function improverUnreadableNote(path: string): string {
  return t('apply.improver.improverUnreadableNote', { path })
}

/** The reply warning for a per-file improver question that got no usable answer (D-141): the file stays as built. */
export function improverDismissedWarning(path: string): string {
  return t('apply.improver.improverDismissedWarning', { path })
}

/**
 * The reply warning for a built file that was not its built text when its own improver run was due (02-GAPS-B3 M1):
 * an earlier run changed or removed it; it gets no run and is written back as built.
 */
export function changedBeforeRunWarning(path: string): string {
  return t('apply.improver.changedBeforeRunWarning', { path })
}

/** The most other files the reply warning of one improver run names; the improver block names them all (D-141). */
const MAX_NAMED_OTHERS = 3

/**
 * The reply warning for an improver run that changed other files in its folder (D-141, T-02-75), the risk the person
 * accepted in place of a scratch copy: how many, the folder, the first MAX_NAMED_OTHERS shown paths and how many more,
 * and that they are listed above: their rows are shown at the improver question, and logged when the file did not
 * change, so the TUI default prints them too (WD-M3). They are not undone.
 */
export function otherChangesWarning(folder: string, paths: readonly string[]): string {
  const named = paths.slice(0, MAX_NAMED_OTHERS)
  const rest = paths.length - named.length
  const listed = rest === 0 ? named.join(', ') : t('apply.improver.otherListed', { named: named.join(', '), rest })

  return tn('apply.improver.otherChanges', paths.length, { count: paths.length, folder, listed })
}

/**
 * The rows of the improver block that name the other files an improver run changed (D-141, T-02-75): a heading with
 * the run's folder, then one row per shown path; none when there is none.
 */
export function otherFilesLines(folder: string, paths: readonly string[]): string[] {
  if (paths.length === 0) return []

  return [t('apply.improver.otherFilesLines', { folder }), ...paths.map(path => `  ${path}`)]
}

/**
 * The reply warning for an improver run's folder that held more files than one look checks (D-141, T-02-75): how many
 * files a change of was not checked.
 */
export function uncheckedFilesWarning(count: number, folder: string): string {
  return tn('apply.improver.unchecked', count, { count, folder })
}

/**
 * Why an improver run failed, or null when it exited 0 (D-141, T-02-77): `it exited with <code>` for any other exit;
 * for a run the host gave no result for, `it timed out` when it lasted IMPROVER_TIMEOUT_MS or longer by the clock,
 * since the host gives up a run at its time, else `it could not start`. `elapsedMs` is null when the clock was not
 * read.
 */
export function improverFailure(run: HostRun | null, elapsedMs: number | null): string | null {
  if (run !== null) return run.exitCode === 0 ? null : t('apply.improver.improverFailure', { exitCode: run.exitCode })
  if (elapsedMs !== null && elapsedMs >= IMPROVER_TIMEOUT_MS) return t('apply.improver.improverFailure2')

  return t('apply.improver.improverFailure3')
}

/** How many built files the improver changed and the person accepted, of how many the pass ran for (D-141). */
export type ImproverTally = {
  readonly changed: number
  readonly total: number
}

/** The reply line of an improver pass (D-141), which comes right after the applied lines. */
export function improverLine(tally: ImproverTally): string {
  return t('apply.improver.improverLine', { changed: tally.changed, total: tally.total })
}

/** What the improver pass did, with its tally. */
export type ImproverOutcome = ImproverTally & {
  /**
   * The built files to write back as cadre built them: each kept, not answered, left unreadable, changed by a run that
   * failed, or changed before its own run.
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
 * A built file as the improver pass reads it, before and after its run: only a regular file that is not a link is
 * read, up to MAX_READ_BYTES; any other path is `unknown` and a missing one `absent`, so a link is never read or shown.
 */
async function builtRead(io: InitIo, file: BuiltFile): Promise<PortRead> {
  const stat = await io.stat(file.path)
  if (stat === null) return { state: await missingState(io, file.path) }
  if (stat.isLink || stat.kind !== 'file') return { state: 'unknown' }

  return io.read(file.path, MAX_READ_BYTES)
}

/** Whether two reads of one path found the same: the same state and, for text, the same text or size. */
function isSameRead(before: PortRead, after: PortRead): boolean {
  if (before.state === 'text' && after.state === 'text') return before.text === after.text
  if (before.state === 'too-large' && after.state === 'too-large') return before.bytes === after.bytes

  return before.state === after.state
}

/** Where the improver pass shows a path from: the repo and the home folder of the run, and CLAUDE_CONFIG_DIR. */
export type ShownFrom = Pick<InitLocations, 'home' | 'root' | 'configDir'>

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
 * A look at the folder an improver run starts in, `except` (the built file) left out: real sub-folders are listed
 * SNAPSHOT_LEVELS levels down and a folder link one level into its target, each file is marked by fileMark and each
 * last-level folder by folderMark, and past MAX_SNAPSHOT_FILES entries in path order the rest are kept UNCHECKED.
 */
async function folderSnapshot(io: InitIo, folder: string, except: string): Promise<Snapshot> {
  const files: string[] = []
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
 * One file of the improver pass: a file that is no longer its built text gets no run and goes back as built with
 * changedBeforeRunWarning; else improverArgv runs in its folder between two looks at that folder, whose other changes
 * are reported and never undone. A changed file is asked about with its diff as the question's context (Accept keeps
 * it, else it goes back); any other outcome gets its note, and a failed run's change or an unreadable file goes back.
 */
async function improveOne(io: InitIo, host: HostIo, file: BuiltFile, from: ShownFrom): Promise<ImprovedFile> {
  const folder = parentOf(file.path)
  const shownPath = shownPathOf(file.path, from)
  const shownFolder = shownPathOf(folder, from)
  const before = await builtRead(io, file)
  if (before.state !== 'text' || before.text !== file.text) {
    return { accepted: null, isRestored: true, warnings: [changedBeforeRunWarning(shownPath)] }
  }
  const beforeFolder = await folderSnapshot(io, folder, file.path)
  const started = await io.now()
  const run = await host.run(improverArgv(file.path), { cwd: folder, timeoutMs: IMPROVER_TIMEOUT_MS })
  const ended = await io.now()
  const after = await builtRead(io, file)
  const others = folderChanges(beforeFolder, await folderSnapshot(io, folder, file.path))
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
    for (const line of otherLines) await noteLine(io, line)
    const isRestored = state.kind === 'unreadable' || (state.kind === 'failed' && state.isChanged)

    return { accepted: null, isRestored, warnings }
  }
  const context = improverContext(shownPath, state.diff, otherLines)
  const contextLine = improverContextLine(state.diff)
  // A pane surface asks the question with the context's summary, the file and its change counts (D-310).
  const pane = paneQuestionOf(improverQuestion(shownPath), contextLine, context.summary)
  const answer = await askChoice(io, {
    question: pane.asked,
    spec: {
      options: IMPROVER_OPTIONS,
      header: ASK_HEADERS.improver,
      context: { ...context, pane },
    },
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
 * The improver pass after Confirm, between the file writes and the manifest: one run per file in turn (improveOne), the
 * loader set again before each since a per-file question clears it. It gives the files to write back as built
 * (restoreSteps), the reply warnings and the tally, and writes nothing itself.
 */
export async function improveBuiltFiles(
  io: InitIo,
  host: HostIo,
  files: readonly BuiltFile[],
  from: ShownFrom,
): Promise<ImproverOutcome> {
  const restores: BuiltFile[] = []
  const warnings: string[] = []
  const summary = tn('init.status.count.files', files.length, { count: files.length })
  let changed = 0
  for (const file of files) {
    await io.progress(IMPROVER_PROGRESS, summary)
    const result = await improveOne(io, host, file, from)
    warnings.push(...result.warnings)
    if (result.isRestored) restores.push(file)
    if (result.accepted !== null) changed += 1
  }

  return { restores, warnings, changed, total: files.length }
}
