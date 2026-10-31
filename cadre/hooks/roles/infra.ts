/**
 * The infra and security catalog, a layer 4 module: the plugins, skills, tools and MCP servers every role keeps, the
 * name tables that give a scanned MCP server or skill to template roles, and the exact keys of the security plugins
 * and the improver plugin init offers (ISO-04, D-53, D-77, decision #39, G-02-1f). It imports core and the types, so
 * assign, scope, generate, apply, init and the recommendations read the catalog here.
 */
import type { TemplateRoleId } from '../../types'
import { freezeRows } from '../core/freeze'
import { t } from '../locales/t'

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
  {
    pattern: /(^|[-_])(jira|linear|notion)([-_]|$)/i,
    roles: frozenRoles('pm', 'tl'),
    label: t('roles.infra.mcpRoleRows'),
  },
  { pattern: /(playwright|devtools)/i, roles: frozenRoles('fe', 'qa'), label: t('roles.infra.mcpRoleRows2') },
  { pattern: /(^|[-_])github([-_]|$)/i, roles: frozenRoles('tl'), label: t('roles.infra.mcpRoleRows3') },
])

/**
 * A security-review skill name, in any case: `security-review` as the whole last word, alone or after `-` or `:`, so
 * `acme:security-review` and `my-security-review` count and `security-reviewer` does not (D-53; the skill table's
 * security-review row, decision #39).
 */
const SECURITY_REVIEW_PATTERN = /(^|[-:])security-review$/i

/**
 * Which roles a skill goes to, by its name in any case (D-53), tried in order like MCP_ROLE_ROWS: `security-review`
 * goes to Security, so does the installed claude-security skill `claude-security:claude-security` (the whole name,
 * decision #39), and frontend and design skills go to FE. A name needs whole words (`-` or `:` around it, or the ends
 * of the name), so `redesign` is not a design skill.
 */
export const SKILL_ROLE_ROWS: readonly NameRow[] = freezeRows([
  { pattern: SECURITY_REVIEW_PATTERN, roles: frozenRoles('security'), label: 'security-review' },
  { pattern: /^claude-security:claude-security$/i, roles: frozenRoles('security'), label: 'claude-security' },
  {
    pattern: /(^|[-:])(frontend-design|frontend|design|ui-ux|ui-design)([-:]|$)/i,
    roles: frozenRoles('fe'),
    label: t('roles.infra.skillRoleRowsLabel'),
  },
])

/**
 * Anthropic's claude-security plugin, by its exact key in the claude-plugins-official marketplace: it gives the
 * Security role a review skill, and init offers to install it for a team with a Security role (decision #39).
 */
export const CLAUDE_SECURITY_PLUGIN = 'claude-security@claude-plugins-official'

/**
 * Anthropic's security-guidance plugin, by its exact key in the claude-plugins-official marketplace: its hooks warn
 * about risky edits, and init offers to install it for a team with a Security role (decision #39).
 */
export const SECURITY_GUIDANCE_PLUGIN = 'security-guidance@claude-plugins-official'

/** The security plugins init offers to install, in the order it asks about and installs them (decision #39). */
export const SECURITY_PLUGINS: readonly string[] = Object.freeze([CLAUDE_SECURITY_PLUGIN, SECURITY_GUIDANCE_PLUGIN])

/**
 * Anthropic's claude-md-management plugin, by its exact key in the claude-plugins-official marketplace: its
 * claude-md-improver skill tidies each built role CLAUDE.md after Confirm, and init offers to install it when a role
 * gets a built file and it is missing (G-02-1f, D-141). No role is given it.
 */
export const CLAUDE_MD_PLUGIN = 'claude-md-management@claude-plugins-official'

/**
 * The review skill of claude-security, as `plugin:skill`, which every Security role gets when the person answers
 * Install (decision #39). The name is an assumption (the plugin's skill folder is `claude-security`), checked live in
 * 03-UAT (plan 03-16).
 */
export const CLAUDE_SECURITY_SKILL = 'claude-security:claude-security'
