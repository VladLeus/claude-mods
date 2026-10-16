import type { EngineInterface, Register } from 'claude-code'

import type { GsdReadTarget, RawFacts, RawGsdCandidate, SettingsSource } from '../types'
import { helpText, parseCommand } from './command'
import {
  displayPath,
  factReadPlan,
  homeRootRefusal,
  MAX_READ_BYTES,
  normalizeFacts,
  parseRepoEntries,
  resolvedPath,
  runtimeBuiltPath,
  runtimeIdentityArgv,
  runtimeSkipProblem,
} from './facts'
import type { ProbedGsdCandidate, RuntimeProblem } from './facts'
import { detectText } from './render'

/** How long the user-level runtime identity call may run before it is given up. */
const IDENTITY_TIMEOUT_MS = 10_000
/** The settings sources, read one at a time so each value keeps the source it came from. */
const SETTINGS_SOURCES: readonly SettingsSource[] = ['user', 'project', 'local']

/** The root, the home folder and the warnings one detect run shares. The host is passed beside it, never inside it. */
type ReadContext = {
  readonly root: string
  readonly home: string | null
  readonly warnings: string[]
}

/** What the runtime identity call gave: its stdout when it exited 0, and `could-not-run` when it threw. */
type IdentityRun = {
  readonly stdout: string | null
  readonly problem: RuntimeProblem | null
}

/** The identity run of a call that was not made. */
const NO_RUN: IdentityRun = { stdout: null, problem: null }

/** The session root, the home folder and CLAUDE_CONFIG_DIR as the host resolved them, with their warnings. */
type Locations = {
  readonly root: string
  readonly home: string | null
  readonly configDir: string | null
  readonly warnings: readonly string[]
}

/** The home folder from HOME, kept only when it is an absolute path; any other value counts as no home. */
async function homeFolder($: EngineInterface): Promise<string | null> {
  const home = await $.env.get('HOME').catch(() => undefined)

  return typeof home === 'string' && home.startsWith('/') ? home : null
}

/** CLAUDE_CONFIG_DIR as the host gives it, or null when unset. factReadPlan decides whether it is usable. */
async function configDirOf($: EngineInterface): Promise<string | null> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)

  return typeof configDir === 'string' ? configDir : null
}

/**
 * One path as the host resolves it (D-39): where it lands when the host answers a realPath, else the path as given,
 * with the warning that it was used as given. A stat the host refuses counts as no realPath.
 */
async function resolvedOf($: EngineInterface, given: string, label: string, warnings: string[]): Promise<string> {
  const stat = await $.fs.stat(given, { resolve: true }).catch(() => undefined)
  const resolved = resolvedPath(given, stat?.realPath, label)
  if (resolved.warning !== null) warnings.push(resolved.warning)

  return resolved.path
}

/**
 * The session root, the home folder and CLAUDE_CONFIG_DIR as the host resolves them, before the home-folder check and
 * factReadPlan (D-39). HOME and CLAUDE_CONFIG_DIR are resolved only when they are absolute, so a relative value is
 * never stat'd against the working directory; factReadPlan rejects it with its own warning.
 */
async function locationsOf($: EngineInterface, sessionRoot: string): Promise<Locations> {
  const warnings: string[] = []
  const root = await resolvedOf($, sessionRoot, 'the repo root', warnings)
  const home = await homeFolder($)
  const resolvedHome = home === null ? null : await resolvedOf($, home, 'the home folder', warnings)
  const configDir = await configDirOf($)
  if (configDir === null || !configDir.startsWith('/')) {
    return { root, home: resolvedHome, configDir, warnings }
  }
  const resolvedConfigDir = await resolvedOf($, configDir, 'CLAUDE_CONFIG_DIR', warnings)

  return { root, home: resolvedHome, configDir: resolvedConfigDir, warnings }
}

/**
 * A text file's contents, or null. A missing file gives null quietly. A probe that fails counts as present, so the
 * read is still tried. A read that fails or answers a non-string, or a file over MAX_READ_BYTES, adds a warning and
 * gives null.
 */
async function readText($: EngineInterface, read: ReadContext, path: string): Promise<string | null> {
  const isThere = await $.fs.exists(path).catch(() => true)
  if (!isThere) return null
  const text = await $.fs.read(path).catch(() => null)
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_READ_BYTES) {
    read.warnings.push(`could not read ${displayPath(path, read.home, read.root)} (treated as unknown)`)

    return null
  }

  return text
}

/**
 * A JSON file's parsed value, or null. A missing file gives null quietly; a file that does not parse adds a warning.
 */
async function readJson($: EngineInterface, read: ReadContext, path: string): Promise<unknown> {
  const text = await readText($, read, path)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    read.warnings.push(`could not parse ${displayPath(path, read.home, read.root)} as JSON (treated as unknown)`)

    return null
  }
}

/** A folder's listing as the host sent it, or null with the given warning when the listing fails. */
async function listFolder($: EngineInterface, read: ReadContext, path: string, failure: string): Promise<unknown> {
  return $.fs.list(path).catch(() => {
    read.warnings.push(failure)

    return null
  })
}

/** Whether the repo root lists `docs` as a folder or as a symlink, the same rule that finds `.planning`. */
function hasDocsFolder(repoEntries: unknown): boolean {
  return parseRepoEntries(repoEntries).some(entry => entry.name === 'docs' && (entry.kind === 'dir' || entry.isLink))
}

/** Each settings source that can be read, in override order; a source that cannot be read adds a warning. */
async function settingsOf($: EngineInterface, read: ReadContext): Promise<RawFacts['settings']> {
  const found: { source: SettingsSource; value: unknown }[] = []
  for (const source of SETTINGS_SOURCES) {
    const value = await $.settings.read({ source }).catch(() => null)
    if (value === null) {
      read.warnings.push(`could not read ${source} settings (treated as unknown)`)
      continue
    }
    found.push({ source, value })
  }

  return found
}

/**
 * The runtime identity call, run with the GSD folder as its working folder so it never runs in the repo (WR-01). A
 * non-zero exit gives no stdout and no problem. Any throw (node missing, a timeout, a refusal) gives `could-not-run`;
 * the error itself is never read (IN-05).
 */
async function identityRun($: EngineInterface, argv: readonly string[], cwd: string): Promise<IdentityRun> {
  try {
    const result = await $.process.run(argv, { cwd, timeoutMs: IDENTITY_TIMEOUT_MS })

    return { stdout: result.exitCode === 0 ? result.stdout : null, problem: null }
  } catch {
    return { stdout: null, problem: 'could-not-run' }
  }
}

/**
 * One GSD candidate as the host reads it: its folder, its three static files, and the runtime identity stdout when
 * runtimeIdentityArgv allows the call, which is the user-level install with a built runtime only (D-28, WR-01).
 */
async function gsdCandidateOf(
  $: EngineInterface,
  read: ReadContext,
  target: GsdReadTarget,
): Promise<ProbedGsdCandidate> {
  const isPresent = await $.fs.exists(target.dir).catch(() => true)
  const versionText = await readText($, read, target.versionPath)
  const identityText = await readText($, read, target.identityPath)
  const manifest = await readJson($, read, target.manifestPath)
  const isBuilt = await $.fs.exists(runtimeBuiltPath(target)).catch(() => false)
  const argv = runtimeIdentityArgv(target, identityText, isPresent, isBuilt)
  const run = argv === null ? NO_RUN : await identityRun($, argv, target.dir)

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

/**
 * The host reads for one repo root, in the order factReadPlan names them, and nothing else. The locations arrive
 * resolved and already past the home-folder refusal. A read that fails is recorded as a warning, never thrown.
 */
async function collectFacts($: EngineInterface, locations: Locations): Promise<RawFacts> {
  const { root, home } = locations
  const plan = factReadPlan({ root, home, configDir: locations.configDir })
  const read: ReadContext = { root, home, warnings: [...locations.warnings, ...plan.warnings] }
  const repoEntries = await listFolder($, read, root, 'could not list the repo root (treated as unknown)')
  const docsEntries = hasDocsFolder(repoEntries)
    ? await listFolder($, read, `${root}/docs`, 'could not list docs/ (treated as unknown)')
    : []
  const settings = await settingsOf($, read)
  const installedPlugins =
    plan.installedPluginsPath === null ? null : await readJson($, read, plan.installedPluginsPath)
  const gsd: RawGsdCandidate[] = []
  for (const target of plan.gsd) {
    gsd.push(await gsdCandidateOf($, read, target))
  }

  return { root, home, repoEntries, docsEntries, settings, installedPlugins, gsd, warnings: read.warnings }
}

/** The raw facts of a session whose root cannot be read: nothing is read, and the report says so. */
function rootUnknownFacts(): RawFacts {
  return {
    root: '',
    home: null,
    repoEntries: null,
    docsEntries: null,
    settings: [],
    installedPlugins: null,
    gsd: [],
    warnings: ['could not read the session root (treated as unknown)'],
  }
}

/**
 * The `/cadre detect` reply. The locations are resolved first (D-39), then the home-folder refusal runs before any
 * listing, read, settings or process call (D-36).
 */
async function detectReply($: EngineInterface, isAdapters: boolean): Promise<string> {
  const sessionRoot = await $.session.root().catch(() => null)
  if (sessionRoot === null) return detectText(normalizeFacts(rootUnknownFacts()), isAdapters)
  const locations = await locationsOf($, sessionRoot)
  const refusal = homeRootRefusal(locations.root, locations.home)
  if (refusal !== null) return refusal

  return detectText(normalizeFacts(await collectFacts($, locations)), isAdapters)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cadre',
      description: 'Detect which dev framework this repo uses (read-only)',
      argumentHint: 'detect [--adapters]',
    })

    return next(e)
  })

  on('command.run', { command: 'cadre' }, async ($, e) => {
    const command = parseCommand(e.args)
    if (command.kind === 'help') return { text: helpText(command.unknown) }

    return { text: await detectReply($, command.adapters) }
  })
}
