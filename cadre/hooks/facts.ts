import type { Facts, RawFacts, RepoEntry } from '../types'

/** RED placeholder (plan 01-04, task 1): a deliberately wrong value, so the tests fail on their assertions. */
export function clean(value: unknown, maxChars = 120): string {
  return 'STUB'
}

/** RED placeholder (plan 01-04, task 1): a deliberately wrong value, so the tests fail on their assertions. */
export function parseRepoEntries(value: unknown): RepoEntry[] {
  return [{ name: 'STUB', kind: 'other', isLink: true }]
}

/** RED placeholder (plan 01-04, task 1): a deliberately wrong value, so the tests fail on their assertions. */
export function normalizeFacts(raw: RawFacts): Facts {
  return {
    repoEntries: [],
    docsEntries: [],
    enabledPlugins: [],
    hookScripts: [],
    superpowersVersions: [],
    gsd: [],
    warnings: ['STUB'],
  }
}
