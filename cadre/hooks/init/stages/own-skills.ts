/**
 * The own-skills part of the assignment stage of init (G-02-1b, D-139, D-136), a layer 10 module: the skills that come
 * with no plugin, busiest first (ownSkillsOf), with the roles the model recommends for each (the skills model effect),
 * handed out through the entry question Accept recommendations, Go one by one or Whole group (ownSkillsEntry,
 * ownSkillItems, each skill with its own context, D-211); and what it shares with init/stages/assign: the AssignItem
 * questions on which roles get an item, the context line of an MCP server question (mcpContextLine), skillGroupItem
 * with its context line (skillsContextLine) and its own context, and ASSIGNMENT_DISMISSED_REASON. Pure: it gives texts
 * and items only, imports core, suggest/skills, ui/ask, ui/blocks/assign, init/answers, init/assign-rules,
 * init/handout and the model stage, and never imports init/machine or init/run.
 */
import type { AskContext, McpRef, RoleSpec, SkillRef } from '../../../types'
import { redactSecrets } from '../../core/redact'
import { asSentence, clean, compareText, idsOrNone } from '../../core/text'
import { SCREEN_LIST_WORDS, t, tn } from '../../locales/t'
import { skillCount } from '../../suggest/skills'
import { ASK_HEADERS, countedChip, withContext } from '../../ui/ask'
import { mcpServerContext, skillContext, skillGroupContext } from '../../ui/blocks/assign'
import type { SkillLine } from '../../ui/blocks/assign'
import { mcpQuestion, NO_SKILL_PURPOSE, ownSkillIds, skillGroupQuestion, skillUsesText } from '../answers'
import { groupUses } from '../assign-rules'
import type { SkillGroup } from '../assign-rules'
import { ACCEPT_RECOMMENDATIONS } from '../handout'
import type { HandoutEntry, HandoutItem } from '../handout'
import { teamContextLine } from './model'

/** Why init cancels when a question on which roles get an MCP server or skills is dismissed or not answered (A1). */
export const ASSIGNMENT_DISMISSED_REASON = t('init.ownSkills.assignmentDismissedReason')

/** The context line of a skill group question (D-136): the team's role ids, and what giving the skills means. */
export function skillsContextLine(roles: readonly RoleSpec[]): string {
  const meaning = t('init.ownSkills.skillsContextLine')

  return `${teamContextLine(roles)} ${meaning}`
}

/** The context line of an MCP server question (D-136): the team's role ids; only a role given it can use it. */
export function mcpContextLine(roles: readonly RoleSpec[]): string {
  return t('init.assign.mcpContextLine', { teamContext: teamContextLine(roles) })
}

/** One question on which roles get an item, the names its answer gives them, and its own context (D-203). */
export type AssignItem = {
  readonly question: string
  /** The chip of its dialog: ASK_HEADERS.mcp for a server, ASK_HEADERS.skills for a skill group (G-02-3c). */
  readonly header: string
  readonly names: readonly string[]
  readonly context: AskContext
}

/**
 * A skill as its question's context lists it (D-211): what it does, NO_SKILL_PURPOSE when the engine gave no
 * description, how often the history scan saw it (skillUsesText; none at 0) and the roles recommended for it.
 */
function skillLineOf(skill: SkillRef, counts: ReadonlyMap<string, number>, recommended: readonly string[]): SkillLine {
  const uses = skillCount(skill.name, counts)

  return {
    name: skill.name,
    purpose: skill.purpose ?? NO_SKILL_PURPOSE,
    uses: uses === 0 ? '' : skillUsesText(uses),
    recommended,
  }
}

/**
 * The question of a skill group as the assignment stage asks it (D-53, D-59, D-136): skillGroupQuestion with how often
 * the history scan saw the group, the team's role ids and what giving the skills means on its second line, and the
 * Skills chip; its answer gives every skill of the group. Its own context lists each skill of the group with what it
 * does, its own uses and the roles `recommended` gives it by name, none when it gives none (skillGroupContext, D-211).
 */
export function skillGroupItem(
  group: SkillGroup,
  counts: ReadonlyMap<string, number>,
  roles: readonly RoleSpec[],
  skills: readonly SkillRef[],
  recommended: ReadonlyMap<string, readonly string[]>,
): AssignItem {
  const lines = group.names.map(name => {
    const skill = skills.find(ref => ref.name === name && ref.plugin === group.plugin) ?? { name, plugin: group.plugin }

    return skillLineOf(skill, counts, recommended.get(name) ?? [])
  })

  return {
    question: withContext(skillGroupQuestion(group, groupUses(group, counts)), skillsContextLine(roles)),
    header: ASK_HEADERS.skills,
    names: group.names,
    context: skillGroupContext(group.label, lines),
  }
}

/** The entry answer that asks each of the user's own skills once (G-02-1b). */
const ONE_BY_ONE_LABEL = t('init.ownSkills.oneByOne')

/** The entry answer that asks the group question of D-53 for all of the user's own skills at once (G-02-1b). */
const WHOLE_GROUP_LABEL = t('init.ownSkills.wholeGroup')

/** The answers of the own-skills entry question, in the order the dialog shows them (G-02-1b). */
export const OWN_SKILLS_ENTRY_OPTIONS: readonly string[] = Object.freeze([
  ACCEPT_RECOMMENDATIONS,
  ONE_BY_ONE_LABEL,
  WHOLE_GROUP_LABEL,
])

/** The entry question of the hand-out of the user's own skills (G-02-1b), with how many there are. */
export function ownSkillsQuestion(count: number): string {
  return t('init.ownSkills.ownSkillsQuestion', { count })
}

/**
 * The context line of the own-skills entry question (G-02-1b, D-136): how many skills no plugin adds, and that the
 * side pane shows what each does and the roles it is recommended for.
 */
export function ownSkillsContextLine(count: number): string {
  return tn('init.ownSkills.noPlugin', count, { count })
}

/** The most code points of a skill name an own-skill question shows. A scanned name is data, not text to trust. */
const MAX_SHOWN_SKILL_CHARS = 60

/** The question of one of the user's own skills (G-02-1b): which roles get it, by its name cleaned and cut to 60. */
export function ownSkillQuestion(name: string): string {
  return t('init.ownSkills.ownSkillQuestion', { name: clean(name, MAX_SHOWN_SKILL_CHARS) })
}

/**
 * The context line of an own skill's question (G-02-1b, D-136): what the skill does (NO_SKILL_PURPOSE when the engine
 * gave no description), as a sentence (asSentence, 02-GAPS-B2 N1) with its secret-like spans hidden (redactSecrets,
 * E1), how often the history scan saw it (skillUsesText; left out at 0, which a run without the scan gives) and the
 * roles the model recommended for it, or none.
 */
export function ownSkillContextLine(skill: SkillRef, uses: number, recommended: readonly string[]): string {
  const used = uses === 0 ? '' : t('init.ownSkills.used', { skillUses: skillUsesText(uses) })
  const purpose = asSentence(redactSecrets(skill.purpose ?? NO_SKILL_PURPOSE))

  return t('init.ownSkills.contextLine', { purpose, used, recommended: idsOrNone(recommended, SCREEN_LIST_WORDS.none) })
}

/**
 * The chip of an own skill's question (G-02-3c): `Skill <i>/<n>`, or just `Skill` when that would be over the 12 code
 * points a chip shows (countedChip).
 */
export function ownSkillHeader(position: number, count: number): string {
  return countedChip(t('init.ownSkills.chip'), position, count)
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
 * context line and chip, the roles the recommendation gave it (keyed S1, S2, ... by place), none when it gave none,
 * and its own context, that skill alone (skillContext, D-236).
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
    const context = skillContext(skillLineOf(skill, counts, roleIds), index + 1, skills.length)
    const question = ownSkillQuestion(skill.name)

    return [{ id: skill.name, question, contextLine, header, recommended: roleIds, context }]
  })
}

/**
 * The entry question of the MCP hand-out (D-250): which roles get the `count` servers, with how many there are and what
 * each server question shows on its second line, the MCP chip, and the shared answers Accept recommendations (only
 * when a server has a recommendation, D-279), Go one by one and Whole group.
 */
export function mcpEntry(count: number): HandoutEntry {
  return {
    question: t('init.assign.mcpEntryQuestion', { count }),
    contextLine: tn('init.assign.mcpEntryContextLine', count, { count }),
    header: ASK_HEADERS.mcp,
    accept: ACCEPT_RECOMMENDATIONS,
    oneByOne: ONE_BY_ONE_LABEL,
    whole: WHOLE_GROUP_LABEL,
  }
}

/**
 * Each MCP server as a hand-out item (D-250), in the order given: its name as its id, its question (mcpQuestion) with
 * the team's role ids on the second line (mcpContextLine), the chip `MCP <i>/<n>`, the roles `recommended` gives it by
 * name, none when it gives none, and its own context: its source, the tools the session lists for it and those roles
 * (mcpServerContext, D-211).
 */
export function mcpServerItems(
  servers: readonly McpRef[],
  toolNames: unknown,
  recommended: ReadonlyMap<string, readonly string[]>,
  roles: readonly RoleSpec[],
): HandoutItem[] {
  return servers.map((ref, index) => {
    const roleIds = recommended.get(ref.name) ?? []

    return {
      id: ref.name,
      question: mcpQuestion(ref.name),
      contextLine: mcpContextLine(roles),
      header: countedChip(t('init.assign.mcpChip'), index + 1, servers.length),
      recommended: roleIds,
      context: mcpServerContext(ref, toolNames, roleIds),
    }
  })
}

/**
 * Each skill of a plugin group as a hand-out item (D-251), in the group's order, asked exactly as an own skill is: its
 * name as its id, ownSkillQuestion, its context line (ownSkillContextLine) with the roles `recommended` gives it by
 * name, none when it gives none, the chip `Skill <i>/<n>` (ownSkillHeader) and its own context (skillContext).
 */
export function groupSkillItems(
  group: SkillGroup,
  skills: readonly SkillRef[],
  counts: ReadonlyMap<string, number>,
  recommended: ReadonlyMap<string, readonly string[]>,
): HandoutItem[] {
  return group.names.map((name, index) => {
    const skill = skills.find(ref => ref.name === name && ref.plugin === group.plugin) ?? { name, plugin: group.plugin }
    const roleIds = recommended.get(name) ?? []

    return {
      id: name,
      question: ownSkillQuestion(name),
      contextLine: ownSkillContextLine(skill, skillCount(name, counts), roleIds),
      header: ownSkillHeader(index + 1, group.names.length),
      recommended: roleIds,
      context: skillContext(skillLineOf(skill, counts, roleIds), index + 1, group.names.length),
    }
  })
}
