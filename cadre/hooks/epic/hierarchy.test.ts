import { describe, expect, test } from 'claude-code/testing'

import { gitWorld, memIo, onDisk, plannedFiles, stateText, templateRole } from '../testkit'
import { teamViewOf } from './hierarchy'

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
    })
  })

  test('a team whose cadre.json lists the reserved role id cadre gives null', async () => {
    const files = await plannedFiles(gitWorld(), [templateRole('pm'), templateRole('be')])
    const listed = { ...onDisk(files), '/repo/.cadre/cadre.json': stateText({ roles: ['pm', 'cadre'] }) }
    const world = gitWorld({ dirs: { '/repo/.git': [], '/repo/.cadre': [] }, files: listed })

    expect(await teamViewOf(memIo(world, {}).io, '/repo')).toBeNull()
  })

  test('a team that cannot be read gives null', async () => {
    expect(await teamViewOf(memIo(gitWorld(), {}).io, '/repo')).toBeNull()
  })
})
