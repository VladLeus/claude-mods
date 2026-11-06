/**
 * The recommendations block, a layer 8 module: the print-only lines of the tools init recommends, each for its role
 * (decision #69 A2). It imports core and the types, so init reads it here.
 */
import type { Recommendation, RoleSpec } from '../../../types'
import { reportText } from '../../core/text'
import { t } from '../../locales/t'

/**
 * The heading above the recommendation lines: the lines only print commands, and init asks before it installs any of
 * them, as it does for the security plugins (decision #69 A2).
 */
const RECOMMENDATIONS_HEADING = t('ui.recommendations.recommendationsHeading')

/** The one line printed when there is nothing to recommend. */
const NO_RECOMMENDATIONS = t('ui.recommendations.noRecommendations')

/** Who benefits when a recommendation names no role. */
const ALL_ROLES = t('ui.recommendations.allRoles')

/** The title of the role with this id; the id itself when no role has it. */
function roleTitle(roleId: string, roles: readonly RoleSpec[]): string {
  return roles.find(role => role.id === roleId)?.title ?? roleId
}

/**
 * The lines init prints for the recommendations: `Recommendations: none`, or a heading and then two lines for each,
 * `- <tool> for <role title or all roles>: <why>` and `    run: <command>`; a recommendation with no install command
 * (null) gets its first line only, with no run line (E3). Every cell is cleaned and capped as a report cell is, so
 * none can add a line or hide text.
 */
export function recommendationLines(
  recommendations: readonly Recommendation[],
  roles: readonly RoleSpec[],
): string[] {
  if (recommendations.length === 0) return [NO_RECOMMENDATIONS]
  const lines = [RECOMMENDATIONS_HEADING]
  for (const recommendation of recommendations) {
    const who = recommendation.roleId === null ? ALL_ROLES : roleTitle(recommendation.roleId, roles)
    lines.push(t('ui.recommendations.recommendationLines', {
      tool: reportText(recommendation.tool),
      who: reportText(who),
      why: reportText(recommendation.why),
    }))
    if (recommendation.install === null) continue
    lines.push(t('ui.recommendations.recommendationLines2', { install: reportText(recommendation.install) }))
  }

  return lines
}
