/**
 * The Adjust grammar, a layer 4 module: the four changes the person may type to the proposed roles (`add`, `drop`,
 * `rename` and `framework`) and how each one is applied or refused (D-47, D-92). It imports core, the role template,
 * role validation and the types, so init adjusts the proposed roles here.
 */
import type { FrameworkId, RoleSpec } from '../../types'
import { FRAMEWORK_IDS } from '../core/framework-id'
import { idLabel } from '../core/text'
import { roleOf } from './template'
import { CUSTOM_TRAITS, MAX_ROLES, titleOf, validateRoleId } from './validate'

/** The purpose of a role added by the Adjust grammar, which gives no purpose. */
export const CUSTOM_PURPOSE = 'A custom role added by the person running init.'

/**
 * One change to the proposed roles that the person typed (D-47). The grammar is `add <id> <title>`, `drop <id>`,
 * `rename <id> <new-id> [<title>]` and `framework <id> <gsd|superpowers|none>`.
 */
export type AdjustOp =
  | { readonly kind: 'add'; readonly id: string; readonly title: string }
  | { readonly kind: 'drop'; readonly id: string }
  | { readonly kind: 'rename'; readonly id: string; readonly newId: string; readonly title: string | null }
  | { readonly kind: 'framework'; readonly id: string; readonly framework: FrameworkId }

/** `add <id> <title>`: the title is the rest of the line, and a title that runs onto another line does not match. */
const ADJUST_ADD = /^add\s+(\S+)\s+(\S[^\n]*)$/i

/** `drop <id>`. */
const ADJUST_DROP = /^drop\s+(\S+)$/i

/** `rename <id> <new-id> [<title>]`: the title, when there is one, is the rest of the line, never another line. */
const ADJUST_RENAME = /^rename\s+(\S+)\s+(\S+)(?:\s+(\S[^\n]*))?$/i

/** `framework <id> <gsd|superpowers|none>`. */
const ADJUST_FRAMEWORK = /^framework\s+(\S+)\s+(\S+)$/i

/** A title with one pair of double quotes around it removed; any other text is returned as it is. */
function unquoted(text: string): string {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text

  return text.slice(1, -1).trim()
}

/** The `add` operation of a line, or null when the line is not one. */
function addOp(line: string): AdjustOp | null {
  const [, id, rawTitle] = ADJUST_ADD.exec(line) ?? []
  if (id === undefined || rawTitle === undefined) return null
  const title = unquoted(rawTitle)
  if (title === '') return null

  return { kind: 'add', id, title }
}

/** The `drop` operation of a line, or null when the line is not one. */
function dropOp(line: string): AdjustOp | null {
  const [, id] = ADJUST_DROP.exec(line) ?? []
  if (id === undefined) return null

  return { kind: 'drop', id }
}

/** The `rename` operation of a line, or null when the line is not one or its title is empty. */
function renameOp(line: string): AdjustOp | null {
  const [, id, newId, rawTitle] = ADJUST_RENAME.exec(line) ?? []
  if (id === undefined || newId === undefined) return null
  if (rawTitle === undefined) return { kind: 'rename', id, newId, title: null }
  const title = unquoted(rawTitle)
  if (title === '') return null

  return { kind: 'rename', id, newId, title }
}

/** The `framework` operation of a line, or null when the line is not one or names another framework. */
function frameworkOp(line: string): AdjustOp | null {
  const [, id, word] = ADJUST_FRAMEWORK.exec(line) ?? []
  if (id === undefined || word === undefined) return null
  const framework = FRAMEWORK_IDS.find(candidate => candidate === word.toLowerCase())
  if (framework === undefined) return null

  return { kind: 'framework', id, framework }
}

/**
 * The adjustment a line of the person's text asks for (D-47), or null when it is none of the four. The keywords and the
 * framework word ignore case. Ids are taken as typed, with no case folding: applyAdjust checks them. A title that runs
 * onto a second line is refused, so a multi-line answer cannot carry more text in a title.
 */
export function parseAdjust(text: string): AdjustOp | null {
  const line = text.trim()

  return addOp(line) ?? dropOp(line) ?? renameOp(line) ?? frameworkOp(line)
}

/** What applyAdjust returns: the new roles, or why the adjustment was refused. */
type AdjustResult =
  | { readonly kind: 'ok'; readonly roles: readonly RoleSpec[] }
  | { readonly kind: 'error'; readonly message: string }

/** A refused adjustment. */
function refused(message: string): AdjustResult {
  return { kind: 'error', message }
}

/** Whether a role has this id. */
function hasRole(roles: readonly RoleSpec[], id: string): boolean {
  return roles.some(role => role.id === id)
}

/** The refusal for an id no role has. */
function noRole(id: string): AdjustResult {
  return refused(`no role "${idLabel(id)}"`)
}

/** The refusal for an id another role already has. */
function usedId(id: string): AdjustResult {
  return refused(`role id "${idLabel(id)}" is already used`)
}

/** The refusal for a title that cleans to nothing. */
function noTitle(id: string): AdjustResult {
  return refused(`role "${idLabel(id)}" has no title`)
}

/** Appends a custom role, TL-like with no base (D-92); refused when the team is full or the id or title is unusable. */
function addRole(roles: readonly RoleSpec[], id: string, rawTitle: string): AdjustResult {
  if (roles.length >= MAX_ROLES) return refused(`at most ${MAX_ROLES} roles`)
  const idProblem = validateRoleId(id)
  if (idProblem !== null) return refused(idProblem)
  if (hasRole(roles, id)) return usedId(id)
  const title = titleOf(rawTitle)
  if (title === null) return noTitle(id)

  return { kind: 'ok', roles: [...roles, roleOf({ id, title, purpose: CUSTOM_PURPOSE, basedOn: null }, CUSTOM_TRAITS)] }
}

/** Removes a role; refused for an unknown id, and for the last role, because a team needs one. */
function dropRole(roles: readonly RoleSpec[], id: string): AdjustResult {
  if (!hasRole(roles, id)) return noRole(id)
  if (roles.length === 1) return refused('keep at least one role')

  return { kind: 'ok', roles: roles.filter(role => role.id !== id) }
}

/** Gives a role a new id and, when a title is given, a new title, in place; every other field stays. */
function renameRole(roles: readonly RoleSpec[], id: string, newId: string, rawTitle: string | null): AdjustResult {
  if (!hasRole(roles, id)) return noRole(id)
  const idProblem = validateRoleId(newId)
  if (idProblem !== null) return refused(idProblem)
  if (newId !== id && hasRole(roles, newId)) return usedId(newId)
  const title = rawTitle === null ? null : titleOf(rawTitle)
  if (rawTitle !== null && title === null) return noTitle(newId)

  return {
    kind: 'ok',
    roles: roles.map(role => (role.id === id ? { ...role, id: newId, title: title ?? role.title } : role)),
  }
}

/** Sets the framework of one role and no other. */
function setFramework(roles: readonly RoleSpec[], id: string, framework: FrameworkId): AdjustResult {
  if (!hasRole(roles, id)) return noRole(id)

  return { kind: 'ok', roles: roles.map(role => (role.id === id ? { ...role, framework } : role)) }
}

/**
 * Applies one adjustment to the proposed roles (D-47), or says why it is refused: an id that is not usable or is used,
 * an unknown role, a 13th role, or the last role dropped. The roles it is given are never changed.
 */
export function applyAdjust(roles: readonly RoleSpec[], op: AdjustOp): AdjustResult {
  switch (op.kind) {
    case 'add':
      return addRole(roles, op.id, op.title)
    case 'drop':
      return dropRole(roles, op.id)
    case 'rename':
      return renameRole(roles, op.id, op.newId, op.title)
    case 'framework':
      return setFramework(roles, op.id, op.framework)
  }
}
