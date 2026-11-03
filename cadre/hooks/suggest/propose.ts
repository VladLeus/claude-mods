/**
 * The roles proposal prompt, a layer 7 module: the prompt that turns the person's description into roles, the check
 * of the model's reply and the roles it gives (ROLE-02, D-46, D-83, D-92), and the Describe path's model call with its
 * fallback line. It imports the checked call, core, the role template, role validation and the types, so init's
 * describe step reads it here.
 */
import type { InitIo, ProposedRole, RoleSpec, TemplateRoleId } from '../../types'
import { isObject, parseJsonValue } from '../core/json'
import { cappedErrors, unfenced, withReplyErrors } from '../core/reply'
import { clean, idLabel } from '../core/text'
import { PROMPTS, proposeSystemText } from '../locales/prompts'
import { fill, t } from '../locales/t'
import { ROLE_TEMPLATE, roleOf } from '../roles/template'
import type { RoleTraits } from '../roles/template'
import {
  CUSTOM_TRAITS,
  MAX_DESCRIPTION_CHARS,
  MAX_PROPOSAL_ERRORS,
  MAX_ROLES,
  purposeOf,
  TEMPLATE_IDS,
  titleOf,
  validateRoles,
} from '../roles/validate'
import { checkedCompletion, NOT_JSON_ERROR } from './checked'
import type { Checked } from './checked'

/** What the model is told when it turns the person's description into roles (D-83); the reply is validated in code. */
export const PROPOSE_SYSTEM = proposeSystemText(MAX_ROLES)

/** The line that introduces the person's description in the prompt. */
const PROMPT_INTRO = PROMPTS.proposeIntro

/**
 * The prompt for one attempt (D-83). It carries the person's description only as a JSON string, cut to
 * MAX_DESCRIPTION_CHARS code points, and the template ids basedOn may take. Nothing from the scan reaches it: it takes
 * no scan. After a failed attempt the exact errors follow, one per line.
 */
export function proposePrompt(description: string, errors: readonly string[]): string {
  const lines = [
    PROMPT_INTRO,
    JSON.stringify(Array.from(description).slice(0, MAX_DESCRIPTION_CHARS).join('')),
    fill(PROMPTS.allowedBasedOn, { ids: TEMPLATE_IDS.join(', ') }),
  ]

  return withReplyErrors(lines, errors, PROMPTS.replyErrorsIntro)
}

/** What parseProposal returns: the validated roles, or every error found. */
export type ProposalReply =
  | { readonly kind: 'ok'; readonly roles: readonly ProposedRole[] }
  | { readonly kind: 'invalid'; readonly errors: readonly string[] }

/** One reply entry read as a role. The role exists whenever the entry has a string id; the errors say what is wrong. */
type EntryRead = {
  readonly role: ProposedRole | null
  readonly errors: readonly string[]
}

/** The template id a reply's basedOn names: null for none, undefined for anything else (there is no case folding). */
function basedOnOf(value: unknown): TemplateRoleId | null | undefined {
  if (value === undefined || value === null) return null

  return TEMPLATE_IDS.find(id => id === value)
}

/** One reply entry as a role: id, cleaned and capped title and purpose, and basedOn. Every other key is dropped. */
function readEntry(entry: unknown, index: number): EntryRead {
  const id = isObject(entry) ? entry.id : undefined
  if (!isObject(entry) || typeof id !== 'string') {
    return { role: null, errors: [fill(PROMPTS.roleNoId, { number: index + 1 })] }
  }

  const label = fill(PROMPTS.roleLabel, { id: idLabel(id) })
  const errors: string[] = []
  const basedOn = basedOnOf(entry.basedOn)
  if (basedOn === undefined) errors.push(fill(PROMPTS.badBasedOn, { label, ids: TEMPLATE_IDS.join(', ') }))
  const purpose = typeof entry.purpose === 'string' ? purposeOf(entry.purpose) : null
  if (purpose === null) errors.push(fill(PROMPTS.noPurpose, { label }))
  const title = typeof entry.title === 'string' ? titleOf(entry.title) : null

  return { role: { id, title: title ?? '', purpose: purpose ?? '', basedOn: basedOn ?? null }, errors }
}

/** The list-level problems; a reply whose entries all lack an id has none, because each entry was reported already. */
function listProblems(roles: readonly ProposedRole[], entryCount: number): string[] {
  if (roles.length === 0 && entryCount > 0) return []

  return validateRoles(roles)
}

/**
 * The model's reply as validated roles (ROLE-02, D-46, D-83). The reply is untrusted: one code fence around it is
 * stripped, and only id, title, purpose and basedOn survive, so a reply cannot set Bash, MCP or skills. Every problem
 * is listed at once: first each entry's own errors in role order (no id, a bad basedOn, no purpose), then the list
 * errors of validateRoles (no roles, too many, each bad or repeated id, and each title missing or blank once cleaned),
 * capped at MAX_PROPOSAL_ERRORS.
 */
export function parseProposal(text: string): ProposalReply {
  const json = parseJsonValue(unfenced(text))
  if (json === null) return { kind: 'invalid', errors: [NOT_JSON_ERROR] }
  const list = isObject(json.value) ? json.value.roles : undefined
  if (!Array.isArray(list)) return { kind: 'invalid', errors: [PROMPTS.noRolesList] }

  const roles: ProposedRole[] = []
  const errors: string[] = []
  for (let index = 0; index < list.length && errors.length <= MAX_PROPOSAL_ERRORS; index++) {
    const read = readEntry(list[index], index)
    errors.push(...read.errors)
    if (read.role !== null) roles.push(read.role)
  }
  if (errors.length <= MAX_PROPOSAL_ERRORS) errors.push(...listProblems(roles, list.length))
  if (errors.length > 0) return { kind: 'invalid', errors: cappedErrors(errors, PROMPTS.moreErrors) }

  return { kind: 'ok', roles }
}

/** The traits a role takes from the template role it is based on; with no base it is a TL-like custom role (D-92). */
function traitsOf(basedOn: TemplateRoleId | null): RoleTraits {
  return ROLE_TEMPLATE.find(row => row.id === basedOn) ?? CUSTOM_TRAITS
}

/**
 * The roles for validated proposed roles. A role takes the Bash and `--ask-user` traits of its template base, and only
 * a role based on pm has no Bash (ROLE-05, D-92); a role with no base starts TL-like. Everything else is the shared
 * default.
 */
export function rolesFromProposal(proposed: readonly ProposedRole[]): RoleSpec[] {
  return proposed.map(role => roleOf(role, traitsOf(role.basedOn)))
}

/** Code points of the model's errors the fallback line shows, so a long list never cuts off the line's end. */
const MAX_FALLBACK_ERROR_CHARS = 120

/** The sentence that ends the fallback line. */
const FALLBACK_NOTE = t('suggest.propose.fallbackNote')

/** What proposeFromText gives: the described roles, or the fallback line and why the roles could not be used. */
export type Proposed =
  | { readonly kind: 'roles'; readonly roles: readonly RoleSpec[] }
  | { readonly kind: 'fallback'; readonly message: string }

/** The line init prints when the described structure cannot be used: the last errors, cut so the line keeps its end. */
function fallbackMessage(errors: readonly string[]): string {
  const reason = clean(errors.join('; '), MAX_FALLBACK_ERROR_CHARS)

  return t('suggest.propose.fallbackMessage', { reason, fallbackNote: FALLBACK_NOTE })
}

/**
 * Turns the person's description into roles through the model (D-83), with `progressText` as the status line and
 * `summary`, null for none, as its one-line summary while the model reads it (D-232, D-301). The prompt carries the
 * description as a JSON string and nothing from a scan (proposePrompt); every reply is validated by parseProposal, and
 * an invalid one is sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all (checkedCompletion). Then it
 * falls back with the last errors.
 */
export async function proposeFromText(
  io: InitIo,
  text: string,
  progressText: string,
  summary: string | null = null,
): Promise<Proposed> {
  const parse = (reply: string): Checked<Proposed> => {
    const parsed = parseProposal(reply)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: { kind: 'roles', roles: rolesFromProposal(parsed.roles) } }
  }
  const prompt = (errors: readonly string[]): string => proposePrompt(text, errors)
  const fallback = (errors: readonly string[]): Proposed => ({ kind: 'fallback', message: fallbackMessage(errors) })

  return checkedCompletion(io, { label: progressText, summary }, PROPOSE_SYSTEM, prompt, parse, fallback)
}
