/**
 * The settings part of the setup scan, a layer 3 module: the three settings sources read in override order and
 * projected to key names, hook script basenames, the carry facts and the enabled plugin keys, the installed plugin keys
 * for this repo, and the name rules the setup scan modules keep names by (SCAN-02, D-57, D-60, D-62). No settings value
 * is kept. It imports core, the facts parsers and read cap, the setup readers and the types, so the setup scan and
 * /cadre start read settings here.
 */
import type { CarryFacts, HookScript, InitIo, SettingsSource, SetupScan } from '../../../types'
import { fieldKeysOf, isObject, keysOf } from '../../core/json'
import { ENV_NAME_PATTERN, MAX_HOOK_NAME_CHARS } from '../../core/names'
import { isChangedByClean, sortedUnique } from '../../core/text'
import { t, tn } from '../../locales/t'
import { hiddenNameWarnings, ignoredPluginKeyWarnings, MAX_READ_BYTES } from '../facts/normalize'
import {
  foldEnabledPlugins,
  hookScriptsMatching,
  isPluginKey,
  MAX_KEY_CHARS,
  parseEnabledPlugins,
  parseInstalledPlugins,
  SOURCE_ORDER,
} from '../facts/settings'
import { readJson } from './read'
import type { SetupContext } from './read'

/** One settings source and the value the host read from it, unvalidated. */
export type SettingsEntry = {
  readonly source: SettingsSource
  readonly value: unknown
}

/**
 * What the settings sources keep: key names, hook basenames, the carry facts, the enabled plugin keys and the
 * `.mcp.json` approval lists the MCP scan filters by (D-332).
 */
export type ProjectedSettings = {
  readonly settingsKeys: SetupScan['settingsKeys']
  readonly hooks: readonly HookScript[]
  readonly carry: CarryFacts
  readonly enabled: readonly string[]
  /** The `.mcp.json` servers a settings file rejects: every `disabledMcpjsonServers` name of every source (D-332). */
  readonly mcpDisabled: readonly string[]
  /** The `.mcp.json` servers a settings file approves: every `enabledMcpjsonServers` name of every source (D-332). */
  readonly mcpEnabled: readonly string[]
  /** Whether a source sets `enableAllProjectMcpServers` to true, which approves every `.mcp.json` server (D-332). */
  readonly isAllProjectMcpEnabled: boolean
}

/** At most this many key names are kept per settings source. */
const MAX_SETTINGS_KEYS = 100

/**
 * A hook script basename: 1 to 80 letters, digits, dots, hyphens and underscores, then `.js`, `.cjs`, `.mjs`, `.sh`,
 * `.py` or `.ts`. The lookarounds require a whole basename, so `x.js.bak`, `a.jsx` and a longer name do not match.
 */
const HOOK_SCRIPT_PATTERN = /(?<![\w.-])[A-Za-z0-9_.-]{1,80}\.(?:js|cjs|mjs|sh|py|ts)(?![\w.-])/g
/** The GSD status line script as a whole basename: `gsd-statusline.js`, `.cjs` or `.sh`. */
const GSD_STATUSLINE_PATTERN = /(?<![\w.-])gsd-statusline\.(?:js|cjs|sh)(?![\w.-])/

/** The names that clean leaves unchanged at `maxChars`, in the order given and without repeats. A name is exact. */
export function stableNames(names: readonly string[], maxChars: number): string[] {
  return Array.from(new Set(names.filter(name => name !== '' && !isChangedByClean(name, maxChars))))
}

/**
 * The warning for names a scan dropped because a role.json could not hold them, naming the source and the count and
 * never a name; none when nothing was dropped.
 */
export function unfitNameWarnings(
  count: number,
  base: 'scan.settings.unfitHookNames' | 'scan.settings.unfitMcpNames',
  source: string,
): string[] {
  if (count === 0) return []

  return [tn(base, count, { count, source })]
}

/** Whether a hook script basename fits the role.json cap, so a role can carry it (D-62). */
function fitsHookCap(script: string): boolean {
  return script.length <= MAX_HOOK_NAME_CHARS
}

/**
 * The script a hook command runs, as a role carries it (D-62): the first whole basename HOOK_SCRIPT_PATTERN finds in
 * the command that fits the role.json cap, so a command that names two scripts is carried under the first; null when
 * there is none. The rest of the command, which may hold a secret, is not part of it.
 */
export function hookScriptOf(command: string): string | null {
  return command.match(HOOK_SCRIPT_PATTERN)?.find(fitsHookCap) ?? null
}

/** The value when it is a positive safe integer, else null. */
export function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * The hook script basenames under `hooks` of one settings value, each with its event and source. Every basename ending
 * `.js`, `.cjs`, `.mjs`, `.sh`, `.py` or `.ts` is kept and the rest of its command is discarded: the interpreter, the
 * path and the arguments, which may hold a secret. A script named twice for the same event appears once, and a name
 * over the role.json cap of MAX_HOOK_NAME_CHARS is dropped, so every script a scan keeps is one a role can carry. The
 * walk is the one parseHookScripts makes over the settings shape, with every script extension, not the `gsd-` names
 * alone.
 */
export function projectHooks(value: unknown, source: SettingsSource): HookScript[] {
  return hookScriptsMatching(value, source, HOOK_SCRIPT_PATTERN).filter(hook => fitsHookCap(hook.script))
}

/** One warning per settings source that names hook scripts over the role.json cap, counting them, never naming one. */
export function hookNameWarnings(sources: readonly SettingsEntry[]): string[] {
  return sources.flatMap(entry => {
    const scripts = hookScriptsMatching(entry.value, entry.source, HOOK_SCRIPT_PATTERN).map(hook => hook.script)
    const tooLong = new Set(scripts.filter(script => !fitsHookCap(script)))

    const source = t('scan.setup.settings.hookNameWarnings2', { source: entry.source })

    return unfitNameWarnings(tooLong.size, 'scan.settings.unfitHookNames', source)
  })
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
    envNames: sortedUnique(keysOf(user.env).filter(name => ENV_NAME_PATTERN.test(name))),
  }
}

/**
 * The server names of one `.mcp.json` approval list of a settings value (D-332): `key` read as an array of strings,
 * the shape research assumption A4 takes, each name clean leaves unchanged at MAX_KEY_CHARS, as parseEnabledPlugins
 * keeps a key, once each; anything but an array reads as none, and an entry that is not a string is skipped.
 */
function mcpjsonNames(value: unknown, key: 'disabledMcpjsonServers' | 'enabledMcpjsonServers'): string[] {
  if (!isObject(value)) return []
  const listed = value[key]
  if (!Array.isArray(listed)) return []

  return stableNames(listed.filter((name): name is string => typeof name === 'string'), MAX_KEY_CHARS)
}

/** The sources that were read as plain objects, one entry per source, in override order. */
function readSources(sources: readonly SettingsEntry[]): SettingsEntry[] {
  return SOURCE_ORDER.flatMap(source => {
    const found = sources.find(entry => entry.source === source && isObject(entry.value))

    return found === undefined ? [] : [found]
  })
}

/**
 * The settings of the sources that were read, projected to what a scan may keep (SCAN-02, D-57): the top-level key
 * names of each source (sorted, at most 100, a name clean would change is dropped), the hook script basenames, the
 * carry facts of the user source alone, `enabled`, the enabledPlugins keys that are true after the sources are folded
 * in override order, sorted, and the `.mcp.json` approval lists of every source (D-332): the names of each
 * `disabledMcpjsonServers` and `enabledMcpjsonServers` (mcpjsonNames), sorted, and whether any source sets
 * `enableAllProjectMcpServers` to true. A source that is missing or not a plain object is skipped, and no other
 * settings value is kept.
 */
export function projectSettings(sources: readonly SettingsEntry[]): ProjectedSettings {
  const read = readSources(sources)
  const user = read.find(entry => entry.source === 'user')
  const flags = foldEnabledPlugins(read.flatMap(entry => parseEnabledPlugins(entry.value, entry.source)))
  const approvesAll = read.some(entry => isObject(entry.value) && entry.value.enableAllProjectMcpServers === true)

  return {
    settingsKeys: read.map(entry => ({
      source: entry.source,
      keys: sortedUnique(stableNames(keysOf(entry.value), MAX_KEY_CHARS)).slice(0, MAX_SETTINGS_KEYS),
    })),
    hooks: read.flatMap(entry => projectHooks(entry.value, entry.source)),
    carry: carryOf(user === undefined ? null : user.value),
    enabled: sortedUnique(flags.filter(flag => flag.value).map(flag => flag.key)),
    mcpDisabled: sortedUnique(read.flatMap(entry => mcpjsonNames(entry.value, 'disabledMcpjsonServers'))),
    mcpEnabled: sortedUnique(read.flatMap(entry => mcpjsonNames(entry.value, 'enabledMcpjsonServers'))),
    isAllProjectMcpEnabled: approvesAll,
  }
}

/**
 * The plugin keys isPluginKey refuses that clean leaves unchanged; a key clean changes is named by its hidden-name
 * warning alone, which says why it was ignored (D-349, supersedes the direction of D-337).
 */
function refusedPluginKeys(keys: readonly string[]): string[] {
  return keys.filter(key => !isChangedByClean(key, MAX_KEY_CHARS) && !isPluginKey(key))
}

/**
 * One warning per settings key and enabledPlugins key that clean would change, as the Facts report them, then the
 * enabledPlugins keys isPluginKey refuses that clean leaves unchanged (refusedPluginKeys), which parseEnabledPlugins
 * skipped, named and capped (ignoredPluginKeyWarnings, D-267, D-349), so each refused key is named once.
 */
export function settingsNameWarnings(sources: readonly SettingsEntry[]): string[] {
  const pluginKeys = sources.flatMap(entry => fieldKeysOf(entry.value, 'enabledPlugins'))

  return [
    ...hiddenNameWarnings(sources.flatMap(entry => keysOf(entry.value)), 'settingsKey', MAX_KEY_CHARS),
    ...hiddenNameWarnings(pluginKeys, 'enabledPluginsKey', MAX_KEY_CHARS),
    ...ignoredPluginKeyWarnings(refusedPluginKeys(pluginKeys)),
  ]
}

/** Each settings source the port can read as a plain object, in override order; any other source adds a warning. */
export async function readSettings(io: InitIo, warnings: string[]): Promise<SettingsEntry[]> {
  const read: SettingsEntry[] = []
  for (const source of SOURCE_ORDER) {
    const value = await io.settings(source)
    if (!isObject(value)) {
      warnings.push(t('scan.unknown', { what: t('scan.couldNotReadSettings', { source: source }) }))
      continue
    }
    read.push({ source, value })
  }

  return read
}

/**
 * The keys of the plugins installed for the user or for this repo, from `installed_plugins.json` in the user folder.
 * The install paths, scopes and versions in the file are read only to decide that, and are not kept. A key clean would
 * change is named in a hidden-name warning alone, and a key isPluginKey refuses that clean leaves unchanged
 * (refusedPluginKeys), which parseInstalledPlugins skipped, in an ignored-key warning (ignoredPluginKeyWarnings, D-267,
 * D-349), so each refused key is named once; the file is only read, never rewritten.
 */
export async function installedPluginKeys(
  io: InitIo,
  ctx: SetupContext,
  userDir: string | null,
  warnings: string[],
): Promise<string[]> {
  if (userDir === null) return []
  const value = await readJson(io, ctx, `${userDir}/plugins/installed_plugins.json`, MAX_READ_BYTES, warnings)
  const keys = fieldKeysOf(value, 'plugins')
  warnings.push(
    ...hiddenNameWarnings(keys, 'installedPluginKey', MAX_KEY_CHARS),
    ...ignoredPluginKeyWarnings(refusedPluginKeys(keys)),
  )

  return parseInstalledPlugins(value, ctx.root, ctx.givenRoot).map(plugin => plugin.key)
}
