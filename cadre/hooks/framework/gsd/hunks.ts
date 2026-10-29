/**
 * GSD's autonomy hunk data, a layer 2 module in GSD's framework folder: the config values a hunk shows before and
 * after, the hunks to offer for a config read, the op an answered hunk becomes, and when the GSD roles stay attended
 * (D-70, D-72, ROLE-04). It imports core, GSD's adapter and the types, so init, team and the hunk questions in
 * recommend read the hunk data here.
 */
import type { HunkOp, PortRead, SettingProposal } from '../../../types'
import { isObject, parseJsonValue } from '../../core/json'
import { clean, reportText } from '../../core/text'
import { GSD_CONFIG_FILE } from './adapter'

/** The before text of a key the config does not set: GSD then uses its own default (D-70). */
export const NOT_SET_TEXT = 'not set (GSD default)'

/** The before text when GSD_CONFIG_FILE cannot be read or is not a JSON object: the value is not known. */
export const UNKNOWN_CONFIG_TEXT = `unknown (could not read ${GSD_CONFIG_FILE})`

/** Code points of a config value that a hunk shows; a longer value is cut with an ellipsis (T-02-22). */
const MAX_VALUE_CHARS = 80

/** A config key's value as the text a hunk shows: set, with its text, or not set. */
export type ConfigValue = { readonly state: 'set'; readonly text: string } | { readonly state: 'not-set' }

/** A config key's raw parsed value: set, with the value, or not set. */
type RawValue = { readonly state: 'set'; readonly value: unknown } | { readonly state: 'not-set' }

/**
 * A config value as hunk text: a number or boolean as its digits or word, anything else as JSON, so a string shows in
 * quotes and the string "false" never reads like the boolean false (A2). The text is cleaned and capped.
 */
function valueText(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return clean(JSON.stringify(value), MAX_VALUE_CHARS)
}

/**
 * The raw value at a dotted key path in a parsed config. A key counts only when the object has it as its own, so an
 * inherited name is never a value, and a step that is not a plain object ends the walk as not set.
 */
function rawValue(config: unknown, key: string): RawValue {
  let current: unknown = config
  for (const segment of key.split('.')) {
    if (!isObject(current) || !Object.hasOwn(current, segment)) return { state: 'not-set' }
    current = current[segment]
  }

  return { state: 'set', value: current }
}

/**
 * The value at a dotted key path, such as `workflow.text_mode`, in a parsed config, as the text a hunk shows. A key
 * counts only when the object has it as its own, so an inherited name is never a value, and a step that is not a plain
 * object ends the walk as not set. A string is shown JSON-quoted, cleaned and capped at 80 code points, so a repo file
 * cannot add a line to a question (T-02-22). `config` is parsed JSON.
 */
export function configValue(config: unknown, key: string): ConfigValue {
  const found = rawValue(config, key)
  if (found.state === 'not-set') return { state: 'not-set' }

  return { state: 'set', text: valueText(found.value) }
}

/** What the config file gives a lookup: its object, no file, or a file whose value cannot be known. */
type ConfigSource =
  | { readonly kind: 'object'; readonly value: Record<string, unknown> }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unknown' }

/**
 * The config read as a lookup source. A file that is absent is a missing config, but a read that failed, a file over
 * the cap, text that is not JSON and JSON that is not an object are all unknown: never taken for a config that sets
 * nothing.
 */
function configSource(config: PortRead): ConfigSource {
  if (config.state === 'absent') return { kind: 'absent' }
  if (config.state !== 'text') return { kind: 'unknown' }
  const parsed = parseJsonValue(config.text)
  if (parsed === null) return { kind: 'unknown' }
  const { value } = parsed
  if (!isObject(value)) return { kind: 'unknown' }

  return { kind: 'object', value }
}

/** The text a hunk shows as the current value of a key: the key's text, the not-set text, or the unknown text. */
function beforeText(source: ConfigSource, key: string): string {
  if (source.kind === 'absent') return NOT_SET_TEXT
  if (source.kind === 'unknown') return UNKNOWN_CONFIG_TEXT
  const found = configValue(source.value, key)

  return found.state === 'set' ? found.text : NOT_SET_TEXT
}

/** One change to offer: the proposal, and the value its config file holds for its key now, as text. */
export type HunkCandidate = {
  readonly proposal: SettingProposal
  readonly before: string
}

/**
 * Whether the config already holds the target of a proposal: the key is set and its raw value, as JSON, equals the
 * target parsed as JSON (the target text itself when it is not JSON). Cleaned text is never compared, so the string
 * "false" is not the boolean false (A2). An absent or unknown config never holds a target (fail closed).
 */
function isAtTarget(source: ConfigSource, proposal: SettingProposal): boolean {
  if (source.kind !== 'object') return false
  const found = rawValue(source.value, proposal.key)
  if (found.state === 'not-set') return false
  const target = parseJsonValue(proposal.to)?.value ?? proposal.to

  return JSON.stringify(found.value) === JSON.stringify(target)
}

/**
 * The hunks to ask, in the order of the proposals (D-70). Which proposals to offer is the framework adapter's call
 * (autonomyHunks, A5), so every proposal given is offered, unless its raw config value already equals its target,
 * compared as JSON: such a no-op is not offered. A boolean false equals the target `false`, and the string "false"
 * does not (A2). The before text comes from the config read alone: an unreadable config never equals a target, so
 * every proposal is offered then (fail closed). No process runs.
 */
export function hunkCandidates(proposals: readonly SettingProposal[], config: PortRead): HunkCandidate[] {
  const source = configSource(config)
  const candidates: HunkCandidate[] = []
  for (const proposal of proposals) {
    if (isAtTarget(source, proposal)) continue
    candidates.push({ proposal, before: beforeText(source, proposal.key) })
  }

  return candidates
}

/**
 * The target of a proposal as hunk text, the way a before shows a value: the target parsed as JSON (the text itself
 * when it is not JSON), so a string reads JSON-quoted and a boolean or number as itself (A2).
 */
export function targetText(proposal: SettingProposal): string {
  return valueText(parseJsonValue(proposal.to)?.value ?? proposal.to)
}

/**
 * The plan's op for one asked hunk: the change, what the person answered, and the command in display form. `before`
 * and `after` are display text, a string JSON-quoted and a boolean or number as itself, so the plan reads
 * `mode: "interactive" -> "yolo"`; the write runs `command`, never that text. `isAccepted` is exactly the answer,
 * never inferred from `isRequired`. `isRunnable` is true only when the command resolved to an argv; without one
 * (repo-local GSD only) cadre does not run it and the person runs `command` (D-72).
 */
export function hunkOp(
  candidate: HunkCandidate,
  isAccepted: boolean,
  resolved: { readonly argv: readonly string[] | null; readonly display: string },
): HunkOp {
  const { proposal, before } = candidate

  return {
    kind: 'hunk',
    file: proposal.file,
    key: proposal.key,
    before,
    after: targetText(proposal),
    isRequired: proposal.isRequired,
    isAccepted,
    isRunnable: resolved.argv !== null,
    command: resolved.display,
  }
}

/**
 * Whether one answered hunk leaves the GSD roles attended on its own (ROLE-04, B5): it is required, and it was declined
 * or cadre cannot run it (repo-local GSD only). An optional hunk is never unmet.
 */
export function isUnmetHunk(hunk: HunkOp): boolean {
  return hunk.isRequired && (!hunk.isAccepted || !hunk.isRunnable)
}

/**
 * Whether the roles of a framework are attended by its current config alone, without asking (regen, D-70, D-72): a
 * required proposal among those the adapter offers (autonomyHunks, A5) is still offered, that is, not yet at its
 * target. A config that cannot be read never equals a target, so it attends the roles too (fail closed). With no
 * required proposal, as for superpowers and the built-in fallback, nothing is attended.
 */
export function isAttendedFromConfig(proposals: readonly SettingProposal[], config: PortRead): boolean {
  return hunkCandidates(proposals, config).some(candidate => candidate.proposal.isRequired)
}

/** Names joined for a sentence: `a`, `a and b`, `a, b and c`. */
function sentenceList(names: readonly string[]): string {
  const head = names.slice(0, -1)
  const last = names.slice(-1).join('')
  if (head.length === 0) return last

  return `${head.join(', ')} and ${last}`
}

/**
 * The line that says why GSD roles are attended and what ends it: the settings that must be set as proposed. The keys
 * are cleaned like any report cell. With no key the line names no setting.
 */
export function attendedNote(keys: readonly string[]): string {
  const shown = keys.map(reportText)
  const what = shown.length === 0 ? 'its settings' : sentenceList(shown)

  return `attended: GSD needs a person until ${what} ${shown.length === 1 ? 'is' : 'are'} set as proposed`
}
