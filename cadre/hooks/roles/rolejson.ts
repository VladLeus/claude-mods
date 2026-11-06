/**
 * The role.json reader, a layer 4 module: a committed role.json read back into a role, with every field checked by
 * type and pattern, so a bad or missing field refuses the whole file (D-68, ROLE-05, T-02-78). It imports core,
 * records, role validation and the types, so team and init read a role.json here.
 */
import type { InstructionGroup, RoleAutopilot, RoleCarry, RoleSpec } from '../../types'
import { FRAMEWORK_IDS } from '../core/framework-id'
import { isObject, parseJsonValue } from '../core/json'
import { ENV_NAME_PATTERN, NAME_PATTERN } from '../core/names'
import { partRecordsOf } from '../records'
import {
  EFFORTS,
  HOOK_NAME_PATTERN,
  isAutopilotDuration,
  isModelName,
  MAX_THRESHOLD,
  PERMISSION_MODES,
  purposeOf,
  TEMPLATE_IDS,
  titleOf,
  validateRoleId,
} from './validate'

/** The instruction and memory groups a role may be given (D-63). */
const INSTRUCTION_GROUPS: readonly InstructionGroup[] = ['global-claude-md', 'auto-memory', 'project-claude-md']

/** A list of strings that each match the pattern; null when the value is not such a list. */
function namesOf(value: unknown, pattern: RegExp): string[] | null {
  if (!Array.isArray(value)) return null
  const names: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !pattern.test(item)) return null
    names.push(item)
  }

  return names
}

/** A list of instruction groups; null when the value is not a list of the three known groups. */
function groupsOf(value: unknown): InstructionGroup[] | null {
  if (!Array.isArray(value)) return null
  const groups: InstructionGroup[] = []
  for (const item of value) {
    const group = INSTRUCTION_GROUPS.find(candidate => candidate === item)
    if (group === undefined) return null
    groups.push(group)
  }

  return groups
}

/** The id, title, purpose, base and (when it is present) framework of a role.json object; null if one is invalid. */
function identityOf(
  value: Record<string, unknown>,
): Pick<RoleSpec, 'id' | 'title' | 'purpose' | 'basedOn' | 'framework'> | null {
  const id = value.id
  if (typeof id !== 'string' || validateRoleId(id) !== null) return null
  const title = typeof value.title === 'string' ? titleOf(value.title) : null
  const purpose = typeof value.purpose === 'string' ? purposeOf(value.purpose) : null
  const basedOn = value.basedOn === null ? null : TEMPLATE_IDS.find(candidate => candidate === value.basedOn)
  if (title === null || purpose === null || basedOn === undefined) return null
  if (value.framework === undefined) return { id, title, purpose, basedOn }
  const framework = FRAMEWORK_IDS.find(candidate => candidate === value.framework)
  if (framework === undefined) return null

  return { id, title, purpose, basedOn, framework }
}

/** The model, effort and permission mode of a role.json object; null if one is invalid. */
function settingsOf(value: Record<string, unknown>): Pick<RoleSpec, 'model' | 'effort' | 'permissionMode'> | null {
  const model = value.model
  const effort = EFFORTS.find(candidate => candidate === value.effort)
  const permissionMode = PERMISSION_MODES.find(candidate => candidate === value.permissionMode)
  if (typeof model !== 'string' || !isModelName(model)) return null
  if (effort === undefined || permissionMode === undefined) return null

  return { model, effort, permissionMode }
}

/** The autopilot values of a role.json object: a duration in autopilot's grammar, a threshold of 1 to 95, askUser. */
function autopilotOf(value: unknown): RoleAutopilot | null {
  if (!isObject(value)) return null
  const { duration, threshold, askUser } = value
  if (typeof duration !== 'string' || !isAutopilotDuration(duration)) return null
  if (typeof threshold !== 'number' || !Number.isInteger(threshold)) return null
  if (threshold < 1 || threshold > MAX_THRESHOLD || typeof askUser !== 'boolean') return null

  return { duration, threshold, askUser }
}

/** Bash, MCP servers, skills and instruction groups of a role.json object; null if one is invalid. */
function scopeOf(
  value: Record<string, unknown>,
): Pick<RoleSpec, 'hasBash' | 'mcp' | 'skills' | 'instructions'> | null {
  const hasBash = value.hasBash
  const mcp = namesOf(value.mcp, NAME_PATTERN)
  const skills = namesOf(value.skills, NAME_PATTERN)
  const instructions = groupsOf(value.instructions)
  if (typeof hasBash !== 'boolean' || mcp === null || skills === null || instructions === null) return null

  return { hasBash, mcp, skills, instructions }
}

/** What a role.json object carries from the user's settings: two booleans and two lists of names (D-60, D-62). */
function carryOf(value: unknown): RoleCarry | null {
  if (!isObject(value)) return null
  const { autoCompactWindow, statusLine } = value
  const env = namesOf(value.env, ENV_NAME_PATTERN)
  const hooks = namesOf(value.hooks, HOOK_NAME_PATTERN)
  if (typeof autoCompactWindow !== 'boolean' || typeof statusLine !== 'boolean') return null
  if (env === null || hooks === null) return null

  return { autoCompactWindow, statusLine, env, hooks }
}

/**
 * A role.json read back into a role (D-68). The file is committed and anyone can edit it, so every field is checked by
 * type and pattern, and any bad or missing field gives null for the whole file. The schema must be 1 and is dropped;
 * keys that are not part of a role are ignored. A role based on pm with Bash is refused, because PM never has Bash
 * (ROLE-05). The title and purpose are cleaned and capped, not refused. The repo part records (instructionParts and
 * instructionPartsNotGiven, G-02-1f Regen, AUTO-PICK #19 Q1) may each be absent, as in a role.json written before
 * them; when present, each must name a `.md` file below the repo root, a heading clean leaves as it is within 80 code
 * points and a lowercase hex SHA-256, or the whole file gives null (partRecordOf, T-02-78).
 */
export function parseRoleJson(text: string): RoleSpec | null {
  const json = parseJsonValue(text)
  if (json === null || !isObject(json.value) || json.value.schema !== 1) return null

  const identity = identityOf(json.value)
  const settings = settingsOf(json.value)
  const autopilot = autopilotOf(json.value.autopilot)
  const scope = scopeOf(json.value)
  const carry = carryOf(json.value.carry)
  const given = partRecordsOf(json.value.instructionParts)
  const notGiven = partRecordsOf(json.value.instructionPartsNotGiven)
  if (identity === null || settings === null || autopilot === null || scope === null || carry === null) return null
  if (given === null || notGiven === null) return null
  if (identity.basedOn === 'pm' && scope.hasBash) return null
  const role: RoleSpec = { ...identity, ...settings, autopilot, ...scope, carry }
  const withGiven = given === undefined ? role : { ...role, instructionParts: given }

  return notGiven === undefined ? withGiven : { ...withGiven, instructionPartsNotGiven: notGiven }
}
