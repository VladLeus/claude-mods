/**
 * Facts normalisation, a layer 3 module: the host's raw reads turned into the typed, cleaned Facts detection reads,
 * the repo and docs listings as entries, the warnings for names that clean would change (WR-03), and MAX_READ_BYTES,
 * the read cap every parser shares. Pure: it reads nothing. It imports core, GSD's identity, paths, the settings
 * parsers and the types, so detect, init, the scans and every reader of a host file use it.
 */
import type { EntryKind, Facts, RawFacts, RepoEntry } from '../../../types'
import { fieldKeysOf, isObject } from '../../core/json'
import { clean, isChangedByClean } from '../../core/text'
import { gsdFactOf, usableCandidates } from '../../framework/gsd/identity'
import { t, tn } from '../../locales/t'
import { MAX_WARNING_CHARS, safeWarnings } from '../../paths'
import {
  foldEnabledPlugins,
  MAX_KEY_CHARS,
  orderedSettings,
  parseEnabledPlugins,
  parseHookScripts,
  parseInstalledPlugins,
} from './settings'

/**
 * The most bytes of one file a parser sees. register.tsx applies it after the host's own read cap; a larger file is
 * skipped and a warning is recorded. `fs.list` results are not bounded by it.
 */
export const MAX_READ_BYTES = 256 * 1024
/** Code points a repo or docs entry name keeps; a longer name is cut with an ellipsis. */
const MAX_NAME_CHARS = 255
/** At most this many changed names are named per kind; the rest are counted in one more warning. */
const MAX_HIDDEN_NAME_WARNINGS = 5
/** Code points a changed name keeps in its warning, once cleaned. */
const MAX_HIDDEN_NAME_CHARS = 60
/** The entry kinds a listing may carry; an entry of any other kind is dropped. */
const ENTRY_KINDS: readonly EntryKind[] = ['file', 'dir', 'other']

/** What the names of a hidden-name warning are: each kind has whole sentences of its own (D-223). */
export type HiddenNameKind =
  | 'repoEntry'
  | 'docsEntry'
  | 'enabledPluginsKey'
  | 'installedPluginKey'
  | 'settingsKey'
  | 'mcpServerName'
  | 'commandOrPluginName'
  | 'memoryFileName'
  | 'agentName'

/**
 * The two sentences of each hidden-name kind: the one that names a changed name and the counted one for the rest, each
 * filled from its literal key, so its slots are typed (D-223, D-224).
 */
const HIDDEN_NAME_TEXTS: Readonly<
  Record<HiddenNameKind, { readonly named: (shown: string) => string; readonly more: (rest: number) => string }>
> = Object.freeze({
  repoEntry: {
    named: (shown: string) => t('scan.hidden.repoEntry', { shown }),
    more: (rest: number) => tn('scan.hidden.repoEntryMore', rest, { rest }),
  },
  docsEntry: {
    named: (shown: string) => t('scan.hidden.docsEntry', { shown }),
    more: (rest: number) => tn('scan.hidden.docsEntryMore', rest, { rest }),
  },
  enabledPluginsKey: {
    named: (shown: string) => t('scan.hidden.enabledPluginsKey', { shown }),
    more: (rest: number) => tn('scan.hidden.enabledPluginsKeyMore', rest, { rest }),
  },
  installedPluginKey: {
    named: (shown: string) => t('scan.hidden.installedPluginKey', { shown }),
    more: (rest: number) => tn('scan.hidden.installedPluginKeyMore', rest, { rest }),
  },
  settingsKey: {
    named: (shown: string) => t('scan.hidden.settingsKey', { shown }),
    more: (rest: number) => tn('scan.hidden.settingsKeyMore', rest, { rest }),
  },
  mcpServerName: {
    named: (shown: string) => t('scan.hidden.mcpServerName', { shown }),
    more: (rest: number) => tn('scan.hidden.mcpServerNameMore', rest, { rest }),
  },
  commandOrPluginName: {
    named: (shown: string) => t('scan.hidden.commandOrPluginName', { shown }),
    more: (rest: number) => tn('scan.hidden.commandOrPluginNameMore', rest, { rest }),
  },
  memoryFileName: {
    named: (shown: string) => t('scan.hidden.memoryFileName', { shown }),
    more: (rest: number) => tn('scan.hidden.memoryFileNameMore', rest, { rest }),
  },
  agentName: {
    named: (shown: string) => t('scan.hidden.agentName', { shown }),
    more: (rest: number) => tn('scan.hidden.agentNameMore', rest, { rest }),
  },
})

/**
 * One warning per name that clean would change at `maxChars`, naming its cleaned form capped at MAX_HIDDEN_NAME_CHARS,
 * at most MAX_HIDDEN_NAME_WARNINGS of them, then one warning that counts the rest. A name given twice, such as the same
 * key in two settings files, counts once. `kind` picks the sentences that say what the names are (HiddenNameKind).
 */
export function hiddenNameWarnings(names: readonly string[], kind: HiddenNameKind, maxChars: number): string[] {
  const texts = HIDDEN_NAME_TEXTS[kind]
  const changed = Array.from(new Set(names.filter(name => isChangedByClean(name, maxChars))))
  const named = changed.slice(0, MAX_HIDDEN_NAME_WARNINGS).map(name => {
    const shown = clean(name, MAX_HIDDEN_NAME_CHARS)

    return clean(texts.named(shown), MAX_WARNING_CHARS)
  })
  const rest = changed.length - named.length
  if (rest === 0) return named

  return [...named, texts.more(rest)]
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
    ...hiddenNameWarnings(entryNames(raw.repoEntries), 'repoEntry', MAX_NAME_CHARS),
    ...hiddenNameWarnings(entryNames(raw.docsEntries), 'docsEntry', MAX_NAME_CHARS),
    ...hiddenNameWarnings(
      settings.flatMap(entry => fieldKeysOf(entry.value, 'enabledPlugins')),
      'enabledPluginsKey',
      MAX_KEY_CHARS,
    ),
    ...hiddenNameWarnings(fieldKeysOf(raw.installedPlugins, 'plugins'), 'installedPluginKey', MAX_KEY_CHARS),
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
