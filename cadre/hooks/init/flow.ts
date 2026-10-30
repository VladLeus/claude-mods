/**
 * The order of the init questions (ROLE-01 to ROLE-05, D-43, A3, A6), a layer 10 module: teamStep, the role steps from
 * the roles question to the improver install question, with perRoleSteps, the steps after the duration; ReviewItem,
 * what an answer to the review question picks, and goBack, which re-asks one review item and gives the draft with the
 * new answer; and historyHints, the history scan as hints for the skill questions. Pure: it asks through the InitIo
 * port it is given, imports roles, scan, team, ui, init/draft and the init/stages steps, and never imports init.ts,
 * which imports it, or init/run.
 */
import type { FrameworkId, InitIo, RoleProposal, RoleSpec } from '../../types'
import { CLAUDE_SECURITY_PLUGIN } from '../roles/infra'
import { missingSecurityPlugins, recommend } from '../roles/recommend'
import type { HistoryScan } from '../scan/history'
import { resolvedFramework } from '../team'
import { accepted, askChoice, choiceResult, showBlock } from '../ui/ask'
import type { StepResult } from '../ui/ask'
import { recommendationLines } from '../ui/blocks/recommendations'
import { mapped } from './draft'
import type { Draft, DraftBase, Team } from './draft'
import { assignmentStep } from './stages/assign'
import { carryStep } from './stages/carry'
import { durationStep, withDuration } from './stages/duration'
import { frameworkStep } from './stages/frameworks'
import { hunkStep } from './stages/hunks'
import { improverInstallStep } from './stages/improver-install'
import { instructionsAgain, instructionsStep } from './stages/instructions'
import { launchStartStep } from './stages/launch'
import { modelStep } from './stages/model'
import { GIT_POLICY_ASK } from './stages/policy'
import { rolesStep } from './stages/roles'
import { securityInstallStep, withSecuritySkill } from './stages/security'

/**
 * What an answer to the review question picks (D-43, A2): confirm the plan, or go back to one item: the roles (and with
 * them every per-role step), the git policy, the launcher start, the duration, the model and effort, the MCP and skill
 * assignments, the instructions and memories, the carried env names, or the hunks.
 */
export type ReviewItem =
  | 'confirm'
  | 'roles'
  | 'policy'
  | 'launch'
  | 'duration'
  | 'model'
  | 'assignments'
  | 'memory'
  | 'env'
  | 'hunks'

/**
 * The per-role steps after the duration (D-52, D-53, D-60, G-02-1f, ROLE-04), in this order: model and effort
 * (modelStep), MCP servers and skills with the history hints (assignmentStep), instructions and memories
 * (instructionsStep), carried settings (carryStep), then the autonomy hunks of the frameworks the roles run on
 * (hunkStep). The first cancelled step ends it with its reason (A1).
 */
async function perRoleSteps(
  io: InitIo,
  base: DraftBase,
  roles: readonly RoleSpec[],
  repoDefault: FrameworkId | null,
): Promise<StepResult<Omit<Team, 'duration' | 'changes' | 'pluginInstalls'>>> {
  const { gathered, locations } = base
  const modelled = await modelStep(io, roles)
  if (modelled.kind === 'cancelled') return modelled
  const assigned = await assignmentStep(io, modelled.value, gathered.setup, base.hints)
  if (assigned.kind === 'cancelled') return assigned
  const instructed = await instructionsStep(io, assigned.value, gathered.setup, locations)
  if (instructed.kind === 'cancelled') return instructed
  const { instructions } = instructed.value
  const carried = await carryStep(io, instructed.value.roles, gathered.setup)
  if (carried.kind === 'cancelled') return carried
  const team = carried.value
  const hunks = await hunkStep(io, { roles: team, repoDefault, gathered, locations })

  return mapped(hunks, answered => ({ roles: team, repoDefault, hunks: answered, instructions }))
}

/**
 * The role steps from the roles question to the hunks (ROLE-01 to ROLE-05, D-43): the roles (rolesStep from `start`,
 * shown with its scan changes), their frameworks (frameworkStep), the recommendations for that team (ROLE-03), the
 * security plugins question for the plugins a team with a Security role misses (missingSecurityPlugins,
 * securityInstallStep, decision #39), the duration, asked when `duration` is null and else kept for every role (D-51),
 * then perRoleSteps, and last the improver install question when the hand-out gave a role a built file and
 * claude-md-management is missing (improverInstallStep, D-141). When claude-security was asked about, every role that
 * stands for Security gets its review skill on Install and loses it on Not now (withSecuritySkill) before the
 * duration. Init runs it once from the proposal; Change roles runs it again from the current team with the scan
 * changes it was accepted with (A6) and the duration it has. The team keeps the scan changes of the roles accepted and
 * the plugins to install after Confirm, the security plugins first. The first cancelled step ends it with its reason
 * (A1).
 */
export async function teamStep(
  io: InitIo,
  base: DraftBase,
  start: RoleProposal,
  duration: string | null,
): Promise<StepResult<Team>> {
  const { gathered } = base
  const chosen = await rolesStep(io, base.proposal, base.installed, start)
  if (chosen.kind === 'cancelled') return chosen
  const framed = await frameworkStep(io, base.choice, chosen.value.roles)
  if (framed.kind === 'cancelled') return framed
  const { roles, repoDefault } = framed.value
  const frameworks = roles.map(role => resolvedFramework(role, repoDefault))
  const recommendations = recommend({ roles, frameworks, scan: gathered.repo, setup: gathered.setup })
  await showBlock(io, 'recommendations', recommendationLines(recommendations, roles))
  const missing = missingSecurityPlugins(roles, gathered.setup)
  const installs = await securityInstallStep(io, missing)
  if (installs.kind === 'cancelled') return installs
  const pluginInstalls = installs.value
  const isSkillAsked = missing.includes(CLAUDE_SECURITY_PLUGIN)
  const team = isSkillAsked ? withSecuritySkill(roles, pluginInstalls.includes(CLAUDE_SECURITY_PLUGIN)) : roles
  const asked = duration === null ? await durationStep(io, team) : accepted(duration)
  if (asked.kind === 'cancelled') return asked
  const kept = asked.value
  const steps = await perRoleSteps(io, base, withDuration(team, kept), repoDefault)
  if (steps.kind === 'cancelled') return steps
  const improver = await improverInstallStep(io, steps.value.instructions, gathered.setup)
  if (improver.kind === 'cancelled') return improver

  return accepted({
    duration: kept,
    changes: chosen.value.changes,
    pluginInstalls: [...pluginInstalls, ...improver.value],
    ...steps.value,
  })
}

/**
 * Goes back to one review item (D-43) and gives the draft with the new answer: it re-asks that item's step, and for
 * Change roles every role step from the current team, shown with the scan changes it was accepted with (A6), with the
 * duration kept (teamStep). The duration, model, assignment, memory and env steps run again on the current roles and
 * decide the whole list they ask about (A3), so a narrower answer takes a name away; memory goes back to the
 * instruction hand-out it had (instructionsAgain); the git policy is asked again as its stage asks it (GIT_POLICY_ASK,
 * until 02.1-26 makes the go-backs stage transitions). A cancelled step ends the review with its reason (A1).
 */
export async function goBack(
  io: InitIo,
  draft: Draft,
  item: Exclude<ReviewItem, 'confirm'>,
): Promise<StepResult<Draft>> {
  const { gathered, locations, roles } = draft
  switch (item) {
    case 'roles': {
      const team = await teamStep(io, draft, { roles, changes: draft.changes }, draft.duration)

      return mapped(team, decided => ({ ...draft, ...decided }))
    }
    case 'policy': {
      const policy = choiceResult(await askChoice(io, GIT_POLICY_ASK), GIT_POLICY_ASK.dismissedReason)

      return mapped(policy, chosen => ({ ...draft, policy: chosen }))
    }
    case 'launch':
      return mapped(await launchStartStep(io, locations.root, roles), launchStart => ({ ...draft, launchStart }))
    case 'duration':
      return mapped(await durationStep(io, roles), duration => ({
        ...draft,
        duration,
        roles: withDuration(roles, duration),
      }))
    case 'model':
      return mapped(await modelStep(io, roles), modelled => ({ ...draft, roles: modelled }))
    case 'assignments':
      return mapped(await assignmentStep(io, roles, gathered.setup, draft.hints), assigned => ({
        ...draft,
        roles: assigned,
      }))
    case 'memory':
      return mapped(await instructionsAgain(io, roles, gathered.setup, draft.instructions), (instructed): Draft => ({
        ...draft,
        ...instructed,
      }))
    case 'env':
      return mapped(await carryStep(io, roles, gathered.setup), carried => ({ ...draft, roles: carried }))
    case 'hunks': {
      const hunks = await hunkStep(io, { roles, repoDefault: draft.repoDefault, gathered, locations })

      return mapped(hunks, answered => ({ ...draft, hunks: answered }))
    }
  }
}

/** The history scan as hints for the skill questions: each name with its count; none when the scan was skipped. */
export function historyHints(history: HistoryScan | 'skipped'): ReadonlyMap<string, number> {
  if (history === 'skipped') return new Map()

  return new Map(history.counts.map((entry): [string, number] => [entry.name, entry.count]))
}
