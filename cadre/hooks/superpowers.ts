import type { Detection, Facts, Gate, KickoffContext, PluginFlag, PluginVersion, RepoEntry } from '../types'

/**
 * Superpowers' detection from the normalised Facts. A `docs/superpowers/` directory or a `.superpowers` entry at the
 * repo root means superpowers is in use, and in use beats installed (D-01). An install is an `enabledPlugins` key that
 * starts with `superpowers@` and is set to true. The match is by prefix, never one exact key, so a malformed key still
 * counts. The version comes from the installed_plugins entry for the first enabled key. The keys are already cleaned
 * and capped by facts.ts, and the evidence is built from fixed templates.
 */
export function detectSuperpowers(facts: Facts): Detection {
  const inUseLines = [
    ...(hasDirOrLink(facts.docsEntries, 'superpowers') ? ['docs/superpowers/'] : []),
    ...(hasDirOrLink(facts.repoEntries, '.superpowers') ? ['.superpowers/'] : []),
  ]
  const enabled = facts.enabledPlugins.filter(isEnabledSuperpowers)
  const installedLines = enabled.map(installedEvidence)
  const version = enabled.length > 0 ? versionOf(enabled[0].key, facts.superpowersVersions) : null

  if (inUseLines.length > 0) {
    return {
      id: 'superpowers',
      name: 'superpowers',
      status: 'in-use',
      version,
      evidence: [...inUseLines, ...installedLines],
    }
  }
  if (enabled.length > 0) {
    return { id: 'superpowers', name: 'superpowers', status: 'installed', version, evidence: installedLines }
  }

  return {
    id: 'superpowers',
    name: 'superpowers',
    status: 'not-found',
    version: null,
    evidence: ['no docs/superpowers/ or .superpowers/', 'no enabled superpowers@ plugin'],
  }
}

/** Whether the entries hold a directory or a symlink with exactly this name. A plain file never counts. */
function hasDirOrLink(entries: RepoEntry[], name: string): boolean {
  return entries.some(entry => entry.name === name && (entry.kind === 'dir' || entry.isLink))
}

/** Whether a flag is an enabled superpowers@ key: the prefix matches and the value is true. */
function isEnabledSuperpowers(flag: PluginFlag): boolean {
  return flag.key.startsWith('superpowers@') && flag.value === true
}

/** The evidence for one enabled key: the key, its value and the settings file it came from. */
function installedEvidence(flag: PluginFlag): string {
  return `enabledPlugins["${flag.key}"]=true (${flag.source})`
}

/** The installed version recorded for one key, or null when installed_plugins has no entry for that key. */
function versionOf(key: string, versions: PluginVersion[]): string | null {
  const match = versions.find(entry => entry.key === key)

  return match === undefined ? null : match.version
}

/**
 * RED placeholder for plan 01-07 task 2: a gate row no expectation matches, so every gate test fails on an assertion.
 * The GREEN commit replaces it with the full gate table.
 */
export const SUPERPOWERS_GATES: readonly Gate[] = [
  {
    id: 'STUB',
    where: 'STUB',
    kind: 'chat',
    decisionType: null,
    needsHuman: false,
    handling: 'escalate',
    kickoff: 'STUB',
  },
]

/** RED placeholder for plan 01-07 task 2: a kickoff no expectation matches. */
export function superpowersKickoffText(ctx: KickoffContext): string {
  return 'STUB'
}

/**
 * RED placeholder for plan 01-07 task 2: an adapter that declares none of the real fields, so every adapter test fails
 * on an assertion. The GREEN commit replaces it with the complete adapter.
 */
export const SUPERPOWERS_ADAPTER = { id: 'STUB' }
