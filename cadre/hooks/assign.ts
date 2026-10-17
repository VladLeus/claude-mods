import type { Effort, FrameworkId, InstructionGroup, McpRef, RoleSpec, SkillRef, TemplateRoleId } from '../types'
import { clean, compareText } from './facts'
import { freezeRows } from './freeze'
import { EFFORTS, MODEL_PATTERN } from './roles'

/**
 * The plugins every role session must load: autopilot drives the session, agent-fleet shows it and cadre owns the
 * launcher. Scope settings enable them and never deny them (ISO-04, D-77).
 */
export const INFRA_PLUGINS: readonly string[] = Object.freeze([
  'autopilot@local-mods',
  'agent-fleet@local-mods',
  'cadre@local-mods',
])

/**
 * The skills every role keeps for the autopilot handoff and restart. They are never asked about, never assigned and
 * never denied (ISO-04, D-77).
 */
export const INFRA_SKILLS: readonly string[] = Object.freeze(['create-handoff-doc', 'resume-handoff-doc'])

/**
 * The tools autopilot relies on in every role: its three MCP tools, Skill, and PushNotification. No deny rule may name
 * or cover them (ISO-04, D-77).
 */
export const INFRA_TOOLS: readonly string[] = Object.freeze([
  'mcp__autopilot__restart_session',
  'mcp__autopilot__wait_for',
  'mcp__autopilot__queue_question',
  'Skill',
  'PushNotification',
])

/**
 * The MCP servers that are infrastructure: every role always has them, so they are never asked about, never assigned
 * and never denied (ISO-04, D-77). Scope compile imports this list instead of naming the server a second time.
 */
export const INFRA_MCP_SERVERS: readonly string[] = Object.freeze(['autopilot'])

/**
 * The skills that start and check work in each framework (D-77). Every role of that framework must be able to run
 * them, so scope compile links or enables them; they come through the adapter and are never asked about. The built-in
 * fallback has none: it starts from the kickoff text alone.
 */
export const FRAMEWORK_START_SKILLS: Readonly<Record<FrameworkId, readonly string[]>> = Object.freeze({
  gsd: Object.freeze([
    'gsd-autonomous',
    'gsd-discuss-phase',
    'gsd-plan-phase',
    'gsd-execute-phase',
    'gsd-validate-phase',
    'gsd-code-review',
  ]),
  superpowers: Object.freeze([
    'superpowers:brainstorming',
    'superpowers:writing-plans',
    'superpowers:executing-plans',
    'superpowers:subagent-driven-development',
  ]),
  none: Object.freeze([]),
})

/**
 * Whether a skill belongs to a framework, and so comes through its adapter instead of a question. A GSD skill is named
 * `gsd-...`. A superpowers skill is named `superpowers:...` or is added by the superpowers plugin. The built-in
 * fallback owns no skill.
 */
export function isFrameworkSkill(skill: SkillRef, framework: FrameworkId): boolean {
  if (framework === 'gsd') return skill.name.startsWith('gsd-')
  if (framework === 'superpowers') return skill.plugin === 'superpowers' || skill.name.startsWith('superpowers:')

  return false
}

/** Whether a skill belongs to any framework cadre has an adapter for. */
function isAnyFrameworkSkill(skill: SkillRef): boolean {
  return isFrameworkSkill(skill, 'gsd') || isFrameworkSkill(skill, 'superpowers')
}

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

/**
 * Which roles a skill goes to, by its name (D-53), tried in order like MCP_ROLE_ROWS: `security-review` goes to
 * Security, and frontend and design skills go to FE. A name needs whole words (`-` or `:` around it, or the ends of the
 * name), so `redesign` is not a design skill.
 */
export const SKILL_ROLE_ROWS: readonly NameRow[] = freezeRows([
  { pattern: /(^|[-:])security-review$/, roles: frozenRoles('security'), label: 'security-review' },
  {
    pattern: /(^|[-:])(frontend-design|frontend|design|ui-ux|ui-design)([-:]|$)/i,
    roles: frozenRoles('fe'),
    label: 'frontend and design skills',
  },
])

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

/** The dialog button that gives an item to no role. A typed answer of the same words counts the same, in any case. */
export const NONE_OPTION = 'None'

/** The dialog button that gives an item to every role. A typed answer of the same words, or `all`, counts the same. */
export const ALL_OPTION = 'All roles'

/** The most code points of a scanned name that a question shows. A scanned name is data, not text to trust. */
const MAX_SHOWN_NAME_CHARS = 60

/** The hint that ends every question whose answer is a list of roles. */
const ROLE_ANSWER_HINT = '(e.g. BE, QA, or none)'

/** The label of the skill group that holds the user's own skills and the project's, which no plugin adds. */
const OWN_SKILLS_LABEL = 'your own'

/** The names once each, in code point order. */
function sortedUnique(names: readonly string[]): string[] {
  return Array.from(new Set(names)).sort(compareText)
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
  return `Which roles get the ${clean(name, MAX_SHOWN_NAME_CHARS)} MCP server? ${ROLE_ANSWER_HINT}`
}

/** The skills once each by name, the first sighting kept, sorted by name. */
function uniqueByName(skills: readonly SkillRef[]): SkillRef[] {
  const first = new Map<string, SkillRef>()
  for (const skill of skills) {
    if (!first.has(skill.name)) first.set(skill.name, skill)
  }

  return Array.from(first.values()).sort((a, b) => compareText(a.name, b.name))
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
 * framework the roles use, and a skill seen twice counts once. A skill goes to the roles of its row that are on the
 * team; one that no row matches, or whose row has no role on the team, joins the group of its plugin. Assigned skills
 * are sorted by name, groups by label with `your own` last, and the names in a group by name (D-53, ISO-04).
 */
export function classifySkills(
  skills: readonly SkillRef[],
  roles: readonly RoleSpec[],
): { readonly assigned: readonly NameAssignment[]; readonly groups: readonly SkillGroup[] } {
  const assigned: NameAssignment[] = []
  const asked: SkillRef[] = []
  for (const skill of uniqueByName(skills)) {
    if (INFRA_SKILLS.includes(skill.name) || isAnyFrameworkSkill(skill)) continue

    const roleIds = presentRoleIds(SKILL_ROLE_ROWS, skill.name, roles)
    if (roleIds.length === 0) asked.push(skill)
    else assigned.push({ name: skill.name, roleIds })
  }

  return { assigned, groups: groupByPlugin(asked) }
}

/** The question for a group of skills the table does not decide. The label is cleaned and cut to 60 code points. */
export function skillGroupQuestion(group: SkillGroup): string {
  const label = clean(group.label, MAX_SHOWN_NAME_CHARS)

  return `Which roles get ${label} skills (${group.names.length})? ${ROLE_ANSWER_HINT}`
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
export const SAME_FOR_ALL = 'Same for all roles'

/** The button that asks the question for each role in turn (D-86). */
export const PER_ROLE = 'Per role'

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
 * in any case (D-52). The model must look like a family alias, so a pinned model id such as `claude-opus-5-5`, which
 * has digits, is refused and a role keeps following the latest model of its family (OQ 8). The effort must be one of
 * EFFORTS. Anything else, a model alone included, gives null so the question is asked again (T-02-19).
 */
export function parseModelEffort(answer: string): { readonly model: string; readonly effort: Effort } | null {
  const [model, effort, ...rest] = answer.trim().toLowerCase().split(MODEL_EFFORT_SEPARATOR)
  if (model === undefined || effort === undefined || rest.length > 0) return null
  if (!MODEL_PATTERN.test(model) || !isEffort(effort)) return null

  return { model, effort }
}

/** The button that carries every scanned env variable name. A typed answer of the same words, or `all`, counts too. */
export const ALL_ENV_OPTION = 'All of them'

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

/**
 * The question for the env variable names roles carry (D-60). The scanned names are cleaned and cut to 60 code points
 * each; values are never read, so none can be shown.
 */
export function envQuestion(names: readonly string[]): string {
  const shown = names.map(name => clean(name, MAX_SHOWN_NAME_CHARS)).join(', ')

  return `Which env variables do roles carry? Names: ${shown} (values are never stored; e.g. API_KEY, or none)`
}

/** What each instruction group is called in a question (D-63). Only the group is named; no content is ever shown. */
export const INSTRUCTION_LABELS: Readonly<Record<InstructionGroup, string>> = Object.freeze({
  'global-claude-md': 'your global ~/.claude/CLAUDE.md and the files it imports',
  'auto-memory': 'the auto-memories for this repo',
  'project-claude-md': 'the project CLAUDE.md',
})

/** The most names a memory question shows before it counts the rest. */
const MAX_SHOWN_NAMES = 5

/** The hint that ends a memory question. */
const MEMORY_ANSWER_HINT = '(e.g. PM, TL, or none)'

/** The names a memory question shows, in brackets: the first five cleaned, then how many more. Empty with no name. */
function shownNames(names: readonly string[]): string {
  if (names.length === 0) return ''

  const shown = names.slice(0, MAX_SHOWN_NAMES).map(name => clean(name, MAX_SHOWN_NAME_CHARS))
  const rest = names.length - shown.length
  const items = rest > 0 ? [...shown, `+${rest} more`] : shown

  return ` (${items.join(', ')})`
}

/**
 * The question for an instruction group (D-63): which roles get the global CLAUDE.md files, the auto-memories or the
 * project CLAUDE.md. It shows the group and the names found, the first five cleaned and cut to 60 code points each and
 * the rest counted; the content is never shown.
 */
export function memoryQuestion(group: InstructionGroup, names: readonly string[]): string {
  return `Which roles get ${INSTRUCTION_LABELS[group]}${shownNames(names)}? ${MEMORY_ANSWER_HINT}`
}
