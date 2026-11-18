/**
 * The render plan of /cadre start, a layer 10 module: the ordered steps that write a role's per-launch files into
 * `.cadre/<id>/.runtime/`, copy its private instructions into `.runtime/private-instructions`, and make the role's
 * private instructions folder (privateFolderSteps) and inbox folder (inboxFolderSteps) under the config folder, from
 * its LaunchPlan and the texts of its MCP config and probe expectations. It reads and writes nothing: /cadre start
 * stats and lists the paths renderPaths names, then runs the steps renderSteps gives, in order, through the host. The
 * stamp is always the last step, and the launcher trusts it: it refuses to start when the stamp is missing or older
 * than the role files or a rendered file, so a render that stops part way never starts a session. It imports
 * apply/safety, core, paths and the launcher check, and the host step and launch types; the start modules that gather
 * and render read it.
 */
import type { InboxRotation, PortEntry, PortStat } from '../../types'
import { roleFolderLevels } from '../apply/safety'
import { stableJson } from '../core/json'
import { isRoleId } from '../core/role-id'
import { compareText, reportText, sortedUnique } from '../core/text'
import type { RenderStep } from '../host/steps'
import type { OverlayLink } from '../launch/links'
import type { LaunchPlan } from '../launch/plan'
import { CONTRACTS } from '../locales/contracts'
import { fill, t } from '../locales/t'
import {
  INBOX_LOG_FILE,
  inboxFolderLevels,
  isDirInsideRoot,
  parentOf,
  PRIVATE_INSTRUCTIONS_COPY,
  privateInstructionsCopyOf,
  PROBE_EXPECTATIONS_FILE,
  runtimeDirOf,
  RUNTIME_KICKOFF_FILE,
  RUNTIME_STAMP_FILE,
  SESSION_FILE,
} from '../paths'
import { renderFailedReply } from './launcher-check'

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
 * expectations, and the stamp last.
 */
const WRITTEN_FILES: readonly string[] = Object.freeze([
  SETTINGS_FILE,
  MCP_FILE,
  PROBE_EXPECTATIONS_FILE,
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
 * stamp; the disk; the memory links of the role (MemoryLinks); and the role's inbox folder and private instructions
 * folder in the user config folder. `stats` holds the stat of each path renderPaths names, asked with resolve, and
 * `listings` the listing of each folder it names. A path with no stat counts as not there, and a folder with no
 * listing as empty, but a private instructions folder that is there with no listing refuses the render. `kickoff`, the
 * text of `.runtime/kickoff.txt`, is set for an epic render only; /cadre start leaves it out, so its render never
 * writes or removes that file.
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
  readonly inboxDir: string
  /** The role's private instructions folder in the user config folder, which a render copies into `.runtime`. */
  readonly privateSource: string
  readonly kickoff?: string
  /** Set only when the inbox is a real file over the rotation threshold. */
  readonly rotation?: InboxRotation
  /** The record line an epic render starts a new inbox with: PM's brief. */
  readonly inboxSeed?: string
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
  return runtimeDirOf(root, id)
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
 * folder or to a link, every link path, the four files a render writes into `.runtime`, the DONE.md marker, the inbox
 * in `options.inboxDir`, the private instructions folder `options.privateSource` and its copy in `.runtime`, and for
 * an epic render (`options.kickoff`) the epic kickoff `.runtime/kickoff.txt` too; `listings` holds `.runtime`, whose
 * listing shows a file a render writes that is a link whatever its stat says, then the STALE_LINK_FOLDERS under it,
 * then the inbox folder, whose listing does the same for the inbox, then the copy and the private instructions folder.
 */
export function renderPaths(
  root: string,
  id: string,
  plan: LaunchPlan,
  options: { readonly inboxDir: string; readonly privateSource: string; readonly kickoff?: boolean },
): { readonly stats: readonly string[]; readonly listings: readonly string[] } {
  const runtime = runtimeFolder(root, id)
  const copy = privateInstructionsCopyOf(root, id)
  const stats = sortedUnique([
    roleFolder(root, id),
    ...renderFolders(runtime, plan.links),
    ...plan.links.map(link => link.path),
    ...WRITTEN_FILES.map(name => `${runtime}/${name}`),
    ...(options.kickoff === true ? [`${runtime}/${RUNTIME_KICKOFF_FILE}`] : []),
    `${runtime}/${DONE_MARKER_FILE}`,
    `${options.inboxDir}/${INBOX_LOG_FILE}`,
    options.privateSource,
    copy,
  ])
  const staleFolders = STALE_LINK_FOLDERS.map(folder => `${runtime}/${folder}`)

  return { stats, listings: [runtime, ...staleFolders, options.inboxDir, copy, options.privateSource] }
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
export function isRealEntry(stat: PortStat | null): boolean {
  return stat !== null && !stat.isLink
}

/** The refusal when the role folder is missing, a link, or not a real folder inside the repo. */
function roleFolderRefusal(id: string): string {
  const role = reportText(id)

  return t('start.renderPlan.roleFolderRefusal', { role })
}

/** The refusal when `.runtime`, a folder in it, or a file a render writes is a link or not what the render needs. */
function runtimeRefusal(id: string): string {
  const role = reportText(id)
  const what = t('start.renderPlan.runtimeRefusal', { role })

  return t('start.renderPlan.runtimeRefusal2', { what, role })
}

/**
 * The refusal when `.runtime` lists a file a render writes as a link that its stat did not show as one, such as a
 * dangling link the host's stat takes for no file (#72 A2): the write would go through it.
 */
function unstatedLinkRefusal(id: string, name: string): string {
  const role = reportText(id)
  const what = t('start.renderPlan.unstatedLinkRefusal', { role, name })

  return t('start.renderPlan.unstatedLinkRefusal2', { what, role })
}

/** The refusal when the role's inbox is a link or not a regular file; a link there is never removed. */
function inboxRefusal(id: string, path: string): string {
  return t('start.renderPlan.inboxRefusal', { role: reportText(id), path: reportText(path) })
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

/** Whether the role's inbox is a link, by its stat or by its folder's listing, or is there and not a regular file. */
function isUnsafeInbox(input: RenderInput, inbox: string): boolean {
  const stat = statAt(input, inbox)
  if (stat !== null && (stat.isLink || stat.kind !== 'file')) return true
  const entries = input.listings.get(input.inboxDir) ?? []

  return entries.some(entry => entry.name === INBOX_LOG_FILE && entry.isLink)
}

/** Whether the private instructions copy is a link, by its stat or by the listing of `.runtime`, a dangling one too. */
function isCopyLink(input: RenderInput, runtime: string): boolean {
  if (isLinkStat(statAt(input, privateInstructionsCopyOf(input.root, input.id)))) return true
  const entries = input.listings.get(runtime) ?? []

  return entries.some(entry => entry.name === PRIVATE_INSTRUCTIONS_COPY && entry.isLink)
}

/** The plain-named entries of the copy's listing; none when the copy is a link, whose listing is never used. */
function copyEntries(input: RenderInput, runtime: string): readonly PortEntry[] {
  if (isCopyLink(input, runtime)) return []
  const entries = input.listings.get(privateInstructionsCopyOf(input.root, input.id)) ?? []

  return entries.filter(entry => isPlainName(entry.name))
}

function isRegularFile(entry: PortEntry): boolean {
  return entry.kind === 'file' && !entry.isLink
}

function sourceEntries(input: RenderInput): readonly PortEntry[] {
  return (input.listings.get(input.privateSource) ?? []).filter(entry => isPlainName(entry.name))
}

/** The names of the regular files of the private instructions folder, sorted: the files a render copies. */
function sourceNames(input: RenderInput): string[] {
  return sourceEntries(input).filter(isRegularFile).map(entry => entry.name).sort(compareText)
}

/** The names of every other entry of the private instructions folder, sorted: each is named in a warning. */
function skippedNames(input: RenderInput): string[] {
  return sourceEntries(input)
    .filter(entry => !isRegularFile(entry))
    .map(entry => entry.name)
    .sort(compareText)
}

/**
 * Why a render must not run, or null. The role folder must be a real folder inside the repo; `.runtime`, its overlay,
 * every folder down to a STALE_LINK_FOLDERS folder and every folder down to a link must be missing or a real folder;
 * and each file a render writes must be missing, a regular file, or a link, which is removed first. Anything else
 * would let a step write, link or remove through a link, or write onto a folder. A file a render writes that the
 * listing of `.runtime` shows as a link while its stat does not refuses too (unstatedLinkRefusal), so no write rests
 * on what the host's stat makes of a dangling link; a `.runtime` with no listing is taken as empty, as every folder
 * with none is. The inbox in the role's inbox folder must be missing or a regular file, by its stat and by its
 * folder's listing (inboxRefusal): a link there is never removed. Last come the private instructions: a real entry at
 * the copy's path that is not a folder, or a real folder in the copy, refuses as `.runtime` does, since `rm` never
 * gets `-r`; and a private instructions folder that is there but could not be listed refuses with renderFailedReply.
 */
function refusalOf(input: RenderInput, runtime: string): string | null {
  const role = statAt(input, roleFolder(input.root, input.id))
  if (role === null || role.isLink || !isDirInsideRoot(role, input.root)) return roleFolderRefusal(input.id)
  const folders = renderFolders(runtime, input.plan.links).map(path => statAt(input, path))
  const files = writtenFiles(input).map(name => statAt(input, `${runtime}/${name}`))
  if (folders.some(isUnsafeFolder) || files.some(isUnsafeFile)) return runtimeRefusal(input.id)
  const unstated = writtenFiles(input).find(name => isUnstatedLink(input, runtime, name))
  if (unstated !== undefined) return unstatedLinkRefusal(input.id, unstated)
  const inbox = `${input.inboxDir}/${INBOX_LOG_FILE}`
  if (isUnsafeInbox(input, inbox)) return inboxRefusal(input.id, inbox)
  const copy = statAt(input, privateInstructionsCopyOf(input.root, input.id))
  if (copy !== null && !copy.isLink && copy.kind !== 'dir') return runtimeRefusal(input.id)
  if (copyEntries(input, runtime).some(entry => !entry.isLink && entry.kind === 'dir')) return runtimeRefusal(input.id)
  const source = statAt(input, input.privateSource)
  const isSourceDir = source !== null && !source.isLink && source.kind === 'dir'
  if (isSourceDir && !input.listings.has(input.privateSource)) return renderFailedReply(input.id, input.privateSource)

  return null
}

/** Whether a listed name is one plain entry of its folder: not empty, not `.` or `..`, and with no slash. */
export function isPlainName(name: string): boolean {
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
 * The links a render removes before it makes anything, in order: those an earlier render left that the plan no longer
 * names (staleLinks), then each planned link path that is a link, then the private instructions copy when it is a link
 * an older render left (isCopyLink), then each file the render writes, but the stamp, that is a link. Only links: a
 * real file or folder is never removed here.
 */
function linkRemovals(input: RenderInput, runtime: string): string[] {
  const linkPaths = input.plan.links.map(link => link.path).filter(path => isLinkStat(statAt(input, path)))
  const copy = isCopyLink(input, runtime) ? [privateInstructionsCopyOf(input.root, input.id)] : []
  const files = writtenFiles(input)
    .filter(name => name !== RUNTIME_STAMP_FILE)
    .map(name => `${runtime}/${name}`)
    .filter(path => isLinkStat(statAt(input, path)))

  return [...staleLinks(input, runtime), ...linkPaths, ...copy, ...files]
}

/** The path below the repo root, as a warning shows it; a path outside the root is shown whole. */
export function repoRelative(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

/**
 * The warning for a link path that holds a real file or folder, which a render keeps (Pitfall 2), naming the path as
 * `shown` gives it, cleaned as a report cell: a path already in the form a screen shows, such as a memory link's `~/`
 * display path, is named as it is and never made repo-relative (D-272, edge #28).
 */
export function notReplacedText(shown: string): string {
  return t('start.renderPlan.notReplacedWarning', { repoRelative: reportText(shown) })
}

/**
 * The warning for a planned link path that holds a real file or folder, which a render keeps (Pitfall 2): the raw path
 * named below the repo root (repoRelative, notReplacedText).
 */
export function notReplacedWarning(root: string, path: string): string {
  return notReplacedText(repoRelative(root, path))
}

/** The warning for an entry of a role's private instructions folder that is not a regular file, so not copied. */
export function privateSkippedWarning(id: string, name: string): string {
  return t('start.renderPlan.privateSkippedWarning', { role: reportText(id), name: reportText(name) })
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

function copyStep(source: string, path: string): RenderStep {
  return { kind: 'copy', source, path }
}

/** A step that writes a text to a path. */
function writeStep(path: string, text: string): RenderStep {
  return { kind: 'write', path, text }
}

/** A step that adds a text to the end of a path, creating it when absent and never truncating it. */
function appendStep(path: string, text: string): RenderStep {
  return { kind: 'append', path, text }
}

/** A step that moves a path to a target in the same folder. */
function moveStep(path: string, target: string): RenderStep {
  return { kind: 'move', path, target }
}

/**
 * The folders a render makes, sorted and once each: `.runtime`, its overlay and the private instructions copy, always,
 * and each link's folder.
 */
function mkdirFolders(runtime: string, links: readonly OverlayLink[]): string[] {
  const always = [runtime, `${runtime}/${OVERLAY_FOLDER}`, `${runtime}/${PRIVATE_INSTRUCTIONS_COPY}`]

  return sortedUnique([...always, ...links.map(link => parentOf(link.path))])
}

/**
 * The making of the role's private instructions folder in the config folder: one mkdir, so the folder a render copies
 * from is always there, empty when the role has no private part, then one chmod 700 per level of its role memory
 * folder from the top (roleFolderLevels), as apply makes them private.
 */
function privateFolderSteps(input: RenderInput): RenderStep[] {
  const chmods = roleFolderLevels(parentOf(input.privateSource)).map((path): RenderStep => ({ kind: 'chmod', path }))

  return [mkdirStep(input.privateSource), ...chmods]
}

/**
 * The refresh of the private instructions copy: its chmod 700, then the removal of each entry in it that is not a
 * real folder (a real folder there refuses the render), then a copy of each regular file of the private instructions
 * folder in name order, so a file removed there is gone from the copy and no copy writes through a link left in it.
 */
function privateCopySteps(input: RenderInput, runtime: string): RenderStep[] {
  const copy = privateInstructionsCopyOf(input.root, input.id)
  const removals = copyEntries(input, runtime)
    .filter(entry => entry.isLink || entry.kind !== 'dir')
    .map(entry => removeStep(`${copy}/${entry.name}`))
  const copies = sourceNames(input).map(name => copyStep(`${input.privateSource}/${name}`, `${copy}/${name}`))

  return [{ kind: 'chmod', path: copy }, ...removals, ...copies]
}

/** The making of the role's inbox folder in the config folder: its mkdir, then a chmod 700 per level from the top. */
function inboxFolderSteps(inboxDir: string): RenderStep[] {
  const chmods = inboxFolderLevels(inboxDir).map((path): RenderStep => ({ kind: 'chmod', path }))

  return [mkdirStep(inboxDir), ...chmods]
}

/** The removals of the inbox and session record of each real role folder an inbox home lists, in listing order. */
export function inboxClearSteps(home: string, entries: readonly PortEntry[]): RenderStep[] {
  return entries
    .filter(entry => entry.kind === 'dir' && !entry.isLink && isPlainName(entry.name) && isRoleId(entry.name))
    .flatMap(entry => [INBOX_LOG_FILE, SESSION_FILE].map(file => removeStep(`${home}/${entry.name}/${file}`)))
}

/**
 * The inbox's steps in fileWrites: the move and the fresh entry of a rotation, else the create when there is none, with
 * the epic's seed after a newline when the render has one.
 */
function inboxSteps(input: RenderInput, inbox: string): RenderStep[] {
  const { rotation, inboxSeed } = input
  if (rotation !== undefined) return [moveStep(inbox, rotation.archive), appendStep(inbox, `\n${rotation.text}`)]
  if (isRealEntry(statAt(input, inbox))) return []

  return [appendStep(inbox, inboxSeed === undefined ? '' : `\n${inboxSeed}`)]
}

/**
 * The writes before the stamp, in order: the settings as stable JSON, the MCP config, the probe expectations, the
 * steps of the inbox in the role's inbox folder, and for an epic render the epic kickoff, the step right before the
 * stamp. A rotation moves the inbox to its archive beside it, then appends the fresh entry after a newline, the framing
 * every append uses; with none, inbox.jsonl is created when there is none. Both are appends, which never truncate, so
 * an entry another role appended after the stat or the move is kept; an entry appended between the rotation's read and
 * the move stays in the archive, unlisted. An inbox that is a link refuses the render (refusalOf). An inbox.md of an
 * older setup is never written or removed.
 */
function fileWrites(input: RenderInput, runtime: string): RenderStep[] {
  const inbox = `${input.inboxDir}/${INBOX_LOG_FILE}`
  const writes = [
    writeStep(`${runtime}/${SETTINGS_FILE}`, stableJson(input.plan.settings)),
    writeStep(`${runtime}/${MCP_FILE}`, input.mcpText),
    writeStep(`${runtime}/${PROBE_EXPECTATIONS_FILE}`, input.expectationsText),
    ...inboxSteps(input, inbox),
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
 * The steps that render a role's `.runtime`, in order. An existing stamp is removed first, so a render that stops part
 * way never leaves the old stamp beside new files; then the DONE.md an earlier run left (doneMarkerRemovals). Then the
 * links of linkRemovals are removed, a link an older render left at the private instructions copy included; then
 * `.runtime`, its overlay, the private instructions copy and each link's folder are made, sorted and once each, then
 * the role's private instructions folder, each level of its role memory folder made mode 700 (privateFolderSteps), and
 * the role's inbox folder, each level made mode 700 (inboxFolderSteps); then each link is made, except at a path that
 * holds a real file or folder, which is kept and named in a warning (`ln -sfn` would link inside a folder or replace a
 * file); then the private instructions copy is refreshed (privateCopySteps); then the steps in the role memory folder
 * (memorySteps); then the files of fileWrites are written, and the stamp last. A render that stops at any step before
 * the last leaves no stamp, so the launcher refuses to start. After the warnings of the kept links, each entry of the
 * private instructions folder that is not a regular file is named in a warning and not copied. A render that
 * refusalOf refuses has no step and no warning.
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
    ...privateFolderSteps(input),
    ...inboxFolderSteps(input.inboxDir),
    ...links.map(linkStep),
    ...privateCopySteps(input, runtime),
    ...memorySteps(input.memories),
    ...fileWrites(input, runtime),
    writeStep(stamp, input.stampText),
  ]
  const warnings = [
    ...kept.map(link => notReplacedWarning(input.root, link.path)),
    ...skippedNames(input).map(name => privateSkippedWarning(input.id, name)),
  ]

  return { steps, warnings, refusal: null }
}

/** The text of the stamp a render writes last: the cadre version that rendered, on one line. */
export function stampText(cadreVersion: string): string {
  return fill(CONTRACTS.stamp, { version: cadreVersion })
}
