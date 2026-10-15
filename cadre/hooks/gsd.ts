import type { AdapterFact, Detection, Facts, Gate, GsdFact, RepoEntry, SettingProposal } from '../types'

/**
 * The GSD hooks a role cares about, in the order the report lists them, each with the note that says what it does to
 * the role. A hook is listed only when settings register it (D-05).
 */
export const GSD_HOOK_NOTES: readonly AdapterFact[] = [
  { name: 'gsd-context-monitor', note: 'conflicts with the autopilot handoff' },
  { name: 'gsd-secret-read-guard', note: 'useful for Security' },
  {
    name: 'gsd-validate-commit',
    note: 'rejects non-Conventional commit messages when enabled (this repo uses (type): Subject)',
  },
  { name: 'gsd-workflow-guard', note: 'advisory nag when enabled' },
]

/** The script extensions a GSD hook file may carry. A hook is matched by its name without one of them. */
const HOOK_EXTENSIONS: readonly string[] = ['.js', '.sh', '.cjs']

/**
 * GSD's detection from the normalised Facts. A `.planning/` directory or symlink at the repo root means GSD is in use,
 * and in use beats installed. An install counts only when its identity is `proven`; `unknown` and `absent` never make
 * GSD installed (T-01-22). The version comes from the first proven install. The evidence is built from fixed templates,
 * and the version and dir are values that normalizeFacts has already validated.
 */
export function detectGsd(facts: Facts): Detection {
  const planning = facts.repoEntries.find(isPlanningEntry)
  const proven = facts.gsd.filter(fact => fact.identity === 'proven')
  const installEvidenceLines = proven.map(installEvidence)
  const version = proven.length > 0 ? proven[0].version : null

  if (planning !== undefined) {
    return {
      id: 'gsd',
      name: 'GSD',
      status: 'in-use',
      version,
      evidence: [planningEvidence(planning), ...installEvidenceLines],
    }
  }
  if (proven.length > 0) {
    return { id: 'gsd', name: 'GSD', status: 'installed', version, evidence: installEvidenceLines }
  }

  return {
    id: 'gsd',
    name: 'GSD',
    status: 'not-found',
    version: null,
    evidence: ['no .planning/', 'no gsd-core install proven'],
  }
}

/** The `.planning/` entry that marks GSD in use: a directory or a symlink, never a plain file. */
function isPlanningEntry(entry: RepoEntry): boolean {
  return entry.name === '.planning' && (entry.kind === 'dir' || entry.isLink)
}

/** The evidence for the `.planning/` entry. A symlink is named as one, whatever it points at. */
function planningEvidence(entry: RepoEntry): string {
  return entry.isLink ? '.planning/ (symlink)' : '.planning/ (dir)'
}

/** The evidence for one proven install: its version when one could be read, then its display dir. */
function installEvidence(fact: GsdFact): string {
  const label = fact.version === null ? 'gsd-core (version unknown)' : `gsd-core ${fact.version}`

  return `${label} at ${fact.dir}`
}

/** A hook script's name without its extension, or null when the script has none of the known extensions. */
function hookNameOf(script: string): string | null {
  const extension = HOOK_EXTENSIONS.find(ext => script.endsWith(ext))
  if (extension === undefined) return null

  return script.slice(0, -extension.length)
}

/**
 * The GSD_HOOK_NOTES entries whose hook settings register, in GSD_HOOK_NOTES order and once each, however many events
 * or settings sources register the same hook (D-05).
 */
export function gsdHookFacts(facts: Facts): AdapterFact[] {
  const registered = new Set(facts.hookScripts.map(hook => hookNameOf(hook.script)))

  return GSD_HOOK_NOTES.filter(hook => registered.has(hook.name)).map(hook => ({ ...hook }))
}

/**
 * RED placeholder for GSD_GATES. One row that no test expects, so every Task 2 test fails on its assertion.
 * Replaced in the GREEN commit.
 */
export const GSD_GATES: readonly Gate[] = [
  {
    id: 'STUB',
    where: 'STUB',
    kind: 'standing-rule',
    decisionType: null,
    needsHuman: false,
    handling: 'standing-rule',
    kickoff: '',
  },
]

/** RED placeholder for GSD_AUTONOMY. */
export const GSD_AUTONOMY: readonly SettingProposal[] = []
