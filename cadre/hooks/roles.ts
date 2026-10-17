import type {
  DecisionType,
  Effort,
  PermissionMode,
  ProposedRole,
  RepoScan,
  RoleCarry,
  RoleChange,
  RoleProposal,
  RoleSpec,
  ScanFinding,
  ScanKind,
  TemplateRoleId,
} from '../types'
import { DECISION_TYPES } from './framework'
import { freezeRows } from './freeze'

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
const NO_FRONTEND_REASON = 'no frontend framework found (react, vue, next, svelte, angular)'

/** Why QA is dropped (D-49): the scan found neither a test nor an E2E marker. */
const NO_TESTS_REASON = 'no tests or E2E setup found'

/** Why BE is dropped (D-85): no source file at all. */
const NO_SOURCE_REASON = 'no source code found'

/** The most evidence paths one change lists. */
const MAX_EVIDENCE_PATHS = 3

/** What a role's base decides: whether it has Bash and whether it asks the person. */
type RoleTraits = {
  readonly hasBash: boolean
  readonly askUser: boolean
}

/** A role with the defaults every role shares and the traits its base decides: no MCP, no skills, nothing carried. */
function roleOf(proposed: ProposedRole, traits: RoleTraits): RoleSpec {
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
 * Who takes a decision of this type on a team (D-12, D-54): its owner when the owner is on the team, else the team
 * lead, and the person last, always. A team with neither the owner nor a team lead goes straight to the person.
 */
export function decisionChain(decision: DecisionType, roleIds: readonly string[]): readonly string[] {
  const owner = DECISION_OWNERS[decision]
  if (roleIds.includes(owner)) return [owner, HUMAN_FALLBACK]
  if (roleIds.includes(FALLBACK_OWNER)) return [FALLBACK_OWNER, HUMAN_FALLBACK]

  return [HUMAN_FALLBACK]
}

/** One line per decision type in DECISION_TYPES order, naming its chain for this team: `Arch: tl -> human (...)`. */
export function chainLines(roleIds: readonly string[]): string[] {
  return DECISION_TYPES.map(decision => `${decision}: ${decisionChain(decision, roleIds).join(' -> ')}`)
}

/** The findings of these kinds, in finding order. */
function findingsOf(scan: RepoScan, kinds: readonly ScanKind[]): readonly ScanFinding[] {
  return scan.findings.filter(finding => kinds.includes(finding.kind))
}

/** Whether the scan has a finding of any of these kinds. */
function hasFinding(scan: RepoScan, kinds: readonly ScanKind[]): boolean {
  return scan.findings.some(finding => kinds.includes(finding.kind))
}

/** The scanned languages as a sentence part, or `unknown language` when the scan named none. */
function languageText(scan: RepoScan): string {
  if (scan.languages.length === 0) return 'unknown language'

  return scan.languages.join(', ')
}

/**
 * The repo-relative paths that justify a change: at most MAX_EVIDENCE_PATHS, in finding order, one per path and one per
 * kind and label, so a finding the scan repeated is listed once.
 */
function evidencePaths(findings: readonly ScanFinding[]): string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const finding of findings) {
    if (paths.length >= MAX_EVIDENCE_PATHS) break
    const key = `${finding.kind}:${finding.label}`
    if (seen.has(key) || paths.includes(finding.evidence)) continue
    seen.add(key)
    paths.push(finding.evidence)
  }

  return paths
}

/** A drop: the role leaves the proposal, and the reason is an absence, so it has no evidence. */
function dropped(roleId: TemplateRoleId, reason: string): RoleChange {
  return { roleId, change: 'dropped', reason, evidence: [] }
}

/**
 * BE is dropped only when the scan found no source code at all (D-85). With source but no backend framework it is kept,
 * with the reason that says which framework is missing and the language evidence (D-97).
 */
function backendChange(scan: RepoScan): RoleChange | null {
  if (!scan.hasSource) return dropped('be', NO_SOURCE_REASON)
  if (hasFinding(scan, ['be'])) return null
  const missing = hasFinding(scan, ['fe']) ? 'no backend framework' : 'no UI framework'

  return {
    roleId: 'be',
    change: 'kept',
    reason: `source code found (${languageText(scan)}), ${missing}`,
    evidence: evidencePaths(findingsOf(scan, ['lang'])),
  }
}

/** The change the scan makes to one template role, or null when the template stands (D-49). */
function scanChange(id: TemplateRoleId, scan: RepoScan): RoleChange | null {
  switch (id) {
    case 'be':
      return backendChange(scan)
    case 'fe':
      return hasFinding(scan, ['fe']) ? null : dropped('fe', NO_FRONTEND_REASON)
    case 'qa':
      return hasFinding(scan, ['test', 'e2e']) ? null : dropped('qa', NO_TESTS_REASON)
    case 'pm':
    case 'tl':
    case 'security':
      return null
  }
}

/**
 * The roles init proposes for a scan, and the reason for every change the scan made (ROLE-01). The template is walked
 * once in order, so roles and changes both keep template order. PM, TL and Security are always proposed (D-49). FE is
 * dropped without a frontend finding, QA without a test or E2E finding, and BE only without source code (D-85).
 */
export function proposeRoles(scan: RepoScan): RoleProposal {
  const roles: RoleSpec[] = []
  const changes: RoleChange[] = []
  for (const row of ROLE_TEMPLATE) {
    const change = scanChange(row.id, scan)
    if (change !== null) changes.push(change)
    if (change !== null && change.change === 'dropped') continue
    roles.push(roleFromTemplate(row))
  }

  return { roles, changes }
}
