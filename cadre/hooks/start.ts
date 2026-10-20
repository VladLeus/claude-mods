/**
 * The render half of /cadre start (D-102): the ordered steps that write a role's per-launch files into
 * `.cadre/<id>/.runtime/`, from its LaunchPlan (D-98) and the texts of its MCP config and probe expectations. It reads
 * and writes nothing: /cadre start stats and lists the paths renderPaths names, then runs the steps renderSteps gives,
 * in order, through the host. The stamp is always the last step, and the launcher trusts it: it refuses to start when
 * the stamp is missing or older than the role files or a rendered file, so a render that stops part way never starts a
 * session (LNCH-03).
 */
import type { PortEntry, PortStat } from '../types'
import { isDirInsideRoot, sortedUnique } from './facts'
import type { LaunchPlan, OverlayLink } from './launch'
import { INBOX_FILE, PROBE_EXPECTATIONS_FILE, RUNTIME_STAMP_FILE, stableJson } from './plan'
import { reportText } from './render'

/** The name of the rendered runtime settings in `.runtime` (D-84). */
const SETTINGS_FILE = 'settings.json'

/** The name of the rendered MCP config in `.runtime` (D-93). */
const MCP_FILE = 'mcp.json'

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
 * - `remove`: remove a link, or the stamp of an earlier render (`/bin/rm -f`);
 * - `mkdir`: make a folder and the folders above it (`/bin/mkdir -p`);
 * - `link`: make `path` a symbolic link to `target` (`/bin/ln -sfn`);
 * - `write`: write the text to the path; the host writes it, so it has no argv.
 */
export type RenderStep =
  | { readonly kind: 'remove'; readonly path: string }
  | { readonly kind: 'mkdir'; readonly path: string }
  | { readonly kind: 'link'; readonly path: string; readonly target: string }
  | { readonly kind: 'write'; readonly path: string; readonly text: string }

/**
 * What renderSteps plans from: the repo root as a realpath and the role id; the role's LaunchPlan, whose links all lie
 * under the role's `.runtime`, as launchPlan makes them; the texts of `mcp.json`, `probe-expectations.json` and the
 * stamp; and the disk. `stats` holds the stat of each path renderPaths names, asked with resolve, and `listings` the
 * listing of each folder it names. A path with no stat counts as not there, and a folder with no listing as empty.
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
 * folder or to a link, every link path and the five files a render writes; `listings` holds the STALE_LINK_FOLDERS
 * under `.runtime`.
 */
export function renderPaths(
  root: string,
  id: string,
  plan: LaunchPlan,
): { readonly stats: readonly string[]; readonly listings: readonly string[] } {
  const runtime = runtimeFolder(root, id)
  const stats = sortedUnique([
    roleFolder(root, id),
    ...renderFolders(runtime, plan.links),
    ...plan.links.map(link => link.path),
    ...WRITTEN_FILES.map(name => `${runtime}/${name}`),
  ])

  return { stats, listings: STALE_LINK_FOLDERS.map(folder => `${runtime}/${folder}`) }
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
 * Anything else would let a step write, link or remove through a link, or write onto a folder.
 */
function refusalOf(input: RenderInput, runtime: string): string | null {
  const role = statAt(input, roleFolder(input.root, input.id))
  if (role === null || role.isLink || !isDirInsideRoot(role, input.root)) return roleFolderRefusal(input.id)
  const folders = renderFolders(runtime, input.plan.links).map(path => statAt(input, path))
  const files = WRITTEN_FILES.map(name => statAt(input, `${runtime}/${name}`))
  if (folders.some(isUnsafeFolder) || files.some(isUnsafeFile)) return runtimeRefusal(input.id)

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
  const files = WRITTEN_FILES.filter(name => name !== RUNTIME_STAMP_FILE).map(name => `${runtime}/${name}`)
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
 * The writes before the stamp, in order: the settings as stable JSON, the MCP config, the probe expectations, and an
 * empty inbox only when there is none, so a note another role left there is never lost (D-114, Pitfall 3). An inbox
 * that is a link is removed first (linkRemovals), so it counts as none.
 */
function fileWrites(input: RenderInput, runtime: string): RenderStep[] {
  const inbox = `${runtime}/${INBOX_FILE}`
  const writes = [
    writeStep(`${runtime}/${SETTINGS_FILE}`, stableJson(input.plan.settings)),
    writeStep(`${runtime}/${MCP_FILE}`, input.mcpText),
    writeStep(`${runtime}/${PROBE_EXPECTATIONS_FILE}`, input.expectationsText),
  ]
  if (isRealEntry(statAt(input, inbox))) return writes

  return [...writes, writeStep(inbox, '')]
}

/**
 * The steps that render a role's `.runtime` (D-102), in order. An existing stamp is removed first, so a render that
 * stops part way never leaves the old stamp beside new files. Then the links of linkRemovals are removed; then
 * `.runtime`, its overlay and each link's folder are made, sorted and once each; then each link is made, except at a
 * path that holds a real file or folder, which is kept and named in a warning (Pitfall 2: `ln -sfn` would link inside
 * a folder or replace a file); then the files of fileWrites are written, and the stamp last. A render that stops at any
 * step before the last leaves no stamp, so the launcher refuses to start (LNCH-03). A render that refusalOf refuses
 * has no step at all.
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
    ...linkRemovals(input, runtime).map(removeStep),
    ...mkdirFolders(runtime, input.plan.links).map(mkdirStep),
    ...links.map(linkStep),
    ...fileWrites(input, runtime),
    writeStep(stamp, input.stampText),
  ]

  return { steps, warnings: kept.map(link => notReplacedWarning(input.root, link.path)), refusal: null }
}

/**
 * The argv that runs a step, absolute and with no shell (RESEARCH 3.2): `/bin/rm -f --` for a removal, never `-r`;
 * `/bin/mkdir -p --` for a folder; `/bin/ln -sfn <target> <path>` for a link. A write has none: the host writes it.
 */
export function renderArgv(step: RenderStep): readonly string[] | null {
  if (step.kind === 'remove') return ['/bin/rm', '-f', '--', step.path]
  if (step.kind === 'mkdir') return ['/bin/mkdir', '-p', '--', step.path]
  if (step.kind === 'link') return ['/bin/ln', '-sfn', step.target, step.path]

  return null
}

/** The text of the stamp a render writes last: the cadre version that rendered, on one line. */
export function stampText(cadreVersion: string): string {
  return `rendered by cadre ${cadreVersion}\n`
}
