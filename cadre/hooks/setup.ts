import type { CarryFacts, HookScript, InitIo, SettingsSource, SetupScan } from '../types'
import { clean, foldEnabledPlugins, hiddenNameWarnings, isChangedByClean, isObject, parseEnabledPlugins } from './facts'

/**
 * Where a scan looks: the repo root as the host resolved it and as given, the home folder and CLAUDE_CONFIG_DIR. Every
 * path is absolute and has no trailing slash, or is null. A scan reads from these paths and shows them only in display
 * form (`<repo>/...`, `~/...`), never as they are.
 */
export type SetupContext = {
  readonly root: string
  readonly givenRoot: string
  readonly home: string | null
  readonly configDir: string | null
}

/** One settings source and the value the host read from it, unvalidated. */
type SettingsEntry = {
  readonly source: SettingsSource
  readonly value: unknown
}

/** What the settings sources keep: key names, hook basenames, the carry facts and the enabled plugin keys. */
type ProjectedSettings = {
  readonly settingsKeys: SetupScan['settingsKeys']
  readonly hooks: readonly HookScript[]
  readonly carry: CarryFacts
  readonly enabled: readonly string[]
}

/** The settings sources in override order: a later source wins over an earlier one for the same key. */
const SOURCES: readonly SettingsSource[] = ['user', 'project', 'local']
/** Code points a settings key or a plugin key keeps; a longer name is dropped, with a warning. */
const MAX_KEY_CHARS = 120
/** Code points a hook event name keeps. */
const MAX_EVENT_CHARS = 60
/** At most this many key names are kept per settings source. */
const MAX_SETTINGS_KEYS = 100
/**
 * A hook script basename: 1 to 80 letters, digits, dots, hyphens and underscores, then `.js`, `.cjs`, `.mjs`, `.sh`,
 * `.py` or `.ts`. The lookarounds require a whole basename, so `x.js.bak`, `a.jsx` and a longer name do not match.
 */
const HOOK_SCRIPT_PATTERN = /(?<![\w.-])[A-Za-z0-9_.-]{1,80}\.(?:js|cjs|mjs|sh|py|ts)(?![\w.-])/g
/** The GSD status line script as a whole basename: `gsd-statusline.js`, `.cjs` or `.sh`. */
const GSD_STATUSLINE_PATTERN = /(?<![\w.-])gsd-statusline\.(?:js|cjs|sh)(?![\w.-])/
/** An environment variable name worth carrying: upper case letters, digits and underscores, at most 64 characters. */
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]{0,63}$/

/** The own key names of a plain object; [] for anything else. */
function keyNamesOf(value: unknown): string[] {
  return isObject(value) ? Object.keys(value) : []
}

/** The own key names of the plain object under `field`; [] when the value or the field is not a plain object. */
function fieldKeysOf(value: unknown, field: string): string[] {
  return isObject(value) ? keyNamesOf(value[field]) : []
}

/** The names that clean leaves unchanged at `maxChars`, in the order given and without repeats. A name is exact. */
function stableNames(names: readonly string[], maxChars: number): string[] {
  return Array.from(new Set(names.filter(name => name !== '' && !isChangedByClean(name, maxChars))))
}

/** The names in code unit order: the same order on every host, whatever its locale. */
function sorted(names: readonly string[]): string[] {
  return [...names].sort()
}

/** The value when it is a positive safe integer, else null. */
function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * The hook script basenames under `hooks` of one settings value, each with its event and source. Every basename ending
 * `.js`, `.cjs`, `.mjs`, `.sh`, `.py` or `.ts` is kept and the rest of its command is discarded: the interpreter, the
 * path and the arguments, which may hold a secret. A script named twice for the same event appears once. The walk is
 * the one parseHookScripts makes over the settings shape, with every script extension, not the `gsd-` names alone.
 */
export function projectHooks(value: unknown, source: SettingsSource): HookScript[] {
  if (!isObject(value) || !isObject(value.hooks)) return []
  const found = new Map<string, HookScript>()
  for (const [rawEvent, matchers] of Object.entries(value.hooks)) {
    const event = clean(rawEvent, MAX_EVENT_CHARS)
    if (event === '' || !Array.isArray(matchers)) continue
    for (const matcher of matchers) {
      if (!isObject(matcher) || !Array.isArray(matcher.hooks)) continue
      for (const hook of matcher.hooks) {
        if (!isObject(hook) || typeof hook.command !== 'string') continue
        for (const match of hook.command.match(HOOK_SCRIPT_PATTERN) ?? []) {
          const script = clean(match)
          found.set(JSON.stringify([event, script]), { script, event, source })
        }
      }
    }
  }

  return Array.from(found.values())
}

/**
 * The carry facts of the user settings (D-60), each allow-listed on its own: `autoCompactWindow` when it is a positive
 * integer, whether a `statusLine` object is set and whether its command names a gsd-statusline script, and the `env`
 * variable names that look like names. No value is kept. Anything but a plain object carries nothing.
 */
function carryOf(user: unknown): CarryFacts {
  if (!isObject(user)) return { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] }
  const statusLine = isObject(user.statusLine) ? user.statusLine : null
  const command = statusLine === null ? null : statusLine.command

  return {
    autoCompactWindow: positiveInteger(user.autoCompactWindow),
    hasStatusLine: statusLine !== null,
    isGsdStatusline: typeof command === 'string' && GSD_STATUSLINE_PATTERN.test(command),
    envNames: sorted(keyNamesOf(user.env).filter(name => ENV_NAME_PATTERN.test(name))),
  }
}

/** The sources that were read as plain objects, one entry per source, in override order. */
function readSources(sources: readonly SettingsEntry[]): SettingsEntry[] {
  return SOURCES.flatMap(source => {
    const found = sources.find(entry => entry.source === source && isObject(entry.value))

    return found === undefined ? [] : [found]
  })
}

/**
 * The settings of the sources that were read, projected to what a scan may keep (SCAN-02, D-57): the top-level key
 * names of each source (sorted, at most 100, a name clean would change is dropped), the hook script basenames, the
 * carry facts of the user source alone, and `enabled`, the enabledPlugins keys that are true after the sources are
 * folded in override order, sorted. A source that is missing or not a plain object is skipped, and no settings value is
 * kept.
 */
export function projectSettings(sources: readonly SettingsEntry[]): ProjectedSettings {
  const read = readSources(sources)
  const user = read.find(entry => entry.source === 'user')
  const flags = foldEnabledPlugins(read.flatMap(entry => parseEnabledPlugins(entry.value, entry.source)))

  return {
    settingsKeys: read.map(entry => ({
      source: entry.source,
      keys: sorted(stableNames(keyNamesOf(entry.value), MAX_KEY_CHARS)).slice(0, MAX_SETTINGS_KEYS),
    })),
    hooks: read.flatMap(entry => projectHooks(entry.value, entry.source)),
    carry: carryOf(user === undefined ? null : user.value),
    enabled: sorted(flags.filter(flag => flag.value).map(flag => flag.key)),
  }
}

/** One warning per settings key and enabledPlugins key that clean would change, as the Facts report them. */
function settingsNameWarnings(sources: readonly SettingsEntry[]): string[] {
  return [
    ...hiddenNameWarnings(sources.flatMap(entry => keyNamesOf(entry.value)), 'settings key', MAX_KEY_CHARS),
    ...hiddenNameWarnings(
      sources.flatMap(entry => fieldKeysOf(entry.value, 'enabledPlugins')),
      'enabledPlugins key',
      MAX_KEY_CHARS,
    ),
  ]
}

/** Each settings source the port can read as a plain object, in override order; any other source adds a warning. */
async function readSettings(io: InitIo, warnings: string[]): Promise<SettingsEntry[]> {
  const read: SettingsEntry[] = []
  for (const source of SOURCES) {
    const value = await io.settings(source)
    if (!isObject(value)) {
      warnings.push(`could not read ${source} settings (treated as unknown)`)
      continue
    }
    read.push({ source, value })
  }

  return read
}

/**
 * The user-setup scan (SCAN-02, D-57): every source is read through the port and projected at once to names, counts and
 * booleans, so no value, command, token or file content can reach a later module. This part reads the three settings
 * sources; a source the port cannot read adds a warning and is treated as unknown, never as empty.
 */
export async function scanSetup(io: InitIo, ctx: SetupContext, isClaudeJsonAllowed: boolean): Promise<SetupScan> {
  const warnings: string[] = []
  const sources = await readSettings(io, warnings)
  const settings = projectSettings(sources)
  warnings.push(...settingsNameWarnings(sources))

  return {
    plugins: settings.enabled,
    skills: [],
    mcp: [],
    agents: [],
    claudeMd: [],
    hasGlobalClaudeMd: false,
    memoryFiles: [],
    settingsKeys: settings.settingsKeys,
    hooks: settings.hooks,
    carry: settings.carry,
    warnings,
  }
}
