/**
 * The assignment stage of init (G-02-1b, A3, D-59, D-136, D-230), a layer 10 module: which roles get each MCP server
 * and skill group the tables do not decide, with the team's role ids on each question's second line (mcpContextLine),
 * the plugin groups busiest first with the history hints, then the own skills (init/stages/own-skills) with the roles a
 * skills model effect recommends for them; assignStage, the pure stage that gives each name to the roles its answer
 * names and decides the whole list of each name it asks about. Pure: it gives states and never performs an effect,
 * imports ui/ask, init/answers, init/assign-rules, init/handout, init/state and the memory, model and own-skills
 * stages, and never imports init/machine or init/run.
 */
import type { RoleSpec, SetupScan } from '../../../types'
import { ASK_HEADERS, choiceAnswer, withContext } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import { assignToRoles, mcpQuestion, ownSkillLines, parseRoleList } from '../answers'
import { classifyMcp, classifySkills, orderGroupsByUse } from '../assign-rules'
import type { NameAssignment, SkillGroup } from '../assign-rules'
import { handoutAnswer, handoutEnter } from '../handout'
import type { HandoutNext } from '../handout'
import { reusable, stageCancelled, stageDone, stageFailed, withEffect, withOutputs } from '../state'
import type { Answer, InitState, StageDef } from '../state'
import { ROLE_LIST_OPTIONS, roleListAccepts } from './memory'
import { teamContextLine } from './model'
import { ASSIGNMENT_DISMISSED_REASON, ownSkillItems, ownSkillsEntry, ownSkillsOf, skillGroupItem } from './own-skills'
import type { AssignItem } from './own-skills'

/** The context line of an MCP server question (D-136): the team's role ids; only a role given it can use it. */
export function mcpContextLine(roles: readonly RoleSpec[]): string {
  return `${teamContextLine(roles)} A role not given the server cannot use it.`
}

/**
 * What the assignment stage works from (D-53, D-59): the team, the setup scan and the history counts; the servers and
 * skills the name tables decide (classifyMcp, classifySkills); the questions in the order asked, each unknown server,
 * then each plugin group, busiest first with the hints (orderGroupsByUse); and the group of the user's own skills.
 */
type AssignPlan = {
  readonly roles: readonly RoleSpec[]
  readonly setup: SetupScan
  readonly counts: ReadonlyMap<string, number>
  readonly mcp: ReturnType<typeof classifyMcp>
  readonly skills: ReturnType<typeof classifySkills>
  readonly items: readonly AssignItem[]
  readonly ownGroup: SkillGroup | undefined
}

/** The AssignPlan of a state's draft; null while the roles, the scans or the history hints are not set. */
function assignPlan(state: InitState): AssignPlan | null {
  const { roles, gathered, hints } = state.draft
  if (roles === undefined || gathered === undefined || hints === undefined) return null
  const { setup } = gathered
  const mcp = classifyMcp(setup.mcp, roles)
  const skills = classifySkills(setup.skills, roles)
  const serverItems = mcp.unknown.map(name => ({
    question: withContext(mcpQuestion(name), mcpContextLine(roles)),
    header: ASK_HEADERS.mcp,
    names: [name],
  }))
  const pluginGroups = skills.groups.filter(group => group.plugin !== null)
  const groupItems = orderGroupsByUse(pluginGroups, hints).map(group => skillGroupItem(group, hints, roles))
  const ownGroup = skills.groups.find(group => group.plugin === null)

  return { roles, setup, counts: hints, mcp, skills, items: [...serverItems, ...groupItems], ownGroup }
}

/**
 * The question on which roles get an item (D-53, D-136): its question, None or All roles with its chip, a typed list of
 * role ids or titles (parseRoleList), what its refusal lists, and ASSIGNMENT_DISMISSED_REASON for a dismissal.
 */
function itemAsk(item: AssignItem, roles: readonly RoleSpec[]): ChoiceAsk<readonly string[]> & {
  readonly dismissedReason: string
} {
  return {
    question: item.question,
    spec: { options: ROLE_LIST_OPTIONS, header: item.header },
    parse: (answer: string): readonly string[] | null => parseRoleList(answer, roles),
    accepts: roleListAccepts(roles),
    dismissedReason: ASSIGNMENT_DISMISSED_REASON,
  }
}

/** The question of the item at `index`, asked `tries` times so far, `question` its text after a refusal. */
function itemAsked(
  state: InitState,
  plan: AssignPlan,
  cursor: { readonly tries: number; readonly index: number; readonly done: readonly NameAssignment[] },
  question: string | null,
): InitState {
  const item = plan.items[cursor.index]
  if (item === undefined) return ownSkillsStart(state, plan, cursor.done)
  const ask = itemAsk(item, plan.roles)
  const asking: InitState = { ...state, sub: { kind: 'assign', ...cursor } }

  return withEffect(asking, { kind: 'ask', question: question ?? ask.question, spec: ask.spec })
}

/**
 * The stage done (A3): every role first loses the names asked about, then each name joins the `mcp` or `skills` list
 * of the roles its answer named (assignToRoles), the names the tables decide included; `done` holds the server
 * answers first, one per server, then the group answers, and `own` the own skills.
 */
function assigned(
  state: InitState,
  plan: AssignPlan,
  done: readonly NameAssignment[],
  own: readonly NameAssignment[],
): InitState {
  const { mcp, skills } = plan
  const servers = done.slice(0, mcp.unknown.length)
  const grouped = done.slice(mcp.unknown.length)
  const asked = new Set([...mcp.unknown])
  const askedSkills = new Set(skills.groups.flatMap(group => group.names))
  const unasked = plan.roles.map(role => ({
    ...role,
    mcp: role.mcp.filter(name => !asked.has(name)),
    skills: role.skills.filter(name => !askedSkills.has(name)),
  }))
  const withMcp = assignToRoles(unasked, [...mcp.assigned, ...servers], 'mcp')
  const roles = assignToRoles(withMcp, [...skills.assigned, ...grouped, ...own], 'skills')

  return stageDone({ ...state, draft: { ...state.draft, roles } })
}

/**
 * After the server and group questions, the user's own skills (G-02-1b, D-139): with none it is done; else the model
 * recommends roles for each, busiest first and then by name (the skills model effect). A review go-back asks them with
 * the recommendation of the first pass, kept for the same role ids, and calls the model no more (reusable, D-235).
 */
function ownSkillsStart(state: InitState, plan: AssignPlan, done: readonly NameAssignment[]): InitState {
  const { ownGroup, roles, counts } = plan
  if (ownGroup === undefined) return assigned(state, plan, done, [])
  const kept = reusable(state)?.ownSkills ?? null
  if (kept !== null) return afterSkillsModel(state, plan, done, kept)
  const skills = ownSkillsOf(plan.setup.skills, ownGroup, counts)
  const calling: InitState = { ...state, sub: { kind: 'skills-model', done } }

  return withEffect(calling, { kind: 'model', call: { id: 'skills', roles, skills, counts } })
}

/**
 * The own-skills hand-out at `next` (handoutAnswer): a question waits at its cursor; Accept or one by one gives each
 * own skill the roles it was given; Whole group asks the group question of D-53 for all of them (skillGroupItem).
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
  if (next.outcome.kind === 'whole') return wholeAsked(state, plan, done, 1, null)
  const { given } = next.outcome
  const own = ownSkillsOf(plan.setup.skills, ownGroup, counts).map(skill => ({
    name: skill.name,
    roleIds: given.get(skill.name) ?? [],
  }))

  return assigned(state, plan, done, own)
}

/** The group question for all the user's own skills, asked `tries` times so far, `question` its text once refused. */
function wholeAsked(
  state: InitState,
  plan: AssignPlan,
  done: readonly NameAssignment[],
  tries: number,
  question: string | null,
): InitState {
  if (plan.ownGroup === undefined) return stageFailed(state)
  const ask = itemAsk(skillGroupItem(plan.ownGroup, plan.counts, plan.roles), plan.roles)
  const asking: InitState = { ...state, sub: { kind: 'skills-whole', tries, done } }

  return withEffect(asking, { kind: 'ask', question: question ?? ask.question, spec: ask.spec })
}
/** The answer to the question at `cursor`: its names given to the roles it named, then the next question. */
function afterItem(
  state: InitState,
  plan: AssignPlan,
  cursor: { readonly tries: number; readonly index: number; readonly done: readonly NameAssignment[] },
  answer: string | null,
): InitState {
  const item = plan.items[cursor.index]
  if (item === undefined) return stageFailed(state)
  const next = choiceAnswer(itemAsk(item, plan.roles), cursor, answer)
  if (next.kind === 'again') return itemAsked(state, plan, { ...cursor, tries: next.sub.tries }, next.question)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  const given = item.names.map(name => ({ name, roleIds: next.value }))

  return itemAsked(state, plan, { tries: 1, index: cursor.index + 1, done: [...cursor.done, ...given] }, null)
}

/**
 * The model's recommendation for the own skills (G-02-1b): the side pane shows every own skill with what it does, its
 * own use count and the roles recommended for it (ownSkillLines), then the entry question of their hand-out.
 */
function afterSkillsModel(
  state: InitState,
  plan: AssignPlan,
  done: readonly NameAssignment[],
  recommended: ReadonlyMap<string, readonly string[]>,
): InitState {
  if (plan.ownGroup === undefined) return stageFailed(state)
  const skills = ownSkillsOf(plan.setup.skills, plan.ownGroup, plan.counts)
  const lines = ownSkillLines(skills, plan.counts, recommended)
  const shown = withOutputs(state, [{ kind: 'show', block: { key: 'skills', lines } }])
  const items = ownSkillItems(skills, plan.counts, recommended)
  const entry = ownSkillsEntry(skills.length)

  return handedOut(shown, plan, done, handoutEnter(entry, items, plan.roles, ASSIGNMENT_DISMISSED_REASON))
}

/** The answer to the group question for all of the user's own skills: every own skill to the roles it named. */
function afterWhole(
  state: InitState,
  plan: AssignPlan,
  sub: { readonly tries: number; readonly done: readonly NameAssignment[] },
  answer: string | null,
): InitState {
  if (plan.ownGroup === undefined) return stageFailed(state)
  const item = skillGroupItem(plan.ownGroup, plan.counts, plan.roles)
  const next = choiceAnswer(itemAsk(item, plan.roles), sub, answer)
  if (next.kind === 'again') return wholeAsked(state, plan, sub.done, next.sub.tries, next.question)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)

  return assigned(state, plan, sub.done, item.names.map(name => ({ name, roleIds: next.value })))
}

/** The answer to the effect the assignment stage has out: a question, the hand-out, or the skills model call. */
function assignAnswer(state: InitState, answer: Answer): InitState {
  const plan = assignPlan(state)
  if (plan === null) return stageFailed(state)
  const { sub } = state
  const isRecommended = answer.kind === 'model' && answer.result.id === 'skills' && sub.kind === 'skills-model'
  if (isRecommended) return afterSkillsModel(state, plan, sub.done, answer.result.result)
  if (answer.kind !== 'answer') return stageFailed(state)
  switch (sub.kind) {
    case 'assign':
      return afterItem(state, plan, sub, answer.text)
    case 'skills-handout':
      return handedOut(state, plan, sub.done, handoutAnswer(sub.cursor, answer.text))
    case 'skills-whole':
      return afterWhole(state, plan, sub, answer.text)
    default:
      return stageFailed(state)
  }
}

/**
 * The MCP and skill stage (D-53, ISO-04, D-230). The servers and skills the name tables decide go to their roles with
 * no question (classifyMcp, classifySkills), and infra servers and handoff and framework skills are never asked about.
 * Each unknown MCP server, then each group of unknown skills by plugin, is asked once, "Which roles get ...? (e.g. BE,
 * QA, or none)", with the team's role ids and what giving the item means on its second line (mcpContextLine,
 * skillsContextLine, D-136), answered with None, All roles or a typed list of role ids or titles; an answer that names
 * any other role is asked again (parseRoleList, T-02-33). Then, when the user has skills that no plugin adds, they are
 * handed out (G-02-1b): a model call recommends roles for each, the side pane shows them, and the entry question offers
 * Accept recommendations, Go one by one or Whole group. The stage decides the whole list of each name it asks about
 * (assigned, A3). With the history hints the plugin groups are asked busiest first and each group question says how
 * often its group was used, and the own skills are shown and asked busiest first; without hints, or with none that
 * count, the questions and their order are the same as without the scan (D-59). Only an answer to every question gives
 * roles: a dismissal cancels with ASSIGNMENT_DISMISSED_REASON, and MAX_ASKS answers it cannot read at one question with
 * NO_USABLE_ANSWER_REASON (A1, D-136).
 */
export const assignStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const plan = assignPlan(state)
    if (plan === null) return stageFailed(state)

    return itemAsked(state, plan, { tries: 1, index: 0, done: [] }, null)
  },
  answer: assignAnswer,
})
