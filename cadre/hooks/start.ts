/**
 * The render half of /cadre start (D-102): the ordered steps that write a role's per-launch files into
 * `.cadre/<id>/.runtime/`, from its LaunchPlan (D-98) and the texts of its MCP config and probe expectations. It reads
 * and writes nothing: /cadre start stats and lists the paths renderPaths names, then runs the steps renderSteps gives,
 * in order, through the host. The stamp is always the last step, and the launcher trusts it: it refuses to start when
 * the stamp is missing or older than the role files or a rendered file, so a render that stops part way never starts a
 * session (LNCH-03).
 */
import type { PortEntry, PortStat } from '../types'
import { sortedUnique } from './facts'
import type { LaunchPlan, OverlayLink } from './launch'
import { INBOX_FILE, PROBE_EXPECTATIONS_FILE, RUNTIME_STAMP_FILE, stableJson } from './plan'

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
 * instructions. /cadre start lists each of them, so a link an earlier render made there, which the plan no longer
 * names, is removed.
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
 * Every folder a render makes or links into, sorted and once each: `.runtime`, its overlay, and each folder from
 * `.runtime` down to a link.
 */
function renderFolders(runtime: string, links: readonly OverlayLink[]): string[] {
  const linkFolders = links.flatMap(link => foldersTo(runtime, link.path))

  return sortedUnique([runtime, `${runtime}/${OVERLAY_FOLDER}`, ...linkFolders])
}

/**
 * The paths /cadre start stats and lists before a render, so renderSteps can judge each one. `stats` holds, sorted
 * and once each, the role folder, `.runtime`, its overlay, every folder from `.runtime` down to a link, every link path
 * and the five files a render writes; `listings` holds the STALE_LINK_FOLDERS under `.runtime`.
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

/** A step that makes a folder. */
function mkdirStep(path: string): RenderStep {
  return { kind: 'mkdir', path }
}

/** A step that writes a text to a path. */
function writeStep(path: string, text: string): RenderStep {
  return { kind: 'write', path, text }
}

/** The folders a render makes, sorted and once each: `.runtime` and its overlay, always (D-102). */
function mkdirFolders(runtime: string): string[] {
  return sortedUnique([runtime, `${runtime}/${OVERLAY_FOLDER}`])
}

/**
 * The writes before the stamp, in order: the settings as stable JSON, the MCP config, the probe expectations, and an
 * empty inbox only when there is none, so a note another role left there is never lost (D-114, Pitfall 3).
 */
function fileWrites(input: RenderInput, runtime: string): RenderStep[] {
  const inbox = `${runtime}/${INBOX_FILE}`
  const writes = [
    writeStep(`${runtime}/${SETTINGS_FILE}`, stableJson(input.plan.settings)),
    writeStep(`${runtime}/${MCP_FILE}`, input.mcpText),
    writeStep(`${runtime}/${PROBE_EXPECTATIONS_FILE}`, input.expectationsText),
  ]
  if (statAt(input, inbox) !== null) return writes

  return [...writes, writeStep(inbox, '')]
}

/**
 * The steps that render a role's `.runtime` (D-102), in order: `.runtime` and its overlay are made, then the files are
 * written (fileWrites), and the stamp is written last, so a render that stops at any step before it leaves no fresh
 * stamp and the launcher refuses to start (LNCH-03).
 */
export function renderSteps(input: RenderInput): RenderResult {
  const runtime = runtimeFolder(input.root, input.id)
  const steps: RenderStep[] = [
    ...mkdirFolders(runtime).map(mkdirStep),
    ...fileWrites(input, runtime),
    writeStep(`${runtime}/${RUNTIME_STAMP_FILE}`, input.stampText),
  ]

  return { steps, warnings: [], refusal: null }
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
