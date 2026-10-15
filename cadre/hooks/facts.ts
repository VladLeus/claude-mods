import type {
  EntryKind,
  Facts,
  GsdReadTarget,
  HookScript,
  PluginFlag,
  PluginVersion,
  RawFacts,
  ReadPlan,
  RepoEntry,
  SettingsSource,
} from '../types'

/** Code points a repo or docs entry name keeps; a longer name is cut with an ellipsis. */
const MAX_NAME_CHARS = 255
/** Code points a settings key keeps; a plugin key reads as `name@marketplace`. */
const MAX_KEY_CHARS = 120
/** Code points a hook event name keeps. */
const MAX_EVENT_CHARS = 60
/** Code points a host warning keeps, the ellipsis included. */
const MAX_WARNING_CHARS = 240
/** Code points a version text keeps; longer text is not a version. */
const MAX_VERSION_CHARS = 40
/** The character a cut value ends with. */
const ELLIPSIS = '…'
/** The entry kinds a listing may carry; an entry of any other kind is dropped. */
const ENTRY_KINDS: readonly EntryKind[] = ['file', 'dir', 'other']
/** Settings sources in override order: a later source wins over an earlier one for the same key. */
const SOURCE_ORDER: readonly SettingsSource[] = ['user', 'project', 'local']
/**
 * A GSD hook script basename: `gsd-` then letters, digits and hyphens, then `.js`, `.sh` or `.cjs`. The
 * lookarounds require a whole basename, so `mygsd-x.js` and `gsd-x.js.bak` do not match.
 */
const GSD_SCRIPT_PATTERN = /(?<![\w.-])gsd-[a-z0-9-]+\.(?:js|sh|cjs)(?![\w.-])/g
/** A version as GSD and Claude Code print it: `major.minor.patch` with an optional suffix. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.-]+)?$/

/**
 * Strips control, bidi and format characters from a foreign string and caps its length with an ellipsis;
 * anything that is not a string becomes ''. The length counts code points, not UTF-16 units.
 */
export function clean(value: unknown, maxChars = 120): string {
  if (typeof value !== 'string') return ''
  const stripped = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
  const points = Array.from(stripped)
  if (points.length <= maxChars) return stripped

  return `${points.slice(0, Math.max(0, maxChars - 1)).join('')}${ELLIPSIS}`
}

function isObject(value: unknown): value is Record<string, unknown> {
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

/** The host's warnings, cleaned and capped; a warning that cleans to nothing is dropped. */
function cleanWarnings(warnings: unknown): string[] {
  if (!Array.isArray(warnings)) return []

  return warnings.map(warning => clean(warning, MAX_WARNING_CHARS)).filter(text => text !== '')
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
export function foldEnabledPlugins(flags: PluginFlag[]): PluginFlag[] {
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
        for (const script of hook.command.match(GSD_SCRIPT_PATTERN) ?? []) {
          found.set(JSON.stringify([event, script]), { script, event, source })
        }
      }
    }
  }

  return Array.from(found.values())
}

/** The trimmed text when it is a usable version, else null. Replaced by the exported parser in task 3. */
function versionOf(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length > MAX_VERSION_CHARS || !VERSION_PATTERN.test(trimmed)) return null

  return trimmed
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
      const version = isObject(entry) ? versionOf(entry.version) : null
      if (version !== null) {
        installed.push({ key, version })
        break
      }
    }
  }

  return installed
}

/**
 * The only input detection reads: the host's raw reads turned into typed, cleaned Facts. Pure, so the same
 * raw read always gives the same Facts.
 */
export function normalizeFacts(raw: RawFacts): Facts {
  const settings = orderedSettings(raw.settings)
  const flags = settings.flatMap(entry => parseEnabledPlugins(entry.value, entry.source))
  const plugins = parseInstalledPlugins(raw.installedPlugins)
  return {
    repoEntries: parseRepoEntries(raw.repoEntries),
    docsEntries: parseRepoEntries(raw.docsEntries),
    enabledPlugins: foldEnabledPlugins(flags),
    hookScripts: settings.flatMap(entry => parseHookScripts(entry.value, entry.source)),
    superpowersVersions: plugins.filter(plugin => plugin.key.startsWith('superpowers@')),
    gsd: [],
    warnings: cleanWarnings(raw.warnings),
  }
}

/** RED placeholder (plan 01-04, task 3): a deliberately wrong value, so the tests fail on their assertions. */
export function isSafeConfigDir(value: unknown): boolean {
  return true
}

/** RED placeholder (plan 01-04, task 3): a deliberately wrong value, so the tests fail on their assertions. */
export function displayPath(path: string, home: string | null, root: string): string {
  return 'STUB'
}

/** RED placeholder (plan 01-04, task 3): a deliberately wrong value, so the tests fail on their assertions. */
export function factReadPlan(env: { root: string; home: string | null; configDir: string | null }): ReadPlan {
  return { installedPluginsPath: 'STUB', gsd: [], warnings: [] }
}

/** RED placeholder (plan 01-04, task 3): a deliberately wrong value, so the tests fail on their assertions. */
export function isGsdIdentitySource(text: string | null): boolean {
  return true
}

/** RED placeholder (plan 01-04, task 3): a deliberately wrong value, so the tests fail on their assertions. */
export function parseRuntimeIdentity(stdout: string | null): { version: string } | null {
  return { version: 'STUB' }
}

/** RED placeholder (plan 01-04, task 3): a deliberately wrong value, so the tests fail on their assertions. */
export function parseVersionText(text: unknown): string | null {
  return 'STUB'
}

/** RED placeholder (plan 01-04, task 3): a deliberately wrong value, so the tests fail on their assertions. */
export function parseGsdManifest(value: unknown): { version: string } | null {
  return { version: 'STUB' }
}

/** RED placeholder (plan 01-04, task 3): a deliberately wrong value, so the tests fail on their assertions. */
export function runtimeIdentityArgv(
  target: GsdReadTarget,
  identityText: string | null,
  isPresent: boolean,
): string[] | null {
  return ['STUB']
}
