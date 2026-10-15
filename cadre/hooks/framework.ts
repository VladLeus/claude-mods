import type { Choice, DecisionType, Detection, Facts, FrameworkId, RepoEntry, UnsupportedMarker } from '../types'

/**
 * The decision types a gate can carry. Which role owns each type is role data added in Phase 2 (D-15), so this
 * list only names them.
 */
export const DECISION_TYPES: readonly DecisionType[] = ['Product', 'Arch', 'Security', 'QA']

/**
 * The repo-root frameworks cadre detects but does not drive in v1, in report order. A marker is matched by its
 * exact entry name, and its reason is shown when the marker is present.
 */
export const UNSUPPORTED_MARKERS: readonly UnsupportedMarker[] = [
  {
    marker: 'aidlc',
    id: 'aidlc',
    name: 'AI-DLC',
    reason:
      'every stage after Initialization ends in a recorded human approval gate, so autonomous roles would block; ' +
      'no cadre adapter in v1',
  },
  {
    marker: '_bmad',
    id: 'bmad',
    name: 'BMAD',
    reason: 'persona and workflow method with its own gates and _bmad/ runtime; no cadre adapter in v1',
  },
  {
    marker: '.specify',
    id: 'spec-kit',
    name: 'spec-kit',
    reason: 'spec-driven command set under .specify/; no cadre adapter in v1',
  },
]

/**
 * One detection per UNSUPPORTED_MARKERS row, in table order. A marker is present when the repo root holds an entry
 * with exactly its name that is a directory or a symlink; a plain file of that name is not a marker. A present
 * marker is `unsupported`, never `not-found`, so it is never reported as "none".
 */
export function detectUnsupported(facts: Facts): Detection[] {
  return UNSUPPORTED_MARKERS.map((row): Detection => {
    if (!hasDirOrLink(facts.repoEntries, row.marker)) {
      return { id: row.id, name: row.name, status: 'not-found', version: null, evidence: [`no ${row.marker}/`] }
    }

    return {
      id: row.id,
      name: row.name,
      status: 'unsupported',
      version: null,
      evidence: [`${row.marker}/ present`, `detected but unsupported: ${row.reason}`],
    }
  })
}

/** Whether the repo root has an entry with exactly this name that is a directory or a symlink to anything. */
function hasDirOrLink(entries: RepoEntry[], name: string): boolean {
  return entries.some(entry => entry.name === name && (entry.kind === 'dir' || entry.isLink))
}

/** RED placeholder for Task 2: empty on purpose. Replaced in the GREEN commit. */
export const SUPPORTED_IDS: readonly FrameworkId[] = []

/** RED placeholder for Task 2: returns a wrong choice on purpose. Replaced in the GREEN commit. */
export function chooseFramework(detections: Detection[], userPick: FrameworkId | null): Choice {
  return { kind: 'STUB' } as unknown as Choice
}
