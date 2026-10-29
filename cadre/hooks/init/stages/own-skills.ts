/**
 * The own-skills stage of init (G-02-1b, D-139, D-136), a layer 10 module: the hand-out of the skills that come with
 * no plugin, busiest first, with the roles the model recommends for each (recommendedSkillRoles), through the entry
 * question Accept recommendations, Go one by one or Whole group (ownSkillsEntry, ownSkillItems, ownSkillsStep); and
 * the assignment questions it shares with init/stages/assign: askAssignments, which asks which roles get each item,
 * skillGroupItem with its context line (skillsContextLine), and ASSIGNMENT_DISMISSED_REASON. Pure: it asks and calls
 * the model through the InitIo port it is given, imports core, suggest, ui/ask, init/answers, init/assign-rules,
 * init/handout and the memory and model stages, and never imports init.ts, which imports it, or init/run.
 */
import type { InitIo, RoleSpec, SkillRef } from '../../../types'
import { asSentence, clean, compareText, countedNoun, idsOrNone } from '../../core/text'
import { checkedCompletion } from '../../suggest/checked'
import type { Checked } from '../../suggest/checked'
import { parseSkillRecommendation, skillCount, SKILLS_SYSTEM, skillsPrompt } from '../../suggest/skills'
import { accepted, ASK_HEADERS, askChoice, choiceResult, countedChip, showBlock, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import {
  NO_SKILL_PURPOSE,
  ownSkillIds,
  ownSkillLines,
  parseRoleList,
  skillGroupQuestion,
  skillUsesText,
} from '../answers'
import { groupUses } from '../assign-rules'
import type { NameAssignment, SkillGroup } from '../assign-rules'
import { ACCEPT_RECOMMENDATIONS, handoutStep } from '../handout'
import type { HandoutEntry, HandoutItem } from '../handout'
import { ROLE_LIST_OPTIONS, roleListAccepts } from './memory'
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
type AssignItem = {
  readonly question: string
  /** The chip of its dialog: ASK_HEADERS.mcp for a server, ASK_HEADERS.skills for a skill group (G-02-3c). */
  readonly header: string
  readonly names: readonly string[]
}

/**
 * Asks each item once, answered with None, All roles or a typed list of role ids or titles (parseRoleList), and gives
 * every name of the item to the roles the answer named; an answer that names no role list is asked again with why on
 * top (D-136). A dismissal is cancelled with ASSIGNMENT_DISMISSED_REASON and MAX_ASKS answers it cannot read with
 * NO_USABLE_ANSWER_REASON, so no earlier answer is handed back (A1).
 */
export async function askAssignments(
  io: InitIo,
  roles: readonly RoleSpec[],
  items: readonly AssignItem[],
): Promise<StepResult<NameAssignment[]>> {
  const parse = (answer: string): readonly string[] | null => parseRoleList(answer, roles)
  const accepts = roleListAccepts(roles)
  const assignments: NameAssignment[] = []
  for (const item of items) {
    const ask = { question: item.question, spec: { options: ROLE_LIST_OPTIONS, header: item.header }, parse, accepts }
    const roleIds = choiceResult(await askChoice(io, ask), ASSIGNMENT_DISMISSED_REASON)
    if (roleIds.kind === 'cancelled') return roleIds
    assignments.push(...item.names.map(name => ({ name, roleIds: roleIds.value })))
  }

  return accepted(assignments)
}

/**
 * The question of a skill group as askAssignments asks it (D-53, D-59, D-136): skillGroupQuestion with how often the
 * history scan saw the group, the team's role ids and what giving the skills means on its second line, and the Skills
 * chip; its answer gives every skill of the group.
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
 * (D-139), in the group's order.
 */
function ownSkillsOf(skills: readonly SkillRef[], group: SkillGroup): SkillRef[] {
  return group.names.flatMap(name => {
    const found = skills.find(skill => skill.plugin === null && skill.name === name)

    return found === undefined ? [] : [found]
  })
}

/** The skills busiest first by their own use counts, then by name (G-02-1b; user answer 2026-10-21). */
function busiestFirst(skills: readonly SkillRef[], counts: ReadonlyMap<string, number>): SkillRef[] {
  return [...skills].sort(
    (a, b) => skillCount(b.name, counts) - skillCount(a.name, counts) || compareText(a.name, b.name),
  )
}

/**
 * The roles recommended for each of the user's own skills (G-02-1b): one model call reads each role's work and each
 * skill's name, purpose and own use count (skillsPrompt, SKILLS_SYSTEM). A reply parseSkillRecommendation cannot take
 * is sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all (checkedCompletion), and then no skill is
 * recommended to any role: the map is empty. The model has no tools (D-83), and only its checked skill and role ids
 * are kept.
 */
async function recommendedSkillRoles(
  io: InitIo,
  roles: readonly RoleSpec[],
  skills: readonly SkillRef[],
  counts: ReadonlyMap<string, number>,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const skillIds = ownSkillIds(skills)
  const roleIds = roles.map(role => role.id)
  const parse = (reply: string): Checked<ReadonlyMap<string, readonly string[]>> => {
    const parsed = parseSkillRecommendation(reply, skillIds, roleIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.recommended }
  }
  const prompt = (errors: readonly string[]): string => skillsPrompt(roles, skills, counts, errors)

  return checkedCompletion(io, SKILLS_SYSTEM, prompt, parse, () => new Map())
}

/** The entry question of the own-skills hand-out as handoutStep asks it (G-02-1b): context line, chip and answers. */
function ownSkillsEntry(count: number): HandoutEntry {
  return {
    question: ownSkillsQuestion(count),
    context: ownSkillsContextLine(count),
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
function ownSkillItems(
  skills: readonly SkillRef[],
  counts: ReadonlyMap<string, number>,
  recommended: ReadonlyMap<string, readonly string[]>,
): HandoutItem[] {
  const ids = ownSkillIds(skills)

  return skills.flatMap((skill, index) => {
    const id = ids[index]
    if (id === undefined) return []
    const roleIds = recommended.get(id) ?? []
    const context = ownSkillContextLine(skill, skillCount(skill.name, counts), roleIds)
    const header = ownSkillHeader(index + 1, skills.length)

    return [{ id: skill.name, question: ownSkillQuestion(skill.name), context, header, recommended: roleIds }]
  })
}

/**
 * The hand-out of the user's own skills (G-02-1b, D-139); with no such skill it asks nothing. Else, busiest first and
 * then by name, the model recommends roles for each (recommendedSkillRoles) and the side pane shows every skill with
 * what it does, its own use count and the roles recommended for it (ownSkillLines). Then the entry question
 * (handoutStep): Accept recommendations gives each skill its recommended roles, Go one by one asks each skill once in
 * that order (Yes, No or a typed role list) and Whole group asks the group question of D-53 (skillGroupItem). A
 * dismissal is cancelled with ASSIGNMENT_DISMISSED_REASON, and MAX_ASKS answers it cannot read at one question with
 * NO_USABLE_ANSWER_REASON (A1).
 */
export async function ownSkillsStep(
  io: InitIo,
  roles: readonly RoleSpec[],
  scanned: readonly SkillRef[],
  group: SkillGroup | undefined,
  counts: ReadonlyMap<string, number>,
): Promise<StepResult<NameAssignment[]>> {
  if (group === undefined) return accepted([])
  const skills = busiestFirst(ownSkillsOf(scanned, group), counts)
  const recommended = await recommendedSkillRoles(io, roles, skills, counts)
  await showBlock(io, 'skills', ownSkillLines(skills, counts, recommended))
  const items = ownSkillItems(skills, counts, recommended)
  const outcome = await handoutStep(io, ownSkillsEntry(skills.length), items, roles, ASSIGNMENT_DISMISSED_REASON)
  if (outcome.kind === 'cancelled') return outcome
  if (outcome.value.kind === 'whole') return askAssignments(io, roles, [skillGroupItem(group, counts, roles)])
  const { given } = outcome.value

  return accepted(skills.map(skill => ({ name: skill.name, roleIds: given.get(skill.name) ?? [] })))
}
