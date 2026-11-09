import { describe, expect, test } from 'claude-code/testing'

import { gitWorld, memIo, onDisk, plannedFiles, stateText, templateRole } from '../testkit'
import { teamViewOf } from './hierarchy'

describe('teamViewOf', () => {
  test('the roles of cadre.json in order, each with its parent: PM on top, TL under PM, others under TL', async () => {
    const files = await plannedFiles(gitWorld(), [templateRole('pm'), templateRole('tl'), templateRole('be')])
    const world = gitWorld({ dirs: { '/repo/.git': [], '/repo/.cadre': [] }, files: onDisk(files) })

    expect(await teamViewOf(memIo(world, {}).io, '/repo')).toEqual({
      ids: ['pm', 'tl', 'be'],
      parents: { pm: null, tl: 'pm', be: 'tl' },
      pm: 'pm',
    })
  })

  test('a team with no PM stand-in has no pm, and every parent is null', async () => {
    const files = await plannedFiles(gitWorld(), [templateRole('tl'), templateRole('be')])
    const world = gitWorld({ dirs: { '/repo/.git': [], '/repo/.cadre': [] }, files: onDisk(files) })

    expect(await teamViewOf(memIo(world, {}).io, '/repo')).toEqual({
      ids: ['tl', 'be'],
      parents: { tl: null, be: null },
      pm: null,
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
