/**
 * The roles of an epic (D-144, D-159, D-161, D-165, D-166), a layer 11 module: the PM of the team (epicPmOf) and the
 * parent each role waits for (epicParentOf), the refusals of a checkout, team or launcher /cadre epic cannot start
 * from, and the one question that picks the roles to open (epicPickedRoles), asked through the InitIo port. It imports
 * core, roles/template and ui/ask; epic/create reads it, and epic/done reads its checkout refusals.
 */
import type { InitIo, RoleSpec, TemplateRoleId } from '../../types'
import { reportText } from '../core/text'
import { t } from '../locales/t'
import { standIn, standsFor } from '../roles/template'
import { askChoice, quotedLabels } from '../ui/ask'

/** The template role whose role fetches the epic with the tracker MCP (D-143, D-161). */
const PM_ROLE: TemplateRoleId = 'pm'

/** The template role whose role PM feeds the epic's tickets to, and the other roles wait for (D-144, D-159). */
export const TL_ROLE: TemplateRoleId = 'tl'

/** The refusal when git cannot tell whether the session root is the main checkout (D-165): it fails closed. */
export const EPIC_UNKNOWN_CHECKOUT = t('epic.pick.epicUnknownCheckout')

/**
 * The refusal in a linked worktree (D-16, D-165): /cadre epic runs only in the root session of the main checkout, which
 * the reply names, cleaned, when git gave it.
 */
export function epicNotMainReply(main: string | null): string {
  if (main === null) return t('epic.pick.epicNotMainReply')

  return t('epic.pick.epicNotMainReply2', { main: reportText(main) })
}

/** The refusal of a team with no PM role (D-161): the PM is the role that fetches the epic. */
export const EPIC_NO_PM = t('epic.pick.epicNoPm')

/**
 * The refusal of a team with several roles based on `pm` and none with the id `pm` (D-161): the PM fetches the epic,
 * and cadre does not pick one of them. The ids are shown cleaned.
 */
export function epicManyPmReply(ids: readonly string[]): string {
  return t('epic.pick.epicManyPmReply', { ids: reportText(ids.join(', ')) })
}

/**
 * The PM of the team (D-161): the role with id `pm`, else the one role based on `pm`, as standsFor counts it. A team
 * with neither refuses with EPIC_NO_PM, and one with several roles based on `pm` and none with that id refuses with
 * epicManyPmReply.
 */
export function epicPmOf(
  roles: readonly Pick<RoleSpec, 'id' | 'basedOn'>[],
): { readonly kind: 'ok'; readonly id: string } | { readonly kind: 'refuse'; readonly text: string } {
  if (roles.some(role => role.id === PM_ROLE)) return { kind: 'ok', id: PM_ROLE }
  const candidates = roles.filter(role => standsFor(role, PM_ROLE))
  const [only] = candidates
  if (only === undefined) return { kind: 'refuse', text: EPIC_NO_PM }
  if (candidates.length > 1) return { kind: 'refuse', text: epicManyPmReply(candidates.map(role => role.id)) }

  return { kind: 'ok', id: only.id }
}

/**
 * The parent a role of the epic waits for (D-159): none for the PM `pmId`; the PM for the TL, the role standIn finds
 * for `tl` (the one with id tl, else the first based on tl); the TL for every other role, or the PM when the team has
 * no TL.
 */
export function epicParentOf(
  role: Pick<RoleSpec, 'id' | 'basedOn'>,
  roles: readonly Pick<RoleSpec, 'id' | 'basedOn'>[],
  pmId: string,
): string | null {
  if (role.id === pmId) return null
  const tlId = standIn(TL_ROLE, roles)
  if (tlId === null || tlId === role.id) return pmId

  return tlId
}

/**
 * The refusal when a role's launcher in the main checkout was written before the epic kickoff (D-158): it would start
 * the role with its own kickoff and not the epic's, so /cadre epic stops before it creates anything and names each such
 * role, cleaned, with the /cadre regen that writes its launcher anew. As a new epic worktree checks out HEAD (D-146), a
 * repo that commits `.cadre/` (the `definitions` and `all` policies) is told to commit the regenerated launchers and
 * `.cadre/manifest.json` first, else the worktree holds the old ones and no role opens (03.1-W4 S2; the manifest, which
 * holds each launcher's sha256, since /cadre start in the worktree checks it, 03.1-W6 S2).
 */
export function epicOldLauncherReply(ids: readonly string[]): string {
  const regens = ids.map(id => t('epic.pick.epicOldLauncherReply', { id: reportText(id) })).join(', ')

  return t('epic.pick.epicOldLauncherReply2', { ids: reportText(ids.join(', ')), regens })
}

/** The chip of the question on which roles of the epic to open (D-166). */
export const EPIC_ROLES_HEADER = t('epic.pick.epicRolesHeader')

/** The option of the role question that opens only the PM, who always opens (D-166). */
const PM_ONLY_OPTION = t('epic.pick.pmOnlyOption')

/** The recommended option of the role question, which opens each of the team's `count` roles (D-166). */
function allRolesOption(count: number): string {
  return t('epic.pick.allRolesOption', { count })
}

/**
 * The question on which roles of the epic to open (D-166), for a team of `count` roles: all of them, the PM only, or
 * the role ids typed under Other. The PM always opens, as it fetches the epic.
 */
export function epicRolesQuestion(count: number): string {
  return t('epic.pick.epicRolesQuestion', { count })
}

/** The reply when the role question is dismissed or gets no usable answer (D-166): nothing was created. */
export const EPIC_CANCELLED = t('epic.pick.epicCancelled')

/**
 * The role ids an answer to the role question picks (D-166), in cadre.json order: every id for the all option, the PM
 * for PM only, else the ids typed, split on commas and whitespace, each a team role id as it is, with the PM added;
 * null for an empty answer or one that names an id the team does not have, so it is asked again.
 */
function pickedIds(answer: string, ids: readonly string[], pmId: string): readonly string[] | null {
  const typed = answer.trim()
  if (typed === allRolesOption(ids.length)) return ids
  if (typed === PM_ONLY_OPTION) return [pmId]
  const words = typed.split(/[\s,]+/).filter(word => word !== '')
  if (words.length === 0 || words.some(word => !ids.includes(word))) return null

  return ids.filter(id => id === pmId || words.includes(id))
}

/**
 * The roles /cadre epic opens (D-166), in cadre.json order: the whole team when it has one role or the session has no
 * dialog (`claude -p`), else what one epicRolesQuestion under EPIC_ROLES_HEADER picks (pickedIds), asked with
 * askChoice, so an answer it cannot read is asked again with why on top. Null when the question is dismissed or gets
 * no usable answer, which cancels the run before anything is created.
 */
export async function epicPickedRoles(
  io: InitIo,
  roles: readonly RoleSpec[],
  pmId: string,
): Promise<readonly RoleSpec[] | null> {
  if (roles.length < 2 || (await io.isInteractive()) !== true) return roles
  const ids = roles.map(role => role.id)
  const options = [allRolesOption(ids.length), PM_ONLY_OPTION]
  const answer = await askChoice(io, {
    question: epicRolesQuestion(ids.length),
    spec: { options, header: EPIC_ROLES_HEADER },
    parse: text => pickedIds(text, ids, pmId),
    accepts: t('epic.pick.epicPickedRolesAccepts', { quotedLabels: quotedLabels(options), ids: ids.join(', ') }),
  })
  if (answer.kind !== 'answered') return null

  return roles.filter(role => answer.value.includes(role.id))
}
