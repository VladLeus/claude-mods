import type {
  EntryKind,
  Facts,
  GsdFact,
  GsdLocation,
  GsdReadTarget,
  HookScript,
  PluginFlag,
  PluginVersion,
  RawFacts,
  RawGsdCandidate,
  ReadPlan,
  RepoEntry,
  SettingsSource,
} from '../types'
import { fieldKeysOf, isObject } from './core/json'
import { clean, isChangedByClean } from './core/text'
import { displayPath, MAX_WARNING_CHARS, safeWarnings, trimSlash, userFolderOf } from './paths'
import type { ReadEnv } from './paths'

/**
 * The most bytes of one file a parser sees. register.tsx applies it after the host's own read cap; a larger file is
 * skipped and a warning is recorded. `fs.list` results are not bounded by it.
 */
export const MAX_READ_BYTES = 256 * 1024
/** Code points a repo or docs entry name keeps; a longer name is cut with an ellipsis. */
const MAX_NAME_CHARS = 255
/** Code points a settings key keeps; a plugin key reads as `name@marketplace`. The setup scan shares it. */
export const MAX_KEY_CHARS = 120
/** Code points a hook event name keeps. */
const MAX_EVENT_CHARS = 60
/** Code points a version text keeps; longer text is not a version. */
const MAX_VERSION_CHARS = 40
/** At most this many changed names are named per kind; the rest are counted in one more warning. */
const MAX_HIDDEN_NAME_WARNINGS = 5
/** Code points a changed name keeps in its warning, once cleaned. */
const MAX_HIDDEN_NAME_CHARS = 60
/** The entry kinds a listing may carry; an entry of any other kind is dropped. */
const ENTRY_KINDS: readonly EntryKind[] = ['file', 'dir', 'other']
/**
 * Settings sources in override order: a later source wins over an earlier one for the same key. The setup scan reads
 * the sources in this order too.
 */
export const SOURCE_ORDER: readonly SettingsSource[] = Object.freeze(['user', 'project', 'local'])
/**
 * A GSD hook script basename: `gsd-` then 1 to 80 letters, digits and hyphens, then `.js`, `.sh` or `.cjs`. The
 * lookarounds require a whole basename, so `mygsd-x.js` and `gsd-x.js.bak` do not match, and a longer name is not
 * reported.
 */
const GSD_SCRIPT_PATTERN = /(?<![\w.-])gsd-[a-z0-9-]{1,80}\.(?:js|sh|cjs)(?![\w.-])/g
/** A version as GSD and Claude Code print it: `major.minor.patch` with an optional suffix. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.-]+)?$/
/** The package name GSD declares in its identity module and prints in its runtime identity. */
const GSD_PACKAGE_NAME = '@opengsd/gsd-core'
/**
 * The line the GSD identity module declares its package name on; finding it proves a GSD install. The whole line
 * must match (leading whitespace and a trailing carriage return allowed), so a comment or a longer line does not.
 */
const IDENTITY_SOURCE_PATTERN = /^\s*const packageName = "@opengsd\/gsd-core";\r?$/m
/**
 * The exact opening of the runtime identity output. The closing quote is part of it, so a longer package name
 * such as `@opengsd/gsd-core-evil` is not a match.
 */
const RUNTIME_IDENTITY_PREFIX = `{"packageName":"${GSD_PACKAGE_NAME}"`
/** The locations a GSD candidate may carry; a candidate with any other location is skipped. */
const GSD_LOCATIONS: readonly GsdLocation[] = ['user', 'project']

/** Reply when the session root is the home folder or contains it; detection would read the whole home. */
export const HOME_ROOT_REPLY =
  'cadre detect needs a repo root other than your home folder. Open the session in a repo and run /cadre detect again.'
/** Reply when the session root is the file system root; detection would read the whole disk (WR-06). */
export const FILE_SYSTEM_ROOT_REPLY =
  'cadre detect needs a repo root other than the file system root (/). ' +
  'Open the session in a repo and run /cadre detect again.'

/**
 * One warning per name that clean would change at `maxChars`, naming its cleaned form capped at MAX_HIDDEN_NAME_CHARS,
 * at most MAX_HIDDEN_NAME_WARNINGS of them, then one warning that counts the rest. A name given twice, such as the same
 * key in two settings files, counts once. `kind` says what the names are.
 */
export function hiddenNameWarnings(names: readonly string[], kind: string, maxChars: number): string[] {
  const changed = Array.from(new Set(names.filter(name => isChangedByClean(name, maxChars))))
  const named = changed.slice(0, MAX_HIDDEN_NAME_WARNINGS).map(name => {
    const shown = clean(name, MAX_HIDDEN_NAME_CHARS)

    return clean(`ignored ${kind} "${shown}": its name has hidden characters or is too long`, MAX_WARNING_CHARS)
  })
  const rest = changed.length - named.length
  if (rest === 0) return named

  return [...named, `ignored ${rest} more ${kind} names that have hidden characters or are too long`]
}

function isEntryKind(value: unknown): value is EntryKind {
  return ENTRY_KINDS.some(kind => kind === value)
}

/**
 * A repo or docs listing as typed entries. An entry needs a non-empty string name that clean leaves unchanged (WR-03)
 * and a known kind. Size and mtime are dropped, and `isLink` is true only when the host sent exactly `true`.
 */
export function parseRepoEntries(value: unknown): RepoEntry[] {
  if (!Array.isArray(value)) return []
  const entries: RepoEntry[] = []
  for (const item of value) {
    if (!isObject(item)) continue
    const rawName = item.name
    if (typeof rawName !== 'string' || isChangedByClean(rawName, MAX_NAME_CHARS)) continue
    const name = rawName
    const kind = item.kind
    if (name === '' || !isEntryKind(kind)) continue
    entries.push({ name, kind, isLink: item.isLink === true })
  }

  return entries
}

function isSettingsEntry(entry: unknown): entry is RawFacts['settings'][number] {
  return isObject(entry) && SOURCE_ORDER.some(source => source === entry.source)
}

/** The settings entries from a known source, grouped in override order (user, project, local). */
function orderedSettings(settings: unknown): RawFacts['settings'] {
  if (!Array.isArray(settings)) return []
  const known = settings.filter(isSettingsEntry)

  return SOURCE_ORDER.flatMap(source => known.filter(entry => entry.source === source))
}

/**
 * The `enabledPlugins` flags of one settings file: boolean values only. A key that clean would change at 120 code
 * points is dropped (WR-03). Nothing else in the file is read.
 */
export function parseEnabledPlugins(value: unknown, source: SettingsSource): PluginFlag[] {
  if (!isObject(value) || !isObject(value.enabledPlugins)) return []
  const flags: PluginFlag[] = []
  for (const [rawKey, flagValue] of Object.entries(value.enabledPlugins)) {
    if (isChangedByClean(rawKey, MAX_KEY_CHARS)) continue
    const key = rawKey
    if (key === '' || typeof flagValue !== 'boolean') continue
    flags.push({ key, source, value: flagValue })
  }

  return flags
}

/**
 * One flag per key, from flags in override order (user, project, local). A later flag replaces the value and
 * the source of an earlier one for the same key, and each key keeps the place it first appeared in.
 */
export function foldEnabledPlugins(flags: readonly PluginFlag[]): PluginFlag[] {
  const folded = new Map<string, PluginFlag>()
  for (const flag of flags) {
    folded.set(flag.key, flag)
  }

  return Array.from(folded.values())
}

/**
 * The `gsd-` hook script basenames under `hooks`, each with the event it runs on. The rest of each command is
 * discarded, and a script named twice for the same event appears once.
 */
export function parseHookScripts(value: unknown, source: SettingsSource): HookScript[] {
  return hookScriptsMatching(value, source, GSD_SCRIPT_PATTERN)
}

/**
 * The hook script basenames under `hooks` of one settings value that the global `pattern` finds in the command of a
 * hook whose `type` is exactly `command`, the only hooks launch renders (launchHookOf), each with its event and source.
 * The rest of each command is discarded: the interpreter, the path and the arguments, which may hold a secret. An
 * event that cleans to nothing is skipped, and a script named twice for the same event appears once. The detection
 * and the setup scan share this walk over the settings shape, each with its own pattern.
 */
export function hookScriptsMatching(value: unknown, source: SettingsSource, pattern: RegExp): HookScript[] {
  if (!isObject(value) || !isObject(value.hooks)) return []
  const found = new Map<string, HookScript>()
  for (const [rawEvent, matchers] of Object.entries(value.hooks)) {
    const event = clean(rawEvent, MAX_EVENT_CHARS)
    if (event === '' || !Array.isArray(matchers)) continue
    for (const matcher of matchers) {
      if (!isObject(matcher) || !Array.isArray(matcher.hooks)) continue
      for (const hook of matcher.hooks) {
        if (!isObject(hook) || hook.type !== 'command' || typeof hook.command !== 'string') continue
        for (const match of hook.command.match(pattern) ?? []) {
          const script = clean(match)
          found.set(JSON.stringify([event, script]), { script, event, source })
        }
      }
    }
  }

  return Array.from(found.values())
}

/**
 * Whether an installed_plugins entry belongs to this repo: a `user` entry always does, a `project` or `local` entry
 * only when its projectPath equals one of the root forms, as given or as resolved (trailing slashes ignored), and an
 * entry with any other scope never does. A root form that trims to nothing matches nothing.
 */
function isEntryForRoot(entry: Record<string, unknown>, roots: readonly string[]): boolean {
  if (entry.scope === 'user') return true
  if (entry.scope !== 'project' && entry.scope !== 'local') return false
  const projectPath = entry.projectPath
  if (typeof projectPath !== 'string') return false

  return roots.some(root => {
    const trimmed = trimSlash(root)
    if (trimmed === null || trimmed === '') return false

    return trimmed === trimSlash(projectPath)
  })
}

/**
 * The usable version of a key's entries for this repo: the first `user` entry with a valid version, else the first
 * `project` or `local` entry for the repo root with one, else null. Another project's entry is never used (WR-04).
 */
function installedVersionOf(entries: readonly unknown[], roots: readonly string[]): string | null {
  const usable = entries.filter(isObject).filter(entry => isEntryForRoot(entry, roots))
  // Stable order: every user entry first, then the project and local entries, each group in file order.
  const userEntries = usable.filter(entry => entry.scope === 'user')
  const repoEntries = usable.filter(entry => entry.scope !== 'user')
  for (const entry of [...userEntries, ...repoEntries]) {
    const version = parseVersionText(entry.version)
    if (version !== null) return version
  }

  return null
}

/**
 * The version installed for this repo for each installed plugin key: user scope first, then a project or local entry
 * whose projectPath is the repo root as resolved or as given (WR-04). A key that clean would change at 120 code points
 * is dropped (WR-03). Only the key and the version are kept: install paths, scopes and the rest of each entry are never
 * read into Facts.
 */
export function parseInstalledPlugins(value: unknown, root: string, givenRoot: string): PluginVersion[] {
  if (!isObject(value) || !isObject(value.plugins)) return []
  const installed: PluginVersion[] = []
  for (const [key, entries] of Object.entries(value.plugins)) {
    if (key === '' || isChangedByClean(key, MAX_KEY_CHARS) || !Array.isArray(entries)) continue
    const version = installedVersionOf(entries, [root, givenRoot])
    if (version !== null) installed.push({ key, version })
  }

  return installed
}

/** The files to read for one GSD folder: its VERSION, its identity module, and the manifest beside it. */
function gsdTarget(location: GsdLocation, dir: string, manifestPath: string): GsdReadTarget {
  return {
    location,
    dir,
    versionPath: `${dir}/VERSION`,
    identityPath: `${dir}/bin/lib/package-identity.cjs`,
    manifestPath,
  }
}

/**
 * The reads the host performs before detection, and nothing else. The user-level GSD folder is CLAUDE_CONFIG_DIR
 * when that is usable, else `<home>/.claude`; the repo's own copy is always listed. Building the plan reads nothing.
 * Trailing slashes on the root, the home folder and CLAUDE_CONFIG_DIR are dropped.
 * The host must realpath the root, the home folder and CLAUDE_CONFIG_DIR
 * first: symlinks and case-insensitive paths cannot be resolved here.
 */
export function factReadPlan(input: ReadEnv): ReadPlan {
  const env = {
    root: trimSlash(input.root),
    home: trimSlash(input.home),
    configDir: trimSlash(input.configDir),
  }
  const warnings: string[] = []
  const userFolder = userFolderOf(env, warnings)
  const gsd: GsdReadTarget[] = []
  if (userFolder !== null) {
    gsd.push(gsdTarget('user', `${userFolder}/gsd-core`, `${userFolder}/gsd-file-manifest.json`))
  }
  gsd.push(gsdTarget('project', `${env.root}/.claude/gsd-core`, `${env.root}/.claude/gsd-file-manifest.json`))

  return {
    installedPluginsPath: userFolder === null ? null : `${userFolder}/plugins/installed_plugins.json`,
    gsd,
    warnings,
  }
}

/** Whether the identity module's text declares the GSD package name, which proves the install is GSD. */
export function isGsdIdentitySource(text: string | null): boolean {
  return text !== null && IDENTITY_SOURCE_PATTERN.test(text)
}

/**
 * A version text as GSD prints it: trimmed, at most 40 characters, `major.minor.patch` with an optional suffix.
 * Any other text gives null.
 */
export function parseVersionText(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length > MAX_VERSION_CHARS || !VERSION_PATTERN.test(trimmed)) return null

  return trimmed
}

/**
 * The version from the runtime identity command's stdout. Only output that opens with the exact identity object
 * counts; anything else, including text that names the package later on, is refused.
 */
export function parseRuntimeIdentity(stdout: unknown): { version: string } | null {
  if (typeof stdout !== 'string') return null
  const text = stdout.trim()
  if (!text.startsWith(RUNTIME_IDENTITY_PREFIX)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(parsed) || parsed.packageName !== GSD_PACKAGE_NAME) return null
  const version = parseVersionText(parsed.version)

  return version === null ? null : { version }
}

/** The version of a parsed GSD file manifest, when it has a numeric manifestVersion and a valid version. */
export function parseGsdManifest(value: unknown): { version: string } | null {
  if (!isObject(value) || !Number.isFinite(value.manifestVersion)) return null
  const version = parseVersionText(value.version)

  return version === null ? null : { version }
}

/**
 * Why the runtime identity check gave no answer, when cadre knows: `not-built` when the compiled runtime
 * (`bin/lib/cli-exit.cjs`) is missing, so the call was not made (WR-01); `could-not-run` when the call threw, which
 * covers node missing from PATH and a timeout alike (IN-05). It is local to the detect modules, so the shared types
 * file stays as it is.
 */
export type RuntimeProblem = 'not-built' | 'could-not-run'

/** A GSD candidate as register.tsx reads it: the shared raw shape plus the runtime problem, when one is known. */
export type ProbedGsdCandidate = RawGsdCandidate & { readonly runtimeProblem: RuntimeProblem | null }

/** The runtime problems a candidate may carry; any other value counts as no known problem. */
const RUNTIME_PROBLEMS: readonly RuntimeProblem[] = ['not-built', 'could-not-run']

/**
 * The compiled runtime file of a GSD install. When it is missing, gsd-tools would build its runtime and write files on
 * start, so the runtime identity call is not made (WR-01). register.tsx checks it with `$.fs.exists`.
 */
export function runtimeBuiltPath(target: GsdReadTarget): string {
  return `${target.dir}/bin/lib/cli-exit.cjs`
}

/**
 * The argv that asks a user-level GSD install for its runtime identity, or null. Only the user-level candidate is
 * ever run, and only when it is present, its compiled runtime is built (WR-01), and its identity module does not
 * already prove it. A repo-local candidate is never run: a repo must not get code execution from its own files (D-28).
 * register.tsx runs it with the GSD folder as the working folder, never the repo.
 */
export function runtimeIdentityArgv(
  target: GsdReadTarget,
  identityText: string | null,
  isPresent: boolean,
  isBuilt: boolean,
): string[] | null {
  if (!isRuntimeCallAllowed(target, identityText, isPresent) || !isBuilt) return null

  return ['node', `${target.dir}/bin/gsd-tools.cjs`, 'runtime-identity', '--raw']
}

/**
 * Whether the runtime identity call is allowed before the built check: the candidate is the user-level install, it is
 * present, and its identity module does not already prove it. A repo-local candidate is never allowed (D-28).
 */
export function isRuntimeCallAllowed(target: GsdReadTarget, identityText: string | null, isPresent: boolean): boolean {
  return target.location === 'user' && isPresent && !isGsdIdentitySource(identityText)
}

/**
 * `not-built` when the runtime identity call would be made but the compiled runtime is missing, so it is skipped
 * (WR-01); null otherwise.
 */
export function runtimeSkipProblem(
  target: GsdReadTarget,
  identityText: string | null,
  isPresent: boolean,
  isBuilt: boolean,
): RuntimeProblem | null {
  if (isBuilt || !isRuntimeCallAllowed(target, identityText, isPresent)) return null

  return 'not-built'
}

/**
 * The identity state of one candidate: `absent` when it is not there, `proven` when its identity module or its
 * runtime identity says so, and `unknown` otherwise. A read that failed is unknown, never absent.
 */
function identityOf(candidate: RawGsdCandidate, runtimeProves: boolean): GsdFact['identity'] {
  if (!candidate.isPresent) return 'absent'
  if (runtimeProves || isGsdIdentitySource(candidate.identityText)) return 'proven'

  return 'unknown'
}

/** The version of a candidate: the VERSION text, else the manifest, else the runtime identity. */
function versionOf(candidate: RawGsdCandidate, runtime: { version: string } | null): string | null {
  return (
    parseVersionText(candidate.versionText) ?? parseGsdManifest(candidate.manifest)?.version ?? runtime?.version ?? null
  )
}

/**
 * A host-sent candidate rebuilt field by field, or null when it has no string `dir` or no known location (WR-05).
 * Every other field is checked: `isPresent` and `runtimeTried` count only when exactly true, a text that is not a
 * string is null, and an unknown runtime problem is null. The manifest stays unvalidated; parseGsdManifest checks it.
 */
function usableCandidate(value: unknown): ProbedGsdCandidate | null {
  if (!isObject(value)) return null
  const dir = value.dir
  const location = GSD_LOCATIONS.find(place => place === value.location)
  if (typeof dir !== 'string' || location === undefined) return null

  return {
    location,
    dir,
    isPresent: value.isPresent === true,
    versionText: typeof value.versionText === 'string' ? value.versionText : null,
    identityText: typeof value.identityText === 'string' ? value.identityText : null,
    manifest: value.manifest,
    runtimeStdout: typeof value.runtimeStdout === 'string' ? value.runtimeStdout : null,
    runtimeTried: value.runtimeTried === true,
    runtimeProblem: RUNTIME_PROBLEMS.find(problem => problem === value.runtimeProblem) ?? null,
  }
}

/** The usable candidates of a host-sent list, each rebuilt by usableCandidate; anything else is skipped. */
function usableCandidates(value: unknown): ProbedGsdCandidate[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(item => {
    const candidate = usableCandidate(item)

    return candidate === null ? [] : [candidate]
  })
}

/** The warning for a candidate nothing proves, with the known runtime problem when there is one (WR-01, IN-05). */
function unprovenWarning(dir: string, problem: RuntimeProblem | null): string {
  const prefix = `could not prove the GSD install at ${dir}`
  if (problem === 'not-built') return `${prefix}: runtime not built (treated as unknown)`
  if (problem === 'could-not-run') {
    return `${prefix}: the identity call could not run (node missing or timed out); treated as unknown`
  }

  return `${prefix} (treated as unknown)`
}

/**
 * One GSD candidate as a fact. The version is the VERSION text, else the manifest, else the runtime identity.
 * A present install that nothing proves adds a warning, which names the install by its cleaned display path and the
 * runtime problem when one is known.
 */
function gsdFactOf(
  candidate: ProbedGsdCandidate,
  raw: RawFacts,
  configDir: string | null,
  warnings: string[],
): GsdFact {
  const dir = displayPath(candidate.dir, raw.home, raw.root, configDir)
  const runtime = parseRuntimeIdentity(candidate.runtimeStdout)
  const identity = identityOf(candidate, runtime !== null)
  if (identity === 'unknown') {
    warnings.push(clean(unprovenWarning(dir, candidate.runtimeProblem), MAX_WARNING_CHARS))
  }
  const version = versionOf(candidate, runtime)

  return {
    location: candidate.location,
    dir,
    version,
    identity,
    runtimeIdentityTried: candidate.runtimeTried,
  }
}

/**
 * The only input detection reads: the host's raw reads turned into typed, cleaned Facts. Pure, so the same raw
 * read always gives the same Facts. No settings value other than enabled plugins and hook basenames is kept.
 * `configDir` is CLAUDE_CONFIG_DIR as the host resolved it, used only to show paths under it as
 * `$CLAUDE_CONFIG_DIR/...` (IN-03); `givenRoot` is the session root before the host resolved it, which an installed
 * plugin entry may name too (WR-04). Both are parameters so the shared RawFacts type stays as it is.
 */
export function normalizeFacts(raw: RawFacts, configDir: string | null, givenRoot: string): Facts {
  const settings = orderedSettings(raw.settings)
  const flags = settings.flatMap(entry => parseEnabledPlugins(entry.value, entry.source))
  const plugins = parseInstalledPlugins(raw.installedPlugins, raw.root, givenRoot)
  const gsdWarnings: string[] = []
  const gsd = usableCandidates(raw.gsd).map(candidate => gsdFactOf(candidate, raw, configDir, gsdWarnings))
  const hiddenWarnings = [
    ...hiddenNameWarnings(entryNames(raw.repoEntries), 'repo entry', MAX_NAME_CHARS),
    ...hiddenNameWarnings(entryNames(raw.docsEntries), 'docs/ entry', MAX_NAME_CHARS),
    ...hiddenNameWarnings(
      settings.flatMap(entry => fieldKeysOf(entry.value, 'enabledPlugins')),
      'enabledPlugins key',
      MAX_KEY_CHARS,
    ),
    ...hiddenNameWarnings(fieldKeysOf(raw.installedPlugins, 'plugins'), 'installed plugin key', MAX_KEY_CHARS),
  ]

  return {
    repoEntries: parseRepoEntries(raw.repoEntries),
    docsEntries: parseRepoEntries(raw.docsEntries),
    enabledPlugins: foldEnabledPlugins(flags),
    hookScripts: settings.flatMap(entry => parseHookScripts(entry.value, entry.source)),
    superpowersVersions: plugins.filter(plugin => plugin.key.startsWith('superpowers@')),
    gsd,
    warnings: [...safeWarnings(raw.warnings, raw, configDir), ...hiddenWarnings, ...gsdWarnings],
  }
}

/** The string names of a host listing, unchecked, so hiddenNameWarnings can name the ones parseRepoEntries drops. */
function entryNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(item => (isObject(item) && typeof item.name === 'string' ? [item.name] : []))
}

/**
 * The reply when the session root is the home folder or contains it, else null. Both paths are compared after
 * trimming a trailing `/`, and the rule applies only when `home` is non-empty. Pure: it reads nothing. detectRefusal
 * applies it to every pair of root and home forms.
 */
export function homeRootRefusal(root: string, home: string | null): string | null {
  if (home === null || home === '') return null
  const trimmedHome = home.replace(/\/+$/, '')
  const trimmedRoot = root.replace(/\/+$/, '')
  if (trimmedRoot === trimmedHome || trimmedHome.startsWith(`${trimmedRoot}/`)) return HOME_ROOT_REPLY

  return null
}

/**
 * The reply that stops `/cadre detect` before any read, else null (WR-06). Any root form that is `/` or trims to
 * empty is refused, whatever HOME is; then every root form (as given and as resolved) is checked against every home
 * form, so a root used as given still meets a home that was resolved, and the other way round.
 */
export function detectRefusal(roots: readonly string[], homes: readonly (string | null)[]): string | null {
  if (roots.some(root => trimSlash(root) === '')) return FILE_SYSTEM_ROOT_REPLY
  for (const root of roots) {
    for (const home of homes) {
      const refusal = homeRootRefusal(root, home)
      if (refusal !== null) return refusal
    }
  }

  return null
}
