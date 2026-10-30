/**
 * The question contexts of init, a layer 8 module (D-203, D-236): one builder per question family whose context needs
 * new composition, from the line builders of today's pane blocks, and the lines those blocks share with their stages:
 * the roles proposal, the env heading and the security plugin notes. Every value is cleaned and capped here (D-222).
 * It imports core and the types, so the init stages read it here.
 */
import type { RoleChange, RoleSpec } from '../../../types'
import { pad } from '../../core/text'

/** The column, in code points, where a role's purpose starts in the proposal, after its title and id. */
const ROLE_LABEL_WIDTH = 24

/** The roles as the proposal lists them: a heading, then one line per role with its title, id and purpose. */
export function roleLines(roles: readonly RoleSpec[]): string[] {
  const rows = roles.map(role => `  ${pad(`${role.title} (${role.id})`, ROLE_LABEL_WIDTH)}${role.purpose}`)

  return ['Proposed roles:', ...rows]
}

/** One scan change: dropped or kept, the role id and the reason, then its evidence paths when there are any. */
function changeLine(change: RoleChange): string {
  const evidence = change.evidence.length === 0 ? '' : ` (${change.evidence.join(', ')})`

  return `  ${change.change} ${change.roleId}: ${change.reason}${evidence}`
}

/**
 * The proposal as init shows it in the side pane before the roles question (ROLE-01, D-133): every role with its title,
 * id and purpose, then every change the scan made to the template with its reason and evidence, or `none` when it made
 * none.
 */
export function proposalLines(roles: readonly RoleSpec[], changes: readonly RoleChange[]): string[] {
  const changeRows = changes.length === 0 ? ['  none'] : changes.map(changeLine)

  return [...roleLines(roles), 'Changes from the scan:', ...changeRows]
}

/** The first line of the side-pane block that lists every scanned env name before the env question (D-135). */
export const ENV_PANE_HEADING = 'Env variable names in your settings (values are never read):'

/** What each security plugin does, by the plugin name before its `@`, as the question tells it (decision #39). */
export const SECURITY_PLUGIN_NOTES: ReadonlyMap<string, string> = new Map([
  [
    'claude-security',
    'claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and ' +
      'writes CLAUDE-SECURITY-<time>/ report folders into the repo.',
  ],
  ['security-guidance', 'security-guidance adds hooks that warn about risky edits.'],
])
