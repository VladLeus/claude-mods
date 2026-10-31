/**
 * The facts collector, a layer 3 module: the locations one run starts from, the host reads for one repo root in the
 * order factReadPlan names them, and the raw facts of a root that cannot be read. Every read goes through the
 * FactsPort register.tsx builds, so this module never sees the host, and the one process call it may ask for is the
 * gated runtime identity call (MUST 18, D-28, WR-01). It imports core, GSD's identity, paths, the other facts modules
 * and the types, so register.tsx collects the detect facts here.
 */
import type {
  FactsPort,
  GsdReadTarget,
  IdentityRunResult,
  InitLocations,
  RawFacts,
  RawGsdCandidate,
  SettingsSource,
} from '../../../types'
import { utf8Bytes } from '../../core/text'
import { runtimeBuiltPath, runtimeIdentityArgv, runtimeSkipProblem } from '../../framework/gsd/identity'
import type { ProbedGsdCandidate } from '../../framework/gsd/identity'
import { t } from '../../locales/t'
import { displayPath, HOME_UNUSABLE_WARNING, isFileInsideRoot, resolvedPath } from '../../paths'
import { MAX_READ_BYTES, parseRepoEntries } from './normalize'
import { factReadPlan } from './plan'

/** The settings sources, read one at a time so each value keeps the source it came from. */
const SETTINGS_SOURCES: readonly SettingsSource[] = ['user', 'project', 'local']

/**
 * The root, the home folder, CLAUDE_CONFIG_DIR and the warnings one detect run shares. The host is passed beside it,
 * never inside it.
 */
type ReadContext = {
  readonly root: string
  readonly home: string | null
  readonly configDir: string | null
  readonly warnings: string[]
}

/** The identity run of a call that was not made. */
const NO_RUN: IdentityRunResult = { stdout: null, problem: null }

/** The home folder from HOME, kept only when it is an absolute path; any other value counts as no home. */
async function homeFolder(port: FactsPort): Promise<string | null> {
  const home = await port.env('HOME')

  return typeof home === 'string' && home.startsWith('/') ? home : null
}

/** CLAUDE_CONFIG_DIR as the host gives it, or null when unset. factReadPlan decides whether it is usable. */
async function configDirOf(port: FactsPort): Promise<string | null> {
  const configDir = await port.env('CLAUDE_CONFIG_DIR')

  return typeof configDir === 'string' ? configDir : null
}

/**
 * One path as the host resolves it (D-39): where it lands when the host answers a realPath, else the path as given,
 * with the warning that it was used as given. A stat the host refuses counts as no realPath.
 */
async function resolvedOf(port: FactsPort, given: string, label: string, warnings: string[]): Promise<string> {
  const stat = await port.stat(given)
  const resolved = resolvedPath(given, stat?.realPath, label)
  if (resolved.warning !== null) warnings.push(resolved.warning)

  return resolved.path
}

/**
 * The session root, the home folder and CLAUDE_CONFIG_DIR as the host resolves them, before the home-folder check and
 * factReadPlan (D-39). HOME and CLAUDE_CONFIG_DIR are resolved only when they are absolute, so a relative value is
 * never stat'd against the working directory; factReadPlan rejects it with its own warning.
 */
export async function locationsOf(port: FactsPort, sessionRoot: string): Promise<InitLocations> {
  const warnings: string[] = []
  const root = await resolvedOf(port, sessionRoot, t('scan.facts.collect.locationsOf'), warnings)
  const home = await homeFolder(port)
  if (home === null) warnings.push(HOME_UNUSABLE_WARNING)
  const homeLabel = t('scan.facts.collect.locationsOf2')
  const resolvedHome = home === null ? null : await resolvedOf(port, home, homeLabel, warnings)
  const given = { givenRoot: sessionRoot, givenHome: home }
  const configDir = await configDirOf(port)
  if (configDir === null || !configDir.startsWith('/')) {
    return { root, home: resolvedHome, configDir, ...given, warnings }
  }
  const resolvedConfigDir = await resolvedOf(port, configDir, 'CLAUDE_CONFIG_DIR', warnings)

  return { root, home: resolvedHome, configDir: resolvedConfigDir, ...given, warnings }
}

/** A path as the report shows it, for the warnings of this detect run (IN-03). */
function warningPath(read: ReadContext, path: string): string {
  return displayPath(path, read.home, read.root, read.configDir)
}

/**
 * Whether a repo file may be read: its stat, asked with `resolve`, shows a regular file whose real path is inside the
 * resolved root (WR-02). A stat the host refuses counts as no.
 */
async function isSafeRepoFile(port: FactsPort, read: ReadContext, path: string): Promise<boolean> {
  const stat = await port.stat(path)

  return isFileInsideRoot(stat, read.root)
}

/**
 * A text file's contents, or null. A missing file gives null quietly. A probe that fails counts as present, so the
 * read is still tried. A repo file (`isRepoFile`) that is not a regular file inside the repo is skipped with a warning
 * and never read (WR-02). A read that fails or answers a non-string, or a file over MAX_READ_BYTES, adds a warning and
 * gives null.
 */
async function readText(
  port: FactsPort,
  read: ReadContext,
  path: string,
  isRepoFile: boolean,
): Promise<string | null> {
  const isThere = (await port.exists(path)) ?? true
  if (!isThere) return null
  if (isRepoFile && !(await isSafeRepoFile(port, read, path))) {
    read.warnings.push(t('scan.unknown', { what: t('scan.notRegularFile', { what: warningPath(read, path) }) }))

    return null
  }
  const text = await port.read(path)
  if (typeof text !== 'string' || utf8Bytes(text) > MAX_READ_BYTES) {
    read.warnings.push(t('scan.unknown', { what: t('scan.couldNotRead', { what: warningPath(read, path) }) }))

    return null
  }

  return text
}

/**
 * A JSON file's parsed value, or null. A missing file gives null quietly; a file that does not parse adds a warning.
 * A repo file follows the readText rule (WR-02).
 */
async function readJson(port: FactsPort, read: ReadContext, path: string, isRepoFile: boolean): Promise<unknown> {
  const text = await readText(port, read, path, isRepoFile)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    read.warnings.push(t('scan.unknown', { what: t('scan.couldNotParse', { what: warningPath(read, path) }) }))

    return null
  }
}

/** A folder's listing as the host sent it, or null with the given warning when the listing fails. */
async function listFolder(port: FactsPort, read: ReadContext, path: string, failure: string): Promise<unknown> {
  const listing = await port.list(path)
  if (listing === null) read.warnings.push(failure)

  return listing
}

/** Whether the repo root lists `docs` as a folder or as a symlink, the same rule that finds `.planning`. */
function hasDocsFolder(repoEntries: unknown): boolean {
  return parseRepoEntries(repoEntries).some(entry => entry.name === 'docs' && (entry.kind === 'dir' || entry.isLink))
}

/** Each settings source that can be read, in override order; a source that cannot be read adds a warning. */
async function settingsOf(port: FactsPort, read: ReadContext): Promise<RawFacts['settings']> {
  const found: { source: SettingsSource; value: unknown }[] = []
  for (const source of SETTINGS_SOURCES) {
    const value = await port.settings(source)
    if (value === null) {
      read.warnings.push(t('scan.unknown', { what: t('scan.couldNotReadSettings', { source: source }) }))
      continue
    }
    found.push({ source, value })
  }

  return found
}

/**
 * One GSD candidate as the host reads it: its folder, its three static files, and the runtime identity stdout when
 * runtimeIdentityArgv allows the call, which is the user-level install with a built runtime only (D-28, WR-01). The
 * repo-local candidate's files are read only as regular files inside the repo (WR-02).
 */
async function gsdCandidateOf(
  port: FactsPort,
  read: ReadContext,
  target: GsdReadTarget,
): Promise<ProbedGsdCandidate> {
  const isRepoFile = target.location === 'project'
  const isUser = target.location === 'user'
  const isPresent = (await port.exists(target.dir)) ?? true
  const versionText = await readText(port, read, target.versionPath, isRepoFile)
  const identityText = await readText(port, read, target.identityPath, isRepoFile)
  const manifest = await readJson(port, read, target.manifestPath, isRepoFile)
  // The built probe fails closed (a refusal means not built), the present probe above fails open; both on purpose.
  const isBuilt = isUser && ((await port.exists(runtimeBuiltPath(target))) ?? false)
  const argv = runtimeIdentityArgv(target, identityText, isPresent, isBuilt)
  const run = argv === null ? NO_RUN : await port.runIdentity(argv, target.dir)

  return {
    location: target.location,
    dir: target.dir,
    isPresent,
    versionText,
    identityText,
    manifest,
    runtimeStdout: run.stdout,
    runtimeTried: argv !== null,
    runtimeProblem: runtimeSkipProblem(target, identityText, isPresent, isBuilt) ?? run.problem,
  }
}

/** What one collect run gave: the raw facts and the user-level GSD folder from the plan the reads followed. */
export type Collected = {
  readonly raw: RawFacts
  readonly gsdUserDir: string | null
}

/**
 * The host reads for one repo root, in the order factReadPlan names them, and nothing else. The locations arrive
 * resolved and already past the home-folder refusal. A read that fails is recorded as a warning, never thrown. The
 * user-level GSD folder comes back beside the facts so no caller plans the reads a second time.
 */
export async function collectFacts(port: FactsPort, locations: InitLocations): Promise<Collected> {
  const { root, home, configDir } = locations
  const plan = factReadPlan({ root, home, configDir })
  const read: ReadContext = { root, home, configDir, warnings: [...locations.warnings, ...plan.warnings] }
  const repoEntries = await listFolder(port, read, root, t('scan.unknown', { what: t('scan.repoRootUnlisted') }))
  const docsEntries = hasDocsFolder(repoEntries)
    ? await listFolder(port, read, `${root}/docs`, t('scan.unknown', { what: t('scan.docsUnlisted') }))
    : []
  const settings = await settingsOf(port, read)
  const installedPlugins =
    plan.installedPluginsPath === null ? null : await readJson(port, read, plan.installedPluginsPath, false)
  const gsd: RawGsdCandidate[] = []
  for (const target of plan.gsd) {
    gsd.push(await gsdCandidateOf(port, read, target))
  }

  const raw = { root, home, repoEntries, docsEntries, settings, installedPlugins, gsd, warnings: read.warnings }

  return { raw, gsdUserDir: plan.gsd.find(target => target.location === 'user')?.dir ?? null }
}

/** The raw facts of a session whose root cannot be read: nothing is read, and the report says so. */
export function rootUnknownFacts(): RawFacts {
  return {
    root: '',
    home: null,
    repoEntries: null,
    docsEntries: null,
    settings: [],
    installedPlugins: null,
    gsd: [],
    warnings: [t('scan.unknown', { what: t('scan.sessionRootUnread') })],
  }
}
