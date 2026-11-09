import { describe, expect, test } from 'claude-code/testing'

import { FRAMEWORKS } from '../testkit'
import { adapterOf } from './registry'
import { WORKSTREAM_PATTERN, workstreamName } from './workstream'

describe('the per-role GSD workstream', () => {
  test('a role is cadre-<id> in the main checkout and cadre-<epic slug>-<id> in an epic, both matching', () => {
    const names = [workstreamName('be', null), workstreamName('be', 'proj-1-add-retry')]

    expect(names).toEqual(['cadre-be', 'cadre-proj-1-add-retry-be'])
    expect(names.every(name => WORKSTREAM_PATTERN.test(name))).toBe(true)
    expect(WORKSTREAM_PATTERN.source).toBe('^cadre-[a-z0-9-]{1,80}$')
  })

  test('a name over the pattern is cut from the slug side, so the role id stays whole', () => {
    const name = workstreamName('security', 'x'.repeat(100))

    expect(name).toBe(`cadre-${'x'.repeat(71)}-security`)
    expect(WORKSTREAM_PATTERN.test(name)).toBe(true)
  })

  test('two roles, or one role in two epics or in main and an epic, never share a name', () => {
    const names = [
      workstreamName('be', null),
      workstreamName('fe', null),
      workstreamName('be', 'proj-1'),
      workstreamName('be', 'proj-2'),
      workstreamName('fe', 'proj-1'),
    ]

    expect(new Set(names).size).toBe(names.length)
  })

  test('only GSD names a workstream env, GSD_WORKSTREAM; superpowers and none name none', () => {
    expect(FRAMEWORKS.map(id => adapterOf(id).roleWork.workstreamEnv)).toEqual(['GSD_WORKSTREAM', null, null])
  })
})
