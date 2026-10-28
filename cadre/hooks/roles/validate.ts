/**
 * Role validation, a layer 4 module: the caps of a team, the role id rule as its messages word it, the title and the
 * purpose a role keeps, the problems of a role list, and the value checks a role.json or a typed answer must pass (an
 * autopilot duration, a model alias, an effort, a permission mode, a threshold, a hook name) (D-46, D-48, D-51, D-52,
 * D-62, A4). It imports core, the role template and the types, so the other roles/ modules, the model prompt, assign,
 * generate and init check roles here.
 */
import type { Effort, PermissionMode, TemplateRoleId } from '../../types'
import { cleanKickoffTextOr, MAX_ROLE_CHARS } from '../core/kickoff-text'
import { MAX_HOOK_NAME_CHARS } from '../core/names'
import { MAX_REPLY_ERRORS } from '../core/reply'
import { isRoleId, RESERVED_ROLE_IDS } from '../core/role-id'
import { clean, idLabel } from '../core/text'
import { ROLE_TEMPLATE } from './template'
import type { RoleTraits } from './template'

/** Role ids a role cannot take; command.ts owns the list beside ROLE_ID_PATTERN (Pitfall 7). */
export { RESERVED_ROLE_IDS }

/** The most roles one team has; a longer list is refused (D-46). */
export const MAX_ROLES = 12

/** Code points a purpose keeps; a longer one is cut with an ellipsis (ROLE-02). */
export const MAX_PURPOSE_CHARS = 200

/** Code points of the person's description that reach the model; the rest is cut (D-83). */
export const MAX_DESCRIPTION_CHARS = 4000

/** The most errors parseProposal lists; when there are more, one extra line says so (MAX_REPLY_ERRORS of reply.ts). */
export const MAX_PROPOSAL_ERRORS = MAX_REPLY_ERRORS

/** What a role id must be, as the messages say it. */
const SLUG_RULE = 'a lowercase slug: a letter, then letters, digits or dashes, 24 characters at most'

/** The template role ids in template order: the values `basedOn` may take besides null. */
export const TEMPLATE_IDS: readonly TemplateRoleId[] = ROLE_TEMPLATE.map(row => row.id)

/** A custom role with no template base starts TL-like: Bash allowed, no `--ask-user` (D-92). */
export const CUSTOM_TRAITS: RoleTraits = Object.freeze({ hasBash: true, askUser: false })

/** A title as a role keeps it: cleaned and capped like a kickoff role name (D-48); null when nothing is left. */
export function titleOf(raw: string): string | null {
  return cleanKickoffTextOr(raw, MAX_ROLE_CHARS, null)
}

/** A purpose as a role keeps it: cleaned and capped at MAX_PURPOSE_CHARS; null when nothing is left. */
export function purposeOf(raw: string): string | null {
  const cleaned = clean(raw, MAX_PURPOSE_CHARS)

  return cleaned.trim() === '' ? null : cleaned
}

/**
 * Why a role id cannot be used, or null when it can (D-48, isRoleId). The id must match the slug pattern exactly, with
 * no case folding; `bin` is taken by the launcher folder `.cadre/bin/`, and `all` and `none` by the answer words.
 */
export function validateRoleId(id: string): string | null {
  if (id === 'bin') return 'role id "bin" is reserved: it is the launcher folder .cadre/bin/'
  if (RESERVED_ROLE_IDS.includes(id)) {
    return `role id "${idLabel(id)}" is reserved: all and none are answer words in init questions`
  }
  if (isRoleId(id)) return null

  return `role id "${idLabel(id)}" must be ${SLUG_RULE}`
}

/** The problems with one id: not usable, or (once per id) a repeat of an id seen before. */
function idProblems(id: string, seen: Set<string>, repeated: Set<string>): string[] {
  const problem = validateRoleId(id)
  if (problem !== null) return [problem]
  const isFirstRepeat = seen.has(id) && !repeated.has(id)
  seen.add(id)
  if (!isFirstRepeat) return []
  repeated.add(id)

  return [`duplicate role id "${id}"`]
}

/**
 * The problems with a role list, one message per problem (D-48): no roles, more than MAX_ROLES, then each role's id and
 * title in role order. A repeated id is reported once, and an id that is not usable is reported as that, never as a
 * repeat.
 */
export function validateRoles(roles: readonly { readonly id: string; readonly title: string }[]): string[] {
  if (roles.length === 0) return ['no roles: describe at least one role']

  const problems: string[] = []
  if (roles.length > MAX_ROLES) problems.push(`at most ${MAX_ROLES} roles (got ${roles.length})`)
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const role of roles) {
    problems.push(...idProblems(role.id, seen, repeated))
    if (titleOf(role.title) === null) problems.push(`role "${idLabel(role.id)}" has no title`)
  }

  return problems
}

/** The longest autopilot run init accepts, in minutes: 168 hours, the seven days autopilot allows ahead. */
const MAX_DURATION_MINUTES = 168 * 60

/** A duration in autopilot's grammar as minutes: digits are minutes, else `<h>h`, `<m>m` or both; null otherwise. */
function durationMinutes(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text)
  const [, hours, minutes] = /^(?:(\d+)h)?(?:(\d+)m)?$/i.exec(text) ?? []
  if (hours === undefined && minutes === undefined) return null

  return Number(hours ?? 0) * 60 + Number(minutes ?? 0)
}

/**
 * Whether text is an autopilot duration init may write (D-51): autopilot's own grammar (minutes as digits, or `<h>h`
 * and `<m>m` in any case), and not zero and not more than 168 hours. The text must be exactly the duration.
 */
export function isAutopilotDuration(text: string): boolean {
  const minutes = durationMinutes(text)

  return minutes !== null && minutes > 0 && minutes <= MAX_DURATION_MINUTES
}

/**
 * The model family aliases a role may name (D-52, OQ 8, A4): each resolves to the latest model of its family, so a
 * role never pins a model id. A role.json and a typed model answer are both checked against them (isModelName).
 */
export const MODEL_ALIASES: readonly string[] = Object.freeze(['opus', 'sonnet', 'haiku', 'fable'])

/**
 * Whether text names a model a role may use (A4): exactly one of MODEL_ALIASES, which resolves to the latest model of
 * its family. Anything else, a typo or a pinned model id such as `claude-opus-4-5`, is refused here.
 */
export function isModelName(text: string): boolean {
  return MODEL_ALIASES.includes(text)
}

/** A hook script basename a role carries (D-62): 1 to MAX_HOOK_NAME_CHARS letters, digits, `.`, `_` and `-`. */
export const HOOK_NAME_PATTERN = new RegExp(`^[A-Za-z0-9._-]{1,${MAX_HOOK_NAME_CHARS}}$`)

/** The highest context threshold a role.json may set, in percent. */
export const MAX_THRESHOLD = 95

/** The effort levels `claude --effort` takes on 2.1.295, lowest first (P18). */
export const EFFORTS: readonly Effort[] = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])

/** The permission modes `claude --permission-mode` takes (P18). */
export const PERMISSION_MODES: readonly PermissionMode[] = [
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'manual',
  'dontAsk',
  'plan',
]
