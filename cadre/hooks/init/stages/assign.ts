/**
 * The assignment stage of init (G-02-1b, A3, D-59, D-136), a layer 10 module: which roles get each MCP server and
 * skill group the tables do not decide, with the team's role ids on each question's second line (mcpContextLine), the
 * plugin groups busiest first with the history hints, then the own skills (init/stages/own-skills); assignmentStep
 * gives each name to the roles its answer names and decides the whole list of each name it asks about. Pure: it asks
 * through the InitIo port it is given, imports init/answers, init/assign-rules, ui/ask and the model and own-skills
 * stages, and never imports init.ts, which imports it, or init/run.
 */
import type { InitIo, RoleSpec, SetupScan } from '../../../types'
import { accepted, ASK_HEADERS, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import { assignToRoles, mcpQuestion } from '../answers'
import { classifyMcp, classifySkills, orderGroupsByUse } from '../assign-rules'
import { teamContextLine } from './model'
import { askAssignments, ownSkillsStep, skillGroupItem } from './own-skills'

/** The context line of an MCP server question (D-136): the team's role ids; only a role given it can use it. */
export function mcpContextLine(roles: readonly RoleSpec[]): string {
  return `${teamContextLine(roles)} A role not given the server cannot use it.`
}

/**
 * The MCP and skill step (D-53, ISO-04). The servers and skills the name tables decide go to their roles with no
 * question (classifyMcp, classifySkills), and infra servers and handoff and framework skills are never asked about.
 * Each unknown MCP server, then each group of unknown skills by plugin, is asked once, "Which roles get ...? (e.g. BE,
 * QA, or none)", with the team's role ids and what giving the item means on its second line (mcpContextLine,
 * skillsContextLine, D-136), answered with None, All roles or a typed list of role ids or titles; an answer that names
 * any other role is asked again (parseRoleList, T-02-33). Then, when the user has skills that no plugin adds, they are
 * handed out (ownSkillsStep, G-02-1b): a model call recommends roles for each, the side pane shows them, and the entry
 * question offers Accept recommendations, Go one by one or Whole group. The step decides the whole list of each name it
 * asks about: every role first loses those names, then each name joins the `mcp` or `skills` list of the roles its
 * answer names (assignToRoles), so running the step again sets that list, and the names the tables decide stay (A3).
 * With `hints`, the command and skill counts of the history scan, the plugin groups are asked busiest first and each
 * group question says how often its group was used (orderGroupsByUse, skillGroupQuestion), and the own skills are
 * shown and asked busiest first; without hints, or with none that count, the questions and their order are the same
 * as without the scan (D-59). Only an answer to every question gives roles: a dismissal gives the cancel reason
 * ASSIGNMENT_DISMISSED_REASON, and MAX_ASKS answers it cannot read at one question NO_USABLE_ANSWER_REASON (A1,
 * D-136). The roles it is given never change.
 */
export async function assignmentStep(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  hints?: ReadonlyMap<string, number>,
): Promise<StepResult<readonly RoleSpec[]>> {
  const mcp = classifyMcp(setup.mcp, roles)
  const skills = classifySkills(setup.skills, roles)
  const counts = hints ?? new Map<string, number>()
  const serverItems = mcp.unknown.map(name => ({
    question: withContext(mcpQuestion(name), mcpContextLine(roles)),
    header: ASK_HEADERS.mcp,
    names: [name],
  }))
  const pluginGroups = skills.groups.filter(group => group.plugin !== null)
  const groupItems = orderGroupsByUse(pluginGroups, counts).map(group => skillGroupItem(group, counts, roles))
  const servers = await askAssignments(io, roles, serverItems)
  if (servers.kind === 'cancelled') return servers
  const grouped = await askAssignments(io, roles, groupItems)
  if (grouped.kind === 'cancelled') return grouped
  const ownGroup = skills.groups.find(group => group.plugin === null)
  const own = await ownSkillsStep(io, roles, setup.skills, ownGroup, counts)
  if (own.kind === 'cancelled') return own
  const asked = new Set([...mcp.unknown])
  const askedSkills = new Set(skills.groups.flatMap(group => group.names))
  const unasked = roles.map(role => ({
    ...role,
    mcp: role.mcp.filter(name => !asked.has(name)),
    skills: role.skills.filter(name => !askedSkills.has(name)),
  }))
  const withMcp = assignToRoles(unasked, [...mcp.assigned, ...servers.value], 'mcp')

  return accepted(assignToRoles(withMcp, [...skills.assigned, ...grouped.value, ...own.value], 'skills'))
}
