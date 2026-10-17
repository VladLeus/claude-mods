import type { EngineInterface, Register } from 'claude-code'

import type {
  GsdReadTarget,
  InitIo,
  InitLocations,
  PortRead,
  RawFacts,
  RawGsdCandidate,
  SettingsSource,
} from '../types'
import { helpText, parseCommand } from './command'
import {
  detectRefusal,
  displayPath,
  factReadPlan,
  HOME_UNUSABLE_WARNING,
  isFileInsideRoot,
  MAX_READ_BYTES,
  normalizeFacts,
  parseRepoEntries,
  resolvedPath,
  runtimeBuiltPath,
  runtimeIdentityArgv,
  runtimeSkipProblem,
  utf8Bytes,
} from './facts'
import type { ProbedGsdCandidate, RuntimeProblem } from './facts'
import { pluginVersionOf, portProbeOf, portTextOf, runInit } from './init'
import { detectText } from './render'

/** How long the user-level runtime identity call may run before it is given up. */
const IDENTITY_TIMEOUT_MS = 10_000
/** The most tokens one model completion for init may answer with (D-83). */
const COMPLETE_MAX_TOKENS = 2048
/** How long one model completion for init may take before it is given up (D-83). */
const COMPLETE_TIMEOUT_MS = 60_000
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

/** What the runtime identity call gave: its stdout when it exited 0, and `could-not-run` when it threw. */
type IdentityRun = {
  readonly stdout: string | null
  readonly problem: RuntimeProblem | null
}

/** The identity run of a call that was not made. */
const NO_RUN: IdentityRun = { stdout: null, problem: null }

/**
 * The session root, the home folder and CLAUDE_CONFIG_DIR as the host resolved them, with their warnings, plus the
 * root and home as given, which the refusal checks too (WR-06). It is the InitLocations init works with.
 */
type Locations = InitLocations

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
  if (home === null) warnings.push(HOME_UNUSABLE_WARNING)
  const resolvedHome = home === null ? null : await resolvedOf($, home, 'the home folder', warnings)
  const given = { givenRoot: sessionRoot, givenHome: home }
  const configDir = await configDirOf($)
  if (configDir === null || !configDir.startsWith('/')) {
    return { root, home: resolvedHome, configDir, ...given, warnings }
  }
  const resolvedConfigDir = await resolvedOf($, configDir, 'CLAUDE_CONFIG_DIR', warnings)

  return { root, home: resolvedHome, configDir: resolvedConfigDir, ...given, warnings }
}

/** A path as the report shows it, for the warnings of this detect run (IN-03). */
function shown(read: ReadContext, path: string): string {
  return displayPath(path, read.home, read.root, read.configDir)
}

/**
 * Whether a repo file may be read: its stat, asked with `resolve`, shows a regular file whose real path is inside the
 * resolved root (WR-02). A stat the host refuses counts as no.
 */
async function isSafeRepoFile($: EngineInterface, read: ReadContext, path: string): Promise<boolean> {
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)

  return isFileInsideRoot(stat, read.root)
}

/**
 * A text file's contents, or null. A missing file gives null quietly. A probe that fails counts as present, so the
 * read is still tried. A repo file (`isRepoFile`) that is not a regular file inside the repo is skipped with a warning
 * and never read (WR-02). A read that fails or answers a non-string, or a file over MAX_READ_BYTES, adds a warning and
 * gives null.
 */
async function readText(
  $: EngineInterface,
  read: ReadContext,
  path: string,
  isRepoFile: boolean,
): Promise<string | null> {
  const isThere = await $.fs.exists(path).catch(() => true)
  if (!isThere) return null
  if (isRepoFile && !(await isSafeRepoFile($, read, path))) {
    read.warnings.push(`skipped ${shown(read, path)}: not a regular file inside the repo (treated as unknown)`)

    return null
  }
  const text = await $.fs.read(path).catch(() => null)
  if (typeof text !== 'string' || utf8Bytes(text) > MAX_READ_BYTES) {
    read.warnings.push(`could not read ${shown(read, path)} (treated as unknown)`)

    return null
  }

  return text
}

/**
 * A JSON file's parsed value, or null. A missing file gives null quietly; a file that does not parse adds a warning.
 * A repo file follows the readText rule (WR-02).
 */
async function readJson($: EngineInterface, read: ReadContext, path: string, isRepoFile: boolean): Promise<unknown> {
  const text = await readText($, read, path, isRepoFile)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    read.warnings.push(`could not parse ${shown(read, path)} as JSON (treated as unknown)`)

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
 * runtimeIdentityArgv allows the call, which is the user-level install with a built runtime only (D-28, WR-01). The
 * repo-local candidate's files are read only as regular files inside the repo (WR-02).
 */
async function gsdCandidateOf(
  $: EngineInterface,
  read: ReadContext,
  target: GsdReadTarget,
): Promise<ProbedGsdCandidate> {
  const isRepoFile = target.location === 'project'
  const isUser = target.location === 'user'
  const isPresent = await $.fs.exists(target.dir).catch(() => true)
  const versionText = await readText($, read, target.versionPath, isRepoFile)
  const identityText = await readText($, read, target.identityPath, isRepoFile)
  const manifest = await readJson($, read, target.manifestPath, isRepoFile)
  // The built probe fails closed (a refusal means not built), the present probe above fails open; both on purpose.
  const isBuilt = isUser && (await $.fs.exists(runtimeBuiltPath(target)).catch(() => false))
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

/** What one collect run gave: the raw facts and the user-level GSD folder from the plan the reads followed. */
type Collected = {
  readonly raw: RawFacts
  readonly gsdUserDir: string | null
}

/**
 * The host reads for one repo root, in the order factReadPlan names them, and nothing else. The locations arrive
 * resolved and already past the home-folder refusal. A read that fails is recorded as a warning, never thrown. The
 * user-level GSD folder comes back beside the facts so no caller plans the reads a second time.
 */
async function collectFacts($: EngineInterface, locations: Locations): Promise<Collected> {
  const { root, home, configDir } = locations
  const plan = factReadPlan({ root, home, configDir })
  const read: ReadContext = { root, home, configDir, warnings: [...locations.warnings, ...plan.warnings] }
  const repoEntries = await listFolder($, read, root, 'could not list the repo root (treated as unknown)')
  const docsEntries = hasDocsFolder(repoEntries)
    ? await listFolder($, read, `${root}/docs`, 'could not list docs/ (treated as unknown)')
    : []
  const settings = await settingsOf($, read)
  const installedPlugins =
    plan.installedPluginsPath === null ? null : await readJson($, read, plan.installedPluginsPath, false)
  const gsd: RawGsdCandidate[] = []
  for (const target of plan.gsd) {
    gsd.push(await gsdCandidateOf($, read, target))
  }

  const raw = { root, home, repoEntries, docsEntries, settings, installedPlugins, gsd, warnings: read.warnings }

  return { raw, gsdUserDir: plan.gsd.find(target => target.location === 'user')?.dir ?? null }
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
 * The `/cadre detect` reply. The locations are resolved first (D-39), then the refusal runs before any listing, read,
 * settings or process call (D-36): the file system root is always refused, and every root form, as given and as
 * resolved, is checked against every home form (WR-06).
 */
async function detectReply($: EngineInterface, isAdapters: boolean): Promise<string> {
  const sessionRoot = await $.session.root().catch(() => null)
  if (sessionRoot === null) {
    const unknown = rootUnknownFacts()

    return detectText(normalizeFacts(unknown, null, unknown.root), isAdapters)
  }
  const locations = await locationsOf($, sessionRoot)
  const refusal = detectRefusal([locations.givenRoot, locations.root], [locations.givenHome, locations.home])
  if (refusal !== null) return refusal

  const { raw } = await collectFacts($, locations)

  return detectText(normalizeFacts(raw, locations.configDir, locations.givenRoot), isAdapters)
}

/**
 * A file as the init port reads it (Pitfall 6). A file is read only when the host says the path is there and its stat
 * shows a regular file within `maxBytes`: a failed probe, a failed stat or a folder, FIFO or
 * device is `unknown` and never read. A read that fails is `unknown`; the text is checked again by its UTF-8 bytes.
 * The decisions are portProbeOf and portTextOf; this only asks the host.
 */
async function portRead($: EngineInterface, path: string, maxBytes: number): Promise<PortRead> {
  const isThere = await $.fs.exists(path).catch(() => null)
  const stat = isThere === true ? await $.fs.stat(path).catch(() => null) : null
  const before = portProbeOf(isThere, stat, maxBytes)
  if (before !== null) return before

  return portTextOf(await $.fs.read(path).catch(() => null), maxBytes)
}

/**
 * The port one init run goes through (P8): plain closures over `$`, built here because `$` cannot cross into another
 * file, so the pure modules never see it. Every member except `ask` turns a host failure into null or unknown, never
 * into absent, and none reads an error message. `ask` rejects when the person dismisses the dialog (D-45).
 */
function initIoOf($: EngineInterface): InitIo {
  return {
    ask: (question, spec) => $.ui.ask(question, spec),
    log: text => $.ui.log(text),
    complete: async (prompt, system) => {
      const model = await $.session.model().catch(() => null)
      if (model === null) return null
      const result = await $.model
        .complete({
          model,
          prompt,
          system,
          maxTokens: COMPLETE_MAX_TOKENS,
          timeoutMs: COMPLETE_TIMEOUT_MS,
          effort: 'low',
        })
        .catch(() => null)

      return result !== null && result.isAnswered ? result.text : null
    },
    isInteractive: async () => {
      const surfaces = await $.session.surfaces().catch(() => null)

      return surfaces === null ? null : surfaces.length > 0
    },
    locations: async () => {
      const root = await $.session.root().catch(() => null)

      return root === null ? null : locationsOf($, root)
    },
    facts: async locations => {
      const { raw, gsdUserDir } = await collectFacts($, locations)

      return { facts: normalizeFacts(raw, locations.configDir, locations.givenRoot), gsdUserDir }
    },
    sessionId: () => $.session.id().catch(() => null),
    now: () => $.clock.now().catch(() => null),
    cadreVersion: async () => {
      const text = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => null)

      return typeof text === 'string' ? pluginVersionOf(text) : null
    },
    list: path => $.fs.list(path).catch(() => null),
    stat: path => $.fs.stat(path, { resolve: true }).catch(() => null),
    read: (path, maxBytes) => portRead($, path, maxBytes),
    ancestors: names => $.fs.ancestors({ names: [...names] }).catch(() => null),
    settings: source => $.settings.read({ source }).catch(() => null),
    commands: () => $.command.list().catch(() => null),
    tools: () => $.tool.list().catch(() => null),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cadre',
      description: 'Split this repo into scope-limited role sessions (Phase 2: detect, init; writes nothing)',
      argumentHint: 'detect [--adapters] | init [--dry-run]',
    })

    return next(e)
  })

  on('command.run', { command: 'cadre' }, async ($, e) => {
    const command = parseCommand(e.args)
    switch (command.kind) {
      case 'help':
        return { text: helpText(command.unknown) }
      case 'detect':
        return { text: await detectReply($, command.adapters) }
      case 'init':
        return { text: await runInit(initIoOf($), { dryRun: command.dryRun }) }
      case 'regen':
        // Plan 02-13 adds regen's grammar and its route; until then the parser never gives this kind.
        return { text: helpText(null) }
      default: {
        const unreachable: never = command
        return unreachable
      }
    }
  })
}
