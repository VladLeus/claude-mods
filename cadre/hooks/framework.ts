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

/**
 * The fields every adapter must declare, in the order missingFields reports them. Nothing type-checks in CI, so
 * this list and missingFields are the runtime contract (DET-04).
 */
export const REQUIRED_FIELDS: readonly (keyof FrameworkAdapter)[] = [
  'id', 'name', 'detectRule', 'detect', 'startWork', 'locations',
  'verify', 'doneSignal', 'humanGates', 'autonomy', 'kickoffText',
]

/** The adapter ids a framework may declare: the supported ones and the built-in fallback. */
const ADAPTER_IDS: readonly string[] = [...SUPPORTED_IDS, 'none']

/** A string with some text once trimmed. */
function isFilledString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

/** A plain object: not null and not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An array with at least one entry. */
function isFilledArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

/** `locations` has a non-empty spec list and a non-empty plan list. */
function hasLocations(value: unknown): boolean {
  return isRecord(value) && isFilledArray(value.spec) && isFilledArray(value.plan)
}

/** `doneSignal` has a non-empty artifact and a non-empty check. */
function hasDoneSignal(value: unknown): boolean {
  return isRecord(value) && isFilledString(value.artifact) && isFilledString(value.check)
}

/** `autonomy` is non-empty, or empty with a note that says why the framework needs no autonomy settings. */
function hasAutonomy(adapter: Record<string, unknown>): boolean {
  if (!Array.isArray(adapter.autonomy)) return false

  return adapter.autonomy.length > 0 || isFilledString(adapter.autonomyNote)
}

/**
 * The rule each required field must pass, read from the adapter as a record. A value of the wrong shape fails its
 * rule instead of throwing, and a field with no rule is always missing.
 */
const FIELD_RULES: Partial<Record<keyof FrameworkAdapter, (adapter: Record<string, unknown>) => boolean>> = {
  id: adapter => ADAPTER_IDS.includes(adapter.id as string),
  name: adapter => isFilledString(adapter.name),
  detectRule: adapter => isFilledString(adapter.detectRule),
  detect: adapter => typeof adapter.detect === 'function',
  startWork: adapter => isFilledArray(adapter.startWork),
  locations: adapter => hasLocations(adapter.locations),
  verify: adapter => isFilledArray(adapter.verify),
  doneSignal: adapter => hasDoneSignal(adapter.doneSignal),
  humanGates: adapter => isFilledArray(adapter.humanGates),
  autonomy: hasAutonomy,
  kickoffText: adapter => typeof adapter.kickoffText === 'function',
}

/** Whether one required field of an adapter passes its rule. A field with no rule never passes. */
function fieldPasses(field: keyof FrameworkAdapter, adapter: Record<string, unknown>): boolean {
  const rule = FIELD_RULES[field]
  if (rule === undefined) return false

  return rule(adapter)
}

/**
 * The required fields an adapter does not declare, in REQUIRED_FIELDS order; [] when it is complete. An empty or
 * wrong-shaped field counts as missing, and a value that is not an object has no fields at all. The input is
 * untrusted, so nothing here throws.
 */
export function missingFields(adapter: Partial<FrameworkAdapter>): string[] {
  const record: Record<string, unknown> = isRecord(adapter) ? adapter : {}

  return REQUIRED_FIELDS.filter(field => !fieldPasses(field, record))
}

/** Whether a value is one of DECISION_TYPES. A value that is not a string is never a decision type. */
export function isDecisionType(value: unknown): value is DecisionType {
  if (typeof value !== 'string') return false

  return DECISION_TYPES.includes(value as DecisionType)
}

/** The problem with a gate's decision type, or null when its kind and decision type agree. */
function decisionTypeProblem(gate: Record<string, unknown>): string | null {
  if (gate.kind === 'standing-rule') {
    return gate.decisionType === null ? null : 'standing-rule gate must have decisionType null'
  }
  if (gate.decisionType === null) return 'decisionType null needs kind standing-rule'
  if (!isDecisionType(gate.decisionType)) return 'unknown decisionType'

  return null
}

/** The problems with one gate's own fields: its decision type against its kind, and its kickoff. */
function gateFieldProblems(gate: Record<string, unknown>): string[] {
  const label = `gate ${String(gate.id)}`
  const problems: string[] = []
  const decisionProblem = decisionTypeProblem(gate)
  if (decisionProblem !== null) problems.push(`${label}: ${decisionProblem}`)
  if (!isFilledString(gate.kickoff)) problems.push(`${label}: empty kickoff`)

  return problems
}

/**
 * The contract problems in a framework's gate table, one message per problem, in gate order. A gate id that repeats
 * is reported once. Gates that share a decision type are separate rows, so they are never compared with each other.
 */
export function gateProblems(gates: Gate[]): string[] {
  if (!Array.isArray(gates)) return ['gates is not an array']

  const problems: string[] = []
  const seen = new Set<unknown>()
  const repeated = new Set<unknown>()
  for (const gate of gates) {
    if (!isRecord(gate)) {
      problems.push('gate is not an object')
      continue
    }
    if (seen.has(gate.id) && !repeated.has(gate.id)) {
      repeated.add(gate.id)
      problems.push(`duplicate gate id ${String(gate.id)}`)
    }
    seen.add(gate.id)
    problems.push(...gateFieldProblems(gate))
  }

  return problems
}
