/**
 * The skill recommendation prompt, a layer 7 module: the prompt that asks which roles get each of the person's own
 * skills, each plugin skill group and each skill in a group, after the MCP answers, with the ids and use counts it
 * lists them by, and the check of the model's reply (G-02-1b, D-139, D-248, D-251). It imports the checked call, core
 * and the types, so init and assign read it here.
 */
import type { RoleSpec, SkillRef } from '../../types'
import { isObject, parseJsonValue } from '../core/json'
import { unfenced, withReplyErrors } from '../core/reply'
import { asciiLower, idsOrNone } from '../core/text'
import { groupSkillRowOf, PROMPTS, skillRowOf } from '../locales/prompts'
import { fill } from '../locales/t'
import { invalidReply, NOT_JSON_ERROR, roleMapOf, roleRowText, ROLES_INTRO } from './checked'

/** How often the history scan saw a skill, its name looked up in the form the scan keeps (asciiLower); 0 if never. */
export function skillCount(name: string, counts: ReadonlyMap<string, number>): number {
  return counts.get(asciiLower(name)) ?? 0
}

/** The id the recommendation gives an own skill (G-02-1b): S1, S2, ... by its place in the list. */
export function ownSkillId(index: number): string {
  return `S${index + 1}`
}

export { SKILLS_SYSTEM } from '../locales/prompts'

/** A plugin skill group as the skills prompt lists it (D-251): the plugin that adds it and its skills, in order. */
export type SkillPromptGroup = {
  readonly plugin: string
  readonly skills: readonly SkillRef[]
}

/**
 * What the skills call recommends (D-248, D-251): the roles of each own skill by name, of each plugin group by plugin,
 * and of each skill in a group by plugin, then by skill name.
 */
export type SkillsRecommendation = {
  readonly own: ReadonlyMap<string, readonly string[]>
  readonly groups: ReadonlyMap<string, readonly string[]>
  readonly groupSkills: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>
}

/** The id the recommendation gives a plugin group (D-251): G1, G2, ... by its place in the list. */
function groupId(index: number): string {
  return `G${index + 1}`
}

/** The id the recommendation gives a skill in a plugin group (D-251): G<g>S<n> by the places of both. */
function groupSkillId(group: number, skill: number): string {
  return `${groupId(group)}${ownSkillId(skill)}`
}

/** The line that introduces the skills in the skills prompt. */
const SKILLS_INTRO = PROMPTS.skillsIntro

/** What the skills prompt says for a skill the engine gave no description (G-02-1b). */
const NO_PURPOSE_FOR_MODEL = PROMPTS.noPurposeForModel

/**
 * The skills prompt (G-02-1b, D-248, D-251): each role as `<id> | <title> | <purpose>`, then `MCP of <id>: <servers
 * or none>` per role from the confirmed MCP answers, each own skill as `S<n> | <name> | <purpose or (no
 * description)> | used <n> times` (`used 1 time` for one, AUTO-PICK #10), each plugin group as `G<g> | <plugin>`
 * followed by its skills as `G<g>S<n> | <name> | <purpose> | used <n> times`, each count its own in the history scan
 * (0 without the scan), and after a failed reply its exact errors, one per line. An own skill's plugin never reaches
 * it.
 */
export function skillsPrompt(
  roles: readonly Pick<RoleSpec, 'id' | 'title' | 'purpose'>[],
  mcpByRole: ReadonlyMap<string, readonly string[]>,
  own: readonly SkillRef[],
  groups: readonly SkillPromptGroup[],
  uses: ReadonlyMap<string, number>,
  errors: readonly string[] = [],
): string {
  const ownRow = (skill: SkillRef, index: number): string => {
    const count = skillCount(skill.name, uses)
    const purpose = skill.purpose ?? NO_PURPOSE_FOR_MODEL

    return fill(skillRowOf(count), { id: ownSkillId(index), name: skill.name, purpose, count })
  }
  const groupSkillRow = (skill: SkillRef, id: string): string => {
    const count = skillCount(skill.name, uses)
    const purpose = skill.purpose ?? NO_PURPOSE_FOR_MODEL

    return fill(groupSkillRowOf(count), { id, name: skill.name, purpose, count })
  }
  const mcpLine = (role: Pick<RoleSpec, 'id'>): string =>
    fill(PROMPTS.mcpOfRole, { id: role.id, servers: idsOrNone(mcpByRole.get(role.id) ?? [], PROMPTS.promptNone) })
  const groupLines = (group: SkillPromptGroup, at: number): string[] => [
    fill(PROMPTS.groupRow, { id: groupId(at), name: group.plugin }),
    ...group.skills.map((skill, index) => groupSkillRow(skill, groupSkillId(at, index))),
  ]
  const lines = [
    ROLES_INTRO,
    ...roles.map(roleRowText),
    ...roles.map(mcpLine),
    SKILLS_INTRO,
    ...own.map(ownRow),
    PROMPTS.groupsIntro,
    ...groups.flatMap(groupLines),
  ]

  return withReplyErrors(lines, errors, PROMPTS.replyErrorsIntro)
}

/** What parseSkillRecommendation gives: the recommendation, or every error found (G-02-1b, D-248). */
export type SkillRecommendReply =
  | { readonly kind: 'ok'; readonly recommended: SkillsRecommendation }
  | { readonly kind: 'invalid'; readonly errors: readonly string[] }

/** The errors of a reply that lacks a map: no skills object, no groups object, or both. */
function missingMaps(skills: unknown, groups: unknown): string[] {
  return [
    ...(isObject(skills) ? [] : [PROMPTS.noSkillsObject]),
    ...(isObject(groups) ? [] : [PROMPTS.noGroupsObject]),
  ]
}

/**
 * The model's skill recommendation (G-02-1b, D-248, D-251). The reply is untrusted: one code fence around it is
 * stripped, and only known ids (S<n> own skills and G<g>S<n> skills in a group in `skills`, G<g> groups in `groups`)
 * and role ids survive. Every problem is listed at once (not JSON, no skills or no groups object, an unknown id, a
 * value that is not a list, an unknown role), capped at 20 errors. A map left out whose id list is empty counts as
 * empty. A usable reply gives every skill and group an entry: one it leaves out is recommended to no role, and the
 * role ids come once each, in role order. The own skills are keyed by name, the groups by plugin, and the skills in a
 * group by plugin, then by name.
 */
export function parseSkillRecommendation(
  reply: string,
  own: readonly SkillRef[],
  groups: readonly SkillPromptGroup[],
  roleIds: readonly string[],
): SkillRecommendReply {
  const json = parseJsonValue(unfenced(reply))
  if (json === null) return invalidReply([NOT_JSON_ERROR])
  const ownIds = own.map((_, index) => ownSkillId(index))
  const inGroupIds = groups.flatMap((group, at) => group.skills.map((_, index) => groupSkillId(at, index)))
  const skillIds = [...ownIds, ...inGroupIds]
  const groupIds = groups.map((_, index) => groupId(index))
  const skills = isObject(json.value) ? json.value.skills : undefined
  const named = isObject(json.value) ? json.value.groups : undefined
  const skillsMap = skills === undefined && skillIds.length === 0 ? {} : skills
  const groupsMap = named === undefined && groupIds.length === 0 ? {} : named
  if (!isObject(skillsMap) || !isObject(groupsMap)) return invalidReply(missingMaps(skillsMap, groupsMap))
  const skillRoles = roleMapOf('skill', skillsMap, skillIds, roleIds)
  const groupRoles = roleMapOf('group', groupsMap, groupIds, roleIds)
  const errors = [...skillRoles.errors, ...groupRoles.errors]
  if (errors.length > 0) return invalidReply(errors)
  const byId = new Map([...skillRoles.roles, ...groupRoles.roles])
  const rolesOf = (id: string): readonly string[] => byId.get(id) ?? []
  const recommended: SkillsRecommendation = {
    own: new Map(own.map((skill, index): [string, readonly string[]] => [skill.name, rolesOf(ownSkillId(index))])),
    groups: new Map(groups.map((group, at): [string, readonly string[]] => [group.plugin, rolesOf(groupId(at))])),
    groupSkills: new Map(
      groups.map((group, at): [string, ReadonlyMap<string, readonly string[]>] => [
        group.plugin,
        new Map(group.skills.map((skill, index) => [skill.name, rolesOf(groupSkillId(at, index))])),
      ]),
    ),
  }

  return { kind: 'ok', recommended }
}
