import { describe, expect, test } from 'claude-code/testing'

import type { FrameworkId, InboxEntry, RoleSpec, TeamView } from '../../types'
import { CONTRACTS } from '../locales/contracts'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { parseInboxLine } from '../messages/record'
import { BODY_MAX_CHARS } from '../messages/send'
import { defaultSizing } from '../messages/sizing'
import { templateRole } from '../testkit'
import { epicEntryLine } from './brief'

const ROLES: readonly RoleSpec[] = [templateRole('pm'), templateRole('tl'), templateRole('be')]
const BOTH: readonly FrameworkId[] = ['gsd', 'superpowers']

/** The team view of pm, tl and be with these frameworks and their default sizing. */
function teamWith(frameworks: readonly FrameworkId[]): TeamView {
  return {
    ids: ['pm', 'tl', 'be'],
    parents: { pm: null, tl: 'pm', be: 'tl' },
    pm: 'pm',
    sizing: defaultSizing(frameworks),
    frameworks,
    mayRun: { pm: ['none'], tl: frameworks, be: frameworks },
  }
}

/** The entry of the seed of epic PROJ-1 at 1000 over the team view; null when there is none. */
async function seedOf(team: TeamView, title = 'Add retry'): Promise<InboxEntry | null> {
  const line = await epicEntryLine({ key: 'PROJ-1', title, team, at: 1000, roles: ROLES })
  const event = line === null ? null : parseInboxLine(line)

  return event?.type === 'entry' ? event : null
}

describe('epicEntryLine', () => {
  test('one record line of a note from cadre to the PM, stamped with the time given', async () => {
    const team = teamWith(BOTH)
    const line = await epicEntryLine({ key: 'PROJ-1', title: 'Add retry', team, at: 1000, roles: ROLES })
    const entry = await seedOf(teamWith(BOTH))

    expect([line?.endsWith('\n'), line?.split('\n').length]).toEqual([true, 2])
    expect(entry).toMatchObject({ type: 'entry', from: CONTRACTS.cadreSender, to: 'pm', kind: 'note', at: 1000 })
    expect(entry?.id ?? '').toMatch(/^cadre-1000-[0-9a-f]{8}$/)
    expect(entry?.subject ?? '').toContain('PROJ-1')
  })

  test('its body names the epic, both modes, the threshold, the rubric, each role and parent, the steps', async () => {
    const body = (await seedOf(teamWith(BOTH)))?.body ?? ''
    const parts = ['PROJ-1', 'Add retry', 'gsd-epic, ticket', '0.5', '.cadre/sizing.md', 'tl (parent pm)']

    expect([...parts, 'be (parent tl)', 'grill', 'epic-end'].filter(part => !body.includes(part))).toEqual([])
  })

  test('with gsd alone it offers ticket mode only and never gsd-epic; with no framework no planning mode', async () => {
    const gsd = (await seedOf(teamWith(['gsd'])))?.body ?? ''
    const none = (await seedOf(teamWith([])))?.body ?? ''

    expect(gsd).not.toContain('gsd-epic')
    expect(gsd).toContain(fill(PROMPTS.epicBriefModes, { modes: 'ticket' }))
    expect(none).not.toContain('gsd-epic')
    expect(none).toContain(PROMPTS.epicBriefNoModes)
  })

  test('with no framework the no-mode line says none is recorded and names /cadre frameworks', async () => {
    const none = (await seedOf(teamWith([])))?.body ?? ''
    const line = none.split('\n').find(text => text.includes('no planning mode')) ?? ''

    expect(PROMPTS.epicBriefNoModes).toBe(
      'This repo offers no planning mode: no supported framework is recorded for it ' +
        '(run /cadre frameworks to choose one).',
    )
    expect([line.includes(PROMPTS.epicBriefNoModes), line.includes('installed')]).toEqual([true, false])
  })

  test('the title is cleaned and cut first, so the body stays within its cap and keeps its steps', async () => {
    const body = (await seedOf(teamWith(BOTH), `T\u202E${'x'.repeat(5000)}`))?.body ?? ''

    expect(Array.from(body).length).toBeLessThanOrEqual(BODY_MAX_CHARS)
    expect(body).not.toContain('\u202E')
    expect(body).toContain('epic-end')
  })

  test('a team view with no PM gets no seed', async () => {
    const team = { ...teamWith(BOTH), pm: null }

    expect(await epicEntryLine({ key: 'PROJ-1', title: 'Add retry', team, at: 1000, roles: ROLES })).toBeNull()
  })
})
