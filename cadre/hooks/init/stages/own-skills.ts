/**
 * The own-skills part of the assignment stage of init (G-02-1b, D-139, D-136), a layer 10 module: the skills that come
 * with no plugin, busiest first (ownSkillsOf), with the roles the model recommends for each (the skills model effect),
 * handed out through the entry question Accept recommendations, Go one by one or Whole group (ownSkillsEntry,
 * ownSkillItems); and what it shares with init/stages/assign: the AssignItem questions on which roles get an item,
 * skillGroupItem with its context line (skillsContextLine), and ASSIGNMENT_DISMISSED_REASON. Pure: it gives texts and
 * items only, imports core, suggest/skills, ui/ask, init/answers, init/assign-rules, init/handout and the model stage,
 * and never imports init/machine or init/run.
 */
import type { RoleSpec, SkillRef } from '../../../types'
import { asSentence, clean, compareText, countedNoun, idsOrNone } from '../../core/text'
import { skillCount } from '../../suggest/skills'
import { ASK_HEADERS, countedChip, withContext } from '../../ui/ask'
import { NO_SKILL_PURPOSE, ownSkillIds, skillGroupQuestion, skillUsesText } from '../answers'
import { groupUses } from '../assign-rules'
import type { SkillGroup } from '../assign-rules'
import { ACCEPT_RECOMMENDATIONS } from '../handout'
import type { HandoutEntry, HandoutItem } from '../handout'
import { teamContextLine } from './model'

/** Why init cancels when a question on which roles get an MCP server or skills is dismissed or not answered (A1). */
export const ASSIGNMENT_DISMISSED_REASON =
  'A question on which roles get an MCP server or skills was dismissed or not answered.'

/** The context line of a skill group question (D-136): the team's role ids, and what giving the skills means. */
export function skillsContextLine(roles: readonly RoleSpec[]): string {
  const meaning = 'A role given these skills can run them in its session; a role not given them cannot.'

  return `${teamContextLine(roles)} ${meaning}`
}

/** One question on which roles get an item, and the names its answer gives them. */
export type AssignItem = {
  readonly question: string
  /** The chip of its dialog: ASK_HEADERS.mcp for a server, ASK_HEADERS.skills for a skill group (G-02-3c). */
  readonly header: string
  readonly names: readonly string[]
}

/**
 * The question of a skill group as the assignment stage asks it (D-53, D-59, D-136): skillGroupQuestion with how often
 * the history scan saw the group, the team's role ids and what giving the skills means on its second line, and the
 * Skills chip; its answer gives every skill of the group.
 */
export function skillGroupItem(
  group: SkillGroup,
  counts: ReadonlyMap<string, number>,
  roles: readonly RoleSpec[],
): AssignItem {
  return {
    question: withContext(skillGroupQuestion(group, groupUses(group, counts)), skillsContextLine(roles)),
    header: ASK_HEADERS.skills,
    names: group.names,
  }
}

/** The entry answer that asks each of the user's own skills once (G-02-1b). */
const ONE_BY_ONE_LABEL = 'Go one by one'

/** The entry answer that asks the group question of D-53 for all of the user's own skills at once (G-02-1b). */
const WHOLE_GROUP_LABEL = 'Whole group'

/** The answers of the own-skills entry question, in the order the dialog shows them (G-02-1b). */
export const OWN_SKILLS_ENTRY_OPTIONS: readonly string[] = Object.freeze([
  ACCEPT_RECOMMENDATIONS,
  ONE_BY_ONE_LABEL,
  WHOLE_GROUP_LABEL,
])

/** The entry question of the hand-out of the user's own skills (G-02-1b), with how many there are. */
export function ownSkillsQuestion(count: number): string {
  return `How do you want to hand out your own skills (${count})?`
}

/**
 * The context line of the own-skills entry question (G-02-1b, D-136): how many skills no plugin adds, and that the
 * side pane shows what each does and the roles it is recommended for.
 */
export function ownSkillsContextLine(count: number): string {
  const skills = countedNoun(count, 'skill', 'skills')

  return `${skills} with no plugin; the pane shows what each does and the roles it is recommended for.`
}

/** The most code points of a skill name an own-skill question shows. A scanned name is data, not text to trust. */
const MAX_SHOWN_SKILL_CHARS = 60

/** The question of one of the user's own skills (G-02-1b): which roles get it, by its name cleaned and cut to 60. */
export function ownSkillQuestion(name: string): string {
  return `Which roles get the skill ${clean(name, MAX_SHOWN_SKILL_CHARS)}?`
}

/**
 * The context line of an own skill's question (G-02-1b, D-136): what the skill does (NO_SKILL_PURPOSE when the engine
 * gave no description), as a sentence (asSentence, 02-GAPS-B2 N1), how often the history scan saw it (skillUsesText;
 * left out at 0, which a run without the scan gives) and the roles the model recommended for it, or none.
 */
export function ownSkillContextLine(skill: SkillRef, uses: number, recommended: readonly string[]): string {
  const used = uses === 0 ? '' : ` Used ${skillUsesText(uses)}.`

  return `${asSentence(skill.purpose ?? NO_SKILL_PURPOSE)}${used} Recommended: ${idsOrNone(recommended)}.`
}

/**
 * The chip of an own skill's question (G-02-3c): `Skill <i>/<n>`, or just `Skill` when that would be over the 12 code
 * points a chip shows (countedChip).
 */
export function ownSkillHeader(position: number, count: number): string {
  return countedChip('Skill', position, count)
}

/**
 * The user's own skills of the group no plugin adds (G-02-1b), as the setup scan gave them, so with their purposes
 * (D-139), busiest first by their own use counts, then by name (user answer 2026-10-21).
 */
export function ownSkillsOf(
  skills: readonly SkillRef[],
  group: SkillGroup,
  counts: ReadonlyMap<string, number>,
): SkillRef[] {
  const own = group.names.flatMap(name => {
    const found = skills.find(skill => skill.plugin === null && skill.name === name)

    return found === undefined ? [] : [found]
  })

  return own.sort((a, b) => skillCount(b.name, counts) - skillCount(a.name, counts) || compareText(a.name, b.name))
}

/** The entry question of the own-skills hand-out (G-02-1b): its question, context line, chip and answers. */
export function ownSkillsEntry(count: number): HandoutEntry {
  return {
    question: ownSkillsQuestion(count),
    contextLine: ownSkillsContextLine(count),
    header: ASK_HEADERS.skills,
    accept: ACCEPT_RECOMMENDATIONS,
    oneByOne: ONE_BY_ONE_LABEL,
    whole: WHOLE_GROUP_LABEL,
  }
}

/**
 * Each of the user's own skills as a hand-out item (G-02-1b), in the order given: its name as its id, its question,
 * context line and chip, and the roles the recommendation gave it (keyed S1, S2, ... by place), none when it gave none.
 */
export function ownSkillItems(
  skills: readonly SkillRef[],
  counts: ReadonlyMap<string, number>,
  recommended: ReadonlyMap<string, readonly string[]>,
): HandoutItem[] {
  const ids = ownSkillIds(skills)

  return skills.flatMap((skill, index) => {
    const id = ids[index]
    if (id === undefined) return []
    const roleIds = recommended.get(id) ?? []
    const contextLine = ownSkillContextLine(skill, skillCount(skill.name, counts), roleIds)
    const header = ownSkillHeader(index + 1, skills.length)

    return [{ id: skill.name, question: ownSkillQuestion(skill.name), contextLine, header, recommended: roleIds }]
  })
}
