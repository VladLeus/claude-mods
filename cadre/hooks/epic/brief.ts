/**
 * PM's epic brief, a layer 11 module: the one inbox line from cadre that /cadre epic seeds PM's new inbox with. It
 * names the epic, the planning modes the repo's frameworks offer, the sizing threshold and rubric, the team with each
 * role's parent, and PM's steps.
 */
import type { PlanningMode, RoleSpec, TeamView } from '../../types'
import { clean } from '../core/text'
import { CONTRACTS } from '../locales/contracts'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { entryIdOf, recordLine } from '../messages/record'
import { BODY_MAX_CHARS, SUBJECT_MAX_CHARS } from '../messages/send'
import { modesOffered } from '../messages/sizing'

/** What stands between the epic key and its title. */
const TITLE_SEPARATOR = ': '

function epicName(key: string, title: string): string {
  return title === '' ? key : `${key}${TITLE_SEPARATOR}${title}`
}

function modesText(modes: readonly PlanningMode[]): string {
  return modes.length === 0 ? PROMPTS.epicBriefNoModes : fill(PROMPTS.epicBriefModes, { modes: modes.join(', ') })
}

/** Each role in team order with its parent; the top of the hierarchy is marked as such. */
function teamText(team: TeamView, roles: readonly RoleSpec[]): string {
  const shown = roles.map(({ id }) => {
    const parent = team.parents[id] ?? null

    return parent === null ? fill(PROMPTS.epicBriefTop, { id }) : fill(PROMPTS.epicBriefChild, { id, parent })
  })

  return shown.join(', ')
}

/** The roles PM feeds: those whose parent is the PM, else the word for PM's roles. */
function leadsText(team: TeamView, pm: string): string {
  const leads = team.ids.filter(id => team.parents[id] === pm)

  return leads.length === 0 ? PROMPTS.epicFeedRoles : leads.join(', ')
}

/**
 * The record line of PM's epic brief, a note from cadre to the PM stamped at `at`; null when the team has no PM. The
 * title is cleaned and cut first, so the body stays within BODY_MAX_CHARS and keeps every step.
 */
export async function epicEntryLine(input: {
  readonly key: string
  readonly title: string
  readonly team: TeamView
  readonly at: number
  readonly roles: readonly RoleSpec[]
}): Promise<string | null> {
  const { key, team, at, roles } = input
  const { pm } = team
  if (pm === null) return null
  const leads = leadsText(team, pm)
  const modes = modesOffered(team.frameworks)
  const send = modes.includes('gsd-epic') ? PROMPTS.epicBriefSendEpic : PROMPTS.epicBriefSend
  const bodyWith = (title: string): string =>
    [
      fill(PROMPTS.epicBriefIntro, { epic: epicName(key, title) }),
      modesText(modes),
      fill(PROMPTS.epicBriefSizing, { threshold: team.sizing.threshold, rubric: team.sizing.rubric }),
      fill(PROMPTS.epicBriefTeam, { team: teamText(team, roles) }),
      PROMPTS.epicBriefSteps,
      PROMPTS.epicBriefFetch,
      PROMPTS.epicBriefGrill,
      PROMPTS.epicBriefPropose,
      fill(send, { leads }),
      fill(PROMPTS.epicBriefFeed, { leads }),
      PROMPTS.epicBriefEnd,
    ].join('\n')
  const room = BODY_MAX_CHARS - Array.from(bodyWith('')).length - TITLE_SEPARATOR.length
  const title = clean(input.title, room).trim()
  const body = Array.from(bodyWith(title)).slice(0, BODY_MAX_CHARS).join('')
  const subject = clean(fill(PROMPTS.epicBriefSubject, { epic: epicName(key, title) }), SUBJECT_MAX_CHARS)
  const id = await entryIdOf(CONTRACTS.cadreSender, at, [pm, 'note', subject, body].join('\n'))

  return recordLine({
    v: 1,
    type: CONTRACTS.inboxEntryType,
    id,
    at,
    from: CONTRACTS.cadreSender,
    to: pm,
    kind: 'note',
    subject,
    body,
  })
}
