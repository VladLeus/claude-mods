/**
 * The gather and render halves of /cadre start (D-102); renderRole, which gathers and renders one role for the root it
 * is given, the session's for /cadre start and an epic worktree for /cadre epic (D-157); and runStart, the command
 * itself, which checks the repo and the team, runs renderRole through the HostIo port and hands over the launcher
 * command: printed, copied to the clipboard and, with `--terminal`, opened in a new terminal on macOS (LNCH-04, D-110,
 * D-109).
 *
 * The gather half reads, through the InitIo and HostIo ports only, and never writes: the facts about the launching
 * user that a role launch needs (gatherLaunchUser, D-98), and the user's `~/.claude.json` under the stored consent
 * (readClaudeJson, D-58), from which runtimeMcpText renders a role's MCP config (D-93).
 *
 * The render half gives the ordered steps that write a role's per-launch files into `.cadre/<id>/.runtime/`, and the
 * role's private instructions folder under the config folder (privateFolderSteps), from its LaunchPlan (D-98) and the
 * texts of its MCP config and probe expectations. It reads and writes nothing: /cadre start stats and lists the paths
 * renderPaths names, then runs the steps renderSteps gives, in order, through the host. The stamp is always the last
 * step, and the launcher trusts it: it refuses to start when the stamp is missing or older than the role files or a
 * rendered file, so a render that stops part way never starts a session (LNCH-03).
 */
import type {
  CadreState,
  CompiledScope,
  DesiredFile,
  HostIo,
  InitIo,
  InitLocations,
  LaunchStart,
  MemoryItem,
  PortEntry,
  PortStat,
  RoleSpec,
  RunOptions,
  SettingsSource,
  TerminalChoice,
} from '../types'
import {
  instructionsRecordPath,
  parseInstructionsRecord,
  privateLevelsProblem,
  privateModeArgv,
  roleFolderLevels,
} from './apply'
import type { RecordedMemory } from './apply'
import {
  clean,
  compareText,
  displayPath,
  isDirInsideRoot,
  isObject,
  MAX_READ_BYTES,
  parseJsonValue,
  sortedUnique,
  SOURCE_ORDER,
  trimSlash,
} from './facts'
import { desiredFiles, shQuote } from './generate'
import { sha256Hex } from './hash'
import { compileTeam, readTeam, regenBadRole, repoGuard, scanWarnings } from './init'
import type { RegenRead } from './init'
import { isMemoryIndexName, MEMORY_INDEX_FILE } from './instructions'
import {
  claudeMdImports,
  INSTRUCTIONS_RECORD_FILE,
  isPartsFlowRole,
  isSafeFileName,
  launchPlan,
  privateInstructionsDir,
  roleMemoryDir,
  unsafeMemoryNameWarning,
} from './launch'
import type { LaunchPlan, LaunchUser, OverlayLink } from './launch'
import {
  INBOX_FILE,
  MANIFEST_PATH,
  PRIVATE_INSTRUCTIONS_LINK,
  PROBE_EXPECTATIONS_FILE,
  RUNTIME_KICKOFF_FILE,
  RUNTIME_STAMP_FILE,
  stableJson,
} from './plan'
import { expectationsFor, probeExpectationsText } from './probe'
import { reportText, shown } from './render'
import { parseManifest, readRepoFile, ruleFiles, RULES_FOLDER } from './scan'
import {
  CLAUDE_JSON_MAX_BYTES,
  claudeJsonPathOf,
  claudeMdPathsOf,
  hookScriptOf,
  MARKDOWN_EXTENSION,
  markdownFileNames,
  memoryFolderOf,
  userDirOf,
} from './setup'

/** The name of the rendered runtime settings in `.runtime` (D-84). */
const SETTINGS_FILE = 'settings.json'

/** The name of the rendered MCP config in `.runtime` (D-93). */
const MCP_FILE = 'mcp.json'

/**
 * The name of the built-in framework's done marker in `.runtime`, which the kickoff has the session write before
 * AUTOPILOT_DONE (D-17); a render removes one an earlier run left (#63 A6).
 */
const DONE_MARKER_FILE = 'DONE.md'

/** The folder in `.runtime` a launcher adds with `--add-dir`; every render makes it, with or without links (D-102). */
const OVERLAY_FOLDER = 'overlay'

/**
 * The files a render writes into `.runtime`, in the order it writes them: the settings, the MCP config, the probe
 * expectations, the inbox when there is none, and the stamp last (D-102, D-114).
 */
const WRITTEN_FILES: readonly string[] = Object.freeze([
  SETTINGS_FILE,
  MCP_FILE,
  PROBE_EXPECTATIONS_FILE,
  INBOX_FILE,
  RUNTIME_STAMP_FILE,
])

/**
 * The files this render writes into `.runtime`, in order: WRITTEN_FILES, and for an epic render (`kickoff` set) the
 * epic kickoff RUNTIME_KICKOFF_FILE before the stamp (D-158), so it is refused, removed as a link and written as the
 * other written files are.
 */
function writtenFiles(input: RenderInput): readonly string[] {
  if (input.kickoff === undefined) return WRITTEN_FILES

  return [...WRITTEN_FILES.filter(name => name !== RUNTIME_STAMP_FILE), RUNTIME_KICKOFF_FILE, RUNTIME_STAMP_FILE]
}

/**
 * The folders under `.runtime` a render links into: the overlay skills and agents, and the global and memory
 * instructions. /cadre start stats each of them, with every folder from `.runtime` down to them, and lists each of
 * them, so a link an earlier render made there, which the plan no longer names, is removed, and a link planted at one
 * of them or above it refuses the render (T-03-20).
 */
export const STALE_LINK_FOLDERS: readonly string[] = Object.freeze([
  'overlay/.claude/skills',
  'overlay/.claude/agents',
  'instructions/global',
  'instructions/memory',
])

/**
 * One step of a render, in the order /cadre start runs it; every path is absolute:
 * - `remove`: remove a link, the stamp of an earlier render, or the DONE.md an earlier run left (`/bin/rm -f`);
 * - `mkdir`: make a folder and the folders above it (`/bin/mkdir -p`);
 * - `chmod`: make a private folder level mode 700 (`/bin/chmod 700`, 02-GAPS-B3 S7);
 * - `link`: make `path` a symbolic link to `target` (`/bin/ln -sfn`);
 * - `write`: write the text to the path; the host writes it, so it has no argv.
 */
export type RenderStep =
  | { readonly kind: 'remove'; readonly path: string }
  | { readonly kind: 'mkdir'; readonly path: string }
  | { readonly kind: 'chmod'; readonly path: string }
  | { readonly kind: 'link'; readonly path: string; readonly target: string }
  | { readonly kind: 'write'; readonly path: string; readonly text: string }

/**
 * What /cadre start does in the memory folder of a parts-flow role (G-02-1f, D-140 q3-a), as gatherLaunchUser decides
 * it: `links`, each memory the role was given linked, `<role memory folder>/<file>` to its original, in the order of
 * its hand-out record; `removals`, each link an earlier start made there that this one does not make, removed first;
 * and `index`, the role's MEMORY.md with cadre's block set to the linked memories, or null when it stays as it is.
 */
export type MemoryLinks = {
  readonly links: readonly OverlayLink[]
  readonly removals: readonly string[]
  readonly index: { readonly path: string; readonly text: string } | null
}

/** Nothing to do in a role memory folder: a whole-files role, or a role given no memory with no block to clear. */
export const NO_MEMORY_LINKS: MemoryLinks = Object.freeze({
  links: Object.freeze([]),
  removals: Object.freeze([]),
  index: null,
})

/**
 * What renderSteps plans from: the repo root as a realpath and the role id; the role's LaunchPlan, whose links all lie
 * under the role's `.runtime`, as launchPlan makes them; the texts of `mcp.json`, `probe-expectations.json` and the
 * stamp; the disk; and the memory links of the role (MemoryLinks). `stats` holds the stat of each path renderPaths
 * names, asked with resolve, and `listings` the listing of each folder it names. A path with no stat counts as not
 * there, and a folder with no listing as empty. `kickoff`, the text of `.runtime/kickoff.txt`, is set for an epic
 * render only (D-158); /cadre start leaves it out, so its render never writes or removes that file (D-168).
 */
export type RenderInput = {
  readonly root: string
  readonly id: string
  readonly plan: LaunchPlan
  readonly mcpText: string
  readonly expectationsText: string
  readonly stampText: string
  readonly stats: ReadonlyMap<string, PortStat | null>
  readonly listings: ReadonlyMap<string, readonly PortEntry[]>
  readonly memories: MemoryLinks
  readonly kickoff?: string
}

/** The steps of a render in order, the warnings to show, and why it was refused: a refused render has no step. */
export type RenderResult = {
  readonly steps: readonly RenderStep[]
  readonly warnings: readonly string[]
  readonly refusal: string | null
}

/** The folder of a role's files: `<root>/.cadre/<id>`. */
function roleFolder(root: string, id: string): string {
  return `${root}/.cadre/${id}`
}

/** The folder of a role's per-launch files: `<root>/.cadre/<id>/.runtime`, the folder its launcher reads. */
export function runtimeFolder(root: string, id: string): string {
  return `${roleFolder(root, id)}/.runtime`
}

/** The folder that holds a path: everything before its last slash. */
function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

/**
 * The folders from `.runtime` down to the folder that holds a path in it, from the top: `.runtime`,
 * `.runtime/overlay`, `.runtime/overlay/.claude` and `.runtime/overlay/.claude/skills` for a skill link.
 */
function foldersTo(runtime: string, path: string): string[] {
  const below = parentOf(path).slice(runtime.length).split('/').filter(part => part !== '')

  return [runtime, ...below.map((_, index) => [runtime, ...below.slice(0, index + 1)].join('/'))]
}

/**
 * The folders from `.runtime` down to each STALE_LINK_FOLDERS folder, that folder included, below `.runtime`:
 * `overlay`, `overlay/.claude`, `overlay/.claude/skills`, and so on (T-03-20).
 */
function staleLinkChain(runtime: string): string[] {
  return STALE_LINK_FOLDERS.flatMap(folder => {
    const parts = folder.split('/')

    return parts.map((_, index) => [runtime, ...parts.slice(0, index + 1)].join('/'))
  })
}

/**
 * Every folder a render makes, links into or removes stale links from, sorted and once each: `.runtime`, its overlay,
 * each folder from `.runtime` down to a STALE_LINK_FOLDERS folder, and each folder from `.runtime` down to a link.
 */
function renderFolders(runtime: string, links: readonly OverlayLink[]): string[] {
  const linkFolders = links.flatMap(link => foldersTo(runtime, link.path))

  return sortedUnique([runtime, `${runtime}/${OVERLAY_FOLDER}`, ...staleLinkChain(runtime), ...linkFolders])
}

/**
 * The paths /cadre start stats and lists before a render, so renderSteps can judge each one. `stats` holds, sorted
 * and once each, the role folder, `.runtime`, its overlay, every folder from `.runtime` down to a STALE_LINK_FOLDERS
 * folder or to a link, every link path, the five files a render writes and the DONE.md marker (#63 A6), and for an
 * epic render (`options.kickoff`) the epic kickoff `.runtime/kickoff.txt` too (D-158); `listings` holds `.runtime`,
 * whose listing shows a file a render writes that is a link whatever its stat says (#72 A2), then the
 * STALE_LINK_FOLDERS under it.
 */
export function renderPaths(
  root: string,
  id: string,
  plan: LaunchPlan,
  options: { readonly kickoff: boolean } = { kickoff: false },
): { readonly stats: readonly string[]; readonly listings: readonly string[] } {
  const runtime = runtimeFolder(root, id)
  const stats = sortedUnique([
    roleFolder(root, id),
    ...renderFolders(runtime, plan.links),
    ...plan.links.map(link => link.path),
    ...WRITTEN_FILES.map(name => `${runtime}/${name}`),
    ...(options.kickoff ? [`${runtime}/${RUNTIME_KICKOFF_FILE}`] : []),
    `${runtime}/${DONE_MARKER_FILE}`,
  ])

  return { stats, listings: [runtime, ...STALE_LINK_FOLDERS.map(folder => `${runtime}/${folder}`)] }
}

/** The stat of a path; null when it is not there or was not asked, as a path with no stat counts as not there. */
function statAt(input: RenderInput, path: string): PortStat | null {
  return input.stats.get(path) ?? null
}

/** Whether a stat shows a link, a dangling one included. */
function isLinkStat(stat: PortStat | null): boolean {
  return stat !== null && stat.isLink
}

/** Whether a stat shows a real entry, a file, a folder or any other kind that is not a link. */
function isRealEntry(stat: PortStat | null): boolean {
  return stat !== null && !stat.isLink
}

/** The refusal when the role folder is missing, a link, or not a real folder inside the repo. */
function roleFolderRefusal(id: string): string {
  const role = reportText(id)

  return `.cadre/${role} is not a folder inside this repo: run /cadre regen ${role}`
}

/** The refusal when `.runtime`, a folder in it, or a file a render writes is a link or not what the render needs. */
function runtimeRefusal(id: string): string {
  const role = reportText(id)
  const what = `.cadre/${role}/.runtime/ or a folder in it is a link or not a folder`

  return `${what}: remove it and run /cadre start ${role} again`
}

/**
 * The refusal when `.runtime` lists a file a render writes as a link that its stat did not show as one, such as a
 * dangling link the host's stat takes for no file (#72 A2): the write would go through it.
 */
function unstatedLinkRefusal(id: string, name: string): string {
  const role = reportText(id)
  const what = `.cadre/${role}/.runtime/${name} is a link /cadre start could not check`

  return `${what}: remove it and run /cadre start ${role} again`
}

/**
 * The refusal when .runtime/private-instructions is a real file or folder, not a link (02-GAPS-B2 N7): a
 * force-committed folder there would load as the role's private instructions.
 */
export function privateLinkRefusal(id: string): string {
  const role = reportText(id)
  const what = `.cadre/${role}/.runtime/${PRIVATE_INSTRUCTIONS_LINK} is a real file or folder, not a link`

  return `${what}: remove it and run /cadre start ${role} again`
}

/** Whether `.runtime` lists a file a render writes as a link while the stat of that file shows no link (#72 A2). */
function isUnstatedLink(input: RenderInput, runtime: string, name: string): boolean {
  const entries = input.listings.get(runtime) ?? []
  if (!entries.some(entry => entry.name === name && entry.isLink)) return false

  return !isLinkStat(statAt(input, `${runtime}/${name}`))
}

/** Whether a folder a render makes or links into is unsafe: it is there, and a link or not a folder. */
function isUnsafeFolder(stat: PortStat | null): boolean {
  return stat !== null && (stat.isLink || stat.kind !== 'dir')
}

/** Whether a file a render writes is unsafe: it is there, not a link (a link is removed first) and not a file. */
function isUnsafeFile(stat: PortStat | null): boolean {
  return stat !== null && !stat.isLink && stat.kind !== 'file'
}

/**
 * Why a render must not run, or null (T-03-20). The role folder must be a real folder inside the repo; `.runtime`,
 * its overlay, every folder down to a STALE_LINK_FOLDERS folder and every folder down to a link must be missing or a
 * real folder; and each file a render writes must be missing, a regular file, or a link, which is removed first.
 * Anything else would let a step write, link or remove through a link, or write onto a folder. A file a render writes
 * that the listing of `.runtime` shows as a link while its stat does not refuses too (unstatedLinkRefusal, #72 A2),
 * so no write rests on what the host's stat makes of a dangling link; a `.runtime` with no listing is taken as empty,
 * as every folder with none is. A real file or folder at `.runtime/private-instructions` refuses last
 * (privateLinkRefusal, 02-GAPS-B2 N7): the launcher adds that path, so it is never kept.
 */
function refusalOf(input: RenderInput, runtime: string): string | null {
  const role = statAt(input, roleFolder(input.root, input.id))
  if (role === null || role.isLink || !isDirInsideRoot(role, input.root)) return roleFolderRefusal(input.id)
  const folders = renderFolders(runtime, input.plan.links).map(path => statAt(input, path))
  const files = writtenFiles(input).map(name => statAt(input, `${runtime}/${name}`))
  if (folders.some(isUnsafeFolder) || files.some(isUnsafeFile)) return runtimeRefusal(input.id)
  const unstated = writtenFiles(input).find(name => isUnstatedLink(input, runtime, name))
  if (unstated !== undefined) return unstatedLinkRefusal(input.id, unstated)
  if (isRealEntry(statAt(input, `${runtime}/${PRIVATE_INSTRUCTIONS_LINK}`))) return privateLinkRefusal(input.id)

  return null
}

/** Whether a listed name is one plain entry of its folder: not empty, not `.` or `..`, and with no slash. */
function isPlainName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !name.includes('/')
}

/**
 * The links an earlier render left in the STALE_LINK_FOLDERS that the plan no longer names, sorted: each listed entry
 * there that is a link with a plain name. A real file or folder there is never removed, and a link path the plan
 * names is left to the planned-link removal.
 */
function staleLinks(input: RenderInput, runtime: string): string[] {
  const planned = new Set(input.plan.links.map(link => link.path))
  const stale: string[] = []
  for (const folder of STALE_LINK_FOLDERS) {
    const folderPath = `${runtime}/${folder}`
    for (const entry of input.listings.get(folderPath) ?? []) {
      const path = `${folderPath}/${entry.name}`
      if (entry.isLink && isPlainName(entry.name) && !planned.has(path)) stale.push(path)
    }
  }

  return sortedUnique(stale)
}

/**
 * The links a render removes before it makes anything (Pitfall 2), in order: those an earlier render left that the
 * plan no longer names (staleLinks), then each planned link path that is a link, then each file the render writes,
 * but the stamp, that is a link. Only links: a real file or folder is never removed here.
 */
function linkRemovals(input: RenderInput, runtime: string): string[] {
  const linkPaths = input.plan.links.map(link => link.path)
  const files = writtenFiles(input).filter(name => name !== RUNTIME_STAMP_FILE).map(name => `${runtime}/${name}`)
  const links = [...linkPaths, ...files].filter(path => isLinkStat(statAt(input, path)))

  return [...staleLinks(input, runtime), ...links]
}

/** The path below the repo root, as a warning shows it; a path outside the root is shown whole. */
function repoRelative(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

/** The warning for a planned link path that holds a real file or folder, which a render keeps (Pitfall 2). */
function notReplacedWarning(root: string, path: string): string {
  return `${reportText(repoRelative(root, path))} is a real file or folder, not a link: not replaced`
}

/** A step that removes a path. */
function removeStep(path: string): RenderStep {
  return { kind: 'remove', path }
}

/** A step that makes a folder. */
function mkdirStep(path: string): RenderStep {
  return { kind: 'mkdir', path }
}

/** A step that makes a link. */
function linkStep(link: OverlayLink): RenderStep {
  return { kind: 'link', path: link.path, target: link.target }
}

/** A step that writes a text to a path. */
function writeStep(path: string, text: string): RenderStep {
  return { kind: 'write', path, text }
}

/** The folders a render makes, sorted and once each: `.runtime`, its overlay (always, D-102) and each link's folder. */
function mkdirFolders(runtime: string, links: readonly OverlayLink[]): string[] {
  return sortedUnique([runtime, `${runtime}/${OVERLAY_FOLDER}`, ...links.map(link => parentOf(link.path))])
}

/**
 * The making of the folder the plan's private instructions link points at (D-140 q1-b): when the plan links
 * `.runtime/private-instructions`, one mkdir, so the folder the launcher adds there is always there, empty when the
 * role has no private part, then one chmod 700 per level of its role memory folder from the top (roleFolderLevels,
 * 02-GAPS-B3 S7), as apply makes them private; none when the plan has no such link. Its target comes from the role
 * memory folder, never from disk. The link itself is never kept with a warning: a real file or folder there refuses the
 * render (privateLinkRefusal, 02-GAPS-B2 N7).
 */
function privateFolderSteps(input: RenderInput, runtime: string): RenderStep[] {
  const link = input.plan.links.find(candidate => candidate.path === `${runtime}/${PRIVATE_INSTRUCTIONS_LINK}`)
  if (link === undefined) return []
  const chmods = roleFolderLevels(parentOf(link.target)).map((path): RenderStep => ({ kind: 'chmod', path }))

  return [mkdirStep(link.target), ...chmods]
}

/**
 * The writes before the stamp, in order: the settings as stable JSON, the MCP config, the probe expectations, an
 * empty inbox only when there is none, so a note another role left there is never lost (D-114, Pitfall 3), and for an
 * epic render the epic kickoff (D-158), the step right before the stamp. An inbox that is a link is removed first
 * (linkRemovals), so it counts as none.
 */
function fileWrites(input: RenderInput, runtime: string): RenderStep[] {
  const inbox = `${runtime}/${INBOX_FILE}`
  const writes = [
    writeStep(`${runtime}/${SETTINGS_FILE}`, stableJson(input.plan.settings)),
    writeStep(`${runtime}/${MCP_FILE}`, input.mcpText),
    writeStep(`${runtime}/${PROBE_EXPECTATIONS_FILE}`, input.expectationsText),
    ...(isRealEntry(statAt(input, inbox)) ? [] : [writeStep(inbox, '')]),
  ]
  if (input.kickoff === undefined) return writes

  return [...writes, writeStep(`${runtime}/${RUNTIME_KICKOFF_FILE}`, input.kickoff)]
}

/**
 * The steps in a parts-flow role's memory folder (G-02-1f, D-140 q3-a): first the removal of each link an earlier start
 * made there that this one does not make, then each memory link, then the write of MEMORY.md when its block changes.
 * Only links are made or removed, and no other file of the folder is touched.
 */
function memorySteps(memories: MemoryLinks): RenderStep[] {
  return [
    ...memories.removals.map(removeStep),
    ...memories.links.map(linkStep),
    ...(memories.index === null ? [] : [writeStep(memories.index.path, memories.index.text)]),
  ]
}

/**
 * The removal of the DONE.md marker an earlier run left in `.runtime` (D-17, #63 A6), so each start begins a run with
 * no marker and /cadre status never shows an old one: one step when it is a file or a link, a dangling one included,
 * since `rm -f` removes a link and not what it points at; none when it is not there, and none for a folder or any
 * other kind, which `rm -f` without `-r` would fail on and status does not count as the marker.
 */
function doneMarkerRemovals(input: RenderInput, runtime: string): RenderStep[] {
  const path = `${runtime}/${DONE_MARKER_FILE}`
  const stat = statAt(input, path)
  if (stat === null) return []
  if (!stat.isLink && stat.kind !== 'file') return []

  return [removeStep(path)]
}

/**
 * The steps that render a role's `.runtime` (D-102), in order. An existing stamp is removed first, so a render that
 * stops part way never leaves the old stamp beside new files; then the DONE.md an earlier run left
 * (doneMarkerRemovals). Then the links of linkRemovals are removed, an earlier private instructions link included;
 * then `.runtime`, its overlay and each link's folder are made, sorted and once each, and the folder the private
 * instructions link points at, with each level of its role memory folder made mode 700 (privateFolderSteps, D-140
 * q1-b, 02-GAPS-B3 S7); then each link is made, except at a path that holds a real file or folder, which is kept and
 * named in a warning (Pitfall 2: `ln -sfn` would link inside a folder or replace a file); then the steps in the role
 * memory folder (memorySteps, G-02-1f); then the files of fileWrites are written, and the stamp last. A render that
 * stops at any step before the last leaves no stamp, so the launcher refuses to start (LNCH-03). A render that
 * refusalOf refuses has no step at all; a real file or folder at the private instructions link is such a refusal,
 * never a kept path with a warning (02-GAPS-B2 N7).
 */
export function renderSteps(input: RenderInput): RenderResult {
  const runtime = runtimeFolder(input.root, input.id)
  const refusal = refusalOf(input, runtime)
  if (refusal !== null) return { steps: [], warnings: [], refusal }
  const stamp = `${runtime}/${RUNTIME_STAMP_FILE}`
  const kept = input.plan.links.filter(link => isRealEntry(statAt(input, link.path)))
  const links = input.plan.links.filter(link => !isRealEntry(statAt(input, link.path)))
  const steps: RenderStep[] = [
    ...(statAt(input, stamp) === null ? [] : [removeStep(stamp)]),
    ...doneMarkerRemovals(input, runtime),
    ...linkRemovals(input, runtime).map(removeStep),
    ...mkdirFolders(runtime, input.plan.links).map(mkdirStep),
    ...privateFolderSteps(input, runtime),
    ...links.map(linkStep),
    ...memorySteps(input.memories),
    ...fileWrites(input, runtime),
    writeStep(stamp, input.stampText),
  ]

  return { steps, warnings: kept.map(link => notReplacedWarning(input.root, link.path)), refusal: null }
}

/**
 * The argv that runs a step, absolute and with no shell (RESEARCH 3.2): `/bin/rm -f --` for a removal, never `-r`;
 * `/bin/mkdir -p --` for a folder; `/bin/chmod 700` for a private folder level (privateModeArgv, 02-GAPS-B3 S7);
 * `/bin/ln -sfn <target> <path>` for a link. A write has none: the host writes it.
 */
export function renderArgv(step: RenderStep): readonly string[] | null {
  if (step.kind === 'remove') return ['/bin/rm', '-f', '--', step.path]
  if (step.kind === 'mkdir') return ['/bin/mkdir', '-p', '--', step.path]
  if (step.kind === 'chmod') return privateModeArgv(step.path)
  if (step.kind === 'link') return ['/bin/ln', '-sfn', step.target, step.path]

  return null
}

/** The text of the stamp a render writes last: the cadre version that rendered, on one line. */
export function stampText(cadreVersion: string): string {
  return `rendered by cadre ${cadreVersion}\n`
}

/** The argv that asks git for the repo's common dir as an absolute path; it runs at the repo root (D-98, D-91). */
export const GIT_COMMON_DIR_ARGV: readonly string[] = Object.freeze([
  'git',
  'rev-parse',
  '--path-format=absolute',
  '--git-common-dir',
])

/** How long the git run may take before it is given up. */
const GIT_TIMEOUT_MS = 10_000

/** The refusal when there is no HOME: the role files are rendered from the user's own folder (D-98). */
export const START_NO_HOME = 'cadre start needs HOME to render the role files, so it stopped.'

/**
 * The refusal when git gives no common dir, which names the role memory folders (D-91): the run failed, or it gave no
 * absolute path, as a git older than 2.31 does with `--path-format=absolute` (#72 A4).
 */
export const START_NO_GIT_DIR =
  'cadre start could not read the git common dir (git rev-parse failed or gave no absolute path; ' +
  'git 2.31 or newer is needed), so it stopped.'

/** The /cadre start refusal for a role memory folder level it would write through (02-GAPS-B3 C5). */
export function privateFolderRefusal(path: string, reason: 'link' | 'not-folder' | 'unchecked'): string {
  const stopped = `cadre start stopped: ${path}`
  const end = 'cadre does not write through it'
  if (reason === 'link') return `${stopped} is a link; ${end}`
  if (reason === 'not-folder') return `${stopped} is not a folder; ${end}`

  return `${stopped} could not be checked for links; ${end}`
}

/**
 * What gatherLaunchUser gives: the launching user's facts with the warnings to show and what to do in the role memory
 * folder (MemoryLinks, G-02-1f), or the exact refusal.
 */
export type LaunchUserRead =
  | {
      readonly kind: 'ok'
      readonly user: LaunchUser
      readonly warnings: readonly string[]
      readonly memories: MemoryLinks
    }
  | { readonly kind: 'refuse'; readonly text: string }

/** The file names the host is asked for in each folder from the file system root down to the repo (D-57). */
const CLAUDE_MD_FILES: readonly string[] = Object.freeze(['CLAUDE.md', '.claude/CLAUDE.md'])

/** How many import hops from the global CLAUDE.md are followed (D-63). */
const MAX_IMPORT_DEPTH = 5

/** The most files the global CLAUDE.md and its imports give a role. */
const MAX_GLOBAL_FILES = 20

/** The settings sources whose hooks a git-root start renders: it loads the project settings by itself (D-103). */
const ROOT_HOOK_SOURCES: readonly SettingsSource[] = Object.freeze(['user', 'local'])

/** One hook of the user's settings as a launch carries it. */
type LaunchHook = LaunchUser['hooks'][number]

/** The compact window when it is a positive safe integer, else null, as the setup scan keeps it (D-60). */
function compactWindowOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * The values a role may carry from the user settings (D-60, D-84): `autoCompactWindow` when it is a positive safe
 * integer, the `statusLine` object as read, and each `env` entry whose value is a string; null, null and {} for a value
 * that is missing or not of that kind, and for anything but a plain object. Only what a role carries is rendered
 * (launchPlan), into runtime files, never into a reply.
 */
export function launchSettingsOf(user: unknown): Pick<LaunchUser, 'autoCompactWindow' | 'statusLine' | 'env'> {
  if (!isObject(user)) return { autoCompactWindow: null, statusLine: null, env: {} }
  const env = isObject(user.env) ? Object.entries(user.env) : []

  return {
    autoCompactWindow: compactWindowOf(user.autoCompactWindow),
    statusLine: isObject(user.statusLine) ? user.statusLine : null,
    env: Object.fromEntries(env.filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  }
}

/** A hook timeout in seconds when it is a positive finite number, else null. */
function timeoutOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** One hook of a settings group as a launch carries it; null when it is not a command hook with a script basename. */
function launchHookOf(event: string, matcher: string | null, hook: unknown): LaunchHook | null {
  if (!isObject(hook) || hook.type !== 'command' || typeof hook.command !== 'string') return null
  const script = hookScriptOf(hook.command)
  if (script === null) return null

  return { event, script, command: hook.command, matcher, timeout: timeoutOf(hook.timeout) }
}

/** The command hooks of one settings group, with the group's matcher; none when the group is not of that shape. */
function groupHooks(event: string, group: unknown): LaunchHook[] {
  if (!isObject(group) || !Array.isArray(group.hooks)) return []
  const matcher = typeof group.matcher === 'string' ? group.matcher : null

  return group.hooks.flatMap(hook => launchHookOf(event, matcher, hook) ?? [])
}

/**
 * The command hooks under `hooks` of one settings value, as a launch carries them (D-62, D-103): for each event, each
 * group and each hook of type `command`, in the order the settings give them, the event, the script basename
 * (hookScriptOf), the whole command, the group's matcher (null when it has none) and the timeout when it is a positive
 * finite number (else null). A hook with no script basename a role can carry is dropped, and so is anything not of that
 * shape. The whole command is only ever written to runtime files, never to a reply or a warning.
 */
export function launchHooksOf(value: unknown): LaunchUser['hooks'] {
  if (!isObject(value) || !isObject(value.hooks)) return []

  return Object.entries(value.hooks).flatMap(([event, groups]) =>
    Array.isArray(groups) ? groups.flatMap(group => groupHooks(event, group)) : [],
  )
}

/**
 * The settings sources whose hooks a launch renders into the runtime settings (D-103): the user and local settings
 * always, as `--setting-sources project` loads neither, and the project settings only for a `here` or `dir` start,
 * which loads the project settings of its own folder and not those of the git root (D-122). A git-root start loads
 * them by itself, so rendering them too would register each project hook twice (RESEARCH Pitfall 9).
 */
export function hookSourcesFor(start: LaunchStart): readonly SettingsSource[] {
  return start.kind === 'git-root' ? ROOT_HOOK_SOURCES : SOURCE_ORDER
}

/** Whether a path's stat, asked with resolve, shows a regular file. */
async function isFile(io: InitIo, path: string): Promise<boolean> {
  return (await io.stat(path))?.kind === 'file'
}

/** The files a CLAUDE.md imports (claudeMdImports); none when it cannot be read or is over MAX_READ_BYTES. */
async function importsOf(io: InitIo, path: string, home: string): Promise<string[]> {
  const read = await io.read(path, MAX_READ_BYTES)
  if (read.state !== 'text') return []

  return claudeMdImports(read.text, parentOf(path), home)
}

/**
 * The global CLAUDE.md and the files it imports (D-63, D-100): `<userDir>/CLAUDE.md` first, then its imports breadth
 * first through claudeMdImports, each file once, at most MAX_IMPORT_DEPTH hops from the global file and
 * MAX_GLOBAL_FILES files in all. Only a path whose stat is a regular file is kept, and a file that cannot be read is
 * kept with no imports. Empty when there is no global file.
 */
async function globalClaudeMdOf(io: InitIo, userDir: string, home: string): Promise<string[]> {
  const found: string[] = []
  const seen = new Set<string>()
  let level = [`${userDir}/CLAUDE.md`]
  for (let depth = 0; depth <= MAX_IMPORT_DEPTH && level.length > 0; depth += 1) {
    const next: string[] = []
    for (const path of level) {
      if (seen.has(path) || found.length === MAX_GLOBAL_FILES) continue
      seen.add(path)
      if (!(await isFile(io, path))) continue
      found.push(path)
      if (depth < MAX_IMPORT_DEPTH) next.push(...(await importsOf(io, path, home)))
    }
    level = next
  }

  return found
}

/** The names of the regular `.md` files in a folder, sorted; a link, a folder or a listing that fails gives none. */
async function markdownFiles(io: InitIo, folder: string): Promise<string[]> {
  const entries = (await io.list(folder)) ?? []

  return sortedUnique(markdownFileNames(entries))
}

/** The `.md` file names of the auto-memory folder the engine keeps for a project root in the user folder (D-100). */
async function memoryFilesOf(io: InitIo, userDir: string, root: string): Promise<string[]> {
  return markdownFiles(io, memoryFolderOf(userDir, root))
}

/** The user's skills: the folders and links in `<userDir>/skills`, sorted; a listing that fails gives none. */
async function userSkillsOf(io: InitIo, userDir: string): Promise<string[]> {
  const entries = (await io.list(`${userDir}/skills`)) ?? []

  return sortedUnique(entries.filter(entry => entry.kind === 'dir' || entry.isLink).map(entry => entry.name))
}

/** The user's agents: the regular `.md` files in `<userDir>/agents`, by name without `.md`, sorted. */
async function userAgentsOf(io: InitIo, userDir: string): Promise<string[]> {
  const names = await markdownFiles(io, `${userDir}/agents`)

  return sortedUnique(names.map(name => name.slice(0, -MARKDOWN_EXTENSION.length)))
}

/** Whether a listed entry is a file or a link: a linked file loads like one, so it is counted too (fails closed). */
function isFileOrLink(entry: PortEntry): boolean {
  return entry.kind === 'file' || entry.isLink
}

/**
 * The rule files the engine loads for the root (G-02-1f, T-02-70): `<root>/.claude/rules/<path>` for each `*.md` file
 * or link of that folder, its sub-folders walked too (ruleFiles, 02-GAPS-B2 M4: at most 5 levels and 500 entries; links
 * taken, as files or folders, and any folder with a stat listed), absolute and sorted. A walk that fails counts as
 * empty, and a sub-folder that cannot be listed as empty, as before.
 */
async function rulesOf(io: InitIo, root: string): Promise<string[]> {
  const rules = await ruleFiles(io, root, { isTakenLink: true, isFolderUsable: stat => stat !== null })

  return (rules ?? []).map(name => `${root}/${RULES_FOLDER}/${name}`)
}

/** The file name of a role's built instructions in its folder (G-02-1f). */
const ROLE_CLAUDE_MD = 'CLAUDE.md'

/**
 * The built role files of the repo (G-02-1f, T-02-70): `<root>/.cadre/<name>/CLAUDE.md` for each folder or link that
 * `<root>/.cadre` lists with a plain name whose own listing holds a `CLAUDE.md` file or link, the folders of roles no
 * longer on the team included, so excluding them fails closed; absolute and sorted. A listing that fails counts as
 * empty.
 */
async function roleClaudeMdsOf(io: InitIo, root: string): Promise<string[]> {
  const cadre = `${root}/.cadre`
  const listed = (await io.list(cadre)) ?? []
  const folders = listed.filter(item => (item.kind === 'dir' || item.isLink) && isPlainName(item.name))
  const found: string[] = []
  for (const folder of folders) {
    const entries = (await io.list(`${cadre}/${folder.name}`)) ?? []
    if (!entries.some(item => item.name === ROLE_CLAUDE_MD && isFileOrLink(item))) continue
    found.push(`${cadre}/${folder.name}/${ROLE_CLAUDE_MD}`)
  }

  return sortedUnique(found)
}

/**
 * The git common dir of the repo with its SHA-256, which name the role memory folders (roleMemoryDir, D-20, D-91):
 * GIT_COMMON_DIR_ARGV run at the repo root gives it, its output without the final line break, which must start with
 * `/`; it is then the realpath of its stat when the host resolves it, else as git gave it. Null when the host rejects
 * the run, it exits non-zero or its output is not an absolute path. /cadre start and apply both look the folders up
 * through it (G-02-1f, D-140 q2-a), so they always name the same ones.
 */
export async function gitCommonDirOf(
  io: InitIo,
  host: HostIo,
  root: string,
): Promise<Pick<LaunchUser, 'gitCommonDir' | 'commonDirHash'> | null> {
  const run = await host.run(GIT_COMMON_DIR_ARGV, { cwd: root, timeoutMs: GIT_TIMEOUT_MS })
  if (run === null || run.exitCode !== 0) return null
  if (!run.stdout.startsWith('/')) return null
  const given = run.stdout.endsWith('\n') ? run.stdout.slice(0, -1) : run.stdout
  const gitCommonDir = (await io.stat(given))?.realPath ?? given

  return { gitCommonDir, commonDirHash: await sha256Hex(gitCommonDir) }
}

/**
 * The main checkout of a linked worktree nested in it (D-20, D-157, 03.1-W3 M1): the folder of the git common dir when
 * it is `<main>/.git` and the root lies below `<main>/`, as `.claude/worktrees/<slug>` does; null for the main
 * checkout, a common dir elsewhere, or a submodule's.
 */
export function mainCheckoutOf(gitCommonDir: string, root: string): string | null {
  if (!gitCommonDir.endsWith('/.git')) return null
  const main = gitCommonDir.slice(0, -'/.git'.length)

  return root.startsWith(`${main}/`) ? main : null
}

/** The begin marker of cadre's block in a role's MEMORY.md (D-140 q3-a); an on-disk contract, as IGNORE_BEGIN is. */
export const MEMORY_BLOCK_BEGIN = '<!-- >>> cadre linked memories (read-only; rebuilt by /cadre start) -->'

/** The end marker of cadre's block in a role's MEMORY.md (D-140 q3-a); an on-disk contract like MEMORY_BLOCK_BEGIN. */
export const MEMORY_BLOCK_END = '<!-- <<< cadre linked memories -->'

/** The lines of a text, each with its own line ending, so joining them gives the text back byte for byte. */
function linesWithEnds(text: string): string[] {
  return text.split(/(?<=\n)/)
}

/** A line without its line ending, `\n` or `\r\n`, so a MEMORY.md with Windows line endings reads the same. */
function withoutLineEnd(line: string): string {
  return line.replace(/\r?\n$/, '')
}

/**
 * Where cadre's block sits in the lines of a MEMORY.md: the index of the first begin marker line and of the first end
 * marker line after it, -1 for a marker that is not there, so a begin marker with no end marker is { begin >= 0, end:
 * -1 }. A marker is a whole line.
 */
function memoryBlockMarkers(lines: readonly string[]): { readonly begin: number; readonly end: number } {
  const begin = lines.findIndex(line => withoutLineEnd(line) === MEMORY_BLOCK_BEGIN)
  if (begin === -1) return { begin, end: -1 }
  const end = lines.findIndex((line, index) => index > begin && withoutLineEnd(line) === MEMORY_BLOCK_END)

  return { begin, end }
}

/**
 * The line of one linked memory in cadre's block (D-140 q3-a): `- [<file>](<file>) \u2014 <summary>`, its file name
 * and summary cleaned and capped as report cells are, so a summary read from disk cannot add a line.
 */
function memoryBlockLine(entry: Pick<MemoryItem, 'file' | 'summary'>): string {
  const file = reportText(entry.file)

  return `- [${file}](${file}) \u2014 ${reportText(entry.summary)}`
}

/**
 * A role's MEMORY.md text with cadre's block set to these linked memories (D-140 q3-a), as mergeIgnoreBlock sets the
 * cadre block of the root `.gitignore`: MEMORY_BLOCK_BEGIN, one memoryBlockLine per memory in the order given, and
 * MEMORY_BLOCK_END, each line ending in `\n`. The block from the first begin marker to the first end marker after it is
 * replaced, or appended when there is none, and a missing file gives the block alone; no line outside the block
 * changes, byte for byte, and a marker that ends in a carriage return is still found. A begin marker with no end
 * marker after it is a block cadre cannot tell the extent of, so the result is null and nothing is written.
 */
export function memoryBlockText(
  existing: string | null,
  entries: readonly Pick<MemoryItem, 'file' | 'summary'>[],
): string | null {
  const block = [MEMORY_BLOCK_BEGIN, ...entries.map(memoryBlockLine), MEMORY_BLOCK_END].map(line => `${line}\n`)
  if (existing === null) return block.join('')
  const lines = linesWithEnds(existing)
  const { begin, end } = memoryBlockMarkers(lines)
  if (begin === -1) return `${existing}${existing === '' || existing.endsWith('\n') ? '' : '\n'}${block.join('')}`
  if (end === -1) return null

  return `${lines.slice(0, begin).join('')}${block.join('')}${lines.slice(end + 1).join('')}`
}

/** A line of cadre's block, with the file its link names in its first group. */
const MEMORY_BLOCK_ENTRY = /^- \[[^\]\n]*\]\(([^)\n]+)\)/

/**
 * The file names cadre's block of a MEMORY.md text lists, in its order: the link target of each of its lines; none when
 * the text has no block, or one with no end marker.
 */
function memoryBlockFiles(text: string): string[] {
  const lines = linesWithEnds(text)
  const { begin, end } = memoryBlockMarkers(lines)
  if (begin === -1 || end === -1) return []

  return lines.slice(begin + 1, end).flatMap(line => {
    const file = MEMORY_BLOCK_ENTRY.exec(withoutLineEnd(line))?.[1]

    return file === undefined ? [] : [file]
  })
}

/** The warning for a memory that changed since init (G-02-1f): it is linked as it is now. Names are shown cleaned. */
export function memoryChangedWarning(file: string, id: string): string {
  const role = reportText(id)

  return `memory ${shown(file)} changed since init: linked as it is now; run /cadre regen ${role} to hand it out again`
}

/** The warning for a memory whose original is no longer in the memory folder of the repo (G-02-1f): not linked. */
export function memoryGoneWarning(file: string): string {
  return `memory ${shown(file)} is gone: not linked`
}

/** The warning for a MEMORY.md whose cadre block has no end marker (D-140 q3-a): nothing is written to it. */
export function openMemoryBlockWarning(id: string): string {
  return `the MEMORY.md block of ${reportText(id)} has no end marker: fix it by hand; linked memories are not indexed`
}

/**
 * The warning for a hand-out record that is there but cannot be read, or is not a valid record (G-02-1f): no memory
 * of the role is linked, and every link the MEMORY.md block listed is removed.
 */
export function unreadableRecordWarning(id: string): string {
  return (
    `could not read the hand-out record of ${reportText(id)} (${INSTRUCTIONS_RECORD_FILE}): no memory is linked; ` +
    'run /cadre init to hand the memories out again'
  )
}

/** The warning for a role's MEMORY.md that is there but cannot be read (D-140 q3-a): nothing is written to it. */
export function unreadableMemoryIndexWarning(id: string): string {
  return `could not read the ${MEMORY_INDEX_FILE} of ${reportText(id)}: linked memories are not indexed`
}

/**
 * The warning for a role's MEMORY.md that is a link (T-02-74): it is never read or written through, so a link put
 * there cannot make /cadre start write the block into the file it points at.
 */
export function memoryIndexLinkWarning(id: string): string {
  return `the ${MEMORY_INDEX_FILE} of ${reportText(id)} is a link: linked memories are not indexed`
}

/**
 * Whether a recorded memory may be linked by its name: a plain file name (isSafeFileName) that ends in `.md`, is not
 * MEMORY.md in any letter case, which is the role's own index (isMemoryIndexName, 02-GAPS-B3 N2), and holds no `(` or
 * `)`, as the MEMORY.md block line could not be parsed back (02-GAPS-B3 N8).
 */
function isLinkableMemory(file: string): boolean {
  if (!isSafeFileName(file) || !file.endsWith(MARKDOWN_EXTENSION)) return false
  if (file.includes('(') || file.includes(')')) return false

  return !isMemoryIndexName(file)
}

/** What /cadre start does with one recorded memory: its link, or none, and the warning to show, or none. */
type MemoryLinkOutcome = {
  readonly link: OverlayLink | null
  readonly warning: string | null
}

/**
 * What /cadre start does with one memory of a role's hand-out record (G-02-1f, D-140 q3-a). It is not linked when its
 * name may not be a link name (isLinkableMemory, unsafeMemoryNameWarning); when its folder is not a memory folder of
 * this repo, of the root as resolved or as given, or of the main checkout (`mainRoot`, 03.1-W3 M1), or its original
 * cannot be read as a file (memoryGoneWarning); or when a real file or folder holds its link path in the role memory
 * folder, which is never replaced (notReplacedWarning). Else it is linked, `<role memory folder>/<file>` to `<its
 * folder>/<file>`, never copied, with memoryChangedWarning when its original's text is over MAX_READ_BYTES or no longer
 * has the hash of the record. The original is read for its hash alone.
 */
async function memoryLinkOf(
  io: InitIo,
  user: LaunchUser,
  input: { readonly folder: string; readonly id: string; readonly memory: RecordedMemory },
): Promise<MemoryLinkOutcome> {
  const { folder, id, memory } = input
  if (!isLinkableMemory(memory.file)) return { link: null, warning: unsafeMemoryNameWarning(memory.file) }
  const roots = [user.root, user.givenRoot, ...(user.mainRoot === undefined ? [] : [user.mainRoot])]
  const repoFolders = roots.map(root => memoryFolderOf(user.userDir, root))
  if (!repoFolders.includes(memory.folder)) return { link: null, warning: memoryGoneWarning(memory.file) }
  const path = `${folder}/${memory.file}`
  if (isRealEntry(await io.stat(path))) {
    return { link: null, warning: notReplacedWarning(user.root, displayPath(path, user.home, user.root)) }
  }
  const target = `${memory.folder}/${memory.file}`
  const original = await io.read(target, MAX_READ_BYTES)
  if (original.state === 'absent' || original.state === 'unknown') {
    return { link: null, warning: memoryGoneWarning(memory.file) }
  }
  const isSame = original.state === 'text' && (await sha256Hex(original.text)) === memory.hash

  return { link: { path, target }, warning: isSame ? null : memoryChangedWarning(memory.file, id) }
}

/**
 * The links an earlier start made in the role memory folder that this one does not make (D-140 q3-a): each name the
 * old MEMORY.md block listed, a plain name that is not linked now, that the folder lists as a link. A real file or
 * folder is never among them, and with no listing there are none.
 */
async function staleMemoryLinks(
  io: InitIo,
  folder: string,
  listed: readonly string[],
  linked: ReadonlySet<string>,
): Promise<string[]> {
  const names = listed.filter(name => isPlainName(name) && !linked.has(name))
  if (names.length === 0) return []
  const entries = (await io.list(folder)) ?? []
  const links = new Set(entries.filter(entry => entry.isLink).map(entry => entry.name))

  return sortedUnique(names.filter(name => links.has(name)).map(name => `${folder}/${name}`))
}

/**
 * The read of the role's hand-out record: the memories it names, none when it is not there, null when it cannot be
 * read or is not a record regen would take (parseInstructionsRecord, 02-GAPS-B3 S6: one parser).
 */
async function recordOf(io: InitIo, folder: string): Promise<readonly RecordedMemory[] | null> {
  const read = await io.read(instructionsRecordPath(folder), MAX_READ_BYTES)
  if (read.state === 'absent') return []
  if (read.state !== 'text') return null

  return parseInstructionsRecord(read.text)?.memories ?? null
}

/**
 * The memory links of a parts-flow role (G-02-1f, D-140 q3-a) and the warnings to show. Its hand-out record
 * `<role memory folder>/instructions.json` is read (recordOf): not there names no memory, while one that cannot be read
 * or is not valid names none and warns (unreadableRecordWarning). Each memory it names is linked or not (memoryLinkOf).
 * The role's MEMORY.md is then read: when it is not there, or there with a block both markers end, cadre's block is set
 * to the linked memories in record order (memoryBlockText) and written when its text changes, but never added to a
 * MEMORY.md with no block, or made, for no linked memory; each link the old block listed that is not linked now is
 * removed (staleMemoryLinks). A MEMORY.md that is a link is never read or written through (T-02-74), and one that
 * cannot be read, or whose block has no end marker, is left as it is too; then nothing is removed, with a warning
 * (memoryIndexLinkWarning, unreadableMemoryIndexWarning, openMemoryBlockWarning). No other file of the folder is
 * touched, and nothing is ever copied.
 */
async function linkedMemoriesOf(
  io: InitIo,
  user: LaunchUser,
  id: string,
): Promise<{ readonly memories: MemoryLinks; readonly warnings: readonly string[] }> {
  const folder = roleMemoryDir(user, id)
  const recorded = await recordOf(io, folder)
  const outcomes: { readonly memory: RecordedMemory; readonly outcome: MemoryLinkOutcome }[] = []
  for (const memory of recorded ?? []) {
    outcomes.push({ memory, outcome: await memoryLinkOf(io, user, { folder, id, memory }) })
  }
  const linked = outcomes.filter(item => item.outcome.link !== null)
  const links = linked.flatMap(item => item.outcome.link ?? [])
  const warnings = [
    ...(recorded === null ? [unreadableRecordWarning(id)] : []),
    ...outcomes.flatMap(item => item.outcome.warning ?? []),
  ]
  const indexPath = `${folder}/${MEMORY_INDEX_FILE}`
  if ((await io.stat(indexPath))?.isLink === true) {
    return { memories: { links, removals: [], index: null }, warnings: [...warnings, memoryIndexLinkWarning(id)] }
  }
  const indexRead = await io.read(indexPath, MAX_READ_BYTES)
  if (indexRead.state !== 'absent' && indexRead.state !== 'text') {
    return { memories: { links, removals: [], index: null }, warnings: [...warnings, unreadableMemoryIndexWarning(id)] }
  }
  const existing = indexRead.state === 'text' ? indexRead.text : null
  const text = memoryBlockText(existing, linked.map(item => item.memory))
  if (text === null) {
    return { memories: { links, removals: [], index: null }, warnings: [...warnings, openMemoryBlockWarning(id)] }
  }
  const listed = existing === null ? [] : memoryBlockFiles(existing)
  const hasBlock = existing !== null && memoryBlockMarkers(linesWithEnds(existing)).begin !== -1
  const isUnchanged = text === existing || (!hasBlock && links.length === 0)
  const removals = await staleMemoryLinks(io, folder, listed, new Set(linked.map(item => item.memory.file)))

  return { memories: { links, removals, index: isUnchanged ? null : { path: indexPath, text } }, warnings }
}

/**
 * The launching user's facts (D-98), gathered in the root session through the ports:
 * - the repo root as resolved and as given, the home folder, and the user folder (CLAUDE_CONFIG_DIR, else
 *   `<home>/.claude`);
 * - the git common dir from GIT_COMMON_DIR_ARGV run at the root, as the realpath of its stat when the host resolves
 *   it, else as git gave it, with its SHA-256 (gitCommonDirOf): they name the role memory folders (roleMemoryDir,
 *   D-20, D-91); and, for a root that lies below the main checkout of its git common dir (mainCheckoutOf), that
 *   checkout as `mainRoot`, set before the memories are linked, so a linked worktree links and denies main's memory
 *   folder and gets main's code-dir denies (03.1-W3 M1, S1);
 * - the carried values of the user settings (launchSettingsOf) and the hooks of each source hookSourcesFor names for
 *   the launch start (launchHooksOf, D-103);
 * - the CLAUDE.md chain the host's ancestors list gives (claudeMdPathsOf), the rule files of `.claude/rules` (rulesOf)
 *   and the built role files of `.cadre` (roleClaudeMdsOf), which a parts-flow role excludes (G-02-1f), the global
 *   CLAUDE.md with its imports, the `.md` files of the memory folders of the root as resolved and as given, the user's
 *   skills and agents, and the code dirs given;
 * - for a parts-flow role (isPartsFlowRole), the memories its hand-out record names, linked into its role memory
 *   folder with cadre's MEMORY.md block (linkedMemoriesOf, G-02-1f, D-140 q3-a): their link paths are the user's
 *   linkedMemories, and the links, removals and MEMORY.md write go to the render (`memories`) with their warnings. A
 *   whole-files role gets none, as its memories are linked under `.runtime/instructions/` (instructionPlan).
 * A listing or read that fails counts as empty. It refuses with START_NO_HOME when there is no home folder, before
 * any run, and with START_NO_GIT_DIR when git gives no absolute path. Then each level of the role memory folder
 * (roleFolderLevels: `<userDir>/cadre`, `<repo>-<hash8>`, the role memory folder and its instructions/ subfolder) is
 * stat'ed, and `<userDir>` and each level but the last listed, and it refuses with privateFolderRefusal when
 * privateLevelsProblem finds a level that is a link, is not a folder, or whose parent could not be listed (02-GAPS-B3
 * C5), before any step runs; `<userDir>` itself is never checked, as a linked config folder is common. No setting
 * value, hook command or file text is ever part of a refusal or a warning.
 */
export async function gatherLaunchUser(
  io: InitIo,
  host: HostIo,
  input: {
    readonly locations: InitLocations
    readonly launchStart: LaunchStart
    readonly codeDirs: readonly string[]
    /** The role to launch; a parts-flow role gets the memories its hand-out record names linked (G-02-1f). */
    readonly role: Pick<RoleSpec, 'id' | 'instructions'>
  },
): Promise<LaunchUserRead> {
  const { locations } = input
  const { home } = locations
  const userDir = userDirOf(locations)
  if (home === null || userDir === null) return { kind: 'refuse', text: START_NO_HOME }
  const commonDir = await gitCommonDirOf(io, host, locations.root)
  if (commonDir === null) return { kind: 'refuse', text: START_NO_GIT_DIR }
  const levels = roleFolderLevels(roleMemoryDir({ userDir, ...commonDir }, input.role.id))
  const stats = new Map<string, PortStat | null>()
  for (const level of levels) stats.set(level, await io.stat(level))
  const listings = new Map<string, readonly PortEntry[] | null>()
  for (const folder of [userDir, ...levels.slice(0, -1)]) listings.set(folder, await io.list(folder))
  const problem = privateLevelsProblem(levels, stats, listings)
  if (problem !== null) {
    const shownPath = displayPath(problem.path, home, locations.root)

    return { kind: 'refuse', text: privateFolderRefusal(shownPath, problem.reason) }
  }
  const hooks: LaunchHook[] = []
  for (const source of hookSourcesFor(input.launchStart)) hooks.push(...launchHooksOf(await io.settings(source)))
  const main = mainCheckoutOf(commonDir.gitCommonDir, locations.root)
  const user: LaunchUser = {
    root: locations.root,
    givenRoot: locations.givenRoot,
    home,
    userDir,
    ...commonDir,
    ...(main === null ? {} : { mainRoot: main }),
    ...launchSettingsOf(await io.settings('user')),
    hooks,
    claudeMd: claudeMdPathsOf(await io.ancestors(CLAUDE_MD_FILES)),
    rules: await rulesOf(io, locations.root),
    roleClaudeMds: await roleClaudeMdsOf(io, locations.root),
    globalClaudeMd: await globalClaudeMdOf(io, userDir, home),
    memoryFiles: await memoryFilesOf(io, userDir, locations.root),
    givenMemoryFiles: await memoryFilesOf(io, userDir, locations.givenRoot),
    userSkills: await userSkillsOf(io, userDir),
    userAgents: await userAgentsOf(io, userDir),
    codeDirs: input.codeDirs,
    linkedMemories: [],
  }
  if (!isPartsFlowRole(input.role)) return { kind: 'ok', user, warnings: [], memories: NO_MEMORY_LINKS }
  const { memories, warnings } = await linkedMemoriesOf(io, user, input.role.id)
  const linkedMemories = memories.links.map(link => link.path)

  return { kind: 'ok', user: { ...user, linkedMemories }, warnings, memories }
}

/** The warning for a role given MCP servers when cadre.json records no consent to read ~/.claude.json (D-58). */
const MCP_NOT_READ_WARNING =
  '~/.claude.json was not read (no consent at init), so the user-scope MCP servers of this role are not rendered'

/** The warning for a server a role is given that ~/.claude.json does not hold; the name is shown cleaned. */
function mcpNotInFileWarning(name: string): string {
  return (
    `MCP server ${reportText(name)} is not in ~/.claude.json: ` +
    'the role gets it only from the repo .mcp.json or a claude.ai connector'
  )
}

/**
 * The user's `~/.claude.json` as a parsed value (D-93), read only when cadre.json records the consent (readUserMcp,
 * D-58): without it nothing is read. The file is the one claudeJsonPathOf names, read up to CLAUDE_JSON_MAX_BYTES.
 * Null when the read is not allowed, there is no user folder, or the file is absent, unreadable, too large or not
 * JSON. Its values reach only the runtime MCP config (runtimeMcpText), never a reply or a warning.
 */
export async function readClaudeJson(io: InitIo, locations: InitLocations, readUserMcp: boolean): Promise<unknown> {
  if (!readUserMcp) return null
  const path = claudeJsonPathOf(locations)
  if (path === null) return null
  const read = await io.read(path, CLAUDE_JSON_MAX_BYTES)
  if (read.state !== 'text') return null

  return parseJsonValue(read.text)?.value ?? null
}

/** The config of a server in the `mcpServers` of a holder, when it is a plain object there; else null. */
function serverIn(holder: unknown, name: string): Record<string, unknown> | null {
  if (!isObject(holder) || !isObject(holder.mcpServers)) return null
  const config = Object.hasOwn(holder.mcpServers, name) ? holder.mcpServers[name] : undefined

  return isObject(config) ? config : null
}

/** The project entries of `~/.claude.json` for each root form, in the order of `roots`, trailing slashes ignored. */
function projectEntries(claudeJson: Record<string, unknown>, roots: readonly string[]): unknown[] {
  const projects = isObject(claudeJson.projects) ? Object.entries(claudeJson.projects) : []
  const wanted = roots.map(trimSlash).filter(root => root !== '')

  return wanted.flatMap(root => projects.filter(([path]) => trimSlash(path) === root).map(([, project]) => project))
}

/**
 * The config of one server in `~/.claude.json`: the project entry of the root as resolved or as given first, then the
 * top level; null when none of them holds a plain object for it.
 */
function serverConfig(claudeJson: unknown, roots: readonly string[], name: string): Record<string, unknown> | null {
  if (!isObject(claudeJson)) return null
  for (const project of projectEntries(claudeJson, roots)) {
    const config = serverIn(project, name)
    if (config !== null) return config
  }

  return serverIn(claudeJson, name)
}

/**
 * The text of a role's `.runtime/mcp.json` (D-93, LNCH-02): stableJson of `{ mcpServers }` with, for each server the
 * role is given, in name order, its config from `~/.claude.json` (serverConfig; `roots` holds the repo root as
 * resolved, then as given). A server it does not find there is left out with one warning that names it. With
 * `isRead` false, when cadre.json records no consent (D-58), no server is rendered and a role given any gets one
 * warning that the file was not read. A role given no server gets `{ mcpServers: {} }` and no warning. A warning names
 * servers only; a config value reaches the text alone, which is written to a runtime file.
 */
export function runtimeMcpText(
  role: RoleSpec,
  claudeJson: unknown,
  roots: readonly string[],
  isRead: boolean,
): { readonly text: string; readonly warnings: readonly string[] } {
  const names = sortedUnique(role.mcp)
  if (names.length === 0) return { text: stableJson({ mcpServers: {} }), warnings: [] }
  if (!isRead) return { text: stableJson({ mcpServers: {} }), warnings: [MCP_NOT_READ_WARNING] }
  const found = names.map(name => ({ name, config: serverConfig(claudeJson, roots, name) }))
  const servers = found.flatMap(({ name, config }): [string, Record<string, unknown>][] =>
    config === null ? [] : [[name, config]],
  )
  const missing = found.filter(({ config }) => config === null).map(({ name }) => mcpNotInFileWarning(name))

  return { text: stableJson({ mcpServers: Object.fromEntries(servers) }), warnings: missing }
}

/** The oldest claude cadre starts a role with (D-107): the engine floor the launcher's flags need. */
export const MIN_CLAUDE_VERSION: readonly [number, number, number] = [2, 1, 295]

/**
 * A line of `claude --version` that gives a version: it starts with three runs of digits joined by dots, whatever
 * follows, as the launcher's sed program reads it (cadre_claude_ok).
 */
const CLAUDE_VERSION_LINE = /^(\d+)\.(\d+)\.(\d+)/

/**
 * The version a `claude --version` text gives (D-107), by the launcher's rule (cadre_claude_ok): the three numbers at
 * the start of the one line that starts with a version; null when no line or more than one line does.
 */
export function parseClaudeVersion(text: string): readonly [number, number, number] | null {
  const found = text.split('\n').flatMap(line => {
    const match = CLAUDE_VERSION_LINE.exec(line)

    return match === null ? [] : [match]
  })
  if (found.length !== 1) return null
  const [, major, minor, patch] = found[0] ?? []
  if (major === undefined || minor === undefined || patch === undefined) return null

  return [Number(major), Number(minor), Number(patch)]
}

/** Whether a claude version is MIN_CLAUDE_VERSION or newer, compared part by part from the first (D-107). */
export function isSupportedClaude(version: readonly [number, number, number]): boolean {
  const [major, minor, patch] = version
  const [minMajor, minMinor, minPatch] = MIN_CLAUDE_VERSION
  if (major !== minMajor) return major > minMajor
  if (minor !== minMinor) return minor > minMinor

  return patch >= minPatch
}

/** How long `claude --version` may run before it is given up. */
const CLAUDE_VERSION_TIMEOUT_MS = 10_000

/** The refusal when `claude --version` cannot run or exits non-zero (D-107). */
export const START_NO_CLAUDE =
  'cadre start could not run claude --version, so it stopped: install Claude Code 2.1.295 or newer.'

/** The most characters of what `claude --version` gave that a refusal shows. */
const VERSION_SHOWN_CHARS = 40

/**
 * The refusal when the claude on PATH is older than 2.1.295, or gives no version cadre can read (D-107). The text
 * `claude --version` gave is shown cleaned, as reportText cleans a foreign value, and capped at 40 characters.
 */
export function claudeTooOldReply(versionText: string): string {
  const shown = clean(versionText, VERSION_SHOWN_CHARS)

  return `cadre start needs claude 2.1.295 or newer on PATH; claude --version gave: ${shown}`
}

/**
 * The refusal when `.cadre/manifest.json` is missing, cannot be read or is not a valid manifest: without it the
 * launcher cannot be checked (LNCH-04).
 */
export const START_NO_MANIFEST =
  '.cadre/manifest.json is missing or not valid, so cadre cannot check the launcher: run /cadre init again.'

/** The refusal when a role's launcher is missing, or the manifest holds no entry for it (LNCH-04). */
export function launcherMissingReply(id: string): string {
  const role = reportText(id)

  return `.cadre/bin/${role} is missing or not in .cadre/manifest.json: run /cadre regen ${role}.`
}

/**
 * The refusal when a role's launcher is not the file cadre wrote (LNCH-04, T-03-28): its sha256 differs from its
 * manifest entry, or it cannot be read as a regular file inside the repo. It names the three ways that work (#72 A3):
 * restore the file; `/cadre init`, whose Take new answer writes the new launcher and its manifest entry; or plain
 * regen, which keeps the changed file and its old manifest entry and writes the new version beside it as
 * `.cadre-new`, so that copy is moved over the launcher, made executable again, and a second regen records it.
 */
export function launcherChangedReply(id: string): string {
  const role = reportText(id)
  const launcher = `.cadre/bin/${role}`

  return (
    `${launcher} was changed outside cadre: restore it, or run /cadre init and answer Take new for it, ` +
    `or run /cadre regen ${role}, move ${launcher}.cadre-new over it, chmod 755 it ` +
    `and run /cadre regen ${role} again.`
  )
}

/**
 * The reply when a step of the render fails (LNCH-03): the render stops at that step, so no stamp is written and the
 * launcher refuses to start. `path` is the step's path below the repo root, shown cleaned.
 */
export function renderFailedReply(id: string, path: string): string {
  const role = reportText(id)

  return (
    `cadre start could not render .cadre/${role}/.runtime/ (${reportText(path)} failed), ` +
    `so the launcher will refuse to start: fix it and run /cadre start ${role} again.`
  )
}

/**
 * The text of the role's launcher on disk once it can be trusted (LNCH-04, T-03-28), or the refusal. It refuses, in
 * this order: a `.cadre/manifest.json` that is missing, cannot be read or is not a valid manifest (START_NO_MANIFEST);
 * a launcher `.cadre/bin/<id>` the manifest holds no entry for, or that is not there (launcherMissingReply); one that
 * cannot be read as a regular file inside the repo, or whose sha256 differs from its entry (launcherChangedReply). Both
 * are read through readRepoFile, so a link out of the repo is never read. /cadre epic reuses it for each role (D-165).
 */
export async function launcherRead(io: InitIo, root: string, id: string): Promise<RegenRead<string>> {
  const manifestRead = await readRepoFile(io, root, MANIFEST_PATH, MAX_READ_BYTES)
  const manifest = manifestRead.state === 'text' ? parseManifest(manifestRead.text) : null
  if (manifest === null) return { kind: 'refuse', text: START_NO_MANIFEST }
  const path = `.cadre/bin/${id}`
  const entry = manifest.files.find(file => file.path === path)
  if (entry === undefined) return { kind: 'refuse', text: launcherMissingReply(id) }
  const launcher = await readRepoFile(io, root, path, MAX_READ_BYTES)
  if (launcher.state === 'absent') return { kind: 'refuse', text: launcherMissingReply(id) }
  if (launcher.state !== 'text') return { kind: 'refuse', text: launcherChangedReply(id) }
  if ((await sha256Hex(launcher.text)) !== entry.sha256) return { kind: 'refuse', text: launcherChangedReply(id) }

  return { kind: 'ok', value: launcher.text }
}

/**
 * The warning when the role's launcher on disk, which matches its manifest entry, is not the text this cadre writes
 * for it today (LNCH-04, #54 A3): an older cadre wrote it, or the setup changed since. It warns and never refuses,
 * since the launcher is still the one cadre wrote. The name is shown cleaned.
 */
function launcherOutdatedWarning(id: string): string {
  const role = reportText(id)

  return (
    `.cadre/bin/${role} is not the launcher this cadre writes today (written by an older cadre or for another ` +
    `setup): run /cadre regen ${role} to update it`
  )
}

/**
 * The launcher warnings of /cadre start (#54 A3): launcherOutdatedWarning when `desired`, the files desiredFiles gives
 * for the role today, holds a launcher `.cadre/bin/<id>` whose text differs from `onDisk`; none otherwise.
 */
function launcherDrift(id: string, onDisk: string, desired: readonly DesiredFile[]): string[] {
  const today = desired.find(file => file.path === `.cadre/bin/${id}`)
  if (today === undefined || today.content === onDisk) return []

  return [launcherOutdatedWarning(id)]
}

/**
 * Why the claude on PATH, the one the launcher execs (RESEARCH 1.2), must not start the role (D-107), or null:
 * `claude --version` that cannot run or exits non-zero (START_NO_CLAUDE); an output in which parseClaudeVersion reads
 * no version (no line, or more than one, starts with one), or one older than MIN_CLAUDE_VERSION (claudeTooOldReply,
 * with the first line of the output). It runs in the home folder when there is one, as every install run does
 * (T-03-46), so no repo-level settings take part in the one `claude` run of /cadre start (#72 B1). /cadre epic reuses
 * it before it creates anything (D-165).
 */
export async function claudeRefusal(host: HostIo, home: string | null): Promise<string | null> {
  const options = home === null ? {} : { cwd: home }
  const run = await host.run(['claude', '--version'], { ...options, timeoutMs: CLAUDE_VERSION_TIMEOUT_MS })
  if (run === null || run.exitCode !== 0) return START_NO_CLAUDE
  const version = parseClaudeVersion(run.stdout)
  if (version !== null && isSupportedClaude(version)) return null

  return claudeTooOldReply(run.stdout.split('\n')[0] ?? '')
}

/** How long one removal, folder or link step of a render may run before it is given up. */
const RENDER_STEP_TIMEOUT_MS = 10_000

/** The command that starts a role: the absolute path of its launcher `<root>/.cadre/bin/<id>`, as one shell word. */
export function launcherCommand(root: string, id: string): string {
  return shQuote(`${root}/.cadre/bin/${id}`)
}

/** How long pbcopy may run before it is given up. */
const CLIPBOARD_TIMEOUT_MS = 5_000

/** The line below the launcher command when pbcopy copied it (D-110). */
export const COPIED_LINE = 'Copied to the clipboard.'

/**
 * The line below the launcher command when it could not be copied (D-110, D-132): pbcopy is macOS only, and a host
 * without it, or a copy that fails, still has the command printed above, so this is not an error.
 */
export const NOT_COPIED_LINE = 'Could not copy it to the clipboard (pbcopy is macOS only): copy the line above.'

/**
 * The run that copies the launcher command to the clipboard (D-110): `/usr/bin/pbcopy`, absolute and with no shell,
 * given the command on stdin and LC_CTYPE=UTF-8, without which pbcopy mangles a non-ASCII letter of the path (RESEARCH
 * Pitfall 8). pbcopy is macOS only, so a run that cannot start or exits non-zero is not an error: the command is
 * printed all the same (D-132).
 */
export function clipboardRun(command: string): { readonly argv: readonly string[]; readonly options: RunOptions } {
  return {
    argv: ['/usr/bin/pbcopy'],
    options: { stdin: command, env: { LC_CTYPE: 'UTF-8' }, timeoutMs: CLIPBOARD_TIMEOUT_MS },
  }
}

/** The refusal of `--terminal` on a host that is not macOS (D-132): the command is printed and copied all the same. */
export const TERMINAL_MAC_ONLY = '--terminal works on macOS only: run the command above in a terminal yourself.'

/** The refusal of `--terminal` with a value it does not take, or the switch given twice (D-109). */
const TERMINAL_INVALID = '--terminal takes terminal, iterm or tmux: run the command above yourself.'

/**
 * The refusal of a bare `--terminal` outside tmux when TERM_PROGRAM names no terminal cadre opens (D-109): it names
 * TERM_PROGRAM, shown cleaned, or `unset`.
 */
function terminalUnknownText(termProgram: string | null): string {
  const shown = termProgram === null ? 'unset' : reportText(termProgram)

  return (
    `--terminal could not tell this terminal (TERM_PROGRAM=${shown}): ` +
    'use --terminal=terminal, --terminal=iterm or --terminal=tmux, or run the command above yourself.'
  )
}

/**
 * The AppleScript lines that open a new Terminal window running the shell text, the last argv item, which `do script`
 * reads through `on run argv` (D-126). Terminal.app cannot make a tab without System Events, so it is a window.
 */
const TERMINAL_APP_LINES: readonly string[] = Object.freeze([
  'on run argv',
  'tell application "Terminal"',
  'activate',
  'do script (item 1 of argv)',
  'end tell',
  'end run',
])

/**
 * The AppleScript lines that open a new iTerm tab in the current window, or a new window when none is open, and write
 * the shell text, the last argv item, into its session through `on run argv` (D-126).
 */
const ITERM_LINES: readonly string[] = Object.freeze([
  'on run argv',
  'tell application "iTerm"',
  'activate',
  'if (count of windows) is 0 then',
  'create window with default profile',
  'else',
  'tell current window to create tab with default profile',
  'end if',
  'tell current session of current window to write text (item 1 of argv)',
  'end tell',
  'end run',
])

/**
 * What a tmux window runs after a launcher that exits non-zero: a note, then a wait for Enter, so the launcher's
 * refusal stays on screen and does not close with the window (RESEARCH Pitfall 7).
 */
const TMUX_WAIT = "{ printf '%s\\n' 'cadre: the launcher stopped; press Enter to close this window'; read -r _; }"

/**
 * What the reply names an iTerm open: ITERM_LINES make a tab in the current window, or a window when none is open,
 * and do not say which, so the name covers both (#63).
 */
const ITERM_NAME = 'iTerm tab or window'

/**
 * The osascript argv that runs these AppleScript lines, each as one `-e` value, with the shell text as the last argv
 * item: the script reads it through `on run argv`, so no AppleScript is ever built from it (T-03-29).
 */
function osascriptArgv(lines: readonly string[], shellText: string): readonly string[] {
  return Object.freeze(['/usr/bin/osascript', ...lines.flatMap(line => ['-e', line]), shellText])
}

/**
 * The tmux argv that opens the command in a new window `cadre-<id>` at the root (D-126). tmux would run a single
 * command argument with its default-shell, which may be fish or another shell that cannot parse TMUX_WAIT, so the
 * window runs `/bin/sh -c` with the shell text as separate argv items, which tmux 3.0 and later run with no shell
 * between (#63 A5): the command, a shell word already, followed by TMUX_WAIT for when it fails.
 */
function tmuxArgv(id: string, root: string, command: string): readonly string[] {
  const shellText = `${command} || ${TMUX_WAIT}`

  return Object.freeze(['tmux', 'new-window', '-n', `cadre-${id}`, '-c', root, '/bin/sh', '-c', shellText])
}

/**
 * Where `/cadre start --terminal` opens the launcher command (D-109, D-126): the name of what it opens and the argv
 * that opens it, or the refusal to print instead. The command is printed and copied either way.
 */
export type TerminalPlan =
  | { readonly kind: 'open'; readonly name: string; readonly argv: readonly string[] }
  | { readonly kind: 'refuse'; readonly text: string }

/** What a bare `--terminal` picks (D-109): tmux when TMUX is set, else the macOS terminal TERM_PROGRAM names. */
function detectedTerminal(
  tmux: string | null,
  termProgram: string | null,
): Exclude<TerminalChoice, 'none' | 'auto' | 'invalid'> | null {
  if (tmux !== null) return 'tmux'
  if (termProgram === 'Apple_Terminal') return 'terminal'
  if (termProgram === 'iTerm.app') return 'iterm'

  return null
}

/**
 * Where `--terminal` opens the launcher command, as data (D-109, D-126, D-132). Off macOS it refuses with
 * TERMINAL_MAC_ONLY, whatever the choice, and `invalid` refuses. A forced value skips detection; `auto` picks tmux when
 * TMUX is set, else a Terminal window for TERM_PROGRAM `Apple_Terminal` and an iTerm tab for `iTerm.app`, and refuses
 * any other TERM_PROGRAM, or none. Terminal.app and iTerm get the shell text `cd -- <root> && <command>`, the root
 * shQuote'd, as the last osascript argv item, which `on run argv` reads and no AppleScript is built from (T-03-29):
 * Terminal.app opens a new window (`do script`), iTerm a new tab in its current window, or a new window when none is
 * open, named ITERM_NAME. tmux opens a new window `cadre-<id>` at the root whose command, run by `/bin/sh -c`, waits
 * for Enter when the launcher fails (Pitfall 7).
 */
export function terminalPlan(input: {
  readonly choice: Exclude<TerminalChoice, 'none'>
  readonly tmux: string | null
  readonly termProgram: string | null
  readonly isMacOs: boolean
  readonly id: string
  readonly root: string
  readonly command: string
}): TerminalPlan {
  const { choice, tmux, termProgram, isMacOs, id, root, command } = input
  if (!isMacOs) return { kind: 'refuse', text: TERMINAL_MAC_ONLY }
  if (choice === 'invalid') return { kind: 'refuse', text: TERMINAL_INVALID }
  const terminal = choice === 'auto' ? detectedTerminal(tmux, termProgram) : choice
  if (terminal === null) return { kind: 'refuse', text: terminalUnknownText(termProgram) }
  if (terminal === 'tmux') return { kind: 'open', name: 'tmux window', argv: tmuxArgv(id, root, command) }
  const shellText = `cd -- ${shQuote(root)} && ${command}`
  if (terminal === 'iterm') return { kind: 'open', name: ITERM_NAME, argv: osascriptArgv(ITERM_LINES, shellText) }

  return { kind: 'open', name: 'Terminal window', argv: osascriptArgv(TERMINAL_APP_LINES, shellText) }
}

/** How long `uname -s` may run before it is given up. */
export const UNAME_TIMEOUT_MS = 5_000

/** How long opening a terminal may run before it is given up: osascript may wait on the Automation consent prompt. */
export const TERMINAL_OPEN_TIMEOUT_MS = 15_000

/**
 * The `--terminal` line below the copy line (D-109, D-126, D-132). The host is macOS when `/usr/bin/uname -s` exits 0
 * with `Darwin`; with that, and TMUX and TERM_PROGRAM as the host reads them, terminalPlan gives the argv to run, or
 * the refusal, which is the line. An open that exits 0 gives `Opened it in a new <name>.`, and one that cannot run or
 * exits non-zero gives `Could not open a new <name>: run the command above yourself.`
 */
async function terminalLine(
  host: HostIo,
  input: {
    readonly choice: Exclude<TerminalChoice, 'none'>
    readonly id: string
    readonly root: string
    readonly command: string
  },
): Promise<string> {
  const uname = await host.run(['/usr/bin/uname', '-s'], { timeoutMs: UNAME_TIMEOUT_MS })
  const isMacOs = uname !== null && uname.exitCode === 0 && uname.stdout === 'Darwin\n'
  const tmux = await host.env('TMUX')
  const termProgram = await host.env('TERM_PROGRAM')
  const plan = terminalPlan({ ...input, tmux, termProgram, isMacOs })
  if (plan.kind === 'refuse') return plan.text
  const open = await host.run(plan.argv, { timeoutMs: TERMINAL_OPEN_TIMEOUT_MS })
  if (open !== null && open.exitCode === 0) return `Opened it in a new ${plan.name}.`

  return `Could not open a new ${plan.name}: run the command above yourself.`
}

/**
 * The disk a render is planned from: the stat of each path renderPaths names, asked with resolve, and the listing of
 * each folder it names. A folder the host cannot list gets no listing, so renderSteps counts it as empty.
 */
async function renderDiskOf(
  io: InitIo,
  paths: { readonly stats: readonly string[]; readonly listings: readonly string[] },
): Promise<Pick<RenderInput, 'stats' | 'listings'>> {
  const stats = new Map<string, PortStat | null>()
  for (const path of paths.stats) stats.set(path, await io.stat(path))
  const listings = new Map<string, readonly PortEntry[]>()
  for (const path of paths.listings) {
    const entries = await io.list(path)
    if (entries !== null) listings.set(path, entries)
  }

  return { stats, listings }
}

/**
 * Runs one step of a render through the host: a write through host.write; a removal, a folder, a chmod or a link
 * through host.run with its renderArgv, absolute and with no shell, done only when it exits 0. Apply makes the role
 * memory folders of the private files with it too, as a mkdir step (G-02-1f).
 */
export async function isStepDone(host: HostIo, step: RenderStep): Promise<boolean> {
  if (step.kind === 'write') return host.write(step.path, step.text)
  const argv = renderArgv(step)
  if (argv === null) return false
  const run = await host.run(argv, { timeoutMs: RENDER_STEP_TIMEOUT_MS })

  return run !== null && run.exitCode === 0
}

/**
 * The reply of a render that ran every step (D-102): what was asked for, the folder rendered with the number of links
 * it made, one `warning: ` line per warning, then the line that hands over the launcher and the launcher command, two
 * spaces in, and below the command the lines of `after`: the copy line, then the `--terminal` line when the switch
 * was given (D-110, D-109).
 */
function startReplyText(
  id: string,
  links: number,
  warnings: readonly string[],
  command: string,
  after: readonly string[],
): string {
  return [
    `cadre start ${id}`,
    `Rendered .cadre/${id}/.runtime/ (${links} ${links === 1 ? 'link' : 'links'}).`,
    ...warnings.map(warning => `warning: ${warning}`),
    `Run this in a terminal to start role ${id}:`,
    `  ${command}`,
    ...after,
  ].join('\n')
}

/**
 * The role's LaunchPlan with the link `.cadre/<id>/.runtime/private-instructions` to its private instructions folder,
 * `<role memory folder>/instructions` (D-140 q1-b, q2-a), added in path order: the launcher adds that link with
 * `--add-dir`, so every render makes it, and the folder behind it (privateFolderSteps), for a role with no private part
 * too. The folder lies in the user's config folder, apart from the memory files, and never in the repo.
 */
function withPrivateInstructions(plan: LaunchPlan, user: LaunchUser, id: string): LaunchPlan {
  const link: OverlayLink = {
    path: `${runtimeFolder(user.root, id)}/${PRIVATE_INSTRUCTIONS_LINK}`,
    target: privateInstructionsDir(user, id),
  }

  return { ...plan, links: [...plan.links, link].sort((a, b) => compareText(a.path, b.path)) }
}

/**
 * What makes a render an epic render (D-157): /cadre epic renders a role for its epic worktree, from the team of the
 * main checkout.
 */
export type EpicRender = {
  /** The main checkout's root, where the team, the manifest and the launchers were read. */
  readonly mainRoot: string
  /** The text of the role's epic kickoff, written to `.runtime/kickoff.txt` right before the stamp (D-158). */
  readonly kickoff: string
}

/**
 * The CLAUDE.md files an epic role must not load (RESEARCH Pitfall 1): `paths`, which the host lists for the ancestors
 * of the session's folder, the main checkout, so it does not name the worktree's own, and `<worktree>/CLAUDE.md` and
 * `<worktree>/.claude/CLAUDE.md`, sorted and once each. Excluding a path that does not exist is harmless (A2).
 */
export function worktreeClaudeMd(paths: readonly string[], worktree: string): string[] {
  return sortedUnique([...paths, `${worktree}/CLAUDE.md`, `${worktree}/.claude/CLAUDE.md`])
}

/**
 * The render half of /cadre start for one role (D-102), which /cadre epic runs too, once per role, for its epic
 * worktree (D-157): `locations` give the root it renders for, and the caller reads and compiles the team (`state`, the
 * role, its compiled scope and the repo's code dirs) in the session's own root. It gathers the launching user for the
 * root (gatherLaunchUser), builds the role's LaunchPlan with its private instructions link (withPrivateInstructions,
 * D-140 q1-b), renders the MCP config from `~/.claude.json` under the stored consent with the project entries of
 * `mcpRoots`, then of the user's `mainRoot` when set (03.1-W3 S1), in that order (runtimeMcpText), and the probe
 * expectations, and renders `<root>/.cadre/<id>/.runtime/`: renderPaths names what to stat and list, renderSteps plans
 * the steps from the root the LaunchPlan was built for, and every refusal comes before anything is written. Each step
 * then runs through the host in order, and the first one that fails stops the render with renderFailedReply and no
 * stamp written, so the launcher refuses to start (LNCH-03).
 * It refuses with the refusals of gatherLaunchUser, a role memory folder level it would write through included
 * (privateFolderRefusal, 02-GAPS-B3 C5), a render refusal, or that failure. Else it gives the number of links the
 * render made and every warning of the launch user, the LaunchPlan, the MCP config and the render, in that order.
 * `epic` is null for /cadre start, which changes nothing. For /cadre epic it names the main checkout and the role's
 * epic kickoff, which the render writes to `.runtime/kickoff.txt` as the step before the stamp (D-158), and the user
 * the LaunchPlan is built for also excludes the worktree's own CLAUDE.md files (worktreeClaudeMd, RESEARCH Pitfall 1)
 * and carries the main checkout as `mainRoot`, whose code dirs get the exact denies the worktree's get (Pitfall 2).
 */
export async function renderRole(
  io: InitIo,
  host: HostIo,
  input: {
    readonly locations: InitLocations
    readonly state: CadreState
    readonly role: RoleSpec
    readonly scope: CompiledScope
    readonly codeDirs: readonly string[]
    readonly mcpRoots: readonly string[]
    readonly epic: EpicRender | null
  },
): Promise<
  | { readonly kind: 'refuse'; readonly text: string }
  | { readonly kind: 'ok'; readonly links: number; readonly warnings: readonly string[] }
> {
  const { locations, state, role, scope } = input
  const { id } = role
  const launch = await gatherLaunchUser(io, host, {
    locations,
    launchStart: state.launchStart,
    codeDirs: input.codeDirs,
    role,
  })
  if (launch.kind === 'refuse') return { kind: 'refuse', text: launch.text }
  const gathered = launch.user
  const user: LaunchUser =
    input.epic === null
      ? gathered
      : {
          ...gathered,
          claudeMd: worktreeClaudeMd(gathered.claudeMd, locations.root),
          mainRoot: input.epic.mainRoot,
        }
  const plan = withPrivateInstructions(launchPlan(role, scope, user), user, id)
  const claudeJson = await readClaudeJson(io, locations, state.readUserMcp)
  const mcpRoots = [...input.mcpRoots, ...(user.mainRoot === undefined ? [] : [user.mainRoot])]
  const mcp = runtimeMcpText(role, claudeJson, mcpRoots, state.readUserMcp)
  const expectationsText = probeExpectationsText(expectationsFor(scope, roleMemoryDir(user, id)))
  const stamp = stampText((await io.cadreVersion()) ?? 'unknown')
  const disk = await renderDiskOf(io, renderPaths(user.root, id, plan, { kickoff: input.epic !== null }))
  const texts = { mcpText: mcp.text, expectationsText, stampText: stamp }
  // Only an epic render names a kickoff, so a /cadre start render never writes or removes one (D-168).
  const kickoff = input.epic === null ? {} : { kickoff: input.epic.kickoff }
  const render = renderSteps({ root: user.root, id, plan, ...texts, ...disk, memories: launch.memories, ...kickoff })
  if (render.refusal !== null) return { kind: 'refuse', text: render.refusal }

  for (const step of render.steps) {
    if (!(await isStepDone(host, step))) {
      return { kind: 'refuse', text: renderFailedReply(id, repoRelative(user.root, step.path)) }
    }
  }
  const links = render.steps.filter(step => step.kind === 'link').length

  return { kind: 'ok', links, warnings: [...launch.warnings, ...plan.warnings, ...mcp.warnings, ...render.warnings] }
}

/**
 * `/cadre start <id>` in the repo's root session (D-102, LNCH-04). It refuses with one exact line, in this order: the
 * repo refusals of repoGuard (in the start wording); the team refusals of readTeam; the launcher refusals of
 * launcherRead (manifest, launcher missing, launcher changed); the claude refusals of claudeRefusal (D-107), run
 * before anything else is run; and the refusals of renderRole. It reads the team, checks the launcher and compiles
 * the team (compileTeam) itself, in the session's root; renderRole then renders the role's `.runtime/` for that same
 * root, with the MCP project entries of the root as resolved, then as given, and no epic (D-157): the settings, the MCP
 * config, the probe expectations, the links and the private instructions folder, the inbox when there is none, and the
 * stamp last. The reply names the folder; the scan warnings of the run, as regen prints them (scanWarnings, #54 A1);
 * the launcher warning of launcherDrift (#54 A3); every warning renderRole gives; and the launcher command
 * (startReplyText). Once the render has run every step, it copies the command through the host with clipboardRun, and
 * the line below the command is COPIED_LINE when pbcopy exits 0, else NOT_COPIED_LINE, which is not an error (D-110,
 * D-132); a refused or failed render copies nothing. With `--terminal` (`options.terminal` other than `none`), after
 * the copy it asks `/usr/bin/uname -s`, TMUX and TERM_PROGRAM, and opens the command where terminalPlan says, or prints
 * its refusal: the line of terminalLine follows the copy line, and the command is printed and copied in every case
 * (D-109, D-126, D-132). It never runs the launcher, and never starts a background session (D-108).
 */
export async function runStart(
  io: InitIo,
  host: HostIo,
  options: { readonly id: string; readonly terminal: TerminalChoice },
): Promise<string> {
  const { id, terminal } = options
  const guard = await repoGuard(io, 'start')
  if (guard.kind === 'refuse') return guard.text
  const { locations } = guard
  const team = await readTeam(io, locations.root, 'start', id)
  if (team.kind === 'refuse') return team.text
  const { state, roles } = team.value
  const launcher = await launcherRead(io, locations.root, id)
  if (launcher.kind === 'refuse') return launcher.text
  const claude = await claudeRefusal(host, locations.home)
  if (claude !== null) return claude

  const { gathered, scopes } = await compileTeam(io, locations, state, roles)
  const role = roles.find(candidate => candidate.id === id)
  const scope = scopes.get(id)
  // Fail closed: readTeam read every listed role and compileTeam compiled each one, so both are always there.
  if (role === undefined || scope === undefined) return regenBadRole(id)
  const codeDirs = gathered.repo.codeDirs
  const mcpRoots = [locations.root, locations.givenRoot]
  const render = await renderRole(io, host, { locations, state, role, scope, codeDirs, mcpRoots, epic: null })
  if (render.kind === 'refuse') return render.text
  const drift = launcherDrift(id, launcher.value, desiredFiles({ roles, scopes, state, only: id }))
  const scan = scanWarnings(locations, gathered)
  const warnings = [...scan, ...drift, ...render.warnings]
  const command = launcherCommand(locations.root, id)
  const copy = clipboardRun(command)
  const copied = await host.run(copy.argv, copy.options)
  const copyLine = copied !== null && copied.exitCode === 0 ? COPIED_LINE : NOT_COPIED_LINE
  if (terminal === 'none') return startReplyText(id, render.links, warnings, command, [copyLine])
  const opened = await terminalLine(host, { choice: terminal, id, root: locations.root, command })

  return startReplyText(id, render.links, warnings, command, [copyLine, opened])
}
