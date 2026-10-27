/**
 * The settings and plugin reads detection keeps, a layer 3 module: the settings sources in override order, each
 * file's enabled-plugin flags and hook script basenames, and the version of each installed plugin for this repo (WR-03,
 * WR-04). Nothing else in a settings file is read. It imports core, GSD's identity, paths and the types, so facts
 * normalisation, the setup scan and /cadre start read settings here.
 */
import type { HookScript, PluginFlag, PluginVersion, RawFacts, SettingsSource } from '../../../types'
import { isObject } from '../../core/json'
import { clean, isChangedByClean } from '../../core/text'
import { GSD_SCRIPT_PATTERN, parseVersionText } from '../../framework/gsd/identity'
import { trimSlash } from '../../paths'

/** Code points a settings key keeps; a plugin key reads as `name@marketplace`. The setup scan shares it. */
export const MAX_KEY_CHARS = 120
/** Code points a hook event name keeps. */
const MAX_EVENT_CHARS = 60

/**
 * Settings sources in override order: a later source wins over an earlier one for the same key. The setup scan reads
 * the sources in this order too.
 */
export const SOURCE_ORDER: readonly SettingsSource[] = Object.freeze(['user', 'project', 'local'])

function isSettingsEntry(entry: unknown): entry is RawFacts['settings'][number] {
  return isObject(entry) && SOURCE_ORDER.some(source => source === entry.source)
}

/** The settings entries from a known source, grouped in override order (user, project, local). */
export function orderedSettings(settings: unknown): RawFacts['settings'] {
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
