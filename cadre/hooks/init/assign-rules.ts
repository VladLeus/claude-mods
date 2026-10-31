/**
 * The assignment rules of init (D-53, D-59, ISO-04), a layer 10 module: classifyMcp and classifySkills split the
 * scanned MCP servers and skills into the ones the role table gives to the team's roles (NameAssignment) and the ones
 * left to ask about, the skills in groups by the plugin that adds them (SkillGroup); groupUses and orderGroupsByUse
 * order those groups by how often the history scan saw them. It is pure and imports core, framework/registry and roles;
 * init.ts and init/answers read it.
 */
import type { McpRef, RoleSpec, SkillRef } from '../../types'
import { asciiLower, compareText, sortedUnique } from '../core/text'
import { ADAPTERS } from '../framework/registry'
import { t } from '../locales/t'
import { INFRA_MCP_SERVERS, INFRA_SKILLS, MCP_ROLE_ROWS, SKILL_ROLE_ROWS } from '../roles/infra'
import type { NameRow } from '../roles/infra'
import { standsFor } from '../roles/template'

/** One scanned name given to the roles with these ids. */
export type NameAssignment = {
  readonly name: string
  readonly roleIds: readonly string[]
}

/**
 * Skills the table does not decide, grouped by the plugin that adds them so one question covers the group. `label` is
 * the plugin name, or `your own` for user and project skills, which share one group (`plugin` null). `names` is sorted.
 */
export type SkillGroup = {
  readonly label: string
  readonly plugin: string | null
  readonly names: readonly string[]
}

/** The label of the skill group that holds the user's own skills and the project's, which no plugin adds. */
const OWN_SKILLS_LABEL = t('init.assignRules.ownSkillsLabel')

/**
 * The ids of the present roles of the first row that matches the name, sorted. Empty when no row matches, and also when
 * the row matches but none of its roles is on the team: the name is then unknown and gets its own question. A role is
 * present when it stands for one of the row's template roles, by its id or its basedOn.
 */
function presentRoleIds(rows: readonly NameRow[], name: string, roles: readonly RoleSpec[]): string[] {
  const row = rows.find(candidate => candidate.pattern.test(name))
  if (row === undefined) return []
  const present = roles.filter(role => row.roles.some(id => standsFor(role, id)))

  return sortedUnique(present.map(role => role.id))
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

/**
 * The skills once each by name and plugin, so a same-named skill from another plugin stays in its own group; sorted by
 * name, then by plugin with the user's own skills (no plugin) first.
 */
function uniqueSkills(skills: readonly SkillRef[]): SkillRef[] {
  const first = new Map<string, SkillRef>()
  for (const skill of skills) {
    const key = JSON.stringify([skill.name, skill.plugin])
    if (!first.has(key)) first.set(key, skill)
  }

  return Array.from(first.values()).sort(
    (a, b) => compareText(a.name, b.name) || compareText(a.plugin ?? '', b.plugin ?? ''),
  )
}

/** Orders groups by label, with the group of the user's own skills (no plugin) last. */
function compareGroups(a: SkillGroup, b: SkillGroup): number {
  if (a.plugin === null) return b.plugin === null ? 0 : 1
  if (b.plugin === null) return -1

  return compareText(a.label, b.label)
}

/** The skills grouped by plugin, in group order. The skills must already be sorted by name, which the names keep. */
function groupByPlugin(skills: readonly SkillRef[]): SkillGroup[] {
  const namesOf = new Map<string | null, string[]>()
  for (const skill of skills) {
    const names = namesOf.get(skill.plugin)
    if (names === undefined) namesOf.set(skill.plugin, [skill.name])
    else names.push(skill.name)
  }
  const groups = Array.from(namesOf, ([plugin, names]) => ({ label: plugin ?? OWN_SKILLS_LABEL, plugin, names }))

  return groups.sort(compareGroups)
}

/**
 * Splits the scanned skills into the ones the table gives to roles and the groups left to ask about. The handoff
 * skills (infra) and the GSD and superpowers skills (framework, which come through the adapter) are skipped, whichever
 * framework the roles use, and a skill seen twice from the same plugin counts once. A skill goes to the roles of its
 * row that are on the team, once by name whichever plugins add it; one that no row matches, or whose row has no role
 * on the team, joins the group of each plugin that adds it. Assigned skills are sorted by name, groups by label with
 * `your own` last, and the names in a group by name (D-53, ISO-04).
 */
export function classifySkills(
  skills: readonly SkillRef[],
  roles: readonly RoleSpec[],
): { readonly assigned: readonly NameAssignment[]; readonly groups: readonly SkillGroup[] } {
  const assigned: NameAssignment[] = []
  const asked: SkillRef[] = []
  for (const skill of uniqueSkills(skills)) {
    if (INFRA_SKILLS.includes(skill.name) || ADAPTERS.some(adapter => adapter.ownsSkill(skill))) continue

    const roleIds = presentRoleIds(SKILL_ROLE_ROWS, skill.name, roles)
    if (roleIds.length === 0) asked.push(skill)
    else if (!assigned.some(assignment => assignment.name === skill.name)) assigned.push({ name: skill.name, roleIds })
  }

  return { assigned, groups: groupByPlugin(asked) }
}

/**
 * How often the history scan saw the skills of a group in recent sessions: the sum of the counts of its names, each
 * looked up in the form the scan keeps names in (asciiLower), where a name the scan did not see counts 0. It is a hint
 * for the order and the wording of the question only (D-59).
 */
export function groupUses(group: SkillGroup, counts: ReadonlyMap<string, number>): number {
  return group.names.reduce((sum, name) => sum + (counts.get(asciiLower(name)) ?? 0), 0)
}

/**
 * The skill groups busiest first by groupUses; groups with equal uses keep the order they are given in, which is the
 * order classifySkills gives (by label, the user's own skills last). With no counts that order is unchanged, and the
 * list given is never changed (D-59).
 */
export function orderGroupsByUse(groups: readonly SkillGroup[], counts: ReadonlyMap<string, number>): SkillGroup[] {
  return groups
    .map((group, at) => ({ group, at, uses: groupUses(group, counts) }))
    .sort((a, b) => b.uses - a.uses || a.at - b.at)
    .map(ranked => ranked.group)
}
