/**
 * The skill recommendation prompt, a layer 7 module: the prompt that asks which roles get each of the person's own
 * skills, with the ids and use counts it lists them by, and the check of the model's reply (G-02-1b, D-139). It
 * imports the checked call, core and the types, so init and assign read it here.
 */
import type { RoleSpec, SkillRef } from '../../types'
import { isObject, parseJsonValue } from '../core/json'
import { unfenced, withReplyErrors } from '../core/reply'
import { asciiLower } from '../core/text'
import { PROMPTS, skillRowOf } from '../locales/prompts'
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

/** The line that introduces the skills in the skills prompt. */
const SKILLS_INTRO = PROMPTS.skillsIntro

/** What the skills prompt says for a skill the engine gave no description (G-02-1b). */
const NO_PURPOSE_FOR_MODEL = PROMPTS.noPurposeForModel

/**
 * The skills prompt (G-02-1b): each role as `<id> | <title> | <purpose>`, each skill as `S<n> | <name> | <purpose or
 * (no description)> | used <n> times` (`used 1 time` for one, AUTO-PICK #10), its own count in the history scan (0
 * without the scan), and after a failed reply its exact errors, one per line. Only a skill's name, purpose and count
 * reach it, never its plugin.
 */
export function skillsPrompt(
  roles: readonly Pick<RoleSpec, 'id' | 'title' | 'purpose'>[],
  skills: readonly SkillRef[],
  uses: ReadonlyMap<string, number>,
  errors: readonly string[] = [],
): string {
  const skillLine = (skill: SkillRef, index: number): string => {
    const purpose = skill.purpose ?? NO_PURPOSE_FOR_MODEL

    const count = skillCount(skill.name, uses)

    return fill(skillRowOf(count), { id: ownSkillId(index), name: skill.name, purpose, count })
  }
  const lines = [
    ROLES_INTRO,
    ...roles.map(roleRowText),
    SKILLS_INTRO,
    ...skills.map(skillLine),
  ]

  return withReplyErrors(lines, errors, PROMPTS.replyErrorsIntro)
}

/** What parseSkillRecommendation gives: the roles recommended for each own skill, or every error found (G-02-1b). */
export type SkillRecommendReply =
  | { readonly kind: 'ok'; readonly recommended: ReadonlyMap<string, readonly string[]> }
  | { readonly kind: 'invalid'; readonly errors: readonly string[] }

/**
 * The model's skill recommendation as the role ids recommended for each own skill (G-02-1b). The reply is untrusted:
 * one code fence around it is stripped, and only known skill and role ids survive. Every problem is listed at once
 * (not JSON, no skills object, an unknown skill, a value that is not a list, an unknown role), capped at 20 errors. A
 * usable reply gives every skill an entry: one it leaves out is recommended to no role, and the role ids come once
 * each, in role order. The map is keyed by skill id, in the order of `skillIds`.
 */
export function parseSkillRecommendation(
  reply: string,
  skillIds: readonly string[],
  roleIds: readonly string[],
): SkillRecommendReply {
  const json = parseJsonValue(unfenced(reply))
  if (json === null) return invalidReply([NOT_JSON_ERROR])
  const named = isObject(json.value) ? json.value.skills : undefined
  if (!isObject(named)) return invalidReply([PROMPTS.noSkillsObject])
  const map = roleMapOf('skill', named, skillIds, roleIds)
  if (map.errors.length > 0) return invalidReply(map.errors)
  const recommended = new Map(map.roles)

  return { kind: 'ok', recommended }
}
