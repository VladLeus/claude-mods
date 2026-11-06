/**
 * The adapter contract every framework fills, a layer 2 module: the decision types, the unsupported markers and their
 * detection, and the framework choice. It imports only core and the types, so the registry, roles, init and render
 * import it with no cycle.
 */
import type {
  Choice,
  DecisionType,
  Detection,
  DetectStatus,
  Facts,
  FrameworkId,
  RepoEntry,
  UnsupportedMarker,
} from '../../types'
import { SUPPORTED_IDS } from '../core/framework-id'
import { t } from '../locales/t'

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
      t('framework.contract.unsupportedMarkers'),
  },
  {
    marker: '_bmad',
    id: 'bmad',
    name: 'BMAD',
    reason: t('framework.contract.unsupportedMarkersReason'),
  },
  {
    marker: '.specify',
    id: 'spec-kit',
    name: 'spec-kit',
    reason: t('framework.contract.unsupportedMarkersReason2'),
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
      const evidence = [t('framework.contract.detectUnsupported', { marker: row.marker })]

      return { id: row.id, name: row.name, status: 'not-found', version: null, evidence }
    }

    return {
      id: row.id,
      name: row.name,
      status: 'unsupported',
      version: null,
      evidence: [t('framework.contract.detectUnsupported2', {
        marker: row.marker,
      }), t('framework.contract.detectUnsupported3', { reason: row.reason })],
    }
  })
}

/** Whether the repo root has an entry with exactly this name that is a directory or a symlink to anything. */
function hasDirOrLink(entries: readonly RepoEntry[], name: string): boolean {
  return entries.some(entry => entry.name === name && (entry.kind === 'dir' || entry.isLink))
}

/**
 * The adapter choice for a repo, decided from the detections alone. Only `chosen` picks an adapter. A user pick is
 * honoured when it is in use, or when nothing is in use and it is installed; `none` is always honoured. A pick of a
 * supported id that is neither in use nor installed is ignored. Two or more frameworks in use is `ambiguous`, so no
 * framework is chosen for the person and they are asked (D-07). Installed-only never chooses (D-29).
 */
export function chooseFramework(detections: readonly Detection[], userPick: FrameworkId | null): Choice {
  const inUse = SUPPORTED_IDS.filter(id => hasStatus(detections, id, 'in-use'))
  const installed = SUPPORTED_IDS.filter(id => hasStatus(detections, id, 'installed'))
  const unsupported = UNSUPPORTED_MARKERS.map(row => row.id).filter(id => hasStatus(detections, id, 'unsupported'))

  if (userPick === 'none') return pickedByUser('none')
  if (userPick !== null && inUse.includes(userPick)) return pickedByUser(userPick)
  if (inUse.length === 0 && userPick !== null && installed.includes(userPick)) return pickedByUser(userPick)
  if (inUse.length >= 2) return { kind: 'ambiguous', ids: inUse }
  const [onlyId] = inUse
  if (inUse.length === 1 && onlyId !== undefined) return onlyInUse(onlyId)
  if (installed.length > 0) return { kind: 'installed-only', ids: installed }
  if (unsupported.length > 0) return { kind: 'unsupported', ids: unsupported }

  return { kind: 'none' }
}

/** Whether some detection has this id with this status. */
function hasStatus(detections: readonly Detection[], id: string, status: DetectStatus): boolean {
  return detections.some(detection => detection.id === id && detection.status === status)
}

/** A choice the person made, with the reason the report shows for it. */
function pickedByUser(id: FrameworkId): Choice {
  return { kind: 'chosen', id, pickedBy: 'user', reason: t('framework.contract.pickedByUser') }
}

/** The choice when exactly one supported framework is in use. */
function onlyInUse(id: FrameworkId): Choice {
  return { kind: 'chosen', id, pickedBy: 'only-one-in-use', reason: t('framework.contract.onlyInUse', { id }) }
}

/** Whether a value is one of DECISION_TYPES. A value that is not a string is never a decision type. */
export function isDecisionType(value: unknown): value is DecisionType {
  if (typeof value !== 'string') return false

  return DECISION_TYPES.some(type => type === value)
}
