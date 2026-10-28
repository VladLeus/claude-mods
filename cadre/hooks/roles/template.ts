/**
 * The role template, a layer 4 module: the six template roles every repo starts from (D-54), the defaults every role
 * shares, the role a template row stands for, and the decision chain that names who takes each decision type (D-12).
 * It imports core, the framework contract and the types, so the other roles/ modules, the model prompt, assign, scope,
 * epic, init and testkit read the template here.
 */
import type {
  DecisionType,
  Effort,
  PermissionMode,
  ProposedRole,
  RoleCarry,
  RoleSpec,
  TemplateRoleId,
} from '../../types'
import { freezeRows } from '../core/freeze'
import { DECISION_TYPES } from '../framework/contract'

/**
 * One row of the role template (D-54), the team every repo starts from. PM has no Bash (ROLE-05), and PM, TL and
 * Security ask the person through `--ask-user` (D-10); the implementers do not.
 */
export type TemplateRole = {
  readonly id: TemplateRoleId
  /** The display name used in sentences; the id is the slug used in paths (D-48). */
  readonly title: string
  readonly purpose: string
  /** False only for PM: its Bash is denied, hard-enforced (ROLE-05). */
  readonly hasBash: boolean
  /** Whether the role starts with `--ask-user` (D-10). */
  readonly askUser: boolean
}

/** The role template in the order every proposal and every change list keeps: PM, TL, BE, FE, QA, Security. */
export const ROLE_TEMPLATE: readonly TemplateRole[] = freezeRows([
  {
    id: 'pm',
    title: 'PM',
    purpose: 'Owns product decisions: scope, requirements and acceptance.',
    hasBash: false,
    askUser: true,
  },
  {
    id: 'tl',
    title: 'Team Lead',
    purpose: 'Owns architecture and QA decisions; reviews and merges the work.',
    hasBash: true,
    askUser: true,
  },
  { id: 'be', title: 'BE', purpose: 'Implements the backend and core code.', hasBash: true, askUser: false },
  { id: 'fe', title: 'FE', purpose: 'Implements the frontend.', hasBash: true, askUser: false },
  { id: 'qa', title: 'QA', purpose: 'Owns tests and end-to-end checks.', hasBash: true, askUser: false },
  {
    id: 'security',
    title: 'Security',
    purpose: 'Owns security decisions and reviews.',
    hasBash: true,
    askUser: true,
  },
])

/** The model family alias every role starts with, never a pinned model id (D-52). */
export const DEFAULT_MODEL = 'opus'

/** The effort every role starts with (D-52). */
export const DEFAULT_EFFORT: Effort = 'medium'

/** The permission mode every role starts with; a role.json edit changes it later (D-61). */
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'auto'

/** The autopilot duration every role starts with, in autopilot's grammar (D-51). */
export const DEFAULT_DURATION = '4h'

/** The autopilot context threshold in percent, asked nowhere: autopilot clamps it to the user's ceiling (D-87). */
export const AUTOPILOT_THRESHOLD = 65

/** What a role carries from the init user's settings before anything is picked: nothing (D-60). Frozen, lists too. */
export const EMPTY_CARRY: RoleCarry = Object.freeze({
  autoCompactWindow: false,
  statusLine: false,
  env: Object.freeze([]),
  hooks: Object.freeze([]),
})

/** The last link of every decision chain: the person, reached through autopilot's `queue_question` (D-12, D-54). */
export const HUMAN_FALLBACK = 'human (queue_question)'

/** Which role owns each decision type (D-54). A gate whose type has no owner here falls back along the chain. */
export const DECISION_OWNERS: Readonly<Record<DecisionType, TemplateRoleId>> = Object.freeze({
  Product: 'pm',
  Arch: 'tl',
  Security: 'security',
  QA: 'tl',
})

/** The role that takes a decision whose owner is not on the team, before the person (D-12). */
const FALLBACK_OWNER: TemplateRoleId = 'tl'

/** Why FE is dropped (D-49): the scan found none of the frameworks it looks for. */
export const NO_FRONTEND_REASON = 'no frontend framework found (react, vue, next, svelte, angular)'

/** Why QA is dropped (D-49): the scan found neither a test nor an E2E marker. */
export const NO_TESTS_REASON = 'no tests or E2E setup found'

/** Why BE is dropped (D-85): no source file at all. */
export const NO_SOURCE_REASON = 'no source code found'

/** What a role's base decides: whether it has Bash and whether it asks the person. */
export type RoleTraits = {
  readonly hasBash: boolean
  readonly askUser: boolean
}

/** A role with the defaults every role shares and the traits its base decides: no MCP, no skills, nothing carried. */
export function roleOf(proposed: ProposedRole, traits: RoleTraits): RoleSpec {
  return {
    id: proposed.id,
    title: proposed.title,
    purpose: proposed.purpose,
    basedOn: proposed.basedOn,
    model: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT,
    permissionMode: DEFAULT_PERMISSION_MODE,
    autopilot: { duration: DEFAULT_DURATION, threshold: AUTOPILOT_THRESHOLD, askUser: traits.askUser },
    hasBash: traits.hasBash,
    mcp: [],
    skills: [],
    instructions: [],
    carry: EMPTY_CARRY,
  }
}

/** The role a template row stands for: based on itself, with the shared defaults and nothing assigned yet. */
export function roleFromTemplate(row: TemplateRole): RoleSpec {
  return roleOf({ id: row.id, title: row.title, purpose: row.purpose, basedOn: row.id }, row)
}

/**
 * A role as a decision chain sees it: its id and the template role it is based on. A plain id stands for a role with
 * that id and no base, so a list of ids still gives the chain it gave before basedOn counted.
 */
export type ChainRole = string | Pick<RoleSpec, 'id' | 'basedOn'>

/**
 * Whether a role stands for a template role: its id is the template id, or it is based on that template role. The
 * decision chain, the MCP and skill tables and the recommendations all count a role this way.
 */
export function standsFor(role: Pick<RoleSpec, 'id' | 'basedOn'>, templateId: TemplateRoleId): boolean {
  return role.id === templateId || role.basedOn === templateId
}

/**
 * The id of the role that stands for a template role on the team (standsFor): the role with that id first, else the
 * first role based on it; null when there is neither. /cadre epic finds the TL with it (D-159).
 */
export function standIn(templateId: TemplateRoleId, roles: readonly ChainRole[]): string | null {
  const members = roles.map(role => (typeof role === 'string' ? { id: role, basedOn: null } : role))
  const byId = members.find(role => role.id === templateId)
  if (byId !== undefined) return byId.id

  return members.find(role => standsFor(role, templateId))?.id ?? null
}

/**
 * Who takes a decision of this type on a team (D-12, D-54): the role that stands for its owner (by id, else by
 * basedOn), else the one that stands for the team lead, and the person last, always. A renamed or custom role based on
 * a template role keeps that role's decisions. A team with neither goes straight to the person.
 */
export function decisionChain(decision: DecisionType, roles: readonly ChainRole[]): readonly string[] {
  const owner = standIn(DECISION_OWNERS[decision], roles) ?? standIn(FALLBACK_OWNER, roles)
  if (owner === null) return [HUMAN_FALLBACK]

  return [owner, HUMAN_FALLBACK]
}

/** One line per decision type in DECISION_TYPES order, naming its chain for this team: `Arch: tl -> human (...)`. */
export function chainLines(roles: readonly ChainRole[]): string[] {
  return DECISION_TYPES.map(decision => `${decision}: ${decisionChain(decision, roles).join(' -> ')}`)
}
