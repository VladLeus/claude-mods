import { describe, expect, test } from 'claude-code/testing'

import type { CadreState, Sizing, TeamView } from '../../types'
import { gitWorld, memIo, onDisk, plannedFiles, stateText, templateRole } from '../testkit'
import { teamViewOf } from './hierarchy'

/** The team view of pm and tl over files planned with the state `over` changes. */
async function viewOver(over: Partial<CadreState>): Promise<TeamView | null> {
  const files = await plannedFiles(gitWorld(), [templateRole('pm'), templateRole('tl')], over)
  const world = gitWorld({ dirs: { '/repo/.git': [], '/repo/.cadre': [] }, files: onDisk(files) })

  return teamViewOf(memIo(world, {}).io, '/repo')
}

/** The sizing of a repo whose stored framework is none and that records no frameworks. */
const NO_FRAMEWORK_SIZING = { threshold: 0.5, mapping: { small: 'none', large: 'none' }, rubric: '.cadre/sizing.md' }

describe('teamViewOf', () => {
  test('the roles of cadre.json in order, each with its parent: PM on top, TL under PM, others under TL', async () => {
    const files = await plannedFiles(gitWorld(), [templateRole('pm'), templateRole('tl'), templateRole('be')])
    const world = gitWorld({ dirs: { '/repo/.git': [], '/repo/.cadre': [] }, files: onDisk(files) })

    expect(await teamViewOf(memIo(world, {}).io, '/repo')).toEqual({
      ids: ['pm', 'tl', 'be'],
      parents: { pm: null, tl: 'pm', be: 'tl' },
      pm: 'pm',
      sizing: NO_FRAMEWORK_SIZING,
      frameworks: [],
      mayRun: { pm: ['none'], tl: ['none'], be: ['none'] },
    })
  })

  test('a team with no PM stand-in has no pm, and every parent is null', async () => {
    const files = await plannedFiles(gitWorld(), [templateRole('tl'), templateRole('be')])
    const world = gitWorld({ dirs: { '/repo/.git': [], '/repo/.cadre': [] }, files: onDisk(files) })

    expect(await teamViewOf(memIo(world, {}).io, '/repo')).toEqual({
      ids: ['tl', 'be'],
      parents: { tl: null, be: null },
      pm: null,
      sizing: NO_FRAMEWORK_SIZING,
      frameworks: [],
      mayRun: { tl: ['none'], be: ['none'] },
    })
  })

  test('a team whose cadre.json lists the reserved role id cadre gives null', async () => {
    const files = await plannedFiles(gitWorld(), [templateRole('pm'), templateRole('be')])
    const listed = { ...onDisk(files), '/repo/.cadre/cadre.json': stateText({ roles: ['pm', 'cadre'] }) }
    const world = gitWorld({ dirs: { '/repo/.git': [], '/repo/.cadre': [] }, files: listed })

    expect(await teamViewOf(memIo(world, {}).io, '/repo')).toBeNull()
  })

  test('a sizing block with threshold 0.7 in cadre.json is the sizing of the view', async () => {
    const sizing: Sizing = { threshold: 0.7, mapping: { small: 'gsd', large: 'gsd' }, rubric: '.cadre/sizing.md' }
    const view = await viewOver({ framework: 'gsd', sizing })

    expect([view?.sizing, view?.frameworks]).toEqual([sizing, ['gsd']])
  })

  test('the frameworks cadre.json records are the view\'s; with no sizing block the default maps both', async () => {
    const view = await viewOver({ framework: 'gsd', frameworks: ['gsd', 'superpowers'] })

    expect(view?.frameworks).toEqual(['gsd', 'superpowers'])
    expect(view?.sizing).toEqual({
      threshold: 0.5,
      mapping: { small: 'superpowers', large: 'gsd' },
      rubric: '.cadre/sizing.md',
    })
  })

  test('a setup with neither and the stored framework gsd gets gsd alone and its default sizing', async () => {
    const view = await viewOver({ framework: 'gsd' })

    expect([view?.frameworks, view?.sizing.mapping]).toEqual([['gsd'], { small: 'gsd', large: 'gsd' }])
  })

  test('each role may run its own framework, then the others the repo records; a role on none runs none', async () => {
    const view = await viewOver({ framework: 'gsd', frameworks: ['gsd', 'superpowers'] })

    expect(view?.mayRun).toEqual({ pm: ['none'], tl: ['gsd', 'superpowers'] })
  })

  test('a team that cannot be read gives null', async () => {
    expect(await teamViewOf(memIo(gitWorld(), {}).io, '/repo')).toBeNull()
  })
})
