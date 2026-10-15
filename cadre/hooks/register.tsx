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
  runtimeIdentityArgv,
} from './facts'
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
 * A text file's contents, or null. A missing file gives null quietly. A probe that fails counts as present, so the
 * read is still tried. A read that fails, or a file over MAX_READ_BYTES, adds a warning and gives null.
 */
async function readText($: EngineInterface, read: ReadContext, path: string): Promise<string | null> {
  const isThere = await $.fs.exists(path).catch(() => true)
  if (!isThere) return null
  const text = await $.fs.read(path).catch(() => null)
  if (text === null || new TextEncoder().encode(text).byteLength > MAX_READ_BYTES) {
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

/** The stdout of the runtime identity call, or null when it was refused, failed or exited non-zero. */
async function identityStdout($: EngineInterface, argv: readonly string[]): Promise<string | null> {
  const result = await $.process.run(argv, { timeoutMs: IDENTITY_TIMEOUT_MS }).catch(() => null)
  if (result === null || result.exitCode !== 0) return null

  return result.stdout
}

/**
 * One GSD candidate as the host reads it: its folder, its three static files, and the runtime identity stdout when
 * runtimeIdentityArgv allows the call, which is the user-level install only (D-28).
 */
async function gsdCandidateOf($: EngineInterface, read: ReadContext, target: GsdReadTarget): Promise<RawGsdCandidate> {
  const isPresent = await $.fs.exists(target.dir).catch(() => true)
  const versionText = await readText($, read, target.versionPath)
  const identityText = await readText($, read, target.identityPath)
  const manifest = await readJson($, read, target.manifestPath)
  const argv = runtimeIdentityArgv(target, identityText, isPresent)
  const runtimeStdout = argv === null ? null : await identityStdout($, argv)

  return {
    location: target.location,
    dir: target.dir,
    isPresent,
    versionText,
    identityText,
    manifest,
    runtimeStdout,
    runtimeTried: argv !== null,
  }
}

/**
 * The host reads for one repo root, in the order factReadPlan names them, and nothing else. The root and the home
 * folder arrive already checked. A read that fails is recorded as a warning, never thrown.
 */
async function collectFacts($: EngineInterface, root: string, home: string | null): Promise<RawFacts> {
  const configDir = await configDirOf($)
  const plan = factReadPlan({ root, home, configDir })
  const read: ReadContext = { root, home, warnings: [...plan.warnings] }
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

/** The `/cadre detect` reply. The home-folder refusal comes first, before any read or process call (D-36). */
async function detectReply($: EngineInterface, isAdapters: boolean): Promise<string> {
  const root = await $.session.root().catch(() => null)
  if (root === null) return detectText(normalizeFacts(rootUnknownFacts()), isAdapters)
  const home = await homeFolder($)
  const refusal = homeRootRefusal(root, home)
  if (refusal !== null) return refusal

  return detectText(normalizeFacts(await collectFacts($, root, home)), isAdapters)
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
