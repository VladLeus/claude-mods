/**
 * The assignment answers of init (D-52, D-53, D-60, D-63, D-86, D-135, G-02-1b), a layer 10 module: the questions that
 * ask which roles get an MCP server, a skill group or an instruction group, which env variables roles carry and which
 * model and effort a role gets; the own-skills block of the side pane; and the parsers of the answers (parseRoleList,
 * parseModelEffort, parseEnvNames), with assignToRoles, which gives the assigned names to the roles. It is pure and
 * imports core, roles, scan/history, suggest/skills and the shapes of the assignment rules; init.ts and init/handout
 * read it.
 */
import type { Effort, InstructionGroup, RoleSpec, SkillRef } from '../../types'
import { redactSecrets } from '../core/redact'
import { clean, idsOrNone, sortedUnique } from '../core/text'
import { SCREEN_LIST_WORDS, t, tn } from '../locales/t'
import { EFFORTS, isModelName, MODEL_ALIASES } from '../roles/validate'
import { HISTORY_MAX_SESSIONS } from '../scan/history'
import { ownSkillId, skillCount } from '../suggest/skills'
import type { NameAssignment, SkillGroup } from './assign-rules'

/** The dialog button that gives an item to no role. A typed answer of the same words counts the same, in any case. */
export const NONE_OPTION = t('init.answers.noneOption')

/** The dialog button that gives an item to every role. A typed answer of the same words, or `all`, counts the same. */
export const ALL_OPTION = t('init.answers.allOption')

/** The most code points of a scanned name that a question shows. A scanned name is data, not text to trust. */
const MAX_SHOWN_NAME_CHARS = 60

/** The hint that ends every question whose answer is a list of roles. */
const ROLE_ANSWER_HINT = t('init.answers.roleAnswerHint', { none: NONE_OPTION.toLowerCase() })

/** The question for an MCP server the table does not decide. The name is cleaned and cut to 60 code points. */
export function mcpQuestion(name: string): string {
  return t('init.answers.mcpQuestion', { name: clean(name, MAX_SHOWN_NAME_CHARS), roleAnswerHint: ROLE_ANSWER_HINT })
}

/** How often a skill group was used, as the question shows it: ` (used <n> times in recent sessions)`, or nothing. */
function usesText(uses: number | undefined): string {
  if (uses === undefined || uses === 0) return ''

  return tn('init.answers.uses', uses, { count: uses })
}

/**
 * The question for a group of skills the table does not decide. The label is cleaned and cut to 60 code points. With
 * `uses` from the history scan, the question says how often the group was used in recent sessions (D-59); with no
 * uses, or 0, it is worded as without the scan.
 */
export function skillGroupQuestion(group: SkillGroup, uses?: number): string {
  const label = clean(group.label, MAX_SHOWN_NAME_CHARS)

  return t('init.answers.skillGroupQuestion', {
    label,
    count: group.names.length,
    uses: usesText(uses),
    roleAnswerHint: ROLE_ANSWER_HINT,
  })
}

/** What a skill's purpose reads when the engine gave the skill no description (D-139, G-02-1b). */
export const NO_SKILL_PURPOSE = t('init.answers.noSkillPurpose')

/**
 * How often the history scan saw one skill, as the own-skills block and questions say it (G-02-1b): `<n> time(s) in
 * the last 50 sessions`, the skill's own count, never a group total.
 */
export function skillUsesText(count: number): string {
  return tn('init.answers.skillUses', count, { count, sessions: HISTORY_MAX_SESSIONS })
}

/** The first row of the own-skills block (G-02-1b): which skills it lists, and what giving one to a role means. */
const OWN_SKILLS_HEADING = t('init.answers.ownSkillsHeading')

/** The last row of the own-skills block when the model gave no usable recommendation (G-02-1b). */
const NO_SKILL_RECOMMENDATION_ROW = t('init.answers.noSkillRecommendationRow')

/** The ids the recommendation gives the own skills (G-02-1b): S1, S2, ... by their places in the list. */
export function ownSkillIds(skills: readonly SkillRef[]): string[] {
  return skills.map((_, index) => ownSkillId(index))
}

/**
 * One own skill's rows in the block: its name and purpose, the purpose's secret-like spans hidden (redactSecrets, E1),
 * then its own use count (left out at 0) and the roles recommended for it.
 */
function ownSkillRows(skill: SkillRef, count: number, ids: readonly string[]): string[] {
  const used = count === 0 ? '' : t('init.answers.ownSkillUsed', { skillUses: skillUsesText(count) })
  const purpose = redactSecrets(skill.purpose ?? NO_SKILL_PURPOSE)

  return [
    t('init.answers.ownSkillRow', { name: skill.name, purpose }),
    t('init.answers.ownSkillRecommended', { used, ids: idsOrNone(ids, SCREEN_LIST_WORDS.none) }),
  ]
}

/**
 * The own-skills block of the side pane (G-02-1b, D-139): OWN_SKILLS_HEADING, then per skill, in the order given, its
 * name and purpose (NO_SKILL_PURPOSE when the engine gave none) and a row with how often the history scan saw it
 * (skillUsesText; left out at 0, which a run without the history scan gives) and the roles recommended for it, or
 * none. `recommended` is keyed S1, S2, ... by the skills' places in the list; an empty map means the model gave no
 * usable recommendation, and then a last row says so.
 */
export function ownSkillLines(
  skills: readonly SkillRef[],
  uses: ReadonlyMap<string, number>,
  recommended: ReadonlyMap<string, readonly string[]>,
): string[] {
  const rows = skills.flatMap((skill, index) =>
    ownSkillRows(skill, skillCount(skill.name, uses), recommended.get(ownSkillId(index)) ?? []),
  )
  const notes = skills.length > 0 && recommended.size === 0 ? [NO_SKILL_RECOMMENDATION_ROW] : []

  return [OWN_SKILLS_HEADING, ...rows, ...notes]
}

/** Records a role id under the lowercase form of a name, unless the name is blank or an earlier role holds it. */
function addRoleName(names: Map<string, string>, name: string, id: string): void {
  const key = name.trim().toLowerCase()
  if (key === '' || names.has(key)) return
  names.set(key, id)
}

/** Lowercase role id or title to role id. Every id comes before every title, so an id beats another role's title. */
function roleNames(roles: readonly RoleSpec[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  for (const role of roles) addRoleName(names, role.id, role.id)
  for (const role of roles) addRoleName(names, role.title, role.id)

  return names
}

/** Every role id once, in role order. */
function roleIdsInOrder(roles: readonly RoleSpec[]): string[] {
  return Array.from(new Set(roles.map(role => role.id)))
}

/** The answer words that mean no role or every role, lowercase; inside a list they never name a role. */
const ANSWER_WORDS: readonly string[] = Object.freeze([
  NONE_OPTION.toLowerCase(),
  'all',
  ALL_OPTION.toLowerCase(),
])

/**
 * The role ids one comma part of an answer names: the whole part as one role's id or title, which is how a multi-word
 * title such as `Team Lead` is found, else every space-separated word as a role id or a single-word title. Null when a
 * word names no role or is an answer word (`none`, `all`).
 */
function partRoleIds(part: string, names: ReadonlyMap<string, string>): string[] | null {
  if (ANSWER_WORDS.includes(part)) return null
  const whole = names.get(part)
  if (whole !== undefined) return [whole]

  const ids: string[] = []
  for (const word of part.split(/\s+/)) {
    const id = ANSWER_WORDS.includes(word) ? undefined : names.get(word)
    if (id === undefined) return null
    ids.push(id)
  }

  return ids
}

/**
 * Reads a typed answer to "which roles get this?" into role ids (D-53). The answer is case-insensitive. `none` (the
 * None button) gives no roles, and `all` or the All roles button gives every role, only as the whole answer. Otherwise
 * the answer is split on commas first, and each part is tried as a whole role id or title, so `Team Lead, QA` finds the
 * multi-word title; a part that is neither is split on spaces and every word must be a role id or a single-word title,
 * so `tl be` works too. The ids come back once each, in role order. Any unknown word, an empty answer, or `none` or
 * `all` inside a list gives null, so the question is asked again (T-02-19). A role titled `All` or `None` cannot be
 * picked by that word: the answer words always keep their meaning.
 */
export function parseRoleList(answer: string, roles: readonly RoleSpec[]): readonly string[] | null {
  const text = answer.trim().toLowerCase()
  if (text === '') return null
  if (text === NONE_OPTION.toLowerCase()) return []
  if (text === 'all' || text === ALL_OPTION.toLowerCase()) return roleIdsInOrder(roles)

  const names = roleNames(roles)
  const parts = text.split(',').map(part => part.trim()).filter(part => part !== '')
  if (parts.length === 0) return null

  const picked = new Set<string>()
  for (const part of parts) {
    const ids = partRoleIds(part, names)
    if (ids === null) return null
    for (const id of ids) picked.add(id)
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

/**
 * The buttons of the "Model and effort for <role>?" question (D-52): a model family alias and an effort joined by
 * ` + `. Any other pair is typed as free text and read by parseModelEffort.
 */
export const MODEL_EFFORT_OPTIONS: readonly string[] = Object.freeze([
  'opus + medium',
  'sonnet + medium',
  'sonnet + high',
])

/** The button that asks a question once and applies the answer to every role (D-86). */
export const SAME_FOR_ALL = t('init.answers.sameForAll')

/** The button that asks the question for each role in turn (D-86). */
export const PER_ROLE = t('init.answers.perRole')

/** The effort levels `claude --effort` takes on 2.1.295, lowest first (P18); roles.ts owns the list. */
export { EFFORTS }

/** What separates a model from its effort in a typed answer: a plus with or without spaces, or spaces alone. */
const MODEL_EFFORT_SEPARATOR = /\s*\+\s*|\s+/

/** Whether the text is one of the five effort levels. */
function isEffort(text: string): text is Effort {
  return EFFORTS.some(effort => effort === text)
}

/**
 * Reads a typed answer such as `opus + medium`, `sonnet high` or `haiku+low` into a model family alias and an effort,
 * in any case (D-52). The model must be opus, sonnet, haiku or fable (isModelName, A4), so a typo, an effort word or a
 * pinned model id such as `claude-opus-5-5` is refused and a role keeps following the latest model of its family
 * (OQ 8). The effort must be one of EFFORTS. Anything else, a model alone included, gives null so the question is
 * asked again (T-02-19).
 */
export function parseModelEffort(answer: string): { readonly model: string; readonly effort: Effort } | null {
  const [model, effort, ...rest] = answer.trim().toLowerCase().split(MODEL_EFFORT_SEPARATOR)
  if (model === undefined || effort === undefined || rest.length > 0) return null
  if (!isModelName(model) || !isEffort(effort)) return null

  return { model, effort }
}

/**
 * The line init prints for a typed model and effort parseModelEffort refuses (A4): the answer, trimmed like every
 * parser reads it, then cleaned and capped so it cannot add a line or hide text, then an example pair and every model
 * and effort a role may use.
 */
export function modelEffortRefusal(answer: string): string {
  const typed = clean(answer.trim(), MAX_SHOWN_NAME_CHARS)

  return (
    t('init.answers.modelEffortRefusal', {
      typed,
      modelAliases: MODEL_ALIASES.join(', '),
      efforts: EFFORTS.join(', '),
    })
  )
}

/** The button that carries every scanned env variable name. A typed answer of the same words, or `all`, counts too. */
export const ALL_ENV_OPTION = t('init.answers.allEnvOption')

/**
 * Reads a typed answer to "which env variables do roles carry?" into names (D-60). Only names from the scanned list
 * come out, as names and sorted: `none` gives no names, and `all` or the All of them button gives every scanned name.
 * Otherwise every word, split on commas and spaces, must be a scanned name in its exact case. Any other word, which
 * includes a `NAME=value` pair, gives null so the question is asked again; no value is ever read (PLAN-05, T-02-19).
 * The keywords win: an answer that is only `ALL` or only `NONE`, in any case, is read as the keyword, even when a
 * scanned variable has that name, so such a variable can be picked only together with another name.
 */
export function parseEnvNames(answer: string, available: readonly string[]): readonly string[] | null {
  const text = answer.trim()
  if (text === '') return null

  const lower = text.toLowerCase()
  if (lower === NONE_OPTION.toLowerCase()) return []

  const scanned = sortedUnique(available)
  if (lower === 'all' || lower === ALL_ENV_OPTION.toLowerCase()) return scanned

  const words = text.split(/[\s,]+/).filter(word => word !== '')
  if (words.length === 0 || !words.every(word => scanned.includes(word))) return null

  return sortedUnique(words)
}

/** The most scanned names a question shows before it counts the rest: the env and memory questions (D-135). */
const MAX_SHOWN_NAMES = 5

/**
 * The scanned names as a question shows them (D-135): the first MAX_SHOWN_NAMES, each cleaned and cut to 60 code
 * points, then `+N more` when more remain, joined with `, `; empty with no name. It only shapes the text: a name past
 * the fifth is still an answer the question takes.
 */
export function cappedNames(names: readonly string[]): string {
  const shown = names.slice(0, MAX_SHOWN_NAMES).map(name => clean(name, MAX_SHOWN_NAME_CHARS))
  const rest = names.length - shown.length
  const items = rest > 0 ? [...shown, SCREEN_LIST_WORDS.more(rest)] : shown

  return items.join(', ')
}

/**
 * The question for the env variable names roles carry (D-60, D-135). It shows the scanned names as cappedNames gives
 * them, at most five and then how many more; the side pane lists every name before it is asked. Values are never
 * read, so none can be shown.
 */
export function envQuestion(names: readonly string[]): string {
  const shown = cappedNames(names)

  return t('init.answers.envQuestion', { shown, none: NONE_OPTION.toLowerCase() })
}

/** What each instruction group is called in a question (D-63). Only the group is named; no content is ever shown. */
export const INSTRUCTION_LABELS: Readonly<Record<InstructionGroup, string>> = Object.freeze({
  'global-claude-md': t('init.answers.instructionLabelsGlobalClaudeMd'),
  'auto-memory': t('init.answers.instructionLabelsAutoMemory'),
  'project-claude-md': t('init.answers.instructionLabelsProjectClaudeMd'),
})

/** The hint that ends a memory question. */
const MEMORY_ANSWER_HINT = t('init.answers.memoryAnswerHint', { none: NONE_OPTION.toLowerCase() })

/** The names a memory question shows, in brackets, as cappedNames gives them. Empty with no name. */
function shownNames(names: readonly string[]): string {
  if (names.length === 0) return ''

  return t('init.answers.shownNames', { cappedNames: cappedNames(names) })
}

/**
 * The question for an instruction group (D-63): which roles get the global CLAUDE.md files, the auto-memories or the
 * project CLAUDE.md. It shows the group and the names found, the first five cleaned and cut to 60 code points each and
 * the rest counted; the content is never shown.
 */
export function memoryQuestion(group: InstructionGroup, names: readonly string[]): string {
  return t('init.answers.memoryQuestion', {
    instructionLabels: INSTRUCTION_LABELS[group],
    shownNames: shownNames(names),
    memoryAnswerHint: MEMORY_ANSWER_HINT,
  })
}
