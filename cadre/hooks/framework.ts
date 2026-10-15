import type {
  Choice,
  DecisionType,
  Detection,
  DetectStatus,
  Facts,
  FrameworkAdapter,
  FrameworkId,
  Gate,
  RepoEntry,
  UnsupportedMarker,
} from '../types'

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

/**
 * The supported adapter ids, in the order every ambiguous and installed-only list is shown. `none` is the built-in
 * fallback, not a framework found in the repo, so it is never ranked here.
 */
export const SUPPORTED_IDS: readonly FrameworkId[] = ['gsd', 'superpowers']

/**
 * The adapter choice for a repo, decided from the detections alone. Only `chosen` picks an adapter. A user pick is
 * honoured when it is in use, or when nothing is in use and it is installed; `none` is always honoured. Two or more
 * frameworks in use is `ambiguous`, so nothing is preselected (D-07). Installed-only never chooses (D-29).
 */
export function chooseFramework(detections: Detection[], userPick: FrameworkId | null): Choice {
  const inUse = SUPPORTED_IDS.filter(id => hasStatus(detections, id, 'in-use'))
  const installed = SUPPORTED_IDS.filter(id => hasStatus(detections, id, 'installed'))
  const unsupported = UNSUPPORTED_MARKERS.map(row => row.id).filter(id => hasStatus(detections, id, 'unsupported'))

  if (userPick === 'none') return pickedByUser('none')
  if (userPick !== null && inUse.includes(userPick)) return pickedByUser(userPick)
  if (inUse.length === 0 && userPick !== null && installed.includes(userPick)) return pickedByUser(userPick)
  if (inUse.length >= 2) return { kind: 'ambiguous', ids: inUse }
  if (inUse.length === 1) return onlyInUse(inUse[0])
  if (installed.length > 0) return { kind: 'installed-only', ids: installed }
  if (unsupported.length > 0) return { kind: 'unsupported', ids: unsupported }

  return { kind: 'none' }
}

/** Whether some detection has this id with this status. */
function hasStatus(detections: Detection[], id: string, status: DetectStatus): boolean {
  return detections.some(detection => detection.id === id && detection.status === status)
}

/** A choice the person made, with the reason the report shows for it. */
function pickedByUser(id: FrameworkId): Choice {
  return { kind: 'chosen', id, pickedBy: 'user', reason: 'picked by the user' }
}

/** The choice when exactly one supported framework is in use. */
function onlyInUse(id: FrameworkId): Choice {
  return { kind: 'chosen', id, pickedBy: 'only-one-in-use', reason: `only ${id} is in use in this repo` }
}

/** RED placeholder for Task 3: empty on purpose. Replaced in the GREEN commit. */
export const REQUIRED_FIELDS: readonly (keyof FrameworkAdapter)[] = []

/** RED placeholder for Task 3: reports a wrong field on purpose. Replaced in the GREEN commit. */
export function missingFields(adapter: Partial<FrameworkAdapter>): string[] {
  return ['STUB']
}

/** RED placeholder for Task 3: answers with a non-boolean on purpose. Replaced in the GREEN commit. */
export function isDecisionType(value: unknown): value is DecisionType {
  return 'STUB' as unknown as boolean
}

/** RED placeholder for Task 3: reports a wrong problem on purpose. Replaced in the GREEN commit. */
export function gateProblems(gates: Gate[]): string[] {
  return ['STUB']
}
