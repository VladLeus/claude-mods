/**
 * The assignment stage of init (G-02-1b, A3, D-59, D-136, D-211, D-230, D-248, D-249, D-250, D-251, D-280), a layer 10
 * module: the MCP servers handed out after the mcp model call (init/stages/own-skills mcpEntry and mcpServerItems),
 * the skills model call from the confirmed MCP answers, then which roles get each plugin skill group (Accept
 * recommendation, Go one by one through handoutItemsEnter, None, All roles or a typed list), with the team's role ids
 * on each question's second line and each question's own context (ui/blocks/assign), the plugin groups busiest first
 * with the history hints, then the own skills (init/stages/own-skills) with the roles the skills call recommended for
 * them; assignStage, the pure stage that gives each name to the roles its answer names and decides the whole list of
 * each name it asks about. Pure: it gives states and never performs an effect, imports core, locales, suggest/skills,
 * ui/ask, ui/blocks/assign, init/answers, init/assign-rules, init/handout, init/state and the duration, memory and
 * own-skills stages, and never imports init/machine or init/run.
 */
import type { ContextRow, McpRef, RoleSpec, SetupScan, SkillRef } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { compareText, idsOrNone } from '../../core/text'
import { keyLabel, SCREEN_LIST_WORDS, t } from '../../locales/t'
import { ownSkillId } from '../../suggest/skills'
import type { SkillPromptGroup, SkillsRecommendation } from '../../suggest/skills'
import { ASK_HEADERS, choiceAnswer, paneQuestionOf, quotedLabels } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import {
  CLAUDE_AI_SERVER_PREFIX,
  mcpGroupContext,
  mcpSourceText,
  mcpToolNamesOf,
  ownSkillsContext,
} from '../../ui/blocks/assign'
import type { McpLine } from '../../ui/blocks/assign'
import { listWordsOf } from '../../ui/surface'
import { assignToRoles, ownSkillContextRows, ownSkillLines, parseRoleList } from '../answers'
import { classifyMcp, classifySkills, orderGroupsByUse } from '../assign-rules'
import type { NameAssignment, SkillGroup } from '../assign-rules'
import { handoutAnswer, handoutEnter, handoutItemsEnter } from '../handout'
import type { HandoutItem, HandoutNext } from '../handout'
import { reusable, stageCancelled, stageDone, stageFailed, withEffect } from '../state'
import type { Answer, InitState, ModelCall, StageDef } from '../state'
import { idsOf } from './duration'
import { ROLE_LIST_OPTIONS, roleListAccepts } from './memory'
import {
  ASSIGNMENT_DISMISSED_REASON,
  mcpContextLine,
  mcpEntry,
  mcpServerItems,
  groupSkillItems,
  ownSkillItems,
  ownSkillsEntry,
  ownSkillsOf,
  skillGroupItem,
} from './own-skills'
import type { AssignItem } from './own-skills'

/**
 * What the assignment stage works from (D-53, D-59, D-249, D-280): the team, the setup scan and the history counts;
 * the servers and skill groups to ask with the tables' seeds (classifyMcp, classifySkills); the plugin groups in the
 * order asked, busiest first with the hints (orderGroupsByUse); and the group of the user's own skills.
 */
type AssignPlan = {
  readonly roles: readonly RoleSpec[]
  readonly setup: SetupScan
  readonly counts: ReadonlyMap<string, number>
  readonly mcp: ReturnType<typeof classifyMcp>
  readonly skills: ReturnType<typeof classifySkills>
  readonly groups: readonly SkillGroup[]
  readonly ownGroup: SkillGroup | undefined
}

/** Where a plugin-group question is: its tries, its place, the answers before it and the skills call's result. */
type ItemCursor = Omit<Extract<InitState['sub'], { readonly kind: 'assign' }>, 'kind'>

/**
 * The server a name the scan found stands for (D-211): its first ref, as the scan merged them by name; a session
 * server when there is none, which the scan never gives, since the names come from its refs.
 */
function mcpRefOf(mcp: readonly McpRef[], name: string): McpRef {
  return mcp.find(ref => ref.name === name) ?? { name, source: 'session' }
}

/**
 * The AssignPlan of a state's draft; null while the roles, the scans or the history hints are not set. Every server
 * that is not infra is asked through the MCP hand-out (D-249, D-250), then each plugin group, busiest first.
 */
function assignPlan(state: InitState): AssignPlan | null {
  const { roles, gathered, hints } = state.draft
  if (roles === undefined || gathered === undefined || hints === undefined) return null
  const { setup } = gathered
  const mcp = classifyMcp(setup.mcp, roles)
  const skills = classifySkills(setup.skills, roles)
  const pluginGroups = skills.groups.filter(group => group.plugin !== null)
  const groups = orderGroupsByUse(pluginGroups, hints)
  const ownGroup = skills.groups.find(group => group.plugin === null)

  return { roles, setup, counts: hints, mcp, skills, groups, ownGroup }
}

/**
 * The mcp model effect (D-248): one call for every server to ask, each with the source word its question's context
 * shows (mcpSourceText), the tool names the session lists for it among every scanned server (mcpToolNamesOf, names
 * only, D-211, D-272 edge #8) and the roles the name table seeds for it (D-249), before the first server question.
 */
function mcpCalled(state: InitState, plan: AssignPlan): InitState {
  const scanned = plan.setup.mcp.map(ref => ref.name)
  const servers = plan.mcp.names.map(name => ({
    name,
    source: mcpSourceText(mcpRefOf(plan.setup.mcp, name)),
    tools: mcpToolNamesOf(state.toolNames, name, scanned),
    seed: plan.mcp.seeds.get(name) ?? [],
  }))
  const calling: InitState = { ...state, sub: { kind: 'mcp-model', done: [] } }

  return withEffect(calling, { kind: 'model', call: { id: 'mcp', roles: plan.roles, servers } })
}

/**
 * The MCP hand-out (D-250) once the roles recommended for each server are known (the mcp call's answer, or its kept
 * result on a go-back, D-253): with no server to ask the plugin groups come next; else its entry question asks Accept
 * recommendations, Go one by one or Whole group, each server an item with its own context (mcpServerItems).
 */
function mcpStart(state: InitState, plan: AssignPlan, recommended: ReadonlyMap<string, readonly string[]>): InitState {
  const { names } = plan.mcp
  if (names.length === 0) return skillsStart(state, plan, [])
  const refs = names.map(name => mcpRefOf(plan.setup.mcp, name))
  const scanned = plan.setup.mcp.map(ref => ref.name)
  const items = mcpServerItems(refs, state.toolNames, recommended, plan.roles, listWordsOf(state.surface), scanned)
  const context = mcpGroupContext(mcpLinesOf(state, plan, recommended), plan.roles)
  const entry = { ...mcpEntry(names.length), context }

  return mcpHandedOut(state, plan, handoutEnter(entry, items, plan.roles, ASSIGNMENT_DISMISSED_REASON))
}

/**
 * The MCP hand-out at `next` (handoutAnswer, D-250): a question waits at its cursor; Accept or one by one gives each
 * server the roles it was given, recorded first in `done`, and the plugin groups come next; Whole group asks the
 * question for all the servers at once, with the roles the hand-out recommended for each in its context.
 */
function mcpHandedOut(state: InitState, plan: AssignPlan, next: HandoutNext): InitState {
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  if (next.kind === 'ask') {
    const sub: InitState['sub'] = { kind: 'mcp-handout', cursor: next.cursor, done: [] }

    return withEffect({ ...state, sub }, { kind: 'ask', question: next.question, spec: next.spec })
  }
  if (next.outcome.kind === 'whole') {
    const items = state.sub.kind === 'mcp-handout' ? state.sub.cursor.items : []

    return mcpWholeAsked(state, plan, { tries: 1, done: [], recommended: recommendedByName(items) }, null)
  }
  const { given } = next.outcome

  return skillsStart(state, plan, plan.mcp.names.map(name => ({ name, roleIds: given.get(name) ?? [] })))
}

/** Where the question for all the MCP servers is: its tries, the answers before it, the recommendation (D-250). */
type McpWholeCursor = Omit<Extract<InitState['sub'], { readonly kind: 'mcp-whole' }>, 'kind'>

/**
 * Each MCP server of the plan as the contexts of the MCP entry and of the question for all the servers list it
 * (D-250, D-300, D-309): its name, its source (mcpSourceText), how many tool names the session lists for it, the roles
 * `recommended` gives it, none when it gives none, whether it is connected (the session lists a tool for it) and
 * whether it is a claude.ai connector (CLAUDE_AI_SERVER_PREFIX).
 */
function mcpLinesOf(
  state: InitState,
  plan: AssignPlan,
  recommended: ReadonlyMap<string, readonly string[]>,
): McpLine[] {
  const scanned = plan.setup.mcp.map(ref => ref.name)

  return plan.mcp.names.map(name => {
    const tools = mcpToolNamesOf(state.toolNames, name, scanned).length

    return {
      name,
      source: mcpSourceText(mcpRefOf(plan.setup.mcp, name)),
      tools,
      recommended: recommended.get(name) ?? [],
      isConnected: tools > 0,
      isConnector: name.startsWith(CLAUDE_AI_SERVER_PREFIX),
    }
  })
}

/**
 * The question for all the MCP servers at once (D-250): which roles get all `n` of them, with the team's role ids on
 * its second line (mcpContextLine), the MCP chip, and as its own context each server with its source, its tool count
 * and the roles `recommended` gives it (mcpGroupContext over mcpLinesOf), listed by the team's roles on pane surfaces
 * (D-309, D-333), whose summary a pane surface asks in place of that line (D-310).
 */
function mcpWholeItem(
  state: InitState,
  plan: AssignPlan,
  recommended: ReadonlyMap<string, readonly string[]>,
): AssignItem {
  const { names } = plan.mcp
  const question = t('init.assign.mcpWholeQuestion', { count: names.length })
  const context = mcpGroupContext(mcpLinesOf(state, plan, recommended), plan.roles)
  const contextLine = mcpContextLine(plan.roles)
  const pane = paneQuestionOf(question, contextLine, context.summary)

  return {
    question: pane.asked,
    header: ASK_HEADERS.mcp,
    names,
    context: { ...context, pane },
  }
}

/** The question for all the MCP servers at `cursor`, `question` its text once refused (D-250). */
function mcpWholeAsked(state: InitState, plan: AssignPlan, cursor: McpWholeCursor, question: string | null): InitState {
  const ask = itemAsk(mcpWholeItem(state, plan, cursor.recommended), plan.roles)
  const asking: InitState = { ...state, sub: { kind: 'mcp-whole', ...cursor } }

  return withEffect(asking, { kind: 'ask', question: question ?? ask.question, spec: ask.spec })
}

/** The answer to the question for all the MCP servers: every server to the roles it named, then the plugin groups. */
function afterMcpWhole(state: InitState, plan: AssignPlan, sub: McpWholeCursor, answer: string | null): InitState {
  const next = choiceAnswer(itemAsk(mcpWholeItem(state, plan, sub.recommended), plan.roles), sub, answer)
  if (next.kind === 'again') return mcpWholeAsked(state, plan, { ...sub, tries: next.sub.tries }, next.question)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  const done = plan.mcp.names.map(name => ({ name, roleIds: next.value }))

  return skillsStart(state, plan, [...sub.done, ...done])
}

/**
 * The question on which roles get an item (D-53, D-136): its question, None or All roles with its chip and its own
 * context (D-203), a typed list of role ids or titles (parseRoleList), so it takes a typed answer (D-234), what its
 * refusal lists, and ASSIGNMENT_DISMISSED_REASON for a dismissal.
 */
function itemAsk(item: AssignItem, roles: readonly RoleSpec[]): ChoiceAsk<readonly string[]> & {
  readonly dismissedReason: string
} {
  return {
    question: item.question,
    spec: { options: ROLE_LIST_OPTIONS, header: item.header, context: item.context, acceptsTyped: true },
    parse: (answer: string): readonly string[] | null => parseRoleList(answer, roles),
    accepts: roleListAccepts(roles),
    dismissedReason: ASSIGNMENT_DISMISSED_REASON,
  }
}

/**
 * The confirmed MCP servers of each role (D-248): every role id with the names of the servers whose answer gave it
 * to that role, in answer order. It only builds the skills call's input; no recommendation is ever changed by it.
 */
function mcpByRoleOf(roles: readonly RoleSpec[], servers: readonly NameAssignment[]): ReadonlyMap<string, string[]> {
  const namesOf = (id: string): string[] =>
    servers.filter(server => server.roleIds.includes(id)).map(server => server.name)

  return new Map(roles.map(role => [role.id, namesOf(role.id)]))
}

/** A plugin group as the skills prompt lists it (D-251): its plugin and its skills as the scan gave them, in order. */
function promptGroupOf(plan: AssignPlan, group: SkillGroup): SkillPromptGroup {
  const skillOf = (name: string): SkillRef =>
    plan.setup.skills.find(ref => ref.name === name && ref.plugin === group.plugin) ?? { name, plugin: group.plugin }
  const skills = group.names.map(skillOf)

  return { plugin: group.label, skills }
}

/**
 * Whether two MCP assignments per role are the same (D-253): the same role ids, each with the same servers in any
 * order; a missing one (no kept call) is never the same.
 */
function isSameAssignment(
  kept: ReadonlyMap<string, readonly string[]> | null,
  now: ReadonlyMap<string, readonly string[]>,
): boolean {
  if (kept === null || kept.size !== now.size) return false
  const sorted = (names: readonly string[]): string => JSON.stringify([...names].sort(compareText))

  return [...now].every(([id, names]) => {
    const before = kept.get(id)

    return before !== undefined && sorted(before) === sorted(names)
  })
}

/**
 * After the MCP hand-out (D-248): with no own skill and no plugin group the stage is done; else one skills model call
 * recommends roles for the own skills, each plugin group and each skill in a group, from the confirmed MCP servers of
 * each role (`done` holds the server answers). A review go-back reuses the kept result, and calls the model no more,
 * while the confirmed MCP servers of each role are the ones the kept result was built from; a changed MCP answer
 * calls it again (reusable, D-235, D-253).
 */
function skillsStart(state: InitState, plan: AssignPlan, done: readonly NameAssignment[]): InitState {
  const { ownGroup, groups, roles, counts } = plan
  if (ownGroup === undefined && groups.length === 0) return assigned(state, plan, done, [])
  const mcpByRole = mcpByRoleOf(roles, done.slice(0, plan.mcp.names.length))
  const keptSkills = reusable(state)?.skills ?? null
  const isReused = keptSkills !== null && isSameAssignment(reusable(state)?.mcpAssigned ?? null, mcpByRole)
  if (isReused) return itemAsked(state, plan, { tries: 1, index: 0, done, skills: keptSkills }, null)
  const own = ownGroup === undefined ? [] : ownSkillsOf(plan.setup.skills, ownGroup, counts)
  const promptGroups = groups.map(group => promptGroupOf(plan, group))
  const { seeds } = plan.skills
  const call: ModelCall = { id: 'skills', roles, mcpByRole, own, groups: promptGroups, counts, seeds }
  const calling: InitState = { ...state, sub: { kind: 'skills-model', done } }

  return withEffect(calling, { kind: 'model', call })
}

/**
 * The plugin group at `index` as its question asks it (D-53, D-248, D-251): the roles the skills call recommended for
 * the whole group, and its skills with the roles recommended for each, or the table seed when the call fell back
 * (skillGroupItem); its own context starts with `Recommended: <ids or none>` for the group, a recommended row in its
 * rows (D-313), and its summary, which a pane surface asks with the question, counts the skills and names that
 * recommendation (D-310). Undefined after the last group.
 */
function groupAt(
  plan: AssignPlan,
  index: number,
  skills: SkillsRecommendation,
): { readonly group: SkillGroup; readonly item: AssignItem; readonly recommended: readonly string[] } | undefined {
  const group = plan.groups[index]
  if (group === undefined) return undefined
  const perSkill = skills.groupSkills.get(group.label) ?? new Map<string, readonly string[]>()
  const recommended = skills.groups.get(group.label) ?? []
  const roleIds = idsOrNone(recommended, SCREEN_LIST_WORDS.none)
  const line = t('ui.assign.groupRecommended', { roleIds })
  const label = keyLabel('ui.assign.groupRecommended')
  const row: ContextRow = { role: 'recommended', label, text: roleIds, indent: 0 }
  const item = skillGroupItem(group, plan.counts, plan.roles, plan.setup.skills, perSkill, recommended)
  const [first, ...rest] = item.context.rows ?? []
  const rows = [{ title: first?.title ?? null, rows: [row, ...(first?.rows ?? [])] }, ...rest]
  const context = { ...item.context, lines: [line, ...item.context.lines], rows }

  return { group, item: { ...item, context }, recommended }
}

/** The answer label that gives every skill of a plugin group the roles recommended for the group (D-251). */
const ACCEPT_RECOMMENDATION_LABEL = t('init.assign.acceptRecommendation')

/** The answer label that asks each skill of a plugin group on its own (D-251), as the own skills' hand-out does. */
const ONE_BY_ONE_LABEL = t('init.ownSkills.oneByOne')

/**
 * The answers of a plugin group question (D-251): Accept recommendation, only when the group has a recommendation,
 * then Go one by one, None and All roles; a role list is typed (at most four buttons).
 */
function groupOptions(recommended: readonly string[]): readonly string[] {
  const choices = [ONE_BY_ONE_LABEL, ...ROLE_LIST_OPTIONS]

  return recommended.length === 0 ? choices : [ACCEPT_RECOMMENDATION_LABEL, ...choices]
}

/** What an answer to a plugin group question picks (D-251): the recommendation, one by one, or a role list. */
type GroupChoice =
  | { readonly kind: 'accept' }
  | { readonly kind: 'one-by-one' }
  | { readonly kind: 'roles'; readonly roleIds: readonly string[] }

/**
 * The question of a plugin group (D-53, D-251): its question, chip and own context, the answers of groupOptions with a
 * typed role list (D-234); the labels are read first, then the role list (parseRoleList), and what its refusal lists.
 * Paged on a pane surface, Go one by one shows on every page, Accept recommendation on the last page only, and None
 * and All roles on no page, a typed role list still read on any page (pageOptions, D-328).
 */
function groupAsk(
  item: AssignItem,
  recommended: readonly string[],
  roles: readonly RoleSpec[],
): ChoiceAsk<GroupChoice> & { readonly dismissedReason: string } {
  const options = groupOptions(recommended)
  const pageOptions = { always: [ONE_BY_ONE_LABEL], dropped: ROLE_LIST_OPTIONS }
  const accept: Labelled<GroupChoice> = { label: ACCEPT_RECOMMENDATION_LABEL, value: { kind: 'accept' } }
  const oneByOne: Labelled<GroupChoice> = { label: ONE_BY_ONE_LABEL, value: { kind: 'one-by-one' } }
  const labels = recommended.length === 0 ? [oneByOne] : [accept, oneByOne]
  const parse = (answer: string): GroupChoice | null => {
    const picked = labelled(labels, answer)
    if (picked !== null) return picked
    const roleIds = parseRoleList(answer, roles)

    return roleIds === null ? null : { kind: 'roles', roleIds }
  }

  return {
    question: item.question,
    spec: { options, header: item.header, pageOptions, context: item.context, acceptsTyped: true },
    parse,
    accepts: t('init.memory.roleListAccepts', { quotedLabels: quotedLabels(options), ids: idsOf(roles) }),
    dismissedReason: ASSIGNMENT_DISMISSED_REASON,
  }
}

/**
 * The skills of the plugin group at `cursor.index` handed out one by one (D-251) at `next`: a question waits at its
 * cursor; when the last skill is answered each skill joins `done` with the roles it was given, and the next group is
 * asked.
 */
function groupHandedOut(state: InitState, plan: AssignPlan, cursor: ItemCursor, next: HandoutNext): InitState {
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  if (next.kind === 'ask') {
    const { index, done, skills } = cursor
    const sub: InitState['sub'] = { kind: 'group-handout', cursor: next.cursor, index, done, skills }

    return withEffect({ ...state, sub }, { kind: 'ask', question: next.question, spec: next.spec })
  }
  if (next.outcome.kind === 'whole') return stageFailed(state)
  const { given } = next.outcome
  const group = plan.groups[cursor.index]
  if (group === undefined) return stageFailed(state)
  const done = [...cursor.done, ...group.names.map(name => ({ name, roleIds: given.get(name) ?? [] }))]

  return itemAsked(state, plan, { ...cursor, tries: 1, index: cursor.index + 1, done }, null)
}

/** The question of the item at `index`, asked `tries` times so far, `question` its text after a refusal. */
function itemAsked(state: InitState, plan: AssignPlan, cursor: ItemCursor, question: string | null): InitState {
  const at = groupAt(plan, cursor.index, cursor.skills)
  if (at === undefined) return ownSkillsStart(state, plan, cursor.done, cursor.skills)
  const ask = groupAsk(at.item, at.recommended, plan.roles)
  const asking: InitState = { ...state, sub: { kind: 'assign', ...cursor } }

  return withEffect(asking, { kind: 'ask', question: question ?? ask.question, spec: ask.spec })
}

/**
 * The stage done (A3): every role first loses the names asked about, then each name joins the `mcp` or `skills` list
 * of the roles its answer named (assignToRoles); a server or skill goes only where its answer sends it, never by a
 * table's seed alone (D-249, D-280); `done` holds the server answers first, one per server, then the group answers,
 * and `own` the own skills.
 */
function assigned(
  state: InitState,
  plan: AssignPlan,
  done: readonly NameAssignment[],
  own: readonly NameAssignment[],
): InitState {
  const { mcp, skills } = plan
  const servers = done.slice(0, mcp.names.length)
  const grouped = done.slice(mcp.names.length)
  const asked = new Set([...mcp.names])
  const askedSkills = new Set(skills.groups.flatMap(group => group.names))
  const unasked = plan.roles.map(role => ({
    ...role,
    mcp: role.mcp.filter(name => !asked.has(name)),
    skills: role.skills.filter(name => !askedSkills.has(name)),
  }))
  const withMcp = assignToRoles(unasked, servers, 'mcp')
  const roles = assignToRoles(withMcp, [...grouped, ...own], 'skills')

  return stageDone({ ...state, draft: { ...state.draft, roles } })
}

/**
 * After the server and group questions, the user's own skills (G-02-1b, D-139): with none it is done; else they are
 * handed out, busiest first and then by name, with the roles the skills call recommended for each (D-248), keyed S1,
 * S2, ... by place as the hand-out takes them.
 */
function ownSkillsStart(
  state: InitState,
  plan: AssignPlan,
  done: readonly NameAssignment[],
  skills: SkillsRecommendation,
): InitState {
  const { ownGroup, counts } = plan
  if (ownGroup === undefined) return assigned(state, plan, done, [])
  const own = ownSkillsOf(plan.setup.skills, ownGroup, counts)
  const recommended = new Map(
    own.flatMap((skill, index): [string, readonly string[]][] => {
      const roleIds = skills.own.get(skill.name)

      return roleIds === undefined ? [] : [[ownSkillId(index), roleIds]]
    }),
  )

  return afterSkillsModel(state, plan, done, recommended)
}

/** The roles recommended for each own skill of a hand-out, by the skill's name, as its items hold them. */
function recommendedByName(items: readonly HandoutItem[]): ReadonlyMap<string, readonly string[]> {
  return new Map(items.map((item): [string, readonly string[]] => [item.id, item.recommended]))
}

/**
 * The own-skills hand-out at `next` (handoutAnswer): a question waits at its cursor; Accept or one by one gives each
 * own skill the roles it was given; Whole group asks the group question of D-53 for all of them (skillGroupItem), with
 * the roles the hand-out recommended for each in its context.
 */
function handedOut(
  state: InitState,
  plan: AssignPlan,
  done: readonly NameAssignment[],
  next: HandoutNext,
): InitState {
  const { ownGroup, counts } = plan
  if (ownGroup === undefined) return stageFailed(state)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  if (next.kind === 'ask') {
    const sub: InitState['sub'] = { kind: 'skills-handout', cursor: next.cursor, done }

    return withEffect({ ...state, sub }, { kind: 'ask', question: next.question, spec: next.spec })
  }
  if (next.outcome.kind === 'whole') {
    const items = state.sub.kind === 'skills-handout' ? state.sub.cursor.items : []

    return wholeAsked(state, plan, { tries: 1, done, recommended: recommendedByName(items) }, null)
  }
  const { given } = next.outcome
  const own = ownSkillsOf(plan.setup.skills, ownGroup, counts).map(skill => ({
    name: skill.name,
    roleIds: given.get(skill.name) ?? [],
  }))

  return assigned(state, plan, done, own)
}

/** Where the group question for all the user's own skills is: its tries, the answers before it, the recommendation. */
type WholeCursor = Omit<Extract<InitState['sub'], { readonly kind: 'skills-whole' }>, 'kind'>

/** The group question for all the user's own skills at `cursor`, `question` its text once refused. */
function wholeAsked(state: InitState, plan: AssignPlan, cursor: WholeCursor, question: string | null): InitState {
  if (plan.ownGroup === undefined) return stageFailed(state)
  const item = skillGroupItem(plan.ownGroup, plan.counts, plan.roles, plan.setup.skills, cursor.recommended)
  const ask = itemAsk(item, plan.roles)
  const asking: InitState = { ...state, sub: { kind: 'skills-whole', ...cursor } }

  return withEffect(asking, { kind: 'ask', question: question ?? ask.question, spec: ask.spec })
}
/** The answer to the question at `cursor`: its names given to the roles it named, then the next question. */
function afterItem(state: InitState, plan: AssignPlan, cursor: ItemCursor, answer: string | null): InitState {
  const at = groupAt(plan, cursor.index, cursor.skills)
  if (at === undefined) return stageFailed(state)
  const next = choiceAnswer(groupAsk(at.item, at.recommended, plan.roles), cursor, answer)
  if (next.kind === 'again') return itemAsked(state, plan, { ...cursor, tries: next.sub.tries }, next.question)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  const choice = next.value
  if (choice.kind === 'one-by-one') {
    const perSkill = cursor.skills.groupSkills.get(at.group.label) ?? new Map<string, readonly string[]>()
    const items = groupSkillItems(at.group, plan.setup.skills, plan.counts, perSkill)

    return groupHandedOut(state, plan, cursor, handoutItemsEnter(items, plan.roles, ASSIGNMENT_DISMISSED_REASON))
  }
  const roleIds = choice.kind === 'accept' ? at.recommended : choice.roleIds
  const given = at.item.names.map(name => ({ name, roleIds }))
  const done = [...cursor.done, ...given]

  return itemAsked(state, plan, { ...cursor, tries: 1, index: cursor.index + 1, done }, null)
}

/**
 * The model's recommendation for the own skills (G-02-1b): the entry question of their hand-out, with every own skill,
 * what it does, its own use count and the roles recommended for it (ownSkillLines) as its own context
 * (ownSkillsContext, D-236; no block of its own, D-302), its summary counting the skills and those recommended a role
 * (D-310). The context and the hand-out items both show the model's map with each missing entry filled by the roles
 * the skill table seeds for that skill (D-280), so the screen names what Accept gives (S-01, D-307).
 */
function afterSkillsModel(
  state: InitState,
  plan: AssignPlan,
  done: readonly NameAssignment[],
  recommended: ReadonlyMap<string, readonly string[]>,
): InitState {
  if (plan.ownGroup === undefined) return stageFailed(state)
  const skills = ownSkillsOf(plan.setup.skills, plan.ownGroup, plan.counts)
  const seeded = new Map(recommended)
  skills.forEach((skill, index) => {
    const seed = plan.skills.seeds.get(skill.name)
    if (!seeded.has(ownSkillId(index)) && seed !== undefined) seeded.set(ownSkillId(index), seed)
  })
  const lines = ownSkillLines(skills, plan.counts, seeded)
  const rows = ownSkillContextRows(skills, plan.counts, seeded)
  const items = ownSkillItems(skills, plan.counts, seeded)
  const withRoles = skills.filter((_, index) => (seeded.get(ownSkillId(index)) ?? []).length > 0).length
  const context = ownSkillsContext(lines, rows, skills.length, withRoles)
  const entry = { ...ownSkillsEntry(skills.length), context }

  return handedOut(state, plan, done, handoutEnter(entry, items, plan.roles, ASSIGNMENT_DISMISSED_REASON))
}

/** The answer to the group question for all of the user's own skills: every own skill to the roles it named. */
function afterWhole(state: InitState, plan: AssignPlan, sub: WholeCursor, answer: string | null): InitState {
  if (plan.ownGroup === undefined) return stageFailed(state)
  const item = skillGroupItem(plan.ownGroup, plan.counts, plan.roles, plan.setup.skills, sub.recommended)
  const next = choiceAnswer(itemAsk(item, plan.roles), sub, answer)
  if (next.kind === 'again') return wholeAsked(state, plan, { ...sub, tries: next.sub.tries }, next.question)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)

  return assigned(state, plan, sub.done, item.names.map(name => ({ name, roleIds: next.value })))
}

/** The answer to the effect the assignment stage has out: a question, the hand-out, or the mcp or skills model call. */
function assignAnswer(state: InitState, answer: Answer): InitState {
  const plan = assignPlan(state)
  if (plan === null) return stageFailed(state)
  const { sub } = state
  const isServersRecommended = answer.kind === 'model' && answer.result.id === 'mcp' && sub.kind === 'mcp-model'
  if (isServersRecommended) return mcpStart(state, plan, answer.result.result)
  const isRecommended = answer.kind === 'model' && answer.result.id === 'skills' && sub.kind === 'skills-model'
  if (isRecommended) {
    return itemAsked(state, plan, { tries: 1, index: 0, done: sub.done, skills: answer.result.result }, null)
  }
  if (answer.kind !== 'answer') return stageFailed(state)
  switch (sub.kind) {
    case 'mcp-handout':
      return mcpHandedOut(state, plan, handoutAnswer(sub.cursor, answer.text))
    case 'mcp-whole':
      return afterMcpWhole(state, plan, sub, answer.text)
    case 'assign':
      return afterItem(state, plan, sub, answer.text)
    case 'group-handout': {
      const { index, done, skills } = sub

      return groupHandedOut(state, plan, { tries: 1, index, done, skills }, handoutAnswer(sub.cursor, answer.text))
    }
    case 'skills-handout':
      return handedOut(state, plan, sub.done, handoutAnswer(sub.cursor, answer.text))
    case 'skills-whole':
      return afterWhole(state, plan, sub, answer.text)
    default:
      return stageFailed(state)
  }
}

/**
 * The MCP and skill stage (D-53, ISO-04, D-230, D-248, D-249, D-250, D-251, D-253, D-280). Every MCP server and skill
 * is asked and never given without an answer (classifyMcp, classifySkills), and infra servers and handoff, infra plugin
 * and framework skills are never asked about. First one checked mcp model call recommends roles for every server, from
 * its name, source, tool names and table seed; a review go-back reuses its kept result and calls it no more (D-253).
 * The servers are then handed out (D-250): the entry question offers Accept recommendations (only when a server has
 * one, D-279), Go one by one (each server's question with its source, tools and recommended roles) or Whole group (one
 * question for all the servers). Then one checked skills model call recommends roles for the own skills, each plugin
 * group and each skill in a group, from the confirmed MCP servers of each role (D-248); its fallback gives the skills
 * in a group the table seeds. Each plugin group is asked once, "Which roles get ...? (e.g. BE, QA, or none)", with the
 * team's role ids and what giving the skills means on its second line (skillsContextLine, D-136) and the group's
 * recommendation first in its own context; it is answered with Accept recommendation (only when the group has one:
 * every skill of the group to those roles), Go one by one (each skill with its own recommendation, Yes, No or a typed
 * list), None, All roles or a typed list of role ids or titles; an answer that names any other role is asked again
 * (parseRoleList, T-02-33). Then, when the user has skills that no plugin adds, they are handed out (G-02-1b): the side
 * pane shows them with the roles recommended for each, and the entry question offers Accept recommendations, Go one by
 * one or Whole group. The stage decides the whole list of each name it asks about (assigned, A3). With the history
 * hints the plugin groups are asked busiest first and each group question says how often its group was used, and the
 * own skills are shown and asked busiest first; without hints, or with none that count, the questions and their order
 * are the same as without the scan (D-59). Only an answer to every question gives roles: a dismissal cancels with
 * ASSIGNMENT_DISMISSED_REASON, and MAX_ASKS answers it cannot read at one question with NO_USABLE_ANSWER_REASON (A1,
 * D-136).
 */
export const assignStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const plan = assignPlan(state)
    if (plan === null) return stageFailed(state)
    const kept = reusable(state)?.mcp ?? null
    if (plan.mcp.names.length === 0 || kept !== null) return mcpStart(state, plan, kept ?? new Map())

    return mcpCalled(state, plan)
  },
  answer: assignAnswer,
})
