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

/**
 * The most bytes of one file register.tsx reads; a larger file is skipped and a warning is recorded. This is the
 * only bound on how many entries, hooks and plugins a parser sees.
 */
export const MAX_READ_BYTES = 256 * 1024
/** Code points a repo or docs entry name keeps; a longer name is cut with an ellipsis. */
const MAX_NAME_CHARS = 255
/** Code points a settings key keeps; a plugin key reads as `name@marketplace`. */
const MAX_KEY_CHARS = 120
/** Code points a hook event name keeps. */
const MAX_EVENT_CHARS = 60
/** Code points a version text keeps; longer text is not a version. */
const MAX_VERSION_CHARS = 40
/** Code points a host warning keeps, the ellipsis included. */
const MAX_WARNING_CHARS = 240
/** The character a cut value ends with. */
const ELLIPSIS = '\u2026'
/** The entry kinds a listing may carry; an entry of any other kind is dropped. */
const ENTRY_KINDS: readonly EntryKind[] = ['file', 'dir', 'other']
/** Settings sources in override order: a later source wins over an earlier one for the same key. */
const SOURCE_ORDER: readonly SettingsSource[] = ['user', 'project', 'local']
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
/** Warning when CLAUDE_CONFIG_DIR is set but cannot be used; the value itself is never shown. */
const CONFIG_DIR_WARNING =
  'CLAUDE_CONFIG_DIR is ignored: it must be an absolute path with no .. segment, outside the repo'
/** Warning when no usable CLAUDE_CONFIG_DIR and no home folder outside the repo leave a user folder to read. */
const NO_USER_FOLDER_WARNING =
  'user-level installs were not checked: no CLAUDE_CONFIG_DIR or home folder outside the repo'

/** The paths the host reads from: the repo root, the home folder, and CLAUDE_CONFIG_DIR when it is set. */
type ReadEnv = {
  root: string
  home: string | null
  configDir: string | null
}

/**
 * Strips control, bidi, format, surrogate and private-use characters from a foreign string and caps its length
 * with an ellipsis; anything that is not a string becomes ''. The length counts code points, not UTF-16 units.
 * `maxChars` must be at least 1; a smaller cap gives ''.
 */
export function clean(value: unknown, maxChars = 120): string {
  if (typeof value !== 'string' || maxChars < 1) return ''
  const stripped = value.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu, '')
  const points = Array.from(stripped)
  if (points.length <= maxChars) return stripped

  return `${points.slice(0, Math.max(0, maxChars - 1)).join('')}${ELLIPSIS}`
}

/** A plain object: not null and not an array. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEntryKind(value: unknown): value is EntryKind {
  return ENTRY_KINDS.some(kind => kind === value)
}

/**
 * A repo or docs listing as typed entries. An entry needs a name that survives cleaning and a known kind.
 * Size and mtime are dropped, and `isLink` is true only when the host sent exactly `true`.
 */
export function parseRepoEntries(value: unknown): RepoEntry[] {
  if (!Array.isArray(value)) return []
  const entries: RepoEntry[] = []
  for (const item of value) {
    if (!isObject(item)) continue
    const name = clean(item.name, MAX_NAME_CHARS)
    const kind = item.kind
    if (name === '' || !isEntryKind(kind)) continue
    entries.push({ name, kind, isLink: item.isLink === true })
  }

  return entries
}

/**
 * Replaces each occurrence of an absolute path with its display form, at path boundaries only: the match may not
 * sit inside a longer path or name (`/repo` is not in `/home/u/repo` or `/repo-other`). A trailing `/` on the path
 * is ignored, and a path too short to be one is left alone, so an empty or root-only value never rewrites the text.
 */
function maskPath(text: string, needle: string | null, replacement: string): string {
  if (needle === null) return text
  const trimmed = needle.replace(/\/+$/, '')
  if (trimmed.length < 2) return text
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return text.replace(new RegExp(`(?<![\\w.~-])${escaped}(?=$|/|[^\\w.-]|\\.(?=$|[^\\w.-]))`, 'g'), () => replacement)
}

/**
 * A host warning with the repo root and the home folder replaced by `<repo>` and `~`, then cleaned and capped.
 * A warning that is not a string becomes ''.
 */
function safeWarning(warning: unknown, raw: RawFacts): string {
  if (typeof warning !== 'string') return ''
  const withoutRoot = maskPath(warning, raw.root, '<repo>')
  const withoutHome = maskPath(withoutRoot, raw.home, '~')

  return clean(withoutHome, MAX_WARNING_CHARS)
}

/** The host's warnings as display-safe text; a warning that cleans to nothing is dropped. */
function safeWarnings(warnings: unknown, raw: RawFacts): string[] {
  if (!Array.isArray(warnings)) return []

  return warnings.map(warning => safeWarning(warning, raw)).filter(text => text !== '')
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
 * The `enabledPlugins` flags of one settings file: boolean values only, with keys cleaned and capped.
 * Nothing else in the file is read.
 */
export function parseEnabledPlugins(value: unknown, source: SettingsSource): PluginFlag[] {
  if (!isObject(value) || !isObject(value.enabledPlugins)) return []
  const flags: PluginFlag[] = []
  for (const [rawKey, flagValue] of Object.entries(value.enabledPlugins)) {
    const key = clean(rawKey, MAX_KEY_CHARS)
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
  if (!isObject(value) || !isObject(value.hooks)) return []
  const found = new Map<string, HookScript>()
  for (const [rawEvent, matchers] of Object.entries(value.hooks)) {
    const event = clean(rawEvent, MAX_EVENT_CHARS)
    if (event === '' || !Array.isArray(matchers)) continue
    for (const matcher of matchers) {
      if (!isObject(matcher) || !Array.isArray(matcher.hooks)) continue
      for (const hook of matcher.hooks) {
        if (!isObject(hook) || typeof hook.command !== 'string') continue
        for (const match of hook.command.match(GSD_SCRIPT_PATTERN) ?? []) {
          const script = clean(match)
          found.set(JSON.stringify([event, script]), { script, event, source })
        }
      }
    }
  }

  return Array.from(found.values())
}

/**
 * The first usable version recorded for each installed plugin key. Only the key and the version are kept:
 * install paths, scopes and the rest of each entry are never read into Facts.
 */
export function parseInstalledPlugins(value: unknown): PluginVersion[] {
  if (!isObject(value) || !isObject(value.plugins)) return []
  const installed: PluginVersion[] = []
  for (const [rawKey, entries] of Object.entries(value.plugins)) {
    const key = clean(rawKey, MAX_KEY_CHARS)
    if (key === '' || !Array.isArray(entries)) continue
    for (const entry of entries) {
      const version = isObject(entry) ? parseVersionText(entry.version) : null
      if (version !== null) {
        installed.push({ key, version })
        break
      }
    }
  }

  return installed
}

/**
 * Whether a config dir value is usable: an absolute POSIX path with no empty, `.` or `..` segment. Any other value
 * is ignored. Symlinks and case-insensitive paths cannot be resolved here, so the host must realpath the repo root,
 * the home folder and CLAUDE_CONFIG_DIR before calling.
 */
export function isSafeConfigDir(value: unknown): boolean {
  if (typeof value !== 'string' || !value.startsWith('/')) return false

  return !value.split('/').slice(1).some(segment => segment === '' || segment === '.' || segment === '..')
}

/**
 * The part of `path` below `base`: '' when they name the same folder, a string starting with `/` when `path` is
 * inside `base`, and null otherwise. A base that is null, empty or `/` is never a folder that contains a path.
 */
function relativeTo(path: string, base: string | null): string | null {
  const trimmed = (base ?? '').replace(/\/+$/, '')
  if (trimmed === '') return null
  if (path === trimmed) return ''
  if (path.startsWith(`${trimmed}/`)) return path.slice(trimmed.length)

  return null
}

/**
 * A path as the report may show it: under the repo root as `<repo>/...`, under the home folder as `~/...`, and
 * anything else as the cleaned path. The repo root is checked first, so a repo inside home reads as `<repo>`.
 */
export function displayPath(path: string, home: string | null, root: string): string {
  const underRoot = relativeTo(path, root)
  if (underRoot !== null) return clean(`<repo>${underRoot}`)
  const underHome = relativeTo(path, home)
  if (underHome !== null) return clean(`~${underHome}`)

  return clean(path)
}

/** One path after the host's realpath answer: the path to use, and the warning when it was used as given. */
type ResolvedPath = { readonly path: string; readonly warning: string | null }

/**
 * One path after the host's realpath answer (D-39): where it lands when the host gave a realPath, else the path as
 * given, with a warning that it was used as given. The warning names the role of the path, never the path itself, so
 * no home path can reach the report through it. Pure: the host's answer is an argument.
 */
export function resolvedPath(given: string, realPath: string | undefined, label: string): ResolvedPath {
  if (realPath !== undefined && realPath !== '') return { path: realPath, warning: null }

  return { path: given, warning: `could not resolve ${label} (used as given)` }
}

/**
 * CLAUDE_CONFIG_DIR when it is set, safe and outside the repo; null when unset,
 * and null with a warning when unusable.
 */
function usableConfigDir(env: ReadEnv, warnings: string[]): string | null {
  const { root, configDir } = env
  if (configDir === null) return null
  if (isSafeConfigDir(configDir) && relativeTo(configDir, root) === null) return configDir
  warnings.push(CONFIG_DIR_WARNING)

  return null
}

/**
 * The user-level folder to read, or null when there is none outside the repo. A folder inside the repo is never
 * used, because a repo must not be able to host the user-level install. An unsafe home folder counts as no home.
 * Warns when CLAUDE_CONFIG_DIR is set but cannot be used, and when no user-level folder is left at all.
 */
function userFolderOf(env: ReadEnv, warnings: string[]): string | null {
  const { root, home } = env
  const configDir = usableConfigDir(env, warnings)
  if (configDir !== null) return configDir
  const homeFolder = home !== null && home !== '' && isSafeConfigDir(home) ? `${home}/.claude` : null
  if (homeFolder !== null && relativeTo(homeFolder, root) === null) return homeFolder
  warnings.push(NO_USER_FOLDER_WARNING)

  return null
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

/** A path without its trailing slashes; null stays null. */
function trimSlash(path: string | null): string | null {
  return path === null ? null : path.replace(/\/+$/, '')
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
    root: trimSlash(input.root) ?? '',
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
 * The argv that asks a user-level GSD install for its runtime identity, or null. Only the user-level candidate is
 * ever run, and only when it is present and its identity module does not already prove it. A repo-local candidate
 * is never run: a repo must not get code execution from its own files (D-28).
 */
export function runtimeIdentityArgv(
  target: GsdReadTarget,
  identityText: string | null,
  isPresent: boolean,
): string[] | null {
  if (target.location !== 'user' || !isPresent || isGsdIdentitySource(identityText)) return null

  return ['node', `${target.dir}/bin/gsd-tools.cjs`, 'runtime-identity', '--raw']
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

/** Whether a host-sent candidate has a string `dir` and a known location; any other candidate is skipped. */
function isUsableCandidate(candidate: unknown): candidate is RawGsdCandidate {
  return (
    isObject(candidate) &&
    typeof candidate.dir === 'string' &&
    GSD_LOCATIONS.some(place => place === candidate.location)
  )
}

/**
 * One GSD candidate as a fact. The version is the VERSION text, else the manifest, else the runtime identity.
 * A present install that nothing proves adds a warning, which names the install by its cleaned display path.
 */
function gsdFactOf(candidate: RawGsdCandidate, raw: RawFacts, warnings: string[]): GsdFact {
  const dir = displayPath(candidate.dir, raw.home, raw.root)
  const runtime = parseRuntimeIdentity(candidate.runtimeStdout)
  const identity = identityOf(candidate, runtime !== null)
  if (identity === 'unknown') {
    warnings.push(clean(`could not prove the GSD install at ${dir} (treated as unknown)`, MAX_WARNING_CHARS))
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
 */
export function normalizeFacts(raw: RawFacts): Facts {
  const settings = orderedSettings(raw.settings)
  const flags = settings.flatMap(entry => parseEnabledPlugins(entry.value, entry.source))
  const plugins = parseInstalledPlugins(raw.installedPlugins)
  const gsdWarnings: string[] = []
  const candidates = Array.isArray(raw.gsd) ? raw.gsd : []
  const gsd = candidates.filter(isUsableCandidate).map(candidate => gsdFactOf(candidate, raw, gsdWarnings))

  return {
    repoEntries: parseRepoEntries(raw.repoEntries),
    docsEntries: parseRepoEntries(raw.docsEntries),
    enabledPlugins: foldEnabledPlugins(flags),
    hookScripts: settings.flatMap(entry => parseHookScripts(entry.value, entry.source)),
    superpowersVersions: plugins.filter(plugin => plugin.key.startsWith('superpowers@')),
    gsd,
    warnings: [...safeWarnings(raw.warnings, raw), ...gsdWarnings],
  }
}

/**
 * The reply when the session root is the home folder or contains it, else null. Both paths are compared after
 * trimming a trailing `/`, and the rule applies only when `home` is non-empty. Pure: it reads nothing.
 */
export function homeRootRefusal(root: string, home: string | null): string | null {
  if (home === null || home === '') return null
  const trimmedHome = home.replace(/\/+$/, '')
  const trimmedRoot = root.replace(/\/+$/, '')
  if (trimmedRoot === trimmedHome || trimmedHome.startsWith(`${trimmedRoot}/`)) return HOME_ROOT_REPLY

  return null
}
