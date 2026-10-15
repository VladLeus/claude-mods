import type { EntryKind, Facts, HookScript, PluginFlag, PluginVersion, RawFacts, RepoEntry, SettingsSource } from '../types'

/** Code points a repo or docs entry name keeps; a longer name is cut with an ellipsis. */
const MAX_NAME_CHARS = 255
/** Code points a host warning keeps, the ellipsis included. */
const MAX_WARNING_CHARS = 240
/** The character a cut value ends with. */
const ELLIPSIS = '…'
/** The entry kinds a listing may carry; an entry of any other kind is dropped. */
const ENTRY_KINDS: readonly EntryKind[] = ['file', 'dir', 'other']

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

/**
 * The only input detection reads: the host's raw reads turned into typed, cleaned Facts. Pure, so the same
 * raw read always gives the same Facts.
 */
export function normalizeFacts(raw: RawFacts): Facts {
  return {
    repoEntries: parseRepoEntries(raw.repoEntries),
    docsEntries: parseRepoEntries(raw.docsEntries),
    enabledPlugins: [],
    hookScripts: [],
    superpowersVersions: [],
    gsd: [],
    warnings: cleanWarnings(raw.warnings),
  }
}

/** RED placeholder (plan 01-04, task 2): a deliberately wrong value, so the tests fail on their assertions. */
export function parseEnabledPlugins(value: unknown, source: SettingsSource): PluginFlag[] {
  return [{ key: 'STUB', source: 'local', value: false }]
}

/** RED placeholder (plan 01-04, task 2): a deliberately wrong value, so the tests fail on their assertions. */
export function foldEnabledPlugins(flags: PluginFlag[]): PluginFlag[] {
  return [{ key: 'STUB', source: 'local', value: false }]
}

/** RED placeholder (plan 01-04, task 2): a deliberately wrong value, so the tests fail on their assertions. */
export function parseHookScripts(value: unknown, source: SettingsSource): HookScript[] {
  return [{ script: 'STUB', event: 'STUB', source: 'local' }]
}

/** RED placeholder (plan 01-04, task 2): a deliberately wrong value, so the tests fail on their assertions. */
export function parseInstalledPlugins(value: unknown): PluginVersion[] {
  return [{ key: 'STUB', version: 'STUB' }]
}
