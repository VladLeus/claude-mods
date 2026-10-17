import type { McpRef, RoleSpec, TemplateRoleId } from '../types'
import { clean } from './facts'
import { freezeRows } from './freeze'

/**
 * The MCP servers that are infrastructure: every role always has them, so they are never asked about, never assigned
 * and never denied (ISO-04, D-77). Scope compile imports this list instead of naming the server a second time.
 */
export const INFRA_MCP_SERVERS: readonly string[] = Object.freeze(['autopilot'])

/**
 * One row of a name table. A scanned name that `pattern` matches goes to the template roles in `roles`; `label` says in
 * words what the row stands for.
 */
export type NameRow = {
  readonly pattern: RegExp
  readonly roles: readonly TemplateRoleId[]
  readonly label: string
}

/** The template roles of a row, frozen like the row that holds them. */
function frozenRoles(...ids: TemplateRoleId[]): readonly TemplateRoleId[] {
  return Object.freeze(ids)
}

/**
 * Which roles an MCP server goes to, by its name (D-53). Rows are tried in order and the first match decides, so a name
 * that fits two rows follows the earlier one. A pattern needs whole words (`-`, `_` or the ends of the name around it)
 * except `playwright|devtools`, which also match inside a longer word.
 */
export const MCP_ROLE_ROWS: readonly NameRow[] = freezeRows([
  { pattern: /(^|[-_])(jira|linear|notion)([-_]|$)/i, roles: frozenRoles('pm', 'tl'), label: 'Jira, Linear or Notion' },
  { pattern: /(playwright|devtools)/i, roles: frozenRoles('fe', 'qa'), label: 'Playwright or DevTools' },
  { pattern: /(^|[-_])github([-_]|$)/i, roles: frozenRoles('tl'), label: 'GitHub' },
])

/** One scanned name given to the roles with these ids. */
export type NameAssignment = {
  readonly name: string
  readonly roleIds: readonly string[]
}

/** The dialog button that gives an item to no role. A typed answer of the same words counts the same, in any case. */
export const NONE_OPTION = 'None'

/** The dialog button that gives an item to every role. A typed answer of the same words, or `all`, counts the same. */
export const ALL_OPTION = 'All roles'

/** The most code points of a scanned name that a question shows. A scanned name is data, not text to trust. */
const MAX_NAME_CHARS = 60

/** The hint that ends every question whose answer is a list of roles. */
const ROLE_ANSWER_HINT = '(e.g. BE, QA, or none)'

/** Orders names by code point, so the order never depends on the locale of the machine. */
function compareNames(a: string, b: string): number {
  if (a === b) return 0

  return a < b ? -1 : 1
}

/** The names once each, in code point order. */
function sortedUnique(names: readonly string[]): string[] {
  return Array.from(new Set(names)).sort(compareNames)
}

/** Whether a role is one of the template roles: by its own id, or by the template role it is based on. */
function isRoleOf(role: RoleSpec, templateIds: readonly TemplateRoleId[]): boolean {
  return templateIds.some(id => id === role.id || id === role.basedOn)
}

/**
 * The ids of the present roles of the first row that matches the name, sorted. Empty when no row matches, and also when
 * the row matches but none of its roles is on the team: the name is then unknown and gets its own question.
 */
function presentRoleIds(rows: readonly NameRow[], name: string, roles: readonly RoleSpec[]): string[] {
  const row = rows.find(candidate => candidate.pattern.test(name))
  if (row === undefined) return []

  return sortedUnique(roles.filter(role => isRoleOf(role, row.roles)).map(role => role.id))
}

/**
 * Splits the scanned MCP servers into the ones the table can give to roles and the names left to ask about. Infra
 * servers are skipped, a name seen twice counts once, and both lists come out sorted. A name goes to the roles of its
 * row that are on the team (a role counts by its id or its `basedOn`); a name no row matches, or whose row has no
 * role on the team, is unknown (D-53).
 */
export function classifyMcp(
  mcp: readonly McpRef[],
  roles: readonly RoleSpec[],
): { readonly assigned: readonly NameAssignment[]; readonly unknown: readonly string[] } {
  const names = sortedUnique(mcp.map(ref => ref.name).filter(name => !INFRA_MCP_SERVERS.includes(name)))
  const assigned: NameAssignment[] = []
  const unknown: string[] = []
  for (const name of names) {
    const roleIds = presentRoleIds(MCP_ROLE_ROWS, name, roles)
    if (roleIds.length === 0) unknown.push(name)
    else assigned.push({ name, roleIds })
  }

  return { assigned, unknown }
}

/** The question for an MCP server the table does not decide. The name is cleaned and cut to 60 code points. */
export function mcpQuestion(name: string): string {
  return `Which roles get the ${clean(name, MAX_NAME_CHARS)} MCP server? ${ROLE_ANSWER_HINT}`
}

/** Lowercase role id or title to role id. Every id comes before every title, so an id beats another role's title. */
function roleNames(roles: readonly RoleSpec[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  const add = (name: string, id: string): void => {
    const key = name.trim().toLowerCase()
    if (key === '' || names.has(key)) return
    names.set(key, id)
  }
  for (const role of roles) add(role.id, role.id)
  for (const role of roles) add(role.title, role.id)

  return names
}

/** Every role id once, in role order. */
function roleIdsInOrder(roles: readonly RoleSpec[]): string[] {
  return Array.from(new Set(roles.map(role => role.id)))
}

/**
 * Reads a typed answer to "which roles get this?" into role ids (D-53). The answer is case-insensitive. `none` (the
 * None button) gives no roles, and `all` or the All roles button gives every role. Otherwise the whole answer may be
 * one role's id or title, which is how a multi-word title such as `Team Lead` is found; failing that the answer is
 * split on commas and spaces and every word must be a role id or a single-word title. The ids come back once each, in
 * role order. Any unknown word, an empty answer, or `none` or `all` mixed into a list gives null, so the question is
 * asked again (T-02-19). A role whose id or title is `all` or `none` cannot be picked by that word: the two words
 * always keep their meaning.
 */
export function parseRoleList(answer: string, roles: readonly RoleSpec[]): readonly string[] | null {
  const text = answer.trim().toLowerCase()
  if (text === '') return null
  if (text === NONE_OPTION.toLowerCase()) return []
  if (text === 'all' || text === ALL_OPTION.toLowerCase()) return roleIdsInOrder(roles)

  const names = roleNames(roles)
  const whole = names.get(text)
  if (whole !== undefined) return [whole]

  const words = text.split(/[\s,]+/).filter(word => word !== '')
  if (words.length === 0) return null

  const picked = new Set<string>()
  for (const word of words) {
    const id = names.get(word)
    if (id === undefined) return null
    picked.add(id)
  }

  return roleIdsInOrder(roles).filter(id => picked.has(id))
}

/** The role with its `mcp` or `skills` list replaced. */
function withNames(role: RoleSpec, field: 'mcp' | 'skills', names: readonly string[]): RoleSpec {
  return field === 'mcp' ? { ...role, mcp: names } : { ...role, skills: names }
}

/**
 * Adds each assigned name to the `mcp` or `skills` list of the roles it lists, and returns new roles; the input is
 * never changed. A name only ever joins a list, so one that goes to two roles is in both and none moves from one role
 * to another. A role that gets names has its list sorted and without repeats, old names included; a role that gets
 * none is returned as it was. A role id that no role has is ignored.
 */
export function assignToRoles(
  roles: readonly RoleSpec[],
  assignments: readonly NameAssignment[],
  field: 'mcp' | 'skills',
): RoleSpec[] {
  return roles.map(role => {
    const mine = assignments.filter(assignment => assignment.roleIds.includes(role.id))
    if (mine.length === 0) return role

    const added = mine.map(assignment => assignment.name)

    return withNames(role, field, sortedUnique([...role[field], ...added]))
  })
}
